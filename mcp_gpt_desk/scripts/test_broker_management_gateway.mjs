#!/usr/bin/env node
import assert from "node:assert/strict";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
const apiKey = process.env.DESK_MCP_API_KEY || process.env.DESK_GPT_MCP_API_KEY || "";
const apiBase = String(process.env.DESK_NINJA_API_BASE_URL || "http://127.0.0.1:8787/api/v1").replace(/\/+$/, "");
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (!apiKey) throw new Error("DESK_MCP_API_KEY is required.");

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const suffix = Date.now();
const tradeId = `trade_management_gateway_test_${suffix}`;
const managementIntentId = `management_intent_gateway_${suffix}`;
const stopOrderRef = `management_stop_${suffix}`;
const externalEventKey = `management-event-key-${suffix}`;
const now = new Date().toISOString();

try {
  await pool.query(
    `INSERT INTO trades (
      trade_id, broker_account_id, broker_contract_id, status, side, quantity_planned, quantity_open,
      avg_entry_price, current_stop_price, revision, opened_at, trading_date, session, strategy_id, raw
    ) VALUES ($1,'ninjatrader_paper_local','ninjatrader:MNQ:2026-09','protected','long',2,2,
      30000,29980,3,$2,$3,'ny_open','ny_open_1530',$4::jsonb)`,
    [tradeId, now, now.slice(0, 10), JSON.stringify({ test_only: true, protective_stop_order_ref: stopOrderRef })],
  );
  await pool.query(
    `INSERT INTO trade_management_intents (
      management_intent_id, trade_id, source_collection, source_document_id, source_action, action,
      status, approval_status, expected_trade_revision, requested_stop_price, reason, risk_reducing,
      guard_evidence, command_payload, idempotency_key, requested_at, expires_at
    ) VALUES ($1,$2,'desk_manual_monitors',$3,'MOVE_STOP_BE','move_stop','delivered','approved',3,30000,
      'integration stop test',true,'{"status":"pass"}'::jsonb,'{"action":"move_stop"}'::jsonb,$4,$5,now() + interval '5 minutes')`,
    [managementIntentId, tradeId, `monitor_management_gateway_${suffix}`, `management-gateway-${suffix}`, now],
  );
  await pool.query(
    `INSERT INTO broker_management_outbox (management_outbox_id, management_intent_id, status, command_payload, delivered_at)
     VALUES ($1,$2,'delivered','{"action":"move_stop"}'::jsonb,$3)`,
    [`management_outbox_gateway_${suffix}`, managementIntentId, now],
  );
  const event = {
    managementOrderRef: true,
    externalEventKey,
    update: { order_id: stopOrderRef, order_state: "Working", filled_quantity: 0, occurred_at: now },
  };
  await post("/execution/bridge/events", event);
  await post("/execution/bridge/events", event);
  const result = await pool.query(
    `SELECT t.current_stop_price::float8, t.revision, m.status,
      (SELECT count(*)::int FROM trade_events WHERE trade_id = t.trade_id AND event_type = 'stop_moved') AS stop_events,
      (SELECT count(*)::int FROM broker_orders WHERE management_intent_id = m.management_intent_id) AS broker_orders
     FROM trades t JOIN trade_management_intents m ON m.trade_id = t.trade_id
     WHERE t.trade_id = $1`,
    [tradeId],
  );
  assert.deepEqual(result.rows[0], { current_stop_price: 30000, revision: 4, status: "acknowledged", stop_events: 1, broker_orders: 1 });
  console.log(JSON.stringify({ ok: true, managementIntentId, stopAcknowledged: true, tradeRevision: 4, eventDeduplicated: true, liveSubmission: false }));
} finally {
  await pool.query("DELETE FROM trade_events WHERE trade_id = $1", [tradeId]);
  await pool.query("DELETE FROM broker_order_events WHERE broker_order_id IN (SELECT broker_order_id FROM broker_orders WHERE management_intent_id = $1)", [managementIntentId]);
  await pool.query("DELETE FROM broker_orders WHERE management_intent_id = $1", [managementIntentId]);
  await pool.query("DELETE FROM broker_management_outbox WHERE management_intent_id = $1", [managementIntentId]);
  await pool.query("DELETE FROM trade_management_approvals WHERE management_intent_id = $1", [managementIntentId]);
  await pool.query("DELETE FROM trade_management_intents WHERE management_intent_id = $1", [managementIntentId]);
  await pool.query("DELETE FROM trades WHERE trade_id = $1", [tradeId]);
  await pool.end();
}

async function post(path, body) {
  const response = await fetch(`${apiBase}${path}`, { method: "POST", headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${apiKey}`, "x-desk-api-key": apiKey }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.error || `${path} returned ${response.status}`);
  return payload;
}
