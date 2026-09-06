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

  it("reduces the monetary budget before contract flooring and never increases the requested size", () => {
    const evaluation = evaluatePortfolioRiskBudgetV1({
      as_of_utc: "2026-08-09T08:10:00.000Z",
      budget: monetaryBudget(250),
      candidate_allocations: [allocation({ sizing_mode: "MONETARY_RISK_BUDGET", proposed_size: 3, contributing_signals: [economicSignal({ multiplier: 0.85, risk: 100 })] })],
      virtual_portfolio: portfolioFixture(),
    });

    const decision = evaluation.allocation_evaluations[0];
    assert.equal(decision.status, "REDUCE");
    assert.equal(decision.requested_size, 3);
    assert.equal(decision.sized_size, 2);
    assert.equal(decision.approved_size, 2);
    assert.equal(decision.sizing.effective_monetary_risk_budget, 212.5);
  });

  it("refuses rather than inventing one contract when the reduced monetary budget is insufficient", () => {
    const evaluation = evaluatePortfolioRiskBudgetV1({
      as_of_utc: "2026-08-09T08:10:00.000Z",
      budget: monetaryBudget(100),
      candidate_allocations: [allocation({ sizing_mode: "MONETARY_RISK_BUDGET", proposed_size: 1, contributing_signals: [economicSignal({ multiplier: 0.85, risk: 200 })] })],
      virtual_portfolio: portfolioFixture(),
    });

    const decision = evaluation.allocation_evaluations[0];
    assert.equal(decision.status, "BLOCK");
    assert.equal(decision.approved_size, 0);
    assert.ok(decision.reason_codes.includes("INSUFFICIENT_MIN_CONTRACT"));
  });

  it("never turns a hard loss or exposure block into a monetary sizing reduction", () => {
    for (const limits of [
      { max_daily_loss_r: 2 },
      { max_weekly_loss_r: 2 },
      { max_portfolio_abs_size: 1 },
      { max_instrument_abs_size: { MNQ: 1 } },
    ]) {
      const evaluation = evaluatePortfolioRiskBudgetV1({
        as_of_utc: "2026-08-09T08:10:00.000Z",
        budget: { ...monetaryBudget(250), ...limits },
        candidate_allocations: [allocation({ sizing_mode: "MONETARY_RISK_BUDGET", proposed_size: 3, contributing_signals: [economicSignal({ multiplier: 0.85, risk: 100 })] })],
        virtual_portfolio: portfolioFixture({ total_r: -3, weekly_r: -3, open_abs_size: 1, positions: [position()] }),
      });
      const decision = evaluation.allocation_evaluations[0];
      assert.equal(decision.sizing.reduced, true);
      assert.equal(decision.status, "BLOCK");
      assert.equal(decision.decision, "REJECTED");
      assert.equal(decision.approved_size, 0);
      assert.equal(evaluation.gate.pass, false);
    }
  });

  it("rejects a fractional requested quantity instead of silently rounding it", () => {
    const evaluation = evaluatePortfolioRiskBudgetV1({
      as_of_utc: "2026-08-09T08:10:00.000Z",
      budget: monetaryBudget(1000),
      candidate_allocations: [allocation({ sizing_mode: "MONETARY_RISK_BUDGET", proposed_size: 1.5, contributing_signals: [economicSignal({ multiplier: 1, risk: 100 })] })],
      virtual_portfolio: portfolioFixture(),
    });
    assert.equal(evaluation.allocation_evaluations[0].approved_size, 0);
    assert.equal(evaluation.allocation_evaluations[0].status, "BLOCK");
    assert.ok(evaluation.allocation_evaluations[0].reason_codes.includes("REQUESTED_QUANTITY_INVALID"));
  });

  it("requires explicit per-allocation monetary scope and currency", () => {
    const evaluation = evaluatePortfolioRiskBudgetV1({
      as_of_utc: "2026-08-09T08:10:00.000Z",
      budget: { sizing_mode: "MONETARY_RISK_BUDGET", max_monetary_risk: 100 },
      candidate_allocations: [allocation({ sizing_mode: "MONETARY_RISK_BUDGET", contributing_signals: [economicSignal({ multiplier: 1, risk: 100 })] })],
      virtual_portfolio: portfolioFixture(),
    });

    assert.equal(evaluation.status, "CONFIG_MISSING");
    assert.equal(evaluation.allocation_evaluations.length, 0);
  });

  it("does not ignore declared monetary limits when the sizing mode is omitted", () => {
    const evaluation = evaluatePortfolioRiskBudgetV1({
      as_of_utc: "2026-08-09T08:10:00.000Z",
      budget: { max_monetary_risk: 500, max_daily_loss_monetary: 2000, max_weekly_loss_monetary: 4000, loss_currency: "USD" },
      candidate_allocations: [allocation({ proposed_size: 10 })],
      virtual_portfolio: portfolioFixture(),
    });
    assert.equal(evaluation.status, "CONFIG_MISSING");
    assert.equal(evaluation.allocation_evaluations.length, 0);
  });

  it("blocks monetary sizing when the configured budget currency differs", () => {
    const evaluation = evaluatePortfolioRiskBudgetV1({
      as_of_utc: "2026-08-09T08:10:00.000Z",
      budget: { ...monetaryBudget(100), max_monetary_risk_currency: "EUR" },
      candidate_allocations: [allocation({ sizing_mode: "MONETARY_RISK_BUDGET", contributing_signals: [economicSignal({ multiplier: 1, risk: 100 })] })],
      virtual_portfolio: portfolioFixture(),
    });

    assert.equal(evaluation.allocation_evaluations[0].status, "BLOCK");
    assert.ok(evaluation.allocation_evaluations[0].reason_codes.includes("MONETARY_RISK_CURRENCY_MISMATCH"));
  });

  it("keeps a hard zero contract cap instead of discarding it as missing", () => {
    const evaluation = evaluatePortfolioRiskBudgetV1({
      as_of_utc: "2026-08-09T08:10:00.000Z",
      budget: { max_instrument_abs_size: { MNQ: 0 } },
      candidate_allocations: [allocation({ proposed_size: 1 })],
      virtual_portfolio: portfolioFixture(),
    });

    assert.equal(evaluation.status, "BLOCK");
    assert.equal(evaluation.allocation_evaluations[0].approved_size, 0);
  });

  it("blocks when a cap has less than one whole contract remaining", () => {
    const evaluation = evaluatePortfolioRiskBudgetV1({
      as_of_utc: "2026-08-09T08:10:00.000Z",
      budget: { max_instrument_abs_size: { MNQ: 2 } },
      candidate_allocations: [allocation({ proposed_size: 1 })],
      virtual_portfolio: portfolioFixture({ positions: [position({ signed_size: 1.5 })], open_abs_size: 1.5 }),
    });

    const decision = evaluation.allocation_evaluations[0];
    assert.equal(decision.status, "BLOCK");
    assert.equal(decision.approved_size, 0);
    assert.ok(decision.reason_codes.includes("INSUFFICIENT_WHOLE_CONTRACT_CAPACITY"));
  });

  it("reserves one approved allocation once for repeated signals of one strategy", () => {
    const contribution = (signal_id) => ({ signal_id, strategy_instance_id: "inst-a", proposed_size: 1 });
    const evaluation = evaluatePortfolioRiskBudgetV1({
      as_of_utc: "2026-08-09T08:10:00.000Z",
      budget: { max_strategy_abs_size: { "inst-a": 3 }, max_portfolio_abs_size: 10 },
      candidate_allocations: [
        allocation({ id: "alloc-a", proposed_size: 2, contributing_signals: [contribution("sig-a"), contribution("sig-b")] }),
        allocation({ id: "alloc-b", instrument: "ZC", proposed_size: 1, contributing_signals: [contribution("sig-c")] }),
      ],
      virtual_portfolio: portfolioFixture(),
    });

    assert.equal(evaluation.allocation_evaluations.find((item) => item.candidate_allocation_id === "alloc-a").approved_size, 2);
    assert.equal(evaluation.allocation_evaluations.find((item) => item.candidate_allocation_id === "alloc-b").approved_size, 1);
  });

  it("reserves the USD daily and weekly loss envelope between monetary allocations", () => {
    const evaluation = evaluatePortfolioRiskBudgetV1({
      as_of_utc: "2026-08-09T08:10:00.000Z",
      budget: {
        ...monetaryBudget(500), max_daily_loss_monetary: 2000,
        max_weekly_loss_monetary: 4000, loss_currency: "USD",
      },
      candidate_allocations: [
        allocation({ id: "alloc-a", sizing_mode: "MONETARY_RISK_BUDGET", proposed_size: 5, contributing_signals: [economicSignal({ multiplier: 1, risk: 100 })] }),
        allocation({ id: "alloc-b", instrument: "NQ", sizing_mode: "MONETARY_RISK_BUDGET", proposed_size: 1, contributing_signals: [economicSignal({ multiplier: 1, risk: 100 })] }),
      ],
      loss_usage: monetaryLossUsage({ daily: 1600, weekly: 3500 }),
      virtual_portfolio: portfolioFixture(),
    });

    const first = evaluation.allocation_evaluations.find((item) => item.candidate_allocation_id === "alloc-a");
    const second = evaluation.allocation_evaluations.find((item) => item.candidate_allocation_id === "alloc-b");
    assert.equal(first.approved_size, 4);
    assert.equal(second.approved_size, 0);
    assert.ok(second.reason_codes.includes("DAILY_MONETARY_LOSS_LIMIT_REACHED"));
  });

  it("fails closed when USD monetary loss usage is unavailable or mismatched", () => {
    for (const loss_usage of [
      {},
      monetaryLossUsage({ currency: "EUR" }),
    ]) {
      const evaluation = evaluatePortfolioRiskBudgetV1({
        as_of_utc: "2026-08-09T08:10:00.000Z",
        budget: { ...monetaryBudget(500), max_daily_loss_monetary: 2000, max_weekly_loss_monetary: 4000, loss_currency: "USD" },
        candidate_allocations: [allocation({ sizing_mode: "MONETARY_RISK_BUDGET", contributing_signals: [economicSignal({ multiplier: 1, risk: 100 })] })],
        loss_usage,
        virtual_portfolio: portfolioFixture(),
      });
      assert.equal(evaluation.allocation_evaluations[0].status, "BLOCK");
      assert.ok(evaluation.allocation_evaluations[0].reason_codes.some((code) => code === "MONETARY_LOSS_USAGE_UNAVAILABLE" || code === "MONETARY_LOSS_CURRENCY_MISMATCH"));
    }
  });

  it("does not round a USD loss remainder up to a whole contract", () => {
    const evaluation = evaluatePortfolioRiskBudgetV1({
      as_of_utc: "2026-08-09T08:10:00.000Z",
      budget: { ...monetaryBudget(500), max_daily_loss_monetary: 2000, loss_currency: "USD" },
      candidate_allocations: [allocation({ sizing_mode: "MONETARY_RISK_BUDGET", contributing_signals: [economicSignal({ multiplier: 1, risk: 100 })] })],
      loss_usage: monetaryLossUsage({ daily: 1900.004 }),
      virtual_portfolio: portfolioFixture(),
    });
    assert.equal(evaluation.allocation_evaluations[0].approved_size, 0);
    assert.ok(evaluation.allocation_evaluations[0].reason_codes.includes("INSUFFICIENT_MIN_CONTRACT"));
  });

  it("does not use a USD loss remainder as a contract-cap remainder", () => {
    const evaluation = evaluatePortfolioRiskBudgetV1({
      as_of_utc: "2026-08-09T08:10:00.000Z",
      budget: { ...monetaryBudget(10), max_daily_loss_monetary: 3, loss_currency: "USD" },
      candidate_allocations: [allocation({ sizing_mode: "MONETARY_RISK_BUDGET", proposed_size: 10, contributing_signals: [economicSignal({ multiplier: 1, risk: 0.25 })] })],
      loss_usage: monetaryLossUsage(),
      virtual_portfolio: portfolioFixture(),
    });
    assert.equal(evaluation.allocation_evaluations[0].approved_size, 10);
  });

  it("reserves the risk of the final contract-capped size, not the provisional size", () => {
    const evaluation = evaluatePortfolioRiskBudgetV1({
      as_of_utc: "2026-08-09T08:10:00.000Z",
      budget: { ...monetaryBudget(300), max_daily_loss_monetary: 300, loss_currency: "USD", max_instrument_abs_size: { MNQ: 1 } },
      candidate_allocations: [
        allocation({ id: "alloc-a", sizing_mode: "MONETARY_RISK_BUDGET", proposed_size: 3, contributing_signals: [economicSignal({ multiplier: 1, risk: 100 })] }),
        allocation({ id: "alloc-b", instrument: "NQ", sizing_mode: "MONETARY_RISK_BUDGET", proposed_size: 3, contributing_signals: [economicSignal({ multiplier: 1, risk: 100 })] }),
      ],
      loss_usage: monetaryLossUsage(),
      virtual_portfolio: portfolioFixture(),
    });
    const first = evaluation.allocation_evaluations.find((item) => item.candidate_allocation_id === "alloc-a");
    const second = evaluation.allocation_evaluations.find((item) => item.candidate_allocation_id === "alloc-b");
    assert.equal(first.approved_size, 1);
    assert.equal(first.sizing.authorized_monetary_risk, 100);
    assert.equal(second.approved_size, 2);
  });

  it("rejects boolean monetary caps instead of coercing them to one or zero", () => {
    const evaluation = evaluatePortfolioRiskBudgetV1({
      as_of_utc: "2026-08-09T08:10:00.000Z",
      budget: { ...monetaryBudget(true), max_daily_loss_monetary: false, loss_currency: "USD" },
      candidate_allocations: [allocation({ sizing_mode: "MONETARY_RISK_BUDGET", contributing_signals: [economicSignal({ multiplier: 1, risk: 100 })] })],
      virtual_portfolio: portfolioFixture(),
    });
    assert.equal(evaluation.status, "CONFIG_MISSING");
  });

  it("requires a matching loss currency when monetary daily or weekly caps are configured", () => {
    const evaluation = evaluatePortfolioRiskBudgetV1({
      as_of_utc: "2026-08-09T08:10:00.000Z",
      budget: { ...monetaryBudget(500), max_daily_loss_monetary: 2000 },
      candidate_allocations: [allocation({ sizing_mode: "MONETARY_RISK_BUDGET", contributing_signals: [economicSignal({ multiplier: 1, risk: 100 })] })],
      virtual_portfolio: portfolioFixture(),
    });
    assert.equal(evaluation.status, "CONFIG_MISSING");
  });
});

function economicSignal({ multiplier, risk }) {
  return {
    signal_id: "sig-economic", strategy_instance_id: "inst-a", proposed_size: 1,
    context_risk_multiplier: multiplier,
    trade_plan_economics: {
      availability: "KNOWN", risk_per_contract: risk, currency: "USD", entry_price: 100,
      stop_price: 99, stop_distance_points: 1, stop_distance_ticks: 4, tick_size: 0.25, tick_value: risk / 4,
    },
  };
}

function monetaryBudget(max_monetary_risk) {
  return {
    sizing_mode: "MONETARY_RISK_BUDGET",
    max_monetary_risk,
    max_monetary_risk_currency: "USD",
    monetary_risk_scope: "PER_ALLOCATION",
  };
}

function monetaryLossUsage({ daily = 0, weekly = 0, reserved = 0, currency = "USD" } = {}) {
  return {
    monetary_availability: "KNOWN", currency,
    daily_loss_monetary: daily, weekly_loss_monetary: weekly,
    reserved_monetary_risk: reserved,
  };
}

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
