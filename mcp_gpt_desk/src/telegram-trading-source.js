import { loadCanonicalTelegramExecutionRows } from "./telegram-canonical-execution-source.js";

/** Canonical prepared orders plus broker observations and qualified-position management. */
export async function loadTelegramTradingRows(pool) {
  const [canonical, broker, management] = await Promise.all([
    loadCanonicalTelegramExecutionRows(pool), pool.query(BROKER_EVENTS_SQL), pool.query(MANAGEMENT_SQL),
  ]);
  return [...canonical, ...broker.rows, ...management.rows];
}

const BROKER_EVENTS_SQL = `
  SELECT 'broker_order_event'::text AS source_kind,
         boe.broker_order_event_id AS source_id,
         COALESCE(boe.status::text, boe.event_type::text, 'event') AS source_state,
         boe.occurred_at,
         jsonb_build_object(
           'broker_order_id', boe.broker_order_id, 'event_type', boe.event_type,
           'status', boe.status, 'payload', boe.payload
         ) AS payload
    FROM broker_order_events boe
   ORDER BY boe.occurred_at DESC LIMIT 200`;

const MANAGEMENT_SQL = `
  SELECT 'management_intent'::text AS source_kind,
         tmi.management_intent_id AS source_id, tmi.status::text AS source_state,
         tmi.updated_at AS occurred_at,
         jsonb_build_object(
           'trade_id', tmi.trade_id, 'instrument', COALESCE(bc.instrument_code, t.raw->>'instrument'),
           'portfolio_order_intent_id', t.portfolio_order_intent_id,
           'action', tmi.action, 'quantity', tmi.requested_quantity,
           'stop_price', tmi.requested_stop_price, 'reason', tmi.reason,
           'approval_status', tmi.approval_status
         ) AS payload
    FROM trade_management_intents tmi
    JOIN trades t ON t.trade_id = tmi.trade_id
    LEFT JOIN broker_contracts bc ON bc.broker_contract_id = t.broker_contract_id
   WHERE t.portfolio_order_intent_id IS NOT NULL
   ORDER BY tmi.updated_at DESC LIMIT 100`;
