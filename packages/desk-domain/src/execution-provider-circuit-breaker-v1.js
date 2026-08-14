import { canonicalSha256 } from "./execution-scope.js";

export const EXECUTION_PROVIDER_CIRCUIT_BREAKER_SCHEMA_VERSION_V1 = "execution_provider_circuit_breaker_v1";
export const EXECUTION_PROVIDER_ROUTE_STATUSES_V1 = Object.freeze([
  "PRIMARY_READY",
  "FALLBACK_READY",
  "BLOCKED_NO_PROVIDER",
  "BLOCKED_CIRCUIT_OPEN",
  "BLOCKED_DOUBLE_SEND_RISK",
  "BLOCKED_RECONCILIATION_REQUIRED",
  "BLOCKED_OPERATOR_APPROVAL_REQUIRED",
]);
export const EXECUTION_PROVIDER_CIRCUIT_STATES_V1 = Object.freeze(["CLOSED", "HALF_OPEN", "OPEN"]);
export const EXECUTION_PROVIDER_FALLBACK_MODES_V1 = Object.freeze(["DISABLED", "OPERATOR_APPROVAL", "AUTOMATIC_SAFE"]);

const DOUBLE_SEND_EVENT_TYPES = Object.freeze(["ORDER_ACCEPTED", "ORDER_WORKING", "ORDER_FILLED", "ORDER_PARTIALLY_FILLED", "POSITION_UPDATED", "PROTECTION_UPDATED"]);
const IN_FLIGHT_COMMAND_STATUSES = Object.freeze(["PENDING", "READY", "LEASED", "RENDERED", "DELIVERED", "SUBMITTED", "ACKNOWLEDGED", "ACCEPTED", "WORKING", "PARTIALLY_FILLED"]);

export function planExecutionProviderCircuitBreakerV1(input = {}) {
  const now = text(input.now || input.evaluated_at_utc) || null;
  const intent = record(input.order_intent || input.intent) || {};
  const candidates = normalizeCandidates(input.provider_candidates || input.providers);
  const policy = normalizePolicy(input.policy || {}, input);
  const evidence = collectEvidence(input, intent);
  const blocker = firstBlocker({ intent, candidates, evidence });
  if (blocker) return routeResult({ status: blocker.status, now, intent, candidates, evidence, policy, issues: blocker.issues });
  return selectedRoute({ now, intent, candidates, evidence, policy });
}

function selectedRoute({ now, intent, candidates, evidence, policy }) {
  const primary = primaryCandidate(candidates);
  const primaryBlocked = primary.circuit_state === "OPEN";
  const primaryRejected = hasSafeTerminalRejection(evidence, primary.provider_id);
  if (!primaryBlocked && !primaryRejected) return routeResult({ status: "PRIMARY_READY", now, intent, candidates, evidence, policy, selectedProvider: primary, issues: [] });
  const fallbackReason = primaryBlocked ? "PRIMARY_CIRCUIT_OPEN" : "PRIMARY_TERMINAL_REJECTED";
  const fallback = fallbackCandidate(candidates, primary);
  if (!fallback) return routeResult({ status: "BLOCKED_CIRCUIT_OPEN", now, intent, candidates, evidence, policy, issues: [issue("FALLBACK_PROVIDER_UNAVAILABLE", "No enabled fallback provider is available.")] });
  if (policy.fallback_mode === "DISABLED") return routeResult({ status: "BLOCKED_CIRCUIT_OPEN", now, intent, candidates, evidence, policy, issues: [issue("FALLBACK_DISABLED", "Fallback mode is disabled by policy.")] });
  if (policy.fallback_mode === "OPERATOR_APPROVAL" && !policy.operator_approved) {
    return routeResult({ status: "BLOCKED_OPERATOR_APPROVAL_REQUIRED", now, intent, candidates, evidence, policy, issues: [issue("FALLBACK_OPERATOR_APPROVAL_REQUIRED", "Cross-provider fallback requires explicit operator approval.")] });
  }
  return routeResult({ status: "FALLBACK_READY", now, intent, candidates, evidence, policy, selectedProvider: fallback, fallbackFrom: primary, fallbackReason, issues: [] });
}

function firstBlocker({ intent, candidates, evidence }) {
  if (!text(intent.order_intent_id)) return { status: "BLOCKED_RECONCILIATION_REQUIRED", issues: [issue("ORDER_INTENT_REQUIRED", "Order intent id is required.")] };
  if (!candidates.length) return { status: "BLOCKED_NO_PROVIDER", issues: [issue("PROVIDER_CANDIDATE_REQUIRED", "At least one provider candidate is required.")] };
  if (evidence.double_send_risk.length) return { status: "BLOCKED_DOUBLE_SEND_RISK", issues: evidence.double_send_risk };
  if (evidence.reconciliation_required.length) return { status: "BLOCKED_RECONCILIATION_REQUIRED", issues: evidence.reconciliation_required };
  return null;
}

function collectEvidence(input, intent) {
  const commands = array(input.active_provider_commands || input.provider_commands).filter((command) => intentMatch(command, intent));
  const events = array(input.broker_provider_events || input.provider_events).filter((event) => intentMatch(event, intent));
  return {
    commands,
    events,
    double_send_risk: doubleSendIssues(commands, events),
    reconciliation_required: reconciliationIssues(commands, events),
    safe_rejections: safeRejections(commands, events),
  };
}

function doubleSendIssues(commands, events) {
  return [
    ...commands.filter(inFlightCommand).map((command) => issue("PROVIDER_COMMAND_IN_FLIGHT", `Command already in flight on provider ${text(command.provider_id)}.`)),
    ...events.filter(doubleSendEvent).map((event) => issue("PROVIDER_ORDER_MAY_EXIST", `Provider event ${text(event.event_type)} exists on ${text(event.provider_id)}.`)),
  ];
}

function reconciliationIssues(commands, events) {
  return [
    ...commands.filter(uncertainCommand).map((command) => issue("PROVIDER_COMMAND_UNCERTAIN", `Provider command ${text(command.execution_provider_command_id)} needs reconciliation before fallback.`)),
    ...events.filter(uncertainEvent).map((event) => issue("PROVIDER_EVENT_UNCERTAIN", `Provider event ${text(event.event_type)} needs reconciliation before fallback.`)),
  ];
}

function safeRejections(commands, events) {
  return [
    ...events.filter((event) => upper(event.event_type) === "ORDER_REJECTED").map((event) => safeRejection(event.provider_id, "ORDER_REJECTED")),
    ...commands.filter(safeRejectedCommand).map((command) => safeRejection(command.provider_id, upper(command.status))),
  ];
}

function routeResult({ status, now, intent, candidates, evidence, policy, selectedProvider = null, fallbackFrom = null, fallbackReason = null, issues }) {
  const base = {
    schema_version: EXECUTION_PROVIDER_CIRCUIT_BREAKER_SCHEMA_VERSION_V1,
    evaluated_at_utc: now,
    status,
    order_intent_id: text(intent.order_intent_id),
    selected_provider: selectedProvider ? providerRouteRef(selectedProvider) : null,
    fallback_from_provider: fallbackFrom ? providerRouteRef(fallbackFrom) : null,
    fallback_reason: fallbackReason,
    policy: { fallback_mode: policy.fallback_mode, operator_approved: policy.operator_approved },
    evidence_summary: evidenceSummary(evidence),
    issues,
  };
  return { ...base, route_hash: hash(base), provider_candidates: candidates.map(providerRouteRef) };
}

function evidenceSummary(evidence) {
  return {
    command_count: evidence.commands.length,
    event_count: evidence.events.length,
    double_send_risk_count: evidence.double_send_risk.length,
    reconciliation_required_count: evidence.reconciliation_required.length,
    safe_rejection_count: evidence.safe_rejections.length,
  };
}

function normalizeCandidates(input) {
  return array(input)
    .map((candidate, index) => normalizeCandidate(candidate, index))
    .filter((candidate) => candidate.enabled)
    .sort((left, right) => left.priority - right.priority || left.provider_id.localeCompare(right.provider_id));
}

function normalizeCandidate(candidate, index) {
  const source = record(candidate) || {};
  return {
    provider_id: text(source.provider_id || source.broker_provider_code || source.provider),
    adapter_id: text(source.adapter_id || source.adapter),
    role: upper(source.role) || (index === 0 ? "PRIMARY" : "FALLBACK"),
    priority: integer(source.priority, index),
    enabled: source.enabled !== false,
    fallback_allowed: source.fallback_allowed !== false,
    circuit_state: circuitState(source.circuit_state || source.circuitState || source.status),
  };
}

function normalizePolicy(source, root = {}) {
  return {
    fallback_mode: fallbackMode(source.fallback_mode || source.fallbackMode),
    operator_approved: source.operator_fallback_approval === true || root.operator_fallback_approval === true || record(source.operator_approval)?.approved === true || record(root.operator_approval)?.approved === true,
  };
}

function primaryCandidate(candidates) {
  return candidates.find((candidate) => candidate.role === "PRIMARY") || candidates[0];
}

function fallbackCandidate(candidates, primary) {
  return candidates.find((candidate) => candidate.provider_id !== primary.provider_id && candidate.fallback_allowed && candidate.circuit_state !== "OPEN") || null;
}

function hasSafeTerminalRejection(evidence, providerId) {
  return evidence.safe_rejections.some((entry) => entry.provider_id === providerId);
}

function providerRouteRef(candidate) {
  return { provider_id: candidate.provider_id, adapter_id: candidate.adapter_id, role: candidate.role, priority: candidate.priority, circuit_state: candidate.circuit_state };
}

function intentMatch(value, intent) {
  const source = record(value) || {};
  const intentId = text(intent.order_intent_id);
  return intentId && text(source.order_intent_id || source.intent_id) === intentId;
}

function inFlightCommand(command) {
  return IN_FLIGHT_COMMAND_STATUSES.includes(upper(command.status || command.command_status));
}

function uncertainCommand(command) {
  const status = upper(command.status || command.command_status);
  return ["FAILED", "ERROR", "TIMEOUT", "UNKNOWN"].includes(status) && !safeRejectedCommand(command);
}

function safeRejectedCommand(command) {
  const status = upper(command.status || command.command_status);
  return ["REJECTED", "FAILED"].includes(status) && (command.safe_to_fallback === true || command.fallback_safe === true || command.submitted === false);
}

function doubleSendEvent(event) {
  return DOUBLE_SEND_EVENT_TYPES.includes(upper(event.event_type || event.type));
}

function uncertainEvent(event) {
  return ["PROVIDER_ERROR", "UNKNOWN"].includes(upper(event.event_type || event.type));
}

function safeRejection(providerId, reason) {
  return { provider_id: text(providerId), reason };
}

function circuitState(value) {
  const normalized = upper(value);
  return EXECUTION_PROVIDER_CIRCUIT_STATES_V1.includes(normalized) ? normalized : "CLOSED";
}

function fallbackMode(value) {
  const normalized = upper(value) || "OPERATOR_APPROVAL";
  return EXECUTION_PROVIDER_FALLBACK_MODES_V1.includes(normalized) ? normalized : "OPERATOR_APPROVAL";
}

function hash(value) { return `sha256:${canonicalSha256(value)}`; }
function issue(code, message) { return { code, message }; }
function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
function array(value) { return Array.isArray(value) ? value : []; }
function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).toUpperCase(); }
function integer(value, fallback) { const parsed = Number(value); return Number.isInteger(parsed) ? parsed : fallback; }
