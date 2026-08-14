import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildResearchCandidateDetailProjection,
  buildResearchExperimentDetailProjection,
  buildResearchLabOverviewProjection,
} from "../src/research-lab-front-projection.js";

test("Research Lab front projection exposes counts, decisions and graph summary", () => {
  const overview = buildResearchLabOverviewProjection(fixtures());

  assert.equal(overview.summary.experiments, 1);
  assert.equal(overview.summary.candidates, 2);
  assert.equal(overview.summary.promotion_ready, 1);
  assert.equal(overview.summary.failed_reports, 1);
  assert.equal(overview.experiments[0].counts.failed_reports, 1);
  assert.equal(overview.candidates[0].strategy_version_id, "strategy-version-1");
  assert.equal(overview.evaluation_reports[1].verdict, "FAIL");
  assert.equal(overview.source.direct_table_access, false);
  assert.ok(overview.knowledge_graph.summary.node_count >= 1);
});

test("Research Lab front projection supports experiment and candidate zooms", () => {
  const data = fixtures();
  const experiment = buildResearchExperimentDetailProjection(data);
  const candidate = buildResearchCandidateDetailProjection({
    generatedAtUtc: data.generatedAtUtc,
    candidate: data.candidates[0],
    experiment: data.experiments[0],
    hypothesis: data.hypotheses[0],
    evaluationReports: data.evaluationReports.filter((report) => report.research_candidate_id === "candidate-1"),
  });

  assert.equal(experiment.candidates.length, 2);
  assert.equal(experiment.hypotheses[0].status, "TESTING");
  assert.equal(candidate.candidate.report_count, 1);
  assert.equal(candidate.hypothesis.research_hypothesis_id, "hyp-1");
});

function fixtures() {
  return {
    generatedAtUtc: "2026-08-09T12:00:00.000Z",
    experiments: [{
      research_experiment_id: "exp-1",
      experiment_key: "mnq-breakout",
      name: "MNQ breakout research",
      objective: "Find robust retest strategies.",
      owner: "research",
      status: "ACTIVE",
      comparison_metric: "composite_score",
      created_at_utc: "2026-08-09T10:00:00.000Z",
    }],
    hypotheses: [{
      research_hypothesis_id: "hyp-1",
      research_experiment_id: "exp-1",
      statement: "Breakout retest improves continuation.",
      falsifiable_question: "Does it beat baseline?",
      status: "TESTING",
    }],
    candidates: [{
      research_candidate_id: "candidate-1",
      research_experiment_id: "exp-1",
      research_hypothesis_id: "hyp-1",
      candidate_key: "candidate.one",
      status: "PROMOTION_READY",
      source_type: "AI_GENERATED",
      strategy_version_id: "strategy-version-1",
      primary_change_summary: "Retest plus VWAP.",
      evaluation_score: 0.8,
      last_evaluation_verdict: "PASS",
    }, {
      research_candidate_id: "candidate-2",
      research_experiment_id: "exp-1",
      research_hypothesis_id: "hyp-1",
      candidate_key: "candidate.two",
      status: "REJECTED",
      source_type: "AI_GENERATED",
      promotion_blocked: true,
      promotion_block_reason: "LOW_EDGE",
      last_evaluation_verdict: "FAIL",
    }],
    evaluationReports: [{
      research_evaluation_report_id: "report-1",
      research_experiment_id: "exp-1",
      research_candidate_id: "candidate-1",
      simulation_run_id: "sim-1",
      report_kind: "VALIDATION",
      verdict: "PASS",
      score: 0.8,
    }, {
      research_evaluation_report_id: "report-2",
      research_experiment_id: "exp-1",
      research_candidate_id: "candidate-2",
      simulation_run_id: "sim-2",
      report_kind: "VALIDATION",
      verdict: "FAIL",
      score: 0.2,
    }],
  };
}
