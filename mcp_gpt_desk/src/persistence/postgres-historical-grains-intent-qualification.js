import { canonicalSha256 } from "@tv-automation/desk-domain";

export function createPostgresHistoricalGrainsIntentQualification(pool) {
  return { execute: (options, work) => execute(pool, options, work) };
}

async function execute(pool, { mode, batchId }, work) {
  const client = await pool.connect();
  try {
    await client.query(mode === "APPLY" ? "BEGIN" : "BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout='30s'");
    if (mode === "APPLY") await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`historical_intent_qualification:${batchId}`]);
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
    findApplied: (key) => one(client, "SELECT * FROM portfolio_historical_intent_qualifications WHERE idempotency_key=$1", [key]),
    loadCandidate: (specification) => loadCandidate(client, specification, mode),
    appendQualification: (command) => appendQualification(client, command),
  };
}

async function loadCandidate(client, specification, mode) {
  const lock = mode === "APPLY" ? " FOR UPDATE OF lineage" : "";
  return one(client, `SELECT lineage.portfolio_order_intent_id,lineage.target_position_id,
      lineage.status AS lineage_status,lineage.payload_hash AS lineage_payload_hash,
      lineage.payload #>> '{approved_trade_plan,entry,price}' AS intent_entry_price,
      lineage.payload #>> '{approved_trade_plan,economics,availability}' AS intent_economics_availability,
      target.payload_hash AS target_payload_hash,target.approved_trade_plan #>> '{entry,price}' AS target_entry_price,
      target.approved_trade_plan #>> '{economics,availability}' AS target_economics_availability,
      $2::text AS source_signal_id,signal.payload_hash AS signal_payload_hash,
      COALESCE(signal.payload #>> '{entry,price}',signal.payload #>> '{signal,entry,price}') AS signal_entry_price,
      COALESCE(qualification.previous_revision,0)::integer AS previous_revision,
      COALESCE(execution.provider_command_count,0)::integer AS provider_command_count,
      COALESCE(execution.provider_event_count,0)::integer AS provider_event_count,
      COALESCE(execution.trade_count,0)::integer AS trade_count,
      COALESCE(execution.fill_count,0)::integer AS fill_count,
      COALESCE(theoretical.event_count,0)::integer AS theoretical_event_count,
      COALESCE(theoretical.unproven_expiry_count,0)::integer AS unproven_expiry_count
    FROM portfolio_order_intent_lineage lineage
    JOIN portfolio_target_positions target ON target.target_position_id=lineage.target_position_id
    LEFT JOIN strategy_signal_outbox signal ON signal.signal_id::text=$2
    LEFT JOIN LATERAL (SELECT max(revision)::integer AS previous_revision
      FROM portfolio_historical_intent_qualifications q
      WHERE q.portfolio_order_intent_id=lineage.portfolio_order_intent_id) qualification ON true
    LEFT JOIN LATERAL (SELECT
      (SELECT count(*) FROM broker_provider_commands c WHERE c.portfolio_order_intent_id=lineage.portfolio_order_intent_id) AS provider_command_count,
      (SELECT count(*) FROM broker_provider_events e WHERE e.portfolio_order_intent_id=lineage.portfolio_order_intent_id) AS provider_event_count,
      (SELECT count(*) FROM trades t WHERE t.portfolio_order_intent_id=lineage.portfolio_order_intent_id) AS trade_count,
      (SELECT count(*) FROM trade_fills f JOIN trades t ON t.trade_id=f.trade_id WHERE t.portfolio_order_intent_id=lineage.portfolio_order_intent_id) AS fill_count
    ) execution ON true
    LEFT JOIN LATERAL (SELECT count(*) AS event_count,count(*) FILTER (WHERE event_type='entry_expired'
        AND source_candle_timestamp_utc IS NULL) AS unproven_expiry_count
      FROM trade_theoretical_execution_events event
      WHERE event.portfolio_order_intent_id=lineage.portfolio_order_intent_id) theoretical ON true
    WHERE lineage.portfolio_order_intent_id=$1${lock}`,
  [specification.portfolio_order_intent_id, specification.source_signal_id]);
}

async function appendQualification(client, command) {
  const revision = Number(command.candidate.previous_revision) + 1;
  const id = `historical_intent_qualification_${canonicalSha256({
    idempotency_key: command.specification.idempotency_key, revision,
  }).slice(0, 24)}`;
  const evidence = {
    schema_version: "historical_intent_qualification_evidence_v1",
    entry_price: { intent: null, target: null, source_signal: null },
    economics_availability: "UNAVAILABLE",
    provider_command_count: 0,
    provider_event_count: 0,
    trade_count: 0,
    fill_count: 0,
    theoretical_event_count: Number(command.candidate.theoretical_event_count),
    unproven_expiry_count: Number(command.candidate.unproven_expiry_count),
  };
  return one(client, `INSERT INTO portfolio_historical_intent_qualifications (
      historical_intent_qualification_id,idempotency_key,portfolio_order_intent_id,revision,
      expected_previous_revision,expected_lineage_payload_hash,expected_target_payload_hash,
      expected_signal_payload_hash,origin_classification,reconstruction_status,provider_evidence_status,
      reservation_disposition,qualified_at_utc,qualified_by,qualification_reason,manifest_hash,evidence
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'INVALID_ORIGIN_PLAN','UNQUALIFIABLE','ABSENT','RETAINED',
      $9,$10,$11,$12,$13::jsonb) RETURNING *`, [id, command.specification.idempotency_key,
    command.specification.portfolio_order_intent_id, revision, command.specification.expected_previous_revision,
    command.specification.expected_lineage_payload_hash, command.specification.expected_target_payload_hash,
    command.specification.expected_signal_payload_hash, command.qualifiedAtUtc, command.qualifiedBy,
    command.reason, command.manifestHash, JSON.stringify(evidence)]);
}

async function one(client, sql, values = []) { return (await client.query(sql, values)).rows[0] || null; }
