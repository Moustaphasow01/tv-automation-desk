#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
const apiKey = process.env.DESK_MCP_API_KEY || process.env.DESK_GPT_MCP_API_KEY || "";
const apiBase = String(process.env.DESK_NINJA_API_BASE_URL || "http://127.0.0.1:8787/api/v1").replace(/\/+$/, "");
const confirmation = process.env.DESK_NINJA_ADDON_MATRIX_CONFIRMATION;
const noLiveConfirmed = process.env.DESK_NINJA_NO_LIVE_CONNECTIONS_CONFIRMED === "true";
const entryPrice = Number(process.env.DESK_NINJA_MATRIX_ENTRY_PRICE);
const stopPrice = Number(process.env.DESK_NINJA_MATRIX_STOP_PRICE);
const targetPrice = Number(process.env.DESK_NINJA_MATRIX_TARGET_PRICE);
const resumeIntentId = String(process.env.DESK_NINJA_MATRIX_RESUME_INTENT_ID || "").trim();
const matrixMode = String(process.env.DESK_NINJA_MATRIX_MODE || "full").trim().toLowerCase();

if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (!apiKey) throw new Error("DESK_MCP_API_KEY is required.");
if (confirmation !== "I_CONFIRM_SIM101_ADDON_ONLY" || !noLiveConfirmed) {
  throw new Error("Explicit Sim101 AddOn acceptance confirmation is required.");
}
for (const [name, value] of Object.entries({ entryPrice, stopPrice, targetPrice })) {
  if (!Number.isFinite(value) || value <= 0 || Math.abs(value * 4 - Math.round(value * 4)) > 1e-8) {
    throw new Error(`${name} must be a positive MNQ tick-aligned price.`);
  }
}
if (!(stopPrice < entryPrice && targetPrice > entryPrice)) throw new Error("Long entry geometry is invalid.");
if (!["full", "close_only"].includes(matrixMode)) throw new Error("DESK_NINJA_MATRIX_MODE must be full or close_only.");

const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const suffix = `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${process.pid}`;
const runId = `n14_addon_acceptance_${suffix}`;
const positionId = `${runId}_position`;
const proofPath = resolve(process.env.DESK_NINJA_MATRIX_PROOF_PATH || `.local/ninjatrader/addon-matrix/${runId}.json`);
const proof = {
  schema_version: "ninjatrader_addon_sim101_acceptance_v1",
  run_id: runId,
  started_at: new Date().toISOString(),
  adapter: "addon",
  account: "Sim101",
  instrument: "MNQ 09-26",
  requested_prices: { entry: entryPrice, stop: stopPrice, target: targetPrice },
  matrix_mode: matrixMode,
  checks: [],
  identifiers: {},
};

try {
  const overview = await get("/execution/overview");
  const bridge = overview.bridges.find((item) => item.bridge_id === "DESKTOP-A0TIK79_nt8_addon");
  assert.equal(overview.safety.submissionPossible, true, "backend must be armed only for this acceptance window");
  assert.equal(overview.safety.liveAccountAllowed, false);
  assert.equal(bridge?.adapter_kind, "addon");
  assert.equal(bridge?.status, "armed");
  assert.equal(bridge?.command_enabled, true);
  assert.equal(bridge?.account_name, "Sim101");
  proof.checks.push({ name: "preflight", status: "pass", bridge_id: bridge.bridge_id, live_account_allowed: false });

  let intentId;
  let trade;
  if (resumeIntentId) {
    const intent = await one("SELECT * FROM trade_order_intents WHERE order_intent_id=$1", [resumeIntentId]);
    assert.ok(intent, `resume intent not found: ${resumeIntentId}`);
    intentId = intent.order_intent_id;
    trade = await one("SELECT * FROM trades WHERE order_intent_id=$1", [intentId]);
    assert.ok(trade && Number(trade.quantity_open) === 2, "resume trade must be open with two contracts");
    proof.identifiers.decision_id = intent.trade_decision_id;
    proof.identifiers.intent_id = intentId;
    proof.checks.push({ name: "capital_risk_sizing", status: "pass", resumed: true, contracts: Number(intent.quantity), rounding_mode: "ceil", risk_percent: 0.25 });
  } else {
    const position = {
    position_id: positionId,
    status: "OPEN",
    execution_mode: "paper",
    paper_simulated: true,
    broker_execution: false,
    instrument: "MNQ",
    direction: "long",
    quantity: 2,
    entry_price: entryPrice,
    stop_loss: stopPrice,
    take_profit_1: targetPrice,
    strategy_id: "n14_addon_acceptance",
    trading_date: new Date().toISOString().slice(0, 10),
    session: "ny_open",
    run_id: runId,
    opened_at_utc: new Date().toISOString(),
    valid_until: new Date(Date.now() + 20 * 60_000).toISOString(),
    rationale: "Physical N14 AddOn acceptance on local Sim101",
  };
    await putDocument("desk_positions", positionId, position);

    const materialized = await post("/execution/actions", { action: "materialize", scope: { run_id: runId } });
    assert.equal(materialized.count, 1);
    const decision = await one("SELECT * FROM trade_decisions WHERE source_collection='desk_positions' AND source_document_id=$1", [positionId]);
    assert.ok(decision);
    proof.identifiers.decision_id = decision.trade_decision_id;

    const evaluated = await post("/execution/actions", { action: "evaluate", decisionId: decision.trade_decision_id });
    assert.equal(evaluated.riskCheck.status, "pass", JSON.stringify(evaluated.riskCheck.violations));
    assert.equal(Number(evaluated.intent.quantity), 2, "0.25% capital sizing must round upward to two micro contracts");
    intentId = evaluated.intent.order_intent_id;
    proof.identifiers.intent_id = intentId;
    proof.checks.push({
      name: "capital_risk_sizing",
      status: "pass",
      capital: evaluated.riskCheck.metrics.position_sizing.capital,
      risk_percent: evaluated.riskCheck.metrics.position_sizing.risk_percent,
      raw_contracts: evaluated.riskCheck.metrics.position_sizing.raw_contracts,
      contracts: evaluated.intent.quantity,
      rounding_mode: evaluated.riskCheck.metrics.position_sizing.rounding_mode,
    });

    await post("/execution/actions", {
      action: "approve",
      intentId,
      idempotencyKey: `${runId}_entry_approval`,
      confirmationPhrase: "CONFIRM_SIM101_ORDER",
      reason: "Physical N14 AddOn entry acceptance on Sim101",
    });

    trade = await waitFor(async () => {
      const value = await one("SELECT * FROM trades WHERE order_intent_id=$1", [intentId]);
      return value && Number(value.quantity_open) === 2 && value.raw?.protective_stop_order_ref && value.raw?.profit_target_order_ref ? value : null;
    }, "filled entry with attached ATM protection", 75_000);
  }
  proof.identifiers.trade_id = trade.trade_id;
  proof.identifiers.protective_stop_order_ref = trade.raw.protective_stop_order_ref;
  proof.identifiers.profit_target_order_ref = trade.raw.profit_target_order_ref;

  let snapshot = await waitFor(async () => {
    const value = await latestSnapshot();
    const active = activeOrders(value, "MNQ SEP26");
    const stopReady = active.some((order) => /Stop/i.test(order.order_type) && ["Accepted", "Working"].includes(order.status) && Number(order.stop_price) === stopPrice);
    const targetReady = active.some((order) => order.order_type === "Limit" && order.status === "Working" && Number(order.limit_price) === targetPrice);
    return positionQuantity(value, "MNQ SEP26") === 2 && stopReady && targetReady ? value : null;
  }, "two-contract NinjaTrader position with working canonical protection", 60_000);
  const activeProtection = activeOrders(snapshot, "MNQ SEP26");
  proof.checks.push({ name: "entry_and_atm_protection", status: "pass", filled_quantity: 2, active_protection_count: activeProtection.length });

  let reduction = null;
  let move = null;
  if (matrixMode === "full") {
    const beforeReductionRevision = Number(trade.revision);
    reduction = await submitManagement({
      runId,
      trade,
      sequence: "reduce",
      decision: "TAKE_PARTIAL",
      positionCheck: { reduce_quantity: 1 },
    });
    proof.identifiers.reduction_intent_id = reduction.management_intent_id;
    trade = await waitFor(async () => {
      const value = await one("SELECT * FROM trades WHERE trade_id=$1", [trade.trade_id]);
      return value && Number(value.quantity_open) === 1 && Number(value.revision) > beforeReductionRevision ? value : null;
    }, "one-contract reduction persisted", 60_000);
    snapshot = await waitFor(async () => {
      const value = await latestSnapshot();
      const protection = activeOrders(value, "MNQ SEP26").filter((order) => order.name === "Stop1" || order.name === "Target1");
      return positionQuantity(value, "MNQ SEP26") === 1 && protection.length === 2 && protection.every((order) => Number(order.quantity) === 1) ? value : null;
    }, "one-contract position with resized NinjaTrader protection", 45_000);
    proof.checks.push({ name: "partial_reduction", status: "pass", quantity_open: 1, protection_quantity: 1, trade_revision: Number(trade.revision) });

    const beforeMoveRevision = Number(trade.revision);
    move = await submitManagement({
      runId,
      trade,
      sequence: "move_stop",
      decision: "MOVE_STOP_BE",
      positionCheck: {},
    });
    proof.identifiers.move_stop_intent_id = move.management_intent_id;
    trade = await waitFor(async () => {
      const value = await one("SELECT * FROM trades WHERE trade_id=$1", [trade.trade_id]);
      return value && Number(value.revision) > beforeMoveRevision && Number(value.current_stop_price) === Number(value.avg_entry_price) ? value : null;
    }, "stop moved to break-even", 60_000);
    snapshot = await waitFor(async () => {
      const value = await latestSnapshot();
      return positionQuantity(value, "MNQ SEP26") === 1
        && activeOrders(value, "MNQ SEP26").some((order) => /Stop/i.test(order.order_type) && Number(order.stop_price) === Number(trade.avg_entry_price))
        ? value : null;
    }, "break-even stop visible on the remaining NinjaTrader contract", 45_000);
    proof.checks.push({ name: "move_stop_break_even", status: "pass", stop_price: Number(trade.current_stop_price), trade_revision: Number(trade.revision) });
  }

  const close = await submitManagement({
    runId,
    trade,
    sequence: "close",
    decision: "EXIT_POSITION",
    positionCheck: {},
  });
  proof.identifiers.close_intent_id = close.management_intent_id;
  trade = await waitFor(async () => {
    const value = await one("SELECT * FROM trades WHERE trade_id=$1", [trade.trade_id]);
    return value && Number(value.quantity_open) === 0 && value.status === "closed" ? value : null;
  }, "trade closed in PostgreSQL", 60_000);
  snapshot = await waitFor(async () => {
    const value = await latestSnapshot();
    return positionQuantity(value, "MNQ SEP26") === 0 && activeOrders(value, "MNQ SEP26").length === 0 ? value : null;
  }, "Sim101 flat with no working MNQ order", 45_000);
  proof.checks.push({ name: "close_and_flat", status: "pass", quantity_open: 0, active_orders: 0 });

  const events = await pool.query(
    `SELECT event_type, intent_id, management_intent_id, command_id, occurred_at, payload
       FROM broker_addon_events
      WHERE intent_id=$1 OR management_intent_id = ANY($2::text[])
      ORDER BY occurred_at`,
    [intentId, [move?.management_intent_id, reduction?.management_intent_id, close.management_intent_id].filter(Boolean)],
  );
  assert.ok(events.rows.some((event) => event.event_type === "command" && event.intent_id === intentId));
  if (move) assert.ok(events.rows.some((event) => event.event_type === "order" && event.management_intent_id === move.management_intent_id));
  if (reduction) assert.ok(events.rows.some((event) => event.event_type === "order" && event.management_intent_id === reduction.management_intent_id));
  assert.ok(events.rows.some((event) => event.event_type === "order" && event.management_intent_id === close.management_intent_id));
  proof.checks.push({ name: "signed_addon_event_ledger", status: "pass", event_count: events.rowCount });

  proof.status = "pass";
  proof.completed_at = new Date().toISOString();
  proof.final_state = { sim101_flat: true, active_mnq_orders: 0, trade_status: trade.status, quantity_open: Number(trade.quantity_open) };
  await persistProof();
  console.log(JSON.stringify({ ok: true, runId, proofPath, proofSha256: proof.sha256, checks: proof.checks, identifiers: proof.identifiers }, null, 2));
} catch (error) {
  proof.status = "fail";
  proof.completed_at = new Date().toISOString();
  proof.error = { code: error?.code || null, message: error?.message || String(error) };
  await persistProof().catch(() => {});
  console.error(JSON.stringify({ ok: false, runId, proofPath, error: proof.error, identifiers: proof.identifiers }, null, 2));
  process.exitCode = 1;
} finally {
  await pool.end();
}

async function submitManagement({ runId: id, trade, sequence, decision, positionCheck }) {
  const monitorId = `${id}_monitor_${sequence}`;
  const monitor = {
    monitor_id: monitorId,
    trade_id: trade.trade_id,
    strategy_id: trade.strategy_id,
    trading_date: trade.trading_date,
    session: trade.session,
    timestamp_utc: new Date().toISOString(),
    position_check: { trade_id: trade.trade_id, instrument: "MNQ", ...positionCheck },
    monitor_decision: { decision, reason_summary: `N14 physical acceptance: ${sequence}` },
  };
  await putDocument("desk_manual_monitors", monitorId, monitor);
  const materialized = await post("/execution/actions", { action: "materialize_management", monitorId, limit: 10 });
  const item = materialized.items?.find((value) => value.intent?.source_document_id === monitorId);
  assert.equal(item?.status, "PENDING_APPROVAL", JSON.stringify(item?.evaluation?.violations || materialized));
  await post("/execution/actions", {
    action: "approve_management",
    managementIntentId: item.intent.management_intent_id,
    idempotencyKey: `${id}_${sequence}_approval`,
    confirmationPhrase: "CONFIRM_SIM101_MANAGEMENT",
    reason: `Physical N14 AddOn ${sequence} acceptance on Sim101`,
  });
  return item.intent;
}

async function latestSnapshot() {
  return one("SELECT * FROM broker_addon_snapshots WHERE bridge_id='DESKTOP-A0TIK79_nt8_addon' ORDER BY captured_at DESC LIMIT 1");
}

function activeOrders(snapshot, instrument) {
  return (snapshot?.orders || []).filter((order) => order.instrument === instrument && !["Filled", "Cancelled", "Rejected", "Expired"].includes(order.status));
}

function positionQuantity(snapshot, instrument) {
  const position = (snapshot?.positions || []).find((item) => item.instrument === instrument);
  return position ? Number(position.quantity || 0) : 0;
}

async function putDocument(collection, id, data) {
  await pool.query(
    `INSERT INTO desk_documents (collection, document_id, data)
     VALUES ($1,$2,$3::jsonb)
     ON CONFLICT (collection, document_id) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`,
    [collection, id, JSON.stringify(data)],
  );
}

async function one(sql, params = []) {
  return (await pool.query(sql, params)).rows[0] || null;
}

async function waitFor(check, label, timeoutMs, intervalMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) { lastError = error; }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}.`);
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
  if (!response.ok) {
    const error = new Error(payload.message || payload.error || `${path} returned ${response.status}`);
    error.code = payload.code || null;
    throw error;
  }
  return payload;
}

function headers() {
  return { accept: "application/json", authorization: `Bearer ${apiKey}`, "x-desk-api-key": apiKey };
}

async function persistProof() {
  const content = JSON.stringify(proof, null, 2);
  proof.sha256 = createHash("sha256").update(content).digest("hex");
  await mkdir(dirname(proofPath), { recursive: true });
  await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
}
