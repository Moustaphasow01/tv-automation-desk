import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildResearchRobustnessEvaluation,
  runResearchRobustnessReviewTask,
} from "../src/research/research-robustness-review-runner.js";

describe("research robustness review runner", () => {
  it("builds robustness and OOS proxy reports from a canonical simulation result", () => {
    const evaluation = buildResearchRobustnessEvaluation({
      task: taskFixture(),
      payload: taskFixture().payload,
      candidate: candidateFixture(),
      baselineRun: runFixture(),
      baselineResult: resultFixture(),
      existingEvaluationReports: [contradictoryReviewReportFixture()],
      actor: "agent-runtime-research-robustness-01",
      nowUtc: "2026-08-13T08:30:00.000Z",
    });

    assert.equal(evaluation.reports.length, 4);
    assert.equal(evaluation.reports[0].report_kind, "ROBUSTNESS");
    assert.equal(evaluation.reports[1].report_kind, "OUT_OF_SAMPLE");
    assert.equal(evaluation.reports[2].report_kind, "PORTFOLIO_FIT");
    assert.equal(evaluation.reports[3].report_kind, "PROMOTION_MATRIX");
    assert.equal(evaluation.reports[0].verdict, "PASS");
    assert.equal(evaluation.reports[1].verdict, "PASS");
    assert.equal(evaluation.reports[2].verdict, "PASS");
    assert.equal(evaluation.reports[3].verdict, "NEEDS_REVIEW");
    assert.equal(evaluation.assessment.decision, "ROBUSTNESS_PASSED_OPERATOR_PROMOTION_REQUIRED");
    assert.equal(evaluation.robustness.gate.promotion_allowed, true);
    assert.equal(evaluation.promotion_gate_evaluations.promotion_matrix.decision, "NEEDS_OPERATOR_APPROVAL");
  });

  it("records robustness evidence through registries and returns supervisor output", async () => {
    const registry = new FakeResearchRegistry();
    const simulationRuns = new FakeSimulationRuns();

    const result = await runResearchRobustnessReviewTask({
      store: { researchRegistry: registry, simulationRuns },
      runnerInput: {
        task: taskFixture(),
        lease: { worker_id: "agent-runtime-research-robustness-01" },
      },
      nowUtc: "2026-08-13T08:30:00.000Z",
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, "ROBUSTNESS_PASSED_OPERATOR_PROMOTION_REQUIRED");
    assert.equal(result.verdict, "PASS");
    assert.equal(result.robustness_gate_passed, true);
    assert.equal(result.promotion_decision, "NEEDS_OPERATOR_APPROVAL");
    assert.equal(result.promotion_allowed, false);
    assert.equal(registry.reports.length, 4);
    assert.deepEqual(registry.reports.map((item) => item.report.report_kind), ["ROBUSTNESS", "OUT_OF_SAMPLE", "PORTFOLIO_FIT", "PROMOTION_MATRIX"]);
    assert.equal(simulationRuns.getRunCalls, 1);
    assert.equal(simulationRuns.listArtifactsCalls, 1);
  });

  it("blocks promotion matrix when robustness fails even if the baseline simulation looks attractive", () => {
    const evaluation = buildResearchRobustnessEvaluation({
      task: taskFixture({ payload: { ...taskFixture().payload, simulation_run_id: "11111111-2222-4333-8444-555555555555" } }),
      payload: { ...taskFixture().payload, simulation_run_id: "11111111-2222-4333-8444-555555555555" },
      candidate: candidateFixture(),
      baselineRun: { ...runFixture(), simulation_run_id: "11111111-2222-4333-8444-555555555555" },
      baselineResult: fragileResultFixture(),
      existingEvaluationReports: [contradictoryReviewReportFixture()],
      actor: "agent-runtime-research-robustness-01",
      nowUtc: "2026-08-13T08:30:00.000Z",
    });

    const matrix = evaluation.reports.find((report) => report.report_kind === "PROMOTION_MATRIX");
    assert.equal(evaluation.assessment.decision, "ROBUSTNESS_FAILED");
    assert.equal(matrix.verdict, "FAIL");
    assert.equal(matrix.criteria_snapshot.decision, "REJECT_PROMOTION");
    assert.equal(matrix.criteria_snapshot.gates.G2_ROBUSTNESS.ok, false);
    assert.equal(matrix.criteria_snapshot.automatic_execution_enabled, false);
    assert.equal(matrix.criteria_snapshot.live_authorization, false);
  });
});

class FakeResearchRegistry {
  constructor() {
    this.reports = [];
  }

  async getCandidate() {
    return candidateFixture();
  }

  async recordEvaluationReport(report, command) {
    this.reports.push({ report, command });
    return { status: "CREATED", report };
  }

  async listEvaluationReports() {
    return [contradictoryReviewReportFixture()];
  }
}

class FakeSimulationRuns {
  constructor() {
    this.getRunCalls = 0;
    this.listArtifactsCalls = 0;
  }

  async getRun() {
    this.getRunCalls += 1;
    return runFixture();
  }

  async listArtifacts() {
    this.listArtifactsCalls += 1;
    return [
      { artifact_kind: "RESULT", payload: resultFixture() },
      { artifact_kind: "METRICS", payload: resultFixture().metrics },
      { artifact_kind: "POSITIONS", payload: { items: resultFixture().positions } },
    ];
  }
}

function taskFixture(overrides = {}) {
  return {
    task_id: "77235778-4ac8-4baf-8ae8-1fd8dc2bfdd9",
    task_key: "research-robustness-demo-paper.mnq.m5.2026-06-01_2026-07-01",
    task_type: "RESEARCH_ROBUSTNESS_REVIEW",
    lane: "research",
    input_ref: "research-evaluation-report://b7d89bbb-126f-4cc1-9df1-242a054efa6a",
    status: "READY",
    priority: 32,
    correlation_id: "corr_demo_paper_robustness",
    created_at_utc: "2026-08-13T08:00:00.000Z",
    payload: {
      dataset_id: "df0770d1-9143-40e1-98fc-67583258ba74",
      dataset_key: "demo-paper.mnq.m5.2026-06-01_2026-07-01",
      required_decision: "RUN_ROBUSTNESS_AND_OOS_GATES",
      simulation_run_id: "0df112b0-745e-4cdb-af78-8ad7b2c77473",
      strategy_version_id: "b631d428-9a89-44a4-8c8b-c9ea3b775d6d",
      research_candidate_id: "88450ab3-3f90-4878-9659-8b4e968413ee",
      metrics: resultFixture().metrics,
    },
    ...overrides,
  };
}

function candidateFixture() {
  return {
    research_experiment_id: "b81f380c-eaad-4def-91b3-e576c55a38c6",
    research_hypothesis_id: "3d0f6a03-28d4-49a4-a4c1-a1355fd35b92",
    research_candidate_id: "88450ab3-3f90-4878-9659-8b4e968413ee",
    strategy_version_id: "b631d428-9a89-44a4-8c8b-c9ea3b775d6d",
    candidate_key: "demo-paper.mnq.opening-range-retest",
    source_type: "DERIVED",
    status: "UNDER_REVIEW",
    primary_change_summary: "Opening-range retest candidate for MNQ demo paper validation.",
    metadata: {
      portfolio_context: {
        risk_budget: { max_strategy_risk_pct: 0.25, max_portfolio_risk_pct: 0.75 },
        correlations: [{ strategy_ref: "baseline-mnq", correlation: 0.32 }],
      },
    },
  };
}

function runFixture() {
  return {
    simulation_run_id: "0df112b0-745e-4cdb-af78-8ad7b2c77473",
    source_run_id: "demo_paper_run",
    strategy_version_id: "b631d428-9a89-44a4-8c8b-c9ea3b775d6d",
    dataset_id: "df0770d1-9143-40e1-98fc-67583258ba74",
    status: "COMPLETED",
    result_hash: resultFixture().content_hash,
    metrics_hash: resultFixture().metrics_hash,
    dataset_hash: resultFixture().dataset_hash,
    parameters_hash: resultFixture().parameters_hash,
    result_ref: "artifact://simulation-runs/result",
    metrics_ref: "artifact://simulation-runs/metrics",
    metadata: { metrics: resultFixture().metrics, dataset_key: "demo-paper.mnq.m5.2026-06-01_2026-07-01" },
  };
}

function contradictoryReviewReportFixture() {
  return {
    research_evaluation_report_id: "b7d89bbb-126f-4cc1-9df1-242a054efa6a",
    research_experiment_id: "b81f380c-eaad-4def-91b3-e576c55a38c6",
    research_candidate_id: "88450ab3-3f90-4878-9659-8b4e968413ee",
    simulation_run_id: "0df112b0-745e-4cdb-af78-8ad7b2c77473",
    report_kind: "CONTRADICTORY_REVIEW",
    verdict: "PASS",
    score: 0.82,
    metric_snapshot: { total_r: 6.9, trade_count: 8, max_drawdown_r: -0.9 },
    criteria_snapshot: { decision: "READY_FOR_ROBUSTNESS_REVIEW" },
    created_at_utc: "2026-08-13T08:10:00.000Z",
  };
}

function resultFixture() {
  const r = [2.4, -0.9, 1.7, 2.1, -0.6, 1.2, 1.4, -0.4];
  return {
    schema_version: "canonical_simulation_result_v1",
    simulation_engine: "desk-replay-engine",
    simulation_engine_version: "1.0.0",
    run_id: "demo_paper_run",
    strategy_version_id: "b631d428-9a89-44a4-8c8b-c9ea3b775d6d",
    dataset_id: "df0770d1-9143-40e1-98fc-67583258ba74",
    dataset_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    parameters_hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    status: "COMPLETED",
    metrics: {
      trade_count: r.length,
      total_r: 6.9,
      profit_factor: 4,
      max_drawdown_r: -0.9,
      expectancy_r: 0.8625,
      win_rate: 0.625,
    },
    positions: r.map((value, index) => ({ position_id: `p${index}`, status: "CLOSED", r_result: value })),
    metrics_hash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    content_hash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  };
}

function fragileResultFixture() {
  const r = [4.0, -6.4, 3.9, -5.2, 2.1, -4.7, 3.5, -3.9];
  return {
    ...resultFixture(),
    run_id: "fragile_demo_paper_run",
    simulation_run_id: "11111111-2222-4333-8444-555555555555",
    metrics: {
      trade_count: r.length,
      total_r: -6.7,
      profit_factor: 0.65,
      max_drawdown_r: -10.3,
      expectancy_r: -0.8375,
      win_rate: 0.5,
    },
    positions: r.map((value, index) => ({ position_id: `fragile-p${index}`, status: "CLOSED", r_result: value })),
  };
}
