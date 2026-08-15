import { canonicalSha256 } from "./execution-scope.js";

export const TRADE_PLAN_SCHEMA_VERSION_V1 = "strategy_signal_trade_plan_v1";
export const TRADE_PLAN_ECONOMICS_SCHEMA_VERSION_V1 = "trade_plan_economics_v1";
export const DOMAIN_AVAILABILITY_STATES_V1 = Object.freeze([
  "KNOWN",
  "UNKNOWN",
  "UNAVAILABLE",
  "NOT_APPLICABLE",
  "NOT_IMPLEMENTED",
  "STALE",
  "PARTIAL",
]);
export const TRADE_PLAN_ORDER_TYPES_V1 = Object.freeze(["MARKET", "LIMIT", "STOP_MARKET", "STOP_LIMIT"]);
export const TRADE_PLAN_TIME_IN_FORCE_V1 = Object.freeze(["DAY", "GTC", "GTD", "IOC", "FOK"]);

export const FUTURES_INSTRUMENT_SPECS_V1 = Object.freeze({
  MNQ: Object.freeze({ instrument: "MNQ", tick_size: 0.25, tick_value: 0.5, point_value: 2, currency: "USD", source: "CME Micro E-mini Nasdaq-100" }),
  MES: Object.freeze({ instrument: "MES", tick_size: 0.25, tick_value: 1.25, point_value: 5, currency: "USD", source: "CME Micro E-mini S&P 500" }),
  NQ: Object.freeze({ instrument: "NQ", tick_size: 0.25, tick_value: 5, point_value: 20, currency: "USD", source: "CME E-mini Nasdaq-100" }),
  ES: Object.freeze({ instrument: "ES", tick_size: 0.25, tick_value: 12.5, point_value: 50, currency: "USD", source: "CME E-mini S&P 500" }),
});

export function instrumentContractSpecV1(instrument) {
  const canonical = canonicalFuturesInstrumentV1(instrument);
  return canonical ? FUTURES_INSTRUMENT_SPECS_V1[canonical] || null : null;
}

export function canonicalFuturesInstrumentV1(value) {
  const textValue = upper(value).replace(/^CME_MINI:/, "").replace(/^CME:/, "").replace(/^CBOT:/, "").replace(/^NYMEX:/, "");
  if (!textValue) return "";
  if (textValue.includes("MNQ")) return "MNQ";
  if (textValue.includes("MES")) return "MES";
  if (textValue.includes("NQ")) return "NQ";
  if (textValue.includes("ES")) return "ES";
  return textValue.replace(/[^A-Z0-9]/g, "");
}

export function normalizeProposedTradePlanV1(input = {}) {
  const source = tradePlanSource(input);
  const issues = [];
  const instrument = canonicalFuturesInstrumentV1(firstDefined(input.instrument, source.instrument));
  const spec = instrumentContractSpecV1(instrument);
  const direction = normalizeDirection(firstDefined(input.direction, source.direction), issues);
  const entry = normalizeEntry(source);
  const stop = normalizePriceNode(firstDefined(source.stop_price, source.stopPrice, source.stop, source.protective_stop, source.protectiveStop), "stop");
  const invalidation = normalizeInvalidation(source);
  const rawTargets = array(firstDefined(source.targets, source.target_prices, source.targetPrices));
  const targets = rawTargets.length ? rawTargets.map((item, index) => normalizeTarget(item, index)) : normalizeImplicitTarget(source);
  const orderType = normalizeOrderType(firstDefined(source.order_type, source.orderType, source.type), issues);
  const timeInForce = normalizeTimeInForce(firstDefined(source.time_in_force, source.timeInForce, source.tif), issues);
  const units = unitsForSpec(spec);

  if (!instrument) issues.push(issue("INSTRUMENT_UNAVAILABLE", "instrument"));
  if (!spec) issues.push(issue("INSTRUMENT_SPEC_UNAVAILABLE", "instrument", { instrument }));
  if (entry.availability !== "KNOWN") issues.push(issue("ENTRY_UNAVAILABLE", "entry"));
  if (stop.availability !== "KNOWN") issues.push(issue("STOP_UNAVAILABLE", "stop"));
  if (!targets.length) issues.push(issue("TARGETS_UNAVAILABLE", "targets"));

  const planBase = {
    schema_version: TRADE_PLAN_SCHEMA_VERSION_V1,
    availability: availabilityForIssues(issues),
    instrument,
    instrument_contract: spec ? {
      instrument: spec.instrument,
      source: spec.source,
    } : unavailableNode("instrument_contract", "INSTRUMENT_SPEC_UNAVAILABLE"),
    direction,
    order_type: orderType,
    entry,
    stop,
    targets,
    time_in_force: timeInForce,
    invalidation,
    units,
    source: normalizeSource(source),
    reason_codes: issues.map((item) => item.code),
  };
  const economics = computeTradePlanEconomicsV1({ ...planBase, instrument, direction });
  const proposedTradePlan = {
    ...planBase,
    economics,
    plan_hash: hash({ ...planBase, economics_hash: economics.economics_hash }),
  };
  return {
    ok: proposedTradePlan.availability === "KNOWN",
    issues,
    proposed_trade_plan: proposedTradePlan,
    economics,
  };
}

export function computeTradePlanEconomicsV1(input = {}) {
  const source = tradePlanSource(input);
  const instrument = canonicalFuturesInstrumentV1(firstDefined(input.instrument, source.instrument));
  const spec = instrumentContractSpecV1(instrument);
  const direction = normalizeDirection(firstDefined(input.direction, source.direction), []);
  const entry = record(input.entry)?.availability ? input.entry : normalizeEntry(source);
  const stop = record(input.stop)?.availability ? input.stop : normalizePriceNode(firstDefined(source.stop_price, source.stopPrice, source.stop, source.protective_stop, source.protectiveStop), "stop");
  const units = record(input.units)?.availability ? input.units : unitsForSpec(spec);
  const entryPrice = finite(firstDefined(entry.price, entry.calculation_price, input.entry_price, source.entry_price, source.entryPrice));
  const stopPrice = finite(firstDefined(stop.price, input.stop_price, source.stop_price, source.stopPrice));
  const stopDistancePoints = entryPrice !== null && stopPrice !== null ? round(Math.abs(entryPrice - stopPrice)) : null;
  const stopDistanceTicks = stopDistancePoints !== null && spec?.tick_size ? round(stopDistancePoints / spec.tick_size) : null;
  const riskPerContract = stopDistanceTicks !== null && spec?.tick_value ? roundCurrency(stopDistanceTicks * spec.tick_value) : null;
  const targetRows = array(input.targets?.length ? input.targets : firstDefined(source.targets, [])).map((target, index) => {
    const row = target?.availability ? target : normalizeTarget(target, index);
    const price = finite(row.price);
    const signedDistance = targetDistancePoints({ direction, entryPrice, targetPrice: price });
    const targetDistanceTicks = signedDistance !== null && spec?.tick_size ? round(Math.abs(signedDistance) / spec.tick_size) : null;
    const rewardRisk = signedDistance !== null && stopDistancePoints && signedDistance > 0 ? round(signedDistance / stopDistancePoints) : null;
    return {
      label: text(row.label || `T${index + 1}`),
      price,
      distance_points: signedDistance === null ? null : round(signedDistance),
      distance_ticks: targetDistanceTicks,
      reward_risk: finite(firstDefined(row.reward_risk, row.rewardRisk, row.expected_r, row.expectedR)) ?? rewardRisk,
      expected_r: finite(firstDefined(row.expected_r, row.expectedR)) ?? rewardRisk,
      availability: price === null || rewardRisk === null ? "PARTIAL" : "KNOWN",
    };
  });
  const reasonCodes = [
    !instrument ? "INSTRUMENT_UNAVAILABLE" : "",
    !spec ? "INSTRUMENT_SPEC_UNAVAILABLE" : "",
    entryPrice === null ? "ENTRY_UNAVAILABLE" : "",
    stopPrice === null ? "STOP_UNAVAILABLE" : "",
    !targetRows.length ? "TARGETS_UNAVAILABLE" : "",
    stopDistancePoints !== null && stopDistancePoints <= 0 ? "STOP_DISTANCE_INVALID" : "",
    stopDirectionInvalid({ direction, entryPrice, stopPrice }) ? "STOP_SIDE_INVALID" : "",
  ].filter(Boolean);
  const base = {
    schema_version: TRADE_PLAN_ECONOMICS_SCHEMA_VERSION_V1,
    availability: availabilityForReasonCodes(reasonCodes),
    instrument,
    direction,
    units,
    entry_price: entryPrice,
    stop_price: stopPrice,
    stop_distance_points: stopDistancePoints,
    stop_distance_ticks: stopDistanceTicks,
    tick_size: spec?.tick_size ?? null,
    tick_value: spec?.tick_value ?? null,
    currency: spec?.currency ?? "UNAVAILABLE",
    risk_per_contract: riskPerContract,
    targets: targetRows,
    reason_codes: reasonCodes,
  };
  return { ...base, economics_hash: hash(base) };
}

function tradePlanSource(input) {
  const nested = firstRecord(input.proposed_trade_plan, input.proposedTradePlan, input.trade_plan, input.tradePlan, input.protection, input.payload?.proposed_trade_plan, input.payload?.proposedTradePlan);
  return { ...record(input), ...nested };
}

function normalizeEntry(source) {
  const price = finite(firstDefined(source.entry_price, source.entryPrice, source.entry, source.limit_price, source.limitPrice));
  const zone = normalizeZone(firstDefined(source.entry_zone, source.entryZone), source);
  if (price !== null) return { availability: "KNOWN", type: "PRICE", price, low: zone.low, high: zone.high, calculation_price: price };
  if (zone.low !== null && zone.high !== null) return { availability: "KNOWN", type: "ZONE", price: round((zone.low + zone.high) / 2), low: zone.low, high: zone.high, calculation_price: round((zone.low + zone.high) / 2) };
  return unavailableNode("entry", "ENTRY_UNAVAILABLE");
}

function normalizeZone(value, source) {
  if (Array.isArray(value) && value.length >= 2) return orderedZone(value[0], value[1]);
  const item = record(value);
  if (item) return orderedZone(firstDefined(item.low, item.min, item.from, item.lower), firstDefined(item.high, item.max, item.to, item.upper));
  return orderedZone(firstDefined(source.entry_zone_low, source.entryZoneLow, source.zone_low), firstDefined(source.entry_zone_high, source.entryZoneHigh, source.zone_high));
}

function orderedZone(left, right) {
  const low = finite(left);
  const high = finite(right);
  if (low === null || high === null) return { low: null, high: null };
  return { low: Math.min(low, high), high: Math.max(low, high) };
}

function normalizePriceNode(value, label) {
  const source = record(value);
  const price = source ? finite(firstDefined(source.price, source.value)) : finite(value);
  return price === null ? unavailableNode(label, `${upper(label)}_UNAVAILABLE`) : { availability: "KNOWN", price };
}

function normalizeTarget(value, index) {
  const source = record(value) || { price: value };
  const price = finite(firstDefined(source.price, source.target_price, source.targetPrice, source.value));
  return {
    availability: price === null ? "UNAVAILABLE" : "KNOWN",
    label: text(firstDefined(source.label, source.name, `T${index + 1}`)),
    price,
    expected_r: finite(firstDefined(source.expected_r, source.expectedR)),
    reward_risk: finite(firstDefined(source.reward_risk, source.rewardRisk)),
  };
}

function normalizeImplicitTarget(source) {
  const price = finite(firstDefined(source.target_price, source.targetPrice, source.profit_target, source.profitTarget));
  return price === null ? [] : [normalizeTarget({ label: "T1", price, expected_r: source.expected_r, reward_risk: source.reward_risk }, 0)];
}

function normalizeInvalidation(source) {
  const invalidation = record(firstDefined(source.invalidation, source.invalidation_condition, source.invalidationCondition)) || {};
  const invalidationPrice = finite(firstDefined(source.invalidation_price, source.invalidationPrice, invalidation.price));
  const condition = text(firstDefined(invalidation.condition, source.invalidation_condition, source.invalidationCondition));
  const reasonCode = text(firstDefined(invalidation.reason_code, invalidation.reasonCode, source.invalidation_reason_code, source.invalidationReasonCode));
  if (invalidationPrice === null && !condition && !reasonCode) return { availability: "UNAVAILABLE", reason_code: "INVALIDATION_UNAVAILABLE" };
  return {
    availability: "KNOWN",
    price: invalidationPrice,
    condition: condition || null,
    reason_code: reasonCode || null,
  };
}

function normalizeSource(source) {
  return {
    kind: text(firstDefined(source.source_kind, source.sourceKind, source.source, "STRATEGY")),
    provenance: record(source.provenance) || null,
    source_data_cutoff_utc: iso(firstDefined(source.source_data_cutoff_utc, source.sourceDataCutoff, source.cutoff_at_utc, source.cutoffAtUtc)),
  };
}

function unitsForSpec(spec) {
  if (!spec) return unavailableNode("units", "INSTRUMENT_SPEC_UNAVAILABLE");
  return {
    availability: "KNOWN",
    price: "INDEX_POINTS",
    points: "INDEX_POINTS",
    ticks: "TICKS",
    tick_size: spec.tick_size,
    tick_value: spec.tick_value,
    point_value: spec.point_value,
    currency: spec.currency,
  };
}

function targetDistancePoints({ direction, entryPrice, targetPrice }) {
  if (entryPrice === null || targetPrice === null) return null;
  if (direction === "SHORT") return round(entryPrice - targetPrice);
  if (direction === "LONG") return round(targetPrice - entryPrice);
  return null;
}

function stopDirectionInvalid({ direction, entryPrice, stopPrice }) {
  if (entryPrice === null || stopPrice === null) return false;
  if (direction === "LONG") return stopPrice >= entryPrice;
  if (direction === "SHORT") return stopPrice <= entryPrice;
  return false;
}

function normalizeDirection(value, issues) {
  const direction = upper(value);
  if (["LONG", "SHORT", "FLAT"].includes(direction)) return direction;
  issues.push(issue("TRADE_PLAN_DIRECTION_INVALID", "direction", { value }));
  return direction || null;
}

function normalizeOrderType(value, issues) {
  const orderType = upper(value || "LIMIT");
  if (TRADE_PLAN_ORDER_TYPES_V1.includes(orderType)) return orderType;
  issues.push(issue("TRADE_PLAN_ORDER_TYPE_INVALID", "order_type", { value }));
  return orderType;
}

function normalizeTimeInForce(value, issues) {
  const tif = upper(value || "DAY");
  if (TRADE_PLAN_TIME_IN_FORCE_V1.includes(tif)) return tif;
  issues.push(issue("TRADE_PLAN_TIME_IN_FORCE_INVALID", "time_in_force", { value }));
  return tif;
}

function availabilityForIssues(issues) {
  if (!issues.length) return "KNOWN";
  return issues.some((item) => item.code === "INSTRUMENT_UNAVAILABLE" || item.code === "ENTRY_UNAVAILABLE" || item.code === "STOP_UNAVAILABLE")
    ? "UNAVAILABLE"
    : "PARTIAL";
}

function availabilityForReasonCodes(reasonCodes) {
  if (!reasonCodes.length) return "KNOWN";
  return reasonCodes.includes("INSTRUMENT_UNAVAILABLE") || reasonCodes.includes("ENTRY_UNAVAILABLE") || reasonCodes.includes("STOP_UNAVAILABLE")
    ? "UNAVAILABLE"
    : "PARTIAL";
}

function unavailableNode(kind, reasonCode) {
  return { availability: "UNAVAILABLE", reason_code: reasonCode, kind };
}

function issue(code, path, extra = {}) {
  return { code, path, ...extra };
}

function hash(value) { return `sha256:${canonicalSha256(value)}`; }
function firstRecord(...values) { return values.map(record).find(Boolean) || {}; }
function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
function array(value) { return Array.isArray(value) ? value : []; }
function firstDefined(...values) { return values.find((value) => value !== undefined && value !== null && value !== "") ?? null; }
function finite(value) { if (value === null || value === undefined || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).toUpperCase(); }
function iso(value) { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }
function round(value) { return Math.round(Number(value) * 10000) / 10000; }
function roundCurrency(value) { return Math.round(Number(value) * 100) / 100; }
