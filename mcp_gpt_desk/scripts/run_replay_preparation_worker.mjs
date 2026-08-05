#!/usr/bin/env node
import process from "node:process";
import { createDeskStoreFromEnv } from "../src/store.js";

const once = process.argv.includes("--once");
const pollMs = boundedNumber(process.env.DESK_REPLAY_PREPARATION_WORKER_POLL_MS, 2_000, 500, 60_000);
const store = createDeskStoreFromEnv();
const workerId = String(process.env.DESK_SERVICE_INSTANCE_ID || `replay-preparation-${process.pid}`);
const releaseVersion = String(process.env.DESK_RELEASE_VERSION || "unversioned");
let stopped = false;
let lockClient = null;

process.on("SIGINT", () => { stopped = true; });
process.on("SIGTERM", () => { stopped = true; });

try {
  await store.persistence.initialized;
  lockClient = await store.persistence.pool.connect();
  const lock = await lockClient.query(
    "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
    ["desk:replay-preparation-worker"],
  );
  if (!lock.rows[0]?.acquired) throw new Error("REPLAY_PREPARATION_WORKER_ALREADY_RUNNING");
  await heartbeat("starting", { poll_ms: pollMs });

  do {
    try {
      const result = await store.processNextReplayPreparation({ worker_id: workerId });
      await heartbeat("healthy", {
        last_status: result.status,
        preparation_id: result.job?.preparation_id || null,
      });
      if (once) break;
      if (result.status === "NO_PREPARATION_WORK") await delay(pollMs);
    } catch (error) {
      await heartbeat("degraded", { error: safeError(error) }).catch(() => undefined);
      if (once) throw error;
      await delay(Math.max(pollMs, 5_000));
    }
  } while (!stopped);
} finally {
  await heartbeat("stopping", {}).catch(() => undefined);
  if (lockClient) {
    await lockClient.query(
      "SELECT pg_advisory_unlock(hashtext($1))",
      ["desk:replay-preparation-worker"],
    ).catch(() => undefined);
    lockClient.release();
  }
  await store.persistence.close?.();
}

async function heartbeat(status, details) {
  await store.persistence.pool.query(
    `INSERT INTO desk_service_heartbeats (
       service_id, service_kind, instance_id, release_version, status, details,
       started_at_utc, heartbeat_at_utc, updated_at_utc
     ) VALUES ($1, 'replay_preparation', $2, $3, $4, $5::jsonb, now(), now(), now())
     ON CONFLICT (service_id) DO UPDATE
       SET instance_id = EXCLUDED.instance_id,
           release_version = EXCLUDED.release_version,
           status = EXCLUDED.status,
           details = EXCLUDED.details,
           heartbeat_at_utc = now(),
           updated_at_utc = now()`,
    ["replay_preparation_worker", workerId, releaseVersion, status, JSON.stringify(details || {})],
  );
}

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(Math.floor(parsed), maximum));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeError(error) {
  return String(error?.message || error || "unknown error").slice(0, 500);
}
