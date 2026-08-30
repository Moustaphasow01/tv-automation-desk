import { canonicalSha256, normalizeStrategySignalV1 } from "@tv-automation/desk-domain";

export const US_GRAINS_STRATEGY_ENGINE_VERSION = "us_grains_strategy_engine_v1";
export const ZW_RTH_VWAP_PULLBACK_STRATEGY_ID = "us_grains_zw_rth_vwap_pullback_v1";

const CHICAGO_TZ = "America/Chicago";
const RTH_START_MINUTE = 8 * 60 + 30;
const OPENING_RANGE_END_MINUTE = 9 * 60;
const LAST_NEW_SIGNAL_MINUTE = 12 * 60 + 45;
const RTH_END_MINUTE = 13 * 60 + 20;
const DEFAULT_TICK_SIZE = 0.25;
const DEFAULT_SIGNAL_TTL_MINUTES = 45;

const dtfCache = new Map();

export function replayUsGrainsStrategyV1(input = {}) {
  const config = normalizeConfig(input);
  const rowsBySymbol = normalizeRowsBySymbol(input.rowsBySymbol || input.series_by_symbol || {});
  const decisionRows = rowsBySymbol[`${config.symbol}:${config.decisionTimeframe}`] || [];
  const executionRows = rowsBySymbol[`${config.symbol}:1`] || rowsBySymbol[`${config.symbol}:M1`] || [];
  const contextRowsBySymbol = normalizeRowsBySymbol(input.contextRowsBySymbol || input.context_series_by_symbol || {});
  const events = normalizeAgriEvents(input.agriEvents || input.agri_events || []);
  const tradingDays = groupRthRowsByChicagoDate(decisionRows);
  const executionByDay = groupRthRowsByChicagoDate(executionRows);
  const contextByKeyDay = Object.fromEntries(
    Object.entries(contextRowsBySymbol).map(([key, rows]) => [key, groupRthRowsByChicagoDate(rows)]),
  );

  const signals = [];
  const trades = [];
  const skippedDays = [];
  let nextAvailableAtMs = 0;

  for (const tradingDate of Object.keys(tradingDays).sort()) {
    if (config.startDate && tradingDate < config.startDate) continue;
    if (config.endDate && tradingDate > config.endDate) continue;
    const dayRows = tradingDays[tradingDate];
    const dayExecutionRows = executionByDay[tradingDate] || [];
    const previousDayRows = previousRthDayRows(tradingDays, tradingDate);
    const dayContextRowsBySymbol = Object.fromEntries(
      Object.entries(contextByKeyDay).map(([key, groups]) => [key, groups[tradingDate] || []]),
    );
    const dayPlan = buildDayTechnicalPlan({
      config,
      tradingDate,
      rows: dayRows,
      previousDayRows,
      contextRowsBySymbol: dayContextRowsBySymbol,
      events,
    });
    if (!dayPlan.tradeable) {
      skippedDays.push(dayPlan);
      continue;
    }
    for (const candidate of generateZwVwapPullbackCandidates({
      config,
      dayPlan,
      rows: dayRows,
      events,
    })) {
      const generatedMs = Date.parse(candidate.generated_at_utc);
      if (generatedMs < nextAvailableAtMs) continue;
      const outcome = simulateLimitSignalOutcome({
        signal: candidate,
        executionRows: dayExecutionRows,
        config,
      });
      signals.push(candidate);
      trades.push(outcome);
      nextAvailableAtMs = Date.parse(outcome.closed_at_utc || outcome.expires_at_utc || candidate.expires_at_utc)
        + config.cooldownMinutes * 60_000;
    }
  }

  return summarizeReplay({ config, signals, trades, skippedDays });
}

export function buildDayTechnicalPlan({
  config = normalizeConfig(),
  tradingDate,
  rows = [],
  previousDayRows = [],
  contextRowsBySymbol = {},
  events = [],
} = {}) {
  const rthRows = normalizeRows(rows).filter((row) => isRth(row.timestamp_utc));
  const openingRows = rthRows.filter((row) => chicagoMinute(row.timestamp_utc) >= RTH_START_MINUTE && chicagoMinute(row.timestamp_utc) < OPENING_RANGE_END_MINUTE);
  const previousLevels = highLowClose(previousDayRows);
  const openingRange = highLowClose(openingRows);
  const rowQuality = dataQualityForDay(rthRows);
  const hasOpeningRange = openingRows.length >= 4 && openingRange.high !== null && openingRange.low !== null;
  const hasPreviousDay = previousLevels.high !== null && previousLevels.low !== null;
  const context = buildGrainRelativeContext({ config, rows: rthRows, contextRowsBySymbol });
  const dayEvents = events
    .filter((event) => String(event.event_timestamp_utc || "").slice(0, 10) === tradingDate)
    .map((event) => ({
      event_kind: event.event_kind,
      title: event.title,
      event_timestamp_utc: event.event_timestamp_utc,
      importance: event.importance,
    }));
  const issues = [
    ...(!rthRows.length ? ["RTH_ROWS_EMPTY"] : []),
    ...(!hasOpeningRange ? ["OPENING_RANGE_INCOMPLETE"] : []),
    ...(!hasPreviousDay ? ["PRIOR_DAY_LEVELS_MISSING"] : []),
    ...(rowQuality.volume_state === "ZERO_VOLUME" ? ["VOLUME_ZERO"] : []),
  ];
  return {
    schema_version: "us_grains_day_technical_plan_v1",
    engine_version: US_GRAINS_STRATEGY_ENGINE_VERSION,
    strategy_id: config.strategyId,
    instrument: config.instrument,
    symbol: config.symbol,
    trading_date: tradingDate,
    tradeable: issues.length === 0,
    issues,
    rth_row_count: rthRows.length,
    opening_range: openingRange,
    prior_day: previousLevels,
    row_quality: rowQuality,
    context,
    events: dayEvents,
  };
}

export function generateZwVwapPullbackCandidates({
  config = normalizeConfig(),
  dayPlan,
  rows = [],
  events = [],
} = {}) {
  if (!dayPlan?.tradeable) return [];
  const rthRows = normalizeRows(rows).filter((row) => isRth(row.timestamp_utc));
  const candidates = [];
  let breakoutDirection = null;
  let breakoutAtUtc = null;
  for (let index = 20; index < rthRows.length; index += 1) {
    const row = rthRows[index];
    const minute = chicagoMinute(row.timestamp_utc);
    if (minute < OPENING_RANGE_END_MINUTE || minute > LAST_NEW_SIGNAL_MINUTE) continue;
    if (isInReportBlackout(row.timestamp_utc, events, config.reportBlackoutMinutes)) continue;
    const history = rthRows.slice(0, index + 1);
    const atr = atrSeries(history, { period: config.atrPeriod }).at(-1);
    if (!Number.isFinite(atr) || atr <= 0) continue;
    const vwap = sessionVwap(history);
    if (!Number.isFinite(vwap)) continue;
    const close = row.close;
    const previousCloses = history.slice(-2);
    const longBreakout = previousCloses.length === 2
      && previousCloses.every((item) => item.close > dayPlan.opening_range.high + config.tickSize)
      && close > vwap;
    const shortBreakout = previousCloses.length === 2
      && previousCloses.every((item) => item.close < dayPlan.opening_range.low - config.tickSize)
      && close < vwap;
    if (longBreakout && breakoutDirection !== "LONG") {
      breakoutDirection = "LONG";
      breakoutAtUtc = row.timestamp_utc;
    }
    if (shortBreakout && breakoutDirection !== "SHORT") {
      breakoutDirection = "SHORT";
      breakoutAtUtc = row.timestamp_utc;
    }
    if (!breakoutDirection) continue;
    const candidate = candidateFromPullback({
      config,
      dayPlan,
      row,
      history,
      atr,
      vwap,
      direction: breakoutDirection,
      breakoutAtUtc,
    });
    if (candidate) candidates.push(candidate);
  }
  return dedupeNearbyCandidates(candidates, config.minMinutesBetweenSignals);
}

function candidateFromPullback({ config, dayPlan, row, history, atr, vwap, direction, breakoutAtUtc }) {
  const recent3 = history.slice(-3);
  const recent5 = history.slice(-5);
  const tolerance = Math.max(config.tickSize, atr * 0.35);
  const reasonCodes = [
    "US_GRAINS_RTH_ONLY",
    "OPENING_RANGE_CONFIRMED",
    "VWAP_CONTEXT_AVAILABLE",
    "PRIOR_DAY_LEVELS_AVAILABLE",
  ];
  const predicates = [
    { code: "RTH_SESSION", value: true },
    { code: "OPENING_RANGE_COMPLETE", value: true, range: dayPlan.opening_range },
    { code: "REPORT_BLACKOUT_CLEAR", value: true },
  ];
  let entry;
  let stop;
  let target1;
  let target2;
  let confidence = 0.58;
  let setupKind;
  if (direction === "LONG") {
    const zone = Math.max(dayPlan.opening_range.high, vwap);
    const pulledBack = Math.min(...recent3.map((item) => item.low)) <= zone + tolerance;
    const recovered = row.close > row.open && row.close >= zone + config.tickSize && row.close > vwap;
    const notChasing = row.close - zone <= Math.max(atr * 1.25, 2.5);
    const priorResistanceTooClose = dayPlan.prior_day.high > zone
      && dayPlan.prior_day.high - zone < Math.max(atr * 0.8, 1)
      && row.close < dayPlan.prior_day.high;
    if (!pulledBack || !recovered || !notChasing || priorResistanceTooClose) return null;
    entry = roundToTick(zone, config.tickSize);
    const swingLow = Math.min(...recent5.map((item) => item.low));
    stop = roundToTick(Math.min(swingLow - config.tickSize, entry - Math.max(atr * 0.65, config.minStopDistance)), config.tickSize);
    const risk = entry - stop;
    if (!validRiskDistance(risk, config)) return null;
    target1 = roundToTick(entry + risk * config.target1R, config.tickSize);
    target2 = roundToTick(entry + risk * config.target2R, config.tickSize);
    setupKind = "VWAP_OR_HIGH_PULLBACK_LONG";
    reasonCodes.push("VWAP_PULLBACK_LONG", "OR_HIGH_RECLAIMED");
    predicates.push(
      { code: "PULLBACK_TO_VWAP_OR_OR_HIGH", value: true, zone },
      { code: "RECOVERY_CLOSE", value: true },
      { code: "NOT_CHASING_EXTENSION", value: true },
    );
  } else {
    const zone = Math.min(dayPlan.opening_range.low, vwap);
    const pulledBack = Math.max(...recent3.map((item) => item.high)) >= zone - tolerance;
    const rejected = row.close < row.open && row.close <= zone - config.tickSize && row.close < vwap;
    const notChasing = zone - row.close <= Math.max(atr * 1.25, 2.5);
    const priorSupportTooClose = dayPlan.prior_day.low < zone
      && zone - dayPlan.prior_day.low < Math.max(atr * 0.8, 1)
      && row.close > dayPlan.prior_day.low;
    if (!pulledBack || !rejected || !notChasing || priorSupportTooClose) return null;
    entry = roundToTick(zone, config.tickSize);
    const swingHigh = Math.max(...recent5.map((item) => item.high));
    stop = roundToTick(Math.max(swingHigh + config.tickSize, entry + Math.max(atr * 0.65, config.minStopDistance)), config.tickSize);
    const risk = stop - entry;
    if (!validRiskDistance(risk, config)) return null;
    target1 = roundToTick(entry - risk * config.target1R, config.tickSize);
    target2 = roundToTick(entry - risk * config.target2R, config.tickSize);
    setupKind = "VWAP_OR_LOW_PULLBACK_SHORT";
    reasonCodes.push("VWAP_PULLBACK_SHORT", "OR_LOW_REJECTED");
    predicates.push(
      { code: "PULLBACK_TO_VWAP_OR_OR_LOW", value: true, zone },
      { code: "REJECTION_CLOSE", value: true },
      { code: "NOT_CHASING_EXTENSION", value: true },
    );
  }
  const contextAdjustment = grainContextAdjustment(dayPlan.context, direction);
  confidence = Math.max(0.1, Math.min(0.85, confidence + contextAdjustment.confidenceDelta));
  reasonCodes.push(...contextAdjustment.reasonCodes);
  if (contextAdjustment.blocked) return null;
  const generatedAtUtc = row.timestamp_utc;
  const expiresAtUtc = new Date(Math.min(
    Date.parse(generatedAtUtc) + config.signalTtlMinutes * 60_000,
    chicagoRthEndMs(generatedAtUtc),
  )).toISOString();
  const riskPoints = Math.abs(entry - stop);
  const signal = {
    signal_id: `sig_us_grains_${canonicalSha256({ strategy: config.strategyId, generatedAtUtc, direction, entry, stop }).slice(0, 24)}`,
    strategy_definition_id: config.strategyId,
    strategy_instance_id: `${config.strategyId}_${config.instrument.toLowerCase()}_${config.decisionTimeframe}`,
    strategy_version_id: `${config.strategyId}@${US_GRAINS_STRATEGY_ENGINE_VERSION}`,
    instrument: config.instrument,
    direction,
    proposed_size: 1,
    confidence: round(confidence, 3),
    timeframe: `M${config.decisionTimeframe}`,
    session: "cbot_grains_rth",
    source_data_cutoff_utc: generatedAtUtc,
    execution_mode_origin: "SHADOW",
    generated_at_utc: generatedAtUtc,
    expires_at_utc: expiresAtUtc,
    correlation_id: `corr_us_grains_${dayPlan.trading_date}_${direction}_${generatedAtUtc}`,
    setup: {
      setup_id: `${config.strategyId}_${dayPlan.trading_date}_${direction}_${generatedAtUtc}`,
      setup_kind: setupKind,
      order_type: "LIMIT",
      breakout_at_utc: breakoutAtUtc,
      entry_zone: { lower: round(entry - config.tickSize, 4), upper: round(entry + config.tickSize, 4) },
      prior_day: dayPlan.prior_day,
      opening_range: dayPlan.opening_range,
      vwap: round(sessionVwap(history), 4),
      atr_m5: round(atr, 4),
    },
    predicates,
    evidence: [
      { type: "technical_plan", ref: `us-grains-day://${dayPlan.trading_date}`, payload: dayPlan },
      { type: "source_row", timestamp_utc: generatedAtUtc, open: row.open, high: row.high, low: row.low, close: row.close },
    ],
    reason_codes: unique(reasonCodes),
    signal_quality: {
      strategy_engine_version: US_GRAINS_STRATEGY_ENGINE_VERSION,
      data_profile: "us_grains_cbot_rth_m1_m5",
      order_type: "LIMIT",
      temporal_alignment: "PUBLICATION_CUTOFF",
      context_alignment: contextAdjustment.alignment,
      report_blackout_clear: true,
      risk_distance_points: round(riskPoints, 4),
    },
    proposed_trade_plan: {
      instrument: config.instrument,
      direction,
      order_type: "LIMIT",
      entry_price: entry,
      limit_price: entry,
      stop_price: stop,
      stop_loss: stop,
      targets: [
        { label: "TP1", price: target1, r: config.target1R },
        { label: "TP2", price: target2, r: config.target2R },
      ],
      source_data_cutoff_utc: generatedAtUtc,
    },
    payload: {
      strategy_family: "VWAP_TREND_PULLBACK",
      market_universe: "US_GRAINS_CBOT",
      trade_window_policy: "RTH_ONLY",
      limit_order_valid_until_utc: expiresAtUtc,
    },
  };
  const normalized = normalizeStrategySignalV1(signal);
  if (!normalized.ok) {
    return null;
  }
  return normalized.signal;
}

export function simulateLimitSignalOutcome({ signal, executionRows = [], config = normalizeConfig() } = {}) {
  const direction = String(signal.direction || "").toUpperCase();
  const plan = signal.proposed_trade_plan || {};
  const entry = finite(plan.entry?.calculation_price ?? plan.entry?.price ?? plan.entry_price ?? plan.limit_price);
  const stop = finite(plan.stop?.price ?? plan.stop_price ?? plan.stop_loss);
  const target = finite(array(plan.targets)[0]?.price);
  const generatedMs = Date.parse(signal.generated_at_utc);
  const expiryMs = Date.parse(signal.expires_at_utc);
  const rthEndMs = chicagoRthEndMs(signal.generated_at_utc);
  const deadlineMs = Math.min(expiryMs, rthEndMs);
  const rows = normalizeRows(executionRows)
    .filter((row) => {
      const ms = Date.parse(row.timestamp_utc);
      return ms > generatedMs && ms <= deadlineMs && isRth(row.timestamp_utc);
    });
  let filledAt = null;
  let exit = null;
  let status = "EXPIRED_NO_FILL";
  let exitReason = "NO_LIMIT_FILL_BEFORE_EXPIRY";
  for (const row of rows) {
    if (!filledAt) {
      const fillable = row.low <= entry && row.high >= entry;
      if (!fillable) continue;
      filledAt = row.timestamp_utc;
      status = "FILLED_OPEN";
    }
    const hitStop = direction === "LONG" ? row.low <= stop : row.high >= stop;
    const hitTarget = direction === "LONG" ? row.high >= target : row.low <= target;
    if (hitStop && hitTarget) {
      exit = { at: row.timestamp_utc, price: stop, reason: "AMBIGUOUS_INTRABAR_STOP_FIRST" };
      break;
    }
    if (hitStop) {
      exit = { at: row.timestamp_utc, price: stop, reason: "STOP_HIT" };
      break;
    }
    if (hitTarget) {
      exit = { at: row.timestamp_utc, price: target, reason: "TARGET_1_HIT" };
      break;
    }
  }
  if (filledAt && !exit) {
    const last = rows.at(-1);
    exit = last
      ? { at: last.timestamp_utc, price: last.close, reason: "MARK_TO_MARKET_AT_EXPIRY_OR_RTH_CLOSE" }
      : { at: signal.expires_at_utc, price: entry, reason: "NO_EXECUTION_ROWS_AFTER_FILL" };
  }
  if (exit) {
    status = exit.reason === "TARGET_1_HIT" ? "TARGET_HIT" : exit.reason === "STOP_HIT" || exit.reason.includes("STOP") ? "STOP_HIT" : "CLOSED_MARK_TO_MARKET";
    exitReason = exit.reason;
  }
  const r = filledAt ? rMultiple({ direction, entry, stop, exit: exit?.price ?? entry }) : 0;
  return {
    signal_id: signal.signal_id,
    strategy_definition_id: signal.strategy_definition_id,
    instrument: signal.instrument,
    direction,
    generated_at_utc: signal.generated_at_utc,
    expires_at_utc: signal.expires_at_utc,
    filled_at_utc: filledAt,
    closed_at_utc: exit?.at || null,
    entry_price: entry,
    stop_loss: stop,
    target_price: target,
    exit_price: exit?.price ?? null,
    status,
    exit_reason: exitReason,
    r_result: round(r, 4),
  };
}

function normalizeConfig(input = {}) {
  const instrument = String(input.instrument || "ZW").toUpperCase();
  const symbol = String(input.symbol || `${instrument}1!`).toUpperCase();
  return {
    strategyId: input.strategyId || input.strategy_id || ZW_RTH_VWAP_PULLBACK_STRATEGY_ID,
    instrument,
    symbol,
    decisionTimeframe: String(input.decisionTimeframe || input.decision_timeframe || "5").replace(/^M/i, ""),
    tickSize: finite(input.tickSize ?? input.tick_size, DEFAULT_TICK_SIZE),
    atrPeriod: Math.max(5, Math.trunc(finite(input.atrPeriod ?? input.atr_period, 14))),
    minStopDistance: finite(input.minStopDistance ?? input.min_stop_distance, 1.0),
    maxStopDistance: finite(input.maxStopDistance ?? input.max_stop_distance, 8.0),
    target1R: finite(input.target1R ?? input.target_1_r, 1.5),
    target2R: finite(input.target2R ?? input.target_2_r, 2.25),
    signalTtlMinutes: finite(input.signalTtlMinutes ?? input.signal_ttl_minutes, DEFAULT_SIGNAL_TTL_MINUTES),
    reportBlackoutMinutes: finite(input.reportBlackoutMinutes ?? input.report_blackout_minutes, 30),
    minMinutesBetweenSignals: finite(input.minMinutesBetweenSignals ?? input.min_minutes_between_signals, 30),
    cooldownMinutes: finite(input.cooldownMinutes ?? input.cooldown_minutes, 15),
    startDate: input.startDate || input.start_date || null,
    endDate: input.endDate || input.end_date || null,
  };
}

function summarizeReplay({ config, signals, trades, skippedDays }) {
  const filled = trades.filter((item) => item.filled_at_utc);
  const wins = filled.filter((item) => item.r_result > 0);
  const losses = filled.filter((item) => item.r_result < 0);
  const byDay = {};
  for (const trade of trades) {
    const day = chicagoDate(trade.generated_at_utc);
    byDay[day] ||= { signal_count: 0, filled_count: 0, total_r: 0, statuses: {} };
    byDay[day].signal_count += 1;
    if (trade.filled_at_utc) byDay[day].filled_count += 1;
    byDay[day].total_r = round(byDay[day].total_r + trade.r_result, 4);
    byDay[day].statuses[trade.status] = (byDay[day].statuses[trade.status] || 0) + 1;
  }
  return {
    schema_version: "us_grains_strategy_replay_result_v1",
    engine_version: US_GRAINS_STRATEGY_ENGINE_VERSION,
    strategy_id: config.strategyId,
    instrument: config.instrument,
    signal_count: signals.length,
    filled_trade_count: filled.length,
    win_count: wins.length,
    loss_count: losses.length,
    win_rate: filled.length ? round(wins.length / filled.length, 4) : 0,
    total_r: round(filled.reduce((sum, item) => sum + item.r_result, 0), 4),
    average_r: filled.length ? round(filled.reduce((sum, item) => sum + item.r_result, 0) / filled.length, 4) : 0,
    by_day: byDay,
    signals,
    trades,
    skipped_days: skippedDays,
  };
}

function groupRthRowsByChicagoDate(rows = []) {
  const groups = {};
  for (const row of normalizeRows(rows)) {
    if (!isRth(row.timestamp_utc)) continue;
    const day = chicagoDate(row.timestamp_utc);
    groups[day] ||= [];
    groups[day].push(row);
  }
  return Object.fromEntries(Object.entries(groups).map(([day, values]) => [day, values.sort(compareRows)]));
}

function previousRthDayRows(groups, tradingDate) {
  const previous = Object.keys(groups).filter((day) => day < tradingDate).sort().at(-1);
  return previous ? groups[previous] : [];
}

function dataQualityForDay(rows = []) {
  const valid = normalizeRows(rows);
  const volumeSum = valid.reduce((sum, row) => sum + Math.max(0, finite(row.volume, 0)), 0);
  const highs = valid.map((row) => row.high);
  const lows = valid.map((row) => row.low);
  return {
    row_count: valid.length,
    volume_sum: round(volumeSum, 4),
    volume_state: volumeSum > 0 ? "KNOWN" : "ZERO_VOLUME",
    range_points: highs.length ? round(Math.max(...highs) - Math.min(...lows), 4) : null,
  };
}

function buildGrainRelativeContext({ config, rows = [], contextRowsBySymbol = {} }) {
  const own = sessionReturn(rows);
  const zc = sessionReturn(contextRowsBySymbol["ZC1!:5"] || contextRowsBySymbol["ZC1!:1"] || []);
  const zw = sessionReturn(contextRowsBySymbol["ZW1!:5"] || contextRowsBySymbol["ZW1!:1"] || []);
  const peer = config.symbol === "ZW1!" ? zc : zw;
  return {
    schema_version: "us_grains_relative_context_v1",
    own_return_points: own,
    peer_return_points: peer,
    peer_available: Number.isFinite(peer),
  };
}

function grainContextAdjustment(context = {}, direction) {
  const reasons = [];
  let confidenceDelta = 0;
  let blocked = false;
  const own = finite(context.own_return_points);
  const peer = finite(context.peer_return_points);
  if (direction === "LONG") {
    if (own !== null && own > 0) {
      confidenceDelta += 0.04;
      reasons.push("OWN_SESSION_BIAS_LONG");
    }
    if (peer !== null && peer >= -0.5) {
      confidenceDelta += 0.03;
      reasons.push("GRAIN_COMPLEX_NOT_FIGHTING_LONG");
    }
    if (peer !== null && peer < -3) {
      confidenceDelta -= 0.08;
      reasons.push("GRAIN_COMPLEX_HEADWIND_LONG");
    }
  }
  if (direction === "SHORT") {
    if (own !== null && own < 0) {
      confidenceDelta += 0.04;
      reasons.push("OWN_SESSION_BIAS_SHORT");
    }
    if (peer !== null && peer <= 0.5) {
      confidenceDelta += 0.03;
      reasons.push("GRAIN_COMPLEX_NOT_FIGHTING_SHORT");
    }
    if (peer !== null && peer > 3) {
      confidenceDelta -= 0.08;
      reasons.push("GRAIN_COMPLEX_HEADWIND_SHORT");
    }
  }
  return {
    blocked,
    confidenceDelta,
    reasonCodes: reasons.length ? reasons : ["GRAIN_COMPLEX_CONTEXT_PARTIAL"],
    alignment: blocked ? "REJECT" : confidenceDelta >= 0.05 ? "ALIGNED" : confidenceDelta < 0 ? "PARTIAL" : "NEUTRAL",
  };
}

function highLowClose(rows = []) {
  const valid = normalizeRows(rows);
  if (!valid.length) return { high: null, low: null, close: null, range_points: null, row_count: 0 };
  const highs = valid.map((row) => row.high);
  const lows = valid.map((row) => row.low);
  return {
    high: round(Math.max(...highs), 4),
    low: round(Math.min(...lows), 4),
    close: round(valid.at(-1).close, 4),
    range_points: round(Math.max(...highs) - Math.min(...lows), 4),
    row_count: valid.length,
  };
}

function atrSeries(rows = [], { period = 14 } = {}) {
  const values = normalizeRows(rows);
  const output = [];
  for (let index = 0; index < values.length; index += 1) {
    const row = values[index];
    const previousClose = values[index - 1]?.close ?? row.close;
    const tr = Math.max(row.high - row.low, Math.abs(row.high - previousClose), Math.abs(row.low - previousClose));
    const slice = [...output.map((item) => item.tr).filter(Number.isFinite), tr].slice(-period);
    output.push({ tr, atr: slice.reduce((sum, item) => sum + item, 0) / slice.length });
  }
  return output.map((item) => item.atr);
}

function sessionVwap(rows = []) {
  let pv = 0;
  let volume = 0;
  let typicalSum = 0;
  let count = 0;
  for (const row of normalizeRows(rows)) {
    const typical = (row.high + row.low + row.close) / 3;
    const vol = finite(row.volume, 0);
    if (vol > 0) {
      pv += typical * vol;
      volume += vol;
    }
    typicalSum += typical;
    count += 1;
  }
  if (volume > 0) return pv / volume;
  return count ? typicalSum / count : null;
}

function isInReportBlackout(timestampUtc, events = [], minutes = 30) {
  const ts = Date.parse(timestampUtc);
  const windowMs = minutes * 60_000;
  return normalizeAgriEvents(events).some((event) => {
    const eventMs = Date.parse(event.event_timestamp_utc);
    if (!Number.isFinite(eventMs)) return false;
    if (!["HIGH", "CRITICAL"].includes(event.importance)) return false;
    return Math.abs(eventMs - ts) <= windowMs;
  });
}

function validRiskDistance(value, config) {
  return Number.isFinite(value) && value >= config.minStopDistance && value <= config.maxStopDistance;
}

function dedupeNearbyCandidates(candidates = [], minutes = 30) {
  const result = [];
  let lastByDirection = {};
  for (const candidate of candidates.sort((left, right) => Date.parse(left.generated_at_utc) - Date.parse(right.generated_at_utc))) {
    const direction = candidate.direction;
    const lastMs = lastByDirection[direction] || 0;
    const currentMs = Date.parse(candidate.generated_at_utc);
    if (currentMs - lastMs < minutes * 60_000) continue;
    result.push(candidate);
    lastByDirection[direction] = currentMs;
  }
  return result;
}

function rMultiple({ direction, entry, stop, exit }) {
  const risk = Math.abs(entry - stop);
  if (!risk) return 0;
  return direction === "LONG" ? (exit - entry) / risk : (entry - exit) / risk;
}

function sessionReturn(rows = []) {
  const valid = normalizeRows(rows).filter((row) => isRth(row.timestamp_utc));
  if (valid.length < 2) return null;
  return round(valid.at(-1).close - valid[0].open, 4);
}

function normalizeRowsBySymbol(source = {}) {
  return Object.fromEntries(Object.entries(source).map(([key, rows]) => [String(key).toUpperCase(), normalizeRows(rows)]));
}

function normalizeRows(rows = []) {
  return array(rows)
    .map((row) => ({
      timestamp_utc: iso(row.timestamp_utc || row.timestampUtc || row.time || row.timestamp),
      open: finite(row.open),
      high: finite(row.high),
      low: finite(row.low),
      close: finite(row.close),
      volume: finite(row.volume, 0),
    }))
    .filter((row) => row.timestamp_utc && row.open > 0 && row.high >= Math.max(row.open, row.close) && row.low <= Math.min(row.open, row.close))
    .sort(compareRows);
}

function normalizeAgriEvents(events = []) {
  return array(events)
    .map((event) => ({
      event_kind: String(event.event_kind || event.kind || "").toUpperCase(),
      title: event.title || null,
      event_timestamp_utc: iso(event.event_timestamp_utc || event.timestamp_utc || event.scheduled_at_utc),
      importance: String(event.importance || "MEDIUM").toUpperCase(),
    }))
    .filter((event) => event.event_timestamp_utc);
}

function chicagoDate(timestampUtc) {
  const parts = zonedParts(timestampUtc, CHICAGO_TZ);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function chicagoMinute(timestampUtc) {
  const parts = zonedParts(timestampUtc, CHICAGO_TZ);
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function chicagoRthEndMs(timestampUtc) {
  const parts = zonedParts(timestampUtc, CHICAGO_TZ);
  const utcDayMs = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 18, 20, 0);
  // August 2026 is CDT (UTC-5), so 13:20 Chicago = 18:20 UTC. For future
  // generalization this should use a timezone conversion library.
  return utcDayMs;
}

function isRth(timestampUtc) {
  const minute = chicagoMinute(timestampUtc);
  return minute >= RTH_START_MINUTE && minute <= RTH_END_MINUTE;
}

function zonedParts(timestampUtc, timeZone) {
  const key = timeZone;
  if (!dtfCache.has(key)) {
    dtfCache.set(key, new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }));
  }
  const parts = {};
  for (const item of dtfCache.get(key).formatToParts(new Date(timestampUtc))) {
    if (item.type !== "literal") parts[item.type] = item.value;
  }
  return parts;
}

function roundToTick(value, tickSize = DEFAULT_TICK_SIZE) {
  return round(Math.round(value / tickSize) * tickSize, 4);
}

function compareRows(left, right) {
  return Date.parse(left.timestamp_utc) - Date.parse(right.timestamp_utc);
}

function finite(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 4) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const factor = 10 ** digits;
  return Math.round(parsed * factor) / factor;
}

function iso(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}
