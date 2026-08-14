import { canonicalSha256 } from "./execution-scope.js";
import { planExecutionProviderCircuitBreakerV1 } from "./execution-provider-circuit-breaker-v1.js";

export const EXECUTION_PROVIDER_SHADOW_CUTOVER_SCHEMA_VERSION_V1 = "execution_provider_shadow_cutover_v1";
export const EXECUTION_PROVIDER_SHADOW_CUTOVER_STATUSES_V1 = Object.freeze(["SHADOW_OBSERVING", "CUTOVER_READY", "CUTOVER_BLOCKED", "ROLLBACK_REQUIRED"]);
export const NINJATRADER_RETIREMENT_SCHEMA_VERSION_V1 = "ninjatrader_retirement_plan_v1";
export const NINJATRADER_RETIREMENT_STATUSES_V1 = Object.freeze(["RETIREMENT_READY", "RETIREMENT_OBSERVING", "RETIREMENT_BLOCKED"]);

export function evaluateExecutionProviderShadowCutoverV1(input = {}) {
  const evaluated_at_utc = evaluatedAt(input);
  const policy = observationPolicy(input);
  const primary_events = normalizeEvents(input.primary_events || input.ninjatrader_events);
  const shadow_events = normalizeEvents(input.shadow_events || input.fallback_events);
  const parity = compareProviderEvents(primary_events, shadow_events);
  const observation = observationState({ input, policy, parity });
  const circuit_breaker_route = input.circuit_breaker_route || planExecutionProviderCircuitBreakerV1({ ...input, now: evaluated_at_utc });
  const controls = cutoverControls({ circuit_breaker_route, parity, observation, input });
  const report = {
    schema_version: EXECUTION_PROVIDER_SHADOW_CUTOVER_SCHEMA_VERSION_V1,
    evaluated_at_utc,
    order_intent_id: text(input.order_intent_id || input.order_intent?.order_intent_id),
    primary_provider_id: text(input.primary_provider_id || "ninjatrader"),
    shadow_provider_id: text(input.shadow_provider_id || input.fallback_provider_id),
    status: cutoverStatus({ controls, observation, input }),
    circuit_breaker_route: routeSummary(circuit_breaker_route),
    observation,
    parity,
    controls,
  };
  return { ...report, cutover_hash: hash(report) };
}

export function planNinjaTraderRetirementV1(input = {}) {
  const certification = record(input.provider_certification || input.certification) || {};
  const approval = record(input.operator_approval) || {};
  const replacement_provider_id = text(input.replacement_provider_id || certification.provider_id);
  const issues = [
    ...requireIssue(replacement_provider_id && replacement_provider_id !== "ninjatrader", "REPLACEMENT_PROVIDER_REQUIRED"),
    ...requireIssue(certification.status === "CERTIFIED" || input.shadow_cutover?.status === "CUTOVER_READY", "PROVIDER_CERTIFICATION_REQUIRED"),
    ...requireIssue(approval.approved === true && approval.decision === "APPROVE_NINJATRADER_RETIREMENT", "OPERATOR_RETIREMENT_APPROVAL_REQUIRED"),
    ...requireIssue(number(input.direct_ninjatrader_reference_count) === 0, "DIRECT_NINJATRADER_REFERENCES_REMAIN"),
    ...requireIssue(record(input.rollback_plan)?.proven === true, "ROLLBACK_PLAN_PROOF_REQUIRED"),
  ];
  const plan = {
    schema_version: NINJATRADER_RETIREMENT_SCHEMA_VERSION_V1,
    evaluated_at_utc: evaluatedAt(input),
    status: retirementStatus(issues, certification),
    replacement_provider_id: replacement_provider_id || null,
    can_remove_runtime_dependency: issues.length === 0,
    required_actions: issues.map((item) => ({ code: item.code, action: actionForRetirementIssue(item.code) })),
    issues,
  };
  return { ...plan, retirement_hash: hash(plan) };
}

function cutoverControls({ circuit_breaker_route, parity, observation, input }) {
  const controls = [];
  if (String(circuit_breaker_route.status || "").startsWith("BLOCKED")) controls.push(control("HALT_CUTOVER", `Circuit breaker status ${circuit_breaker_route.status}.`));
  if (parity.mismatch_count > 0) controls.push(control("INVESTIGATE_SHADOW_MISMATCH", "Primary and shadow provider events are not equivalent."));
  if (!observation.minimum_window_satisfied) controls.push(control("CONTINUE_SHADOW_OBSERVATION", "Minimum shadow observation is not satisfied."));
  if (input.force_rollback === true || (input.runtime_mode === "CUTOVER" && controls.some((item) => item.code !== "CONTINUE_SHADOW_OBSERVATION"))) controls.push(control("ROLLBACK_TO_PRIMARY", "Cutover runtime must return to the previous safe provider."));
  return controls;
}

function cutoverStatus({ controls, observation, input }) {
  if (controls.some((item) => item.code === "ROLLBACK_TO_PRIMARY")) return "ROLLBACK_REQUIRED";
  if (controls.some((item) => item.code === "HALT_CUTOVER" || item.code === "INVESTIGATE_SHADOW_MISMATCH")) return "CUTOVER_BLOCKED";
  if (!observation.minimum_window_satisfied || input.runtime_mode === "SHADOW") return "SHADOW_OBSERVING";
  return "CUTOVER_READY";
}

function compareProviderEvents(primary, shadow) {
  const primary_signatures = primary.map(eventSignature).sort();
  const shadow_signatures = shadow.map(eventSignature).sort();
  const missing_in_shadow = primary_signatures.filter((item) => !shadow_signatures.includes(item));
  const shadow_only = shadow_signatures.filter((item) => !primary_signatures.includes(item));
  return {
    primary_event_count: primary.length,
    shadow_event_count: shadow.length,
    semantic_hash_match: hash(primary_signatures) === hash(shadow_signatures),
    missing_in_shadow,
    shadow_only,
    mismatch_count: missing_in_shadow.length + shadow_only.length,
  };
}

function observationState({ input, policy, parity }) {
  const observed_order_count = number(input.observed_order_count ?? Math.max(parity.primary_event_count, parity.shadow_event_count));
  const observed_minutes = number(input.observed_minutes);
  return {
    observed_order_count,
    observed_minutes,
    minimum_order_count: policy.minimum_order_count,
    minimum_observation_minutes: policy.minimum_observation_minutes,
    minimum_window_satisfied: observed_order_count >= policy.minimum_order_count && observed_minutes >= policy.minimum_observation_minutes,
  };
}

function observationPolicy(input) {
  const policy = record(input.observation_policy) || {};
  return {
    minimum_order_count: number(policy.minimum_order_count ?? 1),
    minimum_observation_minutes: number(policy.minimum_observation_minutes ?? 60),
  };
}

function normalizeEvents(input) {
  return array(input).map((event) => ({
    provider_id: text(event.provider_id),
    order_intent_id: text(event.order_intent_id || event.intent_id),
    event_type: upper(event.event_type || event.type),
    provider_order_ref: text(event.provider_order_ref || event.order_ref),
    fill_quantity: number(event.fill_quantity ?? event.quantity),
    fill_price: number(event.fill_price ?? event.price),
    position_size: number(event.position_size ?? event.signed_size),
  }));
}

function eventSignature(event) {
  return JSON.stringify({
    order_intent_id: event.order_intent_id,
    event_type: event.event_type,
    fill_quantity: event.fill_quantity,
    fill_price: event.fill_price,
    position_size: event.position_size,
  });
}

function routeSummary(route = {}) {
  return {
    status: text(route.status),
    selected_provider: route.selected_provider || null,
    fallback_from_provider: route.fallback_from_provider || null,
    evidence_summary: route.evidence_summary || null,
    route_hash: route.route_hash || null,
  };
}

function retirementStatus(issues, certification) {
  if (!issues.length) return "RETIREMENT_READY";
  return certification.status === "OBSERVING" ? "RETIREMENT_OBSERVING" : "RETIREMENT_BLOCKED";
}

function actionForRetirementIssue(code) {
  return {
    REPLACEMENT_PROVIDER_REQUIRED: "select_non_ninjatrader_provider",
    PROVIDER_CERTIFICATION_REQUIRED: "complete_shadow_certification",
    OPERATOR_RETIREMENT_APPROVAL_REQUIRED: "collect_explicit_operator_approval",
    DIRECT_NINJATRADER_REFERENCES_REMAIN: "remove_or_wrap_direct_references",
    ROLLBACK_PLAN_PROOF_REQUIRED: "prove_runtime_rollback",
  }[code] || "operator_review";
}

function requireIssue(ok, code) { return ok ? [] : [{ code }]; }
function evaluatedAt(input) { return iso(input.evaluated_at_utc || input.now) || null; }
function control(code, reason) { return { code, reason }; }
function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
function array(value) { return Array.isArray(value) ? value : []; }
function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).toUpperCase(); }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function iso(value) { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }
function hash(value) { return `sha256:${canonicalSha256(value)}`; }
