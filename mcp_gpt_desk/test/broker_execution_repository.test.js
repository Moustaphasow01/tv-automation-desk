import assert from "node:assert/strict";
import test from "node:test";
import { PostgresBrokerExecutionRepository, evaluateBrokerProtectionSnapshot } from "../src/broker-execution-repository.js";

test("theoretical candidate facade preserves the replay clock for administrative release visibility", async () => {
  const calls = [];
  const repository = new PostgresBrokerExecutionRepository({
    pool: { async query(sql, params) { calls.push({ sql, params }); return { rows: [] }; } },
    initialized: Promise.resolve(),
  });
  const now = "2026-09-04T14:00:00.000Z";
  assert.deepEqual(await repository.listTheoreticalEntryCandidates({
    limit: 12, portfolioOrderIntentIds: ["portfolio_test"], now,
  }), []);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [12, ["portfolio_test"], now]);
  const sql = calls[0].sql;
  const eligibilityStart = sql.indexOf("WITH eligible_portfolio_intents AS MATERIALIZED");
  const targetEligibility = sql.indexOf("JOIN portfolio_target_positions t", eligibilityStart);
  const gateEligibility = sql.indexOf("LEFT JOIN human_execution_gates g", targetEligibility);
  const deterministicOrder = sql.indexOf(
    "ORDER BY l.created_at_utc ASC, l.portfolio_order_intent_id ASC",
    gateEligibility,
  );
  const preLimit = sql.indexOf("LIMIT $1", eligibilityStart);
  const enrichmentStart = sql.indexOf("FROM eligible_portfolio_intents eligible", preLimit);
  const signalEnrichment = sql.indexOf("FROM strategy_signal_outbox s", enrichmentStart);
  assert.ok(eligibilityStart >= 0);
  assert.ok(targetEligibility > eligibilityStart);
  assert.ok(gateEligibility > targetEligibility);
  assert.ok(deterministicOrder > gateEligibility);
  assert.ok(preLimit > eligibilityStart);
  assert.ok(preLimit > deterministicOrder);
  assert.ok(enrichmentStart > preLimit);
  assert.ok(signalEnrichment > enrichmentStart);
  assert.equal(sql.slice(eligibilityStart, preLimit).match(/AND NOT EXISTS \(/g)?.length, 4);
  assert.equal(sql.slice(enrichmentStart).includes("portfolio_administrative_reservation_cancellations"), false);
});

test("findOpenTradeForMonitor joins the originating desk position and filters it independently", async () => {
  const calls = [];
  const expected = {
    trade_id: "trade_broker_1",
    position_id: "position_desk_1",
    instrument_code: "MNQ",
    broker_symbol: "MNQ 09-26",
  };
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [expected] };
    },
  };
  const repository = new PostgresBrokerExecutionRepository({
    pool,
    initialized: Promise.resolve(),
  });

  const result = await repository.findOpenTradeForMonitor({
    tradeId: null,
    sourcePositionId: "position_desk_1",
    instrument: "MNQ",
    strategyId: "strategy_1",
    tradingDate: "2026-07-22",
    session: "ny_open",
  });

  assert.equal(result, expected);
  assert.match(calls[0].sql, /LEFT JOIN trade_decisions d ON d\.trade_decision_id = t\.trade_decision_id/);
  assert.match(calls[0].sql, /d\.source_document_id AS position_id/);
  assert.match(calls[0].sql, /d\.source_document_id = \$2/);
  assert.deepEqual(calls[0].params, [null, "position_desk_1", "MNQ", "strategy_1", "2026-07-22", "ny_open"]);
});

test("findOpenTradeForMonitor preserves the legacy trade-id lookup when no desk position is supplied", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ trade_id: "trade_legacy", position_id: null }] };
    },
  };
  const repository = new PostgresBrokerExecutionRepository({
    pool,
    initialized: Promise.resolve(),
  });

  const result = await repository.findOpenTradeForMonitor({ tradeId: "trade_legacy" });

  assert.equal(result.trade_id, "trade_legacy");
  assert.deepEqual(calls[0].params, ["trade_legacy", null, null, null, null, null]);
});

test("post-fill protection confirms only with an active opposite-side protective stop", () => {
  const result = evaluateBrokerProtectionSnapshot({
    trade: protectedTrade(),
    now: "2026-07-22T14:00:20.000Z",
    capturedAt: "2026-07-22T14:00:20.000Z",
    snapshotId: "snapshot_confirmed",
    brokerSnapshot: {
      connection: { status: "Connected" },
      orders: [
        { broker_order_ref: "STOP-1", status: "Working", side: "SELL", quantity: 1, stop_price: 29980 },
        { broker_order_ref: "TARGET-1", status: "Working", side: "SELL", quantity: 1, limit_price: 30040 },
      ],
    },
  });
  assert.equal(result.status, "confirmed");
  assert.equal(result.reason, "PROTECTIVE_STOP_ACTIVE");
  assert.equal(result.evidence.stop_order.broker_order_ref, "STOP-1");
  assert.equal(result.evidence.target_status, "working");
});

test("post-fill protection stays pending during the grace window when refs are not yet visible", () => {
  const result = evaluateBrokerProtectionSnapshot({
    trade: { ...protectedTrade(), raw: {}, opened_at: "2026-07-22T14:00:00.000Z" },
    now: "2026-07-22T14:00:10.000Z",
    graceSeconds: 30,
    brokerSnapshot: { connection: { status: "Connected" }, orders: [] },
  });
  assert.equal(result.status, "pending");
  assert.equal(result.reason, "PROTECTIVE_STOP_REF_MISSING");
});

test("post-fill protection fails closed after the grace window when the stop is absent", () => {
  const result = evaluateBrokerProtectionSnapshot({
    trade: protectedTrade({ raw: { protective_stop_order_ref: "STOP-MISSING" }, opened_at: "2026-07-22T14:00:00.000Z" }),
    now: "2026-07-22T14:01:00.000Z",
    graceSeconds: 30,
    brokerSnapshot: { connection: { status: "Connected" }, orders: [] },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "PROTECTIVE_STOP_ORDER_MISSING");
});

function protectedTrade(overrides = {}) {
  return {
    trade_id: "trade_protection_1",
    broker_account_id: "ninjatrader_paper_local",
    broker_symbol: "MNQ 09-26",
    side: "long",
    quantity_open: 1,
    current_stop_price: 29980,
    tick_size: 0.25,
    opened_at: "2026-07-22T14:00:00.000Z",
    raw: {
      protective_stop_order_ref: "STOP-1",
      profit_target_order_ref: "TARGET-1",
    },
    ...overrides,
  };
}
