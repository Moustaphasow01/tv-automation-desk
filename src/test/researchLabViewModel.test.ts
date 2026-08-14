import { describe, expect, it } from "vitest";
import {
  buildResearchCandidateDetailViewModel,
  buildResearchExperimentDetailViewModel,
  buildResearchLabViewModel,
} from "@/features/research-lab/viewModel";
import type { ResearchCandidateDetail, ResearchExperimentDetail, ResearchLabOverview } from "@/operationsTypes";

describe("Research Lab ViewModel", () => {
  it("traduit experiments, candidates et rapports en lignes opérateur", () => {
    const view = buildResearchLabViewModel(overview());

    expect(view.sourceLabel).toBe("Research Experiment Registry V1 · POSTGRES");
    expect(view.metrics.find(metric => metric.label === "Candidates")?.value).toBe(2);
    expect(view.experimentRows[0].href).toBe("/research/experiments/exp-1");
    expect(view.candidateRows[0].decisionLabel).toBe("Promotion prête");
    expect(view.candidateRows[1].tone).toBe("critical");
    expect(view.reportRows[1].verdictLabel).toBe("Échec");
    expect(view.warnings).toContain("1 rapport(s) négatif(s) à relire.");
  });

  it("construit les zooms experiment et candidate sans détails empilés", () => {
    const experiment = buildResearchExperimentDetailViewModel(experimentDetail());
    const candidate = buildResearchCandidateDetailViewModel(candidateDetail());

    expect(experiment.experiment?.research_experiment_id).toBe("exp-1");
    expect(experiment.hypotheses[0].status).toBe("TESTING");
    expect(candidate.candidate?.label).toBe("candidate.one");
    expect(candidate.reports[0].scoreLabel).toBe("82%");
  });
});

function overview(): ResearchLabOverview {
  return {
    contract: "DeskResearchLabOverviewV1",
    schemaVersion: "research_lab_front_v1",
    generated_at_utc: "2026-08-09T12:00:00.000Z",
    source: { canonical: "research_experiment_registry_v1", storage: "postgres", direct_table_access: false },
    summary: { experiments: 1, active_experiments: 1, hypotheses: 1, candidates: 2, promotion_ready: 1, blocked_candidates: 1, evaluation_reports: 2, failed_reports: 1 },
    experiments: [{
      research_experiment_id: "exp-1",
      experiment_key: "mnq-breakout",
      name: "MNQ breakout",
      objective: "Test retests.",
      owner: "research",
      status: "ACTIVE",
      comparison_metric: "score",
      winner_simulation_run_id: "",
      created_at_utc: "2026-08-09T10:00:00.000Z",
      updated_at_utc: "",
      counts: { hypotheses: 1, candidates: 2, evaluation_reports: 2, failed_reports: 1, promotion_ready: 1 },
    }],
    candidates: [{
      research_candidate_id: "candidate-1",
      research_experiment_id: "exp-1",
      research_hypothesis_id: "hyp-1",
      candidate_key: "candidate.one",
      status: "PROMOTION_READY",
      source_type: "AI_GENERATED",
      strategy_definition_id: "",
      strategy_version_id: "strategy-version-1",
      primary_change_summary: "Retest plus VWAP.",
      novelty_score: 0.8,
      evaluation_score: 0.82,
      last_evaluation_verdict: "PASS",
      promotion_blocked: false,
      promotion_block_reason: "",
      created_at_utc: "",
      updated_at_utc: "",
      report_count: 1,
      failed_report_count: 0,
    }, {
      research_candidate_id: "candidate-2",
      research_experiment_id: "exp-1",
      research_hypothesis_id: "hyp-1",
      candidate_key: "candidate.two",
      status: "REJECTED",
      source_type: "AI_GENERATED",
      strategy_definition_id: "",
      strategy_version_id: "",
      primary_change_summary: "Too weak.",
      novelty_score: 0.4,
      evaluation_score: 0.2,
      last_evaluation_verdict: "FAIL",
      promotion_blocked: true,
      promotion_block_reason: "LOW_EDGE",
      created_at_utc: "",
      updated_at_utc: "",
      report_count: 1,
      failed_report_count: 1,
    }],
    evaluation_reports: [{
      research_evaluation_report_id: "report-1",
      research_experiment_id: "exp-1",
      research_candidate_id: "candidate-1",
      simulation_run_id: "sim-1",
      report_kind: "VALIDATION",
      verdict: "PASS",
      score: 0.82,
      metrics: {},
      criteria: {},
      artifact_refs: [],
      created_at_utc: "",
    }, {
      research_evaluation_report_id: "report-2",
      research_experiment_id: "exp-1",
      research_candidate_id: "candidate-2",
      simulation_run_id: "sim-2",
      report_kind: "VALIDATION",
      verdict: "FAIL",
      score: 0.2,
      metrics: {},
      criteria: {},
      artifact_refs: [],
      created_at_utc: "",
    }],
    knowledge_graph: { summary: { node_count: 4, edge_count: 3, dangling_edge_count: 0 }, graph_hash: "sha256:abc" },
  };
}

function experimentDetail(): ResearchExperimentDetail {
  const base = overview();
  return {
    contract: "DeskResearchExperimentDetailV1",
    schemaVersion: "research_lab_front_v1",
    generated_at_utc: base.generated_at_utc,
    source: base.source,
    experiment: base.experiments[0],
    hypotheses: [{
      research_hypothesis_id: "hyp-1",
      research_experiment_id: "exp-1",
      statement: "Retest works.",
      falsifiable_question: "Does it beat baseline?",
      status: "TESTING",
      confidence_score: 0.6,
      expected_outcome: "Higher score.",
      invalidation_criteria: "Fail if no edge.",
      created_at_utc: "",
      updated_at_utc: "",
    }],
    candidates: base.candidates,
    evaluation_reports: base.evaluation_reports,
    knowledge_graph: { summary: { node_count: 4, edge_count: 3 } },
  };
}

function candidateDetail(): ResearchCandidateDetail {
  const base = overview();
  return {
    contract: "DeskResearchCandidateDetailV1",
    schemaVersion: "research_lab_front_v1",
    generated_at_utc: base.generated_at_utc,
    source: base.source,
    candidate: base.candidates[0],
    experiment: base.experiments[0],
    hypothesis: experimentDetail().hypotheses[0],
    evaluation_reports: [base.evaluation_reports[0]],
  };
}
