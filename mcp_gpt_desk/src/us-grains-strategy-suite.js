import { normalizeGrainsDataPolicy } from "@tv-automation/desk-domain";
import {
  evaluateUsGrainsDataQuality,
  grainChicagoDate,
  isGrainsRth,
  normalizeGrainRows,
} from "./us-grains-data-quality.js";
import {
  buildCausalGrainContext,
  adjudicateCausalGrainSignal,
  normalizeKnownAgriEvents,
} from "./us-grains-causal-context.js";
import {
  chicagoMinuteOfUtc,
  closeM5BarUtc,
  usGrainsSessionCloseUtc,
} from "./us-grains-causal-session.js";
import { buildGrainSignalProposal } from "./us-grains-signal-proposal.js";
import {
  causalArray as array,
  causalIso as iso,
  causalNumber as number,
  causalRound as round,
  causalUpper as upper,
} from "./us-grains-causal-values.js";

export { usGrainsSessionCloseUtc } from "./us-grains-causal-session.js";
export const US_GRAINS_STRATEGY_SUITE_VERSION =
  "us_grains_strategy_suite_causal_v2";
export const US_GRAINS_STRATEGY_FAMILIES = Object.freeze([
  "VWAP_PULLBACK",
  "OPENING_RANGE_BREAKOUT_RETEST",
  "PRIOR_DAY_RECLAIM",
  "PRIOR_DAY_REJECTION",
]);
const OPEN_END = 540;
const LAST_OPEN = 765;
const RTH_END = 800;
const TICK = 0.25;

export function replayUsGrainsStrategySuiteV1(input = {}) {
  return replayUsGrainsStrategySuiteV2(input);
}
export function replayUsGrainsStrategySuiteV2(input = {}) {
  const detection = detectUsGrainsStrategySignals(input);
  const context_decisions = detection.raw_signals.map((signal) =>
    adjudicateGrainSignal({ signal }),
  );
  const decisions = new Map(
    context_decisions.map((item) => [item.signal_id, item]),
  );
  const accepted_signals = detection.raw_signals
    .filter((signal) => decisions.get(signal.signal_id).accepted)
    .map((signal) => attachDecision(signal, decisions.get(signal.signal_id)));
  return {
    schema_version: "us_grains_strategy_suite_replay_v2",
    suite_version: US_GRAINS_STRATEGY_SUITE_VERSION,
    compatibility_entrypoint: "replayUsGrainsStrategySuiteV1",
    simulation_status: "NOT_RUN",
    instruments: detection.instruments,
    raw_signal_count: detection.raw_signal_count,
    context_accepted_count: accepted_signals.length,
    context_rejected_count: context_decisions.filter(
      (item) => item.recommendation === "REJECT",
    ).length,
    context_wait_count: context_decisions.filter(
      (item) => item.recommendation === "WAIT",
    ).length,
    selected_signal_count: accepted_signals.length,
    filled_trade_count: null,
    win_count: null,
    loss_count: null,
    total_r: null,
    average_r: null,
    raw_signals: detection.raw_signals,
    accepted_signals,
    context_decisions,
    skipped_days: detection.skipped_days,
    trades: [],
  };
}

export function detectUsGrainsStrategySignals(input = {}) {
  const config = configFor(input);
  const rowsBySymbol = normalizeRowsBySymbol(
    input.rowsBySymbol || input.series_by_symbol || {},
  );
  const events = normalizeKnownAgriEvents(
    input.agriEvents || input.agri_events || [],
  );
  const result = { raw_signals: [], skipped_days: [] };
  for (const instrument of config.instruments)
    detectInstrument({
      config,
      instrument,
      rowsBySymbol,
      events,
      agriCalendarCoverage: input.agriCalendarCoverage,
      result,
    });
  const raw_signals = result.raw_signals.sort(bySignalTime);
  return {
    schema_version: "us_grains_strategy_signal_detection_v2",
    suite_version: US_GRAINS_STRATEGY_SUITE_VERSION,
    causal_detection_version: "v2",
    instruments: config.instruments,
    raw_signal_count: raw_signals.length,
    raw_signals,
    skipped_days: result.skipped_days,
  };
}

function detectInstrument({
  config,
  instrument,
  rowsBySymbol,
  events,
  agriCalendarCoverage,
  result,
}) {
  const symbol = `${upper(instrument)}1!`;
  const m5Days = groupDays(rowsBySymbol[`${symbol}:5`] || [], 5);
  const m1Days = groupDays(rowsBySymbol[`${symbol}:1`] || [], 1);
  const peerDays = groupDays(rowsBySymbol[`${peerSymbol(symbol)}:5`] || [], 5);
  for (const tradingDate of Object.keys(m5Days).sort()) {
    if (!inWindow(tradingDate, config)) continue;
    const m5Rows = closedBy(m5Days[tradingDate], config.asOfUtc, 5);
    const priorRows = previousDay(m5Days, tradingDate);
    const opening = highLow(m5Rows.filter((row) => minute(row) < OPEN_END));
    const prior = highLow(priorRows);
    if (opening.high === null || prior.high === null) {
      result.skipped_days.push(
        skipDay({ instrument, symbol, tradingDate, opening, prior }),
      );
      continue;
    }
    const framesByCutoff = new Map();
    const frameAt = (row) => {
      const cutoff = closeM5BarUtc(row.timestamp_utc);
      if (framesByCutoff.has(cutoff)) return framesByCutoff.get(cutoff);
      const frame = buildFrameAtClose({
        instrument,
        symbol,
        tradingDate,
        row,
        m5Rows,
        m1Rows: m1Days[tradingDate] || [],
        priorRows,
        peerRows: peerDays[tradingDate] || [],
        events,
        agriCalendarCoverage,
        dataPolicy: config.dataPolicy,
      });
      framesByCutoff.set(cutoff, frame);
      return frame;
    };
    result.raw_signals.push(
      ...dedupeSignals(
        generateCandidates({ config, rows: m5Rows, frameAt }),
        config.minMinutesBetweenSignals,
      ),
    );
  }
}

function buildFrameAtClose(input) {
  const cutoff = closeM5BarUtc(input.row.timestamp_utc);
  return buildGrainDayFrame({
    instrument: input.instrument,
    symbol: input.symbol,
    tradingDate: input.tradingDate,
    asOfUtc: cutoff,
    m5Rows: closedBy(input.m5Rows, cutoff, 5),
    m1Rows: closedBy(input.m1Rows, cutoff, 1),
    previousM5Rows: input.priorRows,
    peerM5Rows: closedBy(input.peerRows, cutoff, 5),
    events: input.events,
    agriCalendarCoverage: input.agriCalendarCoverage,
    dataPolicy: input.dataPolicy,
  });
}

export function buildGrainDayFrame(input = {}) {
  const cutoff = iso(input.asOfUtc || input.as_of_utc);
  const rows = closedBy(input.m5Rows || [], cutoff, 5);
  const prior = highLow(input.previousM5Rows || []);
  const opening = highLow(rows.filter((row) => minute(row) < OPEN_END));
  const quality = evaluateUsGrainsDataQuality({
    instrument: input.instrument,
    tradingDate: input.tradingDate,
    asOfUtc: cutoff,
    m1Rows: closedBy(input.m1Rows || [], cutoff, 1),
    m5Rows: rows,
    dataPolicy: input.dataPolicy,
  });
  const context = buildCausalGrainContext({
    instrument: input.instrument,
    tradingDate: input.tradingDate,
    asOfUtc: cutoff,
    validUntilUtc: cutoff,
    rows,
    peerRows: closedBy(input.peerM5Rows || [], cutoff, 5),
    events: input.events || [],
    agriCalendarCoverage: input.agriCalendarCoverage,
    dataQuality: contextDataQuality(quality),
  });
  const issues = [
    ...(opening.high === null ? ["OPENING_RANGE_MISSING"] : []),
    ...(prior.high === null ? ["PRIOR_DAY_MISSING"] : []),
    ...(quality.tradeable ? [] : quality.issues),
  ];
  return {
    schema_version: "us_grains_day_frame_v2",
    suite_version: US_GRAINS_STRATEGY_SUITE_VERSION,
    instrument: input.instrument,
    symbol: input.symbol,
    trading_date: input.tradingDate,
    source_data_cutoff_utc: cutoff,
    tradeable: issues.length === 0,
    issues,
    quality,
    opening_range: opening,
    prior_day: prior,
    context,
    rows,
  };
}

export function buildGrainMarketContext(input = {}) {
  const cutoff = iso(input.asOfUtc || input.as_of_utc);
  return buildCausalGrainContext({
    ...input,
    asOfUtc: cutoff,
    rows: closedBy(input.rows || [], cutoff, 5),
    peerRows: closedBy(input.peerRows || [], cutoff, 5),
  });
}

function contextDataQuality(quality) {
  return quality.data_policy ? quality : {
    tradeable: quality.tradeable, status: quality.status, issues: quality.issues,
  };
}
export function adjudicateGrainSignal({ signal, frame } = {}) {
  return adjudicateCausalGrainSignal({ signal, context: frame?.context });
}

function generateCandidates({ config, rows, frameAt }) {
  return [
    ...vwapSignals({ config, rows, frameAt }),
    ...levelSignals({
      config,
      rows,
      frameAt,
      start: 12,
      family: "OPENING_RANGE_BREAKOUT_RETEST",
      matches: openingMatches,
    }),
    ...levelSignals({
      config,
      rows,
      frameAt,
      start: 1,
      family: "PRIOR_DAY_RECLAIM",
      matches: reclaimMatches,
    }),
    ...levelSignals({
      config,
      rows,
      frameAt,
      start: 5,
      family: "PRIOR_DAY_REJECTION",
      matches: rejectionMatches,
    }),
  ];
}
function vwapSignals({ config, rows, frameAt }) {
  const signals = [];
  let trend = null;
  for (let index = 12; index < rows.length; index += 1) {
    const row = rows[index];
    if (!signalOpen(row.timestamp_utc)) continue;
    const frame = frameAt(row);
    const history = frame.rows;
    const vwap = sessionVwap(history);
    const atr = averageRange(history.slice(-14));
    trend ||= openingTrend(row, frame);
    if (!vwap || !atr || !trend) continue;
    const level =
      trend === "LONG"
        ? Math.max(frame.opening_range.high, vwap)
        : Math.min(frame.opening_range.low, vwap);
    const recent = history.slice(-3);
    const touched =
      trend === "LONG"
        ? Math.min(...recent.map((item) => item.low)) <=
          level + Math.max(TICK, atr * 0.35)
        : Math.max(...recent.map((item) => item.high)) >=
          level - Math.max(TICK, atr * 0.35);
    const confirmed =
      trend === "LONG"
        ? row.close > row.open && row.close > level
        : row.close < row.open && row.close < level;
    if (touched && confirmed)
      signals.push(
        propose({
          config,
          frame,
          row,
          direction: trend,
          family: "VWAP_PULLBACK",
          level,
          atr,
        }),
      );
  }
  return signals;
}
function levelSignals({ config, rows, frameAt, start, family, matches }) {
  const signals = [];
  for (let index = start; index < rows.length; index += 1) {
    const row = rows[index];
    if (!signalOpen(row.timestamp_utc)) continue;
    const frame = frameAt(row);
    const atr = averageRange(frame.rows.slice(-15));
    for (const [direction, level] of matches(row, frame))
      signals.push(
        propose({ config, frame, row, direction, family, level, atr }),
      );
  }
  return signals;
}
function openingMatches(row, frame) {
  if (row.close > frame.opening_range.high + TICK)
    return [["LONG", frame.opening_range.high]];
  if (row.close < frame.opening_range.low - TICK)
    return [["SHORT", frame.opening_range.low]];
  return [];
}
function reclaimMatches(row, frame) {
  const previous = frame.rows.at(-2);
  if (
    previous?.close <= frame.prior_day.high &&
    row.close > frame.prior_day.high + TICK
  )
    return [["LONG", frame.prior_day.high]];
  if (
    previous?.close >= frame.prior_day.low &&
    row.close < frame.prior_day.low - TICK
  )
    return [["SHORT", frame.prior_day.low]];
  return [];
}
function rejectionMatches(row, frame) {
  const matches = [];
  if (
    row.high >= frame.prior_day.high &&
    row.close < frame.prior_day.high - TICK
  )
    matches.push(["SHORT", frame.prior_day.high]);
  if (row.low <= frame.prior_day.low && row.close > frame.prior_day.low + TICK)
    matches.push(["LONG", frame.prior_day.low]);
  return matches;
}
function propose(input) {
  return buildGrainSignalProposal({
    ...input,
    suiteVersion: US_GRAINS_STRATEGY_SUITE_VERSION,
  });
}

function skipDay({ instrument, symbol, tradingDate, opening, prior }) {
  return {
    schema_version: "us_grains_signal_detection_skip_v2",
    suite_version: US_GRAINS_STRATEGY_SUITE_VERSION,
    instrument,
    symbol,
    trading_date: tradingDate,
    issues: [
      ...(opening.high === null ? ["OPENING_RANGE_MISSING"] : []),
      ...(prior.high === null ? ["PRIOR_DAY_MISSING"] : []),
    ],
  };
}
function attachDecision(signal, decision) {
  return {
    ...signal,
    context_decision: decision,
    signal_quality: {
      ...signal.signal_quality,
      context_gate: {
        recommendation:
          decision.recommendation === "ACCEPT"
            ? "TAKE"
            : decision.recommendation === "ACCEPT_REDUCED"
              ? "TAKE_REDUCED"
              : decision.recommendation,
        confidence: signal.confidence,
        risk_multiplier: decision.risk_multiplier,
        reason_codes: decision.reason_codes,
        policy_version: decision.schema_version,
        model_ref: `deterministic://${decision.schema_version}`,
        issued_at_utc: signal.generated_at_utc,
      },
    },
  };
}
function groupDays(rows, step) {
  const groups = {};
  for (const row of normalizeGrainRows(rows).filter(
    (row) => isGrainsRth(row.timestamp_utc) && minute(row) + step <= RTH_END,
  ))
    (groups[grainChicagoDate(row.timestamp_utc)] ||= []).push(row);
  return groups;
}
function closedBy(rows, cutoff, step) {
  const end = cutoff ? Date.parse(cutoff) : Infinity;
  return normalizeGrainRows(rows).filter(
    (row) => Date.parse(row.timestamp_utc) + step * 60000 <= end,
  );
}
function highLow(rows) {
  const values = normalizeGrainRows(rows);
  return values.length
    ? {
        high: round(Math.max(...values.map((row) => row.high))),
        low: round(Math.min(...values.map((row) => row.low))),
        close: round(values.at(-1).close),
        row_count: values.length,
      }
    : { high: null, low: null, close: null, row_count: 0 };
}
function averageRange(rows) {
  const values = normalizeGrainRows(rows);
  return values.length
    ? values.reduce((sum, row) => sum + Math.max(TICK, row.high - row.low), 0) /
        values.length
    : null;
}
function sessionVwap(rows) {
  const values = normalizeGrainRows(rows);
  let pv = 0;
  let volume = 0;
  let fallback = 0;
  for (const row of values) {
    const price = (row.high + row.low + row.close) / 3;
    const amount = Math.max(0, Number(row.volume) || 0);
    pv += price * amount;
    volume += amount;
    fallback += price;
  }
  return volume ? pv / volume : values.length ? fallback / values.length : null;
}
function openingTrend(row, frame) {
  return row.close > frame.opening_range.high + TICK
    ? "LONG"
    : row.close < frame.opening_range.low - TICK
      ? "SHORT"
      : null;
}
function dedupeSignals(signals, minutes) {
  const result = [];
  const last = {};
  for (const signal of signals.filter(Boolean).sort(bySignalTime)) {
    const key = `${signal.instrument}:${signal.direction}:${signal.payload?.strategy_family}`;
    const time = Date.parse(signal.generated_at_utc);
    if (last[key] && time - last[key] < minutes * 60000) continue;
    last[key] = time;
    result.push(signal);
  }
  return result;
}
function previousDay(groups, day) {
  const previous = Object.keys(groups)
    .filter((value) => value < day)
    .sort()
    .at(-1);
  return previous ? groups[previous] : [];
}
function signalOpen(timestamp) {
  const value = chicagoMinuteOfUtc(timestamp);
  return value >= OPEN_END && value <= LAST_OPEN;
}
function minute(row) {
  return chicagoMinuteOfUtc(row.timestamp_utc);
}
function peerSymbol(symbol) {
  return upper(symbol) === "ZW1!" ? "ZC1!" : "ZW1!";
}
function normalizeRowsBySymbol(source) {
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [
      upper(key),
      normalizeGrainRows(value),
    ]),
  );
}
function configFor(input) {
  return {
    dataPolicy: normalizeGrainsDataPolicy(input.dataPolicy),
    instruments: array(input.instruments || input.instrument || ["ZW"])
      .flatMap((value) => String(value).split(","))
      .map(upper)
      .filter(Boolean),
    startDate: input.startDate || input.start_date || null,
    endDate: input.endDate || input.end_date || null,
    ...executionParameters(input),
    asOfUtc: iso(input.asOfUtc || input.as_of_utc),
  };
}
function executionParameters(input) {
  return {
    minStopDistance: number(
      input.minStopDistance ?? input.min_stop_distance,
      1,
    ),
    maxStopDistance: number(
      input.maxStopDistance ?? input.max_stop_distance,
      8,
    ),
    target1R: number(input.target1R ?? input.target_1_r, 1.5),
    target2R: number(input.target2R ?? input.target_2_r, 2.25),
    signalTtlMinutes: number(
      input.signalTtlMinutes ?? input.signal_ttl_minutes,
      45,
    ),
    minMinutesBetweenSignals: number(
      input.minMinutesBetweenSignals ?? input.min_minutes_between_signals,
      20,
    ),
  };
}
function inWindow(date, config) {
  return (
    (!config.startDate || date >= config.startDate) &&
    (!config.endDate || date <= config.endDate)
  );
}
function bySignalTime(left, right) {
  return (
    Date.parse(left.generated_at_utc) - Date.parse(right.generated_at_utc) ||
    right.confidence - left.confidence
  );
}
