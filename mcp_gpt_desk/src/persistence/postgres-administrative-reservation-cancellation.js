import { canonicalSha256 } from "@tv-automation/desk-domain";

const CANCELLATION_FIELDS = `portfolio_order_intent_id,manifest_hash,revision,
  expected_previous_revision,expected_lineage_payload_hash,expected_lineage_status,status,reservation_disposition,
  historical_outcome_disposition,effective_at_utc,cancelled_by,cancellation_reason,
  operator_attestation_hash,operator_attestation`;

const LOAD_CANDIDATE_SQL = `SELECT lineage.portfolio_order_intent_id,
    lineage.status AS current_lineage_status,lineage.payload_hash AS current_lineage_payload_hash,
    lineage.created_at_utc AS lineage_created_at_utc,
    COALESCE(cancellation.previous_revision,0)::integer AS previous_revision,
    COALESCE(execution.provider_command_count,0)::integer AS provider_command_count,
    COALESCE(execution.provider_event_count,0)::integer AS provider_event_count,
    COALESCE(execution.broker_order_count,0)::integer AS broker_order_count,
    COALESCE(execution.broker_order_event_count,0)::integer AS broker_order_event_count,
    COALESCE(execution.trade_count,0)::integer AS trade_count,
    COALESCE(execution.fill_count,0)::integer AS fill_count,
    COALESCE(execution.manual_execution_event_count,0)::integer AS manual_execution_event_count,
    COALESCE(execution.theoretical_entry_fill_count,0)::integer AS theoretical_entry_fill_count,
    COALESCE(execution.unexpected_theoretical_event_count,0)::integer AS unexpected_theoretical_event_count,
    COALESCE(execution.third_party_reference_count,0)::integer AS third_party_reference_count,
    COALESCE(state.filled_quantity,0) AS filled_quantity,state.lifecycle_status
  FROM portfolio_order_intent_lineage lineage
  LEFT JOIN portfolio_order_intent_execution_states state
    ON state.portfolio_order_intent_id=lineage.portfolio_order_intent_id
  LEFT JOIN LATERAL (SELECT max(revision)::integer AS previous_revision
    FROM portfolio_administrative_reservation_cancellations prior
    WHERE prior.portfolio_order_intent_id=lineage.portfolio_order_intent_id) cancellation ON true
  LEFT JOIN LATERAL (SELECT
    (SELECT count(*) FROM broker_provider_commands command
      WHERE command.portfolio_order_intent_id=lineage.portfolio_order_intent_id) AS provider_command_count,
    (SELECT count(*) FROM broker_provider_events event
      WHERE event.portfolio_order_intent_id=lineage.portfolio_order_intent_id) AS provider_event_count,
    (SELECT count(*) FROM broker_orders broker_order
      WHERE broker_order.order_intent_id=lineage.trade_order_intent_id) AS broker_order_count,
    (SELECT count(*) FROM broker_order_events event JOIN broker_orders broker_order
      ON broker_order.broker_order_id=event.broker_order_id
      WHERE broker_order.order_intent_id=lineage.trade_order_intent_id) AS broker_order_event_count,
    (SELECT count(*) FROM trades trade WHERE trade.portfolio_order_intent_id=lineage.portfolio_order_intent_id
      OR (lineage.trade_order_intent_id IS NOT NULL AND trade.order_intent_id=lineage.trade_order_intent_id)) AS trade_count,
    (SELECT count(*) FROM trade_fills fill JOIN trades trade ON trade.trade_id=fill.trade_id
      WHERE trade.portfolio_order_intent_id=lineage.portfolio_order_intent_id
        OR (lineage.trade_order_intent_id IS NOT NULL AND trade.order_intent_id=lineage.trade_order_intent_id)) AS fill_count,
    (SELECT count(*) FROM trade_manual_execution_events manual
      WHERE manual.portfolio_order_intent_id=lineage.portfolio_order_intent_id) AS manual_execution_event_count,
    (SELECT count(*) FROM trade_theoretical_execution_events event
      WHERE event.portfolio_order_intent_id=lineage.portfolio_order_intent_id
        AND event.event_type='entry_filled') AS theoretical_entry_fill_count,
    (SELECT count(*) FROM trade_theoretical_execution_events event
      WHERE event.portfolio_order_intent_id=lineage.portfolio_order_intent_id
        AND event.event_type<>'entry_expired') AS unexpected_theoretical_event_count,
    ((CASE WHEN NULLIF(state.provider_order_ref,'') IS NULL THEN 0 ELSE 1 END)
      + (SELECT count(*) FROM broker_provider_events event
        WHERE event.portfolio_order_intent_id=lineage.portfolio_order_intent_id
          AND NULLIF(event.provider_order_ref,'') IS NOT NULL)
      + (SELECT count(*) FROM broker_orders broker_order
        WHERE broker_order.order_intent_id=lineage.trade_order_intent_id
          AND NULLIF(broker_order.broker_order_ref,'') IS NOT NULL)
      + (SELECT count(*) FROM trade_fills fill JOIN trades trade ON trade.trade_id=fill.trade_id
        WHERE (trade.portfolio_order_intent_id=lineage.portfolio_order_intent_id
          OR (lineage.trade_order_intent_id IS NOT NULL AND trade.order_intent_id=lineage.trade_order_intent_id))
          AND NULLIF(fill.broker_fill_ref,'') IS NOT NULL)) AS third_party_reference_count
  ) execution ON true
  WHERE lineage.portfolio_order_intent_id=$1`;

export function createPostgresAdministrativeReservationCancellation(pool) {
  return { execute: (options, work) => execute(pool, options, work) };
}

async function execute(pool, { mode, batchId }, work) {
  const client = await pool.connect();
  try {
    await client.query(mode === "APPLY" ? "BEGIN" : "BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout='30s'");
    if (mode === "APPLY") {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`administrative_reservation_cancellation:${batchId}`]);
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
    findApplied: (key) => one(client,
      `SELECT ${CANCELLATION_FIELDS} FROM portfolio_administrative_reservation_cancellations
       WHERE idempotency_key=$1`, [key]),
    loadCandidate: (specification) => loadCandidate(client, specification, mode),
    appendCancellation: (command) => appendCancellation(client, command),
  };
}

async function loadCandidate(client, specification, mode) {
  if (mode === "APPLY") await lockCandidateExecutionScope(client, specification.portfolio_order_intent_id);
  return one(client, LOAD_CANDIDATE_SQL, [specification.portfolio_order_intent_id]);
}

async function lockCandidateExecutionScope(client, portfolioOrderIntentId) {
  const lineage = await one(client, `SELECT portfolio_order_intent_id,trade_order_intent_id
    FROM portfolio_order_intent_lineage WHERE portfolio_order_intent_id=$1 FOR UPDATE`,
  [portfolioOrderIntentId]);
  if (!lineage) return;
  await client.query(`SELECT portfolio_order_intent_id FROM portfolio_order_intent_execution_states
    WHERE portfolio_order_intent_id=$1 FOR UPDATE`, [portfolioOrderIntentId]);
  if (lineage.trade_order_intent_id) {
    await client.query("SELECT order_intent_id FROM trade_order_intents WHERE order_intent_id=$1 FOR UPDATE",
      [lineage.trade_order_intent_id]);
  }
}

async function appendCancellation(client, command) {
  const revision = Number(command.candidate.previous_revision) + 1;
  const id = `administrative_reservation_cancellation_${canonicalSha256({
    idempotency_key: command.specification.idempotency_key, revision,
  }).slice(0, 24)}`;
  const evidence = evidenceSnapshot(command.candidate);
  return one(client, `INSERT INTO portfolio_administrative_reservation_cancellations (
      portfolio_administrative_reservation_cancellation_id,idempotency_key,portfolio_order_intent_id,
      revision,expected_previous_revision,expected_lineage_payload_hash,expected_lineage_status,status,
      reservation_disposition,historical_outcome_disposition,effective_at_utc,cancelled_by,
      cancellation_reason,operator_attestation,operator_attestation_hash,manifest_hash,evidence
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,'CANCELLED_ADMINISTRATIVE_NO_OPEN_EXPOSURE',
      'ADMINISTRATIVELY_RELEASED','UNDETERMINED_PRESERVED',$8,$9,$10,$11::jsonb,$12,$13,$14::jsonb)
    RETURNING ${CANCELLATION_FIELDS}`, [id, command.specification.idempotency_key,
    command.specification.portfolio_order_intent_id, revision,
    command.specification.expected_previous_cancellation_revision,
    command.specification.expected_lineage_payload_hash, command.specification.expected_lineage_status,
    command.command.effectiveAtUtc, command.command.actor, command.command.reason,
    JSON.stringify(command.command.operatorAttestation), command.attestationHash, command.manifestHash,
    JSON.stringify(evidence)]);
}

function evidenceSnapshot(candidate) {
  return { schema_version: "portfolio_administrative_reservation_cancellation_evidence_v1",
    provider_command_count: Number(candidate.provider_command_count),
    provider_event_count: Number(candidate.provider_event_count),
    broker_order_count: Number(candidate.broker_order_count),
    broker_order_event_count: Number(candidate.broker_order_event_count),
    trade_count: Number(candidate.trade_count), fill_count: Number(candidate.fill_count),
    manual_execution_event_count: Number(candidate.manual_execution_event_count),
    theoretical_entry_fill_count: Number(candidate.theoretical_entry_fill_count),
    unexpected_theoretical_event_count: Number(candidate.unexpected_theoretical_event_count),
    third_party_reference_count: Number(candidate.third_party_reference_count),
    filled_quantity: Number(candidate.filled_quantity), lifecycle_status: candidate.lifecycle_status || null,
    market_execution_effect: "NONE" };
}

async function one(client, sql, values = []) {
  return (await client.query(sql, values)).rows[0] || null;
}
