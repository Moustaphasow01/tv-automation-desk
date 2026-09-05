import { canonicalSha256, normalizeStrategySignalV1 } from "@tv-automation/desk-domain";
import {
  chicagoMinute,
  chicagoRthEndMs,
  grainFinite as finite,
  grainRound as round,
  grainRMultiple as rMultiple,
  grainUnique as unique,
  isGrainStrategyRth as isRth,
  normalizeGrainStrategyEvents as normalizeAgriEvents,
  normalizeGrainStrategyRows as normalizeRows,
  normalizeGrainStrategyRowsBySymbol as normalizeRowsBySymbol,
} from "./us-grains-strategy-input.js";
import { summarizeGrainStrategyReplay } from "./us-grains-strategy-replay-summary.js";
import {
  atrSeries,
  buildGrainRelativeContext,
  dataQualityForDay,
  dedupeNearbyCandidates,
  grainContextAdjustment,
  groupRthRowsByChicagoDate,
  highLowClose,
  isInReportBlackout,
  previousRthDayRows,
  roundToTick,
  sessionVwap,
  validRiskDistance,
} from "./us-grains-strategy-technical.js";

export const US_GRAINS_STRATEGY_ENGINE_VERSION = "us_grains_strategy_engine_v1";
export const ZW_RTH_VWAP_PULLBACK_STRATEGY_ID = "us_grains_zw_rth_vwap_pullback_v1";

const RTH_START_MINUTE = 8 * 60 + 30;
const OPENING_RANGE_END_MINUTE = 9 * 60;
const LAST_NEW_SIGNAL_MINUTE = 12 * 60 + 45;
const DEFAULT_TICK_SIZE = 0.25;
const DEFAULT_SIGNAL_TTL_MINUTES = 45;

export function replayUsGrainsStrategyV1(input = {}) {
  const config = normalizeConfig(input);
  const rowsBySymbol = normalizeRowsBySymbol(
    input.rowsBySymbol || input.series_by_symbol || {},
  );
  const decisionRows =
    rowsBySymbol[`${config.symbol}:${config.decisionTimeframe}`] || [];
  const executionRows =
    rowsBySymbol[`${config.symbol}:1`] ||
    rowsBySymbol[`${config.symbol}:M1`] ||
    [];
  const contextRowsBySymbol = normalizeRowsBySymbol(
    input.contextRowsBySymbol || input.context_series_by_symbol || {},
  );
  const events = normalizeAgriEvents(
    input.agriEvents || input.agri_events || [],
  );
  const tradingDays = groupRthRowsByChicagoDate(decisionRows);
  const executionByDay = groupRthRowsByChicagoDate(executionRows);
  const contextByKeyDay = Object.fromEntries(
    Object.entries(contextRowsBySymbol).map(([key, rows]) => [
      key,
      groupRthRowsByChicagoDate(rows),
    ]),
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
      Object.entries(contextByKeyDay).map(([key, groups]) => [
        key,
        groups[tradingDate] || [],
      ]),
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
      nextAvailableAtMs =
        Date.parse(
          outcome.closed_at_utc ||
            outcome.expires_at_utc ||
            candidate.expires_at_utc,
        ) +
        config.cooldownMinutes * 60_000;
    }
  }

  return summarizeGrainStrategyReplay({ config, signals, trades, skippedDays });
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
  const openingRows = rthRows.filter(
    (row) =>
      chicagoMinute(row.timestamp_utc) >= RTH_START_MINUTE &&
      chicagoMinute(row.timestamp_utc) < OPENING_RANGE_END_MINUTE,
  );
  const previousLevels = highLowClose(previousDayRows);
  const openingRange = highLowClose(openingRows);
  const rowQuality = dataQualityForDay(rthRows);
  const hasOpeningRange =
    openingRows.length >= 4 &&
    openingRange.high !== null &&
    openingRange.low !== null;
  const hasPreviousDay =
    previousLevels.high !== null && previousLevels.low !== null;
  const context = buildGrainRelativeContext({
    config,
    rows: rthRows,
    contextRowsBySymbol,
  });
  const dayEvents = events
    .filter(
      (event) =>
        String(event.event_timestamp_utc || "").slice(0, 10) === tradingDate,
    )
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
    if (minute < OPENING_RANGE_END_MINUTE || minute > LAST_NEW_SIGNAL_MINUTE)
      continue;
    if (
      isInReportBlackout(
        row.timestamp_utc,
        events,
        config.reportBlackoutMinutes,
      )
    )
      continue;
    const history = rthRows.slice(0, index + 1);
    const atr = atrSeries(history, { period: config.atrPeriod }).at(-1);
    if (!Number.isFinite(atr) || atr <= 0) continue;
    const vwap = sessionVwap(history);
    if (!Number.isFinite(vwap)) continue;
    const close = row.close;
    const previousCloses = history.slice(-2);
    const longBreakout =
      previousCloses.length === 2 &&
      previousCloses.every(
        (item) => item.close > dayPlan.opening_range.high + config.tickSize,
      ) &&
      close > vwap;
    const shortBreakout =
      previousCloses.length === 2 &&
      previousCloses.every(
        (item) => item.close < dayPlan.opening_range.low - config.tickSize,
      ) &&
      close < vwap;
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

function candidateFromPullback({
  config,
  dayPlan,
  row,
  history,
  atr,
  vwap,
  direction,
  breakoutAtUtc,
}) {
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
    {
      code: "OPENING_RANGE_COMPLETE",
      value: true,
      range: dayPlan.opening_range,
    },
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
    const pulledBack =
      Math.min(...recent3.map((item) => item.low)) <= zone + tolerance;
    const recovered =
      row.close > row.open &&
      row.close >= zone + config.tickSize &&
      row.close > vwap;
    const notChasing = row.close - zone <= Math.max(atr * 1.25, 2.5);
    const priorResistanceTooClose =
      dayPlan.prior_day.high > zone &&
      dayPlan.prior_day.high - zone < Math.max(atr * 0.8, 1) &&
      row.close < dayPlan.prior_day.high;
    if (!pulledBack || !recovered || !notChasing || priorResistanceTooClose)
      return null;
    entry = roundToTick(zone, config.tickSize);
    const swingLow = Math.min(...recent5.map((item) => item.low));
    stop = roundToTick(
      Math.min(
        swingLow - config.tickSize,
        entry - Math.max(atr * 0.65, config.minStopDistance),
      ),
      config.tickSize,
    );
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
    const pulledBack =
      Math.max(...recent3.map((item) => item.high)) >= zone - tolerance;
    const rejected =
      row.close < row.open &&
      row.close <= zone - config.tickSize &&
      row.close < vwap;
    const notChasing = zone - row.close <= Math.max(atr * 1.25, 2.5);
    const priorSupportTooClose =
      dayPlan.prior_day.low < zone &&
      zone - dayPlan.prior_day.low < Math.max(atr * 0.8, 1) &&
      row.close > dayPlan.prior_day.low;
    if (!pulledBack || !rejected || !notChasing || priorSupportTooClose)
      return null;
    entry = roundToTick(zone, config.tickSize);
    const swingHigh = Math.max(...recent5.map((item) => item.high));
    stop = roundToTick(
      Math.max(
        swingHigh + config.tickSize,
        entry + Math.max(atr * 0.65, config.minStopDistance),
      ),
      config.tickSize,
    );
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
  confidence = Math.max(
    0.1,
    Math.min(0.85, confidence + contextAdjustment.confidenceDelta),
  );
  reasonCodes.push(...contextAdjustment.reasonCodes);
  if (contextAdjustment.blocked) return null;
  const generatedAtUtc = row.timestamp_utc;
  const expiresAtUtc = new Date(
    Math.min(
      Date.parse(generatedAtUtc) + config.signalTtlMinutes * 60_000,
      chicagoRthEndMs(generatedAtUtc),
    ),
  ).toISOString();
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
      entry_zone: {
        lower: round(entry - config.tickSize, 4),
        upper: round(entry + config.tickSize, 4),
      },
      prior_day: dayPlan.prior_day,
      opening_range: dayPlan.opening_range,
      vwap: round(sessionVwap(history), 4),
      atr_m5: round(atr, 4),
    },
    predicates,
    evidence: [
      {
        type: "technical_plan",
        ref: `us-grains-day://${dayPlan.trading_date}`,
        payload: dayPlan,
      },
      {
        type: "source_row",
        timestamp_utc: generatedAtUtc,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
      },
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

export function simulateLimitSignalOutcome({
  signal,
  executionRows = [],
  config = normalizeConfig(),
} = {}) {
  const direction = String(signal.direction || "").toUpperCase();
  const plan = signal.proposed_trade_plan || {};
  const entry = finite(
    plan.entry?.calculation_price ??
      plan.entry?.price ??
      plan.entry_price ??
      plan.limit_price,
  );
  const stop = finite(plan.stop?.price ?? plan.stop_price ?? plan.stop_loss);
  const target = finite((Array.isArray(plan.targets) ? plan.targets : [])[0]?.price);
  const generatedMs = Date.parse(signal.generated_at_utc);
  const expiryMs = Date.parse(signal.expires_at_utc);
  const rthEndMs = chicagoRthEndMs(signal.generated_at_utc);
  const deadlineMs = Math.min(expiryMs, rthEndMs);
  const rows = normalizeRows(executionRows).filter((row) => {
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
    const hitTarget =
      direction === "LONG" ? row.high >= target : row.low <= target;
    if (hitStop && hitTarget) {
      exit = {
        at: row.timestamp_utc,
        price: stop,
        reason: "AMBIGUOUS_INTRABAR_STOP_FIRST",
      };
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
      ? {
          at: last.timestamp_utc,
          price: last.close,
          reason: "MARK_TO_MARKET_AT_EXPIRY_OR_RTH_CLOSE",
        }
      : {
          at: signal.expires_at_utc,
          price: entry,
          reason: "NO_EXECUTION_ROWS_AFTER_FILL",
        };
  }
  if (exit) {
    status =
      exit.reason === "TARGET_1_HIT"
        ? "TARGET_HIT"
        : exit.reason === "STOP_HIT" || exit.reason.includes("STOP")
          ? "STOP_HIT"
          : "CLOSED_MARK_TO_MARKET";
    exitReason = exit.reason;
  }
  const r = filledAt
    ? rMultiple({ direction, entry, stop, exit: exit?.price ?? entry })
    : 0;
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
    strategyId:
      input.strategyId || input.strategy_id || ZW_RTH_VWAP_PULLBACK_STRATEGY_ID,
    instrument,
    symbol,
    decisionTimeframe: String(
      input.decisionTimeframe || input.decision_timeframe || "5",
    ).replace(/^M/i, ""),
    tickSize: finite(input.tickSize ?? input.tick_size, DEFAULT_TICK_SIZE),
    atrPeriod: Math.max(
      5,
      Math.trunc(finite(input.atrPeriod ?? input.atr_period, 14)),
    ),
    minStopDistance: finite(
      input.minStopDistance ?? input.min_stop_distance,
      1.0,
    ),
    maxStopDistance: finite(
      input.maxStopDistance ?? input.max_stop_distance,
      8.0,
    ),
    target1R: finite(input.target1R ?? input.target_1_r, 1.5),
    target2R: finite(input.target2R ?? input.target_2_r, 2.25),
    signalTtlMinutes: finite(
      input.signalTtlMinutes ?? input.signal_ttl_minutes,
      DEFAULT_SIGNAL_TTL_MINUTES,
    ),
    reportBlackoutMinutes: finite(
      input.reportBlackoutMinutes ?? input.report_blackout_minutes,
      30,
    ),
    minMinutesBetweenSignals: finite(
      input.minMinutesBetweenSignals ?? input.min_minutes_between_signals,
      30,
    ),
    cooldownMinutes: finite(
      input.cooldownMinutes ?? input.cooldown_minutes,
      15,
    ),
    startDate: input.startDate || input.start_date || null,
    endDate: input.endDate || input.end_date || null,
  };
}
