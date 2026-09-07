import { canonicalSha256 } from "@tv-automation/desk-domain";

export function createPostgresInvalidOriginIntentAdjudication(pool) {
  return { execute: (options, work) => execute(pool, options, work) };
}

async function execute(pool, { mode, batchId }, work) {
  const client = await pool.connect();
  try {
    await client.query(mode === "APPLY" ? "BEGIN" : "BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout='30s'");
    if (mode === "APPLY") await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`invalid_origin_adjudication:${batchId}`]);
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
    findApplied: (key) => one(client, "SELECT * FROM portfolio_invalid_origin_adjudications WHERE idempotency_key=$1", [key]),
    loadCandidate: (specification) => loadCandidate(client, specification, mode),
    appendAdjudication: (command) => appendAdjudication(client, command),
  };
}

async function loadCandidate(client, specification, mode) {
  const lock = mode === "APPLY" ? " FOR UPDATE OF lineage,qualification" : "";
  return one(client, `SELECT lineage.portfolio_order_intent_id,lineage.status AS current_lineage_status,
      lineage.payload_hash AS current_lineage_payload_hash,
      qualification.historical_intent_qualification_id,qualification.revision AS qualification_revision,
      qualification.expected_lineage_payload_hash,qualification.manifest_hash AS qualification_manifest_hash,
      qualification.origin_classification,qualification.reconstruction_status,
      qualification.provider_evidence_status,
      qualification.reservation_disposition AS qualification_reservation_disposition,
      qualification.qualified_at_utc,
      COALESCE(adjudication.previous_revision,0)::integer AS previous_revision,
      COALESCE(execution.provider_command_count,0)::integer AS provider_command_count,
      COALESCE(execution.provider_event_count,0)::integer AS provider_event_count,
      COALESCE(execution.trade_count,0)::integer AS trade_count,
      COALESCE(execution.fill_count,0)::integer AS fill_count,
      COALESCE(execution.manual_execution_event_count,0)::integer AS manual_execution_event_count,
      COALESCE(execution.third_party_reference_count,0)::integer AS third_party_reference_count,
      COALESCE(state.filled_quantity,0) AS filled_quantity,state.lifecycle_status
    FROM portfolio_order_intent_lineage lineage
    JOIN portfolio_historical_intent_qualifications qualification
      ON qualification.portfolio_order_intent_id=lineage.portfolio_order_intent_id
      AND qualification.idempotency_key=$2
    LEFT JOIN portfolio_order_intent_execution_states state
      ON state.portfolio_order_intent_id=lineage.portfolio_order_intent_id
    LEFT JOIN LATERAL (SELECT max(revision)::integer AS previous_revision
      FROM portfolio_invalid_origin_adjudications prior
      WHERE prior.portfolio_order_intent_id=lineage.portfolio_order_intent_id) adjudication ON true
    LEFT JOIN LATERAL (SELECT
      (SELECT count(*) FROM broker_provider_commands command
        WHERE command.portfolio_order_intent_id=lineage.portfolio_order_intent_id) AS provider_command_count,
      (SELECT count(*) FROM broker_provider_events event
        WHERE event.portfolio_order_intent_id=lineage.portfolio_order_intent_id) AS provider_event_count,
      (SELECT count(*) FROM trades trade
        WHERE trade.portfolio_order_intent_id=lineage.portfolio_order_intent_id) AS trade_count,
      (SELECT count(*) FROM trade_fills fill JOIN trades trade ON trade.trade_id=fill.trade_id
        WHERE trade.portfolio_order_intent_id=lineage.portfolio_order_intent_id) AS fill_count,
      (SELECT count(*) FROM trade_manual_execution_events manual
        WHERE manual.portfolio_order_intent_id=lineage.portfolio_order_intent_id
          AND manual.event_type IN ('placed','filled','modified','closed')) AS manual_execution_event_count,
      ((CASE WHEN NULLIF(state.provider_order_ref,'') IS NULL THEN 0 ELSE 1 END)
        + (SELECT count(*) FROM broker_provider_events event
          WHERE event.portfolio_order_intent_id=lineage.portfolio_order_intent_id
            AND NULLIF(event.provider_order_ref,'') IS NOT NULL)
        + (SELECT count(*) FROM trade_fills fill JOIN trades trade ON trade.trade_id=fill.trade_id
          WHERE trade.portfolio_order_intent_id=lineage.portfolio_order_intent_id
            AND NULLIF(fill.broker_fill_ref,'') IS NOT NULL)) AS third_party_reference_count
    ) execution ON true
    WHERE lineage.portfolio_order_intent_id=$1${lock}`,
  [specification.portfolio_order_intent_id, specification.qualification_idempotency_key]);
}

async function appendAdjudication(client, command) {
  const revision = Number(command.candidate.previous_revision) + 1;
  const id = `invalid_origin_adjudication_${canonicalSha256({
    idempotency_key: command.specification.idempotency_key, revision,
  }).slice(0, 24)}`;
  const evidence = evidenceSnapshot(command.candidate);
  return one(client, `INSERT INTO portfolio_invalid_origin_adjudications (
      portfolio_invalid_origin_adjudication_id,idempotency_key,portfolio_order_intent_id,
      historical_intent_qualification_id,revision,expected_previous_revision,
      expected_qualification_revision,expected_qualification_manifest_hash,status,
      reservation_disposition,effective_at_utc,adjudicated_by,adjudication_reason,
      operator_attestation,operator_attestation_hash,manifest_hash,evidence
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'CANCELLED_INVALID_ORIGIN','ADMINISTRATIVELY_RELEASED',
      $9,$10,$11,$12::jsonb,$13,$14,$15::jsonb) RETURNING *`, [id,
    command.specification.idempotency_key, command.specification.portfolio_order_intent_id,
    command.candidate.historical_intent_qualification_id, revision,
    command.specification.expected_previous_adjudication_revision,
    command.specification.expected_qualification_revision,
    command.specification.expected_qualification_manifest_hash, command.command.effectiveAtUtc,
    command.command.actor, command.command.reason, JSON.stringify(command.command.operatorAttestation),
    command.attestationHash, command.manifestHash, JSON.stringify(evidence)]);
}

function evidenceSnapshot(candidate) {
  return { schema_version: "portfolio_invalid_origin_adjudication_evidence_v1",
    provider_command_count: Number(candidate.provider_command_count),
    provider_event_count: Number(candidate.provider_event_count), trade_count: Number(candidate.trade_count),
    fill_count: Number(candidate.fill_count), manual_execution_event_count: Number(candidate.manual_execution_event_count),
    third_party_reference_count: Number(candidate.third_party_reference_count),
    filled_quantity: Number(candidate.filled_quantity), lifecycle_status: candidate.lifecycle_status || null,
    market_execution_effect: "NONE" };
}

async function one(client, sql, values = []) { return (await client.query(sql, values)).rows[0] || null; }
