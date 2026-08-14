import assert from "node:assert/strict";
import test from "node:test";
import { buildPortfolioRiskOverview } from "../src/front-portfolio-risk-projection.js";

test("portfolio risk projection summarizes real execution and strategy sources", () => {
  const view = buildPortfolioRiskOverview({
    generatedAt: "2026-08-09T08:00:00.000Z",
    execution: executionOverview(),
    strategy: strategyOverview(),
    performance: { ok: true, items: [] },
  });

  assert.equal(view.contract, "DeskPortfolioRiskOverview");
  assert.equal(view.source.status, "ready");
  assert.equal(view.summary.status, "ACTION_REQUIRED");
  assert.equal(view.summary.openTrades, 1);
  assert.equal(view.summary.pendingIntents, 1);
  assert.equal(view.accounts[0].capital_source, "broker_snapshot");
  assert.equal(view.exposures[0].instrument_code, "MNQ");
  assert.equal(view.exposures[0].net_open_quantity, 1);
  assert.equal(view.exposures[0].pending_sell_quantity, 1);
  assert.equal(view.strategy_concentration[0].status, "REVIEW_SIMILARITY");
  assert.equal(view.actions.find((item) => item.action_id === "portfolio_risk_write_gate").enabled, false);
});

test("portfolio risk projection keeps partial source failures visible", () => {
  const view = buildPortfolioRiskOverview({
    generatedAt: "2026-08-09T08:00:00.000Z",
    execution: executionOverview({ locks: [] }),
    errors: [{ source: "strategy", code: "STRATEGY_TIMEOUT", message: "timeout" }],
  });

  assert.equal(view.source.status, "partial");
  assert.equal(view.source.reads.find((item) => item.source === "strategy").error_code, "STRATEGY_TIMEOUT");
  assert.equal(view.controls.some((item) => item.code === "SOURCE_UNAVAILABLE"), true);
  assert.equal(view.summary.status, "ACTION_REQUIRED");
});

function executionOverview(overrides = {}) {
  return {
    safety: { submissionPossible: true, liveAccountAllowed: false, riskPercent: 0.25, maxContracts: 5 },
    accounts: [{ broker_account_id: "sim101", account_label: "Sim101", mode: "paper", read_only: false, order_submission_enabled: true, max_contracts: 5 }],
    accountSnapshots: [{ broker_account_id: "sim101", captured_at: "2026-08-09T07:59:00.000Z", cash_value: 50_000, payload: { net_liquidation_value: 50_500 } }],
    policies: [{ enabled: true, risk_per_trade_pct: 0.25, allowed_accounts: ["sim101"], fallback_capital_enabled: false }],
    contracts: [{ broker_contract_id: "mnq-sep", instrument_code: "MNQ", broker_symbol: "MNQ 09-26" }],
    trades: [{ trade_id: "trade-1", broker_account_id: "sim101", broker_contract_id: "mnq-sep", status: "open", side: "long", quantity_open: 1 }],
    intents: [{ order_intent_id: "intent-1", broker_account_id: "sim101", broker_contract_id: "mnq-sep", status: "queued", approval_status: "approved", side: "sell", quantity: 1, expires_at: null }],
    orders: [{ broker_order_id: "order-1", broker_account_id: "sim101", broker_contract_id: "mnq-sep", status: "working", quantity: 1 }],
    locks: [{ execution_lock_id: "lock-1", scope_value: "sim101", reason: "operator hold" }],
    reconciliations: [],
    adapterParityRuns: [],
    ...overrides,
  };
}

function strategyOverview() {
  return {
    instances: [
      { strategy_instance_id: "a", execution_mode: "PAPER", runtime_state: "RUNNING", instrument_scope: ["MNQ"] },
      { strategy_instance_id: "b", execution_mode: "PAPER", runtime_state: "RUNNING", instrument_scope: ["MNQ"] },
    ],
  };
}
