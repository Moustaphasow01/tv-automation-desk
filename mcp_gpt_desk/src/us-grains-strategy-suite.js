import { canonicalSha256, normalizeStrategySignalV1 } from "@tv-automation/desk-domain";
import { evaluateUsGrainsDataQuality, grainChicagoDate, isGrainsRth, normalizeGrainRows } from "./us-grains-data-quality.js";
import { simulateLimitSignalOutcome } from "./us-grains-strategy-engine.js";
import { grainStrategyIdentity } from "./us-grains-strategy-catalog.js";

export const US_GRAINS_STRATEGY_SUITE_VERSION = "us_grains_strategy_suite_v1";

export const US_GRAINS_STRATEGY_FAMILIES = Object.freeze([
  "VWAP_PULLBACK",
  "OPENING_RANGE_BREAKOUT_RETEST",
  "PRIOR_DAY_RECLAIM",
  "PRIOR_DAY_REJECTION",
]);

const SESSION = "cbot_grains_rth";
const OPENING_RANGE_END_MINUTE = 9 * 60;
const LAST_SIGNAL_MINUTE = 12 * 60 + 45;
const RTH_END_UTC_HOUR = 18;
const RTH_END_UTC_MINUTE = 20;
const TICK_SIZE = 0.25;

export function replayUsGrainsStrategySuiteV1(input = {}) {
  const config = suiteConfig(input);
  const rowsBySymbol = normalizeRowsBySymbol(input.rowsBySymbol || input.series_by_symbol || {});
  const events = normalizeAgriEvents(input.agriEvents || input.agri_events || []);
  const result = emptyReplayResult(config);
  for (const instrument of config.instruments) {
    replayInstrument({ config, instrument, rowsBySymbol, events, result });
  }
  return summarizeSuiteReplay(result);
}

function replayInstrument({ config, instrument, rowsBySymbol, events, result }) {
  const symbol = symbolForInstrument(instrument);
  const m5ByDay = groupByChicagoDate(rowsBySymbol[`${symbol}:5`] || []);
  const m1ByDay = groupByChicagoDate(rowsBySymbol[`${symbol}:1`] || []);
  const peerM5ByDay = groupByChicagoDate(rowsBySymbol[`${peerSymbol(symbol)}:5`] || []);
  const availableAt = { value: 0 };
  for (const tradingDate of Object.keys(m5ByDay).sort()) {
    if (!inDateWindow(tradingDate, config)) continue;
    const frame = buildGrainDayFrame({
      instrument,
      symbol,
      tradingDate,
      m5Rows: m5ByDay[tradingDate] || [],
      m1Rows: m1ByDay[tradingDate] || [],
      previousM5Rows: previousRows(m5ByDay, tradingDate),
      peerM5Rows: peerM5ByDay[tradingDate] || [],
      asOfUtc: asOfForTradingDate(config.asOfUtc, tradingDate),
      events,
    });
    if (!frame.tradeable) {
      result.skipped_days.push(frame);
      continue;
    }
    const candidates = generateSuiteCandidates({ config, frame });
    result.raw_signals.push(...candidates);
    processCandidates({ config, frame, candidates, executionRows: m1ByDay[tradingDate] || [], availableAt, result });
  }
}

export function buildGrainDayFrame(input = {}) {
  const m5Rows = normalizeGrainRows(input.m5Rows || []);
  const m1Rows = normalizeGrainRows(input.m1Rows || []);
  const previousM5Rows = normalizeGrainRows(input.previousM5Rows || []);
  const openingRows = m5Rows.filter((row) => chicagoMinute(row.timestamp_utc) < OPENING_RANGE_END_MINUTE);
  const quality = evaluateUsGrainsDataQuality({
    instrument: input.instrument,
    tradingDate: input.tradingDate,
    asOfUtc: input.asOfUtc || input.as_of_utc || null,
    m1Rows,
    m5Rows,
  });
  const openingRange = highLowClose(openingRows);
  const priorDay = highLowClose(previousM5Rows);
  const context = buildGrainMarketContext({
    instrument: input.instrument,
    rows: m5Rows,
    peerRows: input.peerM5Rows || [],
    events: input.events || [],
    tradingDate: input.tradingDate,
  });
  const issues = [
    ...(!openingRange.high ? ["OPENING_RANGE_MISSING"] : []),
    ...(!priorDay.high ? ["PRIOR_DAY_MISSING"] : []),
    ...(quality.tradeable ? [] : quality.issues),
  ];
  return {
    schema_version: "us_grains_day_frame_v1",
    suite_version: US_GRAINS_STRATEGY_SUITE_VERSION,
    instrument: input.instrument,
    symbol: input.symbol,
    trading_date: input.tradingDate,
    tradeable: issues.length === 0,
    issues,
    quality,
    opening_range: openingRange,
    prior_day: priorDay,
    context,
    rows: m5Rows,
  };
}

export function buildGrainMarketContext(input = {}) {
  const rows = normalizeGrainRows(input.rows || []);
  const peerRows = normalizeGrainRows(input.peerRows || []);
  const ownReturn = sessionReturn(rows);
  const peerReturn = sessionReturn(peerRows);
  const bias = grainBias(ownReturn, peerReturn);
  const eventRisk = eventRiskForDay(input.events || [], input.tradingDate);
  const allowedSides = eventRisk.block_new_positions ? [] : sidesForBias(bias);
  return {
    schema_version: "us_grains_market_context_v1",
    instrument: input.instrument,
    market_regime: marketRegime(rows),
    volatility_regime: volatilityRegime(rows),
    instrument_bias: bias,
    allowed_sides: allowedSides,
    preferred_strategy_families: preferredFamilies(bias),
    discouraged_strategy_families: discouragedFamilies(bias),
    opportunity_zones: opportunityZones({ rows, bias }),
    own_return_points: ownReturn,
    peer_return_points: peerReturn,
    macro_event_risk: eventRisk,
    risk_multiplier: eventRisk.block_new_positions ? 0 : bias === "NEUTRAL" ? 0.65 : 0.85,
    reason_codes: contextReasons({ bias, eventRisk, peerReturn }),
  };
}

function generateSuiteCandidates({ config, frame }) {
  const generated = [
    ...generateVwapPullback({ config, frame }),
    ...generateOpeningRangeRetest({ config, frame }),
    ...generatePriorDayReclaim({ config, frame }),
    ...generatePriorDayRejection({ config, frame }),
  ];
  return dedupeSignals(generated, config.minMinutesBetweenSignals);
}

function generateVwapPullback({ config, frame }) {
  const signals = [];
  let trend = null;
  for (let index = 12; index < frame.rows.length; index += 1) {
    const row = frame.rows[index];
    if (!isSignalMinute(row.timestamp_utc) || reportBlackout(row.timestamp_utc, frame.context)) continue;
    const history = frame.rows.slice(0, index + 1);
    const vwap = sessionVwap(history);
    const atr = averageRange(history.slice(-14));
    if (!vwap || !atr) continue;
    trend = trend || trendAfterOpeningRange(row, frame);
    const signal = trend ? pullbackSignal({ config, frame, row, history, vwap, atr, direction: trend }) : null;
    if (signal) signals.push(signal);
  }
  return signals;
}

function generateOpeningRangeRetest({ config, frame }) {
  const signals = [];
  for (let index = 12; index < frame.rows.length; index += 1) {
    const row = frame.rows[index];
    if (!isSignalMinute(row.timestamp_utc) || reportBlackout(row.timestamp_utc, frame.context)) continue;
    const atr = averageRange(frame.rows.slice(Math.max(0, index - 14), index + 1));
    const longBreak = row.close > frame.opening_range.high + TICK_SIZE;
    const shortBreak = row.close < frame.opening_range.low - TICK_SIZE;
    if (longBreak) signals.push(signalForLevel({ config, frame, row, direction: "LONG", family: "OPENING_RANGE_BREAKOUT_RETEST", level: frame.opening_range.high, atr }));
    if (shortBreak) signals.push(signalForLevel({ config, frame, row, direction: "SHORT", family: "OPENING_RANGE_BREAKOUT_RETEST", level: frame.opening_range.low, atr }));
  }
  return signals.filter(Boolean);
}

function generatePriorDayReclaim({ config, frame }) {
  const signals = [];
  for (let index = 1; index < frame.rows.length; index += 1) {
    const row = frame.rows[index];
    if (!isSignalMinute(row.timestamp_utc) || reportBlackout(row.timestamp_utc, frame.context)) continue;
    const previous = frame.rows[index - 1];
    const atr = averageRange(frame.rows.slice(Math.max(0, index - 14), index + 1));
    if (previous.close <= frame.prior_day.high && row.close > frame.prior_day.high + TICK_SIZE) {
      signals.push(signalForLevel({ config, frame, row, direction: "LONG", family: "PRIOR_DAY_RECLAIM", level: frame.prior_day.high, atr }));
    }
    if (previous.close >= frame.prior_day.low && row.close < frame.prior_day.low - TICK_SIZE) {
      signals.push(signalForLevel({ config, frame, row, direction: "SHORT", family: "PRIOR_DAY_RECLAIM", level: frame.prior_day.low, atr }));
    }
  }
  return signals.filter(Boolean);
}

function generatePriorDayRejection({ config, frame }) {
  const signals = [];
  for (let index = 5; index < frame.rows.length; index += 1) {
    const row = frame.rows[index];
    if (!isSignalMinute(row.timestamp_utc) || reportBlackout(row.timestamp_utc, frame.context)) continue;
    const atr = averageRange(frame.rows.slice(Math.max(0, index - 14), index + 1));
    if (row.high >= frame.prior_day.high && row.close < frame.prior_day.high - TICK_SIZE) {
      signals.push(signalForLevel({ config, frame, row, direction: "SHORT", family: "PRIOR_DAY_REJECTION", level: frame.prior_day.high, atr }));
    }
    if (row.low <= frame.prior_day.low && row.close > frame.prior_day.low + TICK_SIZE) {
      signals.push(signalForLevel({ config, frame, row, direction: "LONG", family: "PRIOR_DAY_REJECTION", level: frame.prior_day.low, atr }));
    }
  }
  return signals.filter(Boolean);
}

function pullbackSignal({ config, frame, row, history, vwap, atr, direction }) {
  const zone = direction === "LONG" ? Math.max(frame.opening_range.high, vwap) : Math.min(frame.opening_range.low, vwap);
  const recent = history.slice(-3);
  const touched = direction === "LONG" ? Math.min(...recent.map((item) => item.low)) <= zone + Math.max(TICK_SIZE, atr * 0.35) : Math.max(...recent.map((item) => item.high)) >= zone - Math.max(TICK_SIZE, atr * 0.35);
  const confirmed = direction === "LONG" ? row.close > row.open && row.close > zone : row.close < row.open && row.close < zone;
  if (!touched || !confirmed) return null;
  return signalForLevel({ config, frame, row, direction, family: "VWAP_PULLBACK", level: zone, atr });
}

function signalForLevel({ config, frame, row, direction, family, level, atr }) {
  const entry = roundToTick(level);
  const stopDistance = Math.max(config.minStopDistance, Math.min(config.maxStopDistance, atr * 0.9 || config.minStopDistance));
  const stop = roundToTick(direction === "LONG" ? entry - stopDistance : entry + stopDistance);
  const target1 = roundToTick(direction === "LONG" ? entry + Math.abs(entry - stop) * config.target1R : entry - Math.abs(entry - stop) * config.target1R);
  const target2 = roundToTick(direction === "LONG" ? entry + Math.abs(entry - stop) * config.target2R : entry - Math.abs(entry - stop) * config.target2R);
  if (!validRisk(entry, stop, config)) return null;
  return normalizeSuiteSignal({ config, frame, row, direction, family, entry, stop, target1, target2 });
}

function normalizeSuiteSignal(input) {
  const { config, frame, row, direction, family, entry, stop, target1, target2 } = input;
  const generatedAtUtc = row.timestamp_utc;
  const expiresAtUtc = new Date(Math.min(Date.parse(generatedAtUtc) + config.signalTtlMinutes * 60_000, rthEndMs(generatedAtUtc))).toISOString();
  const seed = { family, instrument: frame.instrument, generatedAtUtc, direction, entry, stop };
  const identity = grainStrategyIdentity(family, frame.instrument);
  const raw = {
    signal_id: deterministicUuid(["signal", seed]),
    strategy_definition_id: identity.strategy_definition_id,
    strategy_instance_id: identity.strategy_instance_id,
    strategy_version_id: identity.strategy_version_id,
    instrument: frame.instrument,
    direction,
    proposed_size: 1,
    confidence: confidenceFor({ frame, family, direction }),
    timeframe: "M5",
    session: SESSION,
    source_data_cutoff_utc: generatedAtUtc,
    execution_mode_origin: "SHADOW",
    generated_at_utc: generatedAtUtc,
    expires_at_utc: expiresAtUtc,
    correlation_id: `corr_us_grains_${frame.trading_date}_${family}_${direction}_${generatedAtUtc}`,
    setup: { setup_kind: family, order_type: "LIMIT", entry_zone: { lower: entry - TICK_SIZE, upper: entry + TICK_SIZE }, context: frame.context },
    predicates: [{ code: "US_GRAINS_RTH_ONLY", value: true }, { code: "CONTEXT_AVAILABLE", value: true }],
    evidence: [{ type: "source_row", timestamp_utc: generatedAtUtc, open: row.open, high: row.high, low: row.low, close: row.close }],
    reason_codes: ["US_GRAINS_RTH_ONLY", family, ...frame.context.reason_codes],
    signal_quality: { strategy_suite_version: US_GRAINS_STRATEGY_SUITE_VERSION, context_bias: frame.context.instrument_bias },
    proposed_trade_plan: { instrument: frame.instrument, direction, order_type: "LIMIT", entry_price: entry, stop_price: stop, targets: [{ label: "TP1", price: target1 }, { label: "TP2", price: target2 }], source_data_cutoff_utc: generatedAtUtc },
    payload: { strategy_family: family, market_universe: "US_GRAINS_CBOT", trade_window_policy: "RTH_ONLY" },
  };
  const normalized = normalizeStrategySignalV1(raw);
  return normalized.ok ? normalized.signal : null;
}

function processCandidates({ config, frame, candidates, executionRows, availableAt, result }) {
  const ranked = candidates.sort((left, right) => Date.parse(left.generated_at_utc) - Date.parse(right.generated_at_utc) || right.confidence - left.confidence);
  for (const signal of ranked) {
    const decision = adjudicateGrainSignal({ signal, frame });
    result.context_decisions.push(decision);
    if (!decision.accepted) continue;
    if (Date.parse(signal.generated_at_utc) < availableAt.value) continue;
    const outcome = simulateLimitSignalOutcome({ signal, executionRows, config });
    const acceptedSignal = attachContextGateDecision(signal, decision);
    result.accepted_signals.push(acceptedSignal);
    result.trades.push({ ...outcome, strategy_family: signal.payload?.strategy_family, context_recommendation: decision.recommendation });
    availableAt.value = Date.parse(outcome.closed_at_utc || outcome.expires_at_utc || signal.expires_at_utc) + config.cooldownMinutes * 60_000;
  }
}

function attachContextGateDecision(signal, decision) {
  return {
    ...signal,
    context_decision: decision,
    signal_quality: {
      ...signal.signal_quality,
      context_gate: {
        recommendation: contextGateRecommendation(decision.recommendation),
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

function contextGateRecommendation(value) {
  if (value === "ACCEPT") return "TAKE";
  if (value === "ACCEPT_REDUCED") return "TAKE_REDUCED";
  return value;
}

export function adjudicateGrainSignal({ signal, frame }) {
  const family = signal.payload?.strategy_family || signal.setup?.setup_kind || "UNKNOWN";
  const allowed = frame.context.allowed_sides.includes(signal.direction);
  const preferred = frame.context.preferred_strategy_families.includes(family);
  const discouraged = frame.context.discouraged_strategy_families.includes(family);
  const blackout = reportBlackout(signal.generated_at_utc, frame.context);
  const recommendation = blackout ? "WAIT" : !allowed || discouraged ? "REJECT" : preferred ? "ACCEPT" : "ACCEPT_REDUCED";
  return {
    schema_version: "us_grains_context_gate_decision_v1",
    signal_id: signal.signal_id,
    recommendation,
    accepted: ["ACCEPT", "ACCEPT_REDUCED"].includes(recommendation),
    risk_multiplier: recommendation === "ACCEPT_REDUCED" ? Math.min(frame.context.risk_multiplier, 0.5) : frame.context.risk_multiplier,
    reason_codes: decisionReasons({ allowed, preferred, discouraged, blackout, bias: frame.context.instrument_bias }),
  };
}

function summarizeSuiteReplay(result) {
  const filled = result.trades.filter((item) => item.filled_at_utc);
  const byDay = summarizeByDay(result);
  const accepted = result.context_decisions.filter((item) => item.accepted);
  return {
    schema_version: "us_grains_strategy_suite_replay_v1",
    suite_version: US_GRAINS_STRATEGY_SUITE_VERSION,
    instruments: result.config.instruments,
    raw_signal_count: result.raw_signals.length,
    context_accepted_count: accepted.length,
    context_rejected_count: result.context_decisions.filter((item) => item.recommendation === "REJECT").length,
    context_wait_count: result.context_decisions.filter((item) => item.recommendation === "WAIT").length,
    selected_signal_count: result.accepted_signals.length,
    filled_trade_count: filled.length,
    win_count: filled.filter((item) => item.r_result > 0).length,
    loss_count: filled.filter((item) => item.r_result < 0).length,
    total_r: round(filled.reduce((sum, item) => sum + item.r_result, 0)),
    average_r: filled.length ? round(filled.reduce((sum, item) => sum + item.r_result, 0) / filled.length) : 0,
    by_day: byDay,
    by_family: summarizeByFamily(result.trades),
    skipped_days: result.skipped_days,
    raw_signals: result.raw_signals,
    accepted_signals: result.accepted_signals,
    context_decisions: result.context_decisions,
    trades: result.trades,
  };
}

function suiteConfig(input) {
  return {
    instruments: array(input.instruments || input.instrument || ["ZW"]).flatMap((item) => String(item).split(",")).map(upper).filter(Boolean),
    startDate: input.startDate || input.start_date || null,
    endDate: input.endDate || input.end_date || null,
    minStopDistance: number(input.minStopDistance ?? input.min_stop_distance, 1),
    maxStopDistance: number(input.maxStopDistance ?? input.max_stop_distance, 8),
    target1R: number(input.target1R ?? input.target_1_r, 1.5),
    target2R: number(input.target2R ?? input.target_2_r, 2.25),
    signalTtlMinutes: number(input.signalTtlMinutes ?? input.signal_ttl_minutes, 45),
    minMinutesBetweenSignals: number(input.minMinutesBetweenSignals ?? input.min_minutes_between_signals, 20),
    cooldownMinutes: number(input.cooldownMinutes ?? input.cooldown_minutes, 10),
    asOfUtc: iso(input.asOfUtc || input.as_of_utc || null),
  };
}

function emptyReplayResult(config) {
  return { config, raw_signals: [], accepted_signals: [], context_decisions: [], trades: [], skipped_days: [] };
}

function highLowClose(rows) {
  const values = normalizeGrainRows(rows);
  if (!values.length) return { high: null, low: null, close: null, row_count: 0 };
  return { high: round(Math.max(...values.map((row) => row.high))), low: round(Math.min(...values.map((row) => row.low))), close: round(values.at(-1).close), row_count: values.length };
}

function sessionReturn(rows) {
  const values = normalizeGrainRows(rows).filter((row) => isGrainsRth(row.timestamp_utc));
  return values.length >= 2 ? round(values.at(-1).close - values[0].open) : null;
}

function marketRegime(rows) {
  const values = normalizeGrainRows(rows);
  const ret = sessionReturn(values);
  const range = highLowClose(values);
  if (ret !== null && Math.abs(ret) > Math.max(2, (range.high - range.low) * 0.45)) return "TRENDING";
  return "RANGE_OR_BALANCED";
}

function volatilityRegime(rows) {
  const atr = averageRange(normalizeGrainRows(rows).slice(-24));
  if (atr === null) return "UNKNOWN";
  if (atr > 2.5) return "HIGH";
  if (atr < 0.7) return "LOW";
  return "NORMAL";
}

function grainBias(ownReturn, peerReturn) {
  if (ownReturn !== null && ownReturn >= 1 && (peerReturn === null || peerReturn >= -0.75)) return "LONG_BIASED";
  if (ownReturn !== null && ownReturn <= -1 && (peerReturn === null || peerReturn <= 0.75)) return "SHORT_BIASED";
  return "NEUTRAL";
}

function sidesForBias(bias) {
  if (bias === "LONG_BIASED") return ["LONG"];
  if (bias === "SHORT_BIASED") return ["SHORT"];
  return ["LONG", "SHORT"];
}

function preferredFamilies(bias) {
  if (bias === "NEUTRAL") return ["PRIOR_DAY_REJECTION", "VWAP_PULLBACK"];
  return ["VWAP_PULLBACK", "OPENING_RANGE_BREAKOUT_RETEST", "PRIOR_DAY_RECLAIM"];
}

function discouragedFamilies(bias) {
  return bias === "NEUTRAL" ? [] : ["PRIOR_DAY_REJECTION"];
}

function opportunityZones({ rows, bias }) {
  const values = normalizeGrainRows(rows);
  const vwap = sessionVwap(values);
  const range = highLowClose(values);
  return [{ kind: "VWAP_CONTEXT", bias, center: round(vwap), low: round(vwap - TICK_SIZE), high: round(vwap + TICK_SIZE) }, { kind: "SESSION_RANGE", low: range.low, high: range.high }];
}

function eventRiskForDay(events, tradingDate) {
  const highEvents = normalizeAgriEvents(events).filter((event) => grainChicagoDate(event.event_timestamp_utc) === tradingDate && ["HIGH", "CRITICAL"].includes(event.importance));
  return { block_new_positions: false, high_event_count: highEvents.length, events: highEvents };
}

function reportBlackout(timestampUtc, context) {
  const ts = Date.parse(timestampUtc);
  return array(context?.macro_event_risk?.events).some((event) => Math.abs(Date.parse(event.event_timestamp_utc) - ts) <= 30 * 60_000);
}

function trendAfterOpeningRange(row, frame) {
  if (row.close > frame.opening_range.high + TICK_SIZE) return "LONG";
  if (row.close < frame.opening_range.low - TICK_SIZE) return "SHORT";
  return null;
}

function confidenceFor({ frame, family, direction }) {
  let value = frame.context.preferred_strategy_families.includes(family) ? 0.68 : 0.58;
  if (frame.context.allowed_sides.includes(direction)) value += 0.05;
  if (frame.context.volatility_regime === "HIGH") value -= 0.06;
  return round(Math.max(0.1, Math.min(0.88, value)), 3);
}

function validRisk(entry, stop, config) {
  const risk = Math.abs(entry - stop);
  return risk >= config.minStopDistance && risk <= config.maxStopDistance;
}

function averageRange(rows) {
  const values = normalizeGrainRows(rows);
  if (!values.length) return null;
  return values.reduce((sum, row) => sum + Math.max(TICK_SIZE, row.high - row.low), 0) / values.length;
}

function sessionVwap(rows) {
  const values = normalizeGrainRows(rows);
  let pv = 0; let volume = 0; let fallback = 0;
  for (const row of values) {
    const typical = (row.high + row.low + row.close) / 3;
    const vol = Math.max(0, number(row.volume, 0));
    pv += typical * vol; volume += vol; fallback += typical;
  }
  return volume > 0 ? pv / volume : values.length ? fallback / values.length : null;
}

function summarizeByDay(result) {
  const byDay = {};
  for (const trade of result.trades) {
    const day = grainChicagoDate(trade.generated_at_utc);
    byDay[day] ||= { accepted_count: 0, filled_count: 0, total_r: 0, statuses: {} };
    byDay[day].accepted_count += 1;
    if (trade.filled_at_utc) byDay[day].filled_count += 1;
    byDay[day].total_r = round(byDay[day].total_r + trade.r_result);
    byDay[day].statuses[trade.status] = (byDay[day].statuses[trade.status] || 0) + 1;
  }
  return byDay;
}

function summarizeByFamily(trades) {
  const byFamily = {};
  for (const trade of trades) {
    const family = trade.strategy_family || "UNKNOWN";
    byFamily[family] ||= { trades: 0, filled: 0, total_r: 0 };
    byFamily[family].trades += 1;
    if (trade.filled_at_utc) byFamily[family].filled += 1;
    byFamily[family].total_r = round(byFamily[family].total_r + trade.r_result);
  }
  return byFamily;
}

function contextReasons({ bias, eventRisk, peerReturn }) {
  return [bias, eventRisk.high_event_count ? "AGRI_EVENT_DAY" : "NO_HIGH_AGRI_EVENT_NEARBY", peerReturn === null ? "PEER_CONTEXT_MISSING" : "PEER_CONTEXT_AVAILABLE"];
}

function decisionReasons({ allowed, preferred, discouraged, blackout, bias }) {
  return [allowed ? "DIRECTION_ALLOWED_BY_GRAIN_CONTEXT" : "DIRECTION_REJECTED_BY_GRAIN_CONTEXT", preferred ? "PREFERRED_FAMILY" : "NON_PREFERRED_FAMILY", discouraged ? "DISCOURAGED_FAMILY" : "", blackout ? "AGRI_REPORT_BLACKOUT" : "", bias].filter(Boolean);
}

function dedupeSignals(signals, minutes) {
  const result = [];
  const last = {};
  for (const signal of signals.filter(Boolean).sort((a, b) => Date.parse(a.generated_at_utc) - Date.parse(b.generated_at_utc))) {
    const key = `${signal.instrument}:${signal.direction}:${signal.payload?.strategy_family}`;
    const ts = Date.parse(signal.generated_at_utc);
    if (last[key] && ts - last[key] < minutes * 60_000) continue;
    last[key] = ts;
    result.push(signal);
  }
  return result;
}

function previousRows(groups, tradingDate) {
  const previous = Object.keys(groups).filter((day) => day < tradingDate).sort().at(-1);
  return previous ? groups[previous] : [];
}

function asOfForTradingDate(asOfUtc, tradingDate) {
  return asOfUtc && grainChicagoDate(asOfUtc) === tradingDate ? asOfUtc : null;
}

function groupByChicagoDate(rows) {
  const groups = {};
  for (const row of normalizeGrainRows(rows).filter((item) => isGrainsRth(item.timestamp_utc))) {
    const day = grainChicagoDate(row.timestamp_utc);
    groups[day] ||= [];
    groups[day].push(row);
  }
  return groups;
}

function normalizeRowsBySymbol(source) {
  return Object.fromEntries(Object.entries(source).map(([key, rows]) => [upper(key), normalizeGrainRows(rows)]));
}

function normalizeAgriEvents(events) {
  return array(events).map((event) => ({ event_kind: upper(event.event_kind || event.kind), title: event.title || null, event_timestamp_utc: iso(event.event_timestamp_utc || event.timestamp_utc || event.scheduled_at_utc), importance: upper(event.importance || "MEDIUM") })).filter((event) => event.event_timestamp_utc);
}

function inDateWindow(date, config) {
  return (!config.startDate || date >= config.startDate) && (!config.endDate || date <= config.endDate);
}

function isSignalMinute(timestampUtc) {
  const minute = chicagoMinute(timestampUtc);
  return minute >= OPENING_RANGE_END_MINUTE && minute <= LAST_SIGNAL_MINUTE;
}

function chicagoMinute(timestampUtc) {
  const text = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(timestampUtc));
  const [hour, minute] = text.split(":").map(Number);
  return hour * 60 + minute;
}

function rthEndMs(timestampUtc) {
  const parts = grainChicagoDate(timestampUtc).split("-").map(Number);
  return Date.UTC(parts[0], parts[1] - 1, parts[2], RTH_END_UTC_HOUR, RTH_END_UTC_MINUTE, 0);
}

function symbolForInstrument(instrument) {
  return `${upper(instrument)}1!`;
}

function peerSymbol(symbol) {
  return upper(symbol) === "ZW1!" ? "ZC1!" : "ZW1!";
}

function deterministicUuid(parts) {
  const hex = canonicalSha256(parts).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function roundToTick(value) {
  return round(Math.round(value / TICK_SIZE) * TICK_SIZE);
}

function iso(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function number(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 4) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const factor = 10 ** digits;
  return Math.round(parsed * factor) / factor;
}

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function array(value) {
  return Array.isArray(value) ? value : [value].filter(Boolean);
}
