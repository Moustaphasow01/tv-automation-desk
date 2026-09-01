import assert from "node:assert/strict";
import test from "node:test";
import { liveCanonicalRuntime, liveTheoreticalLineageCohort, telegramDrilldownFromHealth } from "../src/front-control-plane-domain-completeness.js";

test("live canonical context decisions preserve their StrategySignal lineage", () => {
  const runtime = liveCanonicalRuntime({
    strategy: {
      signals: [{
        signal_id: "sig_lineage_1",
        instrument_code: "MNQ",
        created_at_utc: "2026-08-27T10:00:00.000Z",
      }],
    },
    ai: {
      decisions: [{
        decision_id: "ctx_lineage_1",
        signal_id: "sig_lineage_1",
        status: "RECORDED",
        recommendation: "TAKE",
        decided_at_utc: "2026-08-27T10:01:00.000Z",
      }],
    },
    launchGate: { marketClosed: false, checksById: {}, hasLastKnownMarketData: true },
  });

  assert.equal(runtime.aiContextGate.length, 1);
  assert.equal(runtime.aiContextGate[0].signalId, "sig_lineage_1");
});

test("telegram drilldown preserves a healthy configured worker during an idle delivery cycle", () => {
  const result = telegramDrilldownFromHealth({
    operations: {
      services: [{
        service_id: "telegram_alert_worker",
        service_kind: "telegram_alerting",
        status: "healthy",
        healthy: true,
        heartbeat_at_utc: "2026-08-31T13:00:00.000Z",
        details: {
          environment: { workerEnabled: true, adminConfigured: true, tradingConfigured: true },
          deliveries: [{ status: "idle" }],
        },
      }],
    },
  });

  assert.equal(result.enabled, true);
  assert.equal(result.healthy, true);
  assert.equal(result.deliveryStatus, "IDLE");
  assert.deepEqual(result.destinations.map((item) => [item.label, item.configured]), [["administration", true], ["trading", true]]);
});

test("theoretical lineage retains terminal outcomes after the actionable signal expires", () => {
  const current = { portfolio_order_intent_id: "intent-current", created_at_utc: "2026-09-01T08:00:00.000Z", payload: { strategy_signal_id: "signal-current", strategy_instance_id: "instance-current" } };
  const closed = { portfolio_order_intent_id: "intent-closed", created_at_utc: "2026-08-31T18:00:00.000Z", payload: { strategy_signal_id: "signal-closed", strategy_instance_id: "instance-closed" } };
  const olderClosed = { portfolio_order_intent_id: "intent-older-closed", created_at_utc: "2026-08-24T18:00:00.000Z", payload: { strategy_signal_id: "signal-older-closed", strategy_instance_id: "instance-older-closed" } };
  const unrelated = { portfolio_order_intent_id: "intent-untracked", payload: { strategy_signal_id: "signal-untracked", strategy_instance_id: "instance-untracked" } };
  const certification = { portfolio_order_intent_id: "intent-certification", target_account_id: "shadow_certification", payload: { strategy_signal_id: "signal-certification", strategy_instance_id: "instance-certification" } };
  const result = liveTheoreticalLineageCohort({
    execution: {
      portfolioOrderIntents: [current, closed, olderClosed, unrelated, certification],
      theoreticalEvents: [
        { portfolio_order_intent_id: "intent-closed", event_type: "TARGET_HIT" },
        { portfolio_order_intent_id: "intent-older-closed", event_type: "STOP_HIT" },
      ],
      manualExecutionEvents: [],
      trades: [
        { portfolio_order_intent_id: "intent-closed", status: "closed", result_r: 1.5 },
        { portfolio_order_intent_id: "intent-older-closed", status: "closed", result_r: -1 },
      ],
    },
    currentPortfolioOrderIntents: [current],
  });

  assert.deepEqual(result.map((item) => item.portfolio_order_intent_id), ["intent-current", "intent-closed"]);
});
