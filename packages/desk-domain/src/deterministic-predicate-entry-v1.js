import {
  DETERMINISTIC_PREDICATE_CAPABILITIES_V1,
  DETERMINISTIC_PREDICATE_REGISTRY_V1,
  PREDICATE_STATES_V1,
  PREDICATE_TYPES_V1,
  evaluateDeterministicConditionSetV1 as evaluateConditionSetBaseV1,
  evaluateDeterministicPredicateV1 as evaluatePredicateBaseV1,
  predicateCapabilitiesV1,
} from "./deterministic-predicate-registry-v1.js";
import { normalizeV5ConditionIngressV1 } from "./v5-native-ingress-v1.js";

export {
  DETERMINISTIC_PREDICATE_CAPABILITIES_V1,
  DETERMINISTIC_PREDICATE_REGISTRY_V1,
  PREDICATE_STATES_V1,
  PREDICATE_TYPES_V1,
  predicateCapabilitiesV1,
};

export const PREDICATE_EVENT_ROWS_INSTRUMENT_V1 = "__MACRO_EVENTS__";
export const INTERMARKET_ALIGNMENT_VERSION_V1 = "m1_close_direction_v1";

const INSTRUMENT_ALIASES = Object.freeze({
  MNQ1: "MNQ",
  "MNQ1!": "MNQ",
  NQ1: "NQ",
  "NQ1!": "NQ",
  MES1: "MES",
  "MES1!": "MES",
  ES1: "ES",
  "ES1!": "ES",
});

const TIMEFRAME_ALIASES = Object.freeze({
  "1": "M1",
  "1M": "M1",
  M1: "M1",
  "5": "M5",
  "5M": "M5",
  M5: "M5",
  "15": "M15",
  "15M": "M15",
  M15: "M15",
  "60": "H1",
  "1H": "H1",
  H1: "H1",
  "240": "H4",
  "4H": "H4",
  H4: "H4",
});

export function canonicalInstrumentV1(value) {
  const enumValue = normalizeEnum(value);
  if (enumValue === PREDICATE_EVENT_ROWS_INSTRUMENT_V1) return PREDICATE_EVENT_ROWS_INSTRUMENT_V1;
  const normalized = enumValue
    .split(":").at(-1)
    .split("__")[0];
  return INSTRUMENT_ALIASES[normalized]
    || INSTRUMENT_ALIASES[normalized.replace(/!$/, "")]
    || normalized;
}

export function canonicalTimeframeV1(value) {
  const normalized = normalizeEnum(value);
  return TIMEFRAME_ALIASES[normalized] || normalized;
}

export function evaluateDeterministicPredicateV1(options = {}) {
  const condition = resolveConditionReferences(
    normalizeCondition(options.condition, {
      nowParis: options.nowParis,
      tradingDate: options.tradingDate,
    }),
    new Map(),
  );
  return evaluatePredicateBaseV1({
    ...options,
    condition,
    rows: canonicalRows(options.rows, [condition], {
      setupDirection: condition.direction,
    }),
  });
}

export function evaluateDeterministicConditionSetV1(options = {}) {
  const setup = {
    ...object(options.setup),
    instrument: canonicalInstrumentV1(options.setup?.instrument),
  };
  const normalized = (Array.isArray(options.conditions) ? options.conditions : [])
    .map((condition) => normalizeCondition(condition, {
      setupDirection: setup.direction,
      nowParis: options.nowParis,
      tradingDate: setup.trading_date || setup.date || options.tradingDate,
    }));
  const byId = new Map(normalized.map((condition) => [condition.condition_id, condition]));
  const conditions = markAtomicSequenceComponents(
    normalized.map((condition) => resolveConditionReferences(condition, byId)),
  );
  const evaluated = evaluateConditionSetBaseV1({
    ...options,
    setup,
    conditions,
    rows: canonicalRows(options.rows, conditions, {
      setupDirection: setup.direction,
    }),
    rowsByInstrument: canonicalRowsByInstrument(options.rowsByInstrument, conditions, {
      setupDirection: setup.direction,
    }),
  });
  return inheritAtomicSequenceEvidence(evaluated);
}

function markAtomicSequenceComponents(conditions) {
  const sequences = conditions.filter((condition) => (
    condition.predicate_type === "BREAK_RETEST_SEQUENCE"
      && condition.effect === "REQUIRE_TRUE"
  ));
  if (!sequences.length) return conditions;
  return conditions.map((condition) => {
    if (condition.subsumed_by_condition_id) return condition;
    if (condition.effect !== "REQUIRE_TRUE"
      || !["ZONE_TOUCH", "REJECTION_PATTERN"].includes(condition.predicate_type)) {
      return condition;
    }
    const sequence = sequences.find((candidate) => sequenceSubsumes(candidate, condition));
    if (!sequence) return condition;
    return {
      ...condition,
      required_for_trigger: false,
      importance: "ADVISORY",
      weight: 0,
      memory_policy: "LATCH_UNTIL_TRIGGER",
      atomic_component: true,
      subsumed_by_condition_id: sequence.condition_id,
    };
  });
}

function sequenceSubsumes(sequence, condition) {
  if (sequence.instrument !== condition.instrument
    || sequence.timeframe !== condition.timeframe) {
    return false;
  }
  if (condition.predicate_type === "REJECTION_PATTERN"
    && sequence.require_rejection_confirmation === false) {
    return false;
  }
  const sequenceLevel = numeric(sequence.retest_level ?? sequence.threshold);
  const lowerValue = numeric(
    condition.zone?.lower
      ?? condition.lower_threshold
      ?? condition.threshold,
  );
  const upperValue = numeric(
    condition.zone?.upper
      ?? condition.upper_threshold
      ?? condition.threshold,
  );
  if (sequenceLevel === null || (lowerValue === null && upperValue === null)) return false;
  const tolerance = Math.max(
    0,
    numeric(sequence.tolerance_points) ?? 0,
    numeric(condition.tolerance_points) ?? 0,
  );
  const lower = Math.min(lowerValue ?? upperValue, upperValue ?? lowerValue);
  const upper = Math.max(lowerValue ?? upperValue, upperValue ?? lowerValue);
  return sequenceLevel >= lower - tolerance && sequenceLevel <= upper + tolerance;
}

function inheritAtomicSequenceEvidence(evaluation) {
  const byId = new Map((evaluation.results || []).map((result) => [
    result.condition_id,
    result,
  ]));
  const results = (evaluation.results || []).map((result) => {
    const parent = byId.get(result.subsumed_by_condition_id);
    if (!parent || parent.state !== "SATISFIED") return result;
    return {
      ...result,
      state: "SATISFIED",
      predicate_true: true,
      observed_at_paris: parent.observed_at_paris,
      observed_value: parent.observed_value,
      last_evaluated_at_paris: parent.last_evaluated_at_paris,
      reason: "ATOMIC_SEQUENCE_COMPONENT_INHERITED",
      evidence: {
        ...(result.evidence || {}),
        atomic_sequence_condition_id: parent.condition_id,
        atomic_sequence_evidence: parent.evidence || {},
      },
    };
  });
  if (results === evaluation.results) return evaluation;
  return recomputeConditionEvaluation(evaluation, results);
}

function recomputeConditionEvaluation(evaluation, results) {
  const required = results.filter((result) => (
    result.effect !== "BLOCK_IF_TRUE"
      && (result.required_for_trigger === true
        || result.role === "ACTIVATION"
        || result.importance === "MANDATORY")
  ));
  const blockers = results.filter((result) => (
    result.effect === "BLOCK_IF_TRUE"
      || result.role === "VETO"
      || result.role === "INVALIDATION"
      || result.importance === "HARD_BLOCKER"
  ));
  return {
    ...evaluation,
    results,
    hard_blockers_active: blockers.filter((result) => (
      ["SATISFIED", "INVALIDATED"].includes(result.state)
    )).length,
    hard_blocker_condition_ids: blockers.filter((result) => (
      ["SATISFIED", "INVALIDATED"].includes(result.state)
    )).map((result) => result.condition_id),
    hard_blockers_unknown: blockers.filter((result) => result.state === "UNKNOWN").length,
    hard_blocker_unknown_condition_ids: blockers.filter((result) => (
      result.state === "UNKNOWN"
    )).map((result) => result.condition_id),
    required_total: required.length,
    required_satisfied: required.filter((result) => result.state === "SATISFIED").length,
    required_failed: required.filter((result) => (
      ["FAILED", "INVALIDATED", "EXPIRED"].includes(result.state)
    )).length,
    required_failed_condition_ids: required.filter((result) => (
      ["FAILED", "INVALIDATED", "EXPIRED"].includes(result.state)
    )).map((result) => result.condition_id),
    required_unknown: required.filter((result) => result.state === "UNKNOWN").length,
    required_unknown_condition_ids: required.filter((result) => (
      result.state === "UNKNOWN"
    )).map((result) => result.condition_id),
    required_not_started: required.filter((result) => result.state === "NOT_STARTED").length,
    required_not_started_condition_ids: required.filter((result) => (
      result.state === "NOT_STARTED"
    )).map((result) => result.condition_id),
    required_pending: required.filter((result) => result.state === "PENDING").length,
    required_pending_condition_ids: required.filter((result) => (
      result.state === "PENDING"
    )).map((result) => result.condition_id),
  };
}

function normalizeCondition(
  rawCondition = {},
  { setupDirection = null, nowParis = null, tradingDate = null } = {},
) {
  const condition = normalizeV5ConditionIngressV1(rawCondition);
  const predicateType = normalizeEnum(condition.predicate_type);
  const referenceInstrument = canonicalInstrumentV1(condition.reference_instrument);
  const conditionInstrument = predicateType === "EVENT_BLACKOUT"
    ? PREDICATE_EVENT_ROWS_INSTRUMENT_V1
    : predicateType === "INTERMARKET_CONFIRMATION" && referenceInstrument
      ? referenceInstrument
      : canonicalInstrumentV1(condition.instrument);
  const normalized = {
    ...condition,
    condition_id: String(condition.condition_id || condition.id || ""),
    predicate_type: predicateType,
    instrument: conditionInstrument,
    timeframe: predicateType === "EVENT_BLACKOUT"
      ? "EVENT"
      : canonicalTimeframeV1(condition.timeframe),
    direction: condition.direction || setupDirection,
    reference_time_paris: condition.reference_time_paris || nowParis,
    trading_date: condition.trading_date
      || condition.date
      || tradingDate
      || datePart(condition.reference_time_paris || nowParis),
  };
  if (predicateType === "INTERMARKET_CONFIRMATION") {
    return {
      ...normalized,
      field: "alignment_score",
      threshold: 0.5,
      operator: normalizeEnum(condition.operator) === "DIVERGES_FROM"
        ? "CLOSE_BELOW"
        : "CLOSE_ABOVE",
    };
  }
  return normalized;
}

function resolveConditionReferences(condition, byId) {
  if (condition.predicate_type !== "BREAK_RETEST_SEQUENCE") return condition;
  const referenced = byId.get(condition.break_condition_id);
  const referencedParameters = object(referenced?.parameters);
  const parameters = object(condition.parameters);
  return {
    ...condition,
    break_threshold: numeric(
      condition.break_threshold
        ?? referenced?.threshold
        ?? referencedParameters.threshold,
    ),
    retest_level: numeric(
      condition.retest_level
        ?? parameters.retest_level
        ?? condition.threshold,
    ),
    tolerance_points: numeric(
      condition.tolerance_points
        ?? parameters.tolerance_points,
    ) ?? 0,
    break_tolerance_points: numeric(
      condition.break_tolerance_points
        ?? parameters.break_tolerance_points,
    ) ?? 0,
    max_bars: positiveInteger(
      condition.max_bars
        ?? parameters.max_bars,
    ),
    require_rejection_confirmation: condition.require_rejection_confirmation
      ?? parameters.require_rejection_confirmation
      ?? true,
  };
}

export function setupConditionInstrumentsV1(setup = {}) {
  const source = object(setup);
  const conditions = [
    ...(Array.isArray(source.conditions) ? source.conditions : []),
    ...(Array.isArray(source.invalidation_conditions) ? source.invalidation_conditions : []),
  ];
  const instruments = new Set();
  for (const value of [source.instrument, source.contract]) {
    const instrument = canonicalInstrumentV1(value);
    if (instrument) instruments.add(instrument);
  }
  for (const rawCondition of conditions) {
    const condition = object(rawCondition);
    const parameters = object(condition.parameters);
    if (normalizeEnum(condition.predicate_type || condition.type) === "EVENT_BLACKOUT") {
      instruments.add(PREDICATE_EVENT_ROWS_INSTRUMENT_V1);
    }
    for (const value of [
      condition.instrument,
      condition.contract,
      condition.reference_instrument,
      parameters.instrument,
      parameters.reference_instrument,
    ]) {
      const instrument = canonicalInstrumentV1(value);
      if (instrument) instruments.add(instrument);
    }
  }
  return [...instruments];
}

function canonicalRowsByInstrument(rowsByInstrument, conditions, options = {}) {
  if (rowsByInstrument instanceof Map) {
    const normalized = new Map();
    for (const [instrument, rows] of rowsByInstrument.entries()) {
      const key = canonicalInstrumentV1(instrument);
      normalized.set(key, [
        ...(normalized.get(key) || []),
        ...canonicalRows(rows, conditions, options),
      ]);
    }
    return normalized;
  }
  if (!rowsByInstrument || typeof rowsByInstrument !== "object") return rowsByInstrument;
  return Object.fromEntries(
    Object.entries(rowsByInstrument).reduce((entries, [instrument, rows]) => {
      const key = canonicalInstrumentV1(instrument);
      const previous = entries.find(([candidate]) => candidate === key);
      if (previous) previous[1].push(...canonicalRows(rows, conditions, options));
      else entries.push([key, canonicalRows(rows, conditions, options)]);
      return entries;
    }, []),
  );
}

function canonicalRows(rows, conditions, { setupDirection = null } = {}) {
  const references = conditions
    .map((condition) => condition.reference_code)
    .filter(Boolean);
  const periods = conditions
    .map((condition) => positiveInteger(condition.indicator_period))
    .filter(Boolean);
  const normalizedRows = (Array.isArray(rows) ? rows : []).map((row) => {
    const source = object(row);
    const vwap = firstDefined(
      source.vwap,
      source.VWAP,
      source.session_vwap,
      nestedFieldValue(source, "vwap"),
      nestedFieldValue(source, "session_vwap"),
      ...references.map((reference) => fieldValue(source, reference)),
    );
    const rsi = firstDefined(
      source.rsi,
      source.RSI,
      nestedFieldValue(source, "rsi"),
      ...periods.flatMap((period) => [
        fieldValue(source, `rsi_${period}`),
        fieldValue(source, `RSI_${period}`),
      ]),
    );
    const alignment = firstDefined(
      source.alignment_score,
      source.correlation_alignment,
      nestedFieldValue(source, "alignment_score"),
      typeof source.aligned === "boolean" ? Number(source.aligned) : undefined,
      typeof source.diverged === "boolean" ? Number(!source.diverged) : undefined,
    );
    const eventRecord = isMacroEventRow(source);
    return {
      ...source,
      instrument: eventRecord
        ? PREDICATE_EVENT_ROWS_INSTRUMENT_V1
        : canonicalInstrumentV1(source.instrument || source.symbol || source.contract),
      timeframe: eventRecord
        ? "EVENT"
        : canonicalTimeframeV1(source.timeframe || source.interval),
      ...(eventRecord ? { event_record: true, event_row_type: "MACRO_CALENDAR_EVENT" } : {}),
      ...(vwap !== undefined ? { vwap } : {}),
      ...(rsi !== undefined ? { rsi } : {}),
      ...(alignment !== undefined ? { alignment_score: alignment } : {}),
    };
  });
  return deriveIntermarketAlignmentScores(normalizedRows, conditions, setupDirection);
}

function fieldValue(source, name) {
  const normalized = normalizeEnum(name);
  const key = Object.keys(source).find((candidate) => normalizeEnum(candidate) === normalized);
  if (key) return scalarValue(source[key]);
  return nestedFieldValue(source, name);
}

function nestedFieldValue(source, name) {
  for (const containerName of ["indicators", "studies", "technical_indicators", "technicalIndicators", "features"]) {
    const container = object(source[containerName]);
    const normalized = normalizeEnum(name);
    const key = Object.keys(container).find((candidate) => normalizeEnum(candidate) === normalized);
    if (key) return scalarValue(container[key]);
  }
  return undefined;
}

function scalarValue(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return firstDefined(value.value, value.current, value.close, value.result);
  }
  return value;
}

function deriveIntermarketAlignmentScores(rows, conditions, setupDirection) {
  const referenceInstruments = new Set(conditions
    .filter((condition) => condition.predicate_type === "INTERMARKET_CONFIRMATION")
    .map((condition) => condition.instrument)
    .filter(Boolean));
  const direction = normalizeEnum(setupDirection);
  if (!referenceInstruments.size || !["LONG", "SHORT"].includes(direction)) return rows;
  const previousCloseBySeries = new Map();
  return [...rows].sort((left, right) => timestampMs(left) - timestampMs(right)).map((row) => {
    if (!referenceInstruments.has(row.instrument) || row.alignment_score !== undefined || row.timeframe !== "M1") return row;
    const close = numeric(row.close);
    const seriesKey = row.instrument + ":" + row.timeframe;
    const previousClose = previousCloseBySeries.get(seriesKey);
    if (close !== null) previousCloseBySeries.set(seriesKey, close);
    if (close === null || previousClose === undefined || close === previousClose) return row;
    const referenceDirection = close > previousClose ? "LONG" : "SHORT";
    return {
      ...row,
      alignment_score: referenceDirection === direction ? 1 : 0,
      alignment_lineage: {
        version: INTERMARKET_ALIGNMENT_VERSION_V1,
        source: "REFERENCE_M1_CLOSED_CLOSE_DIRECTION",
        instrument: row.instrument,
        timeframe: row.timeframe,
        previous_close: previousClose,
        current_close: close,
        reference_direction: referenceDirection,
        setup_direction: direction,
      },
    };
  });
}

function isMacroEventRow(source) {
  if (source.event_record === true || source.event_row_type === "MACRO_CALENDAR_EVENT") return true;
  return Boolean(source.event_window_ref || source.event_window_id || source.event_id
    || source.window_start_paris || source.blackout_start_paris);
}

function timestampMs(row) {
  const parsed = Date.parse(row.timestamp_paris || row.close_time_paris || row.time_paris
    || row.timestamp_utc || row.timestamp || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function datePart(value) {
  const match = String(value || "").match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] || null;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function numeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeEnum(value) {
  return String(value || "").trim().toUpperCase().replaceAll("-", "_").replaceAll(" ", "_");
}
