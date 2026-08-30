export async function loadCanonicalTelegramExecutionRows(pool) {
  const [intents, theoreticalEvents, manualEvents] = await Promise.all([
    safeQuery(pool, CANONICAL_INTENTS_SQL),
    safeQuery(pool, THEORETICAL_EVENTS_SQL),
    safeQuery(pool, MANUAL_EVENTS_SQL),
  ]);
  return [...intents, ...theoreticalEvents, ...manualEvents];
}

async function safeQuery(pool, sql) {
  const result = await pool.query(sql).catch(() => ({ rows: [] }));
  return result.rows;
}

const CANONICAL_INTENTS_SQL = `
  SELECT 'order_intent'::text AS source_kind,
         l.portfolio_order_intent_id AS source_id,
         COALESCE(g.status, l.status)::text AS source_state,
         COALESCE(g.updated_at_utc, l.created_at_utc) AS occurred_at,
         COALESCE(l.payload, '{}'::jsonb) || jsonb_build_object(
           'order_intent_id', l.portfolio_order_intent_id,
           'target_position_id', l.target_position_id,
           'instrument', COALESCE(l.payload->>'instrument', t.instrument),
           'side', COALESCE(l.payload->>'side', l.payload->>'action'),
           'order_type', COALESCE(l.payload->>'order_type', l.payload#>>'{execution_terms,order_type}'),
           'quantity', l.quantity,
           'entry_price', COALESCE(l.payload#>'{entry,price}', l.payload#>'{execution_terms,entry,price}'),
           'protective_stop', COALESCE(l.payload#>'{protection,stop_price}', l.payload#>'{execution_terms,stop,price}'),
           'profit_target', COALESCE(l.payload#>'{protection,target_price}', l.payload#>'{execution_terms,targets,0,price}'),
           'expires_at', g.expires_at_utc,
           'human_gate_status', g.status,
           'risk_decision', rd.decision,
           'risk_amount', rd.authorized->'risk_amount',
           'expected_r', COALESCE(l.payload->'expected_r', l.payload#>'{trade_plan_economics,reward_risk}'),
           'strategy_id', COALESCE(l.payload->>'strategy_id', l.payload#>>'{source,strategy_id}'),
           'strategy_instance_id', COALESCE(l.payload->>'strategy_instance_id', l.payload#>>'{source,strategy_instance_id}'),
           'context_gate_decision', COALESCE(l.payload->>'context_gate_decision', l.payload->>'ai_context_recommendation')
         ) AS payload
    FROM portfolio_order_intent_lineage l
    JOIN portfolio_target_positions t ON t.target_position_id = l.target_position_id
    LEFT JOIN human_execution_gates g ON g.portfolio_order_intent_id = l.portfolio_order_intent_id
    LEFT JOIN LATERAL (
      SELECT rd.*
        FROM portfolio_target_position_risk_decisions tr
        JOIN portfolio_risk_decisions rd ON rd.risk_decision_id = tr.risk_decision_id
       WHERE tr.target_position_id = l.target_position_id
       ORDER BY tr.created_at_utc DESC LIMIT 1
    ) rd ON true
   ORDER BY COALESCE(g.updated_at_utc, l.created_at_utc) DESC LIMIT 200`;

const THEORETICAL_EVENTS_SQL = `
  SELECT 'theoretical_execution_event'::text AS source_kind,
         e.theoretical_execution_event_id AS source_id,
         e.event_type::text AS source_state,
         e.event_at_utc AS occurred_at,
         COALESCE(e.payload, '{}'::jsonb) || jsonb_build_object(
           'portfolio_order_intent_id', e.portfolio_order_intent_id,
           'trade_id', e.trade_id,
           'event_type', e.event_type,
           'quantity', e.quantity,
           'price', e.price,
           'instrument', COALESCE(l.payload->>'instrument', t.instrument),
           'side', COALESCE(l.payload->>'side', l.payload->>'action'),
           'entry_price', tr.avg_entry_price,
           'exit_price', tr.avg_exit_price,
           'result_r', CASE WHEN tr.status::text = 'closed' THEN tr.result_r ELSE NULL END,
           'trade_status', tr.status
         ) AS payload
    FROM trade_theoretical_execution_events e
    LEFT JOIN portfolio_order_intent_lineage l ON l.portfolio_order_intent_id = e.portfolio_order_intent_id
    LEFT JOIN portfolio_target_positions t ON t.target_position_id = l.target_position_id
    LEFT JOIN trades tr ON tr.trade_id = e.trade_id
   WHERE e.portfolio_order_intent_id IS NOT NULL
   ORDER BY e.event_at_utc DESC LIMIT 300`;

const MANUAL_EVENTS_SQL = `
  SELECT 'manual_execution_event'::text AS source_kind,
         e.manual_execution_event_id AS source_id,
         e.event_type::text AS source_state,
         e.occurred_at_utc AS occurred_at,
         COALESCE(e.payload, '{}'::jsonb) || jsonb_build_object(
           'portfolio_order_intent_id', e.portfolio_order_intent_id,
           'trade_id', e.trade_id,
           'event_type', e.event_type,
           'source', e.source,
           'actor', e.actor,
           'quantity', e.quantity,
           'price', e.price,
           'reason', e.reason,
           'instrument', COALESCE(l.payload->>'instrument', t.instrument)
         ) AS payload
    FROM trade_manual_execution_events e
    LEFT JOIN portfolio_order_intent_lineage l ON l.portfolio_order_intent_id = e.portfolio_order_intent_id
    LEFT JOIN portfolio_target_positions t ON t.target_position_id = l.target_position_id
   WHERE e.portfolio_order_intent_id IS NOT NULL
   ORDER BY e.occurred_at_utc DESC LIMIT 200`;
