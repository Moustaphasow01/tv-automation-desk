import { canonicalSha256 } from "./execution-scope.js";
import { RESEARCH_AGENT_ROLE_IDS_V1 } from "./research-agent-role-catalog-v1.js";

export const RESEARCH_SCIENTIFIC_PROCESS_VERSION_V1 = "1.0.0";
export const RESEARCH_SCIENTIFIC_POLICY_SCHEMA_VERSION_V1 = "research_scientific_policy_v1";
export const RESEARCH_HYPOTHESIS_PROTOCOL_SCHEMA_VERSION_V1 = "research_hypothesis_protocol_v1";
export const RESEARCH_SCIENTIFIC_MISSION_SCHEMA_VERSION_V1 = "research_scientific_mission_v1";
export const RESEARCH_BUDGET_EVALUATION_SCHEMA_VERSION_V1 = "research_budget_evaluation_v1";
export const RESEARCH_PROCESS_DECISION_SCHEMA_VERSION_V1 = "research_process_decision_v1";
export const RESEARCH_DECISION_AUDIT_SCHEMA_VERSION_V1 = "research_decision_audit_v1";

export const RESEARCH_SCIENTIFIC_PHASES_V1 = Object.freeze([
  "HYPOTHESIS",
  "DATASET_SELECTION",
  "BASELINE",
  "CANDIDATE_GENERATION",
  "SIMULATION",
  "ROBUSTNESS",
  "CONTRADICTORY_REVIEW",
  "DECISION",
]);

export const RESEARCH_BUDGET_DIMENSIONS_V1 = Object.freeze([
  "tokens",
  "wall_clock_seconds",
  "compute_seconds",
  "simulation_runs",
  "candidates",
  "iterations",
]);

export const RESEARCH_PROCESS_DECISIONS_V1 = Object.freeze([
  "CONTINUE",
  "WAIT_FOR_EVIDENCE",
  "STOP_REJECT",
  "STOP_BUDGET_EXHAUSTED",
  "PROMOTE_TO_REVIEW",
  "NEEDS_OPERATOR_REVIEW",
]);

export const RESEARCH_REQUIRED_EVIDENCE_V1 = Object.freeze([
  "FALSIFIABLE_HYPOTHESIS",
  "DATASET_SCOPE",
  "BASELINE_RUN",
  "VALIDATION_REPORT",
  "ROBUSTNESS_REPORT",
  "CONTRADICTORY_REVIEW",
  "DECISION_AUDIT",
  "NEGATIVE_RESULT_RECORD",
]);

const DEFAULT_TOTAL_BUDGET = Object.freeze({
  max_tokens: 500000,
  max_wall_clock_seconds: 86400,
  max_compute_seconds: 14400,
  max_simulation_runs: 20,
  max_candidates: 12,
  max_iterations: 6,
});

const DEFAULT_PHASE_BUDGETS = Object.freeze({
  HYPOTHESIS: Object.freeze({ max_tokens: 40000, max_wall_clock_seconds: 7200, max_compute_seconds: 300, max_simulation_runs: 0, max_candidates: 0, max_iterations: 1 }),
  DATASET_SELECTION: Object.freeze({ max_tokens: 30000, max_wall_clock_seconds: 7200, max_compute_seconds: 1200, max_simulation_runs: 0, max_candidates: 0, max_iterations: 1 }),
  BASELINE: Object.freeze({ max_tokens: 30000, max_wall_clock_seconds: 14400, max_compute_seconds: 2400, max_simulation_runs: 2, max_candidates: 1, max_iterations: 1 }),
  CANDIDATE_GENERATION: Object.freeze({ max_tokens: 90000, max_wall_clock_seconds: 14400, max_compute_seconds: 1800, max_simulation_runs: 0, max_candidates: 6, max_iterations: 2 }),
  SIMULATION: Object.freeze({ max_tokens: 90000, max_wall_clock_seconds: 21600, max_compute_seconds: 4800, max_simulation_runs: 10, max_candidates: 6, max_iterations: 2 }),
  ROBUSTNESS: Object.freeze({ max_tokens: 90000, max_wall_clock_seconds: 21600, max_compute_seconds: 3600, max_simulation_runs: 6, max_candidates: 3, max_iterations: 2 }),
  CONTRADICTORY_REVIEW: Object.freeze({ max_tokens: 90000, max_wall_clock_seconds: 14400, max_compute_seconds: 300, max_simulation_runs: 0, max_candidates: 3, max_iterations: 1 }),
  DECISION: Object.freeze({ max_tokens: 40000, max_wall_clock_seconds: 3600, max_compute_seconds: 300, max_simulation_runs: 2, max_candidates: 1, max_iterations: 1 }),
});

export function buildResearchScientificProcessPolicyV1(input = {}) {
  const policy = {
    schema_version: RESEARCH_SCIENTIFIC_POLICY_SCHEMA_VERSION_V1,
    policy_version: RESEARCH_SCIENTIFIC_PROCESS_VERSION_V1,
    phases: [...RESEARCH_SCIENTIFIC_PHASES_V1],
    role_sequence: roleSequence(input.role_sequence),
    total_budget: budget(input.total_budget || input.budget, DEFAULT_TOTAL_BUDGET),
    phase_budgets: phaseBudgets(input.phase_budgets),
    required_evidence: requiredEvidence(input.required_evidence),
    gates: {
      hypothesis_required_first: true,
      baseline_required_before_candidate: true,
      robustness_required_before_promotion: true,
      contradictory_review_required_before_promotion: true,
      audit_required_for_decision: true,
      negative_results_must_be_retained: true,
    },
    thresholds: {
      min_validation_score: score(input.min_validation_score, 0.7),
      min_robustness_score: score(input.min_robustness_score, 0.65),
    },
  };
  return { ...policy, policy_hash: hash(policy) };
}

export function validateResearchHypothesisProtocolV1(input = {}) {
  const issues = [];
  const entity = object(input.hypothesis || input);
  const normalized = {
    schema_version: RESEARCH_HYPOTHESIS_PROTOCOL_SCHEMA_VERSION_V1,
    research_experiment_id: nullableText(input.research_experiment_id || entity.research_experiment_id),
    research_hypothesis_id: nullableText(input.research_hypothesis_id || entity.research_hypothesis_id || entity.id),
    statement: requiredText(entity.statement, "statement", issues),
    falsifiable_question: requiredText(entity.falsifiable_question, "falsifiable_question", issues),
    expected_outcome: requiredText(entity.expected_outcome, "expected_outcome", issues),
    invalidation_criteria: requiredText(entity.invalidation_criteria, "invalidation_criteria", issues),
    dataset_scope: jsonObject(entity.dataset_scope || input.dataset_scope),
    variable_set: jsonObject(entity.variable_set),
    population_scope: nullableText(entity.population_scope),
    evidence_refs: stringArray(input.evidence_refs || entity.evidence_refs),
  };
  if (!looksFalsifiable(normalized.falsifiable_question)) issues.push(issue("RESEARCH_HYPOTHESIS_QUESTION_NOT_FALSIFIABLE", "falsifiable_question"));
  if (Object.keys(normalized.dataset_scope).length === 0) issues.push(issue("RESEARCH_DATASET_SCOPE_REQUIRED", "dataset_scope"));
  return result("research_hypothesis_protocol", normalized, issues);
}

export function buildResearchScientificMissionV1(input = {}) {
  const policy = buildResearchScientificProcessPolicyV1(input.policy);
  const protocol = validateResearchHypothesisProtocolV1(input.protocol || input.hypothesis || input);
  const mission = {
    schema_version: RESEARCH_SCIENTIFIC_MISSION_SCHEMA_VERSION_V1,
    process_version: RESEARCH_SCIENTIFIC_PROCESS_VERSION_V1,
    research_mission_id: nullableText(input.research_mission_id || input.mission_id),
    research_experiment_id: protocol.normalized.research_experiment_id,
    research_hypothesis_id: protocol.normalized.research_hypothesis_id,
    objective: requiredTextValue(input.objective) || protocol.normalized.statement,
    status: protocol.ok ? "READY" : "REJECTED",
    role_sequence: policy.role_sequence,
    phases: policy.phases,
    budget_plan: policy.total_budget,
    phase_budgets: policy.phase_budgets,
    required_evidence: policy.required_evidence,
    hypothesis_protocol: protocol.normalized,
    policy_hash: policy.policy_hash,
    audit_required: true,
    negative_result_retention_required: true,
  };
  return { ok: protocol.ok, status: protocol.status, reasons: protocol.reasons, mission, mission_hash: hash(mission) };
}

export function evaluateResearchBudgetUsageV1(input = {}) {
  const policy = buildResearchScientificProcessPolicyV1(input.policy);
  const usage = budgetUsage(input.usage || input);
  const dimensions = [
    dimension("tokens", usage.tokens, policy.total_budget.max_tokens),
    dimension("wall_clock_seconds", usage.wall_clock_seconds, policy.total_budget.max_wall_clock_seconds),
    dimension("compute_seconds", usage.compute_seconds, policy.total_budget.max_compute_seconds),
    dimension("simulation_runs", usage.simulation_runs, policy.total_budget.max_simulation_runs),
    dimension("candidates", usage.candidates, policy.total_budget.max_candidates),
    dimension("iterations", usage.iterations, policy.total_budget.max_iterations),
  ];
  const exhausted = dimensions.filter((item) => item.exhausted).map((item) => item.dimension);
  const evaluation = {
    schema_version: RESEARCH_BUDGET_EVALUATION_SCHEMA_VERSION_V1,
    policy_version: policy.policy_version,
    ok: exhausted.length === 0,
    status: exhausted.length ? "budget_exhausted" : "within_budget",
    usage,
    dimensions,
    exhausted_dimensions: exhausted,
    policy_hash: policy.policy_hash,
  };
  return { ...evaluation, budget_evaluation_hash: hash(evaluation) };
}

export function evaluateResearchScientificProcessV1(input = {}) {
  const policy = buildResearchScientificProcessPolicyV1(input.policy);
  const protocol = validateResearchHypothesisProtocolV1(input.protocol || input.hypothesis || input.hypothesis_protocol || {});
  const budgetEvaluation = evaluateResearchBudgetUsageV1({ policy, usage: input.usage || input.budget_usage });
  const evidence = evidenceState(input.evidence || input);
  if (protocol.ok) {
    evidence.FALSIFIABLE_HYPOTHESIS = true;
    evidence.DATASET_SCOPE = Object.keys(protocol.normalized.dataset_scope).length > 0;
  }
  const negative = negativeEvidence(input);
  const decision = chooseDecision({ protocol, budgetEvaluation, evidence, negative });
  const payload = {
    schema_version: RESEARCH_PROCESS_DECISION_SCHEMA_VERSION_V1,
    process_version: RESEARCH_SCIENTIFIC_PROCESS_VERSION_V1,
    decision: decision.decision,
    reason: decision.reason,
    ok: decision.decision !== "STOP_REJECT" && decision.decision !== "STOP_BUDGET_EXHAUSTED",
    missing_evidence: missingEvidence(evidence, policy.required_evidence),
    exhausted_budget_dimensions: budgetEvaluation.exhausted_dimensions,
    negative_result_retention: {
      required: decision.negative_result_required,
      retained: negative.retained,
      reason: negative.reason,
    },
    audit_required: true,
    policy_hash: policy.policy_hash,
    protocol_hash: hash(protocol.normalized),
    budget_evaluation_hash: budgetEvaluation.budget_evaluation_hash,
  };
  return { ...payload, decision_hash: hash(payload) };
}

export function buildResearchDecisionAuditV1(input = {}) {
  const issues = [];
  const normalized = {
    schema_version: RESEARCH_DECISION_AUDIT_SCHEMA_VERSION_V1,
    process_version: RESEARCH_SCIENTIFIC_PROCESS_VERSION_V1,
    research_mission_id: nullableText(input.research_mission_id || input.mission_id),
    decision: enumValue(input.decision, RESEARCH_PROCESS_DECISIONS_V1, "decision", issues, "NEEDS_OPERATOR_REVIEW"),
    reason: requiredText(input.reason, "reason", issues),
    evidence_refs: stringArray(input.evidence_refs || input.evidenceRefs),
    reviewer_ref: requiredText(input.reviewer_ref || input.reviewer, "reviewer_ref", issues),
    negative_result_ref: nullableText(input.negative_result_ref),
    created_at_utc: timestamp(input.created_at_utc || input.created_at),
  };
  if (normalized.evidence_refs.length === 0) issues.push(issue("RESEARCH_DECISION_EVIDENCE_REQUIRED", "evidence_refs"));
  if (isNegativeDecision(normalized.decision) && !normalized.negative_result_ref) issues.push(issue("RESEARCH_NEGATIVE_RESULT_RETENTION_REQUIRED", "negative_result_ref"));
  const audit = result("research_decision_audit", normalized, issues);
  return { ...audit, audit_hash: hash(audit.normalized) };
}

export function researchScientificProcessHashV1(input = {}) {
  return hash(input);
}

function chooseDecision({ protocol, budgetEvaluation, evidence, negative }) {
  if (!protocol.ok) return decision("STOP_REJECT", "HYPOTHESIS_PROTOCOL_INVALID", true);
  if (!budgetEvaluation.ok) return decision("STOP_BUDGET_EXHAUSTED", "RESEARCH_BUDGET_EXHAUSTED", true);
  if (negative.hasFailure) return decision("STOP_REJECT", negative.retained ? "NEGATIVE_EVIDENCE_RETAINED" : "NEGATIVE_EVIDENCE_REQUIRES_RETENTION", true);
  if (missingEvidence(evidence, ["BASELINE_RUN", "VALIDATION_REPORT", "ROBUSTNESS_REPORT", "CONTRADICTORY_REVIEW"]).length) {
    return decision("WAIT_FOR_EVIDENCE", "REQUIRED_EVIDENCE_MISSING", false);
  }
  return decision("PROMOTE_TO_REVIEW", "SCIENTIFIC_GATES_READY_FOR_REVIEW", false);
}

function decision(value, reason, negativeResultRequired) {
  return { decision: value, reason, negative_result_required: negativeResultRequired };
}

function negativeEvidence(input) {
  const reports = array(input.evaluation_reports || input.reports);
  const hasFailure = reports.some((item) => String(item.verdict || "").toUpperCase() === "FAIL");
  const retained = Boolean(input.negative_result_recorded || input.negative_result_ref || reports.some((item) => item.negative_result_ref || item.persisted === true));
  return {
    hasFailure,
    retained: !hasFailure || retained,
    reason: hasFailure ? (retained ? "NEGATIVE_RESULT_RETAINED" : "NEGATIVE_RESULT_NOT_RETAINED") : "NO_NEGATIVE_RESULT",
  };
}

function evidenceState(input) {
  const source = Array.isArray(input) ? input : input.evidence || input.evidence_refs || input.evidence_refs_present;
  const explicit = new Set(stringArray(source).map((item) => item.toUpperCase()));
  const state = {};
  for (const key of RESEARCH_REQUIRED_EVIDENCE_V1) state[key] = explicit.has(key) || Boolean(input[key.toLowerCase()]);
  state.FALSIFIABLE_HYPOTHESIS = state.FALSIFIABLE_HYPOTHESIS || Boolean(input.falsifiable_hypothesis || input.hypothesis_protocol);
  state.NEGATIVE_RESULT_RECORD = state.NEGATIVE_RESULT_RECORD || Boolean(input.negative_result_recorded || input.negative_result_ref);
  return state;
}

function missingEvidence(evidence, required) {
  return required.filter((key) => !evidence[key]);
}

function phaseBudgets(input) {
  const overrides = object(input);
  return RESEARCH_SCIENTIFIC_PHASES_V1.reduce((acc, phase) => {
    acc[phase] = budget(overrides[phase], DEFAULT_PHASE_BUDGETS[phase]);
    return acc;
  }, {});
}

function budget(input, fallback) {
  const source = object(input);
  return {
    max_tokens: integer(source.max_tokens ?? source.token_budget, fallback.max_tokens, 0, 10_000_000),
    max_wall_clock_seconds: integer(source.max_wall_clock_seconds, fallback.max_wall_clock_seconds, 0, 604800),
    max_compute_seconds: integer(source.max_compute_seconds, fallback.max_compute_seconds, 0, 604800),
    max_simulation_runs: integer(source.max_simulation_runs, fallback.max_simulation_runs, 0, 100000),
    max_candidates: integer(source.max_candidates ?? source.max_candidate_count, fallback.max_candidates, 0, 100000),
    max_iterations: integer(source.max_iterations ?? source.max_iteration_count, fallback.max_iterations, 0, 100000),
  };
}

function budgetUsage(input) {
  const source = object(input);
  return {
    tokens: integer(source.tokens ?? source.tokens_used, 0, 0, 10_000_000),
    wall_clock_seconds: integer(source.wall_clock_seconds ?? source.wall_clock_seconds_used, 0, 0, 604800),
    compute_seconds: integer(source.compute_seconds ?? source.compute_seconds_used, 0, 0, 604800),
    simulation_runs: integer(source.simulation_runs ?? source.simulation_run_count, 0, 0, 100000),
    candidates: integer(source.candidates ?? source.candidate_count, 0, 0, 100000),
    iterations: integer(source.iterations ?? source.iteration_count, 0, 0, 100000),
  };
}

function dimension(name, used, limit) {
  return { dimension: name, used, limit, remaining: Math.max(0, limit - used), exhausted: used > limit };
}

function roleSequence(value) {
  const requested = stringArray(value).map((item) => item.toLowerCase().replaceAll("-", "_"));
  const roles = requested.length ? requested : [...RESEARCH_AGENT_ROLE_IDS_V1];
  return roles.filter((item, index) => RESEARCH_AGENT_ROLE_IDS_V1.includes(item) && roles.indexOf(item) === index);
}

function requiredEvidence(input) {
  const values = stringArray(input).map((item) => item.toUpperCase());
  return values.length ? values.filter((item) => RESEARCH_REQUIRED_EVIDENCE_V1.includes(item)) : [...RESEARCH_REQUIRED_EVIDENCE_V1];
}

function looksFalsifiable(value) {
  const text = nullableText(value).toLowerCase();
  return text.includes("?") && /(does|can|when|if|versus|vs|beat|reduce|increase|under|after|before|est-ce|bat|réduit|augmente)/i.test(text);
}

function requiredText(value, path, issues) {
  const text = requiredTextValue(value);
  if (!text) issues.push(issue("RESEARCH_TEXT_REQUIRED", path));
  return text;
}

function requiredTextValue(value) {
  const text = nullableText(value);
  return text.length >= 3 ? text : "";
}

function nullableText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function enumValue(value, allowed, path, issues, fallback) {
  const normalized = String(value || fallback || "").trim().toUpperCase();
  if (!allowed.includes(normalized)) issues.push(issue("RESEARCH_ENUM_INVALID", path, { value: normalized }));
  return allowed.includes(normalized) ? normalized : fallback;
}

function score(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function integer(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function timestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date(0).toISOString();
}

function jsonObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? JSON.parse(JSON.stringify(value)) : {};
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function stringArray(value) {
  return array(value).map((item) => nullableText(item)).filter(Boolean);
}

function isNegativeDecision(value) {
  return value === "STOP_REJECT" || value === "STOP_BUDGET_EXHAUSTED";
}

function issue(code, path, details = {}) {
  return { code, path, severity: "error", ...details };
}

function result(kind, normalized, issues) {
  return {
    ok: issues.length === 0,
    status: issues.length ? "rejected" : "accepted",
    kind,
    normalized,
    reasons: issues.map((item) => item.code),
    issues,
  };
}

function hash(value) {
  return `sha256:${canonicalSha256(value)}`;
}
