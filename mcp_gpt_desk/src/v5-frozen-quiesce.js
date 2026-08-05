import { randomUUID } from "node:crypto";

export const V5_FROZEN_HOLD_REASON = "ENGINE_V5_VALIDATION_HOLD";

const TERMINAL_RUN_STATUSES = ["COMPLETED", "DAY_END", "FAILED", "CANCELLED", "CANCELED"];
const TERMINAL_CONFIG_STATUSES = ["ARCHIVED", "COMPLETED", "CANCELLED", "CANCELED"];

export function parseV5FrozenQuiesceArgs(argv = [], env = process.env) {
  const values = new Map();
  const flags = new Set();
  for (const argument of argv) {
    const match = String(argument).match(/^--([a-z-]+)=(.+)$/);
    if (match) values.set(match[1], match[2]);
    else if (/^--[a-z-]+$/.test(String(argument))) flags.add(String(argument).slice(2));
  }
  return {
    releaseVersion: values.get("release-version") || env.DESK_RELEASE_VERSION || "unknown",
    actor: values.get("actor") || "release:v5-frozen-quiesce",
    dryRun: flags.has("dry-run"),
  };
}

export async function quiesceV5FrozenState(pool, {
  actor = "release:v5-frozen-quiesce",
  releaseVersion = process.env.DESK_RELEASE_VERSION || "unknown",
  now = () => new Date(),
  auditId = `v5_freeze_quiesce_${randomUUID()}`,
  dryRun = false,
} = {}) {
  if (!pool?.connect) throw new Error("postgres_pool_required");
  const client = await pool.connect();
  const timestamp = now().toISOString();
  try {
    await client.query("BEGIN");
    const laneResult = await client.query(`
      SELECT document_id, data
      FROM desk_documents
      WHERE collection = 'desk_claim_lane_controls'
        AND document_id IN ('live', 'replay')
      ORDER BY document_id
      FOR UPDATE
    `);
    assertPausedLanes(laneResult.rows || []);

    const workLeases = await client.query(`
        SELECT 'work' AS lease_kind, document_id, data->>'status' AS status,
               NULLIF(data->>'lease_expires_at_utc','')::timestamptz AS lease_expires_at
        FROM desk_documents
        WHERE collection = 'desk_agent_work_items'
          AND upper(COALESCE(data->>'status','')) = 'CLAIMED'
          AND (
            NULLIF(data->>'lease_expires_at_utc','') IS NULL
            OR NULLIF(data->>'lease_expires_at_utc','')::timestamptz > now()
          )
        FOR UPDATE
      `);
    const cursorLeases = await client.query(`
        SELECT 'live_cursor' AS lease_kind, document_id,
               COALESCE(data#>>'{attempt,status}', data->>'cursor_status') AS status,
               NULLIF(data#>>'{attempt,lease_expires_at_utc}','')::timestamptz AS lease_expires_at
        FROM desk_documents
        WHERE collection = 'desk_live_run_cursor'
          AND (
            upper(COALESCE(data->>'cursor_status','')) = 'LEASED'
            OR upper(COALESCE(data#>>'{attempt,status}','')) = 'LEASED'
          )
          AND (
            NULLIF(data#>>'{attempt,lease_expires_at_utc}','') IS NULL
            OR NULLIF(data#>>'{attempt,lease_expires_at_utc}','')::timestamptz > now()
          )
        FOR UPDATE
      `);
    const preparationLeases = await client.query(`
        SELECT 'replay_preparation' AS lease_kind, document_id, data->>'status' AS status,
               NULLIF(data->>'lease_expires_at_utc','')::timestamptz AS lease_expires_at
        FROM desk_documents
        WHERE collection = 'desk_replay_preparation_jobs'
          AND upper(COALESCE(data->>'status','')) IN ('DATA_CHECK','PACK_BUILDING')
          AND (
            NULLIF(data->>'lease_expires_at_utc','') IS NULL
            OR NULLIF(data->>'lease_expires_at_utc','')::timestamptz > now()
          )
        FOR UPDATE
      `);
    const leaseResult = { rows: [
      ...(workLeases.rows || []),
      ...(cursorLeases.rows || []),
      ...(preparationLeases.rows || []),
    ] };
    if ((leaseResult.rows || []).length > 0) {
      const error = new Error("v5_frozen_quiesce_active_lease_refused");
      error.code = "V5_FROZEN_ACTIVE_LEASE_REFUSED";
      error.active_leases = leaseResult.rows;
      throw error;
    }

    const commonAudit = JSON.stringify({
      reason: V5_FROZEN_HOLD_REASON,
      actor,
      release_version: releaseVersion,
      quiesced_at_utc: timestamp,
      safe_cancellation: "READY_OR_EXPIRED_LEASE_ONLY",
    });
    const work = await client.query(`
      UPDATE desk_documents
      SET data = data || jsonb_build_object(
            'status', 'CANCELLED',
            'cancelled_at_utc', $1::timestamptz,
            'cancelled_by', $2::text,
            'cancellation_reason', $3::text,
            'error_code', $3::text,
            'lease_token', NULL,
            'lease_expires_at_utc', NULL,
            'freeze_audit', $4::jsonb
          ),
          updated_at = now()
      WHERE collection = 'desk_agent_work_items'
        AND (
          upper(COALESCE(data->>'status','')) = 'READY'
          OR (
            upper(COALESCE(data->>'status','')) = 'CLAIMED'
            AND NULLIF(data->>'lease_expires_at_utc','')::timestamptz <= now()
          )
        )
    `, [timestamp, actor, V5_FROZEN_HOLD_REASON, commonAudit]);

    const cursors = await client.query(`
      UPDATE desk_documents
      SET data = data || jsonb_build_object(
            'cursor_status', 'IDLE',
            'hold_reason', $2::text,
            'updated_at_utc', $1::timestamptz,
            'attempt', COALESCE(data->'attempt','{}'::jsonb) || jsonb_build_object(
              'status', 'CANCELLED',
              'lease_token', NULL,
              'lease_expires_at_utc', NULL,
              'cancelled_at_utc', $1::timestamptz,
              'cancelled_by', $3::text,
              'cancellation_reason', $2::text
            ),
            'freeze_audit', $4::jsonb
          ),
          updated_at = now()
      WHERE collection = 'desk_live_run_cursor'
        AND (
          upper(COALESCE(data->>'cursor_status','')) = 'LEASED'
          OR upper(COALESCE(data#>>'{attempt,status}','')) = 'LEASED'
        )
        AND NULLIF(data#>>'{attempt,lease_expires_at_utc}','')::timestamptz <= now()
    `, [timestamp, V5_FROZEN_HOLD_REASON, actor, commonAudit]);

    const preparations = await client.query(`
      UPDATE desk_documents
      SET data = data || jsonb_build_object(
            'status', 'CANCELLED',
            'enabled', false,
            'lease_token', NULL,
            'lease_expires_at_utc', NULL,
            'cancelled_at_utc', $1::timestamptz,
            'cancelled_by', $2::text,
            'cancellation_reason', $3::text,
            'freeze_audit', $4::jsonb
          ),
          updated_at = now()
      WHERE collection = 'desk_replay_preparation_jobs'
        AND (
          upper(COALESCE(data->>'status','')) = 'QUEUED'
          OR (
            upper(COALESCE(data->>'status','')) IN ('DATA_CHECK','PACK_BUILDING')
            AND NULLIF(data->>'lease_expires_at_utc','')::timestamptz <= now()
          )
        )
    `, [timestamp, actor, V5_FROZEN_HOLD_REASON, commonAudit]);

    const configs = await client.query(`
      UPDATE desk_documents
      SET data = data || jsonb_build_object(
            'enabled', false,
            'automation_enabled', false,
            'status', CASE
              WHEN upper(COALESCE(data->>'status','')) = ANY($1::text[]) THEN data->>'status'
              ELSE 'PAUSED'
            END,
            'hold_reason', $2::text,
            'updated_at_utc', $3::timestamptz,
            'freeze_audit', $4::jsonb
          ),
          updated_at = now()
      WHERE collection = 'desk_replay_autopilot_configs'
        AND upper(COALESCE(data->>'status','')) <> ALL($1::text[])
    `, [TERMINAL_CONFIG_STATUSES, V5_FROZEN_HOLD_REASON, timestamp, commonAudit]);

    const runs = await client.query(`
      UPDATE desk_documents
      SET data = data || jsonb_build_object(
            'automation_enabled', false,
            'hold_reason', $2::text,
            'updated_at_utc', $3::timestamptz,
            'freeze_audit', $4::jsonb
          ),
          updated_at = now()
      WHERE collection = 'desk_replay_runs'
        AND upper(COALESCE(data->>'status','')) <> ALL($1::text[])
    `, [TERMINAL_RUN_STATUSES, V5_FROZEN_HOLD_REASON, timestamp, commonAudit]);

    const lanes = await client.query(`
      UPDATE desk_documents
      SET data = data || jsonb_build_object(
            'enabled', false,
            'status', 'PAUSED',
            'reason', $1::text,
            'changed_by', $2::text,
            'revision', COALESCE((data->>'revision')::integer, 0) + 1,
            'updated_at_utc', $3::timestamptz,
            'freeze_audit', $4::jsonb
          ),
          updated_at = now()
      WHERE collection = 'desk_claim_lane_controls'
        AND document_id IN ('live', 'replay')
    `, [V5_FROZEN_HOLD_REASON, actor, timestamp, commonAudit]);

    const brokerLock = await client.query(`
      INSERT INTO broker_execution_locks (
        execution_lock_id, scope_type, scope_value, locked, reason, set_by,
        set_at, expires_at, metadata
      ) VALUES (
        'global_default_kill_switch', 'global', '*', true, $1::text, $2::text, $3::timestamptz, NULL, $4::jsonb
      )
      ON CONFLICT (scope_type, scope_value) DO UPDATE
      SET locked = true,
          reason = EXCLUDED.reason,
          set_by = EXCLUDED.set_by,
          set_at = EXCLUDED.set_at,
          expires_at = NULL,
          metadata = COALESCE(broker_execution_locks.metadata, '{}'::jsonb) || EXCLUDED.metadata
    `, [V5_FROZEN_HOLD_REASON, actor, timestamp, commonAudit]);

    const summary = {
      work_items_cancelled: work.rowCount || 0,
      live_cursors_reconciled: cursors.rowCount || 0,
      replay_preparations_cancelled: preparations.rowCount || 0,
      replay_configs_disabled: configs.rowCount || 0,
      replay_runs_disabled: runs.rowCount || 0,
      lane_controls_updated: lanes.rowCount || 0,
      broker_lock_asserted: (brokerLock.rowCount || 0) > 0,
    };
    const audit = {
      audit_id: auditId,
      schema_version: "desk_v5_frozen_quiesce_audit_v1",
      event_type: "ENGINE_V5_VALIDATION_HOLD_APPLIED",
      status: "COMPLETED",
      reason: V5_FROZEN_HOLD_REASON,
      actor,
      release_version: releaseVersion,
      created_at_utc: timestamp,
      summary,
    };
    await client.query(`
      INSERT INTO desk_documents(collection, document_id, data)
      VALUES ('desk_audit_logs', $1::text, $2::jsonb)
      ON CONFLICT(collection, document_id) DO NOTHING
    `, [auditId, JSON.stringify(audit)]);
    if (dryRun) await client.query("ROLLBACK");
    else await client.query("COMMIT");
    return { ok: true, dry_run: dryRun, audit, summary };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function assertPausedLanes(rows) {
  const controls = new Map(rows.map((row) => [row.document_id, row.data || {}]));
  const violations = [];
  for (const lane of ["live", "replay"]) {
    const control = controls.get(lane);
    if (!control || control.enabled !== false || String(control.status || "").toUpperCase() !== "PAUSED") {
      violations.push(lane);
    }
  }
  if (violations.length > 0) {
    const error = new Error(`v5_frozen_lanes_must_be_paused:${violations.join(",")}`);
    error.code = "V5_FROZEN_LANES_NOT_PAUSED";
    error.lanes = violations;
    throw error;
  }
}
