#!/usr/bin/env node
import process from "node:process";
import { randomUUID } from "node:crypto";
import { createDeskStoreFromEnv } from "../src/store.js";

const store = createDeskStoreFromEnv();
const pool = store.persistence.pool;
const runId = `maintenance__${new Date().toISOString().replaceAll(/[-:.]/g, "")}__${randomUUID().slice(0, 8)}`;
const policy = Object.freeze({
  tradingview_events_days: boundedDays(process.env.DESK_RETENTION_TRADINGVIEW_DAYS, 30, 7, 365),
  addon_snapshots_days: boundedDays(process.env.DESK_RETENTION_ADDON_SNAPSHOTS_DAYS, 14, 3, 180),
  addon_events_days: boundedDays(process.env.DESK_RETENTION_ADDON_EVENTS_DAYS, 90, 30, 730),
  parity_runs_days: boundedDays(process.env.DESK_RETENTION_PARITY_RUNS_DAYS, 30, 7, 365),
  reconciliation_runs_days: boundedDays(process.env.DESK_RETENTION_RECONCILIATION_RUNS_DAYS, 90, 30, 730),
  transient_document_days: boundedDays(process.env.DESK_RETENTION_TRANSIENT_DOCUMENT_DAYS, 90, 30, 730),
});
let lockClient;

try {
  await store.persistence.initialized;
  lockClient = await pool.connect();
  const lock = await lockClient.query(
    "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
    ["desk:runtime-maintenance"],
  );
  if (!lock.rows[0]?.acquired) {
    process.stdout.write(`${JSON.stringify({ ok: true, status: "already_running" })}\n`);
    process.exitCode = 0;
  } else {
    await pool.query(
      `INSERT INTO desk_maintenance_runs (
         maintenance_run_id, status, policy, started_at_utc
       ) VALUES ($1, 'running', $2::jsonb, now())`,
      [runId, JSON.stringify(policy)],
    );
    const deleted = {};
    try {
      deleted.tradingview_events = await remove(
        `DELETE FROM tradingview_events
         WHERE COALESCE(received_at, imported_at) < now() - ($1::integer * interval '1 day')`,
        policy.tradingview_events_days,
      );
      deleted.broker_addon_snapshots = await remove(
        `DELETE FROM broker_addon_snapshots
         WHERE captured_at < now() - ($1::integer * interval '1 day')`,
        policy.addon_snapshots_days,
      );
      deleted.broker_addon_events = await remove(
        `DELETE FROM broker_addon_events
         WHERE received_at < now() - ($1::integer * interval '1 day')`,
        policy.addon_events_days,
      );
      deleted.broker_adapter_parity_runs = await remove(
        `DELETE FROM broker_adapter_parity_runs
         WHERE compared_at < now() - ($1::integer * interval '1 day')`,
        policy.parity_runs_days,
      );
      deleted.broker_reconciliation_runs = await remove(
        `DELETE FROM broker_reconciliation_runs
         WHERE started_at < now() - ($1::integer * interval '1 day')`,
        policy.reconciliation_runs_days,
      );
      deleted.transient_documents = await remove(
        `DELETE FROM desk_documents
         WHERE collection = ANY($1::text[])
           AND updated_at < now() - ($2::integer * interval '1 day')`,
        [
          "tradingview_webhook_events",
          "desk_notification_outbox",
          "desk_agent_work_events",
        ],
        policy.transient_document_days,
      );
      const storage = await storageSnapshot();
      await pool.query(
        `UPDATE desk_maintenance_runs
         SET status = 'completed',
             deleted_counts = $2::jsonb,
             storage_snapshot = $3::jsonb,
             completed_at_utc = now()
         WHERE maintenance_run_id = $1`,
        [runId, JSON.stringify(deleted), JSON.stringify(storage)],
      );
      await pool.query("ANALYZE");
      process.stdout.write(`${JSON.stringify({
        ok: true,
        status: "completed",
        maintenance_run_id: runId,
        deleted_counts: deleted,
        storage_snapshot: storage,
      }, null, 2)}\n`);
    } catch (error) {
      await pool.query(
        `UPDATE desk_maintenance_runs
         SET status = 'failed', error = $2, completed_at_utc = now()
         WHERE maintenance_run_id = $1`,
        [runId, safeError(error)],
      ).catch(() => undefined);
      throw error;
    }
  }
} finally {
  if (lockClient) {
    await lockClient.query(
      "SELECT pg_advisory_unlock(hashtext($1))",
      ["desk:runtime-maintenance"],
    ).catch(() => undefined);
    lockClient.release();
  }
  await store.persistence.close?.();
}

async function remove(sql, ...parameters) {
  const result = await pool.query(sql, parameters);
  return Number(result.rowCount || 0);
}

async function storageSnapshot() {
  const result = await pool.query(
    `SELECT pg_database_size(current_database())::bigint AS database_size_bytes,
            (SELECT count(*) FROM desk_documents)::bigint AS document_count,
            (SELECT count(*) FROM desk_pack_objects)::bigint AS object_count,
            (SELECT COALESCE(sum(size_bytes), 0) FROM desk_pack_objects)::bigint AS object_catalog_size_bytes`,
  );
  const row = result.rows[0] || {};
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value || 0)]));
}

function boundedDays(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.floor(parsed))) : fallback;
}

function safeError(error) {
  return String(error?.message || error || "unknown error").slice(0, 1_000);
}
