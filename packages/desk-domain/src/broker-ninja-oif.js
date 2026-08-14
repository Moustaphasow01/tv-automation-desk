export function renderNinjaOifCommand(intent, { accountName = "Sim101", orderId, strategyName = "", strategyId = "" } = {}) {
  requireSimulationAccount(accountName);
  const payload = intent?.command_payload || intent?.payload || intent;
  const type = ninjaOrderType(payload.order_type);
  const action = String(payload.action || (intent.side === "buy" ? "BUY" : "SELL")).toUpperCase();
  if (!["BUY", "SELL"].includes(action)) throw brokerError("INVALID_ORDER_ACTION", `Unsupported NinjaTrader action: ${action}.`);
  const id = text(orderId || intent.order_intent_id || payload.order_id).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48);
  return `${[
    "PLACE",
    accountName,
    requiredText(payload.broker_symbol, "broker_symbol"),
    action,
    String(positiveInteger(payload.quantity || intent.quantity)),
    type,
    type === "MARKET" || type === "STOPMARKET" ? "" : price(payload.limit_price ?? intent.limit_price),
    type === "STOPMARKET" || type === "STOPLIMIT" ? price(payload.stop_price ?? intent.stop_price) : "",
    text(payload.time_in_force || intent.time_in_force || "DAY").toUpperCase(),
    text(payload.oco_id),
    id,
    text(strategyName),
    text(strategyId),
  ].join(";")}\r\n`;
}

export function renderNinjaOifManagementCommand(input = {}, { accountName = "Sim101", allowGlobalCommand = false } = {}) {
  requireSimulationAccount(accountName);
  const command = text(input.command).toUpperCase();
  const orderId = text(input.order_id || input.orderId);
  const strategyId = text(input.strategy_id || input.strategyId);
  const instrument = text(input.instrument || input.broker_symbol);
  let fields;
  if (command === "CANCEL") {
    if (!orderId) throw brokerError("ORDER_ID_REQUIRED", "CANCEL requires an order ID.");
    fields = [command, "", "", "", "", "", "", "", "", "", orderId, "", strategyId];
  } else if (command === "CHANGE") {
    if (!orderId) throw brokerError("ORDER_ID_REQUIRED", "CHANGE requires an order ID.");
    fields = [command, "", "", "", optionalNonNegativeInteger(input.quantity), "", optionalPrice(input.limit_price), optionalPrice(input.stop_price), "", "", orderId, "", strategyId];
  } else if (command === "CLOSEPOSITION") {
    if (!instrument) throw brokerError("INSTRUMENT_REQUIRED", "CLOSEPOSITION requires an instrument.");
    fields = [command, accountName, instrument, "", "", "", "", "", "", "", "", "", ""];
  } else if (command === "CLOSESTRATEGY") {
    if (!strategyId) throw brokerError("STRATEGY_ID_REQUIRED", "CLOSESTRATEGY requires a strategy ID.");
    fields = [command, "", "", "", "", "", "", "", "", "", "", "", strategyId];
  } else if (command === "CANCELALLORDERS" || command === "FLATTENEVERYTHING") {
    if (!allowGlobalCommand) throw brokerError("GLOBAL_COMMAND_CONFIRMATION_REQUIRED", `${command} requires an explicit global-simulation confirmation.`);
    fields = [command, "", "", "", "", "", "", "", "", "", "", "", ""];
  } else if (command === "REVERSEPOSITION") {
    const action = text(input.action).toUpperCase();
    if (!instrument || !["BUY", "SELL"].includes(action)) throw brokerError("REVERSE_INPUT_REQUIRED", "REVERSEPOSITION requires an instrument and BUY/SELL action.");
    const type = ninjaOrderType(input.order_type || "market");
    fields = [command, accountName, instrument, action, String(positiveInteger(input.quantity)), type,
      type === "MARKET" || type === "STOPMARKET" ? "" : price(input.limit_price),
      type === "STOPMARKET" || type === "STOPLIMIT" ? price(input.stop_price) : "",
      text(input.time_in_force || "DAY").toUpperCase(), text(input.oco_id), orderId, text(input.strategy_name), strategyId];
  } else {
    throw brokerError("INVALID_MANAGEMENT_COMMAND", `Unsupported NinjaTrader management command: ${command}.`);
  }
  return `${fields.join(";")}\r\n`;
}

export function normalizeNinjaUpdate(input = {}, now = new Date().toISOString()) {
  const status = String(input.status || input.order_state || input.state || "unknown").trim().toLowerCase().replace(/\s+/g, "_");
  const statusMap = {
    initialized: "submitted", pending_submit: "submitted", pendingsubmit: "submitted", submitted: "submitted",
    accepted: "accepted", working: "working", suspended: "working", change_submitted: "working", changesubmitted: "working",
    cancel_pending: "cancel_requested", cancelpending: "cancel_requested", cancel_submitted: "cancel_requested",
    trigger_pending: "working", triggerpending: "working", partfilled: "partially_filled", partially_filled: "partially_filled",
    partiallyfilled: "partially_filled", filled: "filled", cancelled: "cancelled", canceled: "cancelled",
    rejected: "rejected", expired: "expired", error: "error",
  };
  return Object.freeze({
    broker_order_ref: requiredText(input.broker_order_ref || input.order_id || input.orderId, "broker_order_ref"),
    status: statusMap[status] || "unknown",
    filled_quantity: finite(input.filled_quantity ?? input.filled) || 0,
    average_fill_price: finite(input.average_fill_price ?? input.avg_fill_price),
    remaining_quantity: finite(input.remaining_quantity ?? input.remaining),
    occurred_at: iso(input.occurred_at || input.timestamp || now),
    raw: input,
  });
}

function requireSimulationAccount(accountName) {
  if (!/^Sim\d*$/i.test(text(accountName))) throw brokerError("SIM_ACCOUNT_REQUIRED", "Only a NinjaTrader simulation account is accepted by the local bridge.");
}
function brokerError(code, message, details = {}) { const error = new Error(message); error.name = "BrokerExecutionError"; error.code = code; error.details = details; return error; }
function text(value) { return value === null || value === undefined ? "" : String(value).trim(); }
function requiredText(value, field) { const result = text(value); if (!result) throw brokerError("FIELD_REQUIRED", `${field} is required.`, { field }); return result; }
function finite(value) { if (value === null || value === undefined || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function positiveInteger(value) { const parsed = finite(value); if (parsed === null || !Number.isInteger(parsed) || parsed <= 0) throw brokerError("POSITIVE_INTEGER_REQUIRED", "A positive integer quantity is required."); return parsed; }
function optionalNonNegativeInteger(value) { const parsed = finite(value); return parsed !== null && Number.isInteger(parsed) && parsed >= 0 ? String(parsed) : "0"; }
function optionalPrice(value) { const parsed = finite(value); return parsed === null ? "0" : String(parsed); }
function iso(value) { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw brokerError("INVALID_TIMESTAMP", `Invalid timestamp: ${value}.`); return new Date(parsed).toISOString(); }
function price(value) { const parsed = finite(value); return parsed === null ? "" : String(parsed); }
function ninjaOrderType(value) {
  const type = text(value).toLowerCase();
  const map = { market: "MARKET", limit: "LIMIT", stop_market: "STOPMARKET", stopmarket: "STOPMARKET", stop_limit: "STOPLIMIT", stoplimit: "STOPLIMIT" };
  if (!map[type]) throw brokerError("INVALID_ORDER_TYPE", `Unsupported NinjaTrader order type: ${type}.`);
  return map[type];
}
