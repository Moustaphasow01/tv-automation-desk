import { canonicalSha256 } from "./execution-scope.js";

export const EXECUTION_PROVIDER_PORT_SCHEMA_VERSION_V1 = "execution_provider_port_v1";
export const EXECUTION_PROVIDER_COMMAND_SCHEMA_VERSION_V1 = "execution_provider_command_v1";
export const BROKER_PROVIDER_EVENT_SCHEMA_VERSION_V1 = "broker_provider_event_v1";
export const EXECUTION_PROVIDER_COMMAND_TYPES_V1 = Object.freeze(["SUBMIT_ORDER", "CANCEL_ORDER", "REPLACE_ORDER", "MOVE_STOP", "MOVE_TARGET", "SYNC_POSITIONS", "SYNC_ORDERS"]);
export const EXECUTION_PROVIDER_COMMAND_STATUSES_V1 = Object.freeze(["COMMAND_READY", "BLOCKED", "DUPLICATE_PROTECTED", "UNSUPPORTED_COMMAND"]);
export const BROKER_PROVIDER_EVENT_TYPES_V1 = Object.freeze(["ORDER_ACCEPTED", "ORDER_REJECTED", "ORDER_WORKING", "ORDER_CANCELLED", "ORDER_FILLED", "ORDER_PARTIALLY_FILLED", "POSITION_UPDATED", "ACCOUNT_UPDATED", "PROTECTION_UPDATED", "PROVIDER_HEARTBEAT", "PROVIDER_ERROR"]);
export const BROKER_PROVIDER_ORDER_STATUSES_V1 = Object.freeze(["ACCEPTED", "WORKING", "PARTIALLY_FILLED", "FILLED", "CANCELLED", "REJECTED", "ERROR", "UNKNOWN"]);

export function buildExecutionProviderCommandV1(input = {}) {
  const asOf = iso(firstDefined(input.as_of_utc, input.asOfUtc, new Date().toISOString()));
  const commandType = upper(firstDefined(input.command_type, input.type, "SUBMIT_ORDER"));
  const intent = record(firstDefined(input.order_intent, input.intent, {})) || {};
  const provider = normalizeProviderProfile(firstDefined(input.provider_profile, input.provider, {}), intent);
  const active = activeCommands(firstDefined(input.active_provider_commands, input.existing_provider_commands, []));
  const issues = commandIssues({ commandType, intent, provider, input });
  const idempotencyKey = providerCommandIdempotencyKey({ commandType, intent, provider, input });
  const duplicate = active.find((item) => text(item.idempotency_key) === idempotencyKey);
  const base = {
    schema_version: EXECUTION_PROVIDER_PORT_SCHEMA_VERSION_V1,
    as_of_utc: asOf,
    status: statusFor({ commandType, issues, duplicate }),
    command_type: commandType,
    provider_id: provider.provider_id,
    adapter_id: provider.adapter_id,
    order_intent_id: text(intent.order_intent_id),
    idempotency_key: idempotencyKey,
    issues,
    duplicate_provider_command_id: duplicate ? text(duplicate.execution_provider_command_id || duplicate.provider_command_id) : null,
    provider_command: null,
  };
  const withCommand = { ...base, provider_command: base.status === "COMMAND_READY" ? providerCommand({ asOf, commandType, intent, provider, idempotencyKey }) : null };
  return { ...withCommand, plan_hash: hash(withCommand) };
}

export function normalizeBrokerProviderEventV1(input = {}) {
  const source = record(firstDefined(input.event, input)) || {};
  const occurredAt = iso(firstDefined(source.occurred_at_utc, source.occurredAtUtc, source.occurred_at, source.timestamp, new Date().toISOString()));
  const providerId = text(firstDefined(source.provider_id, source.broker_provider_code, source.provider, "provider-neutral"));
  const eventType = normalizeEventType(firstDefined(source.event_type, source.type, source.status));
  const externalEventKey = externalKey(source, { providerId, eventType, occurredAt });
  const payload = record(firstDefined(source.payload, source.data, {})) || {};
  const raw = record(firstDefined(source.raw, source.raw_event, source)) || {};
  const base = {
    schema_version: BROKER_PROVIDER_EVENT_SCHEMA_VERSION_V1,
    broker_provider_event_id: `broker_provider_event_${canonicalSha256({ provider_id: providerId, external_event_key: externalEventKey }).slice(0, 24)}`,
    execution_provider_command_id: nullableText(firstDefined(source.execution_provider_command_id, source.provider_command_id, source.command_id)),
    order_intent_id: nullableText(firstDefined(source.order_intent_id, source.intent_id)),
    provider_id: providerId,
    adapter_id: nullableText(firstDefined(source.adapter_id, source.adapter, source.bridge_id)),
    account_id: nullableText(firstDefined(source.account_id, source.broker_account_id, source.provider_account_id, source.account)),
    instrument: nullableText(firstDefined(source.instrument, source.instrument_code, source.symbol)),
    provider_order_ref: nullableText(firstDefined(source.provider_order_ref, source.broker_order_ref, source.order_ref, source.order_id)),
    event_type: eventType,
    order_status: normalizeOrderStatus(firstDefined(source.order_status, source.status, eventType)),
    side: normalizeSide(firstDefined(source.side, source.action)),
    quantity: numberOrNull(firstDefined(source.quantity, source.order_quantity)),
    fill_quantity: numberOrNull(firstDefined(source.fill_quantity, source.filled_quantity, source.executed_quantity)),
    fill_price: numberOrNull(firstDefined(source.fill_price, source.price, source.avg_fill_price)),
    position_size: numberOrNull(firstDefined(source.position_size, source.net_position, source.signed_size)),
    occurred_at_utc: occurredAt,
    external_event_key: externalEventKey,
    payload_hash: hash(payload),
    raw_event_hash: hash(raw),
    payload,
  };
  return { ...base, event_hash: hash(base) };
}

function providerCommand({ asOf, commandType, intent, provider, idempotencyKey }) {
  const contract = providerContractRef(intent, provider);
  const protection = record(intent.protection) || {};
  const idScope = { command_type: commandType, provider_id: provider.provider_id, order_intent_id: text(intent.order_intent_id), idempotency_key: idempotencyKey };
  const base = {
    schema_version: EXECUTION_PROVIDER_COMMAND_SCHEMA_VERSION_V1,
    execution_provider_command_id: `execution_provider_command_${canonicalSha256(idScope).slice(0, 24)}`,
    command_type: commandType,
    provider_id: provider.provider_id,
    adapter_id: provider.adapter_id,
    order_intent_id: text(intent.order_intent_id),
    account_ref: {
      account_id: accountId(intent, provider),
      provider_account_id: text(firstDefined(intent.provider_account_id, intent.broker_account_id, provider.provider_account_id, provider.account_id)),
    },
    contract_ref: contract,
    action: normalizeAction(firstDefined(intent.action, intent.side)),
    quantity: integerOrNull(intent.quantity),
    order_type: upper(firstDefined(intent.order_type, "MARKET")),
    time_in_force: upper(firstDefined(intent.time_in_force, "DAY")),
    lifecycle_action: upper(intent.lifecycle_action),
    protection: {
      required: protection.required !== false,
      stop_price: numberOrNull(firstDefined(protection.stop_price, protection.protective_stop)),
      target_price: numberOrNull(firstDefined(protection.target_price, protection.profit_target)),
      max_slippage_ticks: numberOrNull(protection.max_slippage_ticks),
      oco_required: protection.oco_required !== false,
    },
    requested_at_utc: asOf,
    expires_at_utc: nullableText(firstDefined(intent.expires_at_utc, intent.expires_at)),
    idempotency_key: idempotencyKey,
    source: {
      kind: "ORDER_INTENT",
      order_intent_hash: nullableText(intent.order_intent_hash),
      target_position_id: nullableText(intent.target_position_id),
    },
  };
  return { ...base, command_hash: hash(base) };
}

function commandIssues({ commandType, intent, provider, input }) {
  return [
    ...commandTypeIssues(commandType),
    ...providerIssues(commandType, provider),
    ...submitOrderIssues({ commandType, intent, provider, input }),
    ...executionHaltIssues(input, provider),
  ];
}

function commandTypeIssues(commandType) {
  return EXECUTION_PROVIDER_COMMAND_TYPES_V1.includes(commandType) ? [] : [issue("UNSUPPORTED_COMMAND_TYPE", `Unsupported provider command: ${commandType}.`)];
}

function providerIssues(commandType, provider) {
  return [
    ...(!provider.enabled ? [issue("PROVIDER_DISABLED", `Provider ${provider.provider_id} is disabled.`)] : []),
    ...(!provider.supported_command_types.includes(commandType) ? [issue("COMMAND_NOT_SUPPORTED_BY_PROVIDER", `${provider.provider_id} does not advertise ${commandType}.`)] : []),
  ];
}

function submitOrderIssues({ commandType, intent, provider, input }) {
  if (commandType !== "SUBMIT_ORDER") return [];
  const contract = providerContractRef(intent, provider);
  return [
    ...(!text(intent.order_intent_id) ? [issue("ORDER_INTENT_REQUIRED", "SUBMIT_ORDER requires an order_intent_id.")] : []),
    ...(intent.broker_submission_allowed !== true && input.allow_blocked_intent !== true ? [issue("ORDER_INTENT_NOT_SUBMITTABLE", "OrderIntent is not marked broker_submission_allowed=true.")] : []),
    ...(!accountId(intent, provider) ? [issue("ACCOUNT_REF_REQUIRED", "Provider account reference is required.")] : []),
    ...(!contract.provider_contract_id && !contract.provider_symbol ? [issue("CONTRACT_REF_REQUIRED", "Provider contract reference is required.")] : []),
    ...(!normalizeAction(firstDefined(intent.action, intent.side)) ? [issue("ACTION_REQUIRED", "BUY or SELL action is required.")] : []),
    ...(!integerOrNull(intent.quantity) ? [issue("QUANTITY_REQUIRED", "Positive integer quantity is required.")] : []),
  ];
}

function executionHaltIssues(input, provider) {
  return input.execution_halt === true || provider.execution_halt === true ? [issue("PROVIDER_EXECUTION_HALTED", "Provider execution halt is active.")] : [];
}

function statusFor({ commandType, issues, duplicate }) {
  if (!EXECUTION_PROVIDER_COMMAND_TYPES_V1.includes(commandType)) return "UNSUPPORTED_COMMAND";
  if (issues.length) return "BLOCKED";
  if (duplicate) return "DUPLICATE_PROTECTED";
  return "COMMAND_READY";
}

function normalizeProviderProfile(input, intent) {
  const source = record(input) || {};
  const providerId = text(firstDefined(source.provider_id, source.broker_provider_code, intent.provider_id, intent.provider_contract_ref?.provider_id, "provider-neutral"));
  return {
    provider_id: providerId,
    adapter_id: text(firstDefined(source.adapter_id, source.adapter, `${providerId}-adapter`)),
    provider_account_id: text(firstDefined(source.provider_account_id, source.broker_account_id, source.account_id)),
    enabled: firstDefined(source.enabled, true) !== false,
    execution_halt: source.execution_halt === true,
    supported_command_types: supportedCommands(source.supported_command_types),
    contracts: firstDefined(source.contracts, source.provider_contracts, {}),
  };
}

function supportedCommands(input) {
  const values = array(input).map(upper).filter(Boolean);
  return values.length ? values : [...EXECUTION_PROVIDER_COMMAND_TYPES_V1];
}

function providerContractRef(intent, provider) {
  const embedded = record(intent.provider_contract_ref) || {};
  const symbol = upper(firstDefined(intent.instrument, embedded.instrument));
  const mapped = contractMap(provider.contracts).get(symbol) || {};
  return {
    provider_id: text(firstDefined(embedded.provider_id, mapped.provider_id, provider.provider_id)),
    provider_contract_id: text(firstDefined(embedded.provider_contract_id, mapped.provider_contract_id, mapped.broker_contract_id)),
    provider_symbol: text(firstDefined(embedded.provider_symbol, mapped.provider_symbol, mapped.broker_symbol, mapped.symbol, symbol)),
    instrument: symbol,
  };
}

function contractMap(input) {
  if (Array.isArray(input)) return new Map(input.map((item) => [upper(firstDefined(item.instrument, item.instrument_code, item.symbol)), record(item) || {}]));
  const source = record(input) || {};
  return new Map(Object.entries(source).map(([key, value]) => [upper(key), record(value) || { provider_symbol: value }]));
}

function providerCommandIdempotencyKey({ commandType, intent, provider, input }) {
  const explicit = text(firstDefined(input.idempotency_key, input.idempotencyKey));
  if (explicit) return explicit;
  return `sha256:${canonicalSha256({ command_type: commandType, provider_id: provider.provider_id, order_intent_id: text(intent.order_intent_id), order_intent_idempotency_key: text(intent.idempotency_key) })}`;
}

function normalizeEventType(value) {
  const normalized = upper(value).replaceAll("-", "_").replaceAll(" ", "_");
  const aliases = new Map([
    ["ACCEPTED", "ORDER_ACCEPTED"], ["ACKNOWLEDGED", "ORDER_ACCEPTED"], ["ORDER_ACKNOWLEDGED", "ORDER_ACCEPTED"],
    ["REJECTED", "ORDER_REJECTED"], ["WORKING", "ORDER_WORKING"], ["SUBMITTED", "ORDER_WORKING"],
    ["CANCELLED", "ORDER_CANCELLED"], ["CANCELED", "ORDER_CANCELLED"], ["FILLED", "ORDER_FILLED"],
    ["PARTIAL_FILL", "ORDER_PARTIALLY_FILLED"], ["PARTIALLY_FILLED", "ORDER_PARTIALLY_FILLED"],
    ["POSITION", "POSITION_UPDATED"], ["ACCOUNT", "ACCOUNT_UPDATED"], ["HEARTBEAT", "PROVIDER_HEARTBEAT"], ["ERROR", "PROVIDER_ERROR"],
  ]);
  const mapped = aliases.get(normalized) || normalized;
  return BROKER_PROVIDER_EVENT_TYPES_V1.includes(mapped) ? mapped : "PROVIDER_ERROR";
}

function normalizeOrderStatus(value) {
  const normalized = upper(value).replaceAll("-", "_").replaceAll(" ", "_").replace(/^ORDER_/, "");
  if (["ACCEPTED", "WORKING", "PARTIALLY_FILLED", "FILLED", "CANCELLED", "REJECTED", "ERROR"].includes(normalized)) return normalized;
  if (normalized === "CANCELED") return "CANCELLED";
  if (normalized === "PROVIDER_ERROR") return "ERROR";
  return "UNKNOWN";
}

function externalKey(source, { providerId, eventType, occurredAt }) {
  const explicit = text(firstDefined(source.external_event_key, source.externalEventKey, source.event_key));
  if (explicit) return explicit;
  return `sha256:${canonicalSha256({ provider_id: providerId, account_id: firstDefined(source.account_id, source.broker_account_id, source.account), provider_order_ref: firstDefined(source.provider_order_ref, source.broker_order_ref, source.order_id), event_type: eventType, occurred_at_utc: occurredAt, payload: firstDefined(source.payload, source.data, {}) })}`;
}

function activeCommands(input) { return array(input).filter((item) => !["FAILED", "CANCELLED", "CANCELED", "EXPIRED", "ACKNOWLEDGED", "DONE"].includes(upper(item.status))); }
function accountId(intent, provider) { return text(firstDefined(intent.account_id, intent.broker_account_id, provider.account_id, provider.provider_account_id)); }
function issue(code, message) { return { code, message }; }
function normalizeAction(value) { const action = upper(value); if (action === "BUY" || action === "LONG") return "BUY"; if (action === "SELL" || action === "SHORT") return "SELL"; return ""; }
function normalizeSide(value) { const side = normalizeAction(value); return side || null; }
function integerOrNull(value) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : null; }
function numberOrNull(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function nullableText(value) { const valueText = text(value); return valueText || null; }
function hash(value) { return `sha256:${canonicalSha256(value)}`; }
function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
function array(value) { return Array.isArray(value) ? value : []; }
function firstDefined(...values) { return values.find((value) => value !== undefined && value !== null && value !== "") ?? null; }
function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).toUpperCase(); }
function iso(value) { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }
