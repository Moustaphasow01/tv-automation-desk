#!/usr/bin/env node
import assert from "node:assert/strict";
import pg from "pg";

const { Pool } = pg;
const CONFIRMATION = "I_CONFIRM_LOCAL_GATEWAY_EVENT_TEST_ONLY";
const databaseUrl = process.env.DATABASE_URL;
const apiKey = process.env.DESK_MCP_API_KEY || process.env.DESK_GPT_MCP_API_KEY || "";
const apiBase = String(process.env.DESK_NINJA_API_BASE_URL || "http://127.0.0.1:8787/api/v1").replace(/\/+$/, "");

assertLocalGatewayEventTestOnly();

if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (!apiKey) throw new Error("DESK_MCP_API_KEY is required.");

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const suffix = Date.now();
const positionId = `ninja_gateway_test_position_${suffix}`;
let decisionId = null;
let intentId = null;
let brokerOrderRef = null;
const now = new Date().toISOString();
const position = {
  position_id: positionId,
  status: "OPEN",
  execution_mode: "paper",
  paper_simulated: true,
  broker_execution: false,
  instrument: "MNQ",
  direction: "long",
  quantity: 1,
  entry_price: 30000,
  stop_loss: 29980,
  take_profit_1: 30040,
  strategy_id: "ny_open_1530",
  trading_date: now.slice(0, 10),
  session: "ny_open",
  run_id: `ninja_gateway_test_run_${suffix}`,
  opened_at_utc: now,
};

try {
  await pool.query(
    "INSERT INTO desk_documents (collection, document_id, data) VALUES ('desk_positions',$1,$2::jsonb)",
    [positionId, JSON.stringify(position)],
  );
  const materialized = await post("/execution/actions", { action: "materialize", scope: { run_id: position.run_id } });
  assert.equal(materialized.status, "MATERIALIZED");
  assert.equal(materialized.count, 1);
  const decisionResult = await pool.query("SELECT * FROM trade_decisions WHERE source_collection = 'desk_positions' AND source_document_id = $1", [positionId]);
  assert.equal(decisionResult.rowCount, 1);
  decisionId = decisionResult.rows[0].trade_decision_id;
  const evaluated = await post("/execution/actions", { action: "evaluate", decisionId });
  assert.equal(evaluated.riskCheck.status, "fail");
  assert.equal(evaluated.intent, null);
  assert.ok(evaluated.riskCheck.violations.some((rule) => rule.code === "ENV_EXECUTION_ENABLED"));
  const riskId = `risk_check_gateway_event_${suffix}`;
  intentId = `order_intent_gateway_event_${suffix}`;
  brokerOrderRef = intentId;
  await pool.query(
    `INSERT INTO trade_risk_checks (risk_check_id, trade_decision_id, status, checked_by, rules, violations, metrics, raw)
     VALUES ($1,$2,'pass','gateway_integration_test','[]'::jsonb,'[]'::jsonb,'{}'::jsonb,'{"test_only":true}'::jsonb)`,
    [riskId, decisionId],
  );
  await pool.query(
    `INSERT INTO trade_order_intents (
      order_intent_id, trade_decision_id, risk_check_id, broker_account_id, broker_contract_id, status, approval_status,
      side, order_type, quantity, limit_price, time_in_force, bracket, idempotency_key, expires_at, payload, raw
    ) VALUES ($1,$2,$3,'ninjatrader_paper_local','ninjatrader:MNQ:2026-09','sent','approved',
      'buy','limit',1,30000,'DAY','{"stop_price":29980,"target_price":30040}'::jsonb,$4,now() + interval '5 minutes',
      '{"broker_symbol":"MNQ 09-26"}'::jsonb,'{"test_only":true}'::jsonb)`,
    [intentId, decisionId, riskId, `gateway-event-${suffix}`],
  );
  const eventBody = {
    intentId,
    externalEventKey: `gateway-event-key-${suffix}`,
    update: { order_id: brokerOrderRef, order_state: "Filled", filled_quantity: 1, average_fill_price: 30000.25, occurred_at: now },
  };
  await post("/execution/bridge/events", eventBody);
  await post("/execution/bridge/events", eventBody);
  const persisted = await pool.query(
    `SELECT
      (SELECT count(*)::int FROM broker_order_events e JOIN broker_orders o USING (broker_order_id) WHERE o.broker_order_ref = $1) AS events,
      (SELECT count(*)::int FROM trade_fills f JOIN broker_orders o USING (broker_order_id) WHERE o.broker_order_ref = $1) AS fills,
      (SELECT count(*)::int FROM trades WHERE order_intent_id = $2 AND status = 'open' AND quantity_open = 1) AS trades`,
    [brokerOrderRef, intentId],
  );
  assert.deepEqual(persisted.rows[0], { events: 1, fills: 1, trades: 1 });
  const overview = await get("/execution/overview");
  assert.equal(overview.safety.submissionPossible, false);
  assert.equal(overview.safety.liveAccountAllowed, false);
  console.log(JSON.stringify({ ok: true, positionId, decisionId, riskStatus: evaluated.riskCheck.status, automaticIntentCreated: false, brokerEventDeduplicated: true, fillPersisted: true, tradeAggregated: true, submissionPossible: false }));
} finally {
  if (intentId) {
    await pool.query("DELETE FROM trade_events WHERE trade_id IN (SELECT trade_id FROM trades WHERE order_intent_id = $1)", [intentId]);
    await pool.query("DELETE FROM trade_fills WHERE broker_order_id IN (SELECT broker_order_id FROM broker_orders WHERE broker_order_ref = $1)", [brokerOrderRef]);
    await pool.query("DELETE FROM trades WHERE order_intent_id = $1", [intentId]);
    await pool.query("DELETE FROM broker_orders WHERE broker_order_ref = $1", [brokerOrderRef]);
    await pool.query("DELETE FROM trade_order_intents WHERE order_intent_id = $1", [intentId]);
  }
  if (decisionId) await pool.query("DELETE FROM trade_decisions WHERE trade_decision_id = $1", [decisionId]);
  await pool.query("DELETE FROM desk_documents WHERE collection = 'desk_positions' AND document_id = $1", [positionId]);
  await pool.end();
}

async function get(path) {
  const response = await fetch(`${apiBase}${path}`, { headers: headers() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.error || `${path} returned ${response.status}`);
  return payload;
}
async function post(path, body) {
  const response = await fetch(`${apiBase}${path}`, { method: "POST", headers: { ...headers(), "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.error || `${path} returned ${response.status}`);
  return payload;
}
function headers() { return { accept: "application/json", authorization: `Bearer ${apiKey}`, "x-desk-api-key": apiKey }; }

function assertLocalGatewayEventTestOnly() {
  if (process.env.DESK_NINJA_GATEWAY_TEST_CONFIRMATION !== CONFIRMATION) {
    throw new Error(`DESK_NINJA_GATEWAY_TEST_CONFIRMATION=${CONFIRMATION} is required.`);
  }
  if (process.env.DESK_ENVIRONMENT === "production" || process.env.NODE_ENV === "production") {
    throw new Error("Gateway event integration fixture is forbidden in production.");
  }
  if (process.env.DESK_LEGACY_POSITION_EXECUTION_ENABLED !== "true") {
    throw new Error("DESK_LEGACY_POSITION_EXECUTION_ENABLED=true is required because this legacy fixture materializes a desk_position.");
  }
  const parsed = new URL(apiBase);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    throw new Error("Gateway event integration fixture must target a local API only.");
  }
}
