import { canonicalSha256 } from "./execution-scope.js";

export const AI_CONTEXT_ADVISORY_SCHEMA_VERSION_V1 = "ai_context_advisory_v1";
export const AI_CONTEXT_ADVISORY_ISOLATION_PROOF_SCHEMA_VERSION_V1 = "ai_context_advisory_isolation_proof_v1";
export const AI_CONTEXT_ADVISORY_RECOMMENDATIONS_V1 = Object.freeze(["TAKE", "TAKE_REDUCED", "WAIT", "REJECT"]);
export const AI_CONTEXT_ADVISORY_SUBJECT_TYPES_V1 = Object.freeze(["SIGNAL", "POSITION", "CANDIDATE_ALLOCATION"]);
export const AI_CONTEXT_ADVISORY_EFFECTS_V1 = Object.freeze(["READ_ONLY_ADVISORY"]);
export const AI_CONTEXT_ADVISORY_PROHIBITED_CAPABILITIES_V1 = Object.freeze([
  "ORDER_INTENT_CREATE",
  "CANDIDATE_ALLOCATION_CREATE",
  "TARGET_POSITION_CREATE",
  "HUMAN_EXECUTION_CONFIRM",
  "BROKER_ORDER_SUBMIT",
  "BROKER_ORDER_CANCEL",
  "BROKER_POSITION_MANAGE",
  "EXECUTION_PROVIDER_WRITE",
  "POST_RISK_MUTATION",
]);

const PROHIBITED_FIELD_PATTERNS = Object.freeze([
  /(^|_)order(_|$)/,
  /order_intent/,
  /target_position/,
  /human_execution_gate/,
  /human_confirm/,
  /execution_outbox/,
  /broker/,
  /provider_contract/,
  /provider_command/,
  /risk_decision/,
  /risk_approved/,
  /post_risk/,
  /submit/,
  /confirm/,
  /quantity/,
  /contracts/,
  /time_in_force/,
  /order_type/,
]);

export function buildAiContextAdvisoryV1(input = {}) {
  const issues = [];
  const issuedAt = iso(firstDefined(input.issued_at_utc, input.issued_at, input.created_at_utc, input.created_at, new Date().toISOString()));
  const expiresAt = iso(firstDefined(input.expires_at_utc, input.expires_at));
  const recommendation = enumValue(firstDefined(input.recommendation, input.advisory_recommendation), AI_CONTEXT_ADVISORY_RECOMMENDATIONS_V1, "recommendation", issues);
  const subject = normalizeSubject(input, issues);
  const riskMultiplier = boundedRiskMultiplier(firstDefined(input.risk_multiplier, input.riskMultiplier), recommendation, issues);
  const advisory = {
    schema_version: AI_CONTEXT_ADVISORY_SCHEMA_VERSION_V1,
    advisory_id: text(firstDefined(input.advisory_id, input.id)),
    subject,
    recommendation,
    confidence: boundedConfidence(input.confidence),
    risk_multiplier: riskMultiplier,
    reason_codes: stringArray(firstDefined(input.reason_codes, input.reasonCodes)),
    anomalies: stringArray(input.anomalies),
    invalidation: invalidation(input.invalidation),
    rationale: requiredText(firstDefined(input.rationale, input.reasoning, input.summary), "rationale", issues),
    model_ref: requiredText(firstDefined(input.model_ref, input.model, input.modelRef), "model_ref", issues),
    evidence_refs: evidenceRefs(firstDefined(input.evidence_refs, input.evidence, input.sources)),
    mode: "ADVISORY",
    effect: "READ_ONLY_ADVISORY",
    issued_at_utc: issuedAt || issueValue("issued_at_utc", issues),
    expires_at_utc: expiresAt,
  };
  if (!advisory.advisory_id) advisory.advisory_id = `aictx_${canonicalSha256({ subject, recommendation, rationale: advisory.rationale, model_ref: advisory.model_ref, issued_at_utc: advisory.issued_at_utc }).slice(0, 24)}`;
  if (issuedAt && expiresAt && Date.parse(expiresAt) <= Date.parse(issuedAt)) issues.push(issue("AI_CONTEXT_ADVISORY_EXPIRY_NOT_AFTER_ISSUE", "expires_at_utc"));
  issues.push(...prohibitedFieldIssues(input));
  const isolation = proveAiContextAdvisoryIsolationV1({ advisories: [advisory], raw_inputs: [input] });
  const ok = issues.length === 0 && isolation.ok;
  return {
    ok,
    reasons: [...new Set([...issues.map((item) => item.code), ...isolation.reasons])],
    issues,
    advisory: { ...advisory, advisory_hash: hash(advisory) },
    isolation,
  };
}

export function proveAiContextAdvisoryIsolationV1(input = {}) {
  const advisories = array(firstDefined(input.advisories, input.items, input.advisory ? [input.advisory] : []));
  const rawInputs = array(input.raw_inputs);
  const sources = rawInputs.length ? rawInputs : advisories;
  const violations = sources.flatMap((item, index) => prohibitedFieldIssues(item).map((violation) => ({ advisory_index: index, ...violation })));
  const invalidRecommendations = advisories.flatMap((item, index) => AI_CONTEXT_ADVISORY_RECOMMENDATIONS_V1.includes(upper(item.recommendation)) ? [] : [{ advisory_index: index, code: "AI_CONTEXT_ADVISORY_RECOMMENDATION_INVALID", path: "recommendation", value: item.recommendation }]);
  const candidateAllocationCreations = sources.flatMap((item, index) => createdTargetViolations(item, index));
  const checks = [
    check("NO_ORDER_OR_BROKER_FIELDS", violations.length === 0, violations),
    check("RECOMMENDATION_ENUM_ONLY", invalidRecommendations.length === 0, invalidRecommendations),
    check("NO_TARGET_ENTITY_CREATION", candidateAllocationCreations.length === 0, candidateAllocationCreations),
    check("READ_ONLY_EFFECT_ONLY", advisories.every((item) => !item.effect || item.effect === "READ_ONLY_ADVISORY"), advisories.filter((item) => item.effect && item.effect !== "READ_ONLY_ADVISORY")),
  ];
  const base = {
    schema_version: AI_CONTEXT_ADVISORY_ISOLATION_PROOF_SCHEMA_VERSION_V1,
    ok: checks.every((item) => item.ok),
    advisory_count: advisories.length,
    effect: "READ_ONLY_ADVISORY",
    prohibited_capabilities: [...AI_CONTEXT_ADVISORY_PROHIBITED_CAPABILITIES_V1],
    checks,
  };
  return {
    ...base,
    reasons: checks.filter((item) => !item.ok).map((item) => item.code),
    proof_hash: hash(base),
  };
}

function normalizeSubject(input, issues) {
  const subjectType = enumValue(firstDefined(input.subject_type, input.subjectType, input.applies_to?.type, inferredSubjectType(input)), AI_CONTEXT_ADVISORY_SUBJECT_TYPES_V1, "subject_type", issues);
  const subjectId = requiredText(firstDefined(input.subject_id, input.subjectId, input.applies_to?.id, input.signal_id, input.position_id, input.candidate_allocation_id), "subject_id", issues);
  return {
    subject_type: subjectType,
    subject_id: subjectId,
    signal_id: optionalText(firstDefined(input.signal_id, subjectType === "SIGNAL" ? subjectId : null)),
    position_id: optionalText(firstDefined(input.position_id, subjectType === "POSITION" ? subjectId : null)),
    candidate_allocation_id: optionalText(firstDefined(input.candidate_allocation_id, subjectType === "CANDIDATE_ALLOCATION" ? subjectId : null)),
  };
}

function inferredSubjectType(input) {
  if (input.candidate_allocation_id) return "CANDIDATE_ALLOCATION";
  if (input.position_id) return "POSITION";
  return input.signal_id ? "SIGNAL" : null;
}

function prohibitedFieldIssues(input, path = "") {
  if (!input || typeof input !== "object") return [];
  return Object.entries(input).flatMap(([key, value]) => {
    const nextPath = path ? `${path}.${key}` : key;
    const normalized = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).toLowerCase();
    const own = PROHIBITED_FIELD_PATTERNS.some((pattern) => pattern.test(normalized)) && !allowedReferenceField(normalized)
      ? [issue("AI_CONTEXT_ADVISORY_PROHIBITED_FIELD", nextPath, { field: key })]
      : [];
    return [...own, ...prohibitedFieldIssues(value, nextPath)];
  });
}

function createdTargetViolations(input, index, path = "") {
  if (!input || typeof input !== "object") return [];
  return Object.entries(input).flatMap(([key, value]) => {
    const nextPath = path ? `${path}.${key}` : key;
    const normalized = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).toLowerCase();
    const own = /create|created|output|produced|generated/.test(normalized) && /candidate_allocation|target_position|order_intent/.test(`${normalized}:${JSON.stringify(value ?? "")}`)
      ? [{ advisory_index: index, code: "AI_CONTEXT_ADVISORY_TARGET_CREATION_FORBIDDEN", path: nextPath }]
      : [];
    return [...own, ...createdTargetViolations(value, index, nextPath)];
  });
}

function allowedReferenceField(key) {
  return ["candidate_allocation_id", "signal_id", "position_id"].includes(key);
}

function evidenceRefs(input) {
  return array(input).map((item) => typeof item === "string" ? { ref: item } : object(item)).filter((item) => item.ref || item.dataset_id || item.event_id || item.url);
}

function enumValue(value, allowed, path, issues) {
  const normalized = upper(value);
  if (allowed.includes(normalized)) return normalized;
  issues.push(issue("AI_CONTEXT_ADVISORY_ENUM_INVALID", path, { value }));
  return normalized || null;
}

function requiredText(value, path, issues) {
  const normalized = optionalText(value);
  if (normalized) return normalized;
  issues.push(issue("AI_CONTEXT_ADVISORY_REQUIRED", path));
  return "";
}

function issueValue(path, issues) {
  issues.push(issue("AI_CONTEXT_ADVISORY_REQUIRED", path));
  return "";
}

function boundedConfidence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(1, Math.round(parsed * 10000) / 10000));
}

function boundedRiskMultiplier(value, recommendation, issues) {
  const defaultValue = {
    TAKE: 1,
    TAKE_REDUCED: 0.5,
    WAIT: 0,
    REJECT: 0,
  }[recommendation] ?? 0;
  if (value === undefined || value === null || value === "") return defaultValue;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    issues.push(issue("AI_CONTEXT_ADVISORY_RISK_MULTIPLIER_INVALID", "risk_multiplier", { value }));
    return defaultValue;
  }
  return Math.round(parsed * 10000) / 10000;
}

function stringArray(value) {
  return array(value)
    .map((item) => optionalText(item))
    .filter(Boolean)
    .slice(0, 32);
}

function invalidation(value) {
  const source = object(value);
  if (!Object.keys(source).length) return null;
  return {
    condition: optionalText(firstDefined(source.condition, source.when)),
    expires_at_utc: iso(firstDefined(source.expires_at_utc, source.expiresAt)),
    reason_code: optionalText(firstDefined(source.reason_code, source.reasonCode)),
  };
}

function check(code, ok, details) {
  return { code, ok, details };
}

function issue(code, path, extra = {}) {
  return { code, path, ...extra };
}

function hash(value) { return `sha256:${canonicalSha256(value)}`; }
function iso(value) { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }
function array(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function firstDefined(...values) { return values.find((value) => value !== undefined && value !== null && value !== "") ?? null; }
function optionalText(value) { const normalized = String(value ?? "").trim(); return normalized || null; }
function text(value) { return optionalText(value) || ""; }
function upper(value) { return text(value).toUpperCase(); }
