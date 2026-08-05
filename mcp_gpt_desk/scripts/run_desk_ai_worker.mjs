#!/usr/bin/env node
import process from "node:process";
import { resolve } from "node:path";

import { CodexExecAdapter } from "../src/codex-exec-adapter.js";
import { loadCodexRuntimeSettings } from "../src/codex-runtime-settings.js";
import {
  DeskAiWorkerService,
  LocalDeskWorkerFacade,
  replayAdmissionAgainstLiveCursor,
} from "../src/desk-ai-worker-service.js";
import { createDeskStoreFromEnv } from "../src/store.js";

const once = process.argv.includes("--once");
const scope = String(process.env.DESK_AI_WORKER_SCOPE || "live").toLowerCase();
const mode = String(process.env.DESK_AI_WORKER_MODE || "shadow").toLowerCase();
const workerId = String(process.env.DESK_AI_WORKER_ID || `codex-${scope}-${process.pid}`);
const pollMs = boundedInteger(process.env.DESK_AI_WORKER_POLL_MS, 15_000, 1_000, 300_000);
const releaseVersion = String(process.env.DESK_RELEASE_VERSION || "unversioned");
const serviceId = String(process.env.DESK_AI_SERVICE_ID || `codex_${scope}_worker`);
const store = createDeskStoreFromEnv();
const facade = new LocalDeskWorkerFacade(store);
const adapter = new CodexExecAdapter({
  cwd: resolve(process.env.DESK_AI_WORKER_PROJECT_ROOT || process.cwd()),
  runtimeSettingsProvider: () => loadCodexRuntimeSettings(store.persistence),
});
const worker = new DeskAiWorkerService({
  facade,
  adapter,
  scope,
  workerId,
  mode,
  claimGuard: scope === "replay" ? replayAdmission : null,
});
let stopped = false;
let lockClient = null;
let wakeListener = null;
const wakeWaiters = new Set();

process.on("SIGINT", () => { stopped = true; });
process.on("SIGTERM", () => { stopped = true; });

try {
  await store.persistence.initialized;
  lockClient = await store.persistence.pool.connect();
  const lock = await lockClient.query(
    "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
    [`desk:ai-worker:${workerId}`],
  );
  if (!lock.rows[0]?.acquired) throw new Error(`AI_WORKER_ALREADY_RUNNING:${workerId}`);
  wakeListener = (message) => {
    let payload = {};
    try { payload = JSON.parse(message.payload || "{}"); } catch { payload = {}; }
    if (payload.scope && payload.scope !== scope) return;
    for (const wake of wakeWaiters) wake();
  };
  lockClient.on("notification", wakeListener);
  await lockClient.query("LISTEN desk_ai_work_ready");

  let preflight = null;
  if (mode === "active") {
    preflight = await adapter.preflight();
  }
  await heartbeat("starting", {
    scope,
    mode,
    poll_ms: pollMs,
    codex: preflight,
  });

  do {
    try {
      const result = await worker.runOnce();
      const status = result.ok === false
        ? "degraded"
        : "healthy";
      await heartbeat(status, { scope, mode, last_result: result });
      if (once) break;
      if (result.status === "COMPLETED") {
        await delay(250);
      } else {
        await waitForWake(pollMs);
      }
    } catch (error) {
      await heartbeat("degraded", {
        scope,
        mode,
        error: safeError(error),
      }).catch(() => undefined);
      if (once) throw error;
      await delay(Math.max(pollMs, 5_000));
    }
  } while (!stopped);
} finally {
  await heartbeat("stopping", { scope, mode }).catch(() => undefined);
  if (lockClient) {
    if (wakeListener) lockClient.off("notification", wakeListener);
    await lockClient.query("UNLISTEN desk_ai_work_ready").catch(() => undefined);
    await lockClient.query(
      "SELECT pg_advisory_unlock(hashtext($1))",
      [`desk:ai-worker:${workerId}`],
    ).catch(() => undefined);
    lockClient.release();
  }
  await store.persistence.close?.();
}

async function replayAdmission() {
  const tradingDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return replayAdmissionAgainstLiveCursor(store.persistence, tradingDate);
}

function waitForWake(milliseconds) {
  return new Promise((resolveWake) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      wakeWaiters.delete(finish);
      resolveWake();
    };
    const timer = setTimeout(finish, milliseconds);
    wakeWaiters.add(finish);
  });
}

async function heartbeat(status, details) {
  await store.persistence.pool.query(
    `INSERT INTO desk_service_heartbeats (
       service_id, service_kind, instance_id, release_version, status, details,
       started_at_utc, heartbeat_at_utc, updated_at_utc
     ) VALUES ($1, 'codex_ai_worker', $2, $3, $4, $5::jsonb, now(), now(), now())
     ON CONFLICT (service_id) DO UPDATE
       SET instance_id = EXCLUDED.instance_id,
           release_version = EXCLUDED.release_version,
           status = EXCLUDED.status,
           details = EXCLUDED.details,
           heartbeat_at_utc = now(),
           updated_at_utc = now()`,
    [serviceId, workerId, releaseVersion, status, JSON.stringify(details || {})],
  );
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function safeError(error) {
  return {
    code: error?.code || "AI_WORKER_RUNTIME_FAILED",
    message: String(error?.message || error || "unknown error").slice(0, 1_000),
    retryable: error?.retryable === true,
  };
}
