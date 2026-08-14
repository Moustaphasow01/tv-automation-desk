import type {
  ResearchCandidateDetail,
  ResearchCandidateRow,
  ResearchEvaluationReportRow,
  ResearchExperimentDetail,
  ResearchExperimentRow,
  ResearchHypothesisRow,
  ResearchLabOverview,
} from "@/operationsTypes";

export type ResearchTone = "neutral" | "positive" | "warning" | "critical" | "info";

export interface ResearchMetric {
  label: string;
  value: string | number;
  detail: string;
  tone?: ResearchTone;
}

export interface ResearchLabViewModel {
  generatedAt: string;
  sourceLabel: string;
  metrics: ResearchMetric[];
  experimentRows: Array<ResearchExperimentRow & { label: string; statusLabel: string; href: string }>;
  candidateRows: Array<ResearchCandidateRow & { label: string; statusLabel: string; decisionLabel: string; href: string; tone: ResearchTone }>;
  reportRows: Array<ResearchEvaluationReportRow & { label: string; verdictLabel: string; scoreLabel: string; tone: ResearchTone }>;
  graphLabel: string;
  warnings: string[];
}

export function buildResearchLabViewModel(data?: ResearchLabOverview | null): ResearchLabViewModel {
  const overview = overviewOrEmpty(data);
  const { summary, source, experiments, candidates, evaluation_reports: reports } = overview;
  return {
    generatedAt: formatDateTime(overview.generated_at_utc),
    sourceLabel: sourceLabel(source),
    metrics: researchMetrics(summary, source, overview),
    experimentRows: experiments.map((experiment) => ({
      ...experiment,
      label: experiment.name || readable(experiment.experiment_key || experiment.research_experiment_id),
      statusLabel: statusLabel(experiment.status),
      href: `/research/experiments/${encodeURIComponent(experiment.research_experiment_id)}`,
    })),
    candidateRows: candidates.map(candidateRow),
    reportRows: reports.map(reportRow),
    graphLabel: `${graphCount(overview, "node_count")} nœuds · ${graphCount(overview, "edge_count")} relations`,
    warnings: researchWarnings(summary, source),
  };
}

export function buildResearchExperimentDetailViewModel(data?: ResearchExperimentDetail | null) {
  const detail = experimentDetailOrEmpty(data);
  const { experiment, hypotheses, candidates, evaluation_reports: evaluationReports } = detail;
  const overview: ResearchLabOverview = {
    contract: "DeskResearchLabOverviewV1",
    schemaVersion: "research_lab_front_v1",
    generated_at_utc: detail.generated_at_utc,
    source: detail.source,
    summary: experimentSummary(experiment, hypotheses, candidates, evaluationReports),
    experiments: experiment ? [experiment] : [],
    candidates,
    evaluation_reports: evaluationReports,
    knowledge_graph: detail.knowledge_graph,
  };
  return { ...buildResearchLabViewModel(overview), hypotheses, experiment };
}

export function buildResearchCandidateDetailViewModel(data?: ResearchCandidateDetail | null) {
  const candidate = data?.candidate || null;
  const source = data?.source || defaultSource();
  return {
    generatedAt: formatDateTime(data?.generated_at_utc),
    sourceLabel: sourceLabel(source),
    candidate: candidate ? candidateRow(candidate) : null,
    experiment: data?.experiment || null,
    hypothesis: data?.hypothesis || null,
    reports: (data?.evaluation_reports || []).map(reportRow),
  };
}

function overviewOrEmpty(data?: ResearchLabOverview | null): ResearchLabOverview {
  if (data) return data;
  return {
    contract: "DeskResearchLabOverviewV1",
    schemaVersion: "research_lab_front_v1",
    generated_at_utc: "",
    source: defaultSource(),
    summary: emptySummary(),
    experiments: [],
    candidates: [],
    evaluation_reports: [],
    knowledge_graph: { summary: {} },
  };
}

function experimentDetailOrEmpty(data?: ResearchExperimentDetail | null) {
  if (data) return data;
  return {
    contract: "DeskResearchExperimentDetailV1",
    schemaVersion: "research_lab_front_v1",
    generated_at_utc: "",
    source: defaultSource(),
    experiment: null,
    hypotheses: [],
    candidates: [],
    evaluation_reports: [],
    knowledge_graph: { summary: {} },
  };
}

function researchMetrics(summary: ResearchLabOverview["summary"], source: ResearchLabOverview["source"], data: ResearchLabOverview | null): ResearchMetric[] {
  return [
    { label: "Experiments", value: summary.experiments, detail: `${summary.active_experiments} actif(s)`, tone: summary.active_experiments ? "positive" : "neutral" },
    { label: "Candidates", value: summary.candidates, detail: `${summary.promotion_ready} prêtes promotion`, tone: summary.promotion_ready ? "positive" : "info" },
    { label: "Bloquées", value: summary.blocked_candidates, detail: "promotion/recherche", tone: summary.blocked_candidates ? "warning" : "positive" },
    { label: "Rapports", value: summary.evaluation_reports, detail: `${summary.failed_reports} échec(s)`, tone: summary.failed_reports ? "critical" : "info" },
    { label: "Graphe", value: graphCount(data, "node_count"), detail: `${graphCount(data, "edge_count")} relation(s)`, tone: graphCount(data, "dangling_edge_count") ? "warning" : "positive" },
    { label: "Accès direct table", value: source.direct_table_access ? "Oui" : "Non", detail: "BFF contrôlé", tone: source.direct_table_access ? "critical" : "positive" },
  ];
}

function researchWarnings(summary: ResearchLabOverview["summary"], source: ResearchLabOverview["source"]) {
  const warnings: string[] = [];
  if (source.direct_table_access) warnings.push("Le front Research annonce un accès direct table : à corriger.");
  if (summary.experiments === 0) warnings.push("Aucun experiment Research visible : état réel vide, aucun mock.");
  if (summary.failed_reports > 0) warnings.push(`${summary.failed_reports} rapport(s) négatif(s) à relire.`);
  return warnings;
}

function experimentSummary(
  experiment: ResearchExperimentRow | null,
  hypotheses: ResearchHypothesisRow[],
  candidates: ResearchCandidateRow[],
  reports: ResearchEvaluationReportRow[],
): ResearchLabOverview["summary"] {
  return {
    experiments: experiment ? 1 : 0,
    active_experiments: experiment?.status === "ACTIVE" ? 1 : 0,
    hypotheses: hypotheses.length,
    candidates: candidates.length,
    promotion_ready: candidates.filter((candidate) => candidate.status === "PROMOTION_READY").length,
    blocked_candidates: candidates.filter((candidate) => candidate.promotion_blocked).length,
    evaluation_reports: reports.length,
    failed_reports: reports.filter((report) => report.verdict === "FAIL").length,
  };
}

function emptySummary(): ResearchLabOverview["summary"] {
  return { experiments: 0, active_experiments: 0, hypotheses: 0, candidates: 0, promotion_ready: 0, blocked_candidates: 0, evaluation_reports: 0, failed_reports: 0 };
}

function defaultSource(): ResearchLabOverview["source"] {
  return { canonical: "research_experiment_registry_v1", storage: "postgres", direct_table_access: false };
}

function sourceLabel(source: ResearchLabOverview["source"]) {
  return `${readable(source.canonical)} · ${String(source.storage).toUpperCase()}`;
}

function candidateRow(candidate: ResearchCandidateRow) {
  const tone = candidateTone(candidate);
  return {
    ...candidate,
    label: candidate.candidate_key || readable(candidate.research_candidate_id),
    statusLabel: statusLabel(candidate.status),
    decisionLabel: candidateDecision(candidate),
    href: `/research/candidates/${encodeURIComponent(candidate.research_candidate_id)}`,
    tone,
  };
}

function reportRow(report: ResearchEvaluationReportRow) {
  const tone: ResearchTone = report.verdict === "FAIL" ? "critical" : report.verdict === "PASS" ? "positive" : "warning";
  return {
    ...report,
    label: `${reportKindLabel(report.report_kind)} · ${readable(report.simulation_run_id || report.research_evaluation_report_id)}`,
    verdictLabel: verdictLabel(report.verdict),
    scoreLabel: report.score == null ? "—" : `${Math.round(report.score * 100)}%`,
    tone,
  };
}

function candidateTone(candidate: ResearchCandidateRow): ResearchTone {
  if (candidate.promotion_blocked || candidate.status === "REJECTED") return "critical";
  if (candidate.status === "PROMOTION_READY") return "positive";
  if (candidate.status === "UNDER_REVIEW" || candidate.status === "IN_SIMULATION") return "info";
  return "neutral";
}

function candidateDecision(candidate: ResearchCandidateRow) {
  if (candidate.promotion_blocked) return `Bloquée · ${readable(candidate.promotion_block_reason)}`;
  if (candidate.status === "PROMOTION_READY") return "Promotion prête";
  if (candidate.last_evaluation_verdict) return `Dernier verdict ${verdictLabel(candidate.last_evaluation_verdict)}`;
  return "En recherche";
}

function graphCount(data: ResearchLabOverview | null | undefined, key: string) {
  const value = data?.knowledge_graph?.summary?.[key];
  return typeof value === "number" ? value : 0;
}

function statusLabel(value: string) {
  const known: Record<string, string> = {
    DRAFT: "Brouillon",
    ACTIVE: "Actif",
    COMPLETED: "Terminé",
    CANCELLED: "Annulé",
    ARCHIVED: "Archivé",
    IDEA: "Idée",
    BASELINE_REQUIRED: "Baseline requise",
    IN_SIMULATION: "En simulation",
    UNDER_REVIEW: "En revue",
    PROMOTION_READY: "Prête promotion",
    REJECTED: "Rejetée",
    RETIRED: "Retirée",
  };
  return known[value] || readable(value);
}

function verdictLabel(value: string) {
  return ({ PASS: "Validé", FAIL: "Échec", INCONCLUSIVE: "Inconclusif", NEEDS_REVIEW: "À revoir" } as Record<string, string>)[value] || readable(value);
}

function reportKindLabel(value: string) {
  return ({ TRAIN: "Baseline", VALIDATION: "Validation", OUT_OF_SAMPLE: "OOS", WALK_FORWARD: "Walk-forward", ROBUSTNESS: "Robustesse", CONTRADICTORY_REVIEW: "Critique" } as Record<string, string>)[value] || readable(value);
}

function readable(value?: string | null) {
  return String(value || "—").replace(/[_:.-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(date);
}
