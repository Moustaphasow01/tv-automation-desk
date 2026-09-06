import {
  grainChicagoDate,
  normalizeGrainRows,
} from "./us-grains-data-quality.js";
import { evaluateGrainsCalendarCoverage } from "./grains-calendar-coverage.js";
import {
  causalArray as array,
  causalIso as iso,
  causalRound as round,
  causalUpper as upper,
} from "./us-grains-causal-values.js";

const TICK = 0.25;

export function buildCausalGrainContext(input = {}) {
  const rows = normalizeGrainRows(input.rows || []);
  const peerRows = normalizeGrainRows(input.peerRows || []);
  const ownReturn = sessionReturn(rows);
  const peerReturn = sessionReturn(peerRows);
  const bias = biasFor(ownReturn, peerReturn);
  const events = knownEvents(input.events, input.asOfUtc).filter((event) =>
    !event.commodity_codes?.length || event.commodity_codes.includes(upper(input.instrument)));
  const eventRisk = eventRiskForDay(events, input.tradingDate);
  const calendarCoverage = evaluateGrainsCalendarCoverage({
    sources: input.agriCalendarCoverage,
    cutoff: input.asOfUtc,
  });
  return {
    schema_version: "us_grains_market_context_v2",
    instrument: input.instrument,
    source_data_cutoff_utc: input.asOfUtc || null,
    valid_until_utc: input.validUntilUtc || input.asOfUtc || null,
    data_quality: input.dataQuality || null,
    market_regime: marketRegime(rows),
    volatility_regime: volatilityRegime(rows),
    instrument_bias: bias,
    allowed_sides: sidesForBias(bias),
    preferred_strategy_families: preferredFamilies(bias),
    discouraged_strategy_families:
      bias === "NEUTRAL" ? [] : ["PRIOR_DAY_REJECTION"],
    opportunity_zones: zones(rows, bias),
    own_return_points: ownReturn,
    peer_return_points: peerReturn,
    macro_event_risk: { ...eventRisk, coverage: calendarCoverage },
    risk_multiplier: bias === "NEUTRAL" ? 0.65 : 0.85,
    reason_codes: [
      bias,
      ...calendarCoverage.reasonCodes,
      !calendarCoverage.admissible
        ? "AGRI_EVENT_COVERAGE_UNKNOWN"
        : eventRisk.high_event_count
          ? "AGRI_EVENT_DAY"
          : "NO_HIGH_AGRI_EVENT_NEARBY",
      peerReturn === null ? "PEER_CONTEXT_MISSING" : "PEER_CONTEXT_AVAILABLE",
    ],
  };
}

export function adjudicateCausalGrainSignal({ signal, context } = {}) {
  const value = context || signal?.setup?.context;
  if (!value) throw new Error("missing_grains_signal_context");
  const facts = gateFacts({ signal, context: value });
  const recommendation = gateRecommendation(facts);
  return {
    schema_version: "us_grains_context_gate_decision_v2",
    signal_id: signal.signal_id,
    recommendation,
    accepted: ["ACCEPT", "ACCEPT_REDUCED"].includes(recommendation),
    risk_multiplier:
      recommendation === "ACCEPT_REDUCED"
        ? Math.min(value.risk_multiplier, 0.5)
        : value.risk_multiplier,
    reason_codes: gateReasons({ facts, context: value }),
  };
}

function gateFacts({ signal, context }) {
  const family =
    signal.payload?.strategy_family || signal.setup?.setup_kind || "UNKNOWN";
  return {
    allowed: context.allowed_sides.includes(signal.direction),
    preferred: context.preferred_strategy_families.includes(family),
    discouraged: context.discouraged_strategy_families.includes(family),
    blackout: (context.macro_event_risk?.events || []).some(
      (event) =>
        Math.abs(
          Date.parse(event.event_timestamp_utc) -
            Date.parse(signal.generated_at_utc),
        ) <=
        30 * 60_000,
    ),
    qualityBlocked: context.data_quality?.tradeable === false,
    calendarBlocked: !evaluateGrainsCalendarCoverage({
      sources: [context.macro_event_risk?.coverage?.source],
      cutoff: signal.source_data_cutoff_utc,
    }).admissible,
  };
}

function gateRecommendation(facts) {
  if (facts.qualityBlocked || facts.calendarBlocked || facts.blackout)
    return "WAIT";
  if (!facts.allowed || facts.discouraged) return "REJECT";
  return facts.preferred ? "ACCEPT" : "ACCEPT_REDUCED";
}

function gateReasons({ facts, context }) {
  return [
    facts.allowed
      ? "DIRECTION_ALLOWED_BY_GRAIN_CONTEXT"
      : "DIRECTION_REJECTED_BY_GRAIN_CONTEXT",
    facts.preferred ? "PREFERRED_FAMILY" : "NON_PREFERRED_FAMILY",
    facts.discouraged ? "DISCOURAGED_FAMILY" : "",
    facts.blackout ? "AGRI_REPORT_BLACKOUT" : "",
    facts.qualityBlocked ? "DATA_QUALITY_BLOCKED" : "",
    facts.calendarBlocked ? "AGRI_CALENDAR_COVERAGE_UNPROVEN" : "",
    context.instrument_bias,
  ].filter(Boolean);
}

export function normalizeKnownAgriEvents(events, asOfUtc) {
  const cutoff = asOfUtc ? Date.parse(asOfUtc) : Infinity;
  return array(events)
    .map((event) => ({
      market_agri_event_id: event.market_agri_event_id || null,
      event_kind: upper(event.event_kind || event.kind),
      title: event.title || null,
      event_timestamp_utc: iso(
        event.event_timestamp_utc ||
          event.timestamp_utc ||
          event.scheduled_at_utc,
      ),
      source_published_at_utc: iso(
        event.source_published_at_utc || event.known_at_utc,
      ),
      actual_available_at_utc: iso(event.actual_available_at_utc),
      importance: upper(event.importance || "MEDIUM"),
      ...(Array.isArray(event.commodity_codes)
        ? { commodity_codes: event.commodity_codes.map(upper).filter(Boolean) }
        : {}),
    }))
    .filter(
      (event) =>
        event.event_timestamp_utc &&
        event.source_published_at_utc &&
        Date.parse(event.source_published_at_utc) <= cutoff,
    );
}

function knownEvents(events, asOfUtc) {
  return normalizeKnownAgriEvents(events, asOfUtc);
}
function eventRiskForDay(events, date) {
  const values = events.filter(
    (event) =>
      grainChicagoDate(event.event_timestamp_utc) === date &&
      ["HIGH", "CRITICAL"].includes(event.importance),
  );
  return {
    block_new_positions: false,
    high_event_count: values.length,
    events: values,
  };
}
function sessionReturn(rows) {
  return rows.length >= 2 ? round(rows.at(-1).close - rows[0].open) : null;
}
function marketRegime(rows) {
  const ret = sessionReturn(rows);
  const range = rangeFor(rows);
  return ret !== null &&
    Math.abs(ret) > Math.max(2, (range.high - range.low) * 0.45)
    ? "TRENDING"
    : "RANGE_OR_BALANCED";
}
function volatilityRegime(rows) {
  const atr = averageRange(rows.slice(-24));
  return atr === null
    ? "UNKNOWN"
    : atr > 2.5
      ? "HIGH"
      : atr < 0.7
        ? "LOW"
        : "NORMAL";
}
function biasFor(own, peer) {
  if (own !== null && own >= 1 && (peer === null || peer >= -0.75))
    return "LONG_BIASED";
  if (own !== null && own <= -1 && (peer === null || peer <= 0.75))
    return "SHORT_BIASED";
  return "NEUTRAL";
}
function sidesForBias(bias) {
  return bias === "LONG_BIASED"
    ? ["LONG"]
    : bias === "SHORT_BIASED"
      ? ["SHORT"]
      : ["LONG", "SHORT"];
}
function preferredFamilies(bias) {
  return bias === "NEUTRAL"
    ? ["PRIOR_DAY_REJECTION", "VWAP_PULLBACK"]
    : ["VWAP_PULLBACK", "OPENING_RANGE_BREAKOUT_RETEST", "PRIOR_DAY_RECLAIM"];
}
function zones(rows, bias) {
  const vwap = vwapFor(rows);
  const range = rangeFor(rows);
  return [
    {
      kind: "VWAP_CONTEXT",
      bias,
      center: round(vwap),
      low: round(vwap - TICK),
      high: round(vwap + TICK),
    },
    { kind: "SESSION_RANGE", low: range.low, high: range.high },
  ];
}
function rangeFor(rows) {
  return rows.length
    ? {
        high: round(Math.max(...rows.map((row) => row.high))),
        low: round(Math.min(...rows.map((row) => row.low))),
        close: round(rows.at(-1).close),
      }
    : { high: null, low: null, close: null };
}
function averageRange(rows) {
  return rows.length
    ? rows.reduce((sum, row) => sum + Math.max(TICK, row.high - row.low), 0) /
        rows.length
    : null;
}
function vwapFor(rows) {
  let pv = 0;
  let volume = 0;
  let fallback = 0;
  for (const row of rows) {
    const price = (row.high + row.low + row.close) / 3;
    const amount = Math.max(0, Number(row.volume) || 0);
    pv += price * amount;
    volume += amount;
    fallback += price;
  }
  return volume ? pv / volume : rows.length ? fallback / rows.length : null;
}
