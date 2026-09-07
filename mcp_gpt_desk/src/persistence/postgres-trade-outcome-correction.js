import { canonicalSha256 } from "@tv-automation/desk-domain";
import { materializeTradeOutcome } from "../broker-trade-outcome-repository.js";

export function createPostgresTradeOutcomeCorrection(pool) {
  return {
    execute: (options, work) => execute(pool, options, work),
  };
}

async function execute(pool, { mode, batchId }, work) {
  const client = await pool.connect();
  try {
    await client.query(mode === "APPLY" ? "BEGIN" : "BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout='30s'");
    if (mode === "APPLY") {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`trade_outcome_correction:${batchId}`]);
    }
    const result = await work(transaction(client, mode));
    await client.query(mode === "APPLY" ? "COMMIT" : "ROLLBACK");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function transaction(client, mode) {
  return {
    findApplied: (idempotencyKey) => findApplied(client, idempotencyKey),
    loadCandidate: (specification) => loadCandidate(client, specification, mode),
    appendCorrection: (command) => appendCorrection(client, command),
  };
}

async function findApplied(client, idempotencyKey) {
  return one(client, `SELECT e.*, o.status AS corrected_status, o.revision AS corrected_revision,
      o.evidence_hash AS corrected_evidence_hash, o.evidence AS corrected_evidence,
      o.net_realized_pnl AS corrected_net_realized_pnl
    FROM trade_outcome_correction_events e
    JOIN trade_outcomes o ON o.trade_outcome_id = e.corrected_trade_outcome_id
    WHERE e.idempotency_key = $1`, [idempotencyKey]);
}

async function loadCandidate(client, specification, mode) {
  const lock = mode === "APPLY" ? " FOR UPDATE OF t, o" : "";
  const candidate = await one(client, `SELECT
      t.trade_id, t.portfolio_order_intent_id, t.status AS trade_status, t.side,
      t.quantity_planned, t.avg_entry_price, t.initial_stop_price, t.closed_at,
      t.raw->>'source' AS trade_source,
      t.raw #>> '{execution_units,point_value}' AS execution_point_value,
      o.trade_outcome_id, o.revision, o.status AS outcome_status, o.evidence_hash,
      o.evidence, o.finalized_at_utc, o.net_realized_pnl, o.result_r,
      l.payload #>> '{approved_trade_plan,economics,units,point_value}' AS intent_economics_point_value,
      l.payload #>> '{approved_trade_plan,units,point_value}' AS intent_point_value,
      p.approved_trade_plan #>> '{economics,units,point_value}' AS target_economics_point_value,
      p.approved_trade_plan #>> '{units,point_value}' AS target_point_value
    FROM trades t
    JOIN trade_outcomes o ON o.trade_id = t.trade_id AND o.status = 'final'
    LEFT JOIN portfolio_order_intent_lineage l
      ON l.portfolio_order_intent_id = t.portfolio_order_intent_id
    LEFT JOIN portfolio_target_positions p ON p.target_position_id = l.target_position_id
    WHERE t.trade_id = $1${lock}`, [specification.trade_id]);
  if (!candidate) return null;
  candidate.fills = await rows(client, `SELECT trade_fill_id, broker_fill_ref, side,
      quantity, price, commission, filled_at
    FROM trade_fills WHERE trade_id = $1
    ORDER BY filled_at ASC, trade_fill_id ASC`, [specification.trade_id]);
  return candidate;
}

async function appendCorrection(client, command) {
  await materializeTradeOutcome(
    client,
    command.specification.trade_id,
    command.correctionKnownAtUtc,
    { finalizedAt: command.economicFinalizedAtUtc },
  );
  const corrected = await one(client, `SELECT * FROM trade_outcomes
    WHERE trade_id = $1 AND status = 'final'`, [command.specification.trade_id]);
  if (!corrected) throw correctionError("CORRECTED_OUTCOME_MISSING");
  const eventId = `trade_outcome_correction_${canonicalSha256({
    idempotency_key: command.specification.idempotency_key,
    corrected_trade_outcome_id: corrected.trade_outcome_id,
  }).slice(0, 24)}`;
  const payload = {
    schema_version: "trade_outcome_correction_event_v1",
    previous: compactOutcome(command.candidate),
    corrected: compactOutcome(corrected),
    manifest_id: command.manifestId,
  };
  await client.query(`INSERT INTO trade_outcome_correction_events (
      trade_outcome_correction_event_id, idempotency_key, trade_id,
      previous_trade_outcome_id, corrected_trade_outcome_id,
      expected_previous_revision, expected_previous_evidence_hash,
      canonical_point_value, economic_finalized_at_utc, correction_known_at_utc,
      correction_reason, corrected_by, manifest_hash, payload
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`, [
    eventId,
    command.specification.idempotency_key,
    command.specification.trade_id,
    command.candidate.trade_outcome_id,
    corrected.trade_outcome_id,
    command.specification.expected_revision,
    command.specification.expected_evidence_hash,
    command.specification.canonical_point_value,
    command.economicFinalizedAtUtc,
    command.correctionKnownAtUtc,
    command.reason,
    command.correctedBy,
    command.manifestHash,
    JSON.stringify(payload),
  ]);
  return corrected;
}

function compactOutcome(outcome) {
  return {
    trade_outcome_id: outcome.trade_outcome_id,
    revision: Number(outcome.revision),
    status: outcome.outcome_status || outcome.status,
    evidence_hash: outcome.evidence_hash,
    point_value: Number(outcome.evidence?.point_value),
    net_realized_pnl: Number(outcome.net_realized_pnl),
    finalized_at_utc: outcome.finalized_at_utc,
  };
}

function correctionError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function rows(client, sql, values = []) { return (await client.query(sql, values)).rows; }
async function one(client, sql, values = []) { return (await client.query(sql, values)).rows[0] || null; }
