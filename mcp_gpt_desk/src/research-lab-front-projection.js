import {
  buildResearchKnowledgeGraphFromArtifactsV1,
  summarizeResearchKnowledgeGraphV1,
} from "@tv-automation/desk-domain";

export function buildResearchLabOverviewProjection(input = {}) {
  const experiments = list(input.experiments);
  const hypotheses = list(input.hypotheses);
  const candidates = list(input.candidates);
  const evaluationReports = list(input.evaluationReports || input.evaluation_reports);
  const graph = safeGraph({ experiments, hypotheses, candidates, evaluation_reports: evaluationReports });
  const projection = {
    generated_at_utc: input.generatedAtUtc || input.generated_at_utc || new Date(0).toISOString(),
    source: sourceDescriptor(),
    summary: summaryFrom({ experiments, hypotheses, candidates, evaluationReports }),
    experiments: experiments.map((experiment) => projectExperiment(experiment, { hypotheses, candidates, evaluationReports })),
    hypotheses: hypotheses.map(projectHypothesis),
    candidates: candidates.map((candidate) => projectCandidate(candidate, evaluationReports)),
    evaluation_reports: evaluationReports.map(projectEvaluationReport),
    knowledge_graph: {
      summary: summarizeResearchKnowledgeGraphV1(graph),
      graph_hash: graph.graph_hash || null,
    },
  };
  return projection;
}

export function buildResearchExperimentDetailProjection(input = {}) {
  const experiment = object(input.experiment);
  const hypotheses = list(input.hypotheses);
  const candidates = list(input.candidates);
  const evaluationReports = list(input.evaluationReports || input.evaluation_reports);
  return {
    generated_at_utc: input.generatedAtUtc || input.generated_at_utc || new Date(0).toISOString(),
    source: sourceDescriptor(),
    experiment: projectExperiment(experiment, { hypotheses, candidates, evaluationReports }),
    hypotheses: hypotheses.map(projectHypothesis),
    candidates: candidates.map((candidate) => projectCandidate(candidate, evaluationReports)),
    evaluation_reports: evaluationReports.map(projectEvaluationReport),
    knowledge_graph: {
      summary: summarizeResearchKnowledgeGraphV1(safeGraph({ experiments: [experiment], hypotheses, candidates, evaluation_reports: evaluationReports })),
    },
  };
}

export function buildResearchCandidateDetailProjection(input = {}) {
  const candidate = object(input.candidate);
  const evaluationReports = list(input.evaluationReports || input.evaluation_reports);
  return {
    generated_at_utc: input.generatedAtUtc || input.generated_at_utc || new Date(0).toISOString(),
    source: sourceDescriptor(),
    candidate: projectCandidate(candidate, evaluationReports),
    experiment: input.experiment ? projectExperiment(input.experiment, { hypotheses: [], candidates: [candidate], evaluationReports }) : null,
    hypothesis: input.hypothesis ? projectHypothesis(input.hypothesis) : null,
    evaluation_reports: evaluationReports.map(projectEvaluationReport),
  };
}

function summaryFrom({ experiments, hypotheses, candidates, evaluationReports }) {
  const activeExperiments = experiments.filter((item) => item.status === "ACTIVE").length;
  const blockedCandidates = candidates.filter((item) => item.promotion_blocked).length;
  const promotionReady = candidates.filter((item) => item.status === "PROMOTION_READY").length;
  const failedReports = evaluationReports.filter((item) => item.verdict === "FAIL").length;
  return {
    experiments: experiments.length,
    active_experiments: activeExperiments,
    hypotheses: hypotheses.length,
    candidates: candidates.length,
    promotion_ready: promotionReady,
    blocked_candidates: blockedCandidates,
    evaluation_reports: evaluationReports.length,
    failed_reports: failedReports,
  };
}

function projectExperiment(experiment, related) {
  const id = text(experiment.research_experiment_id);
  const hypotheses = related.hypotheses.filter((item) => item.research_experiment_id === id);
  const candidates = related.candidates.filter((item) => item.research_experiment_id === id);
  const reports = related.evaluationReports.filter((item) => item.research_experiment_id === id);
  return {
    research_experiment_id: id,
    experiment_key: text(experiment.experiment_key),
    name: text(experiment.name),
    objective: text(experiment.objective),
    owner: text(experiment.owner),
    status: text(experiment.status),
    comparison_metric: text(experiment.comparison_metric),
    winner_simulation_run_id: text(experiment.winner_simulation_run_id),
    created_at_utc: text(experiment.created_at_utc),
    updated_at_utc: text(experiment.updated_at_utc),
    counts: {
      hypotheses: hypotheses.length,
      candidates: candidates.length,
      evaluation_reports: reports.length,
      failed_reports: reports.filter((item) => item.verdict === "FAIL").length,
      promotion_ready: candidates.filter((item) => item.status === "PROMOTION_READY").length,
    },
  };
}

function projectCandidate(candidate, reports) {
  const candidateReports = reports.filter((report) => report.research_candidate_id === candidate.research_candidate_id);
  return {
    research_candidate_id: text(candidate.research_candidate_id),
    research_experiment_id: text(candidate.research_experiment_id),
    research_hypothesis_id: text(candidate.research_hypothesis_id),
    candidate_key: text(candidate.candidate_key),
    status: text(candidate.status),
    source_type: text(candidate.source_type),
    strategy_definition_id: text(candidate.strategy_definition_id),
    strategy_version_id: text(candidate.strategy_version_id),
    primary_change_summary: text(candidate.primary_change_summary),
    novelty_score: numberOrNull(candidate.novelty_score),
    evaluation_score: numberOrNull(candidate.evaluation_score),
    last_evaluation_verdict: text(candidate.last_evaluation_verdict),
    promotion_blocked: Boolean(candidate.promotion_blocked),
    promotion_block_reason: text(candidate.promotion_block_reason),
    created_at_utc: text(candidate.created_at_utc),
    updated_at_utc: text(candidate.updated_at_utc),
    report_count: candidateReports.length,
    failed_report_count: candidateReports.filter((report) => report.verdict === "FAIL").length,
  };
}

function projectEvaluationReport(report) {
  return {
    research_evaluation_report_id: text(report.research_evaluation_report_id),
    research_experiment_id: text(report.research_experiment_id),
    research_candidate_id: text(report.research_candidate_id),
    simulation_run_id: text(report.simulation_run_id),
    report_kind: text(report.report_kind),
    verdict: text(report.verdict),
    score: numberOrNull(report.score),
    metrics: object(report.metrics || report.metric_snapshot),
    criteria: object(report.criteria || report.criteria_snapshot),
    artifact_refs: list(report.artifact_refs).map(text).filter(Boolean),
    created_at_utc: text(report.created_at_utc),
  };
}

function projectHypothesis(hypothesis) {
  return {
    research_hypothesis_id: text(hypothesis.research_hypothesis_id),
    research_experiment_id: text(hypothesis.research_experiment_id),
    statement: text(hypothesis.statement),
    falsifiable_question: text(hypothesis.falsifiable_question),
    status: text(hypothesis.status),
    confidence_score: numberOrNull(hypothesis.confidence_score),
    expected_outcome: text(hypothesis.expected_outcome),
    invalidation_criteria: text(hypothesis.invalidation_criteria),
    created_at_utc: text(hypothesis.created_at_utc),
    updated_at_utc: text(hypothesis.updated_at_utc),
  };
}

function safeGraph(artifacts) {
  try {
    return buildResearchKnowledgeGraphFromArtifactsV1(artifacts);
  } catch {
    return { nodes: [], edges: [], graph_hash: null };
  }
}

function sourceDescriptor() {
  return {
    canonical: "research_experiment_registry_v1",
    storage: "postgres",
    direct_table_access: false,
  };
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
