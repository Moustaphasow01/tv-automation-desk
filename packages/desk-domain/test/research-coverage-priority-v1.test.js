import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildResearchCoverageModelV1,
  buildResearchKnowledgeGraphFromArtifactsV1,
  rankResearchPrioritiesV1,
  scoreResearchPriorityV1,
  summarizeResearchCoverageForFrontV1,
} from "../index.js";

test("TD2-511 measures coverage gaps by taxonomy regime instrument timeframe and session", () => {
  const coverage = buildResearchCoverageModelV1({
    candidates: [candidate()],
    targets: {
      families: ["BREAKOUT_RETEST", "MEAN_REVERSION"],
      regimes: ["TREND", "RANGE"],
      instruments: ["mnq", "mes"],
      timeframes: ["m1", "m15"],
      sessions: ["ny_open", "asia_open"],
    },
  });

  assert.equal(coverage.vector_count, 1);
  assert.deepEqual(coverage.dimensions.families.missing_values, ["MEAN_REVERSION"]);
  assert.deepEqual(coverage.dimensions.instruments.missing_values, ["mes"]);
  assert.equal(coverage.dimensions.sessions.gap_ratio, 0.5);
});

test("TD2-511 reads candidate coverage from the knowledge graph projection", () => {
  const graph = buildResearchKnowledgeGraphFromArtifactsV1({ candidates: [candidate()] });
  const coverage = buildResearchCoverageModelV1({
    graph,
    targets: { families: ["BREAKOUT_RETEST"], regimes: ["TREND"], instruments: ["mnq"], timeframes: ["m15"], sessions: ["ny_open"] },
  });

  assert.equal(coverage.validation, undefined);
  assert.equal(coverage.dimensions.families.coverage_ratio, 1);
  assert.equal(coverage.dimensions.instruments.coverage_ratio, 1);
});

test("TD2-511 scores priority using coverage novelty potential cost and risk", () => {
  const coverage = buildResearchCoverageModelV1({
    candidates: [candidate()],
    targets: { families: ["BREAKOUT_RETEST", "MEAN_REVERSION"], regimes: ["TREND", "RANGE"] },
  });
  const score = scoreResearchPriorityV1({
    candidate: candidate({
      research_candidate_id: "c2",
      candidate_key: "mes.mean-reversion.range",
      primary_change_summary: "Mean reversion range rotation.",
      instruments: ["MES"],
      entry_logic: ["range"],
    }),
    coverage_model: coverage,
    novelty_score: 0.9,
    potential_score: 0.8,
    cost_score: 0.2,
    risk_score: 0.3,
  });

  assert.equal(score.decision, "HIGH_PRIORITY");
  assert.ok(score.factors.coverage_gap > 0);
  assert.ok(score.audit.covered_gaps.some((gap) => gap.value === "MEAN_REVERSION"));
});

test("TD2-511 ranks next research candidates deterministically", () => {
  const plan = rankResearchPrioritiesV1({
    candidates: [
      candidate({ research_candidate_id: "c-low", candidate_key: "mnq.same" }),
      candidate({ research_candidate_id: "c-high", candidate_key: "mes.range", primary_change_summary: "Mean reversion range rotation.", instruments: ["MES"] }),
    ],
    targets: { families: ["BREAKOUT_RETEST", "MEAN_REVERSION"], instruments: ["mnq", "mes"] },
    novelty_score: 0.8,
    potential_score: 0.8,
    cost_score: 0.1,
    risk_score: 0.1,
  });

  assert.equal(plan.priorities.length, 2);
  assert.equal(plan.next_best.candidate_key, "mes.range");
  assert.match(plan.plan_hash, /^sha256:[a-f0-9]{64}$/);
});

test("TD2-511 creates a compact front summary for Research Lab KPIs", () => {
  const summary = summarizeResearchCoverageForFrontV1({
    candidates: [candidate()],
    targets: { families: ["BREAKOUT_RETEST", "MEAN_REVERSION"], instruments: ["mnq", "mes"] },
  });

  assert.equal(summary.vector_count, 1);
  assert.ok(summary.gap_count >= 2);
  assert.equal(summary.top_priorities.length, 1);
  assert.match(summary.summary_hash, /^sha256:[a-f0-9]{64}$/);
});

test("TD2-511 defers expensive low-novelty research", () => {
  const score = scoreResearchPriorityV1({
    candidate: candidate(),
    candidates: [candidate()],
    novelty_score: 0,
    potential_score: 0,
    cost_score: 1,
    risk_score: 1,
  });

  assert.equal(score.decision, "DEFER");
});

function candidate(overrides = {}) {
  return {
    research_candidate_id: "c1",
    candidate_key: "mnq.breakout.retest",
    primary_change_summary: "Breakout retest continuation with VWAP and RSI confirmation after compression trend.",
    instruments: ["MNQ"],
    timeframes: ["M1", "M15"],
    session_scope: ["ny_open"],
    entry_logic: ["breakout", "retest"],
    confirmation_signals: ["VWAP", "RSI"],
    exit_logic: ["tp1"],
    risk_model: ["fixed_risk_pct"],
    ...overrides,
  };
}
