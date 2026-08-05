export const LEGACY_COMPATIBILITY_ADAPTER_VERSION = "1.0.0";

export const LEGACY_COMPATIBILITY_ENTITY_TYPES = Object.freeze([
  "setup",
  "condition",
  "thesis",
  "position",
  "monitor_decision",
  "unknown",
]);

const CANONICAL_MODEL_VERSIONS = Object.freeze({
  setup: "deterministic_setup_storage_v1",
  condition: "deterministic_execution_condition_v3",
  thesis: "active_thesis_v1",
  position: "position_continuity_v3",
  monitor_decision: "monitor_decision_compat_v1",
  unknown: "unclassified_legacy_v1",
});

const SETUP_STATUS_ALIASES = Object.freeze({
  WAIT: "WAIT_NO_SETUP",
  NO_SETUP: "WAIT_NO_SETUP",
  WAIT_NO_SETUP: "WAIT_NO_SETUP",
  NONE_ACTIVE: "WAIT_NO_SETUP",
  CANDIDATE: "SETUP_CANDIDATE",
  SETUP_CANDIDATE: "SETUP_CANDIDATE",
  PREARMED: "PRE_ARMED",
  PRE_ARM: "PRE_ARMED",
  PRE_ARMED: "PRE_ARMED",
  ARMED: "ARMED_CONDITIONAL",
  ARM_SETUP: "ARMED_CONDITIONAL",
  SETUP_ARMED: "ARMED_CONDITIONAL",
  CONDITIONAL: "ARMED_CONDITIONAL",
  CONDITIONAL_ARMED: "ARMED_CONDITIONAL",
  EXECUTABLE: "ARMED_CONDITIONAL",
  READY: "ARMED_CONDITIONAL",
  ACTIVE: "ARMED_CONDITIONAL",
  ARMED_CONDITIONAL: "ARMED_CONDITIONAL",
  TRIGGER_GO: "ARMED_CONDITIONAL",
  TRIGGERED: "TRIGGERED",
  OPEN: "TRIGGERED",
  INVALID: "INVALIDATED",
  INVALIDATED: "INVALIDATED",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
  CANCELED: "CANCELLED",
  WAIT_EVENT_FREEZE: "WAIT_EVENT_FREEZE",
  MANAGEMENT_ONLY: "WAIT_MANAGEMENT_ONLY",
  WAIT_MANAGEMENT_ONLY: "WAIT_MANAGEMENT_ONLY",
  REPLAN_REQUIRED: "REPLAN_REQUIRED",
});

const THESIS_STATUS_ALIASES = Object.freeze({
  NO_ACTIVE_THESIS: "NO_ACTIVE_THESIS",
  NONE: "NO_ACTIVE_THESIS",
  THESIS_ACTIVE: "THESIS_ACTIVE",
  ACTIVE: "THESIS_ACTIVE",
  THESIS_CONDITIONAL: "THESIS_CONDITIONAL",
  CONDITIONAL: "THESIS_CONDITIONAL",
  WAIT_MONITORED: "WAIT_MONITORED",
  WAIT: "WAIT_MONITORED",
  THESIS_WEAKENED: "THESIS_WEAKENED",
  WEAKENED: "THESIS_WEAKENED",
  THESIS_AT_RISK: "THESIS_AT_RISK",
  AT_RISK: "THESIS_AT_RISK",
  THESIS_INVALIDATED: "THESIS_INVALIDATED",
  INVALIDATED: "THESIS_INVALIDATED",
  SETUP_ARMED: "SETUP_ARMED",
  ARMED: "SETUP_ARMED",
  SETUP_TRIGGERED: "SETUP_TRIGGERED",
  TRIGGERED: "SETUP_TRIGGERED",
  REPLAN_REQUIRED: "REPLAN_REQUIRED",
  EXPIRED: "EXPIRED",
  SETUP_CANDIDATE: "THESIS_CONDITIONAL",
  SCENARIO_TRANSFORMED: "THESIS_CONDITIONAL",
  THESIS_ACTIVE_WAIT: "WAIT_MONITORED",
});

const POSITION_STATUS_ALIASES = Object.freeze({
  ACTIVE: "OPEN",
  OPEN: "OPEN",
  PENDING: "OPEN",
  RUNNING: "OPEN",
  PROTECTED: "PROTECTED",
  POSITION_PROTECTED: "PROTECTED",
  PARTIAL: "PARTIAL_TAKEN",
  PARTIAL_TAKEN: "PARTIAL_TAKEN",
  PARTIALLY_CLOSED: "PARTIAL_TAKEN",
  CLOSED: "CLOSED",
  CLOSE: "CLOSED",
  CANCELLED: "CANCELLED",
  CANCELED: "CANCELLED",
  STOPPED: "STOPPED",
  EXPIRED: "EXPIRED",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  STOP_LOSS_HIT: "CLOSED",
  TAKE_PROFIT_1_HIT: "CLOSED",
  TAKE_PROFIT_HIT: "CLOSED",
});

const CONDITION_IMPORTANCE_ALIASES = Object.freeze({
  HARD_BLOCKER: "HARD_BLOCKER",
  BLOCKER: "HARD_BLOCKER",
  HARD: "HARD_BLOCKER",
  MANDATORY: "MANDATORY",
  REQUIRED: "MANDATORY",
  MUST: "MANDATORY",
  ESSENTIAL: "MANDATORY",
  PRIMARY: "PRIMARY",
  CORE: "PRIMARY",
  MAIN: "PRIMARY",
  IMPORTANT: "PRIMARY",
  MAJOR: "PRIMARY",
  SECONDARY: "SECONDARY",
  CONFIRMATION: "SECONDARY",
  CONFIRM: "SECONDARY",
  OPTIONAL: "OPTIONAL",
  NICE_TO_HAVE: "OPTIONAL",
  BONUS: "OPTIONAL",
  PLUS: "OPTIONAL",
  ADVISORY: "ADVISORY",
});

const CONDITION_STATUS_ALIASES = Object.freeze({
  PASSED: "PASSED",
  PASS: "PASSED",
  TRUE: "PASSED",
  VALIDATED: "PASSED",
  VALIDEE: "PASSED",
  CONFIRMED: "PASSED",
  CONFIRMEE: "PASSED",
  OK: "PASSED",
  ACTIVE: "PASSED",
  DECLENCHEE: "PASSED",
  FAILED: "FAILED",
  FAIL: "FAILED",
  FALSE: "FAILED",
  INVALIDATED: "FAILED",
  REJECTED: "FAILED",
  REJETEE: "FAILED",
  NO: "FAILED",
  ECHOUEE: "FAILED",
  PENDING: "PENDING",
  WAITING: "PENDING",
  UNKNOWN: "UNKNOWN",
  NOT_OBSERVED: "PENDING",
  UNOBSERVED: "PENDING",
  NON_OBSERVEE: "PENDING",
  NOT_CONFIRMED: "PENDING",
  NON_VALIDEE: "PENDING",
  NOT_VALIDATED: "PENDING",
  PARTIALLY_VALIDATED: "PENDING",
  PARTIELLEMENT_VALIDEE: "PENDING",
  VALIDEE_PARTIELLEMENT: "PENDING",
});

const CONDITION_OPERATOR_ALIASES = Object.freeze({
  CLOSE_ABOVE: "CLOSE_ABOVE",
  CLOSE_GT: "CLOSE_ABOVE",
  CLOSE_GREATER_THAN: "CLOSE_ABOVE",
  ABOVE: "CLOSE_ABOVE",
  GREATER_THAN: "CLOSE_ABOVE",
  CLOSE_BELOW: "CLOSE_BELOW",
  CLOSE_LT: "CLOSE_BELOW",
  CLOSE_LESS_THAN: "CLOSE_BELOW",
  BELOW: "CLOSE_BELOW",
  LESS_THAN: "CLOSE_BELOW",
  TOUCH_ABOVE: "TOUCH_ABOVE",
  TOUCH_BELOW: "TOUCH_BELOW",
  REJECT_ABOVE: "REJECT_ABOVE",
  REJECT_BELOW: "REJECT_BELOW",
  REJECT_RESISTANCE: "REJECT_RESISTANCE",
  RESISTANCE_REJECTION: "REJECT_RESISTANCE",
  REJECT_HIGH: "REJECT_RESISTANCE",
  REJECT_SUPPORT: "REJECT_SUPPORT",
  SUPPORT_REJECTION: "REJECT_SUPPORT",
  REJECT_LOW: "REJECT_SUPPORT",
});

const ENTRY_MODE_ALIASES = Object.freeze({
  NEXT_BAR: "NEXT_BAR_MARKET_AFTER_CONFIRMATION",
  NEXT_BAR_MARKET: "NEXT_BAR_MARKET_AFTER_CONFIRMATION",
  NEXT_BAR_MARKET_AFTER_CONFIRMATION: "NEXT_BAR_MARKET_AFTER_CONFIRMATION",
  RETEST: "RETEST_ZONE_AFTER_CONFIRMATION",
  RETEST_ZONE: "RETEST_ZONE_AFTER_CONFIRMATION",
  RETEST_ZONE_AFTER_CONFIRMATION: "RETEST_ZONE_AFTER_CONFIRMATION",
  STOP: "STOP_CROSS",
  STOP_CROSS: "STOP_CROSS",
  LIMIT: "LIMIT_TOUCH",
  LIMIT_TOUCH: "LIMIT_TOUCH",
});

const CONDITION_MEMORY_ALIASES = Object.freeze({
  LATCH: "LATCH_UNTIL_TRIGGER",
  LATCH_UNTIL_EXPIRY: "LATCH_UNTIL_TRIGGER",
  LATCH_UNTIL_TRIGGER: "LATCH_UNTIL_TRIGGER",
  LATEST_ONLY: "LATEST_ONLY",
  CURRENT_STATE: "LATEST_ONLY",
  RESET_ON_FALSE: "LATEST_ONLY",
  ONE_SHOT: "INVALIDATE_TERMINAL",
  INVALIDATE_TERMINAL: "INVALIDATE_TERMINAL",
});

const MONITOR_ACTION_ALIASES = Object.freeze({
  WAIT_MORE: "WAIT_MORE",
  WAIT: "WAIT_MORE",
  NO_ACTION: "WAIT_MORE",
  NO_POSITION_ACTION: "WAIT_MORE",
  MAINTAIN_THESIS: "MAINTAIN_THESIS",
  MAINTAIN_SETUP: "MAINTAIN_THESIS",
  MAINTAIN_PRE_ARMED: "MAINTAIN_THESIS",
  WEAKEN_THESIS: "WEAKEN_THESIS",
  MARK_AT_RISK: "MARK_AT_RISK",
  ARM_SETUP: "ARM_SETUP",
  CREATE_PRE_ARMED: "ARM_SETUP",
  PRE_ARM: "ARM_SETUP",
  PRE_ARMED: "ARM_SETUP",
  TRIGGER_GO: "ARM_SETUP",
  CANCEL_SETUP: "CANCEL_SETUP",
  STOP_SETUP: "CANCEL_SETUP",
  EXPIRE_SETUP: "EXPIRE_SETUP",
  EXPIRE_PRE_ARMED: "EXPIRE_SETUP",
  TRANSFORM_SCENARIO: "TRANSFORM_SCENARIO",
  REPLAN_FULL: "REPLAN_FULL",
  INVALIDATE_THESIS: "INVALIDATE_THESIS",
  EXIT_POSITION: "EXIT_POSITION",
  MOVE_STOP_BE: "MOVE_STOP_BE",
  MOVE_STOP_BREAK_EVEN: "MOVE_STOP_BE",
  TAKE_PARTIAL: "TAKE_PARTIAL",
  REDUCE_RISK: "REDUCE_RISK",
});

const ORCHESTRATION_ACTIONS = new Set([
  "SIMULATE_INTERVAL",
  "WAITING_GPT_MONITOR",
  "WAITING_GPT_MASTER",
  "ADVANCE_5M",
  "ADVANCE_15M",
  "MASTER_MATERIALIZED",
  "START_REPLAY_DAY",
  "PREPARE_NY_MASTER",
  "REPAIR_POSITION_OUTCOME",
  "KEEP_EXPIRED",
  "KEEP_CANCELLED",
]);

export function detectLegacyEntityType(source = {}) {
  if (!isRecord(source)) return "unknown";
  if (source.monitor_decision && isRecord(source.monitor_decision)) return "monitor_decision";
  if (source.condition_id || ((source.operator || source.comparator) && (source.importance || source.required_for_trigger !== undefined))) {
    return "condition";
  }
  if (source.position_id || source.linked_position_id || source.avg_entry_price !== undefined || source.exit_price !== undefined) {
    return "position";
  }
  if (source.thesis_id || source.active_thesis || source.dominant_scenario || source.thesis_status) {
    return "thesis";
  }
  if (source.setup_id || source.setup_record_id || source.entry_zone || source.trigger_conditions || source.stop_loss !== undefined) {
    return "setup";
  }
  if (source.action || source.action_now || source.decision) return "monitor_decision";
  return "unknown";
}

export function adaptLegacyObject(source, options = {}) {
  if (!isRecord(source)) {
    throw new TypeError("legacy_compatibility_source_must_be_an_object");
  }
  const requestedType = options.entityType || options.entity_type || "auto";
  const entityType = requestedType === "auto" ? detectLegacyEntityType(source) : requestedType;
  if (!LEGACY_COMPATIBILITY_ENTITY_TYPES.includes(entityType)) {
    throw new TypeError(`legacy_compatibility_unknown_entity_type:${entityType}`);
  }
  const audit = createAudit(entityType, options);
  const input = cloneValue(source);
  let canonical;
  switch (entityType) {
    case "setup":
      canonical = adaptSetup(input, audit, options);
      break;
    case "condition":
      canonical = adaptCondition(input, audit, options);
      break;
    case "thesis":
      canonical = adaptThesis(input, audit);
      break;
    case "position":
      canonical = adaptPosition(input, audit);
      break;
    case "monitor_decision":
      canonical = adaptMonitorDecisionRecord(input, audit);
      break;
    default:
      canonical = input;
      addConflict(audit, {
        code: "LEGACY_ENTITY_TYPE_UNCLASSIFIED",
        field: null,
        source_values: [],
        resolution: "preserve_source_without_canonical_interpretation",
      });
      break;
  }
  return finalizeResult(canonical, audit);
}

export function adaptLegacySetup(source, options = {}) {
  return adaptLegacyObject(source, { ...options, entityType: "setup" });
}

export function adaptLegacyCondition(source, options = {}) {
  return adaptLegacyObject(source, { ...options, entityType: "condition" });
}

export function adaptLegacyThesis(source, options = {}) {
  return adaptLegacyObject(source, { ...options, entityType: "thesis" });
}

export function adaptLegacyPosition(source, options = {}) {
  return adaptLegacyObject(source, { ...options, entityType: "position" });
}

export function adaptLegacyMonitorDecision(source, options = {}) {
  return adaptLegacyObject(source, { ...options, entityType: "monitor_decision" });
}

function adaptSetup(source, audit, options = {}) {
  const canonical = { ...source };
  const status = resolveMappedAliases({
    source,
    fields: ["status", "lifecycle_status", "setup_status"],
    targetField: "status",
    table: SETUP_STATUS_ALIASES,
    audit,
    fallback: "WAIT_NO_SETUP",
    unknownCode: "UNKNOWN_SETUP_STATUS",
  });
  canonical.status = status;
  canonical.lifecycle_status = status;
  canonical.setup_status = status;

  const direction = resolveDirection(source, audit);
  if (direction !== null) canonical.direction = direction;
  const instrument = resolveTradeInstrument(source, audit);
  if (instrument !== null) canonical.instrument = instrument;

  const zone = normalizeEntryZone(source.entry_zone ?? source.entry_range ?? source.zone, audit);
  if (zone) canonical.entry_zone = zone;
  const entryPrice = firstFinite(source.entry_price, source.entry, source.trigger_price);
  if (entryPrice !== null) canonical.entry_price = entryPrice;
  const stopLoss = firstFinite(source.stop_loss, source.stop);
  if (stopLoss !== null) canonical.stop_loss = stopLoss;
  const takeProfit = firstFinite(
    source.take_profit_1,
    source.tp1,
    source.target_1,
    firstTargetValue(source.targets),
    firstTargetValue(source.take_profits),
  );
  if (takeProfit !== null) canonical.take_profit_1 = takeProfit;

  const conditionSource = firstArrayWithField(source, [
    "conditions",
    "trigger_conditions",
    "execution_conditions",
    "validation_conditions",
    "gates",
  ], audit, "conditions");
  canonical.conditions = (conditionSource || []).map((condition, index) => {
    const childAudit = createAudit("condition", {
      sourceVersion: audit.source_version,
      targetVersion: CANONICAL_MODEL_VERSIONS.condition,
    });
    const normalized = typeof condition === "string"
      ? adaptCondition({ label: condition, status: "PENDING", importance: "ADVISORY" }, childAudit, { index })
      : adaptCondition(condition, childAudit, { index });
    mergeChildAudit(audit, childAudit, `conditions[${index}]`);
    return normalized;
  });

  const triggerPolicy = isRecord(source.trigger_policy) ? { ...source.trigger_policy } : {};
  const minScore = normalizeTriggerScore(triggerPolicy.min_score, audit);
  triggerPolicy.min_score = minScore;
  triggerPolicy.allow_entry_only = false;
  triggerPolicy.allow_same_bar_entry = false;
  const entryMode = normalizeEntryMode(source.entry_mode, Boolean(zone), audit);
  canonical.entry_mode = entryMode;

  const backendProof = hasBackendTriggerProof(source);
  if (status === "TRIGGERED" && !backendProof) {
    canonical.requested_status = "TRIGGERED";
    canonical.status = "PRE_ARMED";
    canonical.lifecycle_status = "PRE_ARMED";
    canonical.setup_status = "PRE_ARMED";
    addConflict(audit, {
      code: "UNPROVEN_TRIGGERED_STATUS",
      field: "status",
      source_values: collectFieldValues(source, ["status", "lifecycle_status", "setup_status"]),
      resolution: "PRE_ARMED",
    });
  }

  const geometryReady = ["long", "short"].includes(canonical.direction)
    && Boolean(canonical.instrument)
    && (Number.isFinite(canonical.entry_price)
      || (Number.isFinite(canonical.entry_zone?.lower) && Number.isFinite(canonical.entry_zone?.upper)))
    && Number.isFinite(canonical.stop_loss)
    && Number.isFinite(canonical.take_profit_1);
  const conditionsReady = canonical.conditions.length > 0;
  if (canonical.status === "ARMED_CONDITIONAL" && (!geometryReady || !conditionsReady)) {
    canonical.status = "PRE_ARMED";
    canonical.lifecycle_status = "PRE_ARMED";
    canonical.setup_status = "PRE_ARMED";
    addConflict(audit, {
      code: "ARMED_SETUP_INCOMPLETE",
      field: "status",
      source_values: [status],
      resolution: "PRE_ARMED",
      evidence: { geometry_ready: geometryReady, conditions_ready: conditionsReady },
    });
  }
  triggerPolicy.backend_can_trigger = canonical.status === "ARMED_CONDITIONAL"
    && geometryReady
    && conditionsReady
    && source.backend_can_trigger !== false
    && !audit.conflicts.some((item) => item.severity === "review");
  canonical.trigger_policy = triggerPolicy;
  canonical.backend_can_trigger = triggerPolicy.backend_can_trigger;
  canonical.execution_geometry_ready = geometryReady;

  if (source.status === "TRIGGER_GO" || token(source.status) === "TRIGGER_GO") {
    canonical.requested_action = "TRIGGER_GO";
    addWarning(audit, {
      code: "GPT_TRIGGER_DEFERRED_TO_BACKEND",
      field: "status",
      detail: "TRIGGER_GO is represented as an armed setup; only backend proof may produce TRIGGERED.",
    });
  }
  return canonical;
}

function adaptCondition(source, audit, options = {}) {
  const canonical = { ...source };
  const index = Number(options.index || 0);
  if (!canonical.condition_id) {
    canonical.condition_id = canonical.id || `legacy_condition_${index + 1}`;
    addWarning(audit, {
      code: "CONDITION_ID_SYNTHESIZED",
      field: "condition_id",
      detail: canonical.condition_id,
    });
  }

  const importanceRaw = source.importance
    ?? source.priority_class
    ?? source.requiredness
    ?? (source.required_for_trigger === true || source.mandatory === true ? "MANDATORY" : "SECONDARY");
  canonical.importance = mapRequiredToken(
    importanceRaw,
    CONDITION_IMPORTANCE_ALIASES,
    "importance",
    "SECONDARY",
    audit,
    "UNKNOWN_CONDITION_IMPORTANCE",
  );
  canonical.status = normalizeConditionStatus(source, audit);

  const operatorRaw = source.operator ?? source.comparator ?? source.type ?? source.kind;
  if (operatorRaw !== undefined && operatorRaw !== null && operatorRaw !== "") {
    canonical.operator = mapRequiredToken(
      operatorRaw,
      CONDITION_OPERATOR_ALIASES,
      "operator",
      null,
      audit,
      "UNKNOWN_CONDITION_OPERATOR",
    );
  }
  const threshold = firstFinite(source.threshold, source.level, source.price, source.value);
  if (threshold !== null) canonical.threshold = threshold;
  if (source.instrument || source.contract || source.asset || source.market) {
    canonical.instrument = String(source.instrument || source.contract || source.asset || source.market).trim().toUpperCase();
  }
  if (source.timeframe) canonical.timeframe = normalizeTimeframe(source.timeframe, audit);

  const hardBlocker = canonical.importance === "HARD_BLOCKER";
  canonical.role = normalizeConditionRole(source.role, hardBlocker, audit);
  canonical.effect = normalizeConditionEffect(source.effect ?? source.polarity, hardBlocker, audit);
  canonical.required_for_trigger = hardBlocker
    ? false
    : source.required_for_trigger ?? source.mandatory ?? canonical.importance === "MANDATORY";
  canonical.memory_policy = normalizeConditionMemory(
    source.memory_policy ?? source.evaluation_persistence,
    hardBlocker,
    audit,
  );
  if (hardBlocker && source.required_for_trigger === true) {
    addWarning(audit, {
      code: "HARD_BLOCKER_REQUIRED_FLAG_REMOVED",
      field: "required_for_trigger",
      detail: "HARD_BLOCKER conditions veto when true and are never required-to-pass.",
    });
  }
  if (hardBlocker && source.effect && token(source.effect) !== "BLOCK_IF_TRUE") {
    addConflict(audit, {
      code: "HARD_BLOCKER_EFFECT_CONFLICT",
      field: "effect",
      source_values: [source.effect],
      resolution: "BLOCK_IF_TRUE",
    });
  }
  return canonical;
}

function adaptThesis(source, audit) {
  const canonical = { ...source };
  const rawStatus = firstPresent(source, ["status", "lifecycle_status", "thesis_status"]);
  let status;
  if (token(rawStatus) === "ACTIVE_WAIT") {
    status = hasConditionalThesisEvidence(source) ? "THESIS_CONDITIONAL" : "WAIT_MONITORED";
    addAlias(audit, "status", rawStatus, status, "contextual_active_wait");
  } else {
    status = resolveMappedAliases({
      source,
      fields: ["status", "lifecycle_status", "thesis_status"],
      targetField: "status",
      table: THESIS_STATUS_ALIASES,
      audit,
      fallback: "NO_ACTIVE_THESIS",
      unknownCode: "UNKNOWN_THESIS_STATUS",
    });
  }
  canonical.status = status;
  const statusToken = token(rawStatus);
  if (["SCENARIO_TRANSFORMED", "SETUP_CANDIDATE"].includes(statusToken)) {
    canonical.legacy_transition_event = statusToken;
    addWarning(audit, {
      code: "LEGACY_EVENT_USED_AS_THESIS_STATE",
      field: "status",
      detail: statusToken,
    });
  }
  const direction = resolveDirection(source, audit);
  if (direction !== null) canonical.direction = direction;
  if (isCompoundBias(source.direction)) {
    canonical.legacy_bias_direction = source.direction;
    addWarning(audit, {
      code: "COMPOUND_BIAS_COMPRESSED_TO_DIRECTION",
      field: "direction",
      detail: `${source.direction} -> ${direction}`,
    });
  }
  const instrument = resolveTradeInstrument(source, audit, { allowWait: true });
  if (instrument !== null) canonical.instrument = instrument;
  const health = firstFinite(source.health_score, source.thesis_health_score?.score, source.thesis_health_score);
  if (health !== null) canonical.health_score = health;
  return canonical;
}

function adaptPosition(source, audit) {
  const canonical = { ...source };
  const status = resolveMappedAliases({
    source,
    fields: ["status", "lifecycle_status", "position_status"],
    targetField: "status",
    table: POSITION_STATUS_ALIASES,
    audit,
    fallback: null,
    unknownCode: "UNKNOWN_POSITION_STATUS",
  });
  canonical.status = status;
  const rawStatus = token(firstPresent(source, ["status", "lifecycle_status", "position_status"]));
  if (["STOP_LOSS_HIT", "TAKE_PROFIT_1_HIT", "TAKE_PROFIT_HIT"].includes(rawStatus)) {
    canonical.exit_reason = source.exit_reason || rawStatus;
    addWarning(audit, {
      code: "POSITION_OUTCOME_USED_AS_STATUS",
      field: "status",
      detail: `${rawStatus} -> CLOSED`,
    });
  }
  if (["PENDING", "RUNNING"].includes(rawStatus)) {
    addConflict(audit, {
      code: "WORKFLOW_STATUS_USED_AS_POSITION_STATUS",
      field: "status",
      source_values: [rawStatus],
      resolution: "OPEN",
    });
  }
  const direction = resolveDirection(source, audit);
  if (direction !== null) canonical.direction = direction;
  const instrument = resolveTradeInstrument(source, audit);
  if (instrument !== null) canonical.instrument = instrument;
  const entry = firstFinite(source.entry_price, source.avg_entry_price, source.entry);
  if (entry !== null) canonical.entry_price = entry;
  const stop = firstFinite(source.stop_loss, source.initial_stop_loss, source.stop);
  if (stop !== null) canonical.stop_loss = stop;
  const target = firstFinite(source.take_profit_1, source.tp1, source.target_1, firstTargetValue(source.targets));
  if (target !== null) canonical.take_profit_1 = target;
  canonical.result_r = resolveNumericAliases(
    source,
    ["result_r", "result_R", "realized_R", "realized_r"],
    "result_r",
    audit,
  );
  if (canonical.result_r === null) delete canonical.result_r;
  return canonical;
}

function adaptMonitorDecisionRecord(source, audit) {
  if (isRecord(source.monitor_decision)) {
    const canonical = { ...source };
    canonical.monitor_decision = adaptMonitorDecisionBody(source.monitor_decision, audit);
    return canonical;
  }
  return adaptMonitorDecisionBody(source, audit);
}

function adaptMonitorDecisionBody(source, audit) {
  const canonical = { ...source };
  const entries = collectFieldEntries(source, ["action", "decision", "action_now"]);
  const interpreted = entries.map((entry) => ({
    ...entry,
    normalized: normalizeMonitorAction(entry.value),
  }));
  const domainValues = interpreted.filter((entry) => entry.normalized.kind === "domain");
  const uniqueDomain = [...new Set(domainValues.map((entry) => entry.normalized.value))];
  if (uniqueDomain.length > 1) {
    addConflict(audit, {
      code: "CONFLICTING_MONITOR_ACTION_FIELDS",
      field: "action",
      source_values: interpreted.map((entry) => `${entry.field}=${entry.value}`),
      resolution: domainValues[0]?.normalized.value || null,
    });
  }
  const chosen = interpreted[0] || null;
  if (!chosen) {
    canonical.action = null;
    addConflict(audit, {
      code: "MONITOR_ACTION_MISSING",
      field: "action",
      source_values: [],
      resolution: null,
    });
    return canonical;
  }
  if (chosen.normalized.kind === "orchestration") {
    canonical.action = null;
    canonical.legacy_orchestration_action = chosen.normalized.value;
    addConflict(audit, {
      code: "ACTION_NAMESPACE_MISMATCH",
      field: chosen.field,
      source_values: [chosen.value],
      resolution: "move_to_orchestration_event",
    });
    return canonical;
  }
  if (chosen.normalized.kind === "unknown") {
    canonical.action = null;
    canonical.operator_instruction = String(chosen.value);
    addConflict(audit, {
      code: "FREE_TEXT_USED_AS_MONITOR_ACTION",
      field: chosen.field,
      source_values: [chosen.value],
      resolution: "preserve_as_operator_instruction",
    });
    return canonical;
  }
  canonical.action = chosen.normalized.value;
  canonical.decision = chosen.normalized.value;
  addAlias(audit, chosen.field, chosen.value, chosen.normalized.value, chosen.normalized.rule);
  const rawToken = token(chosen.value);
  if (rawToken === "TRIGGER_GO") {
    canonical.requested_action = "TRIGGER_GO";
    addWarning(audit, {
      code: "TRIGGER_GO_NORMALIZED_TO_ARM_SETUP",
      field: chosen.field,
      detail: "Only the deterministic backend may create a triggered position.",
    });
  }
  if (["CREATE_PRE_ARMED", "PRE_ARM", "PRE_ARMED", "MAINTAIN_PRE_ARMED"].includes(rawToken)) {
    canonical.requested_setup_status = "PRE_ARMED";
  }
  return canonical;
}

function normalizeMonitorAction(value) {
  const normalized = token(value);
  if (MONITOR_ACTION_ALIASES[normalized]) {
    return {
      kind: "domain",
      value: MONITOR_ACTION_ALIASES[normalized],
      rule: normalized === MONITOR_ACTION_ALIASES[normalized] ? "canonical" : "monitor_action_alias",
    };
  }
  if (ORCHESTRATION_ACTIONS.has(normalized)) {
    return { kind: "orchestration", value: normalized, rule: "orchestration_namespace" };
  }
  return { kind: "unknown", value: null, rule: "unmapped" };
}

function normalizeConditionStatus(source, audit) {
  if (source.passed === true || source.validated === true || source.confirmed === true) return "PASSED";
  if (source.failed === true || source.invalidated === true || source.rejected === true) return "FAILED";
  return mapRequiredToken(
    source.status ?? source.result ?? source.state ?? "PENDING",
    CONDITION_STATUS_ALIASES,
    "status",
    "PENDING",
    audit,
    "UNKNOWN_CONDITION_STATUS",
  );
}

function normalizeConditionRole(value, hardBlocker, audit) {
  const fallback = hardBlocker ? "VETO" : "CONFIRMATION";
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = token(value);
  if (["ACTIVATION", "CONFIRMATION", "INVALIDATION", "VETO"].includes(normalized)) {
    if (hardBlocker && normalized !== "VETO" && normalized !== "INVALIDATION") {
      addConflict(audit, {
        code: "HARD_BLOCKER_ROLE_CONFLICT",
        field: "role",
        source_values: [value],
        resolution: "VETO",
      });
      return "VETO";
    }
    return hardBlocker && normalized === "INVALIDATION" ? "VETO" : normalized;
  }
  addWarning(audit, {
    code: "FREE_TEXT_CONDITION_ROLE_REPLACED",
    field: "role",
    detail: `${value} -> ${fallback}`,
  });
  return fallback;
}

function normalizeConditionEffect(value, hardBlocker, audit) {
  const fallback = hardBlocker ? "BLOCK_IF_TRUE" : "REQUIRE_TRUE";
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = token(value);
  if (["REQUIRE_TRUE", "BLOCK_IF_TRUE"].includes(normalized)) {
    if (hardBlocker && normalized !== "BLOCK_IF_TRUE") return "BLOCK_IF_TRUE";
    return normalized;
  }
  addWarning(audit, {
    code: "UNKNOWN_CONDITION_EFFECT_REPLACED",
    field: "effect",
    detail: `${value} -> ${fallback}`,
  });
  return fallback;
}

function normalizeConditionMemory(value, hardBlocker, audit) {
  const fallback = hardBlocker ? "INVALIDATE_TERMINAL" : "LATCH_UNTIL_TRIGGER";
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = token(value);
  if (CONDITION_MEMORY_ALIASES[normalized]) {
    const result = CONDITION_MEMORY_ALIASES[normalized];
    addAlias(audit, "memory_policy", value, result, "condition_memory_alias");
    return result;
  }
  addWarning(audit, {
    code: "UNKNOWN_CONDITION_MEMORY_REPLACED",
    field: "memory_policy",
    detail: `${value} -> ${fallback}`,
  });
  return fallback;
}

function normalizeEntryMode(value, hasZone, audit) {
  if (value !== undefined && value !== null && value !== "") {
    const normalized = token(value);
    if (ENTRY_MODE_ALIASES[normalized]) {
      const result = ENTRY_MODE_ALIASES[normalized];
      addAlias(audit, "entry_mode", value, result, "entry_mode_alias");
      return result;
    }
    addWarning(audit, {
      code: "UNKNOWN_ENTRY_MODE_REPLACED",
      field: "entry_mode",
      detail: `${value} -> ${hasZone ? "RETEST_ZONE_AFTER_CONFIRMATION" : "LIMIT_TOUCH"}`,
    });
  }
  return hasZone ? "RETEST_ZONE_AFTER_CONFIRMATION" : "LIMIT_TOUCH";
}

function normalizeTriggerScore(value, audit) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    if (value !== undefined && value !== null && value !== "") {
      addConflict(audit, {
        code: "INVALID_TRIGGER_SCORE",
        field: "trigger_policy.min_score",
        source_values: [value],
        resolution: 0.65,
      });
    }
    return 0.65;
  }
  if (parsed >= 0 && parsed <= 1) return parsed;
  if (parsed > 1 && parsed <= 100) {
    const normalized = Number((parsed / 100).toFixed(4));
    addAlias(audit, "trigger_policy.min_score", parsed, normalized, "percentage_to_ratio");
    return normalized;
  }
  addConflict(audit, {
    code: "TRIGGER_SCORE_OUT_OF_RANGE",
    field: "trigger_policy.min_score",
    source_values: [value],
    resolution: 0.65,
  });
  return 0.65;
}

function normalizeEntryZone(value, audit) {
  if (value === undefined || value === null) return null;
  let left;
  let right;
  if (Array.isArray(value)) {
    [left, right] = value;
  } else if (isRecord(value)) {
    left = value.lower ?? value.from ?? value.low ?? value.min;
    right = value.upper ?? value.to ?? value.high ?? value.max;
  } else {
    addConflict(audit, {
      code: "INVALID_ENTRY_ZONE",
      field: "entry_zone",
      source_values: [value],
      resolution: null,
    });
    return null;
  }
  const first = finiteNumber(left);
  const second = finiteNumber(right);
  if (first === null || second === null) {
    addConflict(audit, {
      code: "INCOMPLETE_ENTRY_ZONE",
      field: "entry_zone",
      source_values: [value],
      resolution: null,
    });
    return null;
  }
  const lower = Math.min(first, second);
  const upper = Math.max(first, second);
  if (first !== lower) {
    addWarning(audit, {
      code: "ENTRY_ZONE_BOUNDS_REORDERED",
      field: "entry_zone",
      detail: `${first},${second} -> ${lower},${upper}`,
    });
  }
  addAlias(audit, "entry_zone", value, { lower, upper }, "entry_zone_shape");
  return { lower, upper };
}

function resolveDirection(source, audit) {
  const entries = collectFieldEntries(source, ["direction", "side", "bias_direction"]);
  if (!entries.length) return null;
  const mapped = entries.map((entry) => ({ ...entry, canonical: mapDirection(entry.value) }));
  const valid = mapped.filter((entry) => entry.canonical !== null);
  const unique = [...new Set(valid.map((entry) => entry.canonical))];
  if (unique.length > 1) {
    addConflict(audit, {
      code: "CONFLICTING_DIRECTION_FIELDS",
      field: "direction",
      source_values: entries.map((entry) => `${entry.field}=${entry.value}`),
      resolution: valid[0]?.canonical || null,
    });
  }
  if (!valid.length) {
    addConflict(audit, {
      code: "UNKNOWN_DIRECTION",
      field: "direction",
      source_values: entries.map((entry) => entry.value),
      resolution: null,
    });
    return null;
  }
  addAlias(audit, valid[0].field, valid[0].value, valid[0].canonical, "direction_alias");
  return valid[0].canonical;
}

function mapDirection(value) {
  const normalized = token(value);
  if (["LONG", "BUY", "BULL", "BULLISH", "UP", "HAUSSIER", "HAUSSIER_CONDITIONNEL"].includes(normalized)) return "long";
  if (["SHORT", "SELL", "BEAR", "BEARISH", "DOWN", "BAISSIER", "BAISSIER_CONDITIONNEL"].includes(normalized)) return "short";
  if (["NEUTRAL", "NEUTRE", "NEUTRAL_BULLISH_WAIT", "NEUTRAL_CONDITIONAL"].includes(normalized)) return "neutral";
  if (["WAIT", "ATTENDRE"].includes(normalized)) return "wait";
  return null;
}

function resolveTradeInstrument(source, audit, { allowWait = false } = {}) {
  const entries = collectFieldEntries(source, ["instrument", "contract", "symbol"]);
  if (!entries.length) return null;
  const mapped = entries.map((entry) => ({ ...entry, canonical: mapTradeInstrument(entry.value, allowWait) }));
  const valid = mapped.filter((entry) => entry.canonical !== null);
  const unique = [...new Set(valid.map((entry) => entry.canonical))];
  if (unique.length > 1) {
    addConflict(audit, {
      code: "CONFLICTING_INSTRUMENT_FIELDS",
      field: "instrument",
      source_values: entries.map((entry) => `${entry.field}=${entry.value}`),
      resolution: valid[0]?.canonical || null,
    });
  }
  if (!valid.length) {
    addConflict(audit, {
      code: "UNKNOWN_TRADE_INSTRUMENT",
      field: "instrument",
      source_values: entries.map((entry) => entry.value),
      resolution: null,
    });
    return null;
  }
  addAlias(audit, valid[0].field, valid[0].value, valid[0].canonical, "instrument_root_alias");
  return valid[0].canonical;
}

function mapTradeInstrument(value, allowWait) {
  const normalized = String(value || "").trim().toUpperCase();
  if (allowWait && normalized === "WAIT") return "WAIT";
  const match = normalized.match(/^(MNQ|MES|NQ|ES)(?:1!|[ _-].*)?$/);
  return match ? match[1] : null;
}

function resolveMappedAliases({
  source,
  fields,
  targetField,
  table,
  audit,
  fallback,
  unknownCode,
}) {
  const entries = collectFieldEntries(source, fields);
  if (!entries.length) return fallback;
  const mapped = entries.map((entry) => ({
    ...entry,
    canonical: table[token(entry.value)] || null,
  }));
  const valid = mapped.filter((entry) => entry.canonical !== null);
  for (const item of mapped.filter((entry) => entry.canonical === null)) {
    addConflict(audit, {
      code: unknownCode,
      field: item.field,
      source_values: [item.value],
      resolution: fallback,
    });
  }
  const unique = [...new Set(valid.map((entry) => entry.canonical))];
  if (unique.length > 1) {
    addConflict(audit, {
      code: `CONFLICTING_${targetField.toUpperCase()}_FIELDS`,
      field: targetField,
      source_values: entries.map((entry) => `${entry.field}=${entry.value}`),
      resolution: valid[0]?.canonical ?? fallback,
    });
  }
  if (!valid.length) return fallback;
  addAlias(audit, valid[0].field, valid[0].value, valid[0].canonical, `${targetField}_alias`);
  return valid[0].canonical;
}

function resolveNumericAliases(source, fields, targetField, audit) {
  const entries = collectFieldEntries(source, fields)
    .map((entry) => ({ ...entry, canonical: finiteNumber(entry.value) }))
    .filter((entry) => entry.canonical !== null);
  if (!entries.length) return null;
  const unique = [...new Set(entries.map((entry) => entry.canonical))];
  if (unique.length > 1) {
    addConflict(audit, {
      code: `CONFLICTING_${targetField.toUpperCase()}_FIELDS`,
      field: targetField,
      source_values: entries.map((entry) => `${entry.field}=${entry.value}`),
      resolution: entries[0].canonical,
    });
  }
  addAlias(audit, entries[0].field, entries[0].value, entries[0].canonical, "numeric_field_alias");
  return entries[0].canonical;
}

function mapRequiredToken(value, table, field, fallback, audit, unknownCode) {
  const normalized = token(value);
  const mapped = table[normalized];
  if (mapped !== undefined) {
    addAlias(audit, field, value, mapped, `${field}_alias`);
    return mapped;
  }
  addConflict(audit, {
    code: unknownCode,
    field,
    source_values: [value],
    resolution: fallback,
  });
  return fallback;
}

function normalizeTimeframe(value, audit) {
  const normalized = token(value);
  const aliases = {
    "1": "M1",
    M1: "M1",
    "1M": "M1",
    "5": "M5",
    M5: "M5",
    "5M": "M5",
    "15": "M15",
    M15: "M15",
    "15M": "M15",
    "60": "H1",
    H1: "H1",
    "1H": "H1",
    H4: "H4",
    "4H": "H4",
  };
  if (aliases[normalized]) {
    addAlias(audit, "timeframe", value, aliases[normalized], "timeframe_alias");
    return aliases[normalized];
  }
  addConflict(audit, {
    code: "UNKNOWN_CONDITION_TIMEFRAME",
    field: "timeframe",
    source_values: [value],
    resolution: null,
  });
  return null;
}

function firstArrayWithField(source, fields, audit, targetField) {
  const populated = fields
    .filter((field) => Array.isArray(source[field]) && source[field].length > 0)
    .map((field) => ({ field, value: source[field] }));
  if (populated.length > 1) {
    addConflict(audit, {
      code: `MULTIPLE_${targetField.toUpperCase()}_SOURCES`,
      field: targetField,
      source_values: populated.map((entry) => entry.field),
      resolution: populated[0].field,
      severity: "warning",
    });
  }
  if (populated[0] && populated[0].field !== targetField) {
    addAlias(audit, populated[0].field, populated[0].field, targetField, "field_alias");
  }
  return populated[0]?.value || [];
}

function hasConditionalThesisEvidence(source) {
  return Array.isArray(source.wait_to_go_conditions) && source.wait_to_go_conditions.length > 0
    || String(source.direction || "").toUpperCase().includes("CONDITIONAL")
    || Boolean(source.linked_setup_id || source.setup_id);
}

function isCompoundBias(value) {
  const normalized = token(value);
  return normalized.includes("CONDITIONAL") || normalized.includes("WAIT") || normalized.includes("CONDITIONNEL");
}

function hasBackendTriggerProof(source) {
  return source.status_authority === "backend"
    || source.trigger_source === "backend_immutable_interval"
    || source.execution_status === "POSITION_CREATED"
    || Boolean(source.linked_position_id);
}

function createAudit(entityType, options = {}) {
  return {
    adapter: "legacy_compatibility_adapter",
    adapter_version: LEGACY_COMPATIBILITY_ADAPTER_VERSION,
    entity_type: entityType,
    source_version: options.sourceVersion || options.source_version || "legacy_unversioned",
    target_model_version: options.targetVersion
      || options.target_version
      || CANONICAL_MODEL_VERSIONS[entityType],
    aliases: [],
    conflicts: [],
    warnings: [],
  };
}

function finalizeResult(canonical, audit) {
  const reviewConflicts = audit.conflicts.filter((item) => item.severity === "review");
  const finalizedAudit = {
    ...audit,
    changed: audit.aliases.length > 0 || audit.conflicts.length > 0 || audit.warnings.length > 0,
    requires_review: reviewConflicts.length > 0,
    counts: {
      aliases: audit.aliases.length,
      conflicts: audit.conflicts.length,
      warnings: audit.warnings.length,
    },
  };
  return {
    ok: !finalizedAudit.requires_review,
    canonical,
    audit: finalizedAudit,
  };
}

function mergeChildAudit(parent, child, prefix) {
  parent.aliases.push(...child.aliases.map((item) => ({ ...item, field: prefixed(prefix, item.field) })));
  parent.conflicts.push(...child.conflicts.map((item) => ({ ...item, field: prefixed(prefix, item.field) })));
  parent.warnings.push(...child.warnings.map((item) => ({ ...item, field: prefixed(prefix, item.field) })));
}

function addAlias(audit, field, sourceValue, canonicalValue, rule) {
  if (sameValue(sourceValue, canonicalValue)) return;
  audit.aliases.push({
    field,
    source_value: cloneValue(sourceValue),
    canonical_value: cloneValue(canonicalValue),
    rule,
  });
}

function addConflict(audit, {
  code,
  field,
  source_values,
  resolution,
  severity = "review",
  evidence,
}) {
  audit.conflicts.push({
    code,
    field,
    source_values: cloneValue(source_values || []),
    resolution: cloneValue(resolution),
    severity,
    ...(evidence ? { evidence: cloneValue(evidence) } : {}),
  });
}

function addWarning(audit, { code, field, detail }) {
  audit.warnings.push({ code, field, detail });
}

function collectFieldEntries(source, fields) {
  return fields
    .filter((field) => source[field] !== undefined && source[field] !== null && source[field] !== "")
    .map((field) => ({ field, value: source[field] }));
}

function collectFieldValues(source, fields) {
  return collectFieldEntries(source, fields).map((entry) => `${entry.field}=${entry.value}`);
}

function firstPresent(source, fields) {
  return collectFieldEntries(source, fields)[0]?.value ?? null;
}

function firstFinite(...values) {
  for (const value of values) {
    const parsed = finiteNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function firstTargetValue(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const first = value[0];
  if (isRecord(first)) return first.price ?? first.target ?? first.level ?? null;
  return first;
}

function finiteNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function token(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function sameValue(left, right) {
  if (typeof left === "string" && typeof right === "string") return left === right;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return left === right;
  }
}

function prefixed(prefix, field) {
  return field ? `${prefix}.${field}` : prefix;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }
  return value;
}
