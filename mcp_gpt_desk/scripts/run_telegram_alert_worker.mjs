#!/usr/bin/env node
import process from "node:process";
import { createDeskStoreFromEnv } from "../src/store.js";
import { TelegramAlertService } from "../src/telegram-alert-service.js";

const once = process.argv.includes("--once");
const store = createDeskStoreFromEnv();
const service = new TelegramAlertService({ persistence: store.persistence, clock: store.clock });
const instanceId = String(process.env.DESK_SERVICE_INSTANCE_ID || `telegram-alert-${process.pid}`);
const releaseVersion = String(process.env.DESK_RELEASE_VERSION || "unversioned");
let stopped = false;
let lockClient = null;

process.on("SIGINT", () => { stopped = true; });
process.on("SIGTERM", () => { stopped = true; });

try {
  await store.persistence.initialized;
  lockClient = await store.persistence.pool.connect();
  const lock = await lockClient.query("SELECT pg_try_advisory_lock(hashtext($1)) AS acquired", ["desk:telegram-alert-worker"]);
  if (!lock.rows[0]?.acquired) throw new Error("TELEGRAM_ALERT_WORKER_ALREADY_RUNNING");
  await service.recoverInterruptedDeliveries();
  await heartbeat("starting", { environment: service.envStatus() });
  await service.identifyBots().catch((error) => heartbeat("degraded", { phase: "identify_bots", error: safeError(error) }));

  do {
    const cycle = { synced: null, deliveries: [], commands: null };
    try {
      cycle.synced = await service.syncSources();
      for (let index = 0; index < 20; index += 1) {
        const delivery = await service.deliverNext();
        cycle.deliveries.push(delivery);
        if (["idle", "disabled", "disabled_by_environment", "muted"].includes(delivery.status)) break;
      }
      cycle.commands = await service.pollAdminCommands().catch((error) => ({ status: "degraded", error: safeError(error) }));
      await heartbeat("healthy", cycle);
      if (once) break;
      await delay(service.pollMs);
    } catch (error) {
      await heartbeat("degraded", { ...cycle, error: safeError(error) }).catch(() => undefined);
      if (once) throw error;
      await delay(Math.max(service.pollMs, 5000));
    }
  } while (!stopped);
} finally {
  await heartbeat("stopping", {}).catch(() => undefined);
  if (lockClient) {
    await lockClient.query("SELECT pg_advisory_unlock(hashtext($1))", ["desk:telegram-alert-worker"]).catch(() => undefined);
    lockClient.release();
  }
  await store.persistence.close?.();
}

async function heartbeat(status, details) {
  await store.persistence.pool.query(
    `INSERT INTO desk_service_heartbeats (
       service_id, service_kind, instance_id, release_version, status, details,
       started_at_utc, heartbeat_at_utc, updated_at_utc
     ) VALUES ($1, 'telegram_alerting', $2, $3, $4, $5::jsonb, now(), now(), now())
     ON CONFLICT (service_id) DO UPDATE
       SET instance_id = EXCLUDED.instance_id,
           release_version = EXCLUDED.release_version,
           status = EXCLUDED.status,
           details = EXCLUDED.details,
           heartbeat_at_utc = now(),
           updated_at_utc = now()`,
    ["telegram_alert_worker", instanceId, releaseVersion, status, JSON.stringify(details || {})],
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeError(error) {
  return String(error?.message || error || "unknown error")
    .replace(/bot[0-9]+:[A-Za-z0-9_-]+/g, "bot[redacted]")
    .slice(0, 500);
}
