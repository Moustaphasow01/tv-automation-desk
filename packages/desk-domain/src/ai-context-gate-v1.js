import { buildAiContextAdvisoryV1, proveAiContextAdvisoryIsolationV1 } from "./ai-context-advisory-v1.js";
import { canonicalSha256 } from "./execution-scope.js";

export const AI_CONTEXT_GATE_EXECUTION_SCHEMA_VERSION_V1 = "ai_context_gate_execution_v1";
export const AI_CONTEXT_GATE_MODES_V1 = Object.freeze(["SHADOW", "ADVISORY", "ENFORCED"]);
export const AI_CONTEXT_GATE_STATUSES_V1 = Object.freeze(["SHADOW_RECORDED", "ADVISORY_READY", "ENFORCED_DECISION_READY", "ENFORCED_BLOCKED", "FALLBACK_WAIT", "DISABLED"]);
export const AI_CONTEXT_GATE_FALLBACK_REASONS_V1 = Object.freeze(["AI_CONTEXT_TIMEOUT", "AI_CONTEXT_MODEL_UNAVAILABLE", "AI_CONTEXT_INVALID_ADVISORY", "AI_CONTEXT_DISABLED", "AI_CONTEXT_ENFORCEMENT_NOT_VALIDATED"]);
export const AI_CONTEXT_GATE_POLICY_VERSION_V1 = "ai_context_gate_policy_v1";

export function evaluateAiContextGateV1(input = {}) {
  const policy = normalizePolicy(input.policy);
  const asOf = iso(firstDefined(input.as_of_utc, input.asOfUtc, input.completed_at_utc, input.completedAtUtc, new Date().toISOString()));
  const elapsedMs = elapsed(input);
  if (policy.enabled === false) return fallbackResult(input, asOf, policy, "DISABLED", "AI_CONTEXT_DISABLED", elapsedMs);
  if (timedOut(input, elapsedMs, policy.timeout_ms)) return fallbackResult(input, asOf, policy, "FALLBACK_WAIT", "AI_CONTEXT_TIMEOUT", elapsedMs);
  if (modelUnavailable(input)) return fallbackResult(input, asOf, policy, "FALLBACK_WAIT", "AI_CONTEXT_MODEL_UNAVAILABLE", elapsedMs);

  const advisoryResult = buildAiContextAdvisoryV1({ ...subjectFrom(input), ...record(input.advisory), issued_at_utc: firstDefined(record(input.advisory).issued_at_utc, asOf) });
  if (!advisoryResult.ok) return fallbackResult(input, asOf, policy, "FALLBACK_WAIT", "AI_CONTEXT_INVALID_ADVISORY", elapsedMs, advisoryResult.reasons);

  if (policy.mode === "ENFORCED" && policy.enforcement_validated !== true) {
    return fallbackResult(input, asOf, policy, "ENFORCED_BLOCKED", "AI_CONTEXT_ENFORCEMENT_NOT_VALIDATED", elapsedMs, [], advisoryResult.advisory);
  }

  return executionResult({
    asOf,
    policy,
    status: statusFor(policy),
    advisoryResult,
    latency_ms: elapsedMs,
    retry: retryPlan(input, policy, null),
  });
}

function fallbackResult(input, asOf, policy, status, reason, latencyMs, rejectedReasons = [], observedAdvisory = null) {
  return executionResult({
    asOf,
    policy,
    status,
    advisoryResult: fallbackAdvisory(input, asOf, reason),
    fallbackReason: reason,
    rejected_reasons: rejectedReasons,
    observed_advisory: observedAdvisory,
    latency_ms: latencyMs,
    retry: retryPlan(input, policy, reason),
  });
}

function executionResult({ asOf, policy, status, advisoryResult, fallbackReason = null, rejected_reasons = [], observed_advisory = null, latency_ms = null, retry = null }) {
  const advisory = advisoryResult.advisory;
  const isolation = proveAiContextAdvisoryIsolationV1({ advisories: [advisory] });
  const base = {
    schema_version: AI_CONTEXT_GATE_EXECUTION_SCHEMA_VERSION_V1,
    policy_version: policy.policy_version,
    model_policy_version: policy.model_policy_version,
    status,
    ok: isolation.ok,
    mode: policy.mode,
    as_of_utc: asOf,
    timeout_ms: policy.timeout_ms,
    latency_ms,
    fallback_applied: Boolean(fallbackReason),
    fallback_reason: fallbackReason,
    rejected_reasons,
    advisory,
    observed_advisory,
    decision: {
      recommendation: advisory.recommendation,
      confidence: advisory.confidence,
      risk_multiplier: advisory.risk_multiplier,
      reason_codes: advisory.reason_codes,
      anomalies: advisory.anomalies,
      invalidation: advisory.invalidation,
    },
    retry,
    recommendation_effect: policy.mode === "SHADOW" ? "OBSERVED_ONLY" : "READ_ONLY_ADVISORY",
    enforcement: policy.mode === "ENFORCED" && policy.enforcement_validated === true ? "PORTFOLIO_POLICY_INPUT_ONLY" : "NONE",
    binding_decision: bindingDecision(policy, advisory),
    execution_side_effects: {
      order_intents_created: [],
      target_positions_created: [],
      candidate_allocations_created: [],
      human_confirmations_created: [],
      provider_commands_created: [],
      post_risk_mutations: [],
      broker_writes: [],
    },
    forbidden_direct_capabilities: [
      "AI_TO_ORDER_INTENT",
      "AI_TO_HUMAN_CONFIRM",
      "AI_TO_PROVIDER_COMMAND",
      "AI_BYPASS_PORTFOLIO",
      "AI_BYPASS_RISK",
      "AI_POST_RISK_MUTATION",
    ],
    isolation,
  };
  return { ...base, execution_hash: `sha256:${canonicalSha256(base)}` };
}

function statusFor(policy) {
  if (policy.mode === "SHADOW") return "SHADOW_RECORDED";
  if (policy.mode === "ENFORCED" && policy.enforcement_validated === true) return "ENFORCED_DECISION_READY";
  return "ADVISORY_READY";
}

function bindingDecision(policy, advisory) {
  if (policy.mode !== "ENFORCED" || policy.enforcement_validated !== true) return {
    active: false,
    effect: "NO_BINDING",
    portfolio_action: "OBSERVE_ONLY",
  };
  return {
    active: true,
    effect: "PORTFOLIO_ARBITRATION_CONSTRAINT",
    portfolio_action: {
      TAKE: "ALLOW",
      TAKE_REDUCED: "REQUEST_RISK_REDUCTION",
      WAIT: "DEFER",
      REJECT: "BLOCK_CANDIDATE",
    }[advisory.recommendation] || "DEFER",
    order_intent_allowed: false,
  };
}

function fallbackAdvisory(input, asOf, reason) {
  return buildAiContextAdvisoryV1({
    ...subjectFrom(input),
    recommendation: "WAIT",
    confidence: 0,
    risk_multiplier: 0,
    reason_codes: [reason],
    anomalies: reason === "AI_CONTEXT_MODEL_UNAVAILABLE" ? ["MODEL_OR_PROVIDER_UNAVAILABLE"] : [],
    invalidation: { condition: "AI_CONTEXT_GATE_FALLBACK", reason_code: reason },
    rationale: fallbackRationale(reason),
    model_ref: text(firstDefined(input.model_ref, input.modelRef, "system/ai-context-fallback")),
    evidence_refs: [{ ref: `fallback:${reason}` }],
    issued_at_utc: asOf,
  });
}

function subjectFrom(input) {
  const source = record(input.subject) || record(input.candidate_allocation) || record(input.signal) || record(input.position) || {};
  const subjectType = firstDefined(input.subject_type, source.subject_type, source.type, input.candidate_allocation_id ? "CANDIDATE_ALLOCATION" : input.position_id ? "POSITION" : "SIGNAL");
  const subjectId = firstDefined(input.subject_id, source.subject_id, source.id, source.signal_id, source.position_id, source.candidate_allocation_id, input.signal_id, input.position_id, input.candidate_allocation_id);
  return {
    subject_type: subjectType,
    subject_id: subjectId,
    signal_id: firstDefined(input.signal_id, source.signal_id),
    position_id: firstDefined(input.position_id, source.position_id),
    candidate_allocation_id: firstDefined(input.candidate_allocation_id, source.candidate_allocation_id),
  };
}

function normalizePolicy(input) {
  const source = record(input);
  const mode = upper(firstDefined(source.mode, "SHADOW"));
  return {
    enabled: firstDefined(source.enabled, true) !== false,
    mode: AI_CONTEXT_GATE_MODES_V1.includes(mode) ? mode : "SHADOW",
    policy_version: text(firstDefined(source.policy_version, source.policyVersion, AI_CONTEXT_GATE_POLICY_VERSION_V1)),
    model_policy_version: text(firstDefined(source.model_policy_version, source.modelPolicyVersion, "agent_execution_policy_v1")),
    timeout_ms: integer(firstDefined(source.timeout_ms, source.timeoutMs), 120000, 1000, 900000),
    max_retry_attempts: integer(firstDefined(source.max_retry_attempts, source.maxRetryAttempts), 2, 0, 5),
    retry_delay_ms: integer(firstDefined(source.retry_delay_ms, source.retryDelayMs), 60000, 1000, 900000),
    enforcement_validated: source.enforcement_validated === true,
  };
}

function modelUnavailable(input) {
  if (input.model_available === false || input.modelAvailable === false) return true;
  if (input.provider_available === false || input.providerAvailable === false) return true;
  const status = upper(firstDefined(input.model_status, input.modelStatus, input.provider_status, input.providerStatus));
  if (["UNAVAILABLE", "DOWN", "ERROR", "CIRCUIT_OPEN"].includes(status)) return true;
  const code = upper(firstDefined(input.error_code, input.errorCode));
  return ["MODEL_UNAVAILABLE", "PROVIDER_UNAVAILABLE", "LLM_UNAVAILABLE", "CIRCUIT_OPEN"].includes(code);
}

function retryPlan(input, policy, reason) {
  const source = record(input.retry);
  const attempt = integer(firstDefined(source.attempt, input.attempt), 0, 0, 99);
  const maxAttempts = integer(firstDefined(source.max_attempts, source.maxAttempts, policy.max_retry_attempts), policy.max_retry_attempts, 0, 5);
  const transient = ["AI_CONTEXT_TIMEOUT", "AI_CONTEXT_MODEL_UNAVAILABLE"].includes(reason);
  return {
    schema_version: "ai_context_gate_retry_v1",
    attempt,
    max_attempts: maxAttempts,
    retry_allowed: Boolean(reason && transient && attempt < maxAttempts),
    retry_reason: reason,
    next_retry_after_ms: reason && transient && attempt < maxAttempts ? policy.retry_delay_ms : null,
  };
}

function timedOut(input, elapsedMs, timeoutMs) {
  if (input.timed_out === true || input.timedOut === true) return true;
  return elapsedMs !== null && elapsedMs > timeoutMs;
}

function elapsed(input) {
  const direct = Number(firstDefined(input.latency_ms, input.elapsed_ms, input.elapsedMs));
  if (Number.isFinite(direct) && direct >= 0) return Math.round(direct);
  const started = Date.parse(firstDefined(input.started_at_utc, input.startedAtUtc, ""));
  const completed = Date.parse(firstDefined(input.completed_at_utc, input.completedAtUtc, input.as_of_utc, ""));
  if (!Number.isFinite(started) || !Number.isFinite(completed)) return null;
  return Math.max(0, completed - started);
}

function fallbackRationale(reason) {
  return {
    AI_CONTEXT_TIMEOUT: "AI Context Gate timeout: fallback déterministe WAIT, sans effet d'exécution.",
    AI_CONTEXT_MODEL_UNAVAILABLE: "AI Context Gate indisponible: fallback déterministe WAIT, sans effet d'exécution.",
    AI_CONTEXT_INVALID_ADVISORY: "AI Context Gate a produit une sortie invalide: fallback déterministe WAIT, sans effet d'exécution.",
    AI_CONTEXT_DISABLED: "AI Context Gate désactivé: fallback déterministe WAIT, sans effet d'exécution.",
    AI_CONTEXT_ENFORCEMENT_NOT_VALIDATED: "Mode ENFORCED non validé par décision opérateur: fallback déterministe WAIT.",
  }[reason] || "AI Context Gate fallback déterministe WAIT.";
}

function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function firstDefined(...values) { return values.find((value) => value !== undefined && value !== null && value !== "") ?? null; }
function iso(value) { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString(); }
function integer(value, fallback, min, max) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}
function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).toUpperCase(); }
