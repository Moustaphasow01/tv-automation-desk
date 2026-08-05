import { numberOrNull } from "./setup-shape.js";

export const PREDICATE_STATES_V1 = Object.freeze({
  NOT_STARTED: "NOT_STARTED",
  PENDING: "PENDING",
  SATISFIED: "SATISFIED",
  FAILED: "FAILED",
  INVALIDATED: "INVALIDATED",
  EXPIRED: "EXPIRED",
  UNKNOWN: "UNKNOWN",
});

export const PREDICATE_TYPES_V1 = Object.freeze([
  "PRICE_RELATION",
  "PRICE_CROSS",
  "ZONE_TOUCH",
  "BREAKOUT_CLOSE",
  "BREAK_RETEST_SEQUENCE",
  "REJECTION_PATTERN",
  "VWAP_RELATION",
  "RSI_THRESHOLD",
  "TIME_WINDOW",
  "INTERMARKET_CONFIRMATION",
  "EVENT_BLACKOUT",
]);

export const DETERMINISTIC_PREDICATE_CAPABILITIES_V1 = Object.freeze({
  PRICE_RELATION: capability(["rows", "threshold"], false),
  PRICE_CROSS: capability(["rows", "threshold"], true),
  ZONE_TOUCH: capability(["rows", "zone"], false),
  BREAKOUT_CLOSE: capability(["closed_rows", "threshold"], false),
  BREAK_RETEST_SEQUENCE: capability([
    "closed_rows",
    "break_condition_id",
    "threshold",
    "tolerance_points",
    "max_bars",
  ], true),
  REJECTION_PATTERN: capability(["closed_rows", "threshold"], false),
  VWAP_RELATION: capability(["rows", "vwap"], false),
  RSI_THRESHOLD: capability(["rows", "rsi"], false),
  TIME_WINDOW: capability(["timestamp", "window"], false),
  INTERMARKET_CONFIRMATION: capability(["instrument_scoped_rows", "threshold"], false),
  EVENT_BLACKOUT: capability(["event_records", "window"], false),
});

export const DETERMINISTIC_PREDICATE_REGISTRY_V1 = Object.freeze({
  PRICE_RELATION: evaluatePriceRelation,
  PRICE_CROSS: evaluatePriceCross,
  ZONE_TOUCH: evaluateZoneTouch,
  BREAKOUT_CLOSE: evaluateBreakoutClose,
  BREAK_RETEST_SEQUENCE: evaluateBreakRetestSequence,
  REJECTION_PATTERN: evaluateRejectionPattern,
  VWAP_RELATION: evaluateVwapRelation,
  RSI_THRESHOLD: evaluateRsiThreshold,
  TIME_WINDOW: evaluateTimeWindow,
  INTERMARKET_CONFIRMATION: evaluateIntermarketConfirmation,
  EVENT_BLACKOUT: evaluateEventBlackout,
});

export function predicateCapabilitiesV1(predicateType) {
  return DETERMINISTIC_PREDICATE_CAPABILITIES_V1[normalizeEnum(predicateType)] || null;
}

export function evaluateDeterministicPredicateV1({
  condition = {},
  rows = [],
  previousState = null,
  validFromParis = null,
  nowParis = null,
} = {}) {
  const normalizedCondition = normalizeCondition(condition);
  const predicateType = normalizedCondition.predicate_type;
  const evaluator = DETERMINISTIC_PREDICATE_REGISTRY_V1[predicateType];
  if (!evaluator) {
    return predicateResult(normalizedCondition, PREDICATE_STATES_V1.UNKNOWN, {
      reason: "PREDICATE_TYPE_UNSUPPORTED",
    });
  }

  const previous = previousState && typeof previousState === "object" ? previousState : {};
  if (previous.state === PREDICATE_STATES_V1.INVALIDATED
    && normalizedCondition.memory_policy === "INVALIDATE_TERMINAL") {
    return {
      ...previous,
      condition_id: normalizedCondition.condition_id,
      predicate_type: predicateType,
      state: PREDICATE_STATES_V1.INVALIDATED,
      reason: "TERMINAL_INVALIDATION_LATCHED",
    };
  }
  if (previous.state === PREDICATE_STATES_V1.SATISFIED
    && normalizedCondition.memory_policy === "LATCH_UNTIL_TRIGGER") {
    return {
      ...previous,
      condition_id: normalizedCondition.condition_id,
      predicate_type: predicateType,
      state: PREDICATE_STATES_V1.SATISFIED,
      reason: "SATISFACTION_LATCHED",
    };
  }

  const nowMs = parseTimestamp(nowParis);
  const validFromMs = parseTimestamp(validFromParis || normalizedCondition.valid_from_paris);
  const expiresAtMs = parseTimestamp(normalizedCondition.expires_at_paris);
  if (nowMs !== null && expiresAtMs !== null && nowMs >= expiresAtMs) {
    return predicateResult(normalizedCondition, PREDICATE_STATES_V1.EXPIRED, {
      reason: "CONDITION_EXPIRED",
      last_evaluated_at_paris: nowParis,
    });
  }
  if (nowMs !== null && validFromMs !== null && nowMs < validFromMs) {
    return predicateResult(normalizedCondition, PREDICATE_STATES_V1.NOT_STARTED, {
      reason: "CONDITION_NOT_STARTED",
      last_evaluated_at_paris: nowParis,
    });
  }

  const scopedRows = normalizeRows(rows, normalizedCondition, validFromMs);
  if (scopedRows.length === 0) {
    return predicateResult(normalizedCondition, PREDICATE_STATES_V1.UNKNOWN, {
      reason: "CONDITION_DATA_UNAVAILABLE",
      last_evaluated_at_paris: nowParis,
      evidence: {
        instrument: normalizedCondition.instrument,
        timeframe: normalizedCondition.timeframe,
        source_row_count: 0,
      },
    });
  }

  const rawEvaluation = evaluator({
    condition: normalizedCondition,
    rows: scopedRows,
    previousState: previous,
  });
  const predicateTrue = rawEvaluation.matched === true;
  const terminalBlocker = predicateTrue
    && normalizedCondition.effect === "BLOCK_IF_TRUE"
    && normalizedCondition.memory_policy === "INVALIDATE_TERMINAL";
  const state = rawEvaluation.state
    || (terminalBlocker
      ? PREDICATE_STATES_V1.INVALIDATED
      : predicateTrue
        ? PREDICATE_STATES_V1.SATISFIED
        : PREDICATE_STATES_V1.PENDING);
  return predicateResult(normalizedCondition, state, {
    ...rawEvaluation,
    predicate_true: predicateTrue,
    last_evaluated_at_paris: predicateLastEvaluatedAt({
      predicateType,
      rows: scopedRows,
      previousState: previous,
      nowParis,
    }),
    evidence: {
      instrument: normalizedCondition.instrument,
      timeframe: normalizedCondition.timeframe,
      source_row_count: scopedRows.length,
      ...(rawEvaluation.evidence || {}),
    },
  });
}

export function evaluateDeterministicConditionSetV1({
  conditions = [],
  rows = [],
  rowsByInstrument = null,
  previousStates = {},
  setup = {},
  nowParis = null,
} = {}) {
  const normalizedConditions = (Array.isArray(conditions) ? conditions : [])
    .map((condition, index) => normalizeCondition(condition, index));
  const results = normalizedConditions.map((condition) => {
    const conditionRows = rowsForCondition({
      condition,
      rows,
      rowsByInstrument,
      setupInstrument: normalizeEnum(setup.instrument),
    });
    return evaluateDeterministicPredicateV1({
      condition,
      rows: conditionRows,
      previousState: previousStates?.[condition.condition_id] || null,
      validFromParis: setup.valid_from_paris || setup.valid_from || null,
      nowParis,
    });
  });

  const blockers = results.filter((result) => isBlockingCondition(result)
    && [PREDICATE_STATES_V1.SATISFIED, PREDICATE_STATES_V1.INVALIDATED].includes(result.state));
  const unknownBlockers = results.filter((result) => isBlockingCondition(result)
    && result.state === PREDICATE_STATES_V1.UNKNOWN);
  const required = results.filter((result) => isRequiredStructuralCondition(result));
  const requiredFailed = required.filter((result) => [
    PREDICATE_STATES_V1.FAILED,
    PREDICATE_STATES_V1.INVALIDATED,
    PREDICATE_STATES_V1.EXPIRED,
  ].includes(result.state));
  const requiredUnknown = required.filter((result) => result.state === PREDICATE_STATES_V1.UNKNOWN);
  const requiredNotStarted = required.filter((result) => result.state === PREDICATE_STATES_V1.NOT_STARTED);
  const requiredPending = required.filter((result) => result.state === PREDICATE_STATES_V1.PENDING);
  const scoreable = results.filter((result) => ["PRIMARY", "SECONDARY"].includes(result.importance));
  const scoreableKnown = scoreable.filter((result) => result.state !== PREDICATE_STATES_V1.UNKNOWN);
  const configuredWeight = scoreable.reduce((sum, result) => sum + result.weight, 0);
  const knownWeight = scoreableKnown.reduce((sum, result) => sum + result.weight, 0);
  const satisfiedWeight = scoreableKnown
    .filter((result) => result.state === PREDICATE_STATES_V1.SATISFIED)
    .reduce((sum, result) => sum + result.weight, 0);
  const weightedScore = configuredWeight > 0
    ? round(satisfiedWeight / configuredWeight, 4)
    : null;
  const knownWeightedScore = knownWeight > 0
    ? round(satisfiedWeight / knownWeight, 4)
    : null;
  const knownCoverageRatio = configuredWeight > 0
    ? round(knownWeight / configuredWeight, 4)
    : null;
  const primary = scoreable.filter((result) => result.importance === "PRIMARY");
  const primaryKnown = primary.filter((result) => result.state !== PREDICATE_STATES_V1.UNKNOWN);
  const sequence = evaluateExplicitSequence(results);
  const observedTimes = results
    .filter((result) => result.state === PREDICATE_STATES_V1.SATISFIED)
    .filter((result) => isRequiredStructuralCondition(result) || ["PRIMARY", "SECONDARY"].includes(result.importance))
    .map((result) => parseTimestamp(result.observed_at_paris))
    .filter((value) => value !== null);

  return {
    schema_version: "condition_set_evaluation_v1",
    results,
    hard_blockers_active: blockers.length,
    hard_blocker_condition_ids: blockers.map((result) => result.condition_id),
    hard_blockers_unknown: unknownBlockers.length,
    hard_blocker_unknown_condition_ids: unknownBlockers.map((result) => result.condition_id),
    required_total: required.length,
    required_satisfied: required.filter((result) => result.state === PREDICATE_STATES_V1.SATISFIED).length,
    required_failed: requiredFailed.length,
    required_failed_condition_ids: requiredFailed.map((result) => result.condition_id),
    required_unknown: requiredUnknown.length,
    required_unknown_condition_ids: requiredUnknown.map((result) => result.condition_id),
    required_not_started: requiredNotStarted.length,
    required_not_started_condition_ids: requiredNotStarted.map((result) => result.condition_id),
    required_pending: requiredPending.length,
    required_pending_condition_ids: requiredPending.map((result) => result.condition_id),
    scored_confirmation_count: scoreableKnown.length,
    configured_confirmation_count: scoreable.length,
    weighted_confirmation_score: weightedScore,
    weighted_known_confirmation_score: knownWeightedScore,
    known_confirmation_coverage_ratio: knownCoverageRatio,
    score_weight_satisfied: satisfiedWeight,
    score_weight_known: knownWeight,
    score_weight_total: configuredWeight,
    primary_confirmation_total: primary.length,
    primary_confirmation_known: primaryKnown.length,
    primary_confirmation_satisfied: primaryKnown
      .filter((result) => result.state === PREDICATE_STATES_V1.SATISFIED).length,
    soft_unknown_condition_ids: scoreable
      .filter((result) => result.state === PREDICATE_STATES_V1.UNKNOWN)
      .map((result) => result.condition_id),
    sequence_valid: sequence.valid,
    sequence_violation_condition_ids: sequence.violation_condition_ids,
    confirmation_complete_at_paris: observedTimes.length
      ? new Date(Math.max(...observedTimes)).toISOString()
      : null,
  };
}

function evaluatePriceRelation({ condition, rows }) {
  if (condition.threshold === null) return unknown("PRICE_THRESHOLD_MISSING");
  if (!rows.some((row) => numberOrNull(row[condition.field || "close"]) !== null)) {
    return unknown("PRICE_FIELD_MISSING");
  }
  return evaluateRowsByTemporalRule(condition, rows, (row) => relationMatches(
    numberOrNull(row[condition.field || "close"]),
    condition.threshold,
    condition.operator,
    condition.tolerance_points,
  ));
}

function evaluatePriceCross({ condition, rows }) {
  if (condition.threshold === null) return unknown("PRICE_THRESHOLD_MISSING");
  const numericRows = rows.filter((row) => numberOrNull(row[condition.field || "close"]) !== null);
  if (numericRows.length < 2) return unknown("PRICE_CROSS_SERIES_INSUFFICIENT");
  for (let index = 1; index < numericRows.length; index += 1) {
    const previous = numberOrNull(numericRows[index - 1][condition.field || "close"]);
    const current = numberOrNull(numericRows[index][condition.field || "close"]);
    if (previous === null || current === null) continue;
    const above = operatorIsAbove(condition.operator);
    const crossed = above
      ? previous <= condition.threshold && current > condition.threshold + condition.tolerance_points
      : previous >= condition.threshold && current < condition.threshold - condition.tolerance_points;
    if (crossed) return match(numericRows[index], current, { previous_value: previous });
  }
  return noMatch();
}

function evaluateZoneTouch({ condition, rows }) {
  const lower = numberOrNull(
    condition.zone?.lower ?? condition.zone?.from ?? condition.lower_threshold ?? condition.threshold,
  );
  const upper = numberOrNull(
    condition.zone?.upper ?? condition.zone?.to ?? condition.upper_threshold ?? condition.threshold,
  );
  if (lower === null || upper === null) return unknown("ZONE_BOUNDS_MISSING");
  const lowBound = Math.min(lower, upper) - condition.tolerance_points;
  const highBound = Math.max(lower, upper) + condition.tolerance_points;
  return evaluateRowsByTemporalRule(condition, rows, (row) => {
    const high = numberOrNull(row.high);
    const low = numberOrNull(row.low);
    return high !== null && low !== null && high >= lowBound && low <= highBound;
  });
}

function evaluateBreakoutClose({ condition, rows }) {
  if (condition.threshold === null) return unknown("BREAKOUT_LEVEL_MISSING");
  if (!rows.some((row) => isClosedRow(row) && numberOrNull(row.close) !== null)) {
    return unknown("CLOSED_PRICE_FIELD_MISSING");
  }
  return evaluateRowsByTemporalRule(condition, rows, (row) => {
    if (!isClosedRow(row)) return false;
    return relationMatches(
      numberOrNull(row.close),
      condition.threshold,
      condition.operator,
      condition.tolerance_points,
    );
  });
}

function evaluateBreakRetestSequence({ condition, rows, previousState }) {
  const direction = sequenceDirection(condition);
  const breakThreshold = numberOrNull(condition.break_threshold ?? condition.threshold);
  const retestThreshold = numberOrNull(condition.retest_level ?? condition.threshold);
  if (breakThreshold === null) return unknown("BREAK_LEVEL_MISSING");
  if (retestThreshold === null) return unknown("RETEST_LEVEL_MISSING");
  if (!condition.break_condition_id) return unknown("BREAK_CONDITION_ID_MISSING");
  const tolerance = condition.tolerance_points;
  // The sequence tolerance defines the retest zone. Applying it to the
  // breakout as well would silently move the breakout threshold and can make
  // a valid break impossible to recognize (for example 28,476 > 28,470 with
  // an 8-point retest tolerance). A distinct breakout tolerance is optional
  // and defaults to zero.
  const breakTolerance = Math.max(0, numberOrNull(condition.break_tolerance_points) ?? 0);
  const maxBars = positiveInteger(condition.max_bars, 12);
  const requireRejection = condition.require_rejection_confirmation !== false;
  let machineState = normalizeEnum(previousState.machine_state || "WAITING_BREAK");
  let breakAt = previousState.break_at_paris || null;
  let breakIndex = Number.isInteger(previousState.break_row_index) ? previousState.break_row_index : null;
  let barsSinceBreak = Number(previousState.bars_since_break || 0);
  let retestAt = previousState.retest_at_paris || null;
  const breakAtMs = parseTimestamp(breakAt);
  const lastEvaluatedAtMs = parseTimestamp(previousState.last_evaluated_at_paris);
  const alreadyAdvanced = machineState !== "WAITING_BREAK" || breakAtMs !== null;
  const causalCursorMs = alreadyAdvanced
    ? Math.max(
      breakAtMs ?? Number.NEGATIVE_INFINITY,
      lastEvaluatedAtMs ?? Number.NEGATIVE_INFINITY,
    )
    : null;
  const seenTimestamps = new Set();
  const causalRows = rows.filter((row) => {
    if (!isClosedRow(row)) return false;
    if ([row.open, row.high, row.low, row.close].some((value) => numberOrNull(value) === null)) return false;
    const timestampMs = parseTimestamp(rowTimestamp(row));
    if (timestampMs === null) return false;
    if (causalCursorMs !== null && timestampMs <= causalCursorMs) return false;
    if (seenTimestamps.has(timestampMs)) return false;
    seenTimestamps.add(timestampMs);
    return true;
  });

  if (previousState.state === PREDICATE_STATES_V1.FAILED
    && machineState === "FAILED_MAX_BARS") {
    return {
      state: PREDICATE_STATES_V1.FAILED,
      matched: false,
      machine_state: machineState,
      reason: previousState.reason || "RETEST_WINDOW_EXCEEDED",
      break_at_paris: breakAt,
      break_row_index: breakIndex,
      retest_at_paris: retestAt,
      bars_since_break: barsSinceBreak,
      evidence: previousState.evidence || {
        break_condition_id: condition.break_condition_id,
        max_bars: maxBars,
      },
    };
  }

  for (let index = 0; index < causalRows.length; index += 1) {
    const row = causalRows[index];
    if (!isClosedRow(row)) continue;
    const close = numberOrNull(row.close);
    const high = numberOrNull(row.high);
    const low = numberOrNull(row.low);
    if (close === null || high === null || low === null) continue;

    if (machineState === "WAITING_BREAK") {
      const broke = direction === "ABOVE"
        ? close > breakThreshold + breakTolerance
        : close < breakThreshold - breakTolerance;
      if (!broke) continue;
      machineState = "BREAK_CONFIRMED";
      breakAt = rowTimestamp(row);
      breakIndex = index;
      barsSinceBreak = 0;
      machineState = "WAITING_RETEST";
      continue;
    }

    if (["BREAK_CONFIRMED", "WAITING_RETEST"].includes(machineState)) {
      const rowMs = parseTimestamp(rowTimestamp(row));
      const currentBreakMs = parseTimestamp(breakAt);
      if (currentBreakMs !== null && (rowMs === null || rowMs <= currentBreakMs)) continue;
      barsSinceBreak += 1;
      if (barsSinceBreak > maxBars) {
        return {
          state: PREDICATE_STATES_V1.FAILED,
          matched: false,
          machine_state: "FAILED_MAX_BARS",
          reason: "RETEST_WINDOW_EXCEEDED",
          break_at_paris: breakAt,
          break_row_index: breakIndex,
          bars_since_break: barsSinceBreak,
          evidence: { break_condition_id: condition.break_condition_id, max_bars: maxBars },
        };
      }
      const touched = direction === "ABOVE"
        ? low <= retestThreshold + tolerance && high >= retestThreshold - tolerance
        : high >= retestThreshold - tolerance && low <= retestThreshold + tolerance;
      if (!touched) continue;
      machineState = "RETEST_TOUCHED";
      retestAt = rowTimestamp(row);
      const rejectedOnClosedBar = direction === "ABOVE"
        ? close >= retestThreshold
        : close <= retestThreshold;
      if (requireRejection && !rejectedOnClosedBar) continue;
      machineState = requireRejection ? "REJECTION_CONFIRMED" : "RETEST_TOUCHED";
      return {
        state: PREDICATE_STATES_V1.SATISFIED,
        matched: true,
        machine_state: "SATISFIED",
        reason: requireRejection ? "BREAK_RETEST_REJECTION_CONFIRMED" : "BREAK_RETEST_CONFIRMED",
        observed_at_paris: rowTimestamp(row),
        observed_value: close,
        break_at_paris: breakAt,
        break_row_index: breakIndex,
        retest_at_paris: retestAt,
        bars_since_break: barsSinceBreak,
        evidence: {
          break_condition_id: condition.break_condition_id,
          direction,
          break_threshold: breakThreshold,
          break_tolerance_points: breakTolerance,
          retest_level: retestThreshold,
          tolerance_points: tolerance,
          max_bars: maxBars,
          rejection_required: requireRejection,
          rejection_confirmed_on_closed_bar: requireRejection ? rejectedOnClosedBar : null,
        },
      };
    }

    if (machineState === "RETEST_TOUCHED") {
      const rowMs = parseTimestamp(rowTimestamp(row));
      const currentBreakMs = parseTimestamp(breakAt);
      if (currentBreakMs !== null && (rowMs === null || rowMs <= currentBreakMs)) continue;
      barsSinceBreak += 1;
      if (barsSinceBreak > maxBars) {
        return {
          state: PREDICATE_STATES_V1.FAILED,
          matched: false,
          machine_state: "FAILED_MAX_BARS",
          reason: "REJECTION_WINDOW_EXCEEDED",
          break_at_paris: breakAt,
          retest_at_paris: retestAt,
          bars_since_break: barsSinceBreak,
        };
      }
      const rejected = direction === "ABOVE" ? close >= retestThreshold : close <= retestThreshold;
      if (!rejected) continue;
      return {
        state: PREDICATE_STATES_V1.SATISFIED,
        matched: true,
        machine_state: "SATISFIED",
        reason: "BREAK_RETEST_REJECTION_CONFIRMED",
        observed_at_paris: rowTimestamp(row),
        observed_value: close,
        break_at_paris: breakAt,
        retest_at_paris: retestAt,
        bars_since_break: barsSinceBreak,
        evidence: {
          break_condition_id: condition.break_condition_id,
          direction,
          break_threshold: breakThreshold,
          retest_level: retestThreshold,
          tolerance_points: tolerance,
          max_bars: maxBars,
          rejection_confirmed_on_closed_bar: true,
        },
      };
    }
  }

  return {
    state: PREDICATE_STATES_V1.PENDING,
    matched: false,
    machine_state: machineState,
    reason: machineState === "WAITING_BREAK" ? "WAITING_BREAK" : "WAITING_RETEST_OR_REJECTION",
    break_at_paris: breakAt,
    break_row_index: breakIndex,
    retest_at_paris: retestAt,
    bars_since_break: barsSinceBreak,
    evidence: {
      break_condition_id: condition.break_condition_id,
      direction,
      break_threshold: breakThreshold,
      break_tolerance_points: breakTolerance,
      retest_level: retestThreshold,
      tolerance_points: tolerance,
      max_bars: maxBars,
    },
  };
}

function evaluateRejectionPattern({ condition, rows }) {
  const direction = rejectionDirection(condition);
  return evaluateRowsByTemporalRule(condition, rows, (row) => {
    if (!isClosedRow(row)) return false;
    const high = numberOrNull(row.high);
    const low = numberOrNull(row.low);
    const close = numberOrNull(row.close);
    if (high === null || low === null || close === null || condition.threshold === null) return false;
    return direction === "ABOVE"
      ? high >= condition.threshold - condition.tolerance_points
        && close <= condition.threshold + condition.tolerance_points
      : low <= condition.threshold + condition.tolerance_points
        && close >= condition.threshold - condition.tolerance_points;
  });
}

function evaluateVwapRelation({ condition, rows }) {
  const usable = rows.filter((row) => numberOrNull(row.close) !== null
    && numberOrNull(row[condition.reference_code] ?? row.vwap ?? row.VWAP) !== null);
  if (!usable.length) return unknown("VWAP_VALUE_MISSING");
  return evaluateRowsByTemporalRule(condition, usable, (row) => {
    const reference = numberOrNull(
      row[condition.reference_code] ?? row.vwap ?? row.VWAP,
    );
    return relationMatches(
      numberOrNull(row.close),
      reference,
      condition.operator,
      condition.tolerance_points,
    );
  });
}

function evaluateRsiThreshold({ condition, rows }) {
  if (condition.threshold === null) return unknown("RSI_THRESHOLD_MISSING");
  const usable = rows.filter((row) => numberOrNull(row.rsi ?? row.RSI) !== null);
  if (!usable.length) return unknown("RSI_VALUE_MISSING");
  return evaluateRowsByTemporalRule(condition, usable, (row) => relationMatches(
    numberOrNull(row.rsi ?? row.RSI),
    condition.threshold,
    condition.operator,
    condition.tolerance_points,
  ));
}

function evaluateTimeWindow({ condition, rows }) {
  const referenceValue = condition.reference_time_paris || rowTimestamp(rows.at(-1));
  const tradingDate = condition.trading_date || localDatePart(referenceValue);
  const startValue = condition.window?.start_paris || condition.start_paris;
  const endValue = condition.window?.end_paris || condition.end_paris;
  const startMs = parseParisWindowBoundary(startValue, tradingDate);
  let endMs = parseParisWindowBoundary(endValue, tradingDate);
  if (startMs === null || endMs === null) return unknown("TIME_WINDOW_MISSING");
  if (endMs <= startMs && isTimeOfDay(endValue)) {
    endMs = parseParisWindowBoundary(endValue, addUtcDate(tradingDate, 1));
  }
  const outside = normalizeEnum(condition.operator) === "OUTSIDE_WINDOW";
  return evaluateRowsByTemporalRule(condition, rows, (row) => {
    const timestamp = parseTimestamp(rowTimestamp(row));
    const within = timestamp !== null && timestamp >= startMs && timestamp < endMs;
    return outside ? !within : within;
  });
}

function evaluateIntermarketConfirmation({ condition, rows }) {
  const usable = rows.filter((row) => numberOrNull(row.alignment_score) !== null);
  if (!usable.length) return unknown("INTERMARKET_M1_ALIGNMENT_UNAVAILABLE");
  const evaluation = evaluateRowsByTemporalRule(condition, usable, (row) => relationMatches(
    numberOrNull(row.alignment_score),
    condition.threshold,
    condition.operator,
    condition.tolerance_points,
  ));
  if (evaluation.matched !== true) return evaluation;
  const matchedRow = usable.find((row) => rowTimestamp(row) === evaluation.observed_at_paris) || usable.at(-1);
  return {
    ...evaluation,
    evidence: {
      ...(evaluation.evidence || {}),
      alignment_lineage: matchedRow?.alignment_lineage || null,
    },
  };
}

function evaluateEventBlackout({ condition, rows }) {
  const beforeMinutes = numberOrNull(condition.before_minutes) ?? 0;
  const afterMinutes = numberOrNull(condition.after_minutes) ?? 0;
  const referenceMs = parseTimestamp(condition.reference_time_paris || condition.evaluation_time_paris);
  if (referenceMs === null) return unknown("EVENT_REFERENCE_TIME_MISSING");
  const referenceId = String(condition.event_window_ref || "").trim();
  if (!referenceId) return unknown("EVENT_WINDOW_REFERENCE_MISSING");
  const candidates = rows.filter((event) => {
    if (!isReservedMacroEventRow(event)) return false;
    const eventId = String(
      event.event_window_ref || event.event_window_id || event.event_id || event.id || "",
    ).trim();
    return eventId === referenceId;
  });
  if (!candidates.length) return unknown("EVENT_WINDOW_UNAVAILABLE");
  const matched = candidates.find((event) => {
    const startMs = parseTimestamp(
      event.window_start_paris || event.blackout_start_paris || event.start_paris,
    );
    const endMs = parseTimestamp(
      event.window_end_paris || event.blackout_end_paris || event.end_paris,
    );
    if (startMs !== null && endMs !== null) {
      return referenceMs >= startMs && referenceMs <= endMs;
    }
    const eventMs = parseTimestamp(event.scheduled_at_paris || event.timestamp_paris || event.time_paris);
    if (eventMs === null) return false;
    return referenceMs >= eventMs - beforeMinutes * 60_000
      && referenceMs <= eventMs + afterMinutes * 60_000;
  });
  const eventClear = normalizeEnum(condition.operator) === "EVENT_CLEAR";
  if (eventClear) return matched ? noMatch() : match(candidates.at(-1), null, {
    event_window_ref: referenceId,
  });
  return matched ? match(matched, null, { event_window_ref: referenceId }) : noMatch();
}

function evaluateRowsByTemporalRule(condition, rows, predicate) {
  const mode = normalizeEnum(condition.temporal_rule?.mode || "LATEST_CLOSED");
  if (mode === "CONSECUTIVE_CLOSED") {
    const count = positiveInteger(condition.temporal_rule?.count, 1);
    const tail = rows.filter(isClosedRow).slice(-count);
    if (tail.length < count || !tail.every(predicate)) return noMatch();
    return match(tail.at(-1), numberOrNull(tail.at(-1)?.[condition.field || "close"]), {
      consecutive_count: count,
    });
  }
  if (mode === "ANY_SINCE_ARM" || mode === "CROSS_AFTER_ARM") {
    const row = rows.find(predicate);
    return row ? match(row, numberOrNull(row[condition.field || "close"])) : noMatch();
  }
  const latest = rows.at(-1);
  return latest && predicate(latest)
    ? match(latest, numberOrNull(latest[condition.field || "close"]))
    : noMatch();
}

function evaluateExplicitSequence(results) {
  const sequenced = results
    .filter((result) => Number.isInteger(result.sequence) && result.sequence > 0)
    .sort((left, right) => left.sequence - right.sequence || left.condition_id.localeCompare(right.condition_id));
  if (sequenced.length < 2) return { valid: true, violation_condition_ids: [] };
  let previousObservedAt = null;
  let priorSatisfied = true;
  const violations = [];
  for (const result of sequenced) {
    if (result.state !== PREDICATE_STATES_V1.SATISFIED) {
      priorSatisfied = false;
      continue;
    }
    const observedAt = parseTimestamp(result.observed_at_paris);
    if (!priorSatisfied || observedAt === null || (previousObservedAt !== null && observedAt <= previousObservedAt)) {
      violations.push(result.condition_id);
      continue;
    }
    previousObservedAt = observedAt;
  }
  return { valid: violations.length === 0, violation_condition_ids: violations };
}

function normalizeCondition(condition = {}, index = 0) {
  const rawRole = normalizeEnum(condition.role);
  const importance = normalizeEnum(
    condition.importance
      || condition.priority_class
      || (["INVALIDATION", "VETO"].includes(rawRole)
        ? "HARD_BLOCKER"
        : condition.required_for_trigger === true ? "MANDATORY" : "SECONDARY"),
  );
  const effect = normalizeEnum(
    condition.effect
      || (["HARD_BLOCKER", "INVALIDATION", "VETO"].includes(importance)
        || ["INVALIDATION", "VETO"].includes(rawRole)
        ? "BLOCK_IF_TRUE"
        : "REQUIRE_TRUE"),
  );
  const role = normalizeEnum(
    rawRole
      || (effect === "BLOCK_IF_TRUE" ? "VETO" : importance === "MANDATORY" ? "ACTIVATION" : "CONFIRMATION"),
  );
  const operator = normalizeEnum(condition.operator || condition.comparator || condition.kind);
  return {
    ...condition,
    condition_id: String(condition.condition_id || condition.id || `condition_${index + 1}`),
    predicate_type: normalizeEnum(condition.predicate_type || inferPredicateType(operator)),
    role,
    effect,
    instrument: normalizeEnum(condition.instrument || condition.contract || condition.asset),
    timeframe: normalizeEnum(condition.timeframe || condition.interval),
    operator,
    threshold: numberOrNull(condition.threshold ?? condition.level ?? condition.price ?? condition.value),
    importance,
    required_for_trigger: effect === "BLOCK_IF_TRUE"
      ? false
      : condition.required_for_trigger === true || importance === "MANDATORY" || role === "ACTIVATION",
    memory_policy: normalizeMemoryPolicy(condition.memory_policy, effect, role),
    tolerance_points: Math.max(0, numberOrNull(condition.tolerance_points ?? condition.tolerance) ?? 0),
    weight: Math.max(0, numberOrNull(condition.weight) ?? defaultWeight(importance)),
    sequence: positiveIntegerOrNull(condition.sequence),
    max_bars: positiveIntegerOrNull(condition.max_bars ?? condition.temporal_rule?.max_bars),
  };
}

function inferPredicateType(operator) {
  if (operator.includes("BREAK_RETEST")) return "BREAK_RETEST_SEQUENCE";
  if (operator.includes("CROSS")) return "PRICE_CROSS";
  if (operator.includes("TOUCH")) return "ZONE_TOUCH";
  if (operator.includes("BREAK") || operator.includes("BREAKOUT")) return "BREAKOUT_CLOSE";
  if (operator.includes("REJECT")) return "REJECTION_PATTERN";
  if (operator.includes("VWAP")) return "VWAP_RELATION";
  if (operator.includes("RSI")) return "RSI_THRESHOLD";
  return "PRICE_RELATION";
}

function rowsForCondition({ condition, rows, rowsByInstrument, setupInstrument }) {
  const instrument = condition.instrument || setupInstrument;
  let sourceRows = [];
  if (rowsByInstrument instanceof Map) {
    sourceRows = rowsByInstrument.get(instrument) || [];
  } else if (rowsByInstrument && typeof rowsByInstrument === "object") {
    sourceRows = rowsByInstrument[instrument] || rowsByInstrument[instrument.toLowerCase()] || [];
  } else if (!condition.instrument || condition.instrument === setupInstrument) {
    sourceRows = rows;
  }
  return sourceRows;
}

function normalizeRows(rows, condition, validFromMs) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row === "object")
    .filter((row) => {
      const rowInstrument = normalizeEnum(row.instrument || row.symbol || row.contract);
      if (condition.instrument && rowInstrument && rowInstrument !== condition.instrument) return false;
      const rowTimeframe = normalizeEnum(row.timeframe || row.interval);
      if (condition.timeframe && rowTimeframe && rowTimeframe !== condition.timeframe) return false;
      if (condition.predicate_type === "EVENT_BLACKOUT") return isReservedMacroEventRow(row);
      const timestampMs = parseTimestamp(rowTimestamp(row));
      return validFromMs === null || (timestampMs !== null && timestampMs >= validFromMs);
    })
    .sort((left, right) => (parseTimestamp(rowTimestamp(left)) ?? 0) - (parseTimestamp(rowTimestamp(right)) ?? 0));
}

function predicateLastEvaluatedAt({ predicateType, rows, previousState, nowParis }) {
  if (predicateType !== "BREAK_RETEST_SEQUENCE") {
    return rowTimestamp(rows.at(-1)) || nowParis;
  }
  let latestValue = previousState.last_evaluated_at_paris || null;
  let latestMs = parseTimestamp(latestValue);
  for (const row of rows) {
    if (!isClosedRow(row)) continue;
    if ([row.open, row.high, row.low, row.close].some((value) => numberOrNull(value) === null)) continue;
    const timestampValue = rowTimestamp(row);
    const timestampMs = parseTimestamp(timestampValue);
    if (timestampMs === null || (latestMs !== null && timestampMs <= latestMs)) continue;
    latestValue = timestampValue;
    latestMs = timestampMs;
  }
  return latestValue;
}

function predicateResult(condition, state, details = {}) {
  return {
    schema_version: "predicate_evaluation_v1",
    condition_id: condition.condition_id,
    predicate_type: condition.predicate_type,
    role: condition.role,
    effect: condition.effect,
    importance: condition.importance,
    required_for_trigger: condition.required_for_trigger,
    memory_policy: condition.memory_policy,
    weight: condition.weight,
    sequence: condition.sequence,
    atomic_component: condition.atomic_component === true,
    subsumed_by_condition_id: condition.subsumed_by_condition_id || null,
    instrument: condition.instrument,
    timeframe: condition.timeframe,
    state,
    predicate_true: details.predicate_true === true || details.matched === true,
    observed_at_paris: details.observed_at_paris || null,
    observed_value: details.observed_value ?? null,
    last_evaluated_at_paris: details.last_evaluated_at_paris || null,
    reason: details.reason || null,
    machine_state: details.machine_state || null,
    break_at_paris: details.break_at_paris || null,
    retest_at_paris: details.retest_at_paris || null,
    bars_since_break: details.bars_since_break ?? null,
    evidence: details.evidence || {},
  };
}

function match(row, value, evidence = {}) {
  return {
    matched: true,
    observed_at_paris: rowTimestamp(row),
    observed_value: value,
    evidence,
  };
}

function noMatch() {
  return { matched: false };
}

function unknown(reason) {
  return { state: PREDICATE_STATES_V1.UNKNOWN, matched: false, reason };
}

function relationMatches(value, threshold, operator, tolerance) {
  if (value === null || threshold === null) return false;
  if (operatorIsAbove(operator)) return value >= threshold - tolerance;
  if (operatorIsBelow(operator)) return value <= threshold + tolerance;
  if (operator.includes("EQUAL") || operator.includes("NEAR")) return Math.abs(value - threshold) <= tolerance;
  return false;
}

function operatorIsAbove(operator) {
  return normalizeEnum(operator).includes("ABOVE")
    || [">", "GT", "GTE", ">="].includes(String(operator || "").trim().toUpperCase());
}

function operatorIsBelow(operator) {
  return normalizeEnum(operator).includes("BELOW")
    || ["<", "LT", "LTE", "<="].includes(String(operator || "").trim().toUpperCase());
}

function sequenceDirection(condition) {
  const explicit = normalizeEnum(condition.sequence_direction || condition.break_direction || condition.direction);
  if (["ABOVE", "LONG", "UP", "BULLISH"].includes(explicit)) return "ABOVE";
  if (["BELOW", "SHORT", "DOWN", "BEARISH"].includes(explicit)) return "BELOW";
  return operatorIsBelow(condition.operator) ? "BELOW" : "ABOVE";
}

function rejectionDirection(condition) {
  const operator = normalizeEnum(condition.operator);
  if (operator.includes("ABOVE") || operator.includes("RESISTANCE")) return "ABOVE";
  if (operator.includes("BELOW") || operator.includes("SUPPORT")) return "BELOW";
  return sequenceDirection(condition);
}

function normalizeMemoryPolicy(value, effect, role) {
  if (effect === "BLOCK_IF_TRUE") {
    return role === "INVALIDATION" ? "INVALIDATE_TERMINAL" : "LATEST_ONLY";
  }
  const normalized = normalizeEnum(value);
  if (["LATEST_ONLY", "LATCH_UNTIL_TRIGGER"].includes(normalized)) return normalized;
  return "LATCH_UNTIL_TRIGGER";
}

function isBlockingCondition(result) {
  return result.effect === "BLOCK_IF_TRUE"
    || result.role === "VETO"
    || result.role === "INVALIDATION"
    || result.importance === "HARD_BLOCKER";
}

function isRequiredStructuralCondition(result) {
  return !isBlockingCondition(result)
    && (result.required_for_trigger === true || result.role === "ACTIVATION" || result.importance === "MANDATORY");
}

function defaultWeight(importance) {
  if (importance === "PRIMARY") return 2;
  if (importance === "SECONDARY") return 1;
  return 0;
}

function capability(requiredInputs, stateful) {
  return Object.freeze({
    deterministic: true,
    closed_data_only: true,
    required_inputs: Object.freeze(requiredInputs),
    stateful,
  });
}

function isClosedRow(row) {
  return row?.closed !== false && row?.is_closed !== false && normalizeEnum(row?.status || "CLOSED") !== "OPEN";
}

function rowTimestamp(row) {
  return row?.timestamp_paris
    || row?.close_time_paris
    || row?.time_paris
    || row?.timestamp
    || row?.time
    || null;
}

function parseTimestamp(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseParisWindowBoundary(value, tradingDate) {
  if (!value) return null;
  if (!isTimeOfDay(value)) return parseTimestamp(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(tradingDate || ""))) return null;
  const [hour, minute, second = "0"] = String(value).split(":");
  return parisLocalToEpochMs(Number(tradingDate.slice(0, 4)), Number(tradingDate.slice(5, 7)),
    Number(tradingDate.slice(8, 10)), Number(hour), Number(minute), Number(second));
}

function parisLocalToEpochMs(year, month, day, hour, minute, second) {
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null;
  const targetUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let candidate = targetUtc;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = parisDateTimeParts(candidate);
    if (!parts) return null;
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    candidate += targetUtc - represented;
  }
  return candidate;
}

function parisDateTimeParts(epochMs) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(epochMs));
  const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  return ["year", "month", "day", "hour", "minute", "second"].every((key) => Number.isFinite(values[key]))
    ? values : null;
}

function isTimeOfDay(value) {
  return /^\d{2}:\d{2}(?::\d{2})?$/.test(String(value || ""));
}

function localDatePart(value) {
  const match = String(value || "").match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] || null;
}

function addUtcDate(date, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return null;
  const epochMs = Date.parse(date + "T00:00:00Z");
  return new Date(epochMs + days * 86_400_000).toISOString().slice(0, 10);
}

function isReservedMacroEventRow(row) {
  return row?.event_record === true
    || normalizeEnum(row?.event_row_type) === "MACRO_CALENDAR_EVENT"
    || normalizeEnum(row?.instrument) === "__MACRO_EVENTS__";
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveIntegerOrNull(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeEnum(value) {
  return String(value || "").trim().toUpperCase().replaceAll("-", "_").replaceAll(" ", "_");
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
