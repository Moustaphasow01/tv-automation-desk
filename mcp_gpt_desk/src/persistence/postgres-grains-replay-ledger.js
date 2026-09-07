// Read projection for an isolated replay; no inferred business results.
export async function loadGrainsReplayLedger(pool) {
  const result = {};
  for (const [name, sql] of Object.entries(QUERIES)) result[name] = (await pool.query(sql)).rows;
  result.intents = result.intents.map(replayIntentTimestamps).sort(compareIntentCausalTime);
  result.provider_commands = Number(result.provider_commands[0].count);
  return result;
}

function replayIntentTimestamps(row) {
  const supplied = String(row.supplied_requested_at_utc ?? "").trim();
  const requestedAt = supplied ? iso(supplied) : iso(row.target_computed_at_utc);
  const { supplied_requested_at_utc, target_computed_at_utc, ...intent } = row;
  return {
    ...intent,
    requested_at_utc: requestedAt,
    requested_at_provenance: supplied
      ? requestedAt ? "ORDER_INTENT_REQUESTED_AT" : "ORDER_INTENT_REQUESTED_AT_INVALID"
      : "TARGET_COMPUTED_AT_FALLBACK",
    ingested_at_utc: iso(row.ingested_at_utc),
  };
}

function compareIntentCausalTime(left, right) {
  return String(left.requested_at_utc || "9999").localeCompare(String(right.requested_at_utc || "9999"))
    || String(left.portfolio_order_intent_id).localeCompare(String(right.portfolio_order_intent_id));
}

function iso(value) {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

const QUERIES = Object.freeze({
  signals: `SELECT signal_id, signal_outbox_id, instrument, direction, status, generated_at_utc,
    source_data_cutoff_utc, expires_at_utc FROM strategy_signal_outbox ORDER BY generated_at_utc,signal_id`,
  context: `SELECT market_context_prefilter_decision_id,signal_id,decision,reason_codes,decided_at_utc,
    source_data_cutoff_utc,correlation_id FROM market_context_prefilter_decisions ORDER BY decided_at_utc,signal_id`,
  portfolio: `SELECT portfolio_arbitration_run_id,signal_ids,status,as_of_utc,payload
    FROM portfolio_arbitration_runs ORDER BY as_of_utc,portfolio_arbitration_run_id`,
  risk: `SELECT r.risk_decision_id,a.portfolio_arbitration_run_id,r.candidate_allocation_id,r.decision,r.status,r.payload
    FROM portfolio_risk_decisions r JOIN portfolio_candidate_allocations a USING(candidate_allocation_id)
    ORDER BY r.risk_decision_id`,
  targets: `SELECT target_position_id,account_id,instrument,net_target_size,computed_at_utc,lineage,approved_trade_plan
    FROM portfolio_target_positions ORDER BY computed_at_utc,target_position_id`,
  intents: `SELECT lineage.portfolio_order_intent_id,lineage.target_position_id,lineage.status,lineage.quantity,
      lineage.payload->>'requested_at_utc' AS supplied_requested_at_utc,
      target.computed_at_utc AS target_computed_at_utc,lineage.created_at_utc AS ingested_at_utc,lineage.payload
    FROM portfolio_order_intent_lineage lineage
    JOIN portfolio_target_positions target USING(target_position_id)
    ORDER BY target.computed_at_utc,lineage.portfolio_order_intent_id`,
  human_gates: `SELECT human_execution_gate_id,portfolio_order_intent_id,status,expires_at_utc
    FROM human_execution_gates ORDER BY human_execution_gate_id`,
  execution: `SELECT portfolio_order_intent_id,lifecycle_status,filled_quantity,updated_at_utc,payload
    FROM portfolio_order_intent_execution_states ORDER BY portfolio_order_intent_id`,
  theoretical_events: `SELECT theoretical_execution_event_id,portfolio_order_intent_id,trade_id,event_type,event_at_utc,
    source_candle_timestamp_utc,price,quantity,payload FROM trade_theoretical_execution_events
    ORDER BY event_at_utc,theoretical_execution_event_id`,
  trades: `SELECT t.trade_id,t.portfolio_order_intent_id,p.instrument,t.side,t.status,t.opened_at,t.closed_at,t.result_r
    FROM trades t JOIN portfolio_order_intent_lineage l USING(portfolio_order_intent_id)
    JOIN portfolio_target_positions p USING(target_position_id)
    WHERE t.raw->>'source'='theoretical_execution_engine' ORDER BY t.opened_at,t.trade_id`,
  outcomes: `SELECT trade_id,status,revision,result_r,initial_risk_amount,gross_realized_pnl,total_fees,
    net_realized_pnl,finalized_at_utc,evidence_hash,schema_version,engine_version,calculated_at_utc,evidence
    FROM trade_outcomes ORDER BY finalized_at_utc,trade_id,revision`,
  provider_commands: `SELECT count(*)::int AS count FROM broker_provider_commands`,
});
