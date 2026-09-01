import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLiveTheoreticalExecution, theoreticalPerformanceR } from "../src/front-live-theoretical-execution-projection.js";

test("links canonical operator decisions, manual evidence and theoretical outcomes without inference", () => {
  const execution = {
    portfolioOrderIntents: [intent("intent-captured", "signal-captured"), intent("intent-missed", "signal-missed"), intent("intent-unverified", "signal-unverified")],
    humanExecutionGates: [gate("intent-captured", "CONFIRMED"), gate("intent-missed", "REJECTED"), gate("intent-unverified", "CONFIRMED")],
    humanExecutionGateEvents: [],
    theoreticalEvents: [event("intent-captured", "trade-captured", "target_hit"), event("intent-missed", "trade-missed", "target_hit"), event("intent-unverified", "trade-unverified", "stop_hit")],
    manualExecutionEvents: [{ portfolio_order_intent_id: "intent-captured", trade_id: "trade-captured", event_type: "filled", occurred_at_utc: "2026-08-30T10:01:00.000Z", operator_id: "operator" }],
    trades: [trade("intent-captured", "trade-captured", 2), trade("intent-missed", "trade-missed", 1.5), trade("intent-unverified", "trade-unverified", -1)],
    providerCommands: [],
    providerEvents: [],
  };

  const projection = buildLiveTheoreticalExecution({ execution, nowIso: "2026-08-30T12:00:00.000Z" });
  const byId = Object.fromEntries(projection.rows.map((row) => [row.portfolioOrderIntentId, row]));
  assert.equal(byId["intent-captured"].outcomeAttribution.status, "CAPTURED");
  assert.equal(byId["intent-captured"].outcomeAttribution.capturedR, 2);
  assert.equal(byId["intent-missed"].outcomeAttribution.status, "MISSED_OPPORTUNITY");
  assert.equal(byId["intent-missed"].outcomeAttribution.missedR, 1.5);
  assert.equal(byId["intent-unverified"].outcomeAttribution.status, "EXECUTION_UNVERIFIED");
  assert.equal(byId["intent-unverified"].outcomeAttribution.capturedR, null);
  assert.equal(projection.summary.totalClosedR, 2.5);
  assert.deepEqual(theoreticalPerformanceR(projection, "2026-08-30T12:00:00.000Z"), {
    availability: "AVAILABLE", sourceType: "THEORETICAL_BACKEND", totalR: 2.5, dailyR: 2.5, drawdownR: -1,
    sampleSize: 3, hitRatePct: 66.67,
    series: [
      { sequence: 1, at: "2026-08-30T10:05:00.000Z", resultR: 2, cumulativeR: 2, drawdownR: 0 },
      { sequence: 2, at: "2026-08-30T10:05:00.000Z", resultR: 1.5, cumulativeR: 3.5, drawdownR: 0 },
      { sequence: 3, at: "2026-08-30T10:05:00.000Z", resultR: -1, cumulativeR: 2.5, drawdownR: -1 },
    ],
    asOf: "2026-08-30T10:05:00.000Z",
  });
});

test("publishes backend-driven manual execution actions without treating confirmation as a fill", () => {
  const execution = {
    portfolioOrderIntents: [intent("intent-actionable", "signal-actionable")],
    humanExecutionGates: [gate("intent-actionable", "CONFIRMED")],
    humanExecutionGateEvents: [], theoreticalEvents: [], manualExecutionEvents: [], trades: [], providerCommands: [], providerEvents: [],
  };
  const projection = buildLiveTheoreticalExecution({
    execution,
    nowIso: "2026-08-30T12:00:00.000Z",
    actor: { kind: "operator_session", scopes: ["desk.read", "desk.write"] },
  });
  const row = projection.rows[0];
  assert.equal(row.operatorDecision, "CONFIRMED");
  assert.equal(row.manualExecution.status, "NOT_REPORTED");
  assert.deepEqual(row.manualExecution.allowedActions.map((action) => action.action), ["REPORT_PLACED", "REPORT_SKIPPED"]);
  assert.equal(row.manualExecution.allowedActions.every((action) => action.permission === "ALLOWED"), true);
  assert.equal(row.manualExecution.allowedActions.every((action) => action.environment === "PAPER"), true);
});

test("does not publish a false flat R before any theoretical trade is closed", () => {
  const projection = buildLiveTheoreticalExecution({
    execution: {
      portfolioOrderIntents: [intent("intent-waiting", "signal-waiting")],
      humanExecutionGates: [gate("intent-waiting", "AWAITING_MANUAL_CONFIRMATION")],
      humanExecutionGateEvents: [], theoreticalEvents: [], manualExecutionEvents: [], trades: [], providerCommands: [], providerEvents: [],
    },
    nowIso: "2026-08-30T12:00:00.000Z",
  });

  assert.equal(projection.summary.closedTrades, 0);
  assert.equal(projection.summary.totalClosedR, null);
  assert.equal(theoreticalPerformanceR(projection, "2026-08-30T12:00:00.000Z").totalR, null);
});

test("publishes backend-calculated live R from the scoped market series", () => {
  const execution = {
    portfolioOrderIntents: [intent("intent-open", "signal-open")],
    humanExecutionGates: [gate("intent-open", "CONFIRMED")],
    humanExecutionGateEvents: [],
    theoreticalEvents: [{ portfolio_order_intent_id: "intent-open", trade_id: "trade-open", event_type: "entry_filled", event_at_utc: "2026-08-30T10:00:00.000Z", price: 400 }],
    manualExecutionEvents: [],
    trades: [{ portfolio_order_intent_id: "intent-open", trade_id: "trade-open", status: "open", avg_entry_price: 400, opened_at: "2026-08-30T10:00:00.000Z" }],
    providerCommands: [], providerEvents: [],
  };
  const projection = buildLiveTheoreticalExecution({
    execution,
    marketSeries: {
      instrument: "ZC",
      source: "market_candles",
      asOf: "2026-08-30T10:10:00.000Z",
      points: [
        { timestamp: "2026-08-30T10:05:00.000Z", high: 403, low: 399, close: 402 },
        { timestamp: "2026-08-30T10:10:00.000Z", high: 405, low: 401, close: 404 },
      ],
    },
    nowIso: "2026-08-30T10:10:00.000Z",
  });
  assert.deepEqual(projection.rows[0].liveMark, {
    availability: "AVAILABLE",
    currentR: 2,
    highWaterR: 2.5,
    lowWaterR: -0.5,
    marketPrice: 404,
    asOf: "2026-08-30T10:10:00.000Z",
    source: "market_candles",
  });
});

test("publishes the Risk-authorized expected R from canonical trade-plan economics", () => {
  const approvedIntent = intent("intent-authorized-r", "signal-authorized-r");
  approvedIntent.payload.approved_trade_plan = {
    economics: {
      targets: [
        { label: "TP1", price: 404, expected_r: 1.5, reward_risk: 1.5 },
        { label: "TP2", price: 406, expected_r: 2.5, reward_risk: 2.5 },
      ],
    },
  };
  const projection = buildLiveTheoreticalExecution({
    execution: {
      portfolioOrderIntents: [approvedIntent],
      humanExecutionGates: [], humanExecutionGateEvents: [], theoreticalEvents: [], manualExecutionEvents: [], trades: [], providerCommands: [], providerEvents: [],
    },
    nowIso: "2026-08-30T12:00:00.000Z",
  });

  assert.equal(projection.rows[0].expectedR, 1.5);
  assert.deepEqual(projection.rows[0].targets.map((target) => target.ratioR), [1.5, 2.5]);
});

function intent(id, signalId) { return { portfolio_order_intent_id: id, target_position_id: `target-${id}`, quantity: 1, status: "READY", created_at_utc: "2026-08-30T09:59:00.000Z", payload: { order_intent_id: id, instrument: "ZC", action: "BUY", order_type: "LIMIT", quantity: 1, source_signal_id: signalId, entry: { price: 400 }, protection: { stop_price: 398, target_price: 404 } } }; }
function gate(id, status) { return { portfolio_order_intent_id: id, status, operator_id: "operator", confirmed_at_utc: status === "CONFIRMED" ? "2026-08-30T10:00:00.000Z" : null, rejected_at_utc: status === "REJECTED" ? "2026-08-30T10:00:00.000Z" : null }; }
function event(intentId, tradeId, eventType) { return { portfolio_order_intent_id: intentId, trade_id: tradeId, event_type: eventType, event_at_utc: "2026-08-30T10:05:00.000Z", price: 404 }; }
function trade(intentId, tradeId, resultR) { return { portfolio_order_intent_id: intentId, trade_id: tradeId, status: "closed", result_r: resultR, avg_entry_price: 400, avg_exit_price: 404, opened_at: "2026-08-30T10:00:00.000Z", closed_at: "2026-08-30T10:05:00.000Z" }; }
