import { canonicalSha256 } from "./execution-scope.js";

export const NINJA_ADDON_PROTOCOL_VERSION = "desk_ninja_addon_v1";
export const NINJA_ADDON_ACTIONS = Object.freeze(["place_entry", "move_stop", "reduce_position", "close_position"]);

export class NinjaAddonProtocolError extends Error {
  constructor(code, message, details = {}) {
    super(message || code);
    this.name = "NinjaAddonProtocolError";
    this.code = code;
    this.details = details;
  }
}

export function createNinjaAddonCommand({
  workType,
  leased,
  context,
  accountName = "Sim101",
  atmStrategyName = "",
  now = new Date().toISOString(),
} = {}) {
  requireSimAccount(accountName);
  if (!leased || !context) throw addonError("ADDON_COMMAND_CONTEXT_REQUIRED", "A leased outbox item and its current broker context are required.");
  const issuedAt = iso(now);
  const expiresAt = iso(leased.expires_at || context.intent?.expires_at || context.decision?.valid_until || new Date(Date.parse(issuedAt) + 30_000).toISOString());
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) throw addonError("ADDON_COMMAND_EXPIRED", "The approved intent has expired before AddOn delivery.");

  const command = workType === "management"
    ? managementCommand({ leased, context, accountName, issuedAt, expiresAt })
    : entryCommand({ leased, context, accountName, atmStrategyName, issuedAt, expiresAt });
  const commandId = `addon_${canonicalSha256(command).slice(0, 32)}`;
  return Object.freeze({ ...command, command_id: commandId });
}

export function normalizeNinjaAddonEvent(input = {}, now = new Date().toISOString()) {
  const eventType = text(input.event_type || input.eventType).toLowerCase();
  if (!["order", "execution", "position", "account", "connection", "command"].includes(eventType)) {
    throw addonError("ADDON_EVENT_TYPE_INVALID", `Unsupported AddOn event type: ${eventType || "missing"}.`);
  }
  const occurredAt = iso(input.occurred_at || input.occurredAt || input.timestamp || now);
  const eventId = text(input.event_id || input.eventId) || `addon_event_${canonicalSha256({ eventType, occurredAt, payload: input.payload || input }).slice(0, 32)}`;
  return Object.freeze({
    schema_version: NINJA_ADDON_PROTOCOL_VERSION,
    event_id: eventId,
    event_type: eventType,
    occurred_at: occurredAt,
    intent_id: text(input.intent_id || input.intentId) || null,
    management_intent_id: text(input.management_intent_id || input.managementIntentId) || null,
    command_id: text(input.command_id || input.commandId) || null,
    payload: input.payload && typeof input.payload === "object" ? input.payload : {},
  });
}

export function compareNinjaAdapterSnapshots(left = {}, right = {}) {
  const mismatches = [];
  compareAccount(left.account || {}, right.account || {}, mismatches);
  compareCollection("order", left.orders, right.orders, orderKey, orderProjection, mismatches);
  compareCollection("position", left.positions, right.positions, positionKey, positionProjection, mismatches);
  return Object.freeze({
    schema_version: NINJA_ADDON_PROTOCOL_VERSION,
    status: mismatches.length ? "diverged" : "matched",
    mismatch_count: mismatches.length,
    mismatches,
    left_hash: canonicalSha256(snapshotProjection(left)),
    right_hash: canonicalSha256(snapshotProjection(right)),
  });
}

function entryCommand({ leased, context, accountName, atmStrategyName, issuedAt, expiresAt }) {
  const payload = leased.command_payload || context.intent?.payload || {};
  const template = requiredText(atmStrategyName, "atm_strategy_name");
  const action = text(payload.action || context.intent?.side).toUpperCase();
  if (!["BUY", "SELL"].includes(action)) throw addonError("ADDON_ORDER_ACTION_INVALID", `Unsupported entry action: ${action}.`);
  return {
    schema_version: NINJA_ADDON_PROTOCOL_VERSION,
    work_type: "entry",
    action: "place_entry",
    account_name: accountName,
    intent_id: requiredText(leased.order_intent_id || context.intent?.order_intent_id, "order_intent_id"),
    management_intent_id: null,
    instrument: requiredText(payload.broker_symbol || context.contract?.broker_symbol, "broker_symbol"),
    side: action,
    quantity: positiveInteger(payload.quantity || context.intent?.quantity),
    order_type: orderType(payload.order_type || context.intent?.order_type),
    limit_price: nullableNumber(payload.limit_price ?? context.intent?.limit_price),
    stop_price: nullableNumber(payload.stop_price ?? context.intent?.stop_price),
    time_in_force: timeInForce(payload.time_in_force || context.intent?.time_in_force),
    protective_stop: positiveNumber(payload.protective_stop ?? context.intent?.bracket?.stop_price, "protective_stop"),
    profit_target: positiveNumber(payload.profit_target ?? context.intent?.bracket?.target_price, "profit_target"),
    atm_strategy_name: template,
    atm_strategy_id: requiredText(payload.atm_strategy_id || context.intent?.raw?.atm_strategy_id, "atm_strategy_id"),
    broker_order_ref: null,
    issued_at: issuedAt,
    expires_at: expiresAt,
  };
}

function managementCommand({ leased, context, accountName, issuedAt, expiresAt }) {
  const intent = context.intent || {};
  const trade = context.trade || {};
  const action = text(intent.action);
  if (!["move_stop", "reduce_position", "close_position"].includes(action)) {
    throw addonError("ADDON_MANAGEMENT_ACTION_INVALID", `Unsupported management action: ${action}.`);
  }
  const base = {
    schema_version: NINJA_ADDON_PROTOCOL_VERSION,
    work_type: "management",
    action,
    account_name: accountName,
    intent_id: null,
    management_intent_id: requiredText(leased.management_intent_id || intent.management_intent_id, "management_intent_id"),
    instrument: requiredText(context.contract?.broker_symbol, "broker_symbol"),
    side: trade.side === "long" ? "SELL" : "BUY",
    quantity: positiveInteger(intent.requested_quantity || trade.quantity_open),
    order_type: action === "move_stop" ? "STOP_MARKET" : "MARKET",
    limit_price: null,
    stop_price: action === "move_stop" ? positiveNumber(intent.requested_stop_price, "requested_stop_price") : null,
    time_in_force: "DAY",
    protective_stop: null,
    profit_target: null,
    atm_strategy_name: null,
    atm_strategy_id: text(trade.atm_strategy_id || trade.raw?.atm_strategy_id) || null,
    broker_order_ref: action === "move_stop" ? requiredText(trade.raw?.protective_stop_order_ref, "protective_stop_order_ref") : null,
    expected_trade_revision: nonNegativeInteger(intent.expected_trade_revision),
    issued_at: issuedAt,
    expires_at: expiresAt,
  };
  return base;
}

function compareAccount(left, right, mismatches) {
  for (const key of ["account_name", "connection_status", "currency"]) {
    const a = normalizedScalar(left[key]);
    const b = normalizedScalar(right[key]);
    if (a && b && a !== b) mismatches.push({ type: "ACCOUNT_FIELD_MISMATCH", field: key, left: a, right: b });
  }
  for (const key of ["cash_value", "net_liquidation_value", "realized_pnl", "unrealized_pnl"]) {
    const a = nullableNumber(left[key]);
    const b = nullableNumber(right[key]);
    if (a !== null && b !== null && Math.abs(a - b) > 1e-8) mismatches.push({ type: "ACCOUNT_VALUE_MISMATCH", field: key, left: a, right: b });
  }
}

function compareCollection(kind, left, right, keyFn, projectionFn, mismatches) {
  const a = new Map(array(left).map((item) => [keyFn(item), projectionFn(item)]).filter(([key]) => key));
  const b = new Map(array(right).map((item) => [keyFn(item), projectionFn(item)]).filter(([key]) => key));
  for (const [key, value] of a) {
    if (!b.has(key)) mismatches.push({ type: `${kind.toUpperCase()}_MISSING_RIGHT`, key, left: value });
    else if (canonicalSha256(value) !== canonicalSha256(b.get(key))) mismatches.push({ type: `${kind.toUpperCase()}_MISMATCH`, key, left: value, right: b.get(key) });
  }
  for (const [key, value] of b) if (!a.has(key)) mismatches.push({ type: `${kind.toUpperCase()}_MISSING_LEFT`, key, right: value });
}

function snapshotProjection(value) {
  return {
    account: value.account || {},
    orders: array(value.orders).map(orderProjection).sort(sortJson),
    positions: array(value.positions).map(positionProjection).sort(sortJson),
  };
}
function orderKey(item) { return normalizedScalar(item.broker_order_ref || item.order_id || item.orderId); }
function orderProjection(item) { return { key: orderKey(item), instrument: normalizedScalar(item.instrument || item.broker_symbol), status: normalizedScalar(item.status || item.order_state), quantity: nullableNumber(item.quantity), filled: nullableNumber(item.filled_quantity ?? item.filled), limit_price: nullableNumber(item.limit_price), stop_price: nullableNumber(item.stop_price) }; }
function positionKey(item) { return normalizedScalar(item.instrument || item.broker_symbol); }
function positionProjection(item) { return { key: positionKey(item), side: normalizedScalar(item.market_position || item.side), quantity: nullableNumber(item.quantity), average_price: nullableNumber(item.average_price ?? item.avg_price) }; }
function sortJson(a, b) { return JSON.stringify(a).localeCompare(JSON.stringify(b)); }
function orderType(value) { const normalized = text(value).toUpperCase().replace(/[^A-Z]/g, "_"); if (!["MARKET", "LIMIT", "STOP_MARKET", "STOP_LIMIT"].includes(normalized)) throw addonError("ADDON_ORDER_TYPE_INVALID", `Unsupported order type: ${value}.`); return normalized; }
function timeInForce(value) { const normalized = text(value || "DAY").toUpperCase(); if (!["DAY", "GTC"].includes(normalized)) throw addonError("ADDON_TIF_INVALID", `Unsupported time in force: ${value}.`); return normalized; }
function requireSimAccount(value) { if (!/^Sim\d*$/i.test(text(value))) throw addonError("ADDON_SIM_ACCOUNT_REQUIRED", "The local AddOn accepts NinjaTrader Sim* accounts only."); }
function requiredText(value, field) { const result = text(value); if (!result) throw addonError("ADDON_FIELD_REQUIRED", `${field} is required.`, { field }); return result; }
function positiveInteger(value) { const parsed = nullableNumber(value); if (!Number.isInteger(parsed) || parsed <= 0) throw addonError("ADDON_QUANTITY_INVALID", `A positive integer quantity is required, received ${value}.`); return parsed; }
function positiveNumber(value, field) { const parsed = nullableNumber(value); if (parsed === null || parsed <= 0) throw addonError("ADDON_PRICE_INVALID", `${field} must be a positive number.`); return parsed; }
function nonNegativeInteger(value) { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0; }
function nullableNumber(value) { if (value === null || value === undefined || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function normalizedScalar(value) { return text(value).toUpperCase().replace(/\s+/g, " "); }
function array(value) { return Array.isArray(value) ? value : []; }
function text(value) { return value === null || value === undefined ? "" : String(value).trim(); }
function iso(value) { const parsed = Date.parse(value || ""); if (!Number.isFinite(parsed)) throw addonError("ADDON_TIMESTAMP_INVALID", `Invalid timestamp: ${value}.`); return new Date(parsed).toISOString(); }
function addonError(code, message, details) { return new NinjaAddonProtocolError(code, message, details); }
