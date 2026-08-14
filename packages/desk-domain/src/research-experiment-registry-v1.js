import { canonicalSha256 } from "./execution-scope.js";

export const RESEARCH_EXPERIMENT_REGISTRY_SCHEMA_VERSION_V1 = "research_experiment_registry_v1";
export const RESEARCH_EXPERIMENT_SCHEMA_VERSION_V1 = "research_experiment_v1";
export const RESEARCH_HYPOTHESIS_SCHEMA_VERSION_V1 = "research_hypothesis_v1";
export const RESEARCH_CANDIDATE_SCHEMA_VERSION_V1 = "research_candidate_v1";
export const RESEARCH_EVALUATION_REPORT_SCHEMA_VERSION_V1 = "research_evaluation_report_v1";
export const RESEARCH_CANDIDATE_EVALUATION_SUMMARY_VERSION_V1 = "research_candidate_evaluation_summary_v1";

export const RESEARCH_EXPERIMENT_STATUSES_V1 = Object.freeze(["DRAFT", "ACTIVE", "COMPLETED", "CANCELLED", "ARCHIVED"]);
export const RESEARCH_HYPOTHESIS_STATUSES_V1 = Object.freeze(["PROPOSED", "TESTING", "SUPPORTED", "FALSIFIED", "INCONCLUSIVE", "RETIRED"]);
export const RESEARCH_CANDIDATE_STATUSES_V1 = Object.freeze(["IDEA", "BASELINE_REQUIRED", "IN_SIMULATION", "UNDER_REVIEW", "PROMOTION_READY", "REJECTED", "RETIRED"]);
export const RESEARCH_CANDIDATE_SOURCE_TYPES_V1 = Object.freeze(["AI_GENERATED", "OPERATOR", "DERIVED", "BASELINE"]);
export const RESEARCH_EVALUATION_REPORT_KINDS_V1 = Object.freeze([
  "TRAIN",
  "VALIDATION",
  "OUT_OF_SAMPLE",
  "WALK_FORWARD",
  "ROBUSTNESS",
  "CONTRADICTORY_REVIEW",
  "QUALITATIVE_REPLAY",
  "PORTFOLIO_FIT",
  "PROMOTION_MATRIX",
]);
export const RESEARCH_EVALUATION_VERDICTS_V1 = Object.freeze(["PASS", "FAIL", "INCONCLUSIVE", "NEEDS_REVIEW"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_RE = /^[a-z0-9][a-z0-9_.:-]{1,190}[a-z0-9]$/;

export function validateResearchExperimentV1(input = {}) {
  const issues = [];
  const entity = object(input);
  const normalized = {
    schema_version: RESEARCH_EXPERIMENT_SCHEMA_VERSION_V1,
    research_experiment_id: requiredUuid(read(entity, "research_experiment_id", "id"), "research_experiment_id", issues),
    experiment_key: optionalKey(entity.experiment_key, "experiment_key", issues),
    name: requiredText(entity.name, "name", issues),
    objective: requiredText(entity.objective, "objective", issues),
    owner: requiredText(entity.owner, "owner", issues),
    status: enumValue(entity.status, RESEARCH_EXPERIMENT_STATUSES_V1, "status", issues, "DRAFT"),
    comparison_metric: requiredText(entity.comparison_metric, "comparison_metric", issues),
    winner_simulation_run_id: nullableUuid(entity.winner_simulation_run_id, "winner_simulation_run_id", issues),
    candidate_selection_cutoff_utc: optionalTimestamp(entity.candidate_selection_cutoff_utc, "candidate_selection_cutoff_utc", issues),
    budget: jsonObject(entity.budget),
    metadata: jsonObject(entity.metadata),
    created_at_utc: requiredTimestamp(read(entity, "created_at_utc", "created_at"), "created_at_utc", issues),
    updated_at_utc: optionalTimestamp(read(entity, "updated_at_utc", "updated_at"), "updated_at_utc", issues),
    completed_at_utc: optionalTimestamp(entity.completed_at_utc, "completed_at_utc", issues),
  };
  validateExperimentState(normalized, issues);
  validateChronology(normalized, issues);
  return validationResult("research_experiment", normalized, issues);
}

export function validateResearchHypothesisV1(input = {}) {
  const issues = [];
  const entity = object(input);
  const normalized = {
    schema_version: RESEARCH_HYPOTHESIS_SCHEMA_VERSION_V1,
    research_hypothesis_id: requiredUuid(read(entity, "research_hypothesis_id", "id"), "research_hypothesis_id", issues),
    research_experiment_id: requiredUuid(entity.research_experiment_id, "research_experiment_id", issues),
    statement: requiredText(entity.statement, "statement", issues),
    falsifiable_question: requiredText(entity.falsifiable_question, "falsifiable_question", issues),
    instrument_scope: stringArray(entity.instrument_scope),
    timeframe_scope: stringArray(entity.timeframe_scope),
    population_scope: nullableText(entity.population_scope),
    variable_set: jsonObject(entity.variable_set),
    expected_outcome: requiredText(entity.expected_outcome, "expected_outcome", issues),
    invalidation_criteria: requiredText(entity.invalidation_criteria, "invalidation_criteria", issues),
    status: enumValue(entity.status, RESEARCH_HYPOTHESIS_STATUSES_V1, "status", issues, "PROPOSED"),
    confidence_score: nullableScore(entity.confidence_score, "confidence_score", issues),
    source_agent_mission_id: nullableUuid(entity.source_agent_mission_id, "source_agent_mission_id", issues),
    metadata: jsonObject(entity.metadata),
    created_at_utc: requiredTimestamp(read(entity, "created_at_utc", "created_at"), "created_at_utc", issues),
    updated_at_utc: optionalTimestamp(read(entity, "updated_at_utc", "updated_at"), "updated_at_utc", issues),
  };
  validateChronology(normalized, issues);
  return validationResult("research_hypothesis", normalized, issues);
}

export function validateResearchCandidateV1(input = {}) {
  const issues = [];
  const entity = object(input);
  const normalized = {
    schema_version: RESEARCH_CANDIDATE_SCHEMA_VERSION_V1,
    research_candidate_id: requiredUuid(read(entity, "research_candidate_id", "id"), "research_candidate_id", issues),
    research_experiment_id: requiredUuid(entity.research_experiment_id, "research_experiment_id", issues),
    research_hypothesis_id: requiredUuid(entity.research_hypothesis_id, "research_hypothesis_id", issues),
    candidate_key: optionalKey(entity.candidate_key, "candidate_key", issues),
    source_type: enumValue(entity.source_type, RESEARCH_CANDIDATE_SOURCE_TYPES_V1, "source_type", issues, "AI_GENERATED"),
    status: enumValue(entity.status, RESEARCH_CANDIDATE_STATUSES_V1, "status", issues, "IDEA"),
    strategy_definition_id: nullableUuid(entity.strategy_definition_id, "strategy_definition_id", issues),
    strategy_version_id: nullableUuid(entity.strategy_version_id, "strategy_version_id", issues),
    primary_change_summary: requiredText(entity.primary_change_summary, "primary_change_summary", issues),
    deterministic_plan_ref: nullableText(entity.deterministic_plan_ref),
    novelty_score: nullableScore(entity.novelty_score, "novelty_score", issues),
    evaluation_score: nullableScore(entity.evaluation_score, "evaluation_score", issues),
    last_evaluation_verdict: nullableEnum(entity.last_evaluation_verdict, RESEARCH_EVALUATION_VERDICTS_V1, "last_evaluation_verdict", issues),
    promotion_blocked: Boolean(entity.promotion_blocked),
    promotion_block_reason: nullableText(entity.promotion_block_reason),
    metadata: jsonObject(entity.metadata),
    created_at_utc: requiredTimestamp(read(entity, "created_at_utc", "created_at"), "created_at_utc", issues),
    updated_at_utc: optionalTimestamp(read(entity, "updated_at_utc", "updated_at"), "updated_at_utc", issues),
  };
  validateCandidateIntegrity(normalized, issues);
  validateChronology(normalized, issues);
  return validationResult("research_candidate", normalized, issues);
}

export function validateResearchEvaluationReportV1(input = {}) {
  const issues = [];
  const entity = object(input);
  const normalized = {
    schema_version: RESEARCH_EVALUATION_REPORT_SCHEMA_VERSION_V1,
    research_evaluation_report_id: requiredUuid(read(entity, "research_evaluation_report_id", "id"), "research_evaluation_report_id", issues),
    research_experiment_id: requiredUuid(entity.research_experiment_id, "research_experiment_id", issues),
    research_candidate_id: requiredUuid(entity.research_candidate_id, "research_candidate_id", issues),
    simulation_run_id: requiredUuid(entity.simulation_run_id, "simulation_run_id", issues),
    report_kind: enumValue(entity.report_kind, RESEARCH_EVALUATION_REPORT_KINDS_V1, "report_kind", issues, "VALIDATION"),
    verdict: enumValue(entity.verdict, RESEARCH_EVALUATION_VERDICTS_V1, "verdict", issues, "NEEDS_REVIEW"),
    score: requiredScore(entity.score, "score", issues),
    metric_snapshot: jsonObject(entity.metric_snapshot),
    criteria_snapshot: jsonObject(entity.criteria_snapshot),
    artifact_refs: stringArray(entity.artifact_refs),
    reviewer_ref: nullableText(entity.reviewer_ref),
    metadata: jsonObject(entity.metadata),
    created_at_utc: requiredTimestamp(read(entity, "created_at_utc", "created_at"), "created_at_utc", issues),
  };
  if (Object.keys(normalized.metric_snapshot).length === 0) issues.push(issue("RESEARCH_EVALUATION_METRICS_REQUIRED", "metric_snapshot"));
  return validationResult("research_evaluation_report", normalized, issues);
}

export function buildResearchCandidateEvaluationSummaryV1(input = {}) {
  const reports = array(input.evaluation_reports).map((item) => validateResearchEvaluationReportV1(item).normalized);
  const scores = reports.map((item) => item.score).filter((item) => Number.isFinite(item));
  const averageScore = scores.length ? round4(scores.reduce((total, item) => total + item, 0) / scores.length) : null;
  const counts = verdictCounts(reports);
  const kindCounts = kindCountsByReport(reports);
  const verdict = candidateVerdict(counts, averageScore);
  return {
    schema_version: RESEARCH_CANDIDATE_EVALUATION_SUMMARY_VERSION_V1,
    research_candidate_id: nullableText(input.research_candidate_id) || nullableText(input.candidate_id),
    evaluation_count: reports.length,
    kind_counts: kindCounts,
    pass_count: counts.PASS,
    fail_count: counts.FAIL,
    inconclusive_count: counts.INCONCLUSIVE,
    needs_review_count: counts.NEEDS_REVIEW,
    composite_score: averageScore,
    verdict,
    promotion_candidate: verdict === "PASS",
  };
}

export function researchExperimentHashV1(input = {}) {
  return prefixedHash(validateResearchExperimentV1(input).normalized);
}

export function researchHypothesisHashV1(input = {}) {
  return prefixedHash(validateResearchHypothesisV1(input).normalized);
}

export function researchCandidateHashV1(input = {}) {
  return prefixedHash(validateResearchCandidateV1(input).normalized);
}

export function researchEvaluationReportHashV1(input = {}) {
  return prefixedHash(validateResearchEvaluationReportV1(input).normalized);
}

function prefixedHash(value) {
  return `sha256:${canonicalSha256(value)}`;
}

function validateExperimentState(entity, issues) {
  if (entity.status === "COMPLETED" && !entity.completed_at_utc) issues.push(issue("RESEARCH_EXPERIMENT_COMPLETION_TIME_REQUIRED", "completed_at_utc"));
  if (entity.winner_simulation_run_id && entity.status !== "COMPLETED") issues.push(issue("RESEARCH_EXPERIMENT_WINNER_REQUIRES_COMPLETED_STATUS", "winner_simulation_run_id"));
}

function validateCandidateIntegrity(entity, issues) {
  if (entity.promotion_blocked && !entity.promotion_block_reason) issues.push(issue("RESEARCH_CANDIDATE_BLOCK_REASON_REQUIRED", "promotion_block_reason"));
  if (entity.status === "PROMOTION_READY" && !entity.strategy_version_id) issues.push(issue("RESEARCH_CANDIDATE_STRATEGY_VERSION_REQUIRED", "strategy_version_id"));
}

function validateChronology(entity, issues) {
  const created = Date.parse(entity.created_at_utc);
  for (const field of ["updated_at_utc", "completed_at_utc"]) {
    const value = entity[field];
    if (value && Date.parse(value) < created) issues.push(issue("RESEARCH_TIMESTAMP_BEFORE_CREATED", field));
  }
}

function verdictCounts(reports) {
  return RESEARCH_EVALUATION_VERDICTS_V1.reduce((counts, verdict) => {
    counts[verdict] = reports.filter((item) => item.verdict === verdict).length;
    return counts;
  }, {});
}

function kindCountsByReport(reports) {
  return RESEARCH_EVALUATION_REPORT_KINDS_V1.reduce((counts, kind) => {
    counts[kind] = reports.filter((item) => item.report_kind === kind).length;
    return counts;
  }, {});
}

function candidateVerdict(counts, averageScore) {
  if (counts.FAIL) return "FAIL";
  if (counts.NEEDS_REVIEW || !counts.PASS) return "NEEDS_REVIEW";
  if (averageScore === null || averageScore < 0.7) return "INCONCLUSIVE";
  return "PASS";
}

function validationResult(kind, normalized, issues) {
  return {
    ok: issues.length === 0,
    status: issues.length === 0 ? "accepted" : "rejected",
    kind,
    normalized,
    reasons: issues.map((item) => item.code),
    issues,
    flags: [],
    evidence: { schema_version: normalized.schema_version },
  };
}

function requiredUuid(value, path, issues) {
  const text = nullableText(value);
  if (!text) {
    issues.push(issue("RESEARCH_UUID_REQUIRED", path));
    return null;
  }
  if (!UUID_RE.test(text)) issues.push(issue("RESEARCH_UUID_INVALID", path, { value: text }));
  return text;
}

function nullableUuid(value, path, issues) {
  const text = nullableText(value);
  if (!text) return null;
  if (!UUID_RE.test(text)) issues.push(issue("RESEARCH_UUID_INVALID", path, { value: text }));
  return text;
}

function requiredText(value, path, issues) {
  const text = nullableText(value);
  if (!text) issues.push(issue("RESEARCH_TEXT_REQUIRED", path));
  return text;
}

function optionalKey(value, path, issues) {
  const text = nullableText(value);
  if (text && !KEY_RE.test(text)) issues.push(issue("RESEARCH_KEY_INVALID", path, { value: text }));
  return text;
}

function enumValue(value, allowed, path, issues, fallback) {
  const text = String(value || fallback || "").trim().toUpperCase();
  if (!allowed.includes(text)) issues.push(issue("RESEARCH_ENUM_INVALID", path, { value }));
  return allowed.includes(text) ? text : fallback || null;
}

function nullableEnum(value, allowed, path, issues) {
  if (value === null || value === undefined || value === "") return null;
  return enumValue(value, allowed, path, issues, null);
}

function requiredTimestamp(value, path, issues) {
  const timestamp = optionalTimestamp(value, path, issues);
  if (!timestamp) issues.push(issue("RESEARCH_TIMESTAMP_REQUIRED", path));
  return timestamp;
}

function optionalTimestamp(value, path, issues) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    issues.push(issue("RESEARCH_TIMESTAMP_INVALID", path, { value }));
    return String(value);
  }
  return date.toISOString();
}

function requiredScore(value, path, issues) {
  const score = nullableScore(value, path, issues);
  if (score === null) issues.push(issue("RESEARCH_SCORE_REQUIRED", path));
  return score;
}

function nullableScore(value, path, issues) {
  if (value === null || value === undefined || value === "") return null;
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 1) issues.push(issue("RESEARCH_SCORE_OUT_OF_RANGE", path, { value }));
  return Number.isFinite(score) ? round4(score) : null;
}

function stringArray(value) {
  return array(value).map((item) => String(item).trim()).filter(Boolean);
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function jsonObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function read(entity, primary, fallback) {
  return entity[primary] === undefined ? entity[fallback] : entity[primary];
}

function nullableText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function issue(code, path, details = {}) {
  return { code, path, details };
}
