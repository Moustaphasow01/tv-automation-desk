import assert from "node:assert/strict";
import test from "node:test";
import { PortfolioRiskRuntimeService } from "../src/portfolio-risk-runtime-service.js";
import { PostgresPortfolioRiskRuntimeRepository } from "../src/portfolio-risk-runtime-repository.js";
import { PortfolioOrderIntentExecutionService } from "../src/portfolio-order-intent-execution-service.js";
import { TelegramAlertService } from "../src/telegram-alert-service.js";
import { deliverTelegramCandidate } from "../src/telegram-delivery-runtime.js";
import { loadCanonicalTelegramExecutionRows, loadCanonicalTelegramOrder } from "../src/telegram-canonical-execution-source.js";
import { buildTelegramTradingCandidate } from "../src/telegram-trading-message.js";
import { createTheoreticalTestDatabase } from "./support/theoretical-postgres-fixtures.js";

test("canonical PostgreSQL orders retain risk/plan identity and suppress a gate decided before send", { skip: process.env.RUN_POSTGRES_TESTS !== "1" }, async () => {
  const database = await createTheoreticalTestDatabase();
  try {
    const harness = await createHarness(database);
    const approved = await createCanonicalOrder(harness, { signalId: "telegram-approved", instrument: "ZC" });
    const rejected = await createCanonicalOrder(harness, { signalId: "telegram-rejected", instrument: "ZW" });
    const rows = await loadCanonicalTelegramExecutionRows(database.pool);
    const row = rows.find((item) => item.source_id === approved.intentId);
    assertCanonicalOrder(row, approved);
    const candidate = buildTelegramTradingCandidate(row, { manualTelegramExecution: true, now: harness.nowMs });
    assert.ok(candidate);
    assert.match(candidate.message, /ORDRE QUALIFIÉ — À CONFIRMER/);
    assert.ok(await harness.alerts.queueDelivery(candidate));
    const approvedDelivery = await findDelivery(database.pool, candidate.sourceKey);
    assert.ok(approvedDelivery);
    assert.equal((await harness.gates.confirmHumanGate({ portfolioOrderIntentId: approved.intentId, operatorId: "operator-test", idempotencyKey: "confirm-telegram", as_of_utc: harness.nowUtc })).status, "CONFIRMED");

    const rejectedRow = rows.find((item) => item.source_id === rejected.intentId);
    const rejectedCandidate = buildTelegramTradingCandidate(rejectedRow, { manualTelegramExecution: true, now: harness.nowMs });
    assert.ok(rejectedCandidate);
    await harness.alerts.queueDelivery(rejectedCandidate);
    assert.equal((await harness.gates.rejectHumanGate({ portfolioOrderIntentId: rejected.intentId, operatorId: "operator-test", idempotencyKey: "reject-telegram", reason: "test", as_of_utc: harness.nowUtc })).status, "REJECTED");

    const calls = { count: 0 };
    const options = deliveryOptions(database.pool, harness.nowMs, calls);
    assert.equal((await deliverTelegramCandidate(options)).status, "suppressed");
    assert.equal((await deliverTelegramCandidate(options)).status, "suppressed");
    assert.equal(calls.count, 0);
    assert.deepEqual(await deliveryStatuses(database.pool), ["suppressed", "suppressed"]);

    const tradeId = "telegram-entry-then-closed";
    const entryAt = new Date(harness.nowMs - 20_000).toISOString();
    const closedAt = new Date(harness.nowMs - 10_000).toISOString();
    await createOpenTheoreticalTrade(database.pool, { intentId: approved.intentId, tradeId, openedAt: entryAt });
    const entry = await insertTheoreticalEvent(database.pool, {
      intentId: approved.intentId, tradeId, eventId: "telegram-entry", eventType: "entry_filled", price: 100, eventAt: entryAt,
    });
    const entryBefore = (await loadCanonicalTelegramExecutionRows(database.pool)).find((item) => item.source_id === entry.eventId);
    const entryCandidateBefore = buildTelegramTradingCandidate(entryBefore, { manualTelegramExecution: true, now: harness.nowMs });
    await closeTheoreticalTrade(database.pool, { tradeId, closedAt });
    await insertTheoreticalEvent(database.pool, {
      intentId: approved.intentId, tradeId, eventId: "telegram-stop", eventType: "stop_hit", price: 95, eventAt: closedAt,
    });
    const eventRows = await loadCanonicalTelegramExecutionRows(database.pool);
    const entryAfter = eventRows.find((item) => item.source_id === entry.eventId);
    const stop = eventRows.find((item) => item.source_id === "telegram-stop");
    const entryCandidateAfter = buildTelegramTradingCandidate(entryAfter, { manualTelegramExecution: true, now: harness.nowMs });
    const stopCandidate = buildTelegramTradingCandidate(stop, { manualTelegramExecution: true, now: harness.nowMs });
    assert.equal(entryBefore.payload.trade_id, tradeId);
    assert.deepEqual(entryAfter.payload, entryBefore.payload);
    assert.equal(entryCandidateAfter.fingerprint, entryCandidateBefore.fingerprint);
    assert.notEqual(stopCandidate.sourceKey, entryCandidateAfter.sourceKey);
    assert.equal(Number(stop.payload.result_r), -1);

    await assert.rejects(loadCanonicalTelegramExecutionRows({ query: async () => { throw new Error("canonical_query_failure"); } }), /canonical_query_failure/);
  } finally {
    await database.close();
  }
});

test("a receipt-commit fault leaves a real canonical outbox row uncertain and never retries it", { skip: process.env.RUN_POSTGRES_TESTS !== "1" }, async () => {
  const database = await createTheoreticalTestDatabase();
  try {
    const harness = await createHarness(database);
    const order = await createCanonicalOrder(harness, { signalId: "telegram-uncertain", instrument: "ZC" });
    const row = await loadCanonicalTelegramOrder(database.pool, order.intentId);
    const candidate = buildTelegramTradingCandidate(row, { manualTelegramExecution: true, now: harness.nowMs });
    await harness.alerts.queueDelivery(candidate);
    const calls = { count: 0 };
    const faultPool = receiptCommitFaultPool(database.pool);
    const first = await deliverTelegramCandidate(deliveryOptions(faultPool, harness.nowMs, calls));
    assert.equal(first.status, "uncertain");
    assert.equal(first.error, "TELEGRAM_RECEIPT_COMMIT_UNCERTAIN");
    assert.equal(calls.count, 1);
    assert.equal((await deliveryStatuses(database.pool))[0], "uncertain");
    assert.equal((await deliverTelegramCandidate(deliveryOptions(faultPool, harness.nowMs, calls))).status, "idle");
    assert.equal(calls.count, 1);
  } finally {
    await database.close();
  }
});

async function createHarness(database) {
  const nowMs = Date.now();
  const nowUtc = new Date(nowMs).toISOString();
  const persistence = { pool: database.pool, initialized: Promise.resolve() };
  const runtime = new PortfolioRiskRuntimeService({
    repository: new PostgresPortfolioRiskRuntimeRepository(persistence), clock: { now: () => ({ utc: nowUtc }) },
  });
  const gates = new PortfolioOrderIntentExecutionService({ persistence, clock: { now: () => ({ utc: nowUtc }) } });
  await database.pool.query("UPDATE telegram_runtime_config SET enabled = true, trading_enabled = true WHERE config_id = 'desk_telegram'");
  const alerts = new TelegramAlertService({ persistence, clock: { now: () => ({ utc: nowUtc }) }, env: telegramEnvironment(), fetchImpl: noNetwork });
  return { nowMs, nowUtc, runtime, gates, alerts };
}

async function createCanonicalOrder(harness, { signalId, instrument }) {
  const generated = new Date(harness.nowMs - 60_000).toISOString();
  const expiry = new Date(harness.nowMs + 30 * 60_000).toISOString();
  const result = await harness.runtime.runPipeline({
    as_of_utc: harness.nowUtc, account_id: "telegram-shadow", portfolio_scope: "telegram-shadow", execution_mode: "SHADOW",
    signals: [{
      signal_id: signalId, strategy_instance_id: "telegram-grains", strategy_version_id: "telegram-v1", instrument,
      direction: "LONG", proposed_size: 1, execution_mode_origin: "SHADOW", generated_at_utc: generated, expires_at_utc: expiry,
      status: "ACTIVE", proposed_trade_plan: { instrument, direction: "LONG", order_type: "LIMIT", entry: { price: 100 }, stop: { price: 95 }, targets: [{ price: 105 }] },
    }],
    risk_budget: { max_portfolio_abs_size: 4, max_account_abs_size: { "telegram-shadow": 4 }, max_instrument_abs_size: { ZC: 2, ZW: 2 } },
    execution_policy: { provider_id: "telegram-test", broker_account_id: "telegram-shadow", submission_enabled: true, order_type: "LIMIT" },
    default_protection_plan: { stop_price: 95, target_price: 105 },
  });
  const intentId = result.intents.order_intents[0]?.order_intent_id;
  assert.ok(intentId);
  const gate = await harness.gates.ensureHumanGate({ portfolioOrderIntentId: intentId, expiresAtUtc: expiry, as_of_utc: harness.nowUtc });
  assert.equal(gate.status, "AWAITING_MANUAL_CONFIRMATION");
  return { intentId, targetId: result.targets.target_positions[0].id, gateId: gate.human_execution_gate_id, expiry, instrument };
}

function assertCanonicalOrder(row, order) {
  assert.equal(row.source_kind, "order_intent");
  assert.equal(row.source_id, order.intentId);
  assert.equal(row.payload.order_intent_id, order.intentId);
  assert.equal(row.payload.target_position_id, order.targetId);
  assert.equal(row.payload.human_execution_gate_id, order.gateId);
  assert.equal(row.payload.instrument, order.instrument);
  assert.equal(String(row.payload.risk_decision).toUpperCase(), "APPROVED");
  assert.equal(String(row.payload.human_gate_status).toUpperCase(), "AWAITING_MANUAL_CONFIRMATION");
  assert.equal(Number(row.payload.entry_price), 100);
  assert.equal(Number(row.payload.protective_stop), 95);
  assert.equal(Number(row.payload.profit_target), 105);
}

function deliveryOptions(pool, nowMs, calls) {
  return {
    pool, config: { enabled: true, tradingEnabled: true }, environment: { workerEnabled: true, tradingConfigured: true },
    clients: { trading: { async sendMessage() { calls.count += 1; return { message_id: 101 }; } } },
    chatIds: { trading: "test-only" }, nowMs, minIntervalMs: 0,
  };
}

function receiptCommitFaultPool(pool) {
  return {
    query: (...args) => pool.query(...args),
    async connect() {
      const client = await pool.connect();
      return {
        query(sql, params) {
          if (sql.includes("SET status = 'sent'")) throw new Error("injected_receipt_commit_failure");
          return client.query(sql, params);
        },
        release: () => client.release(),
      };
    },
  };
}

async function findDelivery(pool, sourceKey) {
  return (await pool.query("SELECT * FROM telegram_delivery_outbox WHERE source_key = $1", [sourceKey])).rows[0] || null;
}

async function deliveryStatuses(pool) {
  return (await pool.query("SELECT status::text FROM telegram_delivery_outbox ORDER BY created_at_utc, delivery_id")).rows.map((row) => row.status);
}

async function insertTheoreticalEvent(pool, { intentId, tradeId = null, eventId, eventType, price, eventAt }) {
  await pool.query(`INSERT INTO trade_theoretical_execution_events
    (theoretical_execution_event_id, portfolio_order_intent_id, trade_id, event_type, event_at_utc, quantity, price, payload, raw)
    VALUES ($1,$2,$3,$4::theoretical_execution_event_type,$5,1,$6,'{}'::jsonb,'{}'::jsonb)`, [eventId, intentId, tradeId, eventType, eventAt, price]);
  return { eventId };
}

async function createOpenTheoreticalTrade(pool, { intentId, tradeId, openedAt }) {
  await pool.query(`INSERT INTO trades (
    trade_id, portfolio_order_intent_id, status, side, quantity_planned, quantity_open, quantity_closed,
    opened_at, raw
  ) VALUES ($1,$2,'open','long',1,1,0,$3,'{"source":"theoretical_execution_engine"}'::jsonb)`, [tradeId, intentId, openedAt]);
}

async function closeTheoreticalTrade(pool, { tradeId, closedAt }) {
  const result = await pool.query(`UPDATE trades SET status = 'closed', quantity_open = 0, quantity_closed = 1,
    closed_at = $2, result_r = -1 WHERE trade_id = $1`, [tradeId, closedAt]);
  assert.equal(result.rowCount, 1);
}

function telegramEnvironment() {
  return {
    DESK_TELEGRAM_ENABLED: "true", TELEGRAM_ALERT_BOT_TOKEN: "test-token", TELEGRAM_ALERT_CHAT_ID: "test-only",
    TELEGRAM_ADMIN_BOT_TOKEN: "test-admin", TELEGRAM_ADMIN_CHAT_ID: "test-admin",
  };
}

async function noNetwork() { throw new Error("NETWORK_NOT_ALLOWED_IN_TEST"); }
