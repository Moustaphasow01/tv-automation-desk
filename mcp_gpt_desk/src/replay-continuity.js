const SETUP_STATUS_ALIASES = new Map([
  ["WAIT", "WAIT_NO_SETUP"],
  ["NO_SETUP", "WAIT_NO_SETUP"],
  ["WAIT_NO_SETUP", "WAIT_NO_SETUP"],
  ["CANDIDATE", "SETUP_CANDIDATE"],
  ["SETUP_CANDIDATE", "SETUP_CANDIDATE"],
  ["PREARMED", "PRE_ARMED"],
  ["PRE_ARM", "PRE_ARMED"],
  ["PRE_ARMED", "PRE_ARMED"],
  ["PRE-ARMED", "PRE_ARMED"],
  ["ARMED", "ARMED_CONDITIONAL"],
  ["ARM_SETUP", "ARMED_CONDITIONAL"],
  ["SETUP_ARMED", "ARMED_CONDITIONAL"],
  ["CONDITIONAL", "ARMED_CONDITIONAL"],
  ["EXECUTABLE", "ARMED_CONDITIONAL"],
  ["READY", "ARMED_CONDITIONAL"],
  ["ACTIVE", "ARMED_CONDITIONAL"],
  ["ARMED_CONDITIONAL", "ARMED_CONDITIONAL"],
  ["CONDITIONAL_ARMED", "ARMED_CONDITIONAL"],
  ["TRIGGER_GO", "TRIGGER_GO"],
  ["TRIGGERED", "TRIGGERED"],
  ["OPEN", "TRIGGERED"],
  ["INVALID", "INVALIDATED"],
  ["INVALIDATED", "INVALIDATED"],
  ["EXPIRED", "EXPIRED"],
  ["CANCELLED", "CANCELLED"],
  ["CANCELED", "CANCELLED"],
  ["REPLACED", "REPLACED"],
  ["WAIT_EVENT_FREEZE", "WAIT_EVENT_FREEZE"],
  ["MANAGEMENT_ONLY", "WAIT_MANAGEMENT_ONLY"],
  ["WAIT_MANAGEMENT_ONLY", "WAIT_MANAGEMENT_ONLY"],
  ["REPLAN_REQUIRED", "REPLAN_REQUIRED"],
]);

const ACTIVE_SETUP_STATUS_SET = new Set([
  "SETUP_CANDIDATE",
  "PRE_ARMED",
  "ARMED_CONDITIONAL",
  "TRIGGER_GO",
  "WAIT_EVENT_FREEZE",
  "WAIT_MANAGEMENT_ONLY",
]);

const TERMINAL_SETUP_STATUS_SET = new Set(["TRIGGERED", "INVALIDATED", "EXPIRED", "CANCELLED", "REPLACED"]);
const HARD_BLOCKER_STATUSES = new Set(["PASSED", "TRUE", "ACTIVE"]);
const PASS_STATUSES = new Set(["PASSED", "TRUE", "VALIDATED", "CONFIRMED", "OK"]);
const FAIL_STATUSES = new Set(["FAILED", "FALSE", "INVALIDATED", "REJECTED", "NO"]);
const PENDING_STATUSES = new Set(["PENDING", "WAITING", "UNKNOWN", "NOT_OBSERVED", "UNOBSERVED"]);
import {
  buildPositionFromTriggeredSetup,
  evaluatePositionOnRows,
  isOpenPosition,
  selectOpenPosition,
} from "./position-continuity-engine.js";
import {
  evaluateDeterministicConditionSetV1,
  evaluateOpportunitySeekingControlledV1,
  normalizeContractOrderTypeV1,
} from "@tv-automation/desk-domain";
import { ACTIVE_STRATEGY_RUNTIME_VERSIONS } from "./strategy-runtime-versioning.js";
import { GPT_MONITOR_CADENCE_MINUTES } from "./desk-monitor-cadence.js";
const SETUP_MATERIALIZING_MONITOR_ACTIONS = new Set([
  "SETUP_CANDIDATE",
  "PRE_ARM",
  "PRE_ARMED",
  "ARM_SETUP",
  "ARMED_CONDITIONAL",
  "TRIGGER_GO",
  "TRANSFORM_SCENARIO",
  "THESIS_CONDITIONAL",
  "CONDITIONAL_THESIS",
  "CANCEL_SETUP",
  "EXPIRE_SETUP",
  "REPLACE",
  "REPLACE_SETUP",
]);
const DEFAULT_REPLAY_SETUP_MIN_SCORE = 0.65;
const DEFAULT_REPLAY_PRICE_TOLERANCE_POINTS = 0.25;
export const FIXED_REPLAY_MONITOR_CADENCE_MINUTES = GPT_MONITOR_CADENCE_MINUTES;

export const REPLAY_SETUP_STATUSES = Object.freeze([
  "WAIT_NO_SETUP",
  "SETUP_CANDIDATE",
  "PRE_ARMED",
  "ARMED_CONDITIONAL",
  "TRIGGER_GO",
  "TRIGGERED",
  "INVALIDATED",
  "EXPIRED",
  "CANCELLED",
  "WAIT_EVENT_FREEZE",
  "REPLACED",
  "WAIT_MANAGEMENT_ONLY",
  "REPLAN_REQUIRED",
]);

export const REPLAY_CONDITION_IMPORTANCE = Object.freeze([
  "HARD_BLOCKER",
  "MANDATORY",
  "PRIMARY",
  "SECONDARY",
  "OPTIONAL",
  "ADVISORY",
]);

export const REPLAY_ENTRY_MODES = Object.freeze([
  "NEXT_BAR_MARKET_AFTER_CONFIRMATION",
  "RETEST_ZONE_AFTER_CONFIRMATION",
  "STOP_CROSS",
  "LIMIT_TOUCH",
]);

export function normalizeReplaySetupStatus(value) {
  const raw = String(value || "WAIT_NO_SETUP").trim().toUpperCase().replaceAll(" ", "_");
  return SETUP_STATUS_ALIASES.get(raw) || (REPLAY_SETUP_STATUSES.includes(raw) ? raw : "WAIT_NO_SETUP");
}

function isBackendTriggeredReplaySetup(setup = {}) {
  if (!setup) return false;
  if (normalizeReplaySetupStatus(setup.status || setup.lifecycle_status || setup.setup_status) !== "TRIGGERED") return false;
  return setup.status_authority === "backend"
    || setup.trigger_source === "backend_immutable_interval"
    || setup.execution_status === "POSITION_CREATED"
    || Boolean(setup.linked_position_id);
}

export function normalizeReplayConditionImportance(value) {
  const raw = String(value || "").trim().toUpperCase().replaceAll(" ", "_");
  if (raw === "BLOCKER" || raw === "HARD") return "HARD_BLOCKER";
  if (raw === "REQUIRED" || raw === "MUST" || raw === "ESSENTIAL") return "MANDATORY";
  if (raw === "CORE" || raw === "MAIN" || raw === "IMPORTANT" || raw === "MAJOR") return "PRIMARY";
  if (raw === "CONFIRMATION" || raw === "CONFIRM") return "SECONDARY";
  if (raw === "NICE_TO_HAVE" || raw === "BONUS" || raw === "PLUS") return "OPTIONAL";
  if (REPLAY_CONDITION_IMPORTANCE.includes(raw)) return raw;
  return "SECONDARY";
}

export function normalizeReplayConditionStatus(condition = {}) {
  if (typeof condition === "boolean") return condition ? "PASSED" : "FAILED";
  if (condition.passed === true || condition.validated === true || condition.confirmed === true) return "PASSED";
  if (condition.failed === true || condition.invalidated === true || condition.rejected === true) return "FAILED";
  const raw = String(condition.status ?? condition.result ?? condition.state ?? "PENDING").trim().toUpperCase().replaceAll(" ", "_");
  if (PASS_STATUSES.has(raw)) return "PASSED";
  if (FAIL_STATUSES.has(raw)) return "FAILED";
  if (PENDING_STATUSES.has(raw)) return raw === "UNKNOWN" ? "UNKNOWN" : "PENDING";
  return raw || "PENDING";
}

export function extractReplayHealthScore(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") {
    for (const key of ["score", "health_score", "value"]) {
      const parsed = Number(value[key]);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

export function projectReplayActiveThesis(activeThesis, monitors = []) {
  if (!activeThesis) return null;
  const latestMonitor = (monitors || []).find((monitor) => extractReplayHealthScore(monitor?.thesis_health_score) !== null) || null;
  const latestScore = extractReplayHealthScore(latestMonitor?.thesis_health_score);
  if (latestScore === null) return activeThesis;
  return {
    ...activeThesis,
    health_score: latestScore,
    latest_monitor_id: latestMonitor.monitor_id || activeThesis.latest_monitor_id || null,
    latest_monitor_step_id: latestMonitor.step_id || activeThesis.latest_monitor_step_id || null,
    health_score_projection: {
      source: "latest_replay_monitor",
      monitor_id: latestMonitor.monitor_id || null,
      step_id: latestMonitor.step_id || null,
      saved_at_utc: latestMonitor.saved_at_utc || latestMonitor.saved_at || null,
    },
  };
}

export function normalizeReplaySetupCondition(condition = {}, index = 0) {
  const importance = normalizeReplayConditionImportance(
    condition.importance
      ?? condition.priority_class
      ?? condition.requiredness
      ?? (condition.required_for_trigger === true || condition.mandatory === true ? "MANDATORY" : undefined),
  );
  const status = normalizeReplayConditionStatus(condition);
  const isHardBlocker = importance === "HARD_BLOCKER";
  return {
    ...condition,
    condition_id: condition.condition_id || condition.id || `condition_${index + 1}`,
    label: condition.label || condition.name || condition.description || null,
    importance,
    status,
    role: condition.role || (isHardBlocker ? "VETO" : importance === "MANDATORY" ? "ACTIVATION" : "CONFIRMATION"),
    effect: condition.effect || condition.polarity || (isHardBlocker ? "BLOCK_IF_TRUE" : "REQUIRE_TRUE"),
    required_for_trigger: isHardBlocker
      ? false
      : condition.required_for_trigger ?? importance === "MANDATORY",
    weight: Number.isFinite(Number(condition.weight)) ? Number(condition.weight) : defaultConditionWeight(importance),
    evaluation_mode: condition.evaluation_mode || condition.mode || inferConditionEvaluationMode(condition),
    memory_policy: normalizeConditionMemoryPolicy(
      condition.memory_policy || condition.evaluation_persistence,
      { isHardBlocker },
    ),
  };
}

export function normalizeReplaySetupConditions(conditions = []) {
  return (Array.isArray(conditions) ? conditions : [])
    .map((condition, index) => typeof condition === "string"
      ? normalizeReplaySetupCondition({ label: condition, status: "PENDING", importance: "ADVISORY" }, index)
      : normalizeReplaySetupCondition(condition, index));
}

export function canonicalReplaySetupConditionSource(setup = {}) {
  return firstArray(
    setup.conditions,
    setup.trigger_conditions,
    setup.execution_conditions,
    setup.validation_conditions,
    setup.wait_to_go_conditions,
    setup.gates,
    setup.trigger_policy?.conditions,
  );
}

export function evaluateReplaySetupConditions(conditions = [], triggerPolicy = {}) {
  const normalized = normalizeReplaySetupConditions(conditions);
  const hardBlockers = normalized.filter((condition) => condition.importance === "HARD_BLOCKER" && HARD_BLOCKER_STATUSES.has(condition.status));
  const mandatory = normalized.filter((condition) => condition.importance !== "HARD_BLOCKER"
    && (condition.importance === "MANDATORY" || condition.required_for_trigger === true));
  const mandatoryPassed = mandatory.filter((condition) => condition.status === "PASSED");
  const mandatoryFailed = mandatory.filter((condition) => condition.status === "FAILED");
  const scoreable = normalized.filter((condition) => ["MANDATORY", "PRIMARY", "SECONDARY"].includes(condition.importance));
  const totalWeight = scoreable.reduce((sum, condition) => sum + Math.max(0, Number(condition.weight) || 0), 0);
  const passedWeight = scoreable
    .filter((condition) => condition.status === "PASSED")
    .reduce((sum, condition) => sum + Math.max(0, Number(condition.weight) || 0), 0);
  const score = totalWeight > 0 ? Number((passedWeight / totalWeight).toFixed(4)) : 0;
  const minScore = normalizeReplayTriggerScore(triggerPolicy.min_score, DEFAULT_REPLAY_SETUP_MIN_SCORE);
  const entryOnlyTriggerable = normalized.length === 0 && triggerPolicy.allow_entry_only === true;
  const triggerable = hardBlockers.length === 0
    && mandatoryFailed.length === 0
    && mandatoryPassed.length === mandatory.length
    && (entryOnlyTriggerable || score >= minScore);
  return {
    triggerable,
    score,
    min_score: minScore,
    total_conditions: normalized.length,
    passed_conditions: normalized.filter((condition) => condition.status === "PASSED").length,
    pending_conditions: normalized.filter((condition) => condition.status === "PENDING" || condition.status === "UNKNOWN").length,
    failed_conditions: normalized.filter((condition) => condition.status === "FAILED").length,
    hard_blockers_active: hardBlockers.length,
    mandatory_total: mandatory.length,
    mandatory_passed: mandatoryPassed.length,
    mandatory_failed: mandatoryFailed.length,
    reason: hardBlockers.length
      ? "HARD_BLOCKER_ACTIVE"
      : mandatoryFailed.length
        ? "MANDATORY_FAILED"
      : mandatoryPassed.length < mandatory.length
        ? "MANDATORY_PENDING"
        : normalized.length === 0
          ? entryOnlyTriggerable
            ? "ENTRY_ONLY_TRIGGERABLE"
            : "CONDITIONS_REQUIRED"
          : score < minScore
            ? "SCORE_BELOW_MINIMUM"
            : "TRIGGERABLE",
  };
}

export function normalizeReplayTriggerScore(value, fallback = DEFAULT_REPLAY_SETUP_MIN_SCORE) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed >= 0 && parsed <= 1) return parsed;
  if (parsed > 1 && parsed <= 100) return Number((parsed / 100).toFixed(4));
  return fallback;
}

export function normalizeReplayEntryMode(value, setup = {}) {
  const normalized = String(value || "").trim().toUpperCase().replaceAll(" ", "_").replaceAll("-", "_");
  if (REPLAY_ENTRY_MODES.includes(normalized)) return normalized;
  const zone = setup.entry_zone ?? setup.entry_range ?? setup.zone;
  if (zone && typeof zone === "object") return "RETEST_ZONE_AFTER_CONFIRMATION";
  return "LIMIT_TOUCH";
}

export function projectReplaySetupLifecycleAt(setup = {}, {
  asOfParis = null,
  asOfUtc = null,
} = {}) {
  const status = normalizeReplaySetupStatus(
    setup.status || setup.lifecycle_status || setup.setup_status,
  );
  if (TERMINAL_SETUP_STATUS_SET.has(status)) return setup;
  const asOf = asOfParis || asOfUtc;
  const asOfMs = Date.parse(asOf || "");
  const expiresAtMs = replaySetupExpiryMs(setup);
  if (!Number.isFinite(asOfMs) || !Number.isFinite(expiresAtMs) || asOfMs < expiresAtMs) {
    return setup;
  }
  const updatedAtUtc = asOfUtc
    || (asOfParis && Number.isFinite(Date.parse(asOfParis))
      ? new Date(asOfParis).toISOString()
      : setup.updated_at_utc || setup.updated_at);
  return {
    ...setup,
    status: "EXPIRED",
    lifecycle_status: "EXPIRED",
    setup_status: "EXPIRED",
    backend_can_trigger: false,
    trigger_policy: {
      ...(setup.trigger_policy || {}),
      backend_can_trigger: false,
    },
    activation_eligible: false,
    activation_rejected: true,
    activation_rejected_reason: "SETUP_EXPIRED_AT_CUTOFF",
    lifecycle_integrity_status: "SETUP_EXPIRED",
    expired_at_paris: setup.expired_at_paris || asOfParis || null,
    expired_at_utc: setup.expired_at_utc || updatedAtUtc || null,
    updated_at: updatedAtUtc || setup.updated_at,
    updated_at_utc: updatedAtUtc || setup.updated_at_utc,
    updated_at_paris: asOfParis || setup.updated_at_paris,
  };
}

export function selectActiveReplaySetups(setups = [], {
  asOfParis = null,
  asOfUtc = null,
  maxSetups = 5,
} = {}) {
  const activeSetups = (setups || [])
    .map((setup) => projectReplaySetupLifecycleAt(setup, { asOfParis, asOfUtc }))
    .filter((setup) => ACTIVE_SETUP_STATUS_SET.has(normalizeReplaySetupStatus(setup.status || setup.lifecycle_status || setup.setup_status)))
    .sort((left, right) => Number(left.priority || 999) - Number(right.priority || 999)
      || String(right.updated_at_utc || right.updated_at || right.created_at || "").localeCompare(String(left.updated_at_utc || left.updated_at || left.created_at || "")));
  if (maxSetups === null || maxSetups === undefined) return activeSetups;
  return activeSetups.slice(0, Math.max(0, Number(maxSetups) || 0));
}

export function selectOpenReplayPosition(positions = []) {
  return selectOpenPosition(positions);
}

export function isOpenReplayPosition(position = {}) {
  return isOpenPosition(position);
}

export function buildReplayContinuityState({
  run,
  currentStep,
  activeThesis,
  setups = [],
  positions = [],
  monitors = [],
} = {}) {
  const projectedThesis = projectReplayActiveThesis(activeThesis, monitors);
  const asOfParis = run?.current_replay_time || currentStep?.timestamp_paris || null;
  const projectedSetups = (setups || []).map((setup) => projectReplaySetupLifecycleAt(
    setup,
    { asOfParis },
  ));
  const activeSetups = selectActiveReplaySetups(projectedSetups, { asOfParis, maxSetups: 5 });
  const activeSetup = activeSetups[0] || null;
  const armedSetup = activeSetups.find((setup) => normalizeReplaySetupStatus(setup.status || setup.lifecycle_status || setup.setup_status) === "ARMED_CONDITIONAL")
    || activeSetups.find((setup) => normalizeReplaySetupStatus(setup.status || setup.lifecycle_status || setup.setup_status) === "PRE_ARMED")
    || null;
  const position = selectOpenReplayPosition(positions);
  const latestMonitor = (monitors || [])[0] || null;
  return {
    mode: "replay",
    backtest_id: run?.backtest_id || null,
    current_step_id: currentStep?.step_id || run?.current_step_id || null,
    current_replay_time: run?.current_replay_time || currentStep?.timestamp_paris || null,
    thesis_id: projectedThesis?.thesis_id || null,
    thesis_status: projectedThesis?.status || null,
    thesis_health_score: projectedThesis?.health_score ?? null,
    latest_monitor_id: latestMonitor?.monitor_id || null,
    latest_monitor_action: latestMonitor?.monitor_decision?.action || latestMonitor?.monitor_decision?.decision || null,
    setup_status: normalizeReplaySetupStatus(activeSetup?.status || activeSetup?.lifecycle_status || activeSetup?.setup_status),
    active_setup: activeSetup,
    armed_setup: armedSetup,
    active_setups: activeSetups,
    active_setup_count: activeSetups.length,
    terminal_setup_count: projectedSetups.filter((setup) => TERMINAL_SETUP_STATUS_SET.has(normalizeReplaySetupStatus(setup.status || setup.lifecycle_status || setup.setup_status))).length,
    position_status: position?.status || "NO_POSITION",
    active_position: position,
    protected_position: ["PROTECTED", "PARTIAL_TAKEN"].includes(String(position?.status || "").toUpperCase()) ? position : null,
    backend_can_simulate_between_monitors: Boolean(armedSetup || position),
  };
}

export function recommendReplayCadenceMinutes({ run, activeThesis, setups = [], positions = [], monitors = [] } = {}) {
  const continuity = buildReplayContinuityState({ run, activeThesis, setups, positions, monitors });
  const latestAction = String(continuity.latest_monitor_action || "").toUpperCase();
  if (latestAction === "REPLAN_FULL" || continuity.thesis_status === "REPLAN_REQUIRED") {
    return cadenceRecommendation(0, "REPLAN_REQUIRED", "Prepare the replan Master before advancing the clock.");
  }
  if (continuity.position_status === "OPEN" || continuity.position_status === "PENDING") {
    return cadenceRecommendation(FIXED_REPLAY_MONITOR_CADENCE_MINUTES, "ACTIVE_POSITION", "The M1 engine manages the open or pending position continuously; GPT reviews it on M15 or at an explicit critical checkpoint.");
  }
  if (continuity.position_status === "PROTECTED" || continuity.position_status === "PARTIAL_TAKEN") {
    return cadenceRecommendation(FIXED_REPLAY_MONITOR_CADENCE_MINUTES, "PROTECTED_POSITION", "The M1 engine manages the protected position continuously; GPT reviews it on M15 or at an explicit critical checkpoint.");
  }
  if (continuity.setup_status === "ARMED_CONDITIONAL" || continuity.setup_status === "TRIGGER_GO") {
    return cadenceRecommendation(FIXED_REPLAY_MONITOR_CADENCE_MINUTES, "ARMED_SETUP", "The M1 engine evaluates the conditional setup continuously between M15 GPT Monitors.");
  }
  if (continuity.setup_status === "PRE_ARMED" || continuity.setup_status === "SETUP_CANDIDATE") {
    return cadenceRecommendation(FIXED_REPLAY_MONITOR_CADENCE_MINUTES, "SETUP_CANDIDATE", "Candidate setup stays on the scheduled M15 GPT cadence while the M1 engine evaluates its conditions.");
  }
  if (continuity.setup_status === "WAIT_EVENT_FREEZE") {
    return cadenceRecommendation(FIXED_REPLAY_MONITOR_CADENCE_MINUTES, "EVENT_FREEZE", "Event window requires an explicit critical checkpoint or the next M15 GPT Monitor before normal review resumes.");
  }
  return cadenceRecommendation(FIXED_REPLAY_MONITOR_CADENCE_MINUTES, "HYBRID_M15_M1_REPLAY", "New full-day runs use scheduled GPT M15 analysis, explicit critical checkpoints and deterministic M1 surveillance.");
}

export function buildReplayEventCheckpoints({ activeThesis, latestMonitor, run } = {}) {
  const candidates = [
    ...extractCheckpointList(activeThesis?.event_checkpoints, "thesis_event"),
    ...extractCheckpointList(activeThesis?.mandatory_replans, "mandatory_replan"),
    ...extractCheckpointList(activeThesis?.event_windows, "event_window"),
    ...extractCheckpointList(activeThesis?.operational_windows, "operational_window"),
    ...extractCheckpointList(latestMonitor?.next_checkpoints, "monitor_next"),
    ...extractCheckpointList(latestMonitor?.monitor_decision?.next_checkpoints, "monitor_decision_next"),
    ...extractCheckpointList(latestMonitor?.final_sections?.next_checkpoints, "monitor_final_next"),
  ];
  const endMs = Date.parse(run?.end_time || "");
  return candidates
    .filter((checkpoint) => checkpoint.checkpoint_paris)
    .filter((checkpoint) => !Number.isFinite(endMs) || Date.parse(checkpoint.checkpoint_paris) <= endMs)
    .sort((left, right) => Date.parse(left.checkpoint_paris) - Date.parse(right.checkpoint_paris));
}

export function buildReplaySetupDocsFromMonitor({ monitor, run, step, existingSetups = [], tick, makeSetupId }) {
  const rawSetups = extractReplaySetupsFromMonitor(monitor);
  return rawSetups.map((candidate, index) => {
    const raw = normalizeMonitorSetupCandidate(candidate, monitor.monitor_decision || {});
    const explicitSetupId = raw.setup_id || raw.id || null;
    const existing = resolveExistingReplaySetup({
      raw,
      monitor,
      existingSetups,
      index,
      explicitSetupId,
    });
    const setupId = explicitSetupId
      || existing?.setup_id
      || stableMonitorSetupId(raw, monitor, index);
    const createsReplacementRecord = Boolean(raw.replaces_setup_id
      && existing
      && setupId !== existing.setup_id);
    const requestedSetupRecordId = raw.setup_record_id || null;
    const setupRecordId = createsReplacementRecord
      ? makeSetupId?.(setupId) || setupId
      : requestedSetupRecordId || existing?.setup_record_id || makeSetupId(setupId);
    const identityNormalization = createsReplacementRecord
      && requestedSetupRecordId
      && requestedSetupRecordId !== setupRecordId
      ? {
        reason: "REPLACEMENT_RECORD_ID_REBUILT",
        attempted_setup_record_id: requestedSetupRecordId,
        applied_setup_record_id: setupRecordId,
        normalized_at_utc: tick.utc,
      }
      : null;
    const rawConditions = canonicalReplaySetupConditionSource({
      ...existing,
      ...raw,
      trigger_policy: {
        ...(existing?.trigger_policy || {}),
        ...(raw.trigger_policy || {}),
      },
    });
    const conditions = normalizeReplaySetupConditions(rawConditions);
    const rawMinScore = raw.trigger_policy?.min_score
      ?? raw.min_score
      ?? existing?.trigger_policy?.min_score;
    const minScore = normalizeReplayTriggerScore(rawMinScore, DEFAULT_REPLAY_SETUP_MIN_SCORE);
    const executableGeometry = replaySetupHasExecutionGeometry({
      ...existing,
      ...raw,
      instrument: raw.instrument || raw.contract || existing?.instrument || monitor.monitor_decision?.instrument || null,
      direction: raw.direction || existing?.direction || monitor.monitor_decision?.direction,
    });
    const triggerPolicy = {
      ...(existing?.trigger_policy || {}),
      ...(raw.trigger_policy || {}),
      min_score: minScore,
      threshold_tolerance_points: normalizePriceTolerance(raw.trigger_policy?.threshold_tolerance_points ?? raw.threshold_tolerance_points ?? raw.price_tolerance_points),
      allow_entry_only: raw.trigger_policy?.allow_entry_only === true,
      backend_can_trigger: executableGeometry
        && conditions.length > 0
        && (raw.trigger_policy?.backend_can_trigger ?? raw.backend_can_trigger ?? true) !== false,
    };
    const conditionSummary = evaluateReplaySetupConditions(conditions, triggerPolicy);
    const monitorActionStatus = setupStatusFromMonitorAction(
      raw.action || monitor.monitor_decision?.action || monitor.monitor_decision?.decision,
    );
    const requestedStatus = normalizeReplaySetupStatus(
      monitorActionStatus === "ARMED_CONDITIONAL"
        ? monitorActionStatus
        : raw.status ||
          raw.lifecycle_status ||
          raw.setup_status ||
          monitorActionStatus ||
          existing?.status ||
          "SETUP_CANDIDATE",
    );
    const trustedBackendTrigger = isBackendTriggeredReplaySetup(existing);
    const gptClaimedTriggerWithoutBackend = requestedStatus === "TRIGGERED" && !trustedBackendTrigger;
    const statusBeforeActivation = gptClaimedTriggerWithoutBackend
      ? monitorActionStatus === "TRIGGER_GO"
        ? "TRIGGER_GO"
        : executableGeometry && triggerPolicy.backend_can_trigger !== false
          ? "ARMED_CONDITIONAL"
          : "PRE_ARMED"
      : requestedStatus;
    const normalizedStatus = normalizeReplaySetupActivationStatus(statusBeforeActivation, {
      executableGeometry,
      backendCanTrigger: triggerPolicy.backend_can_trigger !== false,
    });
    const existingStatus = normalizeReplaySetupStatus(
      existing?.status || existing?.lifecycle_status || existing?.setup_status,
    );
    const terminalIdentityPreserved = Boolean(
      existing
      && TERMINAL_SETUP_STATUS_SET.has(existingStatus)
      && !createsReplacementRecord,
    );
    const status = terminalIdentityPreserved ? existingStatus : normalizedStatus;
    const backendCanTrigger = status === "ARMED_CONDITIONAL"
      && triggerPolicy.backend_can_trigger !== false;
    const statusNormalization = gptClaimedTriggerWithoutBackend
      ? {
        requested_status: requestedStatus,
        applied_status: status,
        reason: "GPT_TRIGGERED_REQUIRES_BACKEND_POSITION",
        normalized_at_utc: tick.utc,
      }
      : existing?.status_normalization || null;
    return {
      ...(existing || {}),
      ...raw,
      setup_record_id: setupRecordId,
      setup_id: setupId,
      backtest_id: run.backtest_id,
      replay_run_id: run.replay_run_id || run.backtest_id,
      strategy_id: run.strategy_id || null,
      trading_date: run.trading_date || run.date || null,
      resolved_scope: run.resolved_scope || null,
      scope_hash: run.scope_hash || null,
      pack_id: run.pack_id || null,
      pack_build_id: run.pack_build_id || null,
      source_manifest_hash: run.source_manifest_hash || null,
      step_id: step.step_id,
      monitor_id: monitor.monitor_id,
      master_id: monitor.master_id || existing?.master_id || null,
      thesis_id: monitor.thesis_id || existing?.thesis_id || null,
      mode: "replay",
      source: "monitor",
      setup_source: "monitor",
      source_collection: "desk_replay_setups",
      source_monitor_collection: "desk_replay_monitors",
      status,
      lifecycle_status: status,
      setup_status: status,
      requested_status: requestedStatus,
      status_authority: trustedBackendTrigger ? "backend" : "backend_normalized",
      ...(statusNormalization ? { status_normalization: statusNormalization } : {}),
      ...(identityNormalization ? { identity_normalization: identityNormalization } : {}),
      ...(terminalIdentityPreserved ? {
        terminal_identity_preserved: true,
        terminal_identity_preserved_at_utc: tick.utc,
      } : {}),
      instrument: raw.instrument || raw.contract || existing?.instrument || monitor.monitor_decision?.instrument || null,
      direction: normalizeDirection(raw.direction || existing?.direction || monitor.monitor_decision?.direction),
      setup_type: raw.setup_type || existing?.setup_type || "conditional_monitor_setup",
      order_type: normalizeContractOrderTypeV1(raw.order_type || existing?.order_type),
      order_limit_price: numberOrNull(raw.order_limit_price ?? existing?.order_limit_price),
      order_stop_price: numberOrNull(raw.order_stop_price ?? existing?.order_stop_price),
      entry_mode: normalizeReplayEntryMode(raw.entry_mode || existing?.entry_mode, {
        ...existing,
        ...raw,
      }),
      priority: Number(raw.priority || existing?.priority || index + 1),
      conditions,
      trigger_policy: {
        ...triggerPolicy,
        backend_can_trigger: backendCanTrigger,
      },
      condition_summary: conditionSummary,
      condition_score: conditionSummary.score,
      backend_can_trigger: backendCanTrigger,
      execution_geometry_ready: executableGeometry,
      valid_from_paris: raw.valid_from_paris
        || raw.valid_from
        || existing?.valid_from_paris
        || existing?.valid_from
        || step.timestamp_paris,
      expires_at_paris: raw.expires_at_paris || raw.expires_at || raw.valid_until || existing?.expires_at_paris || null,
      created_at: existing?.created_at || tick.utc,
      created_at_utc: existing?.created_at_utc || tick.utc,
      created_at_paris: existing?.created_at_paris || tick.paris,
      updated_at: tick.utc,
      updated_at_utc: tick.utc,
      updated_at_paris: tick.paris,
      anti_lookahead_compliant: true,
    };
  });
}

export function buildReplaySetupMutationDocsFromMonitor(args) {
  const sourceSetups = buildReplaySetupDocsFromMonitor(args);
  const replacedByRecordId = new Map();
  const replacements = sourceSetups.map((replacement) => {
    const replacesSetupId = replacement.replaces_setup_id;
    if (!replacesSetupId) return replacement;
    const replaced = (args.existingSetups || []).find((setup) => (
      setup.setup_id === replacesSetupId || setup.setup_record_id === replacesSetupId
    ));
    if (!replaced) {
      return replacementIntegrityFailure(replacement, "REPLACED_SETUP_NOT_FOUND");
    }
    if (replaced.setup_id === replacement.setup_id
      || replaced.setup_record_id === replacement.setup_record_id) {
      return replacementIntegrityFailure(replacement, "REPLACED_SETUP_EQUALS_REPLACEMENT");
    }
    const replacedRecordId = replaced.setup_record_id
      || (replaced.setup_id && args.makeSetupId ? args.makeSetupId(replaced.setup_id) : null);
    if (!replacedRecordId) {
      return replacementIntegrityFailure(replacement, "REPLACED_SETUP_RECORD_ID_MISSING");
    }
    const normalizedReplaced = { ...replaced, setup_record_id: replacedRecordId };
    const normalizedReplacement = {
      ...replacement,
      replaces_setup_id: replaced.setup_id || replacesSetupId,
      replaces_setup_record_id: replacedRecordId,
      replacement_integrity_status: "SOURCE_FOUND",
    };
    replacedByRecordId.set(replacedRecordId, buildReplacedReplaySetup({
      replaced: normalizedReplaced,
      replacement: normalizedReplacement,
      monitor: args.monitor,
      tick: args.tick,
    }));
    return normalizedReplacement;
  });
  const replacedSetups = [...replacedByRecordId.values()];
  const cutoffParis = args.step?.timestamp_paris || args.tick?.paris || null;
  const cutoffUtc = args.tick?.utc || null;
  const materializedByRecordId = new Map(replacements.map((setup) => [
    setup.setup_record_id || setup.setup_id,
    setup,
  ]));
  const replacedRecordIds = new Set(replacedSetups.map((setup) => setup.setup_record_id || setup.setup_id));
  const existingLifecycleUpdates = (args.existingSetups || [])
    .map((setup) => projectReplaySetupLifecycleAt(setup, {
      asOfParis: cutoffParis,
      asOfUtc: cutoffUtc,
    }))
    .filter((setup, index) => (
      normalizeReplaySetupStatus(setup.status || setup.lifecycle_status || setup.setup_status)
      !== normalizeReplaySetupStatus(
        args.existingSetups[index]?.status
        || args.existingSetups[index]?.lifecycle_status
        || args.existingSetups[index]?.setup_status,
      )
    ));
  const combinedByRecordId = new Map();
  for (const setup of args.existingSetups || []) {
    combinedByRecordId.set(setup.setup_record_id || setup.setup_id, setup);
  }
  for (const setup of existingLifecycleUpdates) {
    combinedByRecordId.set(setup.setup_record_id || setup.setup_id, setup);
  }
  for (const setup of replacedSetups) {
    combinedByRecordId.set(setup.setup_record_id || setup.setup_id, setup);
  }
  for (const setup of replacements) {
    combinedByRecordId.set(setup.setup_record_id || setup.setup_id, setup);
  }
  const activePortfolio = selectActiveReplaySetups([...combinedByRecordId.values()], {
    asOfParis: cutoffParis,
    asOfUtc: cutoffUtc,
    maxSetups: null,
  });
  const overflowRecordIds = new Set(
    activePortfolio
      .slice(5)
      .map((setup) => setup.setup_record_id || setup.setup_id),
  );
  const portfolioClosedSetups = activePortfolio
    .slice(5)
    .map((setup) => closeReplaySetupForPortfolioCap(setup, args.tick));
  for (const setup of portfolioClosedSetups) {
    const recordId = setup.setup_record_id || setup.setup_id;
    if (materializedByRecordId.has(recordId)) {
      materializedByRecordId.set(recordId, setup);
    }
  }
  const materializedSetups = replacements.map((setup) => (
    materializedByRecordId.get(setup.setup_record_id || setup.setup_id) || setup
  ));
  const portfolioExistingClosures = portfolioClosedSetups.filter((setup) => {
    const recordId = setup.setup_record_id || setup.setup_id;
    return !materializedByRecordId.has(recordId) && !replacedRecordIds.has(recordId);
  });
  const allSetups = dedupeReplaySetupWrites([
    ...existingLifecycleUpdates,
    ...replacedSetups,
    ...portfolioExistingClosures,
    ...materializedSetups,
  ]);
  return {
    materializedSetups,
    replacedSetups,
    portfolioClosedSetups,
    activePortfolioCount: activePortfolio.length - overflowRecordIds.size,
    allSetups,
  };
}

function closeReplaySetupForPortfolioCap(setup, tick = {}) {
  return {
    ...setup,
    status: "CANCELLED",
    lifecycle_status: "CANCELLED",
    setup_status: "CANCELLED",
    status_authority: "backend",
    backend_can_trigger: false,
    activation_eligible: false,
    activation_rejected: true,
    activation_rejected_reason: "PORTFOLIO_ACTIVE_SETUP_CAP_EXCEEDED",
    lifecycle_integrity_status: "PORTFOLIO_CAP_ENFORCED",
    portfolio_cap: 5,
    cancelled_at: tick.utc || setup.cancelled_at || null,
    cancelled_at_utc: tick.utc || setup.cancelled_at_utc || null,
    cancelled_at_paris: tick.paris || setup.cancelled_at_paris || null,
    updated_at: tick.utc || setup.updated_at,
    updated_at_utc: tick.utc || setup.updated_at_utc,
    updated_at_paris: tick.paris || setup.updated_at_paris,
    trigger_policy: {
      ...(setup.trigger_policy || {}),
      backend_can_trigger: false,
    },
  };
}

function dedupeReplaySetupWrites(setups = []) {
  return [...new Map(
    setups
      .filter(Boolean)
      .map((setup) => [setup.setup_record_id || setup.setup_id, setup]),
  ).values()];
}

function replacementIntegrityFailure(replacement, reason) {
  const status = normalizeReplaySetupActivationStatus(replacement.status, {
    executableGeometry: replacement.execution_geometry_ready === true,
    backendCanTrigger: false,
  });
  return {
    ...replacement,
    status,
    lifecycle_status: status,
    setup_status: status,
    backend_can_trigger: false,
    activation_eligible: false,
    replacement_integrity_status: reason,
    trigger_policy: {
      ...(replacement.trigger_policy || {}),
      backend_can_trigger: false,
    },
  };
}

function buildReplacedReplaySetup({ replaced, replacement, monitor, tick }) {
  return {
    ...replaced,
    status: "REPLACED",
    lifecycle_status: "REPLACED",
    setup_status: "REPLACED",
    status_authority: "backend",
    backend_can_trigger: false,
    activation_eligible: false,
    replaced_by_setup_id: replacement.setup_id,
    replaced_by_setup_record_id: replacement.setup_record_id,
    replacement_monitor_id: monitor?.monitor_id || replacement.monitor_id || null,
    replaced_at: tick.utc,
    replaced_at_utc: tick.utc,
    replaced_at_paris: tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
    trigger_policy: {
      ...(replaced.trigger_policy || {}),
      backend_can_trigger: false,
    },
  };
}

export function evaluateReplaySetupOnRows(setup, rows = [], { tick, rowsByInstrument } = {}) {
  const status = normalizeReplaySetupStatus(setup?.status || setup?.lifecycle_status || setup?.setup_status);
  if (status !== "ARMED_CONDITIONAL" || setup?.backend_can_trigger === false) {
    return { triggered: false, setup, reason: "SETUP_NOT_BACKEND_TRIGGERABLE" };
  }
  if (!replaySetupHasExecutionGeometry(setup)) {
    return { triggered: false, setup, reason: "EXECUTION_GEOMETRY_INCOMPLETE" };
  }
  if (usesConditionEngineV1(setup)) {
    return evaluateReplaySetupWithConditionEngineV1(setup, rows, { tick, rowsByInstrument });
  }
  const lifecycle = replaySetupLifecycleWindow(setup, rows, tick);
  if (!lifecycle.eligible) {
    return {
      triggered: false,
      status: lifecycle.status,
      setup: {
        ...setup,
        status: lifecycle.status,
        lifecycle_status: lifecycle.status,
        setup_status: lifecycle.status,
        backend_can_trigger: lifecycle.status === "EXPIRED" ? false : setup.backend_can_trigger,
        lifecycle_integrity_status: lifecycle.reason,
        updated_at: tick?.utc || setup.updated_at,
        updated_at_utc: tick?.utc || setup.updated_at_utc,
        updated_at_paris: tick?.paris || setup.updated_at_paris,
      },
      reason: lifecycle.reason,
    };
  }
  const conditions = normalizeReplaySetupConditions(canonicalReplaySetupConditionSource(setup));
  const evaluatedConditions = conditions.map((condition) => evaluateConditionAgainstRows(
    condition,
    replayRowsInsideLifecycle(
      rowsForReplayCondition(condition, lifecycle.rows, rowsByInstrument, setup),
      setup,
    ),
    setup,
  ));
  const hasBackendCondition = evaluatedConditions.some((condition) => condition.backend_evaluable === true);
  const sequence = evaluateConditionSequence(evaluatedConditions, setup.trigger_policy || {});
  const entryRows = entryRowsAfterConditions(lifecycle.rows, evaluatedConditions, setup.trigger_policy || {});
  const entry = evaluateEntryTrigger(setup, entryRows);
  const summary = evaluateReplaySetupConditions(sequence.conditions, setup.trigger_policy || {});
  const triggered = Boolean((hasBackendCondition || entry.evaluable) && summary.triggerable && entry.triggered);
  const invalidated = !triggered && summary.hard_blockers_active > 0;
  const expiresAtMs = replaySetupExpiryMs(setup);
  const tickMs = Date.parse(tick?.paris || tick?.utc || "");
  const expiredAfterEvaluation = !triggered
    && Number.isFinite(expiresAtMs)
    && Number.isFinite(tickMs)
    && tickMs >= expiresAtMs;
  const nextStatus = triggered
    ? "TRIGGERED"
    : invalidated
      ? "INVALIDATED"
      : expiredAfterEvaluation
        ? "EXPIRED"
        : status;
  const invalidatingCondition = invalidated
    ? sequence.conditions.find((condition) => (
      condition.importance === "HARD_BLOCKER"
      && HARD_BLOCKER_STATUSES.has(condition.status)
    ))
    : null;
  return {
    triggered,
    trigger_row: entry.row || firstPassingConditionRow(evaluatedConditions),
    trigger_price: entry.price ?? null,
    status: nextStatus,
    setup: {
      ...setup,
      conditions: sequence.conditions,
      condition_summary: summary,
      condition_score: summary.score,
      status: nextStatus,
      lifecycle_status: nextStatus,
      setup_status: nextStatus,
      backend_can_trigger: nextStatus === "ARMED_CONDITIONAL" && setup.backend_can_trigger !== false,
      status_authority: triggered ? "backend" : setup.status_authority || "backend_normalized",
      trigger_source: triggered ? "backend_immutable_interval" : setup.trigger_source || null,
      execution_status: triggered ? "TRIGGER_CONFIRMED" : setup.execution_status || null,
      triggered_at_paris: triggered ? rowTimestamp(entry.row) || tick?.paris || null : setup.triggered_at_paris || null,
      invalidated_at_paris: invalidated
        ? invalidatingCondition?.observed_at_paris || tick?.paris || null
        : setup.invalidated_at_paris || null,
      invalidation_condition_id: invalidated
        ? invalidatingCondition?.condition_id || null
        : setup.invalidation_condition_id || null,
      updated_at: tick?.utc || setup.updated_at,
      updated_at_utc: tick?.utc || setup.updated_at_utc,
      updated_at_paris: tick?.paris || setup.updated_at_paris,
    },
    reason: triggered
      ? "BACKEND_CONDITIONAL_SETUP_TRIGGERED"
      : invalidated
        ? "HARD_BLOCKER_ACTIVE"
      : expiredAfterEvaluation
        ? "SETUP_EXPIRED_AFTER_INTERVAL_EVALUATION"
      : sequence.valid
        ? summary.reason
        : sequence.reason,
  };
}

function usesConditionEngineV1(setup = {}) {
  return String(setup.condition_engine_version || "") === ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_engine
    || String(setup.execution_policy_version || setup.replay_execution_policy_version || "") === ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy;
}

function evaluateReplaySetupWithConditionEngineV1(setup, rows, { tick, rowsByInstrument } = {}) {
  const status = normalizeReplaySetupStatus(setup.status || setup.lifecycle_status || setup.setup_status);
  const lifecycle = replaySetupLifecycleWindow(setup, rows, tick);
  if (!lifecycle.eligible) {
    return {
      triggered: false,
      status: lifecycle.status,
      setup: {
        ...setup,
        status: lifecycle.status,
        lifecycle_status: lifecycle.status,
        setup_status: lifecycle.status,
        backend_can_trigger: lifecycle.status === "EXPIRED" ? false : setup.backend_can_trigger,
        lifecycle_integrity_status: lifecycle.reason,
        updated_at: tick?.utc || setup.updated_at,
        updated_at_utc: tick?.utc || setup.updated_at_utc,
        updated_at_paris: tick?.paris || setup.updated_at_paris,
      },
      reason: lifecycle.reason,
    };
  }
  const sourceConditions = canonicalReplaySetupConditionSource(setup);
  const timeline = evaluateConditionEngineTimelineV1({
    setup,
    sourceConditions,
    primaryRows: lifecycle.rows,
    rowsByInstrument,
    previousStates: setup.predicate_states || {},
    tick,
  });
  const conditionEvaluation = timeline.conditionEvaluation;
  const opportunity = timeline.opportunity;
  const runtimeGates = timeline.runtimeGates;
  const entry = timeline.entry;
  const triggered = timeline.triggered;
  const terminalInvalidation = timeline.terminalInvalidation;
  const expiresAtMs = replaySetupExpiryMs(setup);
  const tickMs = Date.parse(tick?.paris || tick?.utc || "");
  const expired = !triggered
    && Number.isFinite(expiresAtMs)
    && Number.isFinite(tickMs)
    && tickMs >= expiresAtMs;
  const nextStatus = triggered
    ? "TRIGGERED"
    : terminalInvalidation
      ? "INVALIDATED"
      : expired
        ? "EXPIRED"
        : status;
  const projectedConditions = conditionEvaluation.results.map((result) => ({
    ...(sourceConditions.find((condition) => String(condition.condition_id || condition.id) === result.condition_id) || {}),
    ...result,
    status: result.state === "SATISFIED"
      ? result.effect === "BLOCK_IF_TRUE" ? "FAILED" : "PASSED"
      : ["FAILED", "INVALIDATED", "EXPIRED"].includes(result.state)
        ? "FAILED"
        : result.state === "UNKNOWN"
          ? "UNKNOWN"
          : "PENDING",
    backend_evaluable: true,
  }));
  const predicateStates = Object.fromEntries(
    conditionEvaluation.results.map((result) => [result.condition_id, result]),
  );
  const conditionSummary = {
    engine_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_engine,
    triggerable: opportunity.trigger_eligible,
    score: conditionEvaluation.weighted_confirmation_score,
    min_score: opportunity.weighted_confirmation_threshold,
    total_conditions: conditionEvaluation.results.length,
    passed_conditions: conditionEvaluation.results.filter((result) => result.state === "SATISFIED").length,
    pending_conditions: conditionEvaluation.results.filter((result) => ["NOT_STARTED", "PENDING", "UNKNOWN"].includes(result.state)).length,
    failed_conditions: conditionEvaluation.results.filter((result) => ["FAILED", "INVALIDATED", "EXPIRED"].includes(result.state)).length,
    hard_blockers_active: conditionEvaluation.hard_blockers_active,
    mandatory_total: conditionEvaluation.required_total,
    mandatory_passed: conditionEvaluation.required_satisfied,
    mandatory_failed: conditionEvaluation.required_failed,
    reason: opportunity.trigger_eligible
      ? "TRIGGERABLE"
      : opportunityBlockingReason(opportunity),
  };
  return {
    triggered,
    trigger_row: entry.row || null,
    trigger_price: entry.price ?? null,
    status: nextStatus,
    setup: {
      ...setup,
      conditions: projectedConditions,
      predicate_states: predicateStates,
      deterministic_condition_evaluation: conditionEvaluation,
      opportunity_evaluation: opportunity,
      gates: runtimeGates,
      runtime_gate_reconciliation: buildRuntimeGateReconciliation(
        setup.gates || setup.decision_gates || [],
        runtimeGates,
      ),
      condition_summary: conditionSummary,
      condition_score: conditionEvaluation.weighted_confirmation_score,
      status: nextStatus,
      lifecycle_status: nextStatus,
      setup_status: nextStatus,
      backend_can_trigger: nextStatus === "ARMED_CONDITIONAL" && setup.backend_can_trigger !== false,
      status_authority: triggered ? "backend" : setup.status_authority || "backend_normalized",
      trigger_source: triggered ? "backend_condition_engine_v1" : setup.trigger_source || null,
      execution_status: triggered ? "TRIGGER_CONFIRMED" : setup.execution_status || null,
      triggered_at_paris: triggered ? rowTimestamp(entry.row) || tick?.paris || null : setup.triggered_at_paris || null,
      invalidated_at_paris: terminalInvalidation
        ? terminalInvalidation.observed_at_paris || tick?.paris || null
        : setup.invalidated_at_paris || null,
      invalidation_condition_id: terminalInvalidation?.condition_id || setup.invalidation_condition_id || null,
      updated_at: tick?.utc || setup.updated_at,
      updated_at_utc: tick?.utc || setup.updated_at_utc,
      updated_at_paris: tick?.paris || setup.updated_at_paris,
    },
    reason: triggered
      ? "BACKEND_CONDITION_ENGINE_V1_TRIGGERED"
      : terminalInvalidation
        ? "DETERMINISTIC_VETO_ACTIVE"
        : expired
          ? "SETUP_EXPIRED_AFTER_INTERVAL_EVALUATION"
          : opportunityBlockingReason(opportunity),
  };
}

function opportunityBlockingReason(opportunity = {}) {
  const failure = opportunity.hard_failures?.[0] || null;
  return failure?.evidence?.internal_gate_code
    || failure?.code
    || (opportunity.structural_conditions_ready === false
      ? "REQUIRED_STRUCTURAL_CONDITION_PENDING"
      : opportunity.weighted_known_confirmation_score !== null
        && opportunity.weighted_known_confirmation_score < opportunity.weighted_confirmation_threshold
        ? "WEIGHTED_CONFIRMATION_BELOW_THRESHOLD"
        : "CONDITIONS_PENDING");
}

function evaluateConditionEngineTimelineV1({
  setup,
  sourceConditions,
  primaryRows,
  rowsByInstrument,
  previousStates,
  tick,
}) {
  const orderedRows = [...(primaryRows || [])]
    .sort((left, right) => (
      Date.parse(rowAvailabilityTimestamp(left) || "")
      - Date.parse(rowAvailabilityTimestamp(right) || "")
    ));
  let states = previousStates || {};
  let conditionEvaluation = null;
  let opportunity = null;
  let terminalInvalidation = null;
  let confirmationMs = null;
  let wasTriggerEligible = false;
  let entry = { evaluable: false, triggered: false, row: null, price: null };
  let runtimeGates = setup.gates || setup.decision_gates || [];
  for (const row of orderedRows) {
    const rowTime = rowAvailabilityTimestamp(row);
    const rowMs = Date.parse(rowTime || "");
    const boundedRows = boundedRowsAt(rowsByInstrument, rowMs);
    conditionEvaluation = evaluateDeterministicConditionSetV1({
      conditions: sourceConditions,
      rows: orderedRows.filter((candidate) => (
        Date.parse(rowAvailabilityTimestamp(candidate) || "") <= rowMs
      )),
      rowsByInstrument: boundedRows,
      previousStates: states,
      setup,
      nowParis: rowTime,
    });
    states = Object.fromEntries(
      conditionEvaluation.results.map((result) => [result.condition_id, result]),
    );
    runtimeGates = reconcileRuntimeEntryGates(
      setup.gates || setup.decision_gates || [],
      sourceConditions,
      conditionEvaluation,
    );
    opportunity = evaluateOpportunitySeekingControlledV1({
      setup,
      conditionEvaluation,
      gates: runtimeGates,
      nowParis: rowTime,
    });
    terminalInvalidation = conditionEvaluation.results.find((result) => (
      result.state === "INVALIDATED"
      || (result.effect === "BLOCK_IF_TRUE"
        && result.memory_policy === "INVALIDATE_TERMINAL"
        && result.state === "SATISFIED")
    )) || null;
    if (terminalInvalidation) break;
    const triggerEligible = opportunity.trigger_eligible === true;
    if (!triggerEligible) {
      if (wasTriggerEligible) confirmationMs = null;
      wasTriggerEligible = false;
      continue;
    }
    if (!wasTriggerEligible || confirmationMs === null) {
      confirmationMs = Number.isFinite(Date.parse(conditionEvaluation.confirmation_complete_at_paris || ""))
        ? Date.parse(conditionEvaluation.confirmation_complete_at_paris)
        : rowMs;
      wasTriggerEligible = true;
      continue;
    }
    wasTriggerEligible = true;
    if (!Number.isFinite(confirmationMs) || rowMs <= confirmationMs || !isClosedReplayCandle(row)) continue;
    entry = evaluateEntryTrigger(setup, [row]);
    if (entry.triggered) break;
  }
  if (!conditionEvaluation) {
    conditionEvaluation = evaluateDeterministicConditionSetV1({
      conditions: sourceConditions,
      rows: orderedRows,
      rowsByInstrument,
      previousStates: states,
      setup,
      nowParis: tick?.paris || tick?.utc || null,
    });
    runtimeGates = reconcileRuntimeEntryGates(
      setup.gates || setup.decision_gates || [],
      sourceConditions,
      conditionEvaluation,
    );
    opportunity = evaluateOpportunitySeekingControlledV1({
      setup,
      conditionEvaluation,
      gates: runtimeGates,
      nowParis: tick?.paris || tick?.utc || null,
    });
  }
  return {
    conditionEvaluation,
    opportunity,
    terminalInvalidation,
    entry,
    runtimeGates,
    triggered: Boolean(opportunity?.trigger_eligible && entry.triggered),
  };
}

function reconcileRuntimeEntryGates(gates, sourceConditions, evaluation) {
  const results = evaluation.results || [];
  const eventResults = results.filter((result) => result.predicate_type === "EVENT_BLACKOUT");
  const indicatorResults = results.filter((result) => (
    ["VWAP_RELATION", "RSI_THRESHOLD"].includes(result.predicate_type)
      && (result.required_for_trigger === true
        || result.role === "ACTIVATION"
        || result.importance === "MANDATORY")
  ));
  const blockerResults = results.filter((result) => (
    result.effect === "BLOCK_IF_TRUE"
      || ["VETO", "INVALIDATION"].includes(result.role)
  ));
  const canonicalDataReady = Number(evaluation.required_unknown || 0) === 0
    && Number(evaluation.hard_blockers_unknown || 0) === 0;
  const dynamicStates = new Map([
    ["CANONICAL_TRIGGER_DATA_MISSING", {
      state: canonicalDataReady ? "PASS" : "UNKNOWN",
      reason: canonicalDataReady
        ? "Canonical predicate inputs were evaluated by the M1 lifecycle engine."
        : "At least one required predicate input remains unavailable.",
    }],
    ["DETERMINISTIC_VETO_ACTIVE", {
      state: blockerResults.some((result) => (
        ["SATISFIED", "INVALIDATED"].includes(result.state)
      )) ? "FAIL" : "PASS",
      reason: "Derived from the current deterministic blocker states.",
    }],
    ["MAJOR_EVENT_ENTRY_BLOCK", eventResults.length === 0
      ? {
          state: "NOT_APPLICABLE",
          reason: "No EVENT_BLACKOUT predicate is part of this setup.",
        }
      : eventResults.some((result) => result.state === "UNKNOWN")
        ? {
            state: "UNKNOWN",
            reason: "A required macro event window cannot be evaluated at this cutoff.",
          }
        : eventResults.some((result) => result.state === "SATISFIED")
          ? {
              state: "FAIL",
              reason: "A deterministic EVENT_BLACKOUT window is active.",
            }
          : {
              state: "PASS",
              reason: "The referenced macro event windows were evaluated and are clear.",
            }],
    ["MANDATORY_INDICATOR_MISSING", indicatorResults.length === 0
      ? {
          state: "NOT_APPLICABLE",
          reason: "No mandatory indicator predicate is part of this setup.",
        }
      : indicatorResults.some((result) => result.state === "UNKNOWN")
        ? {
            state: "UNKNOWN",
            reason: "A mandatory indicator predicate has no canonical value.",
          }
        : {
            state: "PASS",
            reason: "Every mandatory indicator predicate has canonical data.",
          }],
  ]);
  return (gates || []).map((gate) => {
    const dynamic = dynamicStates.get(String(gate.code || "").toUpperCase());
    if (!dynamic) return gate;
    return {
      ...gate,
      ...dynamic,
      source: "DETERMINISTIC_ENTRY_RUNTIME",
      reconciled_from_state: gate.state || null,
      reconciled_at_phase: "ENTRY_TRIGGER",
    };
  });
}

function buildRuntimeGateReconciliation(original, reconciled) {
  const originalByCode = new Map((original || []).map((gate) => [gate.code, gate]));
  return (reconciled || [])
    .filter((gate) => gate.source === "DETERMINISTIC_ENTRY_RUNTIME")
    .map((gate) => ({
      code: gate.code,
      original_state: originalByCode.get(gate.code)?.state || null,
      runtime_state: gate.state,
      reason: gate.reason || null,
      phase: "ENTRY_TRIGGER",
    }));
}

function boundedRowsAt(rowsByInstrument, cutoffMs) {
  if (!Number.isFinite(cutoffMs) || !rowsByInstrument) return rowsByInstrument;
  const bounded = (rows) => (Array.isArray(rows) ? rows : [])
    .filter((row) => Date.parse(rowAvailabilityTimestamp(row) || "") <= cutoffMs);
  if (rowsByInstrument instanceof Map) {
    return new Map([...rowsByInstrument.entries()].map(([instrument, rows]) => [instrument, bounded(rows)]));
  }
  return Object.fromEntries(
    Object.entries(rowsByInstrument).map(([instrument, rows]) => [instrument, bounded(rows)]),
  );
}

function rowAvailabilityTimestamp(row = {}) {
  return row.candle_close_utc
    || row.bar_close_utc
    || row.close_timestamp_utc
    || row.closed_at_utc
    || rowTimestamp(row);
}

export function evaluateReplayPositionOnRows(position, rows = [], { tick } = {}) {
  return evaluatePositionOnRows(position, rows, { tick });
}

export function buildReplayPositionFromTriggeredSetup({ setup, run, step, monitor, trigger, tick, makePositionId }) {
  return buildPositionFromTriggeredSetup({ setup, run, step, monitor, trigger, tick, makePositionId });
}

function extractReplaySetupsFromMonitor(monitor = {}) {
  const decision = monitor.monitor_decision || {};
  const candidates = [
    ...firstArray(monitor.setup_transitions),
    ...firstArray(monitor.setup_candidates),
    ...objectList(monitor.setup_transition),
    ...objectList(monitor.setup_candidate),
    ...objectList(monitor.armed_setup),
    ...objectList(monitor.setup_state),
    ...objectList(decision.setup_transition),
    ...objectList(decision.setup_candidate),
    ...objectList(decision.armed_setup),
    ...objectList(decision.setup_state),
    ...objectList(decision.setup),
  ];
  const action = String(decision.action || decision.decision || monitor.action || "").toUpperCase();
  const explicitTrigger = decision.take_trade === true
    && decision.executable !== false
    && !["WAIT", "DO_NOT_TAKE", "NE_PAS_PRENDRE", "NO_ACTION"].includes(action);
  if (decision.setup && typeof decision.setup === "object" && !Array.isArray(decision.setup)) {
    const setupIndex = candidates.indexOf(decision.setup);
    if (setupIndex >= 0) {
      candidates[setupIndex] = {
        ...decision.setup,
        instrument: decision.setup.instrument || decision.instrument,
        direction: decision.setup.direction || decision.direction,
        entry_price: decision.setup.entry_price ?? decision.entry_reference,
        confidence_pct: decision.setup.confidence_pct ?? decision.confidence_pct,
        risk_pct: decision.setup.risk_pct ?? decision.risk_pct,
        status: decision.setup.status || (explicitTrigger ? "ARMED_CONDITIONAL" : setupStatusFromMonitorAction(action)),
        setup_source_action: action,
      };
    }
  }
  if (!candidates.length && SETUP_MATERIALIZING_MONITOR_ACTIONS.has(action)) {
    const synthesized = {
      ...decision,
      status: setupStatusFromMonitorAction(action),
      setup_source_action: action,
    };
    const targetsExistingSetup = Boolean(
      synthesized.setup_id
      || synthesized.setup_record_id
      || synthesized.previous_setup_id
      || synthesized.source_setup_id,
    );
    const cancellation = ["CANCEL_SETUP", "EXPIRE_SETUP"].includes(action);
    if ((cancellation && targetsExistingSetup)
      || (replaySetupHasExecutionGeometry(synthesized)
        && canonicalReplaySetupConditionSource(synthesized).length > 0)) {
      candidates.push(synthesized);
    }
  }
  const filtered = candidates
    .filter((candidate) => candidate && typeof candidate === "object")
    .filter((candidate) => {
      const instrument = String(candidate.instrument || candidate.contract || decision.instrument || "").toUpperCase();
      const direction = normalizeDirection(candidate.direction || decision.direction);
      return instrument !== "WAIT" && direction !== "wait" && (instrument || direction || candidate.setup_id || candidate.status || candidate.setup_status);
    });
  const seen = new Set();
  return filtered.filter((candidate, index) => {
    const key = candidate.setup_record_id || candidate.setup_id || candidate.id || `${candidate.instrument || decision.instrument || "na"}:${candidate.direction || decision.direction || "na"}:${candidate.status || candidate.setup_status || action || index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function setupStatusFromMonitorAction(action) {
  const normalized = String(action || "").trim().toUpperCase().replaceAll(" ", "_");
  if (normalized.startsWith("TRIGGER_")
    || ["PRENDRE", "TAKE", "TAKE_TRADE", "ENTER", "EXECUTE", "GO"].includes(normalized)) {
    return "ARMED_CONDITIONAL";
  }
  if (["ARM_SETUP", "ARMED_CONDITIONAL", "TRIGGER_GO"].includes(normalized)) return "ARMED_CONDITIONAL";
  if (["PRE_ARM", "PRE_ARMED"].includes(normalized)) return "PRE_ARMED";
  if (["SETUP_CANDIDATE", "TRANSFORM_SCENARIO", "THESIS_CONDITIONAL", "CONDITIONAL_THESIS"].includes(normalized)) return "SETUP_CANDIDATE";
  if (["CANCEL_SETUP", "CANCELLED", "CANCELED"].includes(normalized)) return "CANCELLED";
  if (["EXPIRE_SETUP", "EXPIRED"].includes(normalized)) return "EXPIRED";
  return null;
}

function normalizeMonitorSetupCandidate(candidate = {}, decision = {}) {
  const zoneValue = candidate.entry_zone ?? candidate.entry_range ?? candidate.zone;
  const entryZone = Array.isArray(zoneValue) && zoneValue.length >= 2
    ? { low: numberOrNull(zoneValue[0]), high: numberOrNull(zoneValue[1]) }
    : zoneValue;
  const takeProfitValue = candidate.take_profits ?? candidate.targets ?? candidate.take_profit;
  const targets = Array.isArray(takeProfitValue)
    ? takeProfitValue
    : takeProfitValue == null
      ? undefined
      : [takeProfitValue];
  const triggerConditions = candidate.conditions
    ?? candidate.trigger_conditions
    ?? candidate.execution_conditions
    ?? candidate.trigger
    ?? candidate.trigger_policy?.conditions;
  return stripUndefinedFields({
    ...candidate,
    instrument: candidate.instrument || candidate.contract || decision.instrument || null,
    direction: candidate.direction || decision.direction || null,
    ...(entryZone === undefined ? {} : { entry_zone: entryZone }),
    entry_price: candidate.entry_price ?? candidate.entry ?? decision.entry_reference,
    stop_loss: candidate.stop_loss ?? candidate.stop,
    take_profit_1: candidate.take_profit_1 ?? candidate.tp1 ?? targets?.[0],
    ...(targets ? { targets } : {}),
    ...(triggerConditions ? { conditions: triggerConditions } : {}),
    valid_from_paris: candidate.valid_from_paris || candidate.valid_from || null,
    expires_at_paris: candidate.expires_at_paris
      || candidate.expiry_paris
      || candidate.expires_at
      || candidate.valid_until
      || null,
    risk_pct: candidate.risk_pct ?? decision.risk_pct,
    confidence_pct: candidate.confidence_pct ?? decision.confidence_pct,
  });
}

function stripUndefinedFields(value) {
  if (Array.isArray(value)) return value.map(stripUndefinedFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, stripUndefinedFields(item)]),
  );
}

function normalizeReplaySetupActivationStatus(status, { executableGeometry, backendCanTrigger } = {}) {
  const normalized = normalizeReplaySetupStatus(status);
  if (TERMINAL_SETUP_STATUS_SET.has(normalized) || normalized === "WAIT_EVENT_FREEZE" || normalized === "WAIT_MANAGEMENT_ONLY") {
    return normalized;
  }
  if (normalized === "TRIGGER_GO") return executableGeometry && backendCanTrigger ? "ARMED_CONDITIONAL" : "PRE_ARMED";
  if (!executableGeometry && normalized === "ARMED_CONDITIONAL") {
    return "PRE_ARMED";
  }
  if (!backendCanTrigger && normalized === "ARMED_CONDITIONAL") {
    return "PRE_ARMED";
  }
  if (normalized === "WAIT_NO_SETUP" && !executableGeometry) {
    return "SETUP_CANDIDATE";
  }
  return normalized;
}

function findExistingSetup(setups, setupId, setupRecordId) {
  if (!setupId && !setupRecordId) return null;
  return (setups || []).find((setup) => (setupRecordId && setup.setup_record_id === setupRecordId)
    || (setupId && setup.setup_id === setupId)) || null;
}

function resolveExistingReplaySetup({
  raw,
  monitor,
  existingSetups,
  index,
  explicitSetupId,
}) {
  const direct = findExistingSetup(existingSetups, explicitSetupId, raw.setup_record_id);
  if (direct) return direct;

  const references = [
    raw.previous_setup_id,
    raw.parent_setup_id,
    raw.source_setup_id,
    raw.replaces_setup_id,
    raw.linked_setup_id,
  ].filter(Boolean);
  const referenced = (existingSetups || []).find((setup) => references.includes(setup.setup_id)
    || references.includes(setup.setup_record_id));
  if (referenced) return referenced;

  const requestedStatus = normalizeReplaySetupStatus(raw.status || raw.lifecycle_status || raw.setup_status);
  const candidates = (existingSetups || []).filter((setup) => {
    const status = normalizeReplaySetupStatus(setup.status || setup.lifecycle_status || setup.setup_status);
    if (ACTIVE_SETUP_STATUS_SET.has(status)) return true;
    return requestedStatus === "TRIGGERED" && isBackendTriggeredReplaySetup(setup);
  });
  if (TERMINAL_SETUP_STATUS_SET.has(requestedStatus) && candidates.length === 1) {
    return candidates[0];
  }
  const scored = candidates
    .map((setup) => ({ setup, score: replaySetupContinuityScore(raw, monitor, setup, index) }))
    .filter((item) => Number.isFinite(item.score) && item.score >= 4)
    .sort((left, right) => right.score - left.score
      || String(right.setup.updated_at_utc || right.setup.updated_at || "").localeCompare(
        String(left.setup.updated_at_utc || left.setup.updated_at || ""),
      ));
  if (!scored.length) return null;
  if (scored.length > 1 && scored[0].score === scored[1].score) return null;
  return scored[0].setup;
}

function stableMonitorSetupId(raw, monitor, index) {
  const components = [
    raw.thesis_id || monitor.thesis_id || monitor.linked_active_thesis_id || monitor.master_id || monitor.linked_master_analysis_id,
    raw.instrument || raw.contract || monitor.monitor_decision?.instrument,
    normalizeDirection(raw.direction || monitor.monitor_decision?.direction),
    raw.setup_type || "conditional",
  ].filter(Boolean);
  const stable = components
    .join("__")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return stable || `${monitor.monitor_id || "monitor"}_setup_${index + 1}`;
}

function replaySetupContinuityScore(raw, monitor, existing, index) {
  const rawInstrument = String(raw.instrument || raw.contract || monitor.monitor_decision?.instrument || "").toUpperCase();
  const existingInstrument = String(existing.instrument || existing.contract || "").toUpperCase();
  const rawDirection = normalizeDirection(raw.direction || monitor.monitor_decision?.direction);
  const existingDirection = normalizeDirection(existing.direction);
  if (rawInstrument && existingInstrument && rawInstrument !== existingInstrument) return Number.NEGATIVE_INFINITY;
  if (rawDirection && existingDirection && rawDirection !== existingDirection) return Number.NEGATIVE_INFINITY;

  const rawThesis = raw.thesis_id || monitor.thesis_id || null;
  const existingThesis = existing.thesis_id || null;
  if (rawThesis && existingThesis && rawThesis !== existingThesis) return Number.NEGATIVE_INFINITY;

  let score = 0;
  if (rawThesis && existingThesis) score += 5;
  if (rawInstrument && existingInstrument) score += 4;
  if (rawDirection && existingDirection) score += 4;
  if (raw.setup_type && existing.setup_type && raw.setup_type === existing.setup_type) score += 2;
  if (Number(raw.priority || index + 1) === Number(existing.priority || 0)) score += 2;

  const rawEntry = setupEntryTrigger(raw).price;
  const existingEntry = setupEntryTrigger(existing).price;
  if (rawEntry !== null && existingEntry !== null) {
    score += Math.abs(rawEntry - existingEntry) <= 0.5 ? 3 : 0;
  }
  const rawStop = numberOrNull(raw.stop_loss ?? raw.stop);
  const existingStop = numberOrNull(existing.stop_loss ?? existing.stop);
  if (rawStop !== null && existingStop !== null && Math.abs(rawStop - existingStop) <= 0.5) score += 2;
  const rawTarget = setupTakeProfit1(raw);
  const existingTarget = setupTakeProfit1(existing);
  if (rawTarget !== null && existingTarget !== null && Math.abs(rawTarget - existingTarget) <= 0.5) score += 2;
  return score;
}

function firstArray(...values) {
  return values.find((value) => Array.isArray(value) && value.length > 0)
    || values.find((value) => Array.isArray(value))
    || [];
}

function objectList(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return [value];
}

function defaultConditionWeight(importance) {
  switch (importance) {
    case "MANDATORY": return 3;
    case "PRIMARY": return 2;
    case "SECONDARY": return 1;
    case "OPTIONAL": return 0.5;
    case "ADVISORY": return 0.25;
    default: return 0;
  }
}

function normalizeConditionMemoryPolicy(value, { isHardBlocker = false } = {}) {
  const normalized = String(value || "").trim().toUpperCase().replaceAll(" ", "_");
  if (["LATEST_ONLY", "CURRENT_STATE", "RESET_ON_FALSE"].includes(normalized)) return "LATEST_ONLY";
  if (["ONE_SHOT", "INVALIDATE_TERMINAL"].includes(normalized)) return "INVALIDATE_TERMINAL";
  if (["LATCH_UNTIL_EXPIRY", "LATCH_UNTIL_TRIGGER", "LATCH"].includes(normalized)) return "LATCH_UNTIL_TRIGGER";
  return isHardBlocker ? "INVALIDATE_TERMINAL" : "LATCH_UNTIL_TRIGGER";
}

function inferConditionEvaluationMode(condition = {}) {
  return hasConditionPriceRule(condition) ? "backend_interval" : "gpt_monitor";
}

function hasConditionPriceRule(condition = {}) {
  return numberOrNull(condition.threshold ?? condition.level ?? condition.price ?? condition.value) !== null
    && Boolean(condition.operator || condition.comparator || condition.type || condition.kind);
}

function rowsForReplayCondition(condition, fallbackRows, rowsByInstrument, setup = {}) {
  const instrument = String(
    condition.instrument ||
    condition.contract ||
    condition.asset ||
    condition.market ||
    setup.instrument ||
    "",
  ).toUpperCase();
  const setupInstrument = String(setup.instrument || setup.contract || "").toUpperCase();
  if (!instrument || instrument === setupInstrument) {
    if (!rowsByInstrument) return fallbackRows || [];
    if (rowsByInstrument instanceof Map) return rowsByInstrument.get(instrument) || fallbackRows || [];
    return rowsByInstrument[instrument] || rowsByInstrument[instrument.toLowerCase()] || fallbackRows || [];
  }
  if (!rowsByInstrument) return [];
  if (rowsByInstrument instanceof Map) return rowsByInstrument.get(instrument) || [];
  return rowsByInstrument[instrument] || rowsByInstrument[instrument.toLowerCase()] || [];
}

function evaluateConditionAgainstRows(condition, rows, setup = {}) {
  if (!hasConditionPriceRule(condition)) {
    return { ...condition, backend_evaluable: false };
  }
  const threshold = numberOrNull(condition.threshold ?? condition.level ?? condition.price ?? condition.value);
  const operator = String(condition.operator || condition.comparator || condition.type || condition.kind || "").toUpperCase().replaceAll(" ", "_").replaceAll("-", "_");
  const field = condition.field || inferFieldFromOperator(operator);
  const tolerance = conditionTolerancePoints(condition, setup.trigger_policy || {});
  const matched = (rows || []).find((row) => compareConditionRow(row, threshold, operator, field, tolerance, setup));
  const memoryPolicy = normalizeConditionMemoryPolicy(
    condition.memory_policy || condition.evaluation_persistence,
    { isHardBlocker: condition.importance === "HARD_BLOCKER" },
  );
  const latched = condition.status === "PASSED" && memoryPolicy !== "LATEST_ONLY";
  const dataAvailable = Array.isArray(rows) && rows.length > 0;
  return {
    ...condition,
    memory_policy: memoryPolicy,
    status: matched
      ? "PASSED"
      : latched
        ? "PASSED"
        : condition.status === "FAILED"
          ? "FAILED"
          : dataAvailable
            ? "PENDING"
            : "UNKNOWN",
    backend_evaluable: true,
    backend_data_status: dataAvailable ? "AVAILABLE" : "UNAVAILABLE",
    observed_at_paris: matched ? rowTimestamp(matched) : condition.observed_at_paris || null,
    observed_value: matched ? numberOrNull(matched[field]) : condition.observed_value ?? null,
  };
}

function inferFieldFromOperator(operator) {
  if (operator.includes("REJECT")) return "close";
  if (operator.includes("HIGH") || operator.includes("TOUCH_ABOVE") || operator.includes("BREAK_ABOVE")) return "high";
  if (operator.includes("LOW") || operator.includes("TOUCH_BELOW") || operator.includes("BREAK_BELOW")) return "low";
  if (operator.includes("OPEN")) return "open";
  return "close";
}

function compareConditionRow(row, threshold, operator, field, tolerance, setup = {}) {
  const normalized = String(operator || "").toUpperCase();
  if (normalized.includes("REJECT")) {
    return compareRejectionRow(row, threshold, normalized, tolerance, setup);
  }
  return compareConditionValue(numberOrNull(row?.[field]), threshold, normalized, tolerance);
}

function compareRejectionRow(row, threshold, operator, tolerance, setup = {}) {
  if (threshold === null) return false;
  const high = numberOrNull(row.high);
  const low = numberOrNull(row.low);
  const close = numberOrNull(row.close);
  const explicitAbove = operator.includes("ABOVE") || operator.includes("RESISTANCE");
  const explicitBelow = operator.includes("BELOW") || operator.includes("SUPPORT");
  const direction = normalizeDirection(setup.direction);
  const rejectAbove = explicitAbove || (!explicitBelow && direction === "short");
  const rejectBelow = explicitBelow || (!explicitAbove && direction === "long");
  if (rejectAbove) {
    return high !== null && close !== null && high >= threshold - tolerance && close <= threshold + tolerance;
  }
  if (rejectBelow) {
    return low !== null && close !== null && low <= threshold + tolerance && close >= threshold - tolerance;
  }
  return false;
}

function compareConditionValue(value, threshold, operator, tolerance = 0) {
  if (value === null || threshold === null) return false;
  if (operator.includes("BELOW") || operator === "<" || operator === "LT" || operator === "LESS_THAN") return value <= threshold + tolerance;
  if (operator.includes("ABOVE") || operator === ">" || operator === "GT" || operator === "GREATER_THAN") return value >= threshold - tolerance;
  if (operator.includes("LTE") || operator === "<=") return value <= threshold + tolerance;
  if (operator.includes("GTE") || operator === ">=") return value >= threshold - tolerance;
  if (operator.includes("NEAR") || operator.includes("TOUCH") || operator.includes("EQUAL")) return Math.abs(value - threshold) <= tolerance;
  return false;
}

function evaluateEntryTrigger(setup, rows) {
  const entry = setupEntryTrigger(setup);
  const mode = normalizeReplayEntryMode(setup.entry_mode, setup);
  if (mode === "NEXT_BAR_MARKET_AFTER_CONFIRMATION") {
    const row = (rows || []).find((candidate) => (
      numberOrNull(candidate?.open) !== null || numberOrNull(candidate?.close) !== null
    )) || null;
    return {
      evaluable: true,
      triggered: Boolean(row),
      row,
      price: row ? numberOrNull(row.open) ?? numberOrNull(row.close) : null,
      requested_price: entry.price,
      entry_mode: mode,
    };
  }
  if (entry.price === null && entry.from === null && entry.to === null) return { evaluable: false, triggered: true, row: null, price: null };
  const tolerance = conditionTolerancePoints(setup, setup.trigger_policy || {});
  const matched = (rows || []).find((row) => {
    const high = numberOrNull(row.high);
    const low = numberOrNull(row.low);
    if (high === null || low === null) return false;
    if (entry.from !== null && entry.to !== null) {
      return high + tolerance >= entry.from && low - tolerance <= entry.to;
    }
    return low - tolerance <= entry.price && high + tolerance >= entry.price;
  });
  return {
    evaluable: true,
    triggered: Boolean(matched),
    row: matched || null,
    price: matched ? executableEntryPrice(entry.price, matched) : null,
    requested_price: entry.price,
    entry_mode: mode,
  };
}

function executableEntryPrice(requestedPrice, row = {}) {
  const low = numberOrNull(row.low);
  const high = numberOrNull(row.high);
  if (requestedPrice === null || low === null || high === null) return requestedPrice;
  return Math.min(Math.max(requestedPrice, Math.min(low, high)), Math.max(low, high));
}

function replaySetupLifecycleWindow(setup, rows, tick) {
  const validRows = replayRowsInsideLifecycle(rows, setup);
  const now = Date.parse(tick?.paris || tick?.utc || "");
  const validFrom = Date.parse(setup.valid_from_paris || setup.valid_from || "");
  const expiresAt = Date.parse(
    setup.expires_at_paris
      || setup.expiry_paris
      || setup.expires_at
      || setup.valid_until_paris
      || setup.valid_until
      || "",
  );
  if (Number.isFinite(validFrom) && Number.isFinite(now) && now < validFrom) {
    return { eligible: false, status: normalizeReplaySetupStatus(setup.status), reason: "SETUP_NOT_YET_VALID", rows: [] };
  }
  if (!validRows.length && Number.isFinite(expiresAt) && Number.isFinite(now) && now >= expiresAt) {
    return { eligible: false, status: "EXPIRED", reason: "SETUP_EXPIRED", rows: [] };
  }
  return { eligible: true, status: normalizeReplaySetupStatus(setup.status), reason: null, rows: validRows };
}

function replayRowsInsideLifecycle(rows = [], setup = {}) {
  const validFrom = Date.parse(setup.valid_from_paris || setup.valid_from || "");
  const expiresAt = Date.parse(
    setup.expires_at_paris
      || setup.expiry_paris
      || setup.expires_at
      || setup.valid_until_paris
      || setup.valid_until
      || "",
  );
  return (rows || []).filter((row) => {
    const rowMs = Date.parse(rowTimestamp(row) || "");
    if (!Number.isFinite(rowMs)) return false;
    if (Number.isFinite(validFrom) && rowMs < validFrom) return false;
    if (Number.isFinite(expiresAt) && rowMs >= expiresAt) return false;
    return true;
  });
}

function evaluateConditionSequence(conditions, triggerPolicy = {}) {
  if (triggerPolicy.ordered !== true && triggerPolicy.sequence_required !== true) {
    return { valid: true, reason: null, conditions };
  }
  let previousObservedAt = Number.NEGATIVE_INFINITY;
  let valid = true;
  const ordered = conditions
    .map((condition, index) => ({ condition, index }))
    .sort((left, right) => {
      const leftSequence = Number(left.condition.sequence);
      const rightSequence = Number(right.condition.sequence);
      const leftRank = Number.isInteger(leftSequence) && leftSequence > 0 ? leftSequence : left.index + 1;
      const rightRank = Number.isInteger(rightSequence) && rightSequence > 0 ? rightSequence : right.index + 1;
      return leftRank - rightRank || left.index - right.index;
    })
    .map(({ condition }) => condition);
  const sequenced = ordered.map((condition) => {
    if (condition.status !== "PASSED") return condition;
    const observedAt = Date.parse(condition.observed_at_paris || condition.observed_at_utc || "");
    if (!Number.isFinite(observedAt) || observedAt < previousObservedAt) {
      valid = false;
      return {
        ...condition,
        status: "PENDING",
        sequence_violation: true,
        sequence_reason: "CONDITION_ORDER_NOT_OBSERVED",
      };
    }
    previousObservedAt = observedAt;
    return condition;
  });
  return {
    valid,
    reason: valid ? null : "CONDITION_SEQUENCE_NOT_CONFIRMED",
    conditions: sequenced,
  };
}

function entryRowsAfterConditions(rows, conditions, triggerPolicy = {}) {
  if (triggerPolicy.allow_same_bar_entry === true) return rows;
  const mandatoryTimes = (conditions || [])
    .filter((condition) => ["MANDATORY", "PRIMARY", "SECONDARY"].includes(condition.importance))
    .filter((condition) => condition.status === "PASSED")
    .map((condition) => Date.parse(condition.observed_at_paris || condition.observed_at_utc || ""))
    .filter(Number.isFinite);
  if (!mandatoryTimes.length) return rows;
  const after = Math.max(...mandatoryTimes);
  return (rows || []).filter((row) => Date.parse(rowTimestamp(row) || "") > after);
}

function replaySetupHasExecutionGeometry(setup = {}) {
  const instrument = String(setup.instrument || setup.contract || "").toUpperCase();
  const direction = normalizeDirection(setup.direction);
  const entry = setupEntryTrigger(setup);
  const hasShape = Boolean(instrument)
    && instrument !== "WAIT"
    && ["long", "short"].includes(direction)
    && (entry.price !== null || (entry.from !== null && entry.to !== null))
    && numberOrNull(setup.stop_loss ?? setup.stop) !== null
    && setupTakeProfit1(setup) !== null;
  if (!hasShape) return false;
  const stop = numberOrNull(setup.stop_loss ?? setup.stop);
  const target = setupTakeProfit1(setup);
  const risk = direction === "short" ? stop - entry.price : entry.price - stop;
  const reward = direction === "short" ? entry.price - target : target - entry.price;
  if (!(risk > 0) || !(reward > 0)) return false;
  const minimumRr = numberOrNull(
    setup.rr_minimum
    ?? setup.minimum_rr
    ?? setup.min_rr
    ?? setup.rr_min,
  );
  return minimumRr === null || reward / risk + 1e-9 >= minimumRr;
}

function replaySetupExpiryMs(setup = {}) {
  return Date.parse(
    setup.expires_at_paris
      || setup.expiry_paris
      || setup.expires_at
      || setup.valid_until_paris
      || setup.valid_until
      || "",
  );
}

function setupEntryTrigger(setup = {}) {
  const zone = setup.entry_zone && typeof setup.entry_zone === "object" ? setup.entry_zone : null;
  const from = numberOrNull(zone?.lower ?? zone?.from ?? zone?.low ?? zone?.min);
  const to = numberOrNull(zone?.upper ?? zone?.to ?? zone?.high ?? zone?.max);
  const direct = numberOrNull(setup.entry_price ?? setup.entry ?? setup.trigger_price ?? setup.trigger_policy?.entry_price);
  if (direct !== null) return { price: direct, from, to };
  if (from !== null && to !== null) {
    const direction = normalizeDirection(setup.direction);
    const low = Math.min(from, to);
    const high = Math.max(from, to);
    return { price: direction === "short" ? low : high, from: low, to: high };
  }
  return { price: null, from, to };
}

function setupTakeProfit1(setup = {}) {
  const direct = numberOrNull(setup.take_profit_1 ?? setup.tp1 ?? setup.target_1);
  if (direct !== null) return direct;
  const takeProfits = setup.take_profits ?? setup.targets;
  if (Array.isArray(takeProfits)) {
    const first = takeProfits[0];
    return numberOrNull(first?.price ?? first?.level ?? first?.target ?? first);
  }
  if (takeProfits && typeof takeProfits === "object") {
    return numberOrNull(takeProfits.tp1 ?? takeProfits.target_1 ?? takeProfits.first ?? takeProfits.price ?? takeProfits.level);
  }
  return numberOrNull(setup.target ?? setup.take_profit ?? setup.tp);
}

function conditionTolerancePoints(condition = {}, triggerPolicy = {}) {
  if (condition.strict === true || condition.strict_threshold === true || triggerPolicy.strict_thresholds === true) return 0;
  return normalizePriceTolerance(
    condition.tolerance_points ??
    condition.price_tolerance_points ??
    triggerPolicy.threshold_tolerance_points ??
    triggerPolicy.price_tolerance_points,
  );
}

function normalizePriceTolerance(value) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return DEFAULT_REPLAY_PRICE_TOLERANCE_POINTS;
}

function firstPassingConditionRow(conditions) {
  const observed = (conditions || []).find((condition) => condition.observed_at_paris);
  return observed ? { timestamp_paris: observed.observed_at_paris } : null;
}

function rowTimestamp(row = {}) {
  return row.timestamp_paris || row.timestamp_utc || row.timestamp || row.time || null;
}

function isClosedReplayCandle(row = {}) {
  if (row.closed === false || row.is_closed === false) return false;
  return String(row.status || "CLOSED").trim().toUpperCase() !== "OPEN";
}

function normalizeDirection(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["buy", "bull", "bullish", "up", "long"].includes(raw)) return "long";
  if (["sell", "bear", "bearish", "down", "short"].includes(raw)) return "short";
  if (raw === "wait") return "wait";
  return raw || null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cadenceRecommendation(minutes, reason, note) {
  return {
    recommended_minutes: minutes,
    reason,
    note,
    advance_allowed: minutes > 0,
  };
}

function extractCheckpointList(value, source) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.map((item, index) => {
    if (typeof item === "string") return { checkpoint_paris: item, source, priority: index + 1 };
    const checkpoint = item.checkpoint_paris || item.timestamp_paris || item.time_paris || item.at_paris || item.at || item.time || item.replan_at || item.freeze_at || null;
    return {
      ...item,
      checkpoint_paris: checkpoint,
      type: item.type || source,
      source,
      priority: item.priority || index + 1,
      reason: item.reason || item.label || source,
    };
  });
}
