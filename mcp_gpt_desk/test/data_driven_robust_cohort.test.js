import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDataDrivenRobustPassCohort,
  renderDataDrivenRobustPassCohortMarkdown,
} from "../src/research/data-driven-robust-cohort.js";

test("robust pass cohort retains every robustness PASS candidate without a top-k cap", () => {
  const candidates = Array.from({ length: 7 }, (_, index) => candidate({
    index,
    family: index % 2 === 0 ? "vwap_deviation_fade_short" : "opening_range_breakout_long",
    totalR: 1 + index,
    robustnessScore: 0.95 - index * 0.01,
  }));

  const cohort = buildDataDrivenRobustPassCohort({
    batchId: "mega-test",
    datasetKey: "dataset-test",
    candidates,
    generatedAtUtc: "2026-08-17T09:00:00.000Z",
  });

  assert.equal(cohort.selection.policy, "ALL_ROBUSTNESS_PASS_NO_TOP_K_CAP");
  assert.equal(cohort.selection.top_k_cap, null);
  assert.equal(cohort.selection.retained_count, 7);
  assert.equal(cohort.retained_candidates.length, 7);
  assert.deepEqual(cohort.retained_candidates.map((item) => item.candidate_key), candidates.map((item) => item.candidate_key));
  assert.equal(cohort.safety.broker_execution_enabled, false);
  assert.equal(cohort.safety.automatic_promotion_enabled, false);
});

test("robust pass cohort separates robustness retention from OOS and promotion readiness", () => {
  const cohort = buildDataDrivenRobustPassCohort({
    batchId: "mega-test",
    datasetKey: "dataset-test",
    candidates: [
      candidate({ index: 1, oosVerdict: "PASS", promotionDecision: "NEEDS_OPERATOR_APPROVAL" }),
      candidate({ index: 2, oosVerdict: "FAIL", promotionDecision: "REJECT_PROMOTION", promotionReasons: ["OOS_FAILED"] }),
    ],
    generatedAtUtc: "2026-08-17T09:00:00.000Z",
  });

  assert.equal(cohort.selection.retained_count, 2);
  assert.equal(cohort.selection.oos_pass_count, 1);
  assert.equal(cohort.selection.oos_not_pass_count, 1);
  assert.equal(cohort.blocker_summary.reason_counts.OOS_FAIL, 1);
  assert.ok(cohort.cohort_gate.reasons.includes("COHORT_HAS_ROBUSTNESS_PASS_CANDIDATES_WITHOUT_OOS_PASS"));
});

test("robust pass cohort computes portfolio-level daily activity and correlation", () => {
  const cohort = buildDataDrivenRobustPassCohort({
    batchId: "mega-test",
    datasetKey: "dataset-test",
    candidates: [
      candidate({ index: 1, positions: positions([1, -0.5, 2, 0.25]) }),
      candidate({ index: 2, positions: positions([-0.25, 1, 1.5, -0.5]) }),
      candidate({ index: 3, positions: positions([0.75, 0.5, -1, 1]) }),
    ],
    generatedAtUtc: "2026-08-17T09:00:00.000Z",
  });

  assert.equal(cohort.aggregate.closed_trade_count, 12);
  assert.equal(cohort.aggregate.trading_days_with_activity, 4);
  assert.equal(cohort.aggregate.max_same_day_candidate_activity, 3);
  assert.equal(cohort.daily_correlation.pair_count, 3);
  assert.equal(cohort.daily_correlation.computable_pair_count, 3);
  assert.equal(typeof cohort.daily_correlation.max_abs_correlation, "number");
});

test("robust pass cohort markdown is copyable and explicit about research-only safety", () => {
  const cohort = buildDataDrivenRobustPassCohort({
    batchId: "mega-test",
    candidates: [candidate({ index: 1 })],
    generatedAtUtc: "2026-08-17T09:00:00.000Z",
  });
  const markdown = renderDataDrivenRobustPassCohortMarkdown(cohort);

  assert.match(markdown, /Top-K cap: \*\*none\*\*/);
  assert.match(markdown, /Retained candidates — all robustness PASS/);
  assert.match(markdown, /research-only/i);
});

function candidate({
  index = 1,
  family = "opening_range_breakout_long",
  totalR = 3,
  robustnessScore = 0.9,
  oosVerdict = "PASS",
  promotionDecision = "NEEDS_OPERATOR_APPROVAL",
  promotionReasons = ["OPERATOR_APPROVAL_PENDING"],
  positions: suppliedPositions = positions([totalR]),
} = {}) {
  const padded = String(index + 1).padStart(3, "0");
  return {
    research_candidate_id: `candidate-${padded}`,
    candidate_key: `mega-test.${family}.v${padded}`,
    strategy_version_id: `strategy-version-${padded}`,
    simulation_run_id: `simulation-run-${padded}`,
    family_id: family,
    variant_index: index + 1,
    robustness_verdict: "PASS",
    robustness_score: robustnessScore,
    robustness_metrics: {
      total_r: totalR,
      trade_count: suppliedPositions.length,
      max_drawdown_r: -1,
      profit_factor: 2,
    },
    oos_verdict: oosVerdict,
    oos_score: oosVerdict === "PASS" ? 0.8 : 0.3,
    promotion_verdict: promotionDecision === "NEEDS_OPERATOR_APPROVAL" ? "NEEDS_REVIEW" : "FAIL",
    promotion_decision: promotionDecision,
    promotion_reasons: promotionReasons,
    portfolio_fit_reasons: ["PORTFOLIO_RISK_BUDGET_NOT_PROVEN"],
    positions: suppliedPositions,
  };
}

function positions(results) {
  return results.map((result, index) => {
    const day = String(index + 1).padStart(2, "0");
    return {
      position_id: `p-${day}`,
      status: "CLOSED",
      entry_time: `2026-06-${day}T09:30:00.000Z`,
      exit_time: `2026-06-${day}T10:30:00.000Z`,
      r_result: result,
    };
  });
}
