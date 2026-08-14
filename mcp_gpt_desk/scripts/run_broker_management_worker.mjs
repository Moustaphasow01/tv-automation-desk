#!/usr/bin/env node
import process from "node:process";
import { createDeskStoreFromEnv } from "../src/store.js";

const once = process.argv.includes("--once");
const intervalMs = Math.max(5_000, Math.min(Number(process.env.DESK_BROKER_MANAGEMENT_POLL_MS) || 15_000, 60_000));
const store = createDeskStoreFromEnv();
const instanceId = String(process.env.DESK_SERVICE_INSTANCE_ID || `broker-management-${process.pid}`);
const releaseVersion = String(process.env.DESK_RELEASE_VERSION || "unversioned");
let stopped = false;
let lockClient = null;

process.on("SIGINT", () => { stopped = true; });
process.on("SIGTERM", () => { stopped = true; });

try {
  await store.persistence.initialized;
  lockClient = await store.persistence.pool.connect();
  const lock = await lockClient.query("SELECT pg_try_advisory_lock(hashtext($1)) AS acquired", ["desk:broker-management-worker"]);
  if (!lock.rows[0]?.acquired) throw new Error("BROKER_MANAGEMENT_WORKER_ALREADY_RUNNING");
  await heartbeat("starting", {});
  do {
    try {
      const entries = await store.execution.processEligiblePositions();
      const theoretical = await store.execution.processTheoreticalExecution({ entryLimit: 200, exitLimit: 200 });
      const management = await store.execution.materializeRecentManagement({ limit: 200 });
      const overview = await store.execution.overview({ limit: 50 });
      const result = {
        ok: entries.ok !== false && theoretical.ok !== false && management.ok !== false,
        status: entries.count || theoretical.materialized || management.count ? "MATERIALIZED" : "NO_ACTIONABLE_WORK",
        entries,
        theoretical,
        management,
        paper_safety: projectPaperSafety(overview),
      };
      console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
      await heartbeat("healthy", { result });
    } catch (error) {
      await heartbeat("degraded", { error: error.message || String(error) }).catch(() => undefined);
      throw error;
    }
    if (once) break;
    await delay(intervalMs);
  } while (!stopped);
} finally {
  await heartbeat("stopping", {}).catch(() => undefined);
  if (lockClient) {
    await lockClient.query("SELECT pg_advisory_unlock(hashtext($1))", ["desk:broker-management-worker"]).catch(() => undefined);
    lockClient.release();
  }
  await store.persistence.close?.();
}

async function heartbeat(status, details) {
  await store.persistence.pool.query(
    `INSERT INTO desk_service_heartbeats (
       service_id, service_kind, instance_id, release_version, status, details,
       started_at_utc, heartbeat_at_utc, updated_at_utc
     ) VALUES ($1, 'broker_management', $2, $3, $4, $5::jsonb, now(), now(), now())
     ON CONFLICT (service_id) DO UPDATE
       SET instance_id = EXCLUDED.instance_id,
           release_version = EXCLUDED.release_version,
           status = EXCLUDED.status,
           details = EXCLUDED.details,
           heartbeat_at_utc = now(),
           updated_at_utc = now()`,
    ["broker_management", instanceId, releaseVersion, status, JSON.stringify(details || {})],
  );
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function projectPaperSafety(overview = {}) {
  const safety = overview.safety || {};
  const startup = overview.ninjaTraderStartup || {};
  const bridges = Array.isArray(overview.bridges) ? overview.bridges : [];
  const snapshots = Array.isArray(overview.addonSnapshots) ? overview.addonSnapshots : [];
  const addonBridge = bridges.find((item) => item?.adapter_kind === "addon") || null;
  const latestSnapshot = snapshots.reduce((latest, candidate) => (
    !latest || Date.parse(candidate?.captured_at || "") > Date.parse(latest?.captured_at || "") ? candidate : latest
  ), null);
  const accountName = String(latestSnapshot?.account_name || addonBridge?.account_name || "").trim();
  const sim101Account = /^Sim\d*$/i.test(accountName);
  return {
    execution_enabled: safety.executionEnabled === true,
    bridge_mode: safety.bridgeMode || null,
    kill_switch_released: safety.killSwitchEnv === false && safety.databaseLocked !== true,
    max_contracts: Number(safety.maxContracts || 0),
    execution_authority_mode: safety.executionAuthorityMode || null,
    manual_telegram_execution_enabled: safety.manualTelegramExecutionEnabled === true,
    entry_operator_approval_required: safety.entryOperatorApprovalRequired ?? null,
    submission_possible: safety.submissionPossible === true,
    live_account_allowed: safety.liveAccountAllowed === true,
    addon_bridge_status: addonBridge?.status || null,
    addon_heartbeat_fresh: startup.addonHeartbeatFresh === true,
    addon_connected: startup.addonConnected === true,
    connection_ready: startup.connectionReady === true,
    command_enabled: addonBridge?.command_enabled === true,
    account_name: accountName || null,
    sim101_account: sim101Account,
  };
}
