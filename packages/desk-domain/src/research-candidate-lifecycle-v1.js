import { canonicalSha256 } from "./execution-scope.js";
import {
  RESEARCH_CANDIDATE_STATUSES_V1,
  validateResearchCandidateV1,
} from "./research-experiment-registry-v1.js";
import {
  RESEARCH_PROCESS_DECISIONS_V1,
} from "./research-scientific-process-v1.js";

export const RESEARCH_CANDIDATE_LIFECYCLE_VERSION_V1 = "1.0.0";
export const RESEARCH_CANDIDATE_LIFECYCLE_SCHEMA_VERSION_V1 = "research_candidate_lifecycle_v1";
export const RESEARCH_CANDIDATE_TRANSITION_SCHEMA_VERSION_V1 = "research_candidate_transition_v1";
export const RESEARCH_CANDIDATE_LIFECYCLE_EVENT_SCHEMA_VERSION_V1 = "research_candidate_lifecycle_event_v1";

export const RESEARCH_CANDIDATE_COMMANDS_V1 = Object.freeze([
  "START_BASELINE",
  "SUBMIT_TO_SIMULATION",
  "REQUEST_REVIEW",
  "REQUEST_REVISION",
  "MARK_PROMOTION_READY",
  "REJECT",
  "RETIRE",
]);

export const RESEARCH_CANDIDATE_TERMINAL_STATUSES_V1 = Object.freeze(["REJECTED", "RETIRED"]);

const TRANSITIONS = Object.freeze({
  IDEA: Object.freeze({
    START_BASELINE: "BASELINE_REQUIRED",
    REJECT: "REJECTED",
    RETIRE: "RETIRED",
  }),
  BASELINE_REQUIRED: Object.freeze({
    SUBMIT_TO_SIMULATION: "IN_SIMULATION",
    REJECT: "REJECTED",
    RETIRE: "RETIRED",
  }),
  IN_SIMULATION: Object.freeze({
    REQUEST_REVIEW: "UNDER_REVIEW",
    REJECT: "REJECTED",
    RETIRE: "RETIRED",
  }),
  UNDER_REVIEW: Object.freeze({
    REQUEST_REVISION: "IN_SIMULATION",
    MARK_PROMOTION_READY: "PROMOTION_READY",
    REJECT: "REJECTED",
    RETIRE: "RETIRED",
  }),
  PROMOTION_READY: Object.freeze({
    RETIRE: "RETIRED",
  }),
  REJECTED: Object.freeze({}),
  RETIRED: Object.freeze({}),
});

const EVIDENCE_FIELDS = Object.freeze([
  ["BASELINE_RUN", "BASELINE_RUN", "baseline_run_ref"],
  ["VALIDATION_REPORT", "VALIDATION_REPORT", "validation_report_ref"],
  ["ROBUSTNESS_REPORT", "ROBUSTNESS_REPORT", "robustness_report_ref"],
  ["CONTRADICTORY_REVIEW", "CONTRADICTORY_REVIEW", "contradictory_review_ref"],
  ["DECISION_AUDIT", "DECISION_AUDIT", "decision_audit_ref"],
  ["NEGATIVE_RESULT_RECORD", "NEGATIVE_RESULT", "negative_result_ref"],
]);

export function buildResearchCandidateLifecyclePolicyV1() {
  const policy = {
    schema_version: RESEARCH_CANDIDATE_LIFECYCLE_SCHEMA_VERSION_V1,
    lifecycle_version: RESEARCH_CANDIDATE_LIFECYCLE_VERSION_V1,
    statuses: [...RESEARCH_CANDIDATE_STATUSES_V1],
    commands: [...RESEARCH_CANDIDATE_COMMANDS_V1],
    terminal_statuses: [...RESEARCH_CANDIDATE_TERMINAL_STATUSES_V1],
    transitions: clone(TRANSITIONS),
    invariants: {
      evidence_required_for_every_transition: true,
      idempotency_required_for_every_transition: true,
      rejection_requires_negative_result_ref: true,
      promotion_requires_strategy_version_ref: true,
      promotion_requires_scientific_gates: true,
      terminal_candidates_are_immutable: true,
    },
  };
  return { ...policy, lifecycle_hash: hash(policy) };
}

export function transitionResearchCandidateLifecycleV1(candidate = {}, command = {}) {
  const issues = [];
  const source = object(candidate);
  const request = object(command);
  const currentStatus = candidateStatus(source.status, "IDEA", issues, "candidate.status");
  const commandName = commandNameFrom(request.command || request.action, issues);
  const targetStatus = TRANSITIONS[currentStatus]?.[commandName] || null;
  const evidenceRefs = stringArray(request.evidence_refs || request.evidenceRefs);
  validateTransitionRequest({ request, commandName, evidenceRefs, currentStatus, targetStatus, issues });
  validateCommandSpecificEvidence({ source, request, commandName, targetStatus, evidenceRefs, issues });

  const accepted = issues.length === 0;
  const nowUtc = timestamp(request.transitioned_at_utc || request.created_at_utc);
  const candidatePatch = accepted ? candidatePatchFor({ source, request, targetStatus, nowUtc }) : null;
  const event = buildLifecycleEvent({
    source,
    request,
    currentStatus,
    targetStatus,
    accepted,
    reasons: issues.map((item) => item.code),
    evidenceRefs,
    nowUtc,
  });
  return {
    schema_version: RESEARCH_CANDIDATE_TRANSITION_SCHEMA_VERSION_V1,
    lifecycle_version: RESEARCH_CANDIDATE_LIFECYCLE_VERSION_V1,
    ok: accepted,
    status: accepted ? "accepted" : "rejected",
    from_status: currentStatus,
    command: commandName,
    to_status: accepted ? targetStatus : null,
    candidate_patch: candidatePatch,
    event,
    reasons: issues.map((item) => item.code),
    issues,
    transition_hash: hash({ currentStatus, commandName, targetStatus, candidatePatch, event }),
  };
}

export function validateResearchCandidateLifecycleSnapshotV1(candidate = {}) {
  const issues = [];
  const normalizedCandidate = validateResearchCandidateV1(candidate);
  const status = candidateStatus(candidate.status, "IDEA", issues, "status");
  const evidence = evidenceSnapshot(candidate.lifecycle_evidence || candidate.evidence || candidate.metadata?.lifecycle_evidence);
  if (!normalizedCandidate.ok) issues.push(...normalizedCandidate.issues.map((item) => issue(item.code, item.path, item)));
  validateSnapshotForStatus({ candidate: object(candidate), status, evidence, issues });
  return {
    ok: issues.length === 0,
    status: issues.length ? "rejected" : "accepted",
    kind: "research_candidate_lifecycle_snapshot",
    normalized: {
      schema_version: RESEARCH_CANDIDATE_LIFECYCLE_SCHEMA_VERSION_V1,
      research_candidate_id: text(candidate.research_candidate_id || candidate.id),
      status,
      evidence,
      terminal: RESEARCH_CANDIDATE_TERMINAL_STATUSES_V1.includes(status),
    },
    reasons: issues.map((item) => item.code),
    issues,
  };
}

export function researchCandidateLifecycleHashV1(input = {}) {
  return hash(input);
}

function validateTransitionRequest({ request, commandName, evidenceRefs, currentStatus, targetStatus, issues }) {
  if (!commandName) issues.push(issue("RESEARCH_CANDIDATE_COMMAND_REQUIRED", "command"));
  if (!targetStatus) issues.push(issue("RESEARCH_CANDIDATE_TRANSITION_NOT_ALLOWED", "command", { current_status: currentStatus, command: commandName }));
  if (RESEARCH_CANDIDATE_TERMINAL_STATUSES_V1.includes(currentStatus)) issues.push(issue("RESEARCH_CANDIDATE_TERMINAL_IMMUTABLE", "candidate.status"));
  if (!text(request.actor_ref || request.actor)) issues.push(issue("RESEARCH_CANDIDATE_TRANSITION_ACTOR_REQUIRED", "actor_ref"));
  if (!text(request.idempotency_key)) issues.push(issue("RESEARCH_CANDIDATE_TRANSITION_IDEMPOTENCY_REQUIRED", "idempotency_key"));
  if (evidenceRefs.length === 0) issues.push(issue("RESEARCH_CANDIDATE_TRANSITION_EVIDENCE_REQUIRED", "evidence_refs"));
}

function validateCommandSpecificEvidence({ source, request, commandName, targetStatus, evidenceRefs, issues }) {
  if (commandName === "SUBMIT_TO_SIMULATION" && !hasEvidence(evidenceRefs, "BASELINE_RUN")) {
    issues.push(issue("RESEARCH_CANDIDATE_BASELINE_EVIDENCE_REQUIRED", "evidence_refs"));
  }
  if (commandName === "REQUEST_REVIEW" && !hasEvidence(evidenceRefs, "VALIDATION_REPORT")) {
    issues.push(issue("RESEARCH_CANDIDATE_VALIDATION_EVIDENCE_REQUIRED", "evidence_refs"));
  }
  if (commandName === "REQUEST_REVISION" && !hasEvidence(evidenceRefs, "DECISION_AUDIT")) {
    issues.push(issue("RESEARCH_CANDIDATE_REVISION_AUDIT_REQUIRED", "evidence_refs"));
  }
  if (targetStatus === "REJECTED" && !text(request.negative_result_ref)) {
    issues.push(issue("RESEARCH_CANDIDATE_NEGATIVE_RESULT_REQUIRED", "negative_result_ref"));
  }
  if (targetStatus === "PROMOTION_READY") validatePromotionEvidence({ source, request, evidenceRefs, issues });
}

function validatePromotionEvidence({ source, request, evidenceRefs, issues }) {
  if (!text(request.strategy_version_id || source.strategy_version_id)) {
    issues.push(issue("RESEARCH_CANDIDATE_PROMOTION_STRATEGY_VERSION_REQUIRED", "strategy_version_id"));
  }
  for (const required of ["VALIDATION_REPORT", "ROBUSTNESS_REPORT", "CONTRADICTORY_REVIEW", "DECISION_AUDIT"]) {
    if (!hasEvidence(evidenceRefs, required)) issues.push(issue(`RESEARCH_CANDIDATE_${required}_REQUIRED`, "evidence_refs"));
  }
  const decision = String(request.process_decision || request.scientific_decision || "").trim().toUpperCase();
  if (decision && !RESEARCH_PROCESS_DECISIONS_V1.includes(decision)) {
    issues.push(issue("RESEARCH_CANDIDATE_PROCESS_DECISION_INVALID", "process_decision"));
  }
  if (decision !== "PROMOTE_TO_REVIEW") {
    issues.push(issue("RESEARCH_CANDIDATE_PROMOTION_REQUIRES_PROCESS_READY", "process_decision"));
  }
}

function validateSnapshotForStatus({ candidate, status, evidence, issues }) {
  if (status === "PROMOTION_READY") {
    if (!text(candidate.strategy_version_id)) issues.push(issue("RESEARCH_CANDIDATE_PROMOTION_STRATEGY_VERSION_REQUIRED", "strategy_version_id"));
    for (const required of ["VALIDATION_REPORT", "ROBUSTNESS_REPORT", "CONTRADICTORY_REVIEW", "DECISION_AUDIT"]) {
      if (!evidence[required]) issues.push(issue(`RESEARCH_CANDIDATE_${required}_REQUIRED`, "lifecycle_evidence"));
    }
  }
  if (status === "REJECTED" && !evidence.NEGATIVE_RESULT_RECORD) {
    issues.push(issue("RESEARCH_CANDIDATE_NEGATIVE_RESULT_REQUIRED", "lifecycle_evidence"));
  }
}

function candidatePatchFor({ source, request, targetStatus, nowUtc }) {
  const metadata = { ...object(source.metadata), last_lifecycle_transition_at_utc: nowUtc };
  const patch = {
    status: targetStatus,
    updated_at_utc: nowUtc,
    metadata,
  };
  if (targetStatus === "PROMOTION_READY") patch.strategy_version_id = text(request.strategy_version_id || source.strategy_version_id);
  if (targetStatus === "REJECTED") {
    patch.promotion_blocked = true;
    patch.promotion_block_reason = text(request.reason) || "RESEARCH_CANDIDATE_REJECTED";
    patch.metadata.negative_result_ref = text(request.negative_result_ref);
  }
  if (targetStatus === "RETIRED") patch.metadata.retirement_reason = text(request.reason) || "RESEARCH_CANDIDATE_RETIRED";
  return patch;
}

function buildLifecycleEvent({ source, request, currentStatus, targetStatus, accepted, reasons, evidenceRefs, nowUtc }) {
  const event = {
    schema_version: RESEARCH_CANDIDATE_LIFECYCLE_EVENT_SCHEMA_VERSION_V1,
    lifecycle_version: RESEARCH_CANDIDATE_LIFECYCLE_VERSION_V1,
    research_candidate_id: text(source.research_candidate_id || source.id),
    from_status: currentStatus,
    to_status: accepted ? targetStatus : null,
    command: text(request.command || request.action).toUpperCase(),
    accepted,
    reasons,
    evidence_refs: evidenceRefs,
    actor_ref: text(request.actor_ref || request.actor),
    idempotency_key: text(request.idempotency_key),
    emitted_at_utc: nowUtc,
  };
  return { ...event, event_hash: hash(event) };
}

function evidenceSnapshot(value) {
  const source = object(value);
  const refs = stringArray(source.evidence_refs || source.refs || value);
  return Object.fromEntries(EVIDENCE_FIELDS.map(([key, marker, field]) => [key, hasEvidence(refs, marker) || Boolean(source[field])]));
}

function hasEvidence(refs, kind) {
  const expected = kind.toUpperCase();
  return refs.some((ref) => ref.toUpperCase().includes(expected));
}

function commandNameFrom(value, issues) {
  const normalized = text(value).toUpperCase();
  if (!normalized) return "";
  if (!RESEARCH_CANDIDATE_COMMANDS_V1.includes(normalized)) issues.push(issue("RESEARCH_CANDIDATE_COMMAND_INVALID", "command", { value: normalized }));
  return normalized;
}

function candidateStatus(value, fallback, issues, path) {
  const normalized = text(value || fallback).toUpperCase();
  if (!RESEARCH_CANDIDATE_STATUSES_V1.includes(normalized)) issues.push(issue("RESEARCH_CANDIDATE_STATUS_INVALID", path, { value: normalized }));
  return RESEARCH_CANDIDATE_STATUSES_V1.includes(normalized) ? normalized : fallback;
}

function timestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date(0).toISOString();
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringArray(value) {
  return (Array.isArray(value) ? value : []).map((item) => text(item)).filter(Boolean);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function issue(code, path, details = {}) {
  return { code, path, severity: "error", ...details };
}

function hash(value) {
  return `sha256:${canonicalSha256(value)}`;
}
