import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCandidateAllocationPortfolioV1,
  buildPortfolioOrderIntentPlanV1,
  buildPortfolioTargetPositionPlanV1,
  evaluatePortfolioRiskBudgetV1,
} from "../index.js";

const asOf = "2026-08-13T09:15:00.000Z";

describe("global risk mandatory pipeline V1", () => {
  it("ACCEPT: StrategySignal -> Portfolio -> Risk -> TargetPosition -> OrderIntent", () => {
    const pipeline = runPipeline({
      signals: [signal({ signal_id: "sig-accept", direction: "LONG", proposed_size: 2 })],
      budget: budget({ max_instrument_abs_size: { MNQ: 4 } }),
    });

    assert.equal(pipeline.allocations.candidate_allocations.length, 1);
    assert.equal(pipeline.risk.status, "PASS");
    assert.equal(pipeline.targets.target_positions.length, 1);
    assert.equal(pipeline.targets.target_positions[0].net_target_size, 2);
    assert.equal(pipeline.intents.order_intents.length, 1);
    assert.equal(pipeline.intents.order_intents[0].quantity, 2);
    assert.equal(pipeline.intents.order_intents[0].broker_submission_allowed, true);
    assertLineage(pipeline);
  });

  it("ACCEPT with trade plan: carries economics through Risk, TargetPosition and immutable OrderIntent", () => {
    const pipeline = runPipeline({
      signals: [signal({
        signal_id: "sig-trade-plan",
        direction: "LONG",
        proposed_size: 2,
        proposed_trade_plan: {
          instrument: "MNQ",
          direction: "LONG",
          order_type: "LIMIT",
          entry_price: 28000,
          stop_price: 27980,
          targets: [{ label: "T1", price: 28060 }],
          time_in_force: "DAY",
        },
      })],
      budget: budget({ max_instrument_abs_size: { MNQ: 4 } }),
      accountCapitalReference: { source: "TEST_ACCOUNT_SNAPSHOT", value: 100000, currency: "USD", as_of_utc: asOf },
    });

    const risk = pipeline.risk.allocation_evaluations[0];
    const target = pipeline.targets.target_positions[0];
    const intent = pipeline.intents.order_intents[0];
    assert.equal(risk.trade_risk.risk_per_contract, 40);
    assert.equal(risk.authorized.risk_amount, 80);
    assert.equal(risk.authorized.risk_pct, 0.08);
    assert.equal(target.approved_trade_plan.entry.price, 28000);
    assert.equal(target.risk_allocation.risk_amount, 80);
    assert.equal(intent.order_type, "LIMIT");
    assert.equal(intent.entry.price, 28000);
    assert.equal(intent.protection.stop_price, 27980);
    assert.equal(intent.targets[0].price, 28060);
    assert.equal(intent.immutability.policy, "REJECT_AND_REPLAN");
    assert.equal(intent.immutability.mutable_after_risk, false);
    assert.match(intent.immutable_terms_hash, /^sha256:[a-f0-9]{64}$/);
    assertLineage(pipeline);
  });

  it("keeps risk percent unknown through TargetPosition and OrderIntent when capital is unavailable", () => {
    const pipeline = runPipeline({
      signals: [signal({
        signal_id: "sig-unknown-capital", direction: "LONG", proposed_size: 1,
        proposed_trade_plan: {
          instrument: "MNQ", direction: "LONG", order_type: "LIMIT", entry_price: 28000,
          stop_price: 27980, targets: [{ label: "T1", price: 28060 }], time_in_force: "DAY",
        },
      })],
      budget: budget({ max_instrument_abs_size: { MNQ: 4 } }),
    });

    const risk = pipeline.risk.allocation_evaluations[0];
    const target = pipeline.targets.target_positions[0];
    const intent = pipeline.intents.order_intents[0];
    assert.equal(risk.authorized.risk_pct, null);
    assert.equal(target.risk_allocation.risk_pct, null);
    assert.equal(intent.risk_snapshot.requested_risk_pct, null);
    assert.equal(intent.risk_snapshot.authorized_risk_pct, null);
  });

  it("fails closed in monetary mode when one contributing signal lacks trade economics", () => {
    const pipeline = runPipeline({
      signals: [
        signal({ signal_id: "sig-economics", proposed_trade_plan: { instrument: "MNQ", direction: "LONG", order_type: "LIMIT", entry_price: 28000, stop_price: 27980, targets: [{ label: "T1", price: 28060 }], time_in_force: "DAY" } }),
        signal({ signal_id: "sig-no-economics" }),
      ],
      candidatePolicy: { sizing_mode: "MONETARY_RISK_BUDGET" },
      budget: { ...budget({ max_instrument_abs_size: { MNQ: 4 } }), sizing_mode: "MONETARY_RISK_BUDGET", max_monetary_risk: 500, max_monetary_risk_currency: "USD", monetary_risk_scope: "PER_ALLOCATION" },
    });

    assert.equal(pipeline.risk.allocation_evaluations[0].status, "BLOCK");
    assert.ok(pipeline.risk.allocation_evaluations[0].reason_codes.includes("MONETARY_RISK_PER_CONTRACT_UNAVAILABLE"));
    assert.equal(pipeline.targets.target_positions.length, 0);
    assert.equal(pipeline.intents.order_intents.length, 0);
  });

  it("REDUCE: requested +10 is reduced by Global Risk to +4 before OrderIntent", () => {
    const pipeline = runPipeline({
      signals: [signal({ signal_id: "sig-reduce", direction: "LONG", proposed_size: 10 })],
      budget: budget({ max_instrument_abs_size: { MNQ: 4 } }),
    });

    assert.equal(pipeline.risk.status, "REDUCE");
    assert.equal(pipeline.risk.allocation_evaluations[0].approved_size, 4);
    assert.equal(pipeline.targets.target_positions[0].net_target_size, 4);
    assert.equal(pipeline.targets.target_positions[0].risk_approved_net_size, 4);
    assert.equal(pipeline.intents.order_intents.length, 1);
    assert.equal(pipeline.intents.order_intents[0].quantity, 4);
    assert.equal(pipeline.intents.order_intents[0].target_net_size, 4);
    assertLineage(pipeline);
  });

  it("REJECT: kill switch/drawdown equivalent Risk block creates zero executable OrderIntent", () => {
    const pipeline = runPipeline({
      signals: [signal({ signal_id: "sig-reject", direction: "LONG", proposed_size: 5 })],
      budget: budget({ max_daily_loss_r: 1 }),
      virtualPortfolio: { totals: { total_r: -2 } },
    });

    assert.equal(pipeline.risk.status, "BLOCK");
    assert.equal(pipeline.risk.allocation_evaluations[0].decision, "REJECTED");
    assert.equal(pipeline.targets.target_positions.length, 0);
    assert.equal(pipeline.targets.skipped_allocations[0].reason, "RISK_BLOCK_NO_APPROVED_SIZE");
    assert.equal(pipeline.intents.order_intents.length, 0);
    assert.equal(pipeline.intents.status, "NO_TARGETS");
  });

  it("CONFLICT: opposite strategy signals net into one physical target and one OrderIntent", () => {
    const pipeline = runPipeline({
      signals: [
        signal({ signal_id: "sig-conflict-long", strategy_instance_id: "strategy-a", direction: "LONG", proposed_size: 3 }),
        signal({ signal_id: "sig-conflict-short", strategy_instance_id: "strategy-b", direction: "SHORT", proposed_size: 2 }),
      ],
      budget: budget({ max_instrument_abs_size: { MNQ: 4 }, max_strategy_abs_size: { "strategy-a": 3, "strategy-b": 2 } }),
    });

    assert.equal(pipeline.allocations.candidate_allocations.length, 1);
    assert.equal(pipeline.allocations.candidate_allocations[0].long_size, 3);
    assert.equal(pipeline.allocations.candidate_allocations[0].short_size, 2);
    assert.equal(pipeline.allocations.candidate_allocations[0].proposed_size, 1);
    assert.equal(pipeline.targets.target_positions[0].net_target_size, 1);
    assert.equal(pipeline.intents.order_intents.length, 1);
    assert.equal(pipeline.intents.order_intents[0].quantity, 1);
    assertLineage(pipeline);
  });

  it("DUPLICATE: replaying the same approved target does not create a second physical OrderIntent", () => {
    const first = runPipeline({
      signals: [signal({ signal_id: "sig-duplicate", direction: "LONG", proposed_size: 2 })],
      budget: budget({ max_instrument_abs_size: { MNQ: 4 } }),
    });
    const replay = runPipeline({
      signals: [signal({ signal_id: "sig-duplicate", direction: "LONG", proposed_size: 2 })],
      budget: budget({ max_instrument_abs_size: { MNQ: 4 } }),
      existingOrderIntents: first.intents.order_intents,
    });

    assert.equal(first.intents.order_intents.length, 1);
    assert.equal(replay.intents.order_intents.length, 0);
    assert.equal(replay.intents.skipped_targets[0].reason, "DUPLICATE_INTENT_EXISTS");
    assert.equal(replay.intents.skipped_targets[0].idempotency_key, first.intents.order_intents[0].idempotency_key);
  });

  it("FAIL-CLOSED: Risk unavailable blocks TargetPosition and therefore OrderIntent", () => {
    const allocations = buildCandidateAllocationPortfolioV1({
      as_of_utc: asOf,
      signals: [signal({ signal_id: "sig-no-risk", direction: "LONG", proposed_size: 1 })],
    });
    const targets = buildPortfolioTargetPositionPlanV1({
      as_of_utc: asOf,
      account_id: "paper-sim101",
      candidate_allocations: allocations.candidate_allocations,
      risk_budget_evaluation: { status: "CONFIG_MISSING", allocation_evaluations: [] },
    });
    const intents = buildPortfolioOrderIntentPlanV1({
      as_of_utc: asOf,
      target_position_plan: targets,
      execution_policy: executionPolicy(),
      default_protection_plan: protection(),
    });

    assert.equal(targets.target_positions.length, 0);
    assert.equal(targets.skipped_allocations[0].reason, "GLOBAL_RISK_UNAVAILABLE");
    assert.equal(intents.order_intents.length, 0);
    assert.equal(intents.status, "NO_TARGETS");
  });
});

function runPipeline({ signals, budget: riskBudget, virtualPortfolio = {}, currentPositions = [], existingOrderIntents = [], accountCapitalReference = null, candidatePolicy = null }) {
  const allocations = buildCandidateAllocationPortfolioV1({ as_of_utc: asOf, portfolio_scope: "paper-sim101", signals, policy: candidatePolicy });
  const risk = evaluatePortfolioRiskBudgetV1({
    as_of_utc: asOf,
    account_id: "paper-sim101",
    budget: riskBudget,
    candidate_allocations: allocations.candidate_allocations,
    virtual_portfolio: { ...allocations.virtual_portfolio, ...virtualPortfolio },
    account_capital_reference: accountCapitalReference,
  });
  const targets = buildPortfolioTargetPositionPlanV1({
    as_of_utc: asOf,
    account_id: "paper-sim101",
    candidate_allocations: allocations.candidate_allocations,
    risk_budget_evaluation: risk,
    current_positions: currentPositions,
  });
  const intents = buildPortfolioOrderIntentPlanV1({
    as_of_utc: asOf,
    target_position_plan: targets,
    execution_policy: executionPolicy(),
    default_protection_plan: protection(),
    existing_order_intents: existingOrderIntents,
  });
  return { allocations, risk, targets, intents };
}

function assertLineage({ allocations, risk, targets, intents }) {
  const allocation = allocations.candidate_allocations[0];
  const riskDecision = risk.allocation_evaluations[0];
  const target = targets.target_positions[0];
  const intent = intents.order_intents[0];
  assert.equal(target.candidate_allocation_ids[0], allocation.id);
  assert.equal(target.derived_from_risk_decision_ids[0], riskDecision.risk_decision_id);
  assert.equal(intent.target_position_id, target.id);
  assert.equal(intent.source.target_position_id, target.id);
  assert.deepEqual(intent.source.risk_decision_ids, target.derived_from_risk_decision_ids);
  assert.deepEqual(intent.source.candidate_allocation_ids, target.candidate_allocation_ids);
}

function signal(overrides = {}) {
  return {
    signal_id: "sig-1",
    strategy_instance_id: "strategy-a",
    strategy_version_id: "strategy-version-a",
    instrument: "MNQ",
    direction: "LONG",
    proposed_size: 1,
    generated_at_utc: "2026-08-13T09:14:00.000Z",
    expires_at_utc: "2026-08-13T09:30:00.000Z",
    status: "ACTIVE",
    ...overrides,
  };
}

function budget(overrides = {}) {
  return {
    budget_id: "risk-budget-test",
    max_portfolio_abs_size: 10,
    max_account_abs_size: { "paper-sim101": 10 },
    max_instrument_abs_size: { MNQ: 10, MES: 10 },
    ...overrides,
  };
}

function executionPolicy(overrides = {}) {
  return {
    provider_id: "provider-neutral-test",
    broker_account_id: "paper-sim101",
    submission_enabled: true,
    order_type: "LIMIT",
    time_in_force: "DAY",
    ...overrides,
  };
}

function protection(overrides = {}) {
  return {
    stop_price: 27900,
    target_price: 28100,
    max_slippage_ticks: 4,
    ...overrides,
  };
}
