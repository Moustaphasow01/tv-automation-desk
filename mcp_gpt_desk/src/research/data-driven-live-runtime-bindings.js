import { canonicalSha256 } from "@tv-automation/desk-domain";
import { toParisIso } from "@tv-automation/desk-time";
import {
  DATA_DRIVEN_FAMILY_SET_DIVERSIFIED_V2,
  DATA_DRIVEN_FAMILY_SET_V1,
  dataDrivenAnchorForFamily,
  dataDrivenParameterCombination,
  findDataDrivenStrategyFamily,
  getDataDrivenStrategyFamilyIndex,
  normalizeDataDrivenFamilySet,
} from "./data-driven-strategy-family-catalog.js";

export const DATA_DRIVEN_LIVE_RUNTIME_BINDINGS_VERSION = "data_driven_live_runtime_bindings_v1";

export function buildDataDrivenLiveRuntimeBindings({
  version = {},
  dsl = {},
  instance = {},
  market = {},
  instrument = "MNQ",
} = {}) {
  const descriptor = dataDrivenDescriptor(version, dsl);
  if (!descriptor.ok) return descriptor;
  const contextRows = Array.isArray(market.contextRows) && market.contextRows.length
    ? market.contextRows
    : market.rows;
  const tradingDays = buildTradingDays(contextRows || []);
  const currentDate = market.rows?.[0]?.trading_date || market.tradingDate;
  const dayIndex = tradingDays.findIndex((day) => day.trading_date === currentDate);
  if (dayIndex < 0) return rejected(["DATA_DRIVEN_RUNTIME_DAY_NOT_FOUND"]);

  const familySpec = descriptor.family_spec;
  const parameters = mergeTemplateParameters(
    parameterCombination(descriptor.family_index_zero_based, descriptor.variant_index - 1),
    firstTemplate(dsl),
  );
  const setup = dataDrivenSetup({
    day: tradingDays[dayIndex],
    dayIndex,
    tradingDays,
    familySpec,
    parameters,
    familyVariantIndex: descriptor.variant_index - 1,
    instrument,
    instanceId: instance.strategy_instance_id,
  });
  if (!setup) return rejected(["DATA_DRIVEN_RUNTIME_ANCHOR_UNAVAILABLE"]);
  return {
    ok: true,
    status: "READY",
    descriptor,
    parameters,
    runtime_bindings: {
      valid_from_paris: setup.valid_from_paris,
      expires_at_paris: setup.expires_at_paris,
      cutoff_paris: toParisIso(Date.parse(market.cutoffUtc)),
      pack_id: market.dataset.dataset_id,
      pack_build_id: market.dataset.dataset_hash,
      plan_id: `runtime_plan_${instance.strategy_instance_id}_${setup.trading_date}`,
      session: "canonical_strategy_runtime",
      trading_date: setup.trading_date,
      setup_id_prefix: `runtime_${instance.strategy_instance_id}`,
      setups: [setup],
      metadata: {
        binding_version: DATA_DRIVEN_LIVE_RUNTIME_BINDINGS_VERSION,
        binding_hash: `sha256:${canonicalSha256({ descriptor, parameters, setup })}`,
      },
    },
  };
}

function dataDrivenDescriptor(version = {}, dsl = {}) {
  const metadata = { ...(version.metadata || {}), ...(dsl.metadata || {}) };
  const familyId = text(metadata.family_id);
  const variantIndex = integer(metadata.variant_index ?? version.metadata?.variant_index, null);
  const familySet = normalizeDataDrivenFamilySet(metadata.family_set || metadata.familySet || DATA_DRIVEN_FAMILY_SET_V1);
  const familySpec = findDataDrivenStrategyFamily(familyId);
  const explicitFamilyIndex = integer(metadata.family_index ?? metadata.familyIndex, null);
  const fallbackFamilyIndex = getDataDrivenStrategyFamilyIndex(
    familyId,
    familySet === DATA_DRIVEN_FAMILY_SET_DIVERSIFIED_V2 ? DATA_DRIVEN_FAMILY_SET_DIVERSIFIED_V2 : DATA_DRIVEN_FAMILY_SET_V1,
  ) + 1;
  const familyIndex = explicitFamilyIndex || fallbackFamilyIndex;
  if (!familySpec) return rejected(["DATA_DRIVEN_RUNTIME_FAMILY_UNKNOWN"]);
  if (!Number.isInteger(variantIndex) || variantIndex < 1) return rejected(["DATA_DRIVEN_RUNTIME_VARIANT_INDEX_MISSING"]);
  if (!Number.isInteger(familyIndex) || familyIndex < 1) return rejected(["DATA_DRIVEN_RUNTIME_FAMILY_INDEX_MISSING"]);
  return {
    ok: true,
    family_set: familySet,
    family_id: familyId,
    family_index: familyIndex,
    family_index_zero_based: familyIndex - 1,
    variant_index: variantIndex,
    anchor_kind: metadata.anchor_kind || familySpec.anchor_kind,
    family_spec: familySpec,
  };
}

function dataDrivenSetup({ day, dayIndex, tradingDays, familySpec, parameters, familyVariantIndex, instrument, instanceId }) {
  const anchor = anchorForFamily({ familySpec, parameters, day, tradingDays, dayIndex });
  if (!anchor) return null;
  const level = roundPrice(anchor.level + parameters.break_offset_points);
  const retest = roundPrice(anchor.retest ?? level);
  const direction = familySpec.direction;
  const tolerance = parameters.tolerance_points;
  const entry = entryZone({ direction, retest, tolerance, orderType: parameters.order_type });
  const entryReference = direction === "long" ? entry.upper : entry.lower;
  const stop = direction === "long"
    ? roundPrice(entryReference - parameters.risk_points)
    : roundPrice(entryReference + parameters.risk_points);
  const risk = Math.max(0.25, Math.abs(entryReference - stop));
  const target = direction === "long"
    ? roundPrice(entryReference + risk * parameters.target_rr)
    : roundPrice(entryReference - risk * parameters.target_rr);
  const invalidation = direction === "long"
    ? roundPrice(Math.min(day.low, stop) - Math.max(4, tolerance))
    : roundPrice(Math.max(day.high, stop) + Math.max(4, tolerance));
  return {
    setup_id: setupId({ familySpec, familyVariantIndex, dayIndex, day, instanceId }),
    template_id: `${familySpec.family_id}_${familySpec.direction}`,
    instrument,
    direction,
    rank: 1,
    trading_date: day.trading_date,
    valid_from_paris: day.first_time,
    expires_at_paris: day.last_time,
    break_level: level,
    retest_level: retest,
    entry_zone: entry,
    stop_loss: stop,
    take_profit_1: target,
    invalidation_level: invalidation,
    tolerance_points: tolerance,
    max_bars: parameters.max_bars,
    order_type: parameters.order_type,
    require_rejection_confirmation: parameters.require_rejection_confirmation,
    rr_minimum: Math.min(2, parameters.target_rr),
    metadata: {
      source: DATA_DRIVEN_LIVE_RUNTIME_BINDINGS_VERSION,
      family_id: familySpec.family_id,
      anchor_kind: familySpec.anchor_kind,
      anchor_source: anchor.source,
    },
  };
}

function anchorForFamily({ familySpec, parameters, day, tradingDays, dayIndex }) {
  return dataDrivenAnchorForFamily({ familySpec, parameters, day, tradingDays, dayIndex });
}

function buildTradingDays(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = row.trading_date || row.time?.slice(0, 10);
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  const days = [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([trading_date, dayRows]) => summarizeDay(trading_date, dayRows));
  const ranges = days.map((day) => day.range).sort((left, right) => left - right);
  const highs = days.map((day) => day.high).sort((left, right) => left - right);
  const lows = days.map((day) => day.low).sort((left, right) => left - right);
  for (let index = 0; index < days.length; index += 1) {
    days[index].previous = days[index - 1] || null;
    days[index].dataset_stats = {
      range_p35: percentile(ranges, 0.35) || 0,
      range_p35_high: percentile(highs, 0.65) || days[index].high,
      range_p35_low: percentile(lows, 0.35) || days[index].low,
    };
  }
  return days;
}

function summarizeDay(trading_date, rows) {
  const sorted = [...rows].sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
  const high = Math.max(...sorted.map((row) => row.high));
  const low = Math.min(...sorted.map((row) => row.low));
  const typicalVolume = sorted.reduce((sum, row) => sum + Math.max(1, row.volume || 1), 0);
  const vwap = sorted.reduce((sum, row) => sum + ((row.high + row.low + row.close) / 3) * Math.max(1, row.volume || 1), 0) / typicalVolume;
  return {
    trading_date,
    rows: sorted,
    first_time: sorted[0]?.time,
    last_time: sorted.at(-1)?.time,
    open: sorted[0]?.open,
    high,
    low,
    close: sorted.at(-1)?.close,
    range: high - low,
    vwap: roundPrice(vwap),
    opening: (bars) => rangeSummary(sorted.slice(0, Math.max(1, bars))),
    asia: rangeSummary(sessionRows(sorted, "09:15", "14:45")),
    nyOpening: rangeSummary(sessionRows(sorted, "15:30", "17:00")),
  };
}

function parameterCombination(familyIndex, index) {
  return dataDrivenParameterCombination(familyIndex, index);
}

function mergeTemplateParameters(parameters, template) {
  return {
    ...parameters,
    tolerance_points: number(template.tolerance_points, parameters.tolerance_points),
    max_bars: number(template.max_bars, parameters.max_bars),
    order_type: String(template.order_type || parameters.order_type).toUpperCase(),
    require_rejection_confirmation: template.require_rejection_confirmation ?? parameters.require_rejection_confirmation,
  };
}

function entryZone({ direction, retest, tolerance, orderType }) {
  const half = orderType === "MARKET" ? Math.max(0.25, tolerance / 4) : Math.max(0.25, tolerance);
  if (direction === "long") return { lower: roundPrice(retest - half), upper: roundPrice(retest + Math.max(0.25, half / 2)) };
  return { lower: roundPrice(retest - Math.max(0.25, half / 2)), upper: roundPrice(retest + half) };
}

function setupId({ familySpec, familyVariantIndex, dayIndex, day, instanceId }) {
  return [
    "runtime",
    familySpec.family_id,
    `v${String(familyVariantIndex + 1).padStart(3, "0")}`,
    day.trading_date.replaceAll("-", ""),
    `d${String(dayIndex + 1).padStart(3, "0")}`,
    String(instanceId || "instance").slice(0, 8),
  ].join("_");
}

function rangeSummary(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return { high: null, low: null, open: null, close: null };
  return {
    high: Math.max(...rows.map((row) => row.high)),
    low: Math.min(...rows.map((row) => row.low)),
    open: rows[0]?.open ?? null,
    close: rows.at(-1)?.close ?? null,
  };
}

function sessionRows(rows, fromHm, toHm) {
  return rows.filter((row) => {
    const hm = String(row.time || "").slice(11, 16);
    return hm >= fromHm && hm <= toHm;
  });
}

function firstTemplate(dsl) { return Array.isArray(dsl?.setup_templates) ? dsl.setup_templates[0] || {} : {}; }
function percentile(values, ratio) { if (!values.length) return null; const index = Math.min(values.length - 1, Math.max(0, Math.floor(values.length * ratio))); return values[index]; }
function roundPrice(value) { return Math.round(Number(value) * 4) / 4; }
function integer(value, fallback = 0) { const parsed = Number(value); return Number.isInteger(parsed) ? parsed : fallback; }
function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function text(value) { return String(value ?? "").trim(); }
function rejected(reasons) { return { ok: false, status: "REJECTED", reasons }; }
