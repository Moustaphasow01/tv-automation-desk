import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PORTFOLIO_CANDIDATE_ALLOCATION_SCHEMA_VERSION_V1,
  PORTFOLIO_STRATEGY_RUNTIME_STATES_V1,
  VIRTUAL_STRATEGY_PORTFOLIO_SCHEMA_VERSION_V1,
  buildCandidateAllocationPortfolioV1,
  buildVirtualStrategyPortfolioV1,
} from "../index.js";

describe("portfolio candidate allocation V1", () => {
  it("nets concurrent strategy signals into one candidate allocation per instrument", () => {
    const plan = buildCandidateAllocationPortfolioV1({
      as_of_utc: "2026-08-09T08:06:00.000Z",
      portfolio_scope: "paper-sim101",
      signals: [
        signal({ signal_id: "sig-long-1", strategy_instance_id: "inst-a", direction: "LONG", proposed_size: 2 }),
        signal({ signal_id: "sig-short-1", strategy_instance_id: "inst-b", direction: "SHORT", proposed_size: 1 }),
      ],
    });

    assert.equal(plan.schema_version, PORTFOLIO_CANDIDATE_ALLOCATION_SCHEMA_VERSION_V1);
    assert.equal(plan.status, "ALLOCATED");
    assert.equal(plan.candidate_allocations.length, 1);
    assert.equal(plan.candidate_allocations[0].net_direction, "LONG");
    assert.equal(plan.candidate_allocations[0].proposed_size, 1);
    assert.equal(plan.candidate_allocations[0].conflict_status, "OPPOSING_SIGNALS_NETTED");
    assert.equal(plan.arbitration_summary.conflict_count, 1);
    assert.deepEqual(plan.candidate_allocations[0].signal_ids, ["sig-long-1", "sig-short-1"]);
    assert.equal(plan.virtual_portfolio.totals.proposed_abs_size, 3);
    assert.match(plan.plan_hash, /^sha256:[a-f0-9]{64}$/);
  });

  it("keeps an auditable flat allocation when opposite signals neutralize each other", () => {
    const plan = buildCandidateAllocationPortfolioV1({
      as_of_utc: "2026-08-09T08:06:00.000Z",
      signals: [
        signal({ signal_id: "sig-long-1", strategy_instance_id: "inst-a", direction: "LONG", proposed_size: 1 }),
        signal({ signal_id: "sig-short-1", strategy_instance_id: "inst-b", direction: "SHORT", proposed_size: 1 }),
      ],
    });

    assert.equal(plan.candidate_allocations[0].status, "NEUTRALIZED");
    assert.equal(plan.candidate_allocations[0].conflict_status, "NEUTRALIZED_CONFLICT");
    assert.equal(plan.candidate_allocations[0].net_direction, "FLAT");
    assert.equal(plan.candidate_allocations[0].proposed_size, 0);
    assert.equal(plan.candidate_allocations[0].strategy_instance_count, 2);
  });

  it("does not merge simultaneous MNQ signals across different accounts", () => {
    const plan = buildCandidateAllocationPortfolioV1({
      as_of_utc: "2026-08-09T08:06:00.000Z",
      account_id: "paper-sim101",
      signals: [
        signal({ signal_id: "sig-a", account_id: "paper-sim101", strategy_instance_id: "inst-a", direction: "LONG", proposed_size: 1 }),
        signal({ signal_id: "sig-b", account_id: "paper-sim102", strategy_instance_id: "inst-b", direction: "LONG", proposed_size: 1 }),
      ],
    });

    assert.equal(plan.candidate_allocations.length, 2);
    assert.deepEqual(plan.candidate_allocations.map((item) => item.account_id).sort(), ["paper-sim101", "paper-sim102"]);
    assert.ok(plan.candidate_allocations.every((item) => item.instrument === "MNQ"));
    assert.equal(plan.arbitration_summary.allocation_count, 2);
    assert.deepEqual(plan.arbitration_summary.account_ids.sort(), ["paper-sim101", "paper-sim102"]);
  });

  it("rejects suspended and disabled strategy instances before allocation", () => {
    const plan = buildCandidateAllocationPortfolioV1({
      as_of_utc: "2026-08-09T08:06:00.000Z",
      signals: [
        signal({ signal_id: "sig-disabled", strategy_instance_id: "inst-disabled" }),
        signal({ signal_id: "sig-suspended", strategy_instance_id: "inst-suspended" }),
        signal({ signal_id: "sig-active", strategy_instance_id: "inst-active" }),
      ],
      policy: {
        strategy_instance_states: {
          "inst-disabled": "DISABLED",
          "inst-suspended": { runtime_state: "SUSPENDED" },
        },
      },
    });

    assert.deepEqual(PORTFOLIO_STRATEGY_RUNTIME_STATES_V1, ["ACTIVE", "SUSPENDED", "DISABLED"]);
    assert.equal(plan.candidate_allocations.length, 1);
    assert.deepEqual(plan.candidate_allocations[0].signal_ids, ["sig-active"]);
    assert.ok(plan.rejected_signals.some((item) => item.issues.some((issue) => issue.code === "STRATEGY_INSTANCE_DISABLED")));
    assert.ok(plan.rejected_signals.some((item) => item.issues.some((issue) => issue.code === "STRATEGY_INSTANCE_SUSPENDED")));
  });

  it("computes virtual portfolio exposure and R result by strategy instance", () => {
    const snapshot = buildVirtualStrategyPortfolioV1({
      as_of_utc: "2026-08-09T08:06:00.000Z",
      portfolio_scope: "paper-sim101",
      positions: [
        position({ position_id: "pos-a", strategy_instance_id: "inst-a", instrument: "MNQ", direction: "LONG", size: 2, entry_price: 100, mark_price: 102, initial_risk_points: 4 }),
        position({ position_id: "pos-b", strategy_instance_id: "inst-b", instrument: "MES", direction: "SHORT", size: 1, entry_price: 5000, mark_price: 4995, initial_risk_points: 10, realized_r: 0.25 }),
      ],
    });

    assert.equal(snapshot.schema_version, VIRTUAL_STRATEGY_PORTFOLIO_SCHEMA_VERSION_V1);
    assert.equal(snapshot.totals.open_abs_size, 3);
    assert.equal(snapshot.totals.unrealized_r, 1.5);
    assert.equal(snapshot.totals.realized_r, 0.25);
    assert.equal(snapshot.totals.total_r, 1.75);
    assert.equal(snapshot.by_strategy_instance.find((item) => item.strategy_instance_id === "inst-a").total_r, 1);
    assert.match(snapshot.portfolio_hash, /^sha256:[a-f0-9]{64}$/);
  });

  it("rejects expired flat or inactive signals without fabricating an allocation", () => {
    const plan = buildCandidateAllocationPortfolioV1({
      as_of_utc: "2026-08-09T08:16:00.000Z",
      signals: [
        signal({ signal_id: "sig-expired", expires_at_utc: "2026-08-09T08:15:00.000Z" }),
        signal({ signal_id: "sig-flat", direction: "FLAT" }),
        signal({ signal_id: "sig-failed", status: "FAILED" }),
      ],
    });

    assert.equal(plan.status, "NO_ACTIVE_SIGNALS");
    assert.equal(plan.candidate_allocations.length, 0);
    assert.equal(plan.rejected_signals.length, 3);
    assert.ok(plan.rejected_signals.some((item) => item.issues.some((issue) => issue.code === "SIGNAL_EXPIRED")));
    assert.ok(plan.rejected_signals.some((item) => item.issues.some((issue) => issue.code === "SIGNAL_FLAT_NOT_ALLOCATABLE")));
    assert.ok(plan.rejected_signals.some((item) => item.issues.some((issue) => issue.code === "SIGNAL_STATUS_NOT_ACTIVE")));
  });

  it("floors a versioned context multiplier and refuses an insufficient single contract", () => {
    const plan = buildCandidateAllocationPortfolioV1({
      as_of_utc: "2026-08-09T08:06:00.000Z",
      signals: [signal({
        proposed_size: 1,
        context_risk_multiplier: 0.85,
        context_risk_multiplier_source: "us-grains-context-v1",
      })],
    });

    assert.equal(plan.candidate_allocations.length, 0);
    const issues = plan.rejected_signals[0].issues.map((item) => item.code);
    assert.ok(issues.includes("CONTEXT_RISK_MULTIPLIER_ZERO_SIZE"));
    assert.ok(issues.includes("SIGNAL_SIZE_NOT_POSITIVE"));
  });

  it("preserves the requested contract for explicit monetary sizing while retaining multiplier evidence", () => {
    const plan = buildCandidateAllocationPortfolioV1({
      as_of_utc: "2026-08-09T08:06:00.000Z",
      policy: { sizing_mode: "MONETARY_RISK_BUDGET" },
      signals: [signal({
        proposed_size: 1,
        context_risk_multiplier: 0.85,
        context_risk_multiplier_source: "us-grains-context-v1",
      })],
    });

    assert.equal(plan.candidate_allocations.length, 1);
    assert.equal(plan.candidate_allocations[0].proposed_size, 1);
    assert.equal(plan.candidate_allocations[0].sizing_mode, "MONETARY_RISK_BUDGET");
    assert.equal(plan.candidate_allocations[0].contributing_signals[0].context_risk_multiplier, 0.85);
  });

  it("rejects a reduced multiplier without deterministic provenance", () => {
    const plan = buildCandidateAllocationPortfolioV1({
      as_of_utc: "2026-08-09T08:06:00.000Z",
      signals: [signal({ proposed_size: 3, context_risk_multiplier: 0.5 })],
    });

    assert.equal(plan.candidate_allocations.length, 0);
    assert.ok(plan.rejected_signals[0].issues.some((item) => item.code === "CONTEXT_RISK_MULTIPLIER_PROVENANCE_REQUIRED"));
  });

  it("keeps an explicit zero quantity at zero instead of defaulting one contract", () => {
    const plan = buildCandidateAllocationPortfolioV1({
      as_of_utc: "2026-08-09T08:06:00.000Z",
      signals: [signal({ proposed_size: 0 })],
    });

    assert.equal(plan.candidate_allocations.length, 0);
    assert.ok(plan.rejected_signals[0].issues.some((item) => item.code === "SIGNAL_SIZE_NOT_POSITIVE"));
  });
});

function signal(overrides = {}) {
  return {
    signal_id: "sig-long-1",
    strategy_instance_id: "inst-a",
    strategy_version_id: "ver-a",
    instrument: "MNQ",
    direction: "LONG",
    proposed_size: 1,
    execution_mode_origin: "PAPER",
    generated_at_utc: "2026-08-09T08:00:00.000Z",
    expires_at_utc: "2026-08-09T08:15:00.000Z",
    correlation_id: "corr-1",
    status: "PENDING",
    ...overrides,
  };
}

function position(overrides = {}) {
  return {
    position_id: "pos-a",
    strategy_instance_id: "inst-a",
    instrument: "MNQ",
    direction: "LONG",
    size: 1,
    entry_price: 100,
    mark_price: 101,
    initial_risk_points: 4,
    realized_r: 0,
    ...overrides,
  };
}
