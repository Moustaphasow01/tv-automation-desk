import {
  canonicalSha256,
  normalizeStrategySignalV1,
} from "@tv-automation/desk-domain";
import { grainStrategyIdentity } from "./us-grains-strategy-catalog.js";
import {
  closeM5BarUtc,
  usGrainsSessionCloseUtc,
} from "./us-grains-causal-session.js";

const TICK = 0.25;

export function buildGrainSignalProposal(input = {}) {
  const plan = buildTradePlan(input);
  if (!plan) return null;
  return normalizeProposal({ ...input, ...plan });
}

function buildTradePlan({ config, direction, level, atr }) {
  const entry = tick(level);
  const distance = Math.max(
    config.minStopDistance,
    Math.min(config.maxStopDistance, atr * 0.9 || config.minStopDistance),
  );
  const stop = tick(direction === "LONG" ? entry - distance : entry + distance);
  if (
    Math.abs(entry - stop) < config.minStopDistance ||
    Math.abs(entry - stop) > config.maxStopDistance
  )
    return null;
  return {
    entry,
    stop,
    target1: target(entry, stop, direction, config.target1R),
    target2: target(entry, stop, direction, config.target2R),
  };
}

function normalizeProposal({
  config,
  frame,
  row,
  direction,
  family,
  entry,
  stop,
  target1,
  target2,
  suiteVersion,
}) {
  const timing = proposalTiming({ config, row });
  const identity = proposalIdentity({
    family,
    frame,
    direction,
    entry,
    stop,
    timing,
  });
  const context = { ...frame.context, valid_until_utc: timing.expiry };
  const raw = proposalEnvelope({
    identity,
    frame,
    row,
    direction,
    family,
    entry,
    stop,
    target1,
    target2,
    suiteVersion,
    context,
    timing,
  });
  const normalized = normalizeStrategySignalV1(raw);
  return normalized.ok ? normalized.signal : null;
}

function proposalEnvelope({
  identity,
  frame,
  row,
  direction,
  family,
  entry,
  stop,
  target1,
  target2,
  suiteVersion,
  context,
  timing,
}) {
  return {
    ...identity,
    instrument: frame.instrument,
    direction,
    proposed_size: 1,
    confidence: confidence({ context, family, direction }),
    timeframe: "M5",
    session: "cbot_grains_rth",
    source_data_cutoff_utc: timing.close,
    execution_mode_origin: "SHADOW",
    generated_at_utc: timing.close,
    expires_at_utc: timing.expiry,
    correlation_id: `corr_us_grains_${frame.trading_date}_${family}_${direction}_${timing.close}`,
    setup: {
      setup_kind: family,
      order_type: "LIMIT",
      entry_zone: { lower: entry - TICK, upper: entry + TICK },
      context,
    },
    predicates: [
      { code: "US_GRAINS_RTH_ONLY", value: true },
      { code: "CONTEXT_AVAILABLE", value: true },
    ],
    ...proposalEvidenceQuality({ row, family, context, suiteVersion, timing }),
    proposed_trade_plan: proposalTradePlan({
      frame,
      direction,
      entry,
      stop,
      target1,
      target2,
      timing,
    }),
    payload: {
      strategy_family: family,
      market_universe: "US_GRAINS_CBOT",
      trade_window_policy: "RTH_ONLY",
      causal_detection_version: "v2",
      bar_open_utc: row.timestamp_utc,
      bar_close_utc: timing.close,
    },
  };
}

function proposalTiming({ config, row }) {
  const close = closeM5BarUtc(row.timestamp_utc);
  return {
    close,
    expiry: expiresAt({ close, row, minutes: config.signalTtlMinutes }),
  };
}

function proposalIdentity({ family, frame, direction, entry, stop, timing }) {
  const identity = grainStrategyIdentity(family, frame.instrument);
  return {
    signal_id: uuid([
      family,
      frame.instrument,
      timing.close,
      direction,
      entry,
      stop,
    ]),
    ...identity,
  };
}

function proposalEvidenceQuality({
  row,
  family,
  context,
  suiteVersion,
  timing,
}) {
  return {
    evidence: [
      {
        type: "source_row",
        timestamp_utc: row.timestamp_utc,
        bar_open_utc: row.timestamp_utc,
        bar_close_utc: timing.close,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
      },
    ],
    reason_codes: ["US_GRAINS_RTH_ONLY", family, ...context.reason_codes],
    signal_quality: {
      strategy_suite_version: suiteVersion,
      causal_detection_version: "v2",
      context_bias: context.instrument_bias,
      source_data_cutoff_utc: timing.close,
    },
  };
}

function proposalTradePlan({
  frame,
  direction,
  entry,
  stop,
  target1,
  target2,
  timing,
}) {
  return {
    instrument: frame.instrument,
    direction,
    order_type: "LIMIT",
    entry_price: entry,
    stop_price: stop,
    targets: [
      { label: "TP1", price: target1 },
      { label: "TP2", price: target2 },
    ],
    source_data_cutoff_utc: timing.close,
  };
}

function expiresAt({ close, row, minutes }) {
  return new Date(
    Math.min(
      Date.parse(close) + minutes * 60_000,
      Date.parse(usGrainsSessionCloseUtc(row.timestamp_utc)),
    ),
  ).toISOString();
}
function confidence({ context, family, direction }) {
  let value = context.preferred_strategy_families.includes(family)
    ? 0.68
    : 0.58;
  if (context.allowed_sides.includes(direction)) value += 0.05;
  if (context.volatility_regime === "HIGH") value -= 0.06;
  return round(Math.max(0.1, Math.min(0.88, value)), 3);
}
function target(entry, stop, direction, multiple) {
  return tick(
    direction === "LONG"
      ? entry + Math.abs(entry - stop) * multiple
      : entry - Math.abs(entry - stop) * multiple,
  );
}
function tick(value) {
  return round(Math.round(value / TICK) * TICK);
}
function uuid(parts) {
  const hex = canonicalSha256(parts).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function round(value, digits = 4) {
  return Number.isFinite(Number(value))
    ? Math.round(Number(value) * 10 ** digits) / 10 ** digits
    : null;
}
