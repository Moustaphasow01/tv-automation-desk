import { canonicalSha256 } from "./execution-scope.js";
import { resolveResearchAgentRoleV1, buildResearchAgentMissionPolicyV1 } from "./research-agent-role-catalog-v1.js";
import { buildResearchCandidateGenomeV1, evaluateResearchCandidateNoveltyV1 } from "./research-candidate-genome-v1.js";
import { matchResearchFailureMemoryV1 } from "./research-failure-memory-v1.js";
import { buildResearchDecisionAuditV1, evaluateResearchScientificProcessV1 } from "./research-scientific-process-v1.js";
import { transitionResearchCandidateLifecycleV1 } from "./research-candidate-lifecycle-v1.js";

export const RESEARCH_CONTRADICTORY_VALIDATION_WORKFLOW_VERSION_V1 = "1.0.0";
export const RESEARCH_CONTRADICTORY_VALIDATION_POLICY_SCHEMA_VERSION_V1 = "research_contradictory_validation_policy_v1";
export const RESEARCH_CONTRADICTORY_VALIDATION_PLAN_SCHEMA_VERSION_V1 = "research_contradictory_validation_plan_v1";
export const RESEARCH_CONTRADICTORY_VALIDATION_WORK_ITEM_SCHEMA_VERSION_V1 = "research_contradictory_validation_work_item_v1";

export const RESEARCH_CONTRADICTORY_VALIDATION_PHASES_V1 = Object.freeze([
  "EVIDENCE_INVENTORY",
  "NOVELTY_MEMORY_GATE",
  "METRIC_GATE",
  "CONTRADICTORY_REVIEW",
  "DECISION_AUDIT",
  "LIFECYCLE_REVIEW",
]);

export const RESEARCH_CONTRADICTORY_VALIDATION_DECISIONS_V1 = Object.freeze([
  "WAIT_FOR_EVIDENCE",
  "REQUIRES_REVISION",
  "REJECT_CANDIDATE",
  "READY_FOR_PROMOTION_REVIEW",
]);

const REQUIRED_EVIDENCE = Object.freeze(["BASELINE_RUN", "VALIDATION_REPORT", "ROBUSTNESS_REPORT", "CONTRADICTORY_REVIEW"]);
const REVIEW_ROLES = Object.freeze(["backtest_validator", "robustness_auditor", "research_reviewer"]);
const PASSING_VERDICTS = Object.freeze(["PASS"]);
const REVISION_VERDICTS = Object.freeze(["INCONCLUSIVE", "NEEDS_REVIEW"]);

export function buildResearchContradictoryValidationPolicyV1(input = {}) {
  const policy = {
    schema_version: RESEARCH_CONTRADICTORY_VALIDATION_POLICY_SCHEMA_VERSION_V1,
    workflow_version: RESEARCH_CONTRADICTORY_VALIDATION_WORKFLOW_VERSION_V1,
    phases: [...RESEARCH_CONTRADICTORY_VALIDATION_PHASES_V1],
    required_roles: uniqueText(input.required_roles || REVIEW_ROLES),
    required_evidence: uniqueText(input.required_evidence || REQUIRED_EVIDENCE),
    thresholds: {
      min_validation_score: bounded(input.min_validation_score, 0.7),
      min_robustness_score: bounded(input.min_robustness_score, 0.65),
      min_contradictory_score: bounded(input.min_contradictory_score, 0.7),
    },
    gates: {
      contradictory_review_required: true,
      simulation_run_link_required: true,
      novelty_gate_required: true,
      failure_memory_gate_required: true,
      decision_audit_required: true,
      lifecycle_review_transition_required: true,
    },
  };
  return { ...policy, policy_hash: digest(policy) };
}

export function planResearchContradictoryValidationWorkflowV1(input = {}) {
  const policy = buildResearchContradictoryValidationPolicyV1(input.policy || input);
  const candidate = normalizeCandidate(input);
  const reports = normalizeReports(input.evaluation_reports || input.reports || input.validation_reports);
  const evidence = evidenceInventory({ reports, input, policy });
  const genome = buildResearchCandidateGenomeV1(input.genome || input.candidate_genome || candidate);
  const novelty = evaluateResearchCandidateNoveltyV1({
    candidate: genome,
    existing_genomes: input.existing_genomes,
    duplicate_threshold: input.duplicate_threshold,
    too_close_threshold: input.too_close_threshold,
  });
  const failureMemory = matchResearchFailureMemoryV1({ candidate: genome, failure_records: input.failure_records });
  const metricGate = metricGateDecision({ evidence, policy });
  const reviewGate = contradictoryReviewGate({ evidence, policy });
  const verdict = chooseValidationDecision({ evidence, novelty, failureMemory, metricGate, reviewGate });
  const decisionAudit = buildValidationDecisionAudit({ input, candidate, verdict });
  const lifecycleReview = buildLifecycleReviewTransition({ input, candidate, verdict, evidence, decisionAudit });
  const scientific = evaluateResearchScientificProcessV1({
    protocol: input.protocol || input.hypothesis || input.hypothesis_protocol || {},
    evidence: [...evidence.present_evidence, "DECISION_AUDIT"],
    evaluation_reports: reports,
    negative_result_ref: decisionAudit.normalized.negative_result_ref,
    negative_result_recorded: verdict.decision === "REJECT_CANDIDATE",
    policy: input.scientific_policy,
  });
  const plan = {
    schema_version: RESEARCH_CONTRADICTORY_VALIDATION_PLAN_SCHEMA_VERSION_V1,
    workflow_version: RESEARCH_CONTRADICTORY_VALIDATION_WORKFLOW_VERSION_V1,
    decision: verdict.decision,
    reasons: verdict.reasons,
    policy,
    candidate,
    evidence,
    genome,
    novelty,
    failure_memory: failureMemory,
    metric_gate: metricGate,
    contradictory_review_gate: reviewGate,
    scientific_process: scientific,
    decision_audit: decisionAudit,
    lifecycle_review: lifecycleReview,
    role_assignments: policy.required_roles.map((role_id) => resolveResearchAgentRoleV1({ role_id })),
  };
  return { ...plan, work_items: buildResearchContradictoryValidationWorkItemsV1(plan), plan_hash: digest(plan) };
}

export function buildResearchContradictoryValidationWorkItemsV1(input = {}) {
  const plan = input.schema_version === RESEARCH_CONTRADICTORY_VALIDATION_PLAN_SCHEMA_VERSION_V1 ? input : planResearchContradictoryValidationWorkflowV1(input);
  return plan.policy.required_roles.map((role_id, index) => {
    const missionPolicy = buildResearchAgentMissionPolicyV1({ role_id, objective: missionObjective(role_id, plan) });
    const item = {
      schema_version: RESEARCH_CONTRADICTORY_VALIDATION_WORK_ITEM_SCHEMA_VERSION_V1,
      workflow_version: RESEARCH_CONTRADICTORY_VALIDATION_WORKFLOW_VERSION_V1,
      work_item_id: `research_validation:${plan.candidate.research_candidate_id}:${role_id}`,
      sequence: index + 1,
      role_id,
      mission_policy: missionPolicy.mission_policy,
      input_refs: {
        research_candidate_id: plan.candidate.research_candidate_id,
        genome_hash: plan.genome.genome_hash,
        missing_evidence: plan.evidence.missing_evidence,
        blocking_reasons: plan.reasons,
      },
      expected_output: validationExpectedOutput(role_id),
    };
    return { ...item, work_item_hash: digest(item) };
  });
}

export function researchContradictoryValidationWorkflowHashV1(input = {}) {
  return digest(input);
}

function normalizeCandidate(input) {
  const source = plain(input.candidate || input.generation_plan?.candidate || input);
  return {
    schema_version: "research_candidate_v1",
    research_candidate_id: text(source.research_candidate_id || source.id) || `candidate:${canonicalSha256(source).slice(0, 16)}`,
    research_experiment_id: text(source.research_experiment_id),
    research_hypothesis_id: text(source.research_hypothesis_id),
    candidate_key: text(source.candidate_key || source.key),
    status: text(source.status || input.candidate_status || "IN_SIMULATION").toUpperCase(),
    strategy_version_id: text(source.strategy_version_id),
    primary_change_summary: text(source.primary_change_summary || source.summary),
    metadata: plain(source.metadata),
    instruments: source.instruments,
    timeframes: source.timeframes,
    session_scope: source.session_scope,
    entry_logic: source.entry_logic,
    confirmation_signals: source.confirmation_signals,
    exit_logic: source.exit_logic,
    risk_model: source.risk_model,
  };
}

function normalizeReports(value) {
  return arrayOf(value).map((item, index) => {
    const source = plain(item);
    const report = {
      report_id: reportId(source, index),
      kind: reportKind(reportKindSource(source)),
      verdict: verdictName(firstReportValue(source, ["verdict", "status"])),
      score: bounded(reportScore(source), null),
      simulation_run_id: text(firstReportValue(source, ["simulation_run_id", "run_id"])),
      evidence_ref: text(firstReportValue(source, ["evidence_ref", "artifact_ref", "report_id", "id"])),
      objections: uniqueText(firstReportValue(source, ["objections", "blockers", "open_questions"])),
      metrics: plain(firstReportValue(source, ["metrics", "metrics_snapshot"])),
    };
    return { ...report, report_hash: digest(report) };
  });
}

function evidenceInventory({ reports, input, policy }) {
  const inventory = {
    BASELINE_RUN: findEvidenceReport(reports, ["BASELINE_RUN", "BASELINE", "TRAIN"]),
    VALIDATION_REPORT: findEvidenceReport(reports, ["VALIDATION", "OUT_OF_SAMPLE", "WALK_FORWARD"]),
    ROBUSTNESS_REPORT: findEvidenceReport(reports, ["ROBUSTNESS"]),
    CONTRADICTORY_REVIEW: findEvidenceReport(reports, ["CONTRADICTORY_REVIEW"]),
  };
  const explicit = new Set(uniqueText(input.evidence_refs || input.evidence).map((item) => item.toUpperCase()));
  const present = policy.required_evidence.filter((key) => Boolean(inventory[key]) || explicit.has(key));
  const missing = policy.required_evidence.filter((key) => !present.includes(key));
  const runLinkMissing = Object.entries(inventory)
    .filter(([kind, report]) => policy.required_evidence.includes(kind) && report && !report.simulation_run_id && kind !== "CONTRADICTORY_REVIEW")
    .map(([kind]) => kind);
  return {
    required_evidence: policy.required_evidence,
    present_evidence: present,
    missing_evidence: missing,
    simulation_run_link_missing: runLinkMissing,
    reports_by_kind: inventory,
    normalized_reports: reports,
  };
}

function metricGateDecision({ evidence, policy }) {
  const validation = evidence.reports_by_kind.VALIDATION_REPORT;
  const robustness = evidence.reports_by_kind.ROBUSTNESS_REPORT;
  const checks = [
    scoreCheck("VALIDATION_REPORT", validation, policy.thresholds.min_validation_score),
    scoreCheck("ROBUSTNESS_REPORT", robustness, policy.thresholds.min_robustness_score),
  ];
  const failing = checks.filter((item) => item.status === "fail");
  const revisable = checks.filter((item) => item.status === "review");
  return {
    ok: failing.length === 0 && revisable.length === 0,
    status: failing.length ? "fail" : revisable.length ? "review" : "pass",
    checks,
    failing_checks: failing.map((item) => item.kind),
    review_checks: revisable.map((item) => item.kind),
  };
}

function contradictoryReviewGate({ evidence, policy }) {
  const report = evidence.reports_by_kind.CONTRADICTORY_REVIEW;
  if (!report) return { ok: false, status: "missing", report: null, reasons: ["CONTRADICTORY_REVIEW_MISSING"] };
  const scoreTooLow = report.score !== null && report.score < policy.thresholds.min_contradictory_score;
  const unresolved = report.objections.length > 0;
  const fail = report.verdict === "FAIL";
  const review = REVISION_VERDICTS.includes(report.verdict) || scoreTooLow || unresolved;
  const reasons = [
    ...(fail ? ["CONTRADICTORY_REVIEW_FAIL"] : []),
    ...(scoreTooLow ? ["CONTRADICTORY_SCORE_BELOW_THRESHOLD"] : []),
    ...(unresolved ? ["CONTRADICTORY_OBJECTIONS_UNRESOLVED"] : []),
    ...(REVISION_VERDICTS.includes(report.verdict) ? [`CONTRADICTORY_${report.verdict}`] : []),
  ];
  return { ok: !fail && !review, status: fail ? "fail" : review ? "review" : "pass", report, reasons };
}

function chooseValidationDecision({ evidence, novelty, failureMemory, metricGate, reviewGate }) {
  const reasons = [];
  if (evidence.missing_evidence.length) reasons.push(...evidence.missing_evidence.map((item) => `MISSING_${item}`));
  if (evidence.simulation_run_link_missing.length) reasons.push(...evidence.simulation_run_link_missing.map((item) => `RUN_LINK_MISSING_${item}`));
  if (reasons.length) return { decision: "WAIT_FOR_EVIDENCE", reasons };
  if (novelty.decision === "DUPLICATE") return { decision: "REJECT_CANDIDATE", reasons: ["NOVELTY_DUPLICATE"] };
  if (failureMemory.decision === "BLOCK_RETEST") return { decision: "REJECT_CANDIDATE", reasons: ["FAILURE_MEMORY_BLOCK_RETEST"] };
  if (metricGate.status === "fail") return { decision: "REJECT_CANDIDATE", reasons: metricGate.failing_checks.map((item) => `${item}_FAIL`) };
  if (reviewGate.status === "fail") return { decision: "REJECT_CANDIDATE", reasons: reviewGate.reasons };
  if (novelty.decision === "TOO_CLOSE") return { decision: "REQUIRES_REVISION", reasons: ["NOVELTY_TOO_CLOSE"] };
  if (failureMemory.decision === "REQUIRE_REVISION") return { decision: "REQUIRES_REVISION", reasons: ["FAILURE_MEMORY_REQUIRES_REVISION"] };
  if (metricGate.status === "review") return { decision: "REQUIRES_REVISION", reasons: metricGate.review_checks.map((item) => `${item}_REVIEW`) };
  if (reviewGate.status === "review") return { decision: "REQUIRES_REVISION", reasons: reviewGate.reasons };
  return { decision: "READY_FOR_PROMOTION_REVIEW", reasons: ["CONTRADICTORY_VALIDATION_READY"] };
}

function buildValidationDecisionAudit({ input, candidate, verdict }) {
  const decisionMap = {
    READY_FOR_PROMOTION_REVIEW: "PROMOTE_TO_REVIEW",
    WAIT_FOR_EVIDENCE: "WAIT_FOR_EVIDENCE",
    REQUIRES_REVISION: "NEEDS_OPERATOR_REVIEW",
    REJECT_CANDIDATE: "STOP_REJECT",
  };
  return buildResearchDecisionAuditV1({
    research_mission_id: input.research_mission_id || input.mission_id,
    decision: decisionMap[verdict.decision],
    reason: verdict.reasons.join(";"),
    evidence_refs: auditEvidenceRefs(input, verdict),
    reviewer_ref: input.reviewer_ref || "research_contradictory_validation_workflow_v1",
    negative_result_ref: verdict.decision === "REJECT_CANDIDATE" ? negativeResultRef(input, candidate, verdict) : input.negative_result_ref,
    created_at_utc: input.created_at_utc,
  });
}

function buildLifecycleReviewTransition({ input, candidate, verdict, evidence, decisionAudit }) {
  if (verdict.decision !== "READY_FOR_PROMOTION_REVIEW") return null;
  if (candidate.status !== "IN_SIMULATION") return { ok: true, status: "not_required", reason: `candidate_status:${candidate.status}` };
  return transitionResearchCandidateLifecycleV1(candidate, {
    command: "REQUEST_REVIEW",
    actor_ref: input.actor_ref || "research_contradictory_validation_workflow_v1",
    idempotency_key: input.idempotency_key || `contradictory-validation:${candidate.research_candidate_id}:${decisionAudit.audit_hash}`,
    evidence_refs: [...evidence.present_evidence, "DECISION_AUDIT"],
    transitioned_at_utc: input.created_at_utc,
  });
}

function scoreCheck(kind, report, threshold) {
  if (!report) return { kind, status: "missing", score: null, threshold, verdict: "MISSING" };
  if (report.verdict === "FAIL") return { kind, status: "fail", score: report.score, threshold, verdict: report.verdict };
  if (REVISION_VERDICTS.includes(report.verdict)) return { kind, status: "review", score: report.score, threshold, verdict: report.verdict };
  if (!PASSING_VERDICTS.includes(report.verdict)) return { kind, status: "review", score: report.score, threshold, verdict: report.verdict };
  if (report.score !== null && report.score < threshold) return { kind, status: "fail", score: report.score, threshold, verdict: report.verdict };
  return { kind, status: "pass", score: report.score, threshold, verdict: report.verdict };
}

function findEvidenceReport(reports, kinds) {
  return reports.find((item) => kinds.includes(item.kind)) || null;
}

function firstReportValue(source, keys) {
  return keys.map((key) => source[key]).find((value) => value !== undefined && value !== null && value !== "") ?? null;
}

function reportId(source, index) {
  return text(firstReportValue(source, ["report_id", "id", "evaluation_report_id"])) || `report:${index + 1}`;
}

function reportKindSource(source) {
  return firstReportValue(source, ["kind", "report_kind", "role", "run_role"]);
}

function reportScore(source) {
  return firstReportValue(source, ["score", "evaluation_score", "validation_score"]);
}

function auditEvidenceRefs(input, verdict) {
  const refs = uniqueText(input.evidence_refs || input.evidence || []);
  return refs.length ? refs : [`decision:${verdict.decision.toLowerCase()}`];
}

function negativeResultRef(input, candidate, verdict) {
  return text(input.negative_result_ref) || `negative_result:${candidate.research_candidate_id}:${canonicalSha256(verdict).slice(0, 12)}`;
}

function validationExpectedOutput(roleId) {
  const outputs = {
    backtest_validator: ["validation_report", "simulation_run_links", "no_lookahead_check"],
    robustness_auditor: ["robustness_report", "stress_scenarios", "regime_breakdown"],
    research_reviewer: ["contradictory_review", "promotion_blockers", "failure_memory_update"],
  };
  return outputs[roleId] || ["validation_note"];
}

function missionObjective(roleId, plan) {
  const suffix = plan.decision === "WAIT_FOR_EVIDENCE" ? "compléter les preuves manquantes" : "critiquer la candidate avant promotion";
  return `${roleId}:${plan.candidate.research_candidate_id}:${suffix}`;
}

function reportKind(value) {
  const normalized = text(value).toUpperCase().replaceAll("-", "_").replaceAll(" ", "_");
  if (normalized === "BASELINE") return "BASELINE";
  if (normalized === "BASELINE_RUN") return "BASELINE_RUN";
  if (normalized === "OUT_OF_SAMPLE" || normalized === "OOS") return "OUT_OF_SAMPLE";
  if (normalized === "WALK_FORWARD") return "WALK_FORWARD";
  return normalized || "UNKNOWN";
}

function verdictName(value) {
  const normalized = text(value).toUpperCase().replaceAll("-", "_").replaceAll(" ", "_");
  return ["PASS", "FAIL", "INCONCLUSIVE", "NEEDS_REVIEW"].includes(normalized) ? normalized : "NEEDS_REVIEW";
}

function bounded(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function uniqueText(value) {
  return [...new Set(arrayOf(value).map((item) => text(item)).filter(Boolean))].sort();
}

function arrayOf(value) {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null || value === "" ? [] : [value];
}

function plain(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function digest(value) {
  return `sha256:${canonicalSha256(value)}`;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}
