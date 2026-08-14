import { createNinjaAddonCommand, normalizeNinjaAddonEvent } from "./ninja-addon-protocol.js";
import { normalizeBrokerProviderEventV1 } from "./execution-provider-port-v1.js";

export const NINJATRADER_PROVIDER_ADAPTER_SCHEMA_VERSION_V1 = "ninjatrader_provider_adapter_v1";
export const NINJATRADER_PROVIDER_ADAPTER_STATUSES_V1 = Object.freeze(["ADAPTER_COMMAND_READY", "ADAPTER_BLOCKED"]);

export function adaptExecutionProviderCommandToNinjaAddonV1(input = {}) {
  const command = record(input.provider_command || input.command) || {};
  const now = nowIso(input.now);
  const issues = ninjaCommandIssues(command, input);
  if (issues.length) return adapterResult({ command, now, status: "ADAPTER_BLOCKED", issues, addonCommand: null });
  const addonCommand = createNinjaAddonCommand({
    workType: "entry",
    leased: leasedEntry(command, input),
    context: entryContext(command, input),
    accountName: accountName(input),
    atmStrategyName: text(firstDefined(input.atm_strategy_name, input.atmStrategyName)),
    now,
  });
  return adapterResult({ command, now, status: "ADAPTER_COMMAND_READY", issues: [], addonCommand });
}

export function adaptNinjaAddonEventToBrokerProviderEventV1(input = {}) {
  const normalized = normalizeNinjaAddonEvent(input.addon_event || input.event || input, nowIso(input.now));
  const payload = record(normalized.payload) || {};
  return normalizeBrokerProviderEventV1({
    provider_id: text(firstDefined(input.provider_id, "ninjatrader")),
    adapter_id: text(firstDefined(input.adapter_id, "ninjatrader-addon")),
    account_id: text(firstDefined(input.account_id, input.broker_account_id, payload.account_id, payload.account_name, "ninjatrader_paper_local")),
    order_intent_id: normalized.intent_id,
    execution_provider_command_id: normalized.command_id,
    provider_order_ref: firstDefined(payload.provider_order_ref, payload.broker_order_ref, payload.order_id, payload.order_ref),
    event_type: eventTypeFromAddon(normalized.event_type, payload),
    order_status: firstDefined(payload.order_status, payload.status, payload.order_state),
    side: firstDefined(payload.side, payload.action),
    quantity: firstDefined(payload.quantity, payload.order_quantity),
    fill_quantity: firstDefined(payload.fill_quantity, payload.filled_quantity, payload.filled),
    fill_price: firstDefined(payload.fill_price, payload.price, payload.average_fill_price, payload.avg_fill_price),
    position_size: firstDefined(payload.position_size, payload.net_position, payload.quantity_open),
    instrument: firstDefined(payload.instrument, payload.broker_symbol, payload.symbol),
    occurred_at_utc: normalized.occurred_at,
    external_event_key: normalized.event_id,
    payload: { ...payload, ninja_addon_event_type: normalized.event_type },
    raw: normalized,
  });
}

function ninjaCommandIssues(command, input) {
  return [
    ...ninjaCommandShapeIssues(command),
    ...ninjaAccountIssues(input),
    ...ninjaAtmIssues(input),
    ...ninjaEntryPayloadIssues(command),
  ];
}

function ninjaCommandShapeIssues(command) {
  return [
    ...(!command || !Object.keys(command).length ? [issue("NINJA_ADAPTER_COMMAND_REQUIRED", "Provider command is required.")] : []),
    ...(command.command_type !== "SUBMIT_ORDER" ? [issue("NINJA_ADAPTER_UNSUPPORTED_COMMAND", "Only SUBMIT_ORDER is supported by the entry adapter slice.")] : []),
  ];
}

function ninjaAccountIssues(input) {
  return /^Sim\d*$/i.test(accountName(input)) ? [] : [issue("NINJA_ADAPTER_SIM_ACCOUNT_REQUIRED", "Ninja AddOn adapter is restricted to Sim* accounts in this slice.")];
}

function ninjaAtmIssues(input) {
  return [
    ...(!text(firstDefined(input.atm_strategy_name, input.atmStrategyName)) ? [issue("NINJA_ADAPTER_ATM_TEMPLATE_REQUIRED", "ATM strategy template name is required.")] : []),
    ...(!text(firstDefined(input.atm_strategy_id, input.atmStrategyId)) ? [issue("NINJA_ADAPTER_ATM_ID_REQUIRED", "ATM strategy id is required.")] : []),
  ];
}

function ninjaEntryPayloadIssues(command) {
  return [
    ...(!text(command.contract_ref?.provider_symbol) ? [issue("NINJA_ADAPTER_SYMBOL_REQUIRED", "Provider symbol is required for Ninja AddOn.")] : []),
    ...(!number(command.protection?.stop_price) ? [issue("NINJA_ADAPTER_STOP_REQUIRED", "Protective stop is required for Ninja AddOn entry.")] : []),
    ...(!number(command.protection?.target_price) ? [issue("NINJA_ADAPTER_TARGET_REQUIRED", "Profit target is required for Ninja AddOn entry.")] : []),
  ];
}

function adapterResult({ command, now, status, issues, addonCommand }) {
  return {
    schema_version: NINJATRADER_PROVIDER_ADAPTER_SCHEMA_VERSION_V1,
    adapter_id: text(command.adapter_id) || "ninjatrader-addon",
    provider_id: text(command.provider_id) || "ninjatrader",
    execution_provider_command_id: text(command.execution_provider_command_id),
    order_intent_id: text(command.order_intent_id),
    status,
    issued_at_utc: now,
    issues,
    addon_command: addonCommand,
  };
}

function leasedEntry(command, input) {
  return {
    order_intent_id: command.order_intent_id,
    expires_at: command.expires_at_utc || input.expires_at_utc || input.expiresAtUtc,
    command_payload: {
      broker_symbol: command.contract_ref.provider_symbol,
      action: command.action,
      quantity: command.quantity,
      order_type: command.order_type,
      limit_price: command.limit_price ?? null,
      stop_price: command.stop_price ?? null,
      protective_stop: command.protection.stop_price,
      profit_target: command.protection.target_price,
      time_in_force: command.time_in_force,
      atm_strategy_id: text(firstDefined(input.atm_strategy_id, input.atmStrategyId)),
    },
  };
}

function entryContext(command, input) {
  return {
    intent: {
      order_intent_id: command.order_intent_id,
      quantity: command.quantity,
      order_type: command.order_type,
      time_in_force: command.time_in_force,
      bracket: { stop_price: command.protection.stop_price, target_price: command.protection.target_price },
      raw: { atm_strategy_id: text(firstDefined(input.atm_strategy_id, input.atmStrategyId)) },
    },
    contract: { broker_symbol: command.contract_ref.provider_symbol },
  };
}

function eventTypeFromAddon(eventType, payload) {
  const type = text(eventType).toLowerCase();
  if (type === "execution") return partialFill(payload) ? "ORDER_PARTIALLY_FILLED" : "ORDER_FILLED";
  if (type === "position") return "POSITION_UPDATED";
  if (type === "account") return "ACCOUNT_UPDATED";
  if (type === "connection") return "PROVIDER_HEARTBEAT";
  if (type === "command") return commandEventType(payload);
  return firstDefined(payload.event_type, payload.order_status, payload.status, "PROVIDER_ERROR");
}

function commandEventType(payload) {
  const status = text(firstDefined(payload.status, payload.command_status)).toLowerCase();
  if (["acknowledged", "accepted", "delivered"].includes(status)) return "ORDER_ACCEPTED";
  if (["failed", "rejected", "error"].includes(status)) return "ORDER_REJECTED";
  if (["protection_updated", "stop_moved", "target_moved"].includes(status)) return "PROTECTION_UPDATED";
  return "ORDER_WORKING";
}

function partialFill(payload) {
  const filled = number(firstDefined(payload.fill_quantity, payload.filled_quantity, payload.filled));
  const quantity = number(firstDefined(payload.quantity, payload.order_quantity));
  return filled !== null && quantity !== null && filled < quantity;
}

function accountName(input) { return text(firstDefined(input.account_name, input.accountName, "Sim101")); }
function issue(code, message) { return { code, message }; }
function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
function firstDefined(...values) { return values.find((value) => value !== undefined && value !== null && value !== "") ?? null; }
function text(value) { return String(value ?? "").trim(); }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function nowIso(value) { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "1970-01-01T00:00:00.000Z"; }
