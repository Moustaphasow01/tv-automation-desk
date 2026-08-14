import { normalizeBrokerProviderEventV1 } from "./execution-provider-port-v1.js";

export const PICKMYTRADE_PROVIDER_ADAPTER_SCHEMA_VERSION_V1 = "pickmytrade_provider_adapter_v1";
export const PICKMYTRADE_PROVIDER_ADAPTER_STATUSES_V1 = Object.freeze(["ADAPTER_COMMAND_READY", "ADAPTER_BLOCKED"]);
export const PICKMYTRADE_EXECUTION_MODES_V1 = Object.freeze(["PAPER_ONLY"]);

const SENSITIVE_KEY_FRAGMENTS = Object.freeze(["token", "secret", "apikey", "api_key", "authorization", "password", "bearer"]);

export function adaptExecutionProviderCommandToPickMyTradeWebhookV1(input = {}) {
  const command = record(input.provider_command || input.command) || {};
  const now = text(input.now) || new Date().toISOString();
  const issues = pickMyTradeCommandIssues(command, input);
  return adapterResult({
    command,
    input,
    now,
    status: issues.length ? "ADAPTER_BLOCKED" : "ADAPTER_COMMAND_READY",
    issues,
    webhookPayload: issues.length ? null : pickMyTradeWebhookPayload(command, input),
  });
}

export function adaptPickMyTradeWebhookEventToBrokerProviderEventV1(input = {}) {
  const source = record(input.pickmytrade_event || input.webhook_event || input.event || input) || {};
  const payload = record(firstDefined(source.payload, source.data, source)) || {};
  return normalizeBrokerProviderEventV1({
    provider_id: text(firstDefined(input.provider_id, source.provider_id, "pickmytrade")),
    adapter_id: text(firstDefined(input.adapter_id, source.adapter_id, "pickmytrade-webhook")),
    account_id: firstDefined(source.account_id, source.broker_account_id, payload.account_id, payload.account),
    order_intent_id: firstDefined(source.order_intent_id, source.intent_id, payload.order_intent_id, payload.intent_id),
    execution_provider_command_id: firstDefined(source.execution_provider_command_id, source.command_id, payload.execution_provider_command_id),
    provider_order_ref: firstDefined(source.provider_order_ref, source.order_id, source.trade_id, payload.order_id, payload.trade_id),
    event_type: eventTypeFromPickMyTrade(source, payload),
    order_status: firstDefined(source.order_status, source.status, payload.order_status, payload.status),
    side: firstDefined(source.side, source.action, payload.side, payload.action),
    quantity: firstDefined(source.quantity, source.order_quantity, payload.quantity, payload.order_quantity),
    fill_quantity: firstDefined(source.fill_quantity, source.filled_quantity, payload.fill_quantity, payload.filled_quantity),
    fill_price: firstDefined(source.fill_price, source.avg_fill_price, payload.fill_price, payload.avg_fill_price, payload.price),
    position_size: firstDefined(source.position_size, source.net_position, payload.position_size, payload.net_position),
    instrument: firstDefined(source.instrument, source.symbol, payload.instrument, payload.symbol),
    occurred_at_utc: firstDefined(source.occurred_at_utc, source.timestamp, payload.occurred_at_utc, payload.timestamp),
    external_event_key: firstDefined(source.external_event_key, source.event_id, source.alert_id, payload.event_id, payload.alert_id),
    payload: { ...payload, pickmytrade_event_type: text(firstDefined(source.event_type, payload.event_type)), pickmytrade_status: text(firstDefined(source.status, payload.status)) },
    raw: source,
  });
}

function pickMyTradeCommandIssues(command, input) {
  return [
    ...sensitiveMaterialIssues(input),
    ...webhookUrlIssues(input),
    ...modeIssues(input),
    ...shapeIssues(command),
    ...providerIssues(command),
    ...entryPayloadIssues(command),
  ];
}

function sensitiveMaterialIssues(input) {
  const keys = sensitiveKeys(input, 0);
  return keys.length ? [issue("PICKMYTRADE_ADAPTER_SECRET_FORBIDDEN", `Sensitive material must stay outside the domain adapter: ${keys.slice(0, 3).join(", ")}.`)] : [];
}

function webhookUrlIssues(input) {
  const url = parsedWebhookUrl(input.webhook_url);
  if (url === undefined) return [];
  if (url === null) return text(input.webhook_url) ? [issue("PICKMYTRADE_ADAPTER_WEBHOOK_URL_INVALID", "Webhook URL must be a valid absolute URL.")] : [];
  return webhookUrlHasSensitivePart(url) ? [issue("PICKMYTRADE_ADAPTER_WEBHOOK_URL_SECRET_RISK", "Webhook URL must not include user info, query string or fragment.")] : [];
}

function modeIssues(input) {
  return bridgeMode(input) === "PAPER_ONLY" ? [] : [issue("PICKMYTRADE_ADAPTER_PAPER_ONLY_REQUIRED", "PickMyTrade bridge pilot is restricted to PAPER_ONLY mode.")];
}

function shapeIssues(command) {
  return [
    ...(!command || !Object.keys(command).length ? [issue("PICKMYTRADE_ADAPTER_COMMAND_REQUIRED", "Provider command is required.")] : []),
    ...(command.command_type !== "SUBMIT_ORDER" ? [issue("PICKMYTRADE_ADAPTER_UNSUPPORTED_COMMAND", "Only SUBMIT_ORDER is supported in the paper bridge slice.")] : []),
  ];
}

function providerIssues(command) {
  const providerId = lower(command.provider_id);
  return providerId && providerId !== "pickmytrade" ? [issue("PICKMYTRADE_ADAPTER_PROVIDER_MISMATCH", `Expected pickmytrade provider_id, received ${command.provider_id}.`)] : [];
}

function entryPayloadIssues(command) {
  const accountRef = record(command.account_ref) || {};
  const contractRef = record(command.contract_ref) || {};
  const protection = record(command.protection) || {};
  return missingIssues([
    [text(firstDefined(accountRef.provider_account_id, accountRef.account_id)), "PICKMYTRADE_ADAPTER_ACCOUNT_REQUIRED", "Provider account reference is required."],
    [text(contractRef.provider_symbol), "PICKMYTRADE_ADAPTER_SYMBOL_REQUIRED", "Provider symbol is required."],
    [["BUY", "SELL"].includes(text(command.action)), "PICKMYTRADE_ADAPTER_ACTION_REQUIRED", "BUY or SELL action is required."],
    [positiveInteger(command.quantity), "PICKMYTRADE_ADAPTER_QUANTITY_REQUIRED", "Positive integer quantity is required."],
    [number(protection.stop_price) !== null, "PICKMYTRADE_ADAPTER_STOP_REQUIRED", "Protective stop is required for paper bridge entries."],
    [number(protection.target_price) !== null, "PICKMYTRADE_ADAPTER_TARGET_REQUIRED", "Profit target is required for paper bridge entries."],
    [protection.oco_required !== false, "PICKMYTRADE_ADAPTER_OCO_REQUIRED", "OCO protection must remain required."],
  ]);
}

function missingIssues(requirements) {
  return requirements.filter(([accepted]) => !accepted).map(([, code, message]) => issue(code, message));
}

function adapterResult({ command, input, now, status, issues, webhookPayload }) {
  return {
    schema_version: PICKMYTRADE_PROVIDER_ADAPTER_SCHEMA_VERSION_V1,
    adapter_id: text(command.adapter_id) || "pickmytrade-webhook",
    provider_id: text(command.provider_id) || "pickmytrade",
    execution_provider_command_id: text(command.execution_provider_command_id),
    order_intent_id: text(command.order_intent_id),
    status,
    bridge_mode: bridgeMode(input) || null,
    bridge_classification: "PAPER_BRIDGE_LIMITED_RECONCILIATION",
    issued_at_utc: now,
    issues,
    transport: transportEnvelope(input),
    webhook_payload: webhookPayload,
  };
}

function pickMyTradeWebhookPayload(command, input) {
  return {
    schema_version: "desk_pickmytrade_bridge_payload_v1",
    provider: "pickmytrade",
    broker: lower(firstDefined(input.broker, input.broker_id, "tradovate")),
    bridge_mode: bridgeMode(input),
    account_id: text(command.account_ref.provider_account_id || command.account_ref.account_id),
    symbol: text(command.contract_ref.provider_symbol),
    action: lower(command.action),
    quantity: Number(command.quantity),
    order_type: lower(command.order_type),
    time_in_force: text(command.time_in_force),
    limit_price: nullableNumber(command.limit_price),
    entry_stop_price: nullableNumber(command.stop_price),
    stop_loss_price: nullableNumber(command.protection.stop_price),
    take_profit_price: nullableNumber(command.protection.target_price),
    oco_required: command.protection.oco_required !== false,
    max_slippage_ticks: nullableNumber(command.protection.max_slippage_ticks),
    client_ref: text(command.idempotency_key),
    order_intent_id: text(command.order_intent_id),
    execution_provider_command_id: text(command.execution_provider_command_id),
  };
}

function transportEnvelope(input) {
  return {
    method: "POST",
    webhook_url: text(input.webhook_url) || null,
    content_type: "application/json",
    secret_material_included: false,
  };
}

function eventTypeFromPickMyTrade(source, payload) {
  const value = lower(firstDefined(source.event_type, source.type, source.status, payload.event_type, payload.type, payload.status));
  if (["accepted", "acknowledged", "delivered", "queued", "sent"].includes(value)) return "ORDER_ACCEPTED";
  if (["working", "submitted", "open"].includes(value)) return "ORDER_WORKING";
  if (["rejected", "failed", "error"].includes(value)) return "ORDER_REJECTED";
  if (["filled", "fill"].includes(value)) return "ORDER_FILLED";
  if (["partial", "partial_fill", "partially_filled"].includes(value)) return "ORDER_PARTIALLY_FILLED";
  if (["cancelled", "canceled"].includes(value)) return "ORDER_CANCELLED";
  if (["position", "position_updated"].includes(value)) return "POSITION_UPDATED";
  if (["account", "account_updated"].includes(value)) return "ACCOUNT_UPDATED";
  if (["protection", "protection_updated", "oco_updated"].includes(value)) return "PROTECTION_UPDATED";
  if (["heartbeat", "connected", "reconnected"].includes(value)) return "PROVIDER_HEARTBEAT";
  return "PROVIDER_ERROR";
}

function sensitiveKeys(value, depth) {
  if (depth > 2) return [];
  const source = record(value);
  if (!source) return [];
  return Object.entries(source).flatMap(([key, child]) => {
    const normalized = lower(key).replaceAll("-", "_");
    if (SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment))) return [key];
    return sensitiveKeys(child, depth + 1).map((nestedKey) => `${key}.${nestedKey}`);
  });
}

function bridgeMode(input) {
  const mode = upper(firstDefined(input.mode, input.bridge_mode, input.execution_mode));
  return mode === "PAPER_ONLY" || mode === "PAPER" ? "PAPER_ONLY" : "";
}

function parsedWebhookUrl(value) {
  const url = text(value);
  if (!url) return undefined;
  try { return new URL(url); } catch { return null; }
}

function webhookUrlHasSensitivePart(url) {
  return Boolean(url.username || url.password || url.search || url.hash);
}

function issue(code, message) { return { code, message }; }
function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
function firstDefined(...values) { return values.find((value) => value !== undefined && value !== null && value !== "") ?? null; }
function text(value) { return String(value ?? "").trim(); }
function lower(value) { return text(value).toLowerCase(); }
function upper(value) { return text(value).toUpperCase(); }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function nullableNumber(value) { return number(value); }
function positiveInteger(value) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0; }
