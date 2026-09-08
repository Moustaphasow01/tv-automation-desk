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

test("portfolio risk projection exposes authoritative pending portfolio risk state", () => {
  const view = buildPortfolioRiskOverview({
    generatedAt: "2026-08-09T08:00:00.000Z",
    execution: executionOverview({
      portfolioOrderIntents: [portfolioOrderIntent()],
      humanExecutionGates: [{ human_execution_gate_id: "gate-1", portfolio_order_intent_id: "portfolio-intent-1", status: "AWAITING_MANUAL_CONFIRMATION" }],
      locks: [],
    }),
    strategy: strategyOverview(),
    performance: { ok: true, items: [] },
  });

  assert.equal(view.summary.pendingIntents, 2);
  assert.equal(view.summary.pendingTargetPositions, 1);
  assert.equal(view.summary.pendingHumanGates, 1);
  assert.equal(view.portfolio_state.sourceTypes.target, "PENDING");
  assert.equal(view.portfolio_state.pendingTargetPositions[0].targetPositionId, "target-1");
  assert.equal(view.portfolio_state.openRisk.value, 80);
  assert.equal(view.risk_center.availability, "KNOWN");
  assert.equal(view.risk_center.openRisk.value, 80);
  assert.equal(view.risk_center.nearestLimits[0].type, "INSTRUMENT_ABS_SIZE");
  assert.equal(view.portfolio_order_intents[0].risk_snapshot.riskPerContract, 40);
  assert.deepEqual(view.portfolio_order_intents[0].allowed_actions.denialReasons, ["HUMAN_GATE_REQUIRED_FOR_MUTATION"]);
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

test("administrative no-real-exposure resolution removes a legacy theoretical trade from current risk only", () => {
  const view = buildPortfolioRiskOverview({
    generatedAt: "2026-09-08T12:00:00.000Z",
    execution: executionOverview({
      trades: [{
        trade_id: "trade-resolved",
        broker_account_id: "sim101",
        broker_contract_id: "mnq-sep",
        status: "open",
        side: "long",
        quantity_open: 2,
        result_r: null,
        administrative_resolution_status: "ADMINISTRATIVELY_RESOLVED_NO_REAL_EXPOSURE",
      }],
      intents: [],
      orders: [],
      locks: [],
    }),
    strategy: strategyOverview(),
    performance: { ok: true, items: [] },
  });

  assert.equal(view.summary.openTrades, 0);
  assert.deepEqual(view.exposures, []);
  assert.deepEqual(view.portfolio_state.positions, []);
});

test("portfolio risk projection keeps historical targets and shadow parity outside current operational state", () => {
  const view = buildPortfolioRiskOverview({
    generatedAt: "2026-09-08T12:00:00.000Z",
    execution: executionOverview({
      safety: {
        submissionPossible: false,
        executionEnabled: false,
        liveAccountAllowed: false,
        killSwitchEnv: true,
        riskPercent: 0.25,
        maxContracts: 0,
      },
      trades: [],
      intents: [],
      orders: [],
      locks: [{ execution_lock_id: "global_default_kill_switch", scope_value: "*", reason: "Physical execution disabled" }],
      portfolioOrderIntents: [{ ...portfolioOrderIntent(), status: "EXPIRED" }],
      humanExecutionGates: [],
      reconciliations: [{ reconciliation_run_id: "old-match", broker_account_id: "sim101", status: "matched", completed_at: "2026-08-01T12:00:00.000Z" }],
      adapterParityRuns: [{ adapter_parity_run_id: "old-shadow-divergence", broker_account_id: "sim101", status: "diverged", compared_at: "2026-08-02T12:00:00.000Z", metadata: { shadow_only: true } }],
    }),
    strategy: strategyOverview(),
    performance: { ok: true, items: [] },
  });

  assert.equal(view.summary.status, "BROKER_SUBMIT_BLOCKED");
  assert.equal(view.summary.pendingTargetPositions, 0);
  assert.equal(view.summary.reconciliationDivergences, 0);
  assert.equal(view.summary.historicalReconciliationDivergences, 1);
  assert.equal(view.portfolio_state.pendingTargetPositions.length, 0);
  assert.equal(view.controls.some((item) => item.code === "ADAPTER_PARITY_DIVERGED"), false);
  assert.equal(view.controls.some((item) => item.code === "PHYSICAL_EXECUTION_DISABLED_BY_POLICY" && item.severity === "info"), true);
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

function portfolioOrderIntent() {
  return {
    portfolio_order_intent_id: "portfolio-intent-1",
    target_position_id: "target-1",
    target_account_id: "sim101",
    target_instrument: "MNQ",
    net_target_size: 2,
    delta_size: 2,
    risk_approved_net_size: 2,
    quantity: 2,
    status: "READY",
    immutable_terms_hash: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
    execution_terms: { instrument: "MNQ", side: "BUY", quantity: 2, order_type: "LIMIT" },
    risk_snapshot: { authorizedQty: 2, riskAmount: 80, riskPerContract: 40, stopDistance: { points: 20, ticks: 80 }, reasonCodes: ["MAX_RISK_OK"] },
    risk_decisions: [{
      risk_decision_id: "risk-1",
      decision: "APPROVED",
      status: "PASS",
      risk_rule_set_version: "risk-v1",
      reason_codes: ["MAX_RISK_OK"],
      authorized: { risk_amount: 80, risk_pct: 0.16 },
      trade_risk: { risk_per_contract: 40, stop_distance_points: 20, stop_distance_ticks: 80 },
      nearest_limit: { type: "INSTRUMENT_ABS_SIZE", utilization: 0.5 },
      limits: [{ type: "INSTRUMENT_ABS_SIZE", breached: false, resulting_utilization: 0.5 }],
      breaches: [],
    }],
  };
}
