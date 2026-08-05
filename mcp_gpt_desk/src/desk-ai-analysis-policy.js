import {
  DEFAULT_CODEX_REASONING_EFFORT,
  normalizeCodexReasoningEffort,
} from "./codex-runtime-settings.js";

export const DESK_AI_ANALYSIS_POLICY_VERSION = "1.4.0";
export const DESK_AI_CONVERSATION_POLICY = "FRESH_CHECKPOINT_REPAIR_RESUME";

const CRITICAL_POSITION_STATES = new Set([
  "ACTIVE",
  "ENTERED",
  "FILLED",
  "OPEN",
  "PARTIALLY_FILLED",
  "PROTECTED",
]);

const CRITICAL_SETUP_STATES = new Set([
  "ARMED",
  "ARMED_CONDITIONAL",
  "TRIGGERED",
]);

/**
 * Selects an inference profile from canonical envelope state only. The same
 * function is deliberately shared by LIVE and Replay so an identical state
 * receives an identical reasoning budget and context depth.
 */
export function selectDeskAiAnalysisPolicy(envelope = {}, {
  configuredReasoningEffort = DEFAULT_CODEX_REASONING_EFFORT,
} = {}) {
  const configured = normalizeCodexReasoningEffort(
    configuredReasoningEffort,
    DEFAULT_CODEX_REASONING_EFFORT,
  );
  const workflow = String(envelope.workflow || "").toUpperCase();
  const isMaster = workflow.endsWith("MASTER");
  const stateReasons = isMaster ? [] : criticalStateReasons(envelope);
  const setupWatch = !isMaster && stateReasons.some(isSetupWatchReason);
  const urgentMonitor = !isMaster && stateReasons.some(isUrgentMonitorReason);
  const criticalReasons = isMaster ? ["MASTER_DECISION"] : stateReasons;
  const critical = isMaster || urgentMonitor;
  const profile = isMaster
    ? "MASTER_FULL_RESEARCH"
    : urgentMonitor
      ? "MONITOR_CRITICAL"
      : setupWatch
        ? "MONITOR_SETUP_WATCH"
        : "MONITOR_ROUTINE_DELTA";
  const effective = isMaster || urgentMonitor
    ? configured
    : setupWatch
      ? setupWatchEffort(configured)
      : routineMonitorEffort(configured);
  const optionalContextDeepening = profile !== "MONITOR_ROUTINE_DELTA";

  return Object.freeze({
    policy_version: DESK_AI_ANALYSIS_POLICY_VERSION,
    profile,
    workflow,
    configured_reasoning_effort: configured,
    effective_reasoning_effort: effective,
    context_depth: critical || setupWatch ? "standard" : "overview",
    context_windows: ["15m", "1h", "4h"],
    conversation_policy: DESK_AI_CONVERSATION_POLICY,
    continuity_source: "CANONICAL_BACKEND_AT_CUTOFF",
    context_tool_policy: optionalContextDeepening
      ? "ADAPTIVE_DEEPENING"
      : "MANDATORY_ONLY",
    optional_context_deepening: optionalContextDeepening,
    critical,
    setup_watch: setupWatch,
    critical_reasons: criticalReasons,
    target_analysis_ms: isMaster
      ? 300_000
      : urgentMonitor
        ? 240_000
        : setupWatch
          ? 150_000
          : 90_000,
  });
}

export function routineMonitorEffort(configuredReasoningEffort) {
  return normalizeCodexReasoningEffort(configuredReasoningEffort);
}

export function setupWatchEffort(configuredReasoningEffort) {
  return normalizeCodexReasoningEffort(configuredReasoningEffort);
}

function criticalStateReasons(envelope) {
  const reasons = new Set();
  const suggested = envelope.suggested_payload || {};
  if (
    suggested.position_id
    || suggested.linked_position_id
    || suggested.active_position_id
  ) {
    reasons.add("CANONICAL_POSITION_PRESENT");
  }
  walkCanonicalState(envelope.bundle, (key, value) => {
    const normalizedKey = String(key || "").toLowerCase();
    const state = stateValue(value);
    if (
      normalizedKey.includes("position")
      && CRITICAL_POSITION_STATES.has(state)
    ) {
      reasons.add(`POSITION_${state}`);
    }
    if (
      normalizedKey.includes("setup")
      && CRITICAL_SETUP_STATES.has(state)
    ) {
      reasons.add(`SETUP_${state}`);
    }
    if (
      normalizedKey.includes("replan")
      && ["DUE", "REQUIRED", "REQUESTED", "TRUE"].includes(state)
    ) {
      reasons.add("REPLAN_REQUIRED");
    }
  });
  return [...reasons].sort();
}

function isSetupWatchReason(reason) {
  return ["SETUP_ARMED", "SETUP_ARMED_CONDITIONAL"].includes(reason);
}

function isUrgentMonitorReason(reason) {
  return (
    reason === "CANONICAL_POSITION_PRESENT"
    || reason === "REPLAN_REQUIRED"
    || reason === "SETUP_TRIGGERED"
    || reason.startsWith("POSITION_")
  );
}

function walkCanonicalState(root, visit, {
  maxNodes = 25_000,
  maxDepth = 12,
} = {}) {
  const stack = [{ key: "", value: root, depth: 0 }];
  let visited = 0;
  while (stack.length && visited < maxNodes) {
    const current = stack.pop();
    visited += 1;
    visit(current.key, current.value);
    if (
      current.depth >= maxDepth
      || !current.value
      || typeof current.value !== "object"
    ) {
      continue;
    }
    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        stack.push({
          key: current.key,
          value: current.value[index],
          depth: current.depth + 1,
        });
      }
      continue;
    }
    for (const [key, value] of Object.entries(current.value)) {
      stack.push({ key, value, depth: current.depth + 1 });
    }
  }
}

function stateValue(value) {
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim().toUpperCase();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return String(
    value.state
      || value.status
      || value.lifecycle_state
      || value.position_state
      || value.setup_state
      || "",
  ).trim().toUpperCase();
}
