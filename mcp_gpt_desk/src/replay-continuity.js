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

const TERMINAL_SETUP_STATUS_SET = new Set(["TRIGGERED", "INVALIDATED", "EXPIRED", "CANCELLED"]);
const HARD_BLOCKER_STATUSES = new Set(["PASSED", "TRUE", "ACTIVE"]);
const PASS_STATUSES = new Set(["PASSED", "TRUE", "VALIDATED", "CONFIRMED", "OK"]);
const FAIL_STATUSES = new Set(["FAILED", "FALSE", "INVALIDATED", "REJECTED", "NO"]);
const PENDING_STATUSES = new Set(["PENDING", "WAITING", "UNKNOWN", "NOT_OBSERVED", "UNOBSERVED"]);
const OPEN_POSITION_STATUSES = new Set(["OPEN", "PROTECTED", "PARTIAL_TAKEN", "PENDING", "RUNNING"]);
const DEFAULT_REPLAY_SETUP_MIN_SCORE = 0.65;

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

export function normalizeReplaySetupStatus(value) {
  const raw = String(value || "WAIT_NO_SETUP").trim().toUpperCase().replaceAll(" ", "_");
  return SETUP_STATUS_ALIASES.get(raw) || (REPLAY_SETUP_STATUSES.includes(raw) ? raw : "WAIT_NO_SETUP");
}

export function normalizeReplayConditionImportance(value) {
  const raw = String(value || "").trim().toUpperCase().replaceAll(" ", "_");
  if (raw === "BLOCKER" || raw === "HARD") return "HARD_BLOCKER";
  if (raw === "REQUIRED" || raw === "MUST" || raw === "ESSENTIAL") return "MANDATORY";
  if (raw === "CORE" || raw === "MAIN") return "PRIMARY";
  if (raw === "CONFIRMATION" || raw === "CONFIRM") return "SECONDARY";
  if (raw === "NICE_TO_HAVE" || raw === "BONUS") return "OPTIONAL";
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
  return {
    ...condition,
    condition_id: condition.condition_id || condition.id || `condition_${index + 1}`,
    label: condition.label || condition.name || condition.description || null,
    importance,
    status,
    required_for_trigger: condition.required_for_trigger ?? importance === "MANDATORY",
    weight: Number.isFinite(Number(condition.weight)) ? Number(condition.weight) : defaultConditionWeight(importance),
    evaluation_mode: condition.evaluation_mode || condition.mode || inferConditionEvaluationMode(condition),
  };
}

export function normalizeReplaySetupConditions(conditions = []) {
  return (Array.isArray(conditions) ? conditions : [])
    .map((condition, index) => typeof condition === "string"
      ? normalizeReplaySetupCondition({ label: condition, status: "PENDING", importance: "ADVISORY" }, index)
      : normalizeReplaySetupCondition(condition, index));
}

export function evaluateReplaySetupConditions(conditions = [], triggerPolicy = {}) {
  const normalized = normalizeReplaySetupConditions(conditions);
  const hardBlockers = normalized.filter((condition) => condition.importance === "HARD_BLOCKER" && HARD_BLOCKER_STATUSES.has(condition.status));
  const mandatory = normalized.filter((condition) => condition.importance === "MANDATORY" || condition.required_for_trigger === true);
  const mandatoryPassed = mandatory.filter((condition) => condition.status === "PASSED");
  const mandatoryFailed = mandatory.filter((condition) => condition.status === "FAILED");
  const scoreable = normalized.filter((condition) => condition.importance !== "HARD_BLOCKER");
  const totalWeight = scoreable.reduce((sum, condition) => sum + Math.max(0, Number(condition.weight) || 0), 0);
  const passedWeight = scoreable
    .filter((condition) => condition.status === "PASSED")
    .reduce((sum, condition) => sum + Math.max(0, Number(condition.weight) || 0), 0);
  const score = totalWeight > 0 ? Number((passedWeight / totalWeight).toFixed(4)) : 0;
  const minScore = Number.isFinite(Number(triggerPolicy.min_score)) ? Number(triggerPolicy.min_score) : 0.65;
  const triggerable = hardBlockers.length === 0
    && mandatoryFailed.length === 0
    && mandatoryPassed.length === mandatory.length
    && (scoreable.length === 0 || score >= minScore);
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
          : scoreable.length && score < minScore
            ? "SCORE_BELOW_MINIMUM"
            : "TRIGGERABLE",
  };
}

export function selectActiveReplaySetups(setups = []) {
  return (setups || [])
    .filter((setup) => ACTIVE_SETUP_STATUS_SET.has(normalizeReplaySetupStatus(setup.status || setup.lifecycle_status || setup.setup_status)))
    .sort((left, right) => Number(left.priority || 999) - Number(right.priority || 999)
      || String(right.updated_at_utc || right.updated_at || right.created_at || "").localeCompare(String(left.updated_at_utc || left.updated_at || left.created_at || "")));
}

export function selectOpenReplayPosition(positions = []) {
  return (positions || []).find((position) => OPEN_POSITION_STATUSES.has(String(position.status || "").toUpperCase()))
    || (positions || [])[0]
    || null;
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
  const activeSetups = selectActiveReplaySetups(setups);
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
    active_setups: activeSetups.slice(0, 5),
    active_setup_count: activeSetups.length,
    terminal_setup_count: (setups || []).filter((setup) => TERMINAL_SETUP_STATUS_SET.has(normalizeReplaySetupStatus(setup.status || setup.lifecycle_status || setup.setup_status))).length,
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
    return cadenceRecommendation(15, "ACTIVE_POSITION", "Open or pending position requires tighter management checks.");
  }
  if (continuity.position_status === "PROTECTED" || continuity.position_status === "PARTIAL_TAKEN") {
    return cadenceRecommendation(30, "PROTECTED_POSITION", "Protected position can be monitored with a moderate cadence.");
  }
  if (continuity.setup_status === "ARMED_CONDITIONAL" || continuity.setup_status === "TRIGGER_GO") {
    return cadenceRecommendation(15, "ARMED_SETUP", "Conditional setup is live between monitors.");
  }
  if (continuity.setup_status === "PRE_ARMED" || continuity.setup_status === "SETUP_CANDIDATE") {
    return cadenceRecommendation(30, "SETUP_CANDIDATE", "Candidate setup deserves an intermediate replay cadence.");
  }
  if (continuity.setup_status === "WAIT_EVENT_FREEZE") {
    return cadenceRecommendation(15, "EVENT_FREEZE", "Event window requires the next checkpoint before normal cadence resumes.");
  }
  const base = String(run?.monitor_cadence || run?.cadence || "").includes("30") ? 30 : 60;
  return cadenceRecommendation(base, "WAIT_NO_SETUP", "No active setup or position; hourly replay is sufficient.");
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
  return rawSetups.map((raw, index) => {
    const setupId = raw.setup_id || raw.id || `${monitor.monitor_id || step.step_id}_setup_${index + 1}`;
    const existing = findExistingSetup(existingSetups, setupId, raw.setup_record_id);
    const setupRecordId = raw.setup_record_id || existing?.setup_record_id || makeSetupId(setupId);
    const rawConditions = firstArray(
      raw.conditions,
      raw.trigger_conditions,
      raw.execution_conditions,
      raw.validation_conditions,
      raw.wait_to_go_conditions,
      raw.gates,
    );
    const conditions = normalizeReplaySetupConditions(rawConditions);
    const minScore = Number.isFinite(Number(raw.trigger_policy?.min_score))
      ? Number(raw.trigger_policy.min_score)
      : Number.isFinite(Number(raw.min_score))
        ? Number(raw.min_score)
        : Number.isFinite(Number(existing?.trigger_policy?.min_score))
          ? Number(existing.trigger_policy.min_score)
          : DEFAULT_REPLAY_SETUP_MIN_SCORE;
    const triggerPolicy = {
      ...(existing?.trigger_policy || {}),
      ...(raw.trigger_policy || {}),
      min_score: minScore,
      backend_can_trigger: raw.trigger_policy?.backend_can_trigger ?? raw.backend_can_trigger ?? true,
    };
    const conditionSummary = evaluateReplaySetupConditions(conditions, triggerPolicy);
    const status = normalizeReplaySetupStatus(raw.status || raw.lifecycle_status || raw.setup_status || raw.action || existing?.status || "SETUP_CANDIDATE");
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
      instrument: raw.instrument || raw.contract || existing?.instrument || monitor.monitor_decision?.instrument || null,
      direction: normalizeDirection(raw.direction || existing?.direction || monitor.monitor_decision?.direction),
      setup_type: raw.setup_type || existing?.setup_type || "conditional_monitor_setup",
      priority: Number(raw.priority || existing?.priority || index + 1),
      conditions,
      trigger_policy: triggerPolicy,
      condition_summary: conditionSummary,
      condition_score: conditionSummary.score,
      backend_can_trigger: triggerPolicy.backend_can_trigger !== false,
      valid_from_paris: raw.valid_from_paris || raw.valid_from || step.timestamp_paris,
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

export function evaluateReplaySetupOnRows(setup, rows = [], { tick } = {}) {
  const status = normalizeReplaySetupStatus(setup?.status || setup?.lifecycle_status || setup?.setup_status);
  if (!ACTIVE_SETUP_STATUS_SET.has(status) || setup?.backend_can_trigger === false) {
    return { triggered: false, setup, reason: "SETUP_NOT_BACKEND_TRIGGERABLE" };
  }
  const conditions = normalizeReplaySetupConditions(setup.conditions || []);
  const evaluatedConditions = conditions.map((condition) => evaluateConditionAgainstRows(condition, rows));
  const hasBackendCondition = evaluatedConditions.some((condition) => condition.backend_evaluable === true);
  const entry = evaluateEntryTrigger(setup, rows);
  const summary = evaluateReplaySetupConditions(evaluatedConditions, setup.trigger_policy || {});
  const triggered = Boolean((hasBackendCondition || entry.evaluable) && summary.triggerable && entry.triggered);
  const nextStatus = triggered ? "TRIGGERED" : status;
  return {
    triggered,
    trigger_row: entry.row || firstPassingConditionRow(evaluatedConditions),
    trigger_price: entry.price ?? null,
    status: nextStatus,
    setup: {
      ...setup,
      conditions: evaluatedConditions,
      condition_summary: summary,
      condition_score: summary.score,
      status: nextStatus,
      lifecycle_status: nextStatus,
      setup_status: nextStatus,
      triggered_at_paris: triggered ? rowTimestamp(entry.row) || tick?.paris || null : setup.triggered_at_paris || null,
      updated_at: tick?.utc || setup.updated_at,
      updated_at_utc: tick?.utc || setup.updated_at_utc,
      updated_at_paris: tick?.paris || setup.updated_at_paris,
    },
    reason: triggered ? "BACKEND_CONDITIONAL_SETUP_TRIGGERED" : summary.reason,
  };
}

export function evaluateReplayPositionOnRows(position, rows = [], { tick } = {}) {
  if (!position || !rows.length) return { changed: false, position, reason: position ? "NO_ROWS" : "NO_POSITION" };
  const status = String(position.status || "").toUpperCase();
  if (!OPEN_POSITION_STATUSES.has(status)) return { changed: false, position, reason: "POSITION_NOT_OPEN" };
  const direction = normalizeDirection(position.direction);
  const stop = numberOrNull(position.stop_loss ?? position.stop);
  const tp1 = numberOrNull(position.take_profit_1 ?? position.tp1 ?? position.target_1);
  if (direction !== "long" && direction !== "short") return { changed: false, position, reason: "POSITION_DIRECTION_UNKNOWN" };
  for (const row of rows) {
    const high = numberOrNull(row.high);
    const low = numberOrNull(row.low);
    const stopHit = stop !== null && (direction === "long" ? low !== null && low <= stop : high !== null && high >= stop);
    const tpHit = tp1 !== null && (direction === "long" ? high !== null && high >= tp1 : low !== null && low <= tp1);
    if (stopHit || tpHit) {
      const exitReason = stopHit ? "STOP_LOSS_HIT" : "TAKE_PROFIT_1_HIT";
      const exitPrice = stopHit ? stop : tp1;
      const next = {
        ...position,
        status: "CLOSED",
        exit_reason: exitReason,
        exit_price: exitPrice,
        closed_at_paris: rowTimestamp(row) || tick?.paris || null,
        closed_at_utc: row.timestamp_utc || tick?.utc || null,
        updated_at: tick?.utc || position.updated_at,
        updated_at_utc: tick?.utc || position.updated_at_utc,
        updated_at_paris: tick?.paris || position.updated_at_paris,
      };
      return { changed: true, position: next, reason: exitReason, row };
    }
  }
  return { changed: false, position, reason: "UNCHANGED" };
}

export function buildReplayPositionFromTriggeredSetup({ setup, run, step, monitor, trigger, tick, makePositionId }) {
  const direction = normalizeDirection(setup.direction);
  return {
    position_id: makePositionId(setup.setup_id || setup.setup_record_id || step.step_id),
    setup_record_id: setup.setup_record_id || null,
    setup_id: setup.setup_id || null,
    backtest_id: run.backtest_id,
    replay_run_id: run.replay_run_id || run.backtest_id,
    strategy_id: run.strategy_id,
    trading_date: run.trading_date || run.date,
    resolved_scope: run.resolved_scope,
    scope_hash: run.scope_hash,
    pack_id: run.pack_id,
    pack_build_id: run.pack_build_id,
    source_manifest_hash: run.source_manifest_hash,
    step_id: step.step_id,
    monitor_id: monitor?.monitor_id || setup.monitor_id || null,
    mode: "replay",
    status: "OPEN",
    instrument: setup.instrument || null,
    direction,
    entry_price: trigger?.trigger_price ?? numberOrNull(setup.entry_price ?? setup.entry ?? setup.trigger_price),
    stop_loss: numberOrNull(setup.stop_loss ?? setup.stop),
    take_profit_1: numberOrNull(setup.take_profit_1 ?? setup.tp1 ?? setup.target_1),
    opened_at_paris: trigger?.trigger_row ? rowTimestamp(trigger.trigger_row) : tick.paris,
    opened_at_utc: trigger?.trigger_row?.timestamp_utc || tick.utc,
    anti_lookahead_compliant: true,
    created_at: tick.utc,
    created_at_utc: tick.utc,
    created_at_paris: tick.paris,
    updated_at: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  };
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
  ];
  const action = String(decision.action || decision.decision || monitor.action || "").toUpperCase();
  if (!candidates.length && ["SETUP_CANDIDATE", "PRE_ARM", "PRE_ARMED", "ARM_SETUP", "ARMED_CONDITIONAL", "TRIGGER_GO"].includes(action)) {
    candidates.push(decision);
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

function findExistingSetup(setups, setupId, setupRecordId) {
  return (setups || []).find((setup) => setup.setup_record_id === setupRecordId || setup.setup_id === setupId) || null;
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

function inferConditionEvaluationMode(condition = {}) {
  return hasConditionPriceRule(condition) ? "backend_interval" : "gpt_monitor";
}

function hasConditionPriceRule(condition = {}) {
  return numberOrNull(condition.threshold ?? condition.level ?? condition.price ?? condition.value) !== null
    && Boolean(condition.operator || condition.comparator || condition.type || condition.kind);
}

function evaluateConditionAgainstRows(condition, rows) {
  if (!hasConditionPriceRule(condition)) {
    return { ...condition, backend_evaluable: false };
  }
  const threshold = numberOrNull(condition.threshold ?? condition.level ?? condition.price ?? condition.value);
  const operator = String(condition.operator || condition.comparator || condition.type || condition.kind || "").toUpperCase().replaceAll(" ", "_").replaceAll("-", "_");
  const field = condition.field || inferFieldFromOperator(operator);
  const matched = (rows || []).find((row) => compareConditionValue(numberOrNull(row[field]), threshold, operator));
  return {
    ...condition,
    status: matched ? "PASSED" : condition.status === "FAILED" ? "FAILED" : "PENDING",
    backend_evaluable: true,
    observed_at_paris: matched ? rowTimestamp(matched) : condition.observed_at_paris || null,
    observed_value: matched ? numberOrNull(matched[field]) : condition.observed_value ?? null,
  };
}

function inferFieldFromOperator(operator) {
  if (operator.includes("HIGH") || operator.includes("TOUCH_ABOVE") || operator.includes("BREAK_ABOVE")) return "high";
  if (operator.includes("LOW") || operator.includes("TOUCH_BELOW") || operator.includes("BREAK_BELOW")) return "low";
  if (operator.includes("OPEN")) return "open";
  return "close";
}

function compareConditionValue(value, threshold, operator) {
  if (value === null || threshold === null) return false;
  if (operator.includes("BELOW") || operator === "<" || operator === "LT" || operator === "LESS_THAN") return value < threshold;
  if (operator.includes("ABOVE") || operator === ">" || operator === "GT" || operator === "GREATER_THAN") return value > threshold;
  if (operator.includes("LTE") || operator === "<=") return value <= threshold;
  if (operator.includes("GTE") || operator === ">=") return value >= threshold;
  return false;
}

function evaluateEntryTrigger(setup, rows) {
  const entry = numberOrNull(setup.entry_price ?? setup.entry ?? setup.trigger_price ?? setup.trigger_policy?.entry_price);
  if (entry === null) return { evaluable: false, triggered: true, row: null, price: null };
  const matched = (rows || []).find((row) => {
    const high = numberOrNull(row.high);
    const low = numberOrNull(row.low);
    return high !== null && low !== null && low <= entry && high >= entry;
  });
  return { evaluable: true, triggered: Boolean(matched), row: matched || null, price: matched ? entry : null };
}

function firstPassingConditionRow(conditions) {
  const observed = (conditions || []).find((condition) => condition.observed_at_paris);
  return observed ? { timestamp_paris: observed.observed_at_paris } : null;
}

function rowTimestamp(row = {}) {
  return row.timestamp_paris || row.timestamp_utc || row.timestamp || row.time || null;
}

function normalizeDirection(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["buy", "bull", "bullish", "up", "long"].includes(raw)) return "long";
  if (["sell", "bear", "bearish", "down", "short"].includes(raw)) return "short";
  if (raw === "wait") return "wait";
  return raw || null;
}

function numberOrNull(value) {
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
