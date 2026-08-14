import {
  firstText,
  isObject,
  number,
  parseTime,
  round,
  text,
} from "./canonical-simulation-result-v1.js";

export const ORDER_SIMULATION_POLICY_SCHEMA_VERSION_V1 = "order_simulation_policy_v1";
export const ORDER_SIMULATION_OUTCOME_SCHEMA_VERSION_V1 = "order_simulation_outcome_v1";
export const ORDER_SIMULATOR_VERSION_V1 = "1.0.0";

export const DEFAULT_ORDER_SIMULATION_POLICY_V1 = Object.freeze({
  schema_version: ORDER_SIMULATION_POLICY_SCHEMA_VERSION_V1,
  simulator_version: ORDER_SIMULATOR_VERSION_V1,
  spread_points: 0,
  slippage_points: 0,
  commission_r_per_contract: 0,
  entry_latency_rows: 0,
  exit_latency_rows: 0,
  gap_policy: "FILL_AT_TRIGGER_PRICE",
  ambiguous_intrabar_policy: "REVIEW_REQUIRED",
  partial_fill_enabled: false,
  partial_fill_ratio: 1,
  minimum_fill_quantity: 1,
});

const ORDER_TYPES = new Set(["MARKET", "LIMIT", "STOP", "STOP_LIMIT"]);
const GAP_POLICIES = new Set(["FILL_AT_OPEN_IF_THROUGH_PRICE", "FILL_AT_TRIGGER_PRICE"]);
const AMBIGUOUS_POLICIES = new Set(["REVIEW_REQUIRED", "CONSERVATIVE_STOP", "FAVORABLE_TARGET", "OHLC_DISTANCE"]);

export function normalizeOrderSimulationPolicyV1(input = {}) {
  const source = object(input);
  const pricing = object(source.pricing);
  const latency = object(source.latency);
  const partial = object(source.partial_fill);
  return {
    ...DEFAULT_ORDER_SIMULATION_POLICY_V1,
    spread_points: nonNegative(firstNumber([source.spread_points, pricing.spread_points]), 0),
    slippage_points: nonNegative(firstNumber([source.slippage_points, pricing.slippage_points]), 0),
    commission_r_per_contract: nonNegative(firstNumber([source.commission_r_per_contract, pricing.commission_r_per_contract]), 0),
    entry_latency_rows: nonNegativeInteger(firstNumber([source.entry_latency_rows, latency.entry_rows]), 0),
    exit_latency_rows: nonNegativeInteger(firstNumber([source.exit_latency_rows, latency.exit_rows]), 0),
    gap_policy: enumOr(source.gap_policy, GAP_POLICIES, DEFAULT_ORDER_SIMULATION_POLICY_V1.gap_policy),
    ambiguous_intrabar_policy: enumOr(source.ambiguous_intrabar_policy, AMBIGUOUS_POLICIES, DEFAULT_ORDER_SIMULATION_POLICY_V1.ambiguous_intrabar_policy),
    partial_fill_enabled: source.partial_fill_enabled === true || partial.enabled === true,
    partial_fill_ratio: ratio(firstNumber([source.partial_fill_ratio, partial.fill_ratio]), 1),
    minimum_fill_quantity: positiveInteger(firstNumber([source.minimum_fill_quantity, partial.minimum_quantity]), 1),
  };
}

export function buildEntryOrderV1({ setup = {}, entry_price = null } = {}) {
  const orderType = normalizeOrderType(firstText([setup.order_type, setup.entry_order_type, setup.entry_mode]));
  const entryPrice = firstNumber([entry_price, setup.entry_price, setup.order_limit_price, setup.order_stop_price]);
  return {
    order_id: text(setup.entry_order_id) || `simord_${text(setup.setup_id) || "setup"}_entry`,
    phase: "ENTRY",
    setup_id: text(setup.setup_id),
    instrument: text(setup.instrument),
    direction: normalizeDirection(setup.direction),
    side: entrySide(setup.direction),
    order_type: orderType,
    quantity: positiveInteger(firstNumber([setup.quantity, setup.contracts, setup.lots]), 1),
    limit_price: entryLimitPrice(orderType, setup, entryPrice),
    stop_price: entryStopPrice(orderType, setup, entryPrice),
    status: "WORKING",
  };
}

export function applyOrderReplacementsV1(order = {}, replacements = [], row = {}) {
  const replacement = latestReplacement(replacements, row);
  if (!replacement) return order;
  if (String(replacement.action || "").toUpperCase() === "CANCEL") return { ...order, status: "CANCELLED", cancel_reason: text(replacement.reason) || "ORDER_CANCELLED" };
  return {
    ...order,
    order_type: normalizeOrderType(firstText([replacement.order_type, order.order_type])),
    limit_price: firstNumber([replacement.limit_price, order.limit_price]),
    stop_price: firstNumber([replacement.stop_price, order.stop_price]),
    replaced_at: firstText([replacement.at_paris, replacement.at_utc, replacement.time]),
  };
}

export function simulateEntryOrderV1({ setup = {}, row = {}, index = 0, submittedIndex = 0, policy = {}, entry_price = null } = {}) {
  const settings = normalizeOrderSimulationPolicyV1(policy);
  const order = applyOrderReplacementsV1(buildEntryOrderV1({ setup, entry_price }), setup.order_replacements, row);
  if (order.status === "CANCELLED") return outcome("ENTRY", order, noFill(order.cancel_reason), settings);
  if (latencyPending(index, submittedIndex, settings.entry_latency_rows)) return outcome("ENTRY", order, noFill("ENTRY_LATENCY_PENDING"), settings);
  return outcome("ENTRY", order, entryFill(order, row, settings), settings);
}

export function simulateExitOrderV1({ position = {}, row = {}, policy = {} } = {}) {
  const settings = normalizeOrderSimulationPolicyV1(policy);
  const stop = exitStopFill(position, row, settings);
  const target = exitTargetFill(position, row, settings);
  if (stop.status === "FILLED" && target.status === "FILLED") return resolveAmbiguousExit(position, row, stop, target, settings);
  if (stop.status === "FILLED") return outcome("EXIT", stop.order, stop, settings);
  if (target.status === "FILLED") return outcome("EXIT", target.order, target, settings);
  return outcome("EXIT", exitOrder(position, "NO_EXIT"), noFill("NO_EXIT_TOUCHED"), settings);
}

function entryFill(order, row, settings) {
  if (order.order_type === "MARKET") return fill(order, "MARKET", number(row.open), settings);
  if (order.order_type === "LIMIT") return limitEntryFill(order, row, settings);
  if (order.order_type === "STOP") return stopEntryFill(order, row, settings);
  if (order.order_type === "STOP_LIMIT") return stopLimitEntryFill(order, row, settings);
  return noFill("ORDER_TYPE_UNSUPPORTED");
}

function limitEntryFill(order, row, settings) {
  if (!limitTouched(order.side, row, order.limit_price)) return noFill("LIMIT_NOT_TOUCHED");
  return fill(order, "LIMIT_TOUCHED", limitFillRawPrice(order.side, row, order.limit_price, settings), settings);
}

function stopEntryFill(order, row, settings) {
  if (!stopTouched(order.side, row, order.stop_price)) return noFill("STOP_NOT_TOUCHED");
  return fill(order, "STOP_TOUCHED", stopFillRawPrice(order.side, row, order.stop_price, settings), settings);
}

function stopLimitEntryFill(order, row, settings) {
  if (!stopTouched(order.side, row, order.stop_price)) return noFill("STOP_LIMIT_NOT_ACTIVATED");
  if (!limitTouched(order.side, row, order.limit_price)) return noFill("STOP_LIMIT_ACTIVATED_NOT_FILLED");
  return fill(order, "STOP_LIMIT_FILLED", limitFillRawPrice(order.side, row, order.limit_price, settings), settings);
}

function exitStopFill(position, row, settings) {
  const order = exitOrder(position, "STOP_LOSS");
  if (!stopTouched(order.side, row, order.stop_price)) return noFill("STOP_NOT_TOUCHED", order);
  return fill(order, "STOP_LOSS", stopFillRawPrice(order.side, row, order.stop_price, settings), settings);
}

function exitTargetFill(position, row, settings) {
  const order = exitOrder(position, "TAKE_PROFIT_1");
  if (!limitTouched(order.side, row, order.limit_price)) return noFill("TARGET_NOT_TOUCHED", order);
  return fill(order, "TAKE_PROFIT_1", limitFillRawPrice(order.side, row, order.limit_price, settings), settings);
}

function resolveAmbiguousExit(position, row, stop, target, settings) {
  const policy = settings.ambiguous_intrabar_policy;
  if (policy === "REVIEW_REQUIRED") return { ...outcome("EXIT", stop.order, noFill("AMBIGUOUS_INTRABAR_STOP_AND_TARGET"), settings), review_required: true };
  if (policy === "FAVORABLE_TARGET") return outcome("EXIT", target.order, { ...target, ambiguous_resolution: policy }, settings);
  if (policy === "OHLC_DISTANCE") return resolveDistanceAmbiguity(position, row, stop, target, settings);
  return outcome("EXIT", stop.order, { ...stop, ambiguous_resolution: policy }, settings);
}

function resolveDistanceAmbiguity(position, row, stop, target, settings) {
  const first = firstTouchByOpenDistance(position, row);
  if (first === "REVIEW") return { ...outcome("EXIT", stop.order, noFill("AMBIGUOUS_INTRABAR_EQUAL_DISTANCE"), settings), review_required: true };
  return first === "TARGET" ? outcome("EXIT", target.order, { ...target, ambiguous_resolution: "OHLC_DISTANCE" }, settings) : outcome("EXIT", stop.order, { ...stop, ambiguous_resolution: "OHLC_DISTANCE" }, settings);
}

function fill(order, reason, rawPrice, settings) {
  if (rawPrice === null) return noFill("PRICE_NOT_AVAILABLE", order);
  const quantity = simulatedQuantity(order.quantity, settings);
  const status = quantity < order.quantity ? "PARTIALLY_FILLED" : "FILLED";
  return { status, reason, price: executionPrice(rawPrice, order.side, settings), raw_price: rawPrice, quantity, requested_quantity: order.quantity, commission_r: round(quantity * settings.commission_r_per_contract) };
}

function noFill(reason, order = null) {
  return { status: "PENDING", reason, price: null, raw_price: null, quantity: 0, requested_quantity: order?.quantity || 0, commission_r: 0 };
}

function outcome(phase, order, fillResult, settings) {
  return { schema_version: ORDER_SIMULATION_OUTCOME_SCHEMA_VERSION_V1, simulator_version: ORDER_SIMULATOR_VERSION_V1, phase, status: fillResult.status, order, fill: fillResult, review_required: false, reason: fillResult.reason, policy_snapshot: settings };
}

function exitOrder(position, reason) {
  const long = normalizeDirection(position.direction) === "long";
  return {
    order_id: `simord_${text(position.position_id) || "position"}_${String(reason).toLowerCase()}`,
    phase: "EXIT",
    setup_id: text(position.setup_id),
    instrument: text(position.instrument),
    direction: normalizeDirection(position.direction),
    side: long ? "SELL" : "BUY",
    order_type: reason === "STOP_LOSS" ? "STOP" : "LIMIT",
    quantity: positiveInteger(firstNumber([position.quantity]), 1),
    limit_price: reason === "TAKE_PROFIT_1" ? number(position.take_profit_1) : null,
    stop_price: reason === "STOP_LOSS" ? number(position.stop_loss) : null,
    status: "WORKING",
  };
}

function limitTouched(side, row, price) {
  if (!validTouchInputs(row, price)) return false;
  return side === "BUY" ? number(row.low) <= price : number(row.high) >= price;
}

function stopTouched(side, row, price) {
  if (!validTouchInputs(row, price)) return false;
  return side === "BUY" ? number(row.high) >= price : number(row.low) <= price;
}

function limitFillRawPrice(side, row, price, settings) {
  if (settings.gap_policy === "FILL_AT_TRIGGER_PRICE") return price;
  const open = number(row.open);
  if (open === null) return price;
  if (side === "BUY" && open < price) return open;
  if (side === "SELL" && open > price) return open;
  return price;
}

function stopFillRawPrice(side, row, price, settings) {
  if (settings.gap_policy === "FILL_AT_TRIGGER_PRICE") return price;
  const open = number(row.open);
  if (open === null) return price;
  if (side === "BUY" && open > price) return open;
  if (side === "SELL" && open < price) return open;
  return price;
}

function executionPrice(price, side, settings) {
  const cost = settings.slippage_points + settings.spread_points / 2;
  return round(side === "BUY" ? price + cost : price - cost);
}

function simulatedQuantity(quantity, settings) {
  if (!settings.partial_fill_enabled) return quantity;
  return Math.max(0, Math.min(quantity, Math.max(settings.minimum_fill_quantity, Math.floor(quantity * settings.partial_fill_ratio))));
}

function firstTouchByOpenDistance(position, row) {
  const open = number(row.open);
  const stop = number(position.stop_loss);
  const target = number(position.take_profit_1);
  if (open === null || stop === null || target === null) return "REVIEW";
  const stopDistance = Math.abs(open - stop);
  const targetDistance = Math.abs(open - target);
  if (stopDistance === targetDistance) return "REVIEW";
  return targetDistance < stopDistance ? "TARGET" : "STOP";
}

function latestReplacement(replacements, row) {
  const at = parseTime(row.time);
  if (at === null) return null;
  return (Array.isArray(replacements) ? replacements : [])
    .filter((replacement) => replacementTime(replacement) !== null && replacementTime(replacement) <= at)
    .sort((left, right) => replacementTime(left) - replacementTime(right))
    .at(-1) || null;
}

function replacementTime(replacement) {
  return parseTime(firstText([replacement.at_paris, replacement.at_utc, replacement.time]));
}

function entryLimitPrice(orderType, setup, entryPrice) {
  if (orderType === "LIMIT") return entryPrice;
  if (orderType !== "STOP_LIMIT") return null;
  return firstNumber([setup.stop_limit_price, setup.limit_price, setup.order_limit_price, entryPrice]);
}

function entryStopPrice(orderType, setup, entryPrice) {
  if (orderType !== "STOP" && orderType !== "STOP_LIMIT") return null;
  return firstNumber([setup.stop_trigger_price, setup.trigger_price, setup.order_stop_price, entryPrice]);
}

function latencyPending(index, submittedIndex, latencyRows) {
  return Number(index) - Number(submittedIndex) < latencyRows;
}

function validTouchInputs(row, price) {
  return price !== null && number(row.high) !== null && number(row.low) !== null;
}

function normalizeOrderType(value) {
  const normalized = String(value || "LIMIT").toUpperCase().replace(/[^A-Z]+/g, "_");
  return ORDER_TYPES.has(normalized) ? normalized : "LIMIT";
}

function normalizeDirection(value) {
  return String(value || "").toLowerCase() === "short" ? "short" : "long";
}

function entrySide(direction) {
  return normalizeDirection(direction) === "short" ? "SELL" : "BUY";
}

function enumOr(value, allowed, fallback) {
  const normalized = String(value || "").toUpperCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function nonNegative(value, fallback) {
  const parsed = number(value);
  if (parsed === null) return fallback;
  return Math.max(0, parsed);
}

function nonNegativeInteger(value, fallback) {
  return Math.trunc(nonNegative(value, fallback));
}

function positiveInteger(value, fallback) {
  return Math.max(1, Math.trunc(nonNegative(value, fallback)));
}

function ratio(value, fallback) {
  const parsed = number(value);
  if (parsed === null) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

function firstNumber(values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = number(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function object(value) {
  return isObject(value) ? value : {};
}
