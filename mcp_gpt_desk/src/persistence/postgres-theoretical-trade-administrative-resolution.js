import { canonicalSha256 } from "@tv-automation/desk-domain";

const RESOLUTION_FIELDS = `trade_id,portfolio_order_intent_id,expected_trade_revision,
  expected_trade_status,expected_quantity_open,expected_lineage_payload_hash,status,
  exposure_disposition,historical_outcome_disposition,effective_at_utc,resolved_by,
  resolution_reason,operator_attestation_hash,operator_attestation,manifest_hash`;

const LOAD_CANDIDATE_SQL = `SELECT t.trade_id,t.portfolio_order_intent_id,
    t.revision AS current_trade_revision,t.status::text AS current_trade_status,
    t.quantity_open AS current_quantity_open,t.created_at AS trade_created_at,
    t.raw->>'source' AS trade_source,
    COALESCE((t.raw->>'theoretical_review_required')::boolean,false) AS theoretical_review_required,
    lineage.payload_hash AS current_lineage_payload_hash,
    (SELECT count(*) FROM broker_provider_commands command
      WHERE command.portfolio_order_intent_id=t.portfolio_order_intent_id)::integer AS provider_command_count,
    (SELECT count(*) FROM broker_provider_events event
      WHERE event.portfolio_order_intent_id=t.portfolio_order_intent_id)::integer AS provider_event_count,
    (SELECT count(*) FROM broker_orders broker_order
      WHERE t.order_intent_id IS NOT NULL AND broker_order.order_intent_id=t.order_intent_id)::integer AS broker_order_count,
    (SELECT count(*) FROM broker_order_events event JOIN broker_orders broker_order
      ON broker_order.broker_order_id=event.broker_order_id
      WHERE t.order_intent_id IS NOT NULL AND broker_order.order_intent_id=t.order_intent_id)::integer AS broker_order_event_count,
    (SELECT count(*) FROM trade_manual_execution_events manual
      WHERE manual.trade_id=t.trade_id OR manual.portfolio_order_intent_id=t.portfolio_order_intent_id)::integer AS manual_execution_event_count,
    (SELECT count(*) FROM trade_fills fill WHERE fill.trade_id=t.trade_id
      AND (fill.broker_order_id IS NOT NULL
        OR COALESCE(fill.raw->>'source','') <> 'theoretical_execution_engine'))::integer AS physical_fill_count,
    (SELECT count(*) FROM trade_fills fill WHERE fill.trade_id=t.trade_id
      AND fill.broker_order_id IS NULL
      AND fill.raw->>'source' = 'theoretical_execution_engine')::integer AS theoretical_fill_count,
    (SELECT count(*) FROM trade_theoretical_execution_events event
      WHERE event.trade_id=t.trade_id AND event.event_type='entry_filled')::integer AS theoretical_entry_fill_count,
    (SELECT count(*) FROM trade_theoretical_execution_events event
      WHERE event.trade_id=t.trade_id AND event.event_type='exit_review_required')::integer AS theoretical_review_count,
    (SELECT count(*) FROM trade_theoretical_execution_events event
      WHERE event.trade_id=t.trade_id AND event.event_type NOT IN ('entry_filled','exit_review_required'))::integer AS other_theoretical_event_count,
    (SELECT count(*) FROM trade_outcomes outcome WHERE outcome.trade_id=t.trade_id)::integer AS outcome_count,
    ((SELECT count(*) FROM broker_provider_events event
       WHERE event.portfolio_order_intent_id=t.portfolio_order_intent_id
         AND NULLIF(event.provider_order_ref,'') IS NOT NULL)
      + (SELECT count(*) FROM trade_fills fill WHERE fill.trade_id=t.trade_id
         AND fill.broker_order_id IS NOT NULL AND NULLIF(fill.broker_fill_ref,'') IS NOT NULL))::integer
      AS physical_third_party_reference_count
  FROM trades t
  JOIN portfolio_order_intent_lineage lineage
    ON lineage.portfolio_order_intent_id=t.portfolio_order_intent_id
  WHERE t.trade_id=$1 AND t.portfolio_order_intent_id=$2`;

export function createPostgresTheoreticalTradeAdministrativeResolution(pool) {
  return { execute: (options, work) => execute(pool, options, work) };
}

async function execute(pool, { mode, batchId }, work) {
  const client = await pool.connect();
  try {
    await client.query(mode === "APPLY" ? "BEGIN" : "BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout='30s'");
    if (mode === "APPLY") {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",
        [`theoretical_trade_administrative_resolution:${batchId}`]);
    }
    const value = await work(transaction(client, mode));
    await client.query(mode === "APPLY" ? "COMMIT" : "ROLLBACK");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

function transaction(client, mode) {
  return {
    findApplied: (key) => one(client, `SELECT ${RESOLUTION_FIELDS}
      FROM trade_theoretical_administrative_resolutions WHERE idempotency_key=$1`, [key]),
    loadCandidate: (specification) => loadCandidate(client, specification, mode),
    appendResolution: (command) => appendResolution(client, command),
  };
}

async function loadCandidate(client, specification, mode) {
  if (mode === "APPLY") {
    await client.query("SELECT portfolio_order_intent_id FROM portfolio_order_intent_lineage WHERE portfolio_order_intent_id=$1 FOR UPDATE",
      [specification.portfolio_order_intent_id]);
    await client.query("SELECT trade_id FROM trades WHERE trade_id=$1 FOR UPDATE", [specification.trade_id]);
  }
  return one(client, LOAD_CANDIDATE_SQL,
    [specification.trade_id, specification.portfolio_order_intent_id]);
}

async function appendResolution(client, command) {
  const id = `theoretical_trade_admin_resolution_${canonicalSha256({
    idempotency_key: command.specification.idempotency_key,
  }).slice(0, 24)}`;
  const evidence = evidenceSnapshot(command.candidate);
  return one(client, `INSERT INTO trade_theoretical_administrative_resolutions (
      theoretical_trade_administrative_resolution_id,idempotency_key,trade_id,
      portfolio_order_intent_id,expected_trade_revision,expected_trade_status,
      expected_quantity_open,expected_lineage_payload_hash,status,exposure_disposition,
      historical_outcome_disposition,effective_at_utc,resolved_by,resolution_reason,
      operator_attestation,operator_attestation_hash,manifest_hash,evidence
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ADMINISTRATIVELY_RESOLVED_NO_REAL_EXPOSURE',
      'ADMINISTRATIVELY_RELEASED','UNDETERMINED_PRESERVED',$9,$10,$11,$12::jsonb,$13,$14,$15::jsonb)
    RETURNING ${RESOLUTION_FIELDS}`,
  [id, command.specification.idempotency_key, command.specification.trade_id,
    command.specification.portfolio_order_intent_id, command.specification.expected_trade_revision,
    command.specification.expected_trade_status, command.specification.expected_quantity_open,
    command.specification.expected_lineage_payload_hash, command.command.effectiveAtUtc,
    command.command.actor, command.command.reason, JSON.stringify(command.command.operatorAttestation),
    command.attestationHash, command.manifestHash, JSON.stringify(evidence)]);
}

function evidenceSnapshot(candidate) {
  return { schema_version: "theoretical_trade_administrative_resolution_evidence_v1",
    provider_command_count: Number(candidate.provider_command_count),
    provider_event_count: Number(candidate.provider_event_count),
    broker_order_count: Number(candidate.broker_order_count),
    broker_order_event_count: Number(candidate.broker_order_event_count),
    manual_execution_event_count: Number(candidate.manual_execution_event_count),
    physical_fill_count: Number(candidate.physical_fill_count),
    theoretical_fill_count: Number(candidate.theoretical_fill_count),
    theoretical_entry_fill_count: Number(candidate.theoretical_entry_fill_count),
    theoretical_review_count: Number(candidate.theoretical_review_count),
    other_theoretical_event_count: Number(candidate.other_theoretical_event_count),
    outcome_count: Number(candidate.outcome_count),
    physical_third_party_reference_count: Number(candidate.physical_third_party_reference_count),
    market_execution_effect: "NONE" };
}

async function one(client, sql, values = []) {
  return (await client.query(sql, values)).rows[0] || null;
}
