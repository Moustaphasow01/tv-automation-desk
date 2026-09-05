import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PORTFOLIO_RISK_BUDGET_EVALUATION_SCHEMA_VERSION_V1,
  PORTFOLIO_RISK_BUDGET_SCHEMA_VERSION_V1,
  evaluatePortfolioRiskBudgetV1,
  normalizePortfolioRiskBudgetV1,
} from "../index.js";

describe("portfolio risk budget V1", () => {
  it("normalizes configurable account instrument strategy and correlation budgets", () => {
    const budget = normalizePortfolioRiskBudgetV1({
      budget_id: "budget-paper",
      max_portfolio_abs_size: 5,
      max_account_abs_size: { "paper-sim101": 4 },
      max_instrument_abs_size: { mnq: 2 },
      max_strategy_abs_size: { "inst-a": 2 },
      max_correlation_group_abs_size: { equity_index: 3 },
    });

    assert.equal(budget.schema_version, PORTFOLIO_RISK_BUDGET_SCHEMA_VERSION_V1);
    assert.equal(budget.max_instrument_abs_size.MNQ, 2);
    assert.equal(budget.max_strategy_abs_size["inst-a"], 2);
    assert.equal(budget.max_correlation_group_abs_size.equity_index, 3);
    assert.match(budget.budget_hash, /^sha256:[a-f0-9]{64}$/);
  });

  it("passes a candidate allocation when every projected exposure remains inside budget", () => {
    const evaluation = evaluatePortfolioRiskBudgetV1({
      as_of_utc: "2026-08-09T08:10:00.000Z",
      account_id: "paper-sim101",
      budget: budgetFixture(),
      candidate_allocations: [allocation({ proposed_size: 1 })],
      virtual_portfolio: portfolioFixture({ open_abs_size: 1, total_r: 1.25 }),
    });

    assert.equal(evaluation.schema_version, PORTFOLIO_RISK_BUDGET_EVALUATION_SCHEMA_VERSION_V1);
    assert.equal(evaluation.status, "PASS");
    assert.equal(evaluation.gate.pass, true);
    assert.equal(evaluation.allocation_evaluations[0].approved_size, 1);
  });

  it("reduces an allocation when an instrument budget would be exceeded", () => {
    const evaluation = evaluatePortfolioRiskBudgetV1({
      as_of_utc: "2026-08-09T08:10:00.000Z",
      budget: {
        ...budgetFixture(),
        max_instrument_abs_size: { MNQ: 2 },
      },
      candidate_allocations: [allocation({ proposed_size: 2 })],
      virtual_portfolio: portfolioFixture({ positions: [position({ signed_size: 1 })], open_abs_size: 1 }),
    });

    assert.equal(evaluation.status, "REDUCE");
    assert.equal(evaluation.allocation_evaluations[0].approved_size, 1);
    assert.ok(evaluation.allocation_evaluations[0].limits_applied.includes("INSTRUMENT_ABS_SIZE"));
  });

  it("blocks every allocation when the daily loss budget is already breached", () => {
    const evaluation = evaluatePortfolioRiskBudgetV1({
      as_of_utc: "2026-08-09T08:10:00.000Z",
      budget: { max_daily_loss_r: 2, max_portfolio_abs_size: 5 },
      candidate_allocations: [allocation({ proposed_size: 1 })],
      virtual_portfolio: portfolioFixture({ total_r: -2.2 }),
    });

    assert.equal(evaluation.status, "BLOCK");
    assert.equal(evaluation.gate.pass, false);
    assert.equal(evaluation.allocation_evaluations[0].approved_size, 0);
    assert.ok(evaluation.allocation_evaluations[0].limits_applied.includes("DAILY_LOSS_R"));
  });

  it("detects correlated index exposure across instruments", () => {
    const evaluation = evaluatePortfolioRiskBudgetV1({
      as_of_utc: "2026-08-09T08:10:00.000Z",
      budget: { max_correlation_group_abs_size: { equity_index: 2 } },
      candidate_allocations: [allocation({ instrument: "MNQ", proposed_size: 1 })],
      virtual_portfolio: portfolioFixture({ positions: [position({ instrument: "MES", signed_size: 2 })], open_abs_size: 2 }),
    });

    assert.equal(evaluation.status, "BLOCK");
    assert.equal(evaluation.allocation_evaluations[0].approved_size, 0);
    assert.ok(evaluation.allocation_evaluations[0].limits_applied.includes("CORRELATION_GROUP_ABS_SIZE"));
  });

  it("applies account limits to each allocation account instead of the batch default account", () => {
    const evaluation = evaluatePortfolioRiskBudgetV1({
      as_of_utc: "2026-08-09T08:10:00.000Z",
      account_id: "paper-sim101",
      budget: {
        max_account_abs_size: { "paper-sim101": 1, "paper-sim102": 3 },
        max_portfolio_abs_size: 6,
      },
      candidate_allocations: [
        allocation({ id: "alloc-a", account_id: "paper-sim101", proposed_size: 1 }),
        allocation({ id: "alloc-b", account_id: "paper-sim102", proposed_size: 2 }),
      ],
      virtual_portfolio: portfolioFixture({
        positions: [position({ account_id: "paper-sim101", signed_size: 1 })],
        open_abs_size: 1,
      }),
    });

    assert.equal(evaluation.status, "BLOCK");
    assert.equal(evaluation.allocation_evaluations.find((item) => item.candidate_allocation_id === "alloc-a").status, "BLOCK");
    assert.equal(evaluation.allocation_evaluations.find((item) => item.candidate_allocation_id === "alloc-b").status, "PASS");
    assert.equal(evaluation.allocation_evaluations.find((item) => item.candidate_allocation_id === "alloc-b").account_id, "paper-sim102");
  });

  it("reserves approved portfolio capacity between deterministic allocations in one batch", () => {
    const evaluation = evaluatePortfolioRiskBudgetV1({
      as_of_utc: "2026-08-09T08:10:00.000Z",
      budget: { max_portfolio_abs_size: 1 },
      candidate_allocations: [
        allocation({ id: "alloc-mes", instrument: "MES", proposed_size: 1 }),
        allocation({ id: "alloc-mnq", instrument: "MNQ", proposed_size: 1 }),
      ],
      virtual_portfolio: portfolioFixture(),
    });

    assert.equal(evaluation.allocation_evaluations.find((item) => item.candidate_allocation_id === "alloc-mes").approved_size, 1);
    assert.equal(evaluation.allocation_evaluations.find((item) => item.candidate_allocation_id === "alloc-mnq").approved_size, 0);
    assert.equal(evaluation.status, "BLOCK");
  });

  it("fails closed when no numerical budget is configured", () => {
    const evaluation = evaluatePortfolioRiskBudgetV1({
      as_of_utc: "2026-08-09T08:10:00.000Z",
      candidate_allocations: [allocation()],
      virtual_portfolio: portfolioFixture(),
    });

    assert.equal(evaluation.status, "CONFIG_MISSING");
    assert.equal(evaluation.gate.pass, false);
    assert.equal(evaluation.allocation_evaluations.length, 0);
  });
});

function budgetFixture() {
  return {
    max_portfolio_abs_size: 5,
    max_account_abs_size: { "paper-sim101": 5 },
    max_instrument_abs_size: { MNQ: 3 },
    max_strategy_abs_size: { "inst-a": 3 },
    max_correlation_group_abs_size: { equity_index: 5 },
    max_daily_loss_r: 3,
  };
}

function allocation(overrides = {}) {
  return {
    id: "candalloc-1",
    instrument: "MNQ",
    net_direction: "LONG",
    proposed_size: 1,
    contributing_signals: [{ signal_id: "sig-a", strategy_instance_id: "inst-a", proposed_size: 1 }],
    ...overrides,
  };
}

function portfolioFixture(overrides = {}) {
  const positions = overrides.positions || [];
  return {
    totals: {
      open_abs_size: overrides.open_abs_size || 0,
      total_r: overrides.total_r || 0,
      weekly_r: overrides.weekly_r || overrides.total_r || 0,
    },
    by_strategy_instance: [{ strategy_instance_id: "inst-a", open_signed_size: overrides.strategy_open_size || 0 }],
    positions,
  };
}

function position(overrides = {}) {
  return {
    position_id: "pos-a",
    strategy_instance_id: "inst-a",
    instrument: "MNQ",
    signed_size: 1,
    ...overrides,
  };
}
