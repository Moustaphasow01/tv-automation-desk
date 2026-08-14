#!/usr/bin/env node
import process from "node:process";
import { createDeskStoreFromEnv } from "../src/store.js";
import { DomainAssistantRuntimeService } from "../src/domain-assistant-runtime-service.js";
import { DomainAssistantWorkerService } from "../src/domain-assistant-worker-service.js";

const args = parseArgs(process.argv.slice(2));
const once = args.once === true;
const assistantId = args["assistant-id"] || args.assistantId || null;
const workerId = args["worker-id"] || args.workerId || process.env.DESK_DOMAIN_ASSISTANT_WORKER_ID || "domain-assistant-worker-01";
const pollMs = boundedNumber(args["poll-ms"] || process.env.DESK_DOMAIN_ASSISTANT_POLL_MS, 5_000, 500, 60_000);
const leaseSeconds = boundedNumber(args["lease-seconds"] || process.env.DESK_DOMAIN_ASSISTANT_LEASE_SECONDS, 300, 30, 3_600);
const serviceId = process.env.DESK_SERVICE_ID || "domain_assistant_worker";
const instanceId = String(process.env.DESK_SERVICE_INSTANCE_ID || `${serviceId}-${process.pid}`);
const releaseVersion = String(process.env.DESK_RELEASE_VERSION || "unversioned");

let stopped = false;
let lockClient = null;
process.on("SIGINT", () => { stopped = true; });
process.on("SIGTERM", () => { stopped = true; });

const store = createDeskStoreFromEnv();
const runtime = new DomainAssistantRuntimeService({ persistence: store.persistence });
const worker = new DomainAssistantWorkerService({ service: runtime, clock: store.clock });

try {
  await store.persistence.initialized;
  lockClient = await store.persistence.pool.connect();
  const lockName = `desk:domain-assistant-worker:${workerId}`;
  const lock = await lockClient.query("SELECT pg_try_advisory_lock(hashtext($1)) AS acquired", [lockName]);
  if (!lock.rows[0]?.acquired) throw new Error(`DOMAIN_ASSISTANT_WORKER_ALREADY_RUNNING:${workerId}`);
  await heartbeat("starting", { assistant_id: assistantId, worker_id: workerId, lease_seconds: leaseSeconds });

  do {
    try {
      const result = await worker.runOnce({ assistantId, workerId, leaseSeconds });
      await heartbeat(result.status === "IDLE" ? "idle" : "healthy", { result });
      process.stdout.write(`${JSON.stringify({ at: store.clock.now().utc, ...result })}\n`);
      if (once) break;
      await delay(result.status === "IDLE" ? pollMs : 250);
    } catch (error) {
      await heartbeat("degraded", { error: safeError(error) }).catch(() => undefined);
      if (once) throw error;
      await delay(Math.max(pollMs, 5_000));
    }
  } while (!stopped);
} finally {
  await heartbeat("stopping", {}).catch(() => undefined);
  if (lockClient) {
    await lockClient.query("SELECT pg_advisory_unlock(hashtext($1))", [`desk:domain-assistant-worker:${workerId}`]).catch(() => undefined);
    lockClient.release();
  }
  await store.persistence.close?.();
}

async function heartbeat(status, details = {}) {
  await store.persistence.pool.query(
    `INSERT INTO desk_service_heartbeats (
       service_id, service_kind, instance_id, release_version, status, details,
       started_at_utc, heartbeat_at_utc, updated_at_utc
     ) VALUES ($1, 'domain_assistant_runtime', $2, $3, $4, $5::jsonb, now(), now(), now())
     ON CONFLICT (service_id) DO UPDATE
       SET instance_id = EXCLUDED.instance_id,
           release_version = EXCLUDED.release_version,
           status = EXCLUDED.status,
           details = EXCLUDED.details,
           heartbeat_at_utc = now(),
           updated_at_utc = now()`,
    [serviceId, instanceId, releaseVersion, status, JSON.stringify(details || {})],
  );
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--once") {
      parsed.once = true;
      continue;
    }
    if (!arg.startsWith("--")) continue;
    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    parsed[rawKey] = inlineValue !== undefined ? inlineValue : argv[index + 1];
    if (inlineValue === undefined) index += 1;
  }
  return parsed;
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeError(error) {
  return String(error?.message || error || "unknown error").slice(0, 1_000);
}
