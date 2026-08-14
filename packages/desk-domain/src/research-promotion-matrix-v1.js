import { canonicalSha256 } from "./execution-scope.js";
import { transitionResearchCandidateLifecycleV1 } from "./research-candidate-lifecycle-v1.js";
import { scoreResearchPriorityV1 } from "./research-coverage-priority-v1.js";
import { planResearchContradictoryValidationWorkflowV1 } from "./research-contradictory-validation-workflow-v1.js";

export const RESEARCH_PROMOTION_MATRIX_VERSION_V1 = "1.0.0";
export const RESEARCH_PROMOTION_MATRIX_POLICY_SCHEMA_VERSION_V1 = "research_promotion_matrix_policy_v1";
export const RESEARCH_PROMOTION_MATRIX_DECISION_SCHEMA_VERSION_V1 = "research_promotion_matrix_decision_v1";
export const RESEARCH_OPERATOR_APPROVAL_SCHEMA_VERSION_V1 = "research_operator_approval_v1";
export const RESEARCH_PROMOTION_ROLLBACK_PLAN_SCHEMA_VERSION_V1 = "research_promotion_rollback_plan_v1";

export const RESEARCH_PROMOTION_DECISIONS_V1 = Object.freeze([
  "BLOCKED",
  "NEEDS_OPERATOR_APPROVAL",
  "APPROVED_FOR_PROMOTION",
  "REJECT_PROMOTION",
  "RETIRE_CANDIDATE",
]);

export const RESEARCH_OPERATOR_APPROVAL_STATUSES_V1 = Object.freeze(["PENDING", "APPROVED", "REJECTED"]);

const PROMOTION_EVIDENCE = Object.freeze(["VALIDATION_REPORT", "ROBUSTNESS_REPORT", "CONTRADICTORY_REVIEW", "DECISION_AUDIT"]);

export function buildResearchPromotionMatrixPolicyV1(input = {}) {
  const policy = {
    schema_version: RESEARCH_PROMOTION_MATRIX_POLICY_SCHEMA_VERSION_V1,
    matrix_version: RESEARCH_PROMOTION_MATRIX_VERSION_V1,
    thresholds: {
      min_priority_score: bound(input.min_priority_score, 0.5),
      min_validation_score: bound(input.min_validation_score, 0.7),
      min_robustness_score: bound(input.min_robustness_score, 0.65),
    },
    required_gates: {
      contradictory_validation_ready: true,
      priority_not_deferred: true,
      strategy_version_ref_required: true,
      operator_approval_required: true,
      rollback_plan_required: true,
      lifecycle_promotion_transition_required: true,
    },
    allowed_priority_decisions: clean(input.allowed_priority_decisions || ["HIGH_PRIORITY", "MEDIUM_PRIORITY", "LOW_PRIORITY"]),
  };
  return { ...policy, policy_hash: stamp(policy) };
}

export function evaluateResearchPromotionMatrixV1(input = {}) {
  const policy = buildResearchPromotionMatrixPolicyV1(input.policy || input);
  const validation = validationPlan(input);
  const candidate = normalizeCandidate(input, validation);
  const priority = priorityScore(input, candidate);
  const approval = normalizeOperatorApprovalV1(input.operator_approval || input.approval);
  const rollback_plan = buildResearchPromotionRollbackPlanV1({ ...input, candidate });
  const gates = promotionGates({ policy, validation, candidate, priority, approval, rollback_plan });
  const decision = promotionDecision({ input, gates, approval, validation });
  const lifecycle_promotion = lifecyclePromotion({ input, candidate, decision, gates, rollback_plan });
  const matrix = {
    schema_version: RESEARCH_PROMOTION_MATRIX_DECISION_SCHEMA_VERSION_V1,
    matrix_version: RESEARCH_PROMOTION_MATRIX_VERSION_V1,
    decision,
    reasons: promotionReasons({ decision, gates, approval, validation }),
    policy,
    candidate,
    validation_plan_ref: validation.plan_hash,
    priority_score: priority,
    operator_approval: approval,
    rollback_plan,
    gates,
    lifecycle_promotion,
    front_summary: promotionFrontSummary({ decision, candidate, priority, approval, gates }),
  };
  return { ...matrix, matrix_hash: stamp(matrix) };
}

export function normalizeOperatorApprovalV1(input = {}) {
  const source = box(input);
  const status = approvalStatus(source.status || source.decision);
  const approval = {
    schema_version: RESEARCH_OPERATOR_APPROVAL_SCHEMA_VERSION_V1,
    approval_id: word(source.approval_id || source.id),
    status,
    operator_ref: word(source.operator_ref || source.operator),
    reason: word(source.reason || source.comment),
    approved_at_utc: iso(source.approved_at_utc || source.created_at_utc),
    scope: {
      research_candidate_id: word(source.research_candidate_id),
      strategy_version_id: word(source.strategy_version_id),
    },
  };
  return { ...approval, ok: approvalOk(approval), approval_hash: stamp(approval) };
}

export function buildResearchPromotionRollbackPlanV1(input = {}) {
  const source = box(input.rollback_plan || input);
  const candidate = box(input.candidate);
  const plan = {
    schema_version: RESEARCH_PROMOTION_ROLLBACK_PLAN_SCHEMA_VERSION_V1,
    matrix_version: RESEARCH_PROMOTION_MATRIX_VERSION_V1,
    strategy_version_id: word(source.strategy_version_id || candidate.strategy_version_id),
    previous_strategy_version_id: word(source.previous_strategy_version_id),
    rollback_action: rollbackAction(source.rollback_action),
    retirement_action: rollbackAction(source.retirement_action || "DEPRECATE_PROMOTED_VERSION"),
    trigger_policy: {
      live_drift_review_required: truthy(source.live_drift_review_required, true),
      operator_can_retire: truthy(source.operator_can_retire, true),
      revert_to_previous_when_available: Boolean(word(source.previous_strategy_version_id)),
    },
  };
  return { ...plan, ok: Boolean(plan.strategy_version_id && plan.rollback_action), rollback_plan_hash: stamp(plan) };
}

export function researchPromotionMatrixHashV1(input = {}) {
  return stamp(input);
}

function promotionGates({ policy, validation, candidate, priority, approval, rollback_plan }) {
  return {
    contradictory_validation: gate(validation.decision === "READY_FOR_PROMOTION_REVIEW", validation.decision),
    priority: gate(priority.priority_score >= policy.thresholds.min_priority_score && policy.allowed_priority_decisions.includes(priority.decision), `${priority.decision}:${priority.priority_score}`),
    strategy_version: gate(Boolean(candidate.strategy_version_id), candidate.strategy_version_id || "STRATEGY_VERSION_REQUIRED"),
    operator_approval: gate(approval.ok, approval.status || "APPROVAL_REQUIRED"),
    rollback_plan: gate(rollback_plan.ok, rollback_plan.rollback_action || "ROLLBACK_PLAN_REQUIRED"),
  };
}

function promotionDecision({ input, gates, approval, validation }) {
  if (action(input) === "RETIRE") return "RETIRE_CANDIDATE";
  if (approval.status === "REJECTED") return "REJECT_PROMOTION";
  if (validation.decision === "REJECT_CANDIDATE") return "REJECT_PROMOTION";
  if (!gates.contradictory_validation.ok || !gates.priority.ok || !gates.strategy_version.ok || !gates.rollback_plan.ok) return "BLOCKED";
  if (!gates.operator_approval.ok) return "NEEDS_OPERATOR_APPROVAL";
  return "APPROVED_FOR_PROMOTION";
}

function lifecyclePromotion({ input, candidate, decision, gates, rollback_plan }) {
  if (decision !== "APPROVED_FOR_PROMOTION") return null;
  if (candidate.status !== "UNDER_REVIEW") return { ok: true, status: "not_required", reason: `candidate_status:${candidate.status}` };
  return transitionResearchCandidateLifecycleV1(candidate, {
    command: "MARK_PROMOTION_READY",
    actor_ref: input.actor_ref || "research_promotion_matrix_v1",
    idempotency_key: input.idempotency_key || `research-promotion:${candidate.research_candidate_id}:${rollback_plan.rollback_plan_hash}`,
    evidence_refs: [...PROMOTION_EVIDENCE, "PROMOTION_MATRIX"],
    strategy_version_id: candidate.strategy_version_id,
    process_decision: gates.contradictory_validation.detail === "READY_FOR_PROMOTION_REVIEW" ? "PROMOTE_TO_REVIEW" : "",
    transitioned_at_utc: input.created_at_utc,
  });
}

function validationPlan(input) {
  const plan = input.validation_plan || input.contradictory_validation_plan;
  if (plan?.schema_version === "research_contradictory_validation_plan_v1") return plan;
  return planResearchContradictoryValidationWorkflowV1(input.validation_input || input);
}

function priorityScore(input, candidate) {
  const score = input.priority_score || input.research_priority_score;
  if (score?.schema_version === "research_priority_score_v1") return score;
  return scoreResearchPriorityV1({ ...input, candidate });
}

function normalizeCandidate(input, validation) {
  const source = box(input.candidate || validation.candidate || input);
  return {
    schema_version: "research_candidate_v1",
    research_candidate_id: word(source.research_candidate_id || source.id),
    research_experiment_id: word(source.research_experiment_id),
    research_hypothesis_id: word(source.research_hypothesis_id),
    candidate_key: word(source.candidate_key || source.key),
    source_type: word(source.source_type || "AI_GENERATED"),
    status: word(source.status || input.candidate_status || "UNDER_REVIEW").toUpperCase(),
    strategy_version_id: word(source.strategy_version_id || input.strategy_version_id),
    primary_change_summary: word(source.primary_change_summary || source.summary),
    metadata: box(source.metadata),
  };
}

function promotionReasons({ decision, gates, approval, validation }) {
  if (decision === "APPROVED_FOR_PROMOTION") return ["PROMOTION_MATRIX_APPROVED"];
  if (decision === "NEEDS_OPERATOR_APPROVAL") return ["OPERATOR_APPROVAL_REQUIRED"];
  if (decision === "REJECT_PROMOTION") return approval.status === "REJECTED" ? ["OPERATOR_REJECTED_PROMOTION"] : [`VALIDATION_${validation.decision}`];
  if (decision === "RETIRE_CANDIDATE") return ["OPERATOR_REQUESTED_RETIREMENT"];
  return Object.entries(gates).filter(([, item]) => !item.ok).map(([name, item]) => `${name.toUpperCase()}_${item.detail}`);
}

function promotionFrontSummary({ decision, candidate, priority, approval, gates }) {
  return {
    label: candidate.candidate_key || candidate.research_candidate_id,
    decision,
    priority_score: priority.priority_score,
    approval_status: approval.status,
    blocked_gates: Object.entries(gates).filter(([, item]) => !item.ok).map(([name]) => name),
  };
}

function gate(ok, detail) {
  return { ok: Boolean(ok), detail: word(detail) };
}

function action(input) {
  return word(input.action || input.promotion_action).toUpperCase();
}

function approvalStatus(value) {
  const normalized = word(value || "PENDING").toUpperCase();
  return RESEARCH_OPERATOR_APPROVAL_STATUSES_V1.includes(normalized) ? normalized : "PENDING";
}

function approvalOk(approval) {
  return approval.status === "APPROVED" && Boolean(approval.approval_id && approval.operator_ref);
}

function rollbackAction(value) {
  return word(value || "REVERT_TO_PREVIOUS_OR_RETIRE").toUpperCase();
}

function truthy(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function clean(value) {
  return [...new Set(list(value).map((item) => word(item).toUpperCase()).filter(Boolean))].sort();
}

function list(value) {
  if (Array.isArray(value)) return value;
  return value === null || value === undefined || value === "" ? [] : [value];
}

function word(value) {
  return typeof value === "string" ? value.trim() : "";
}

function iso(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function box(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stamp(value) {
  return `sha256:${canonicalSha256(value)}`;
}

function bound(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback;
}
