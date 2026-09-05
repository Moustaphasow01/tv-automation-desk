import { average, countBy, firstValue, nested, number, rows, upper } from "./front-control-plane-projection-helpers.js";
import { accountRow, providerRows } from "./front-control-plane-row-mappers.js";
import { hasIncidentId } from "./front-control-plane-view-values.js";
import { incidentSummary } from "./front-control-plane-incident-projection.js";
import { circuitBreakerRows } from "./front-control-plane-risk-view.js";
import { text } from "./front-control-plane-common.js";

export function executionProviders({ execution, incidents, health, warnings }) {
  if (!nested(execution, ["performance"])) warnings.push("execution-provider-performance:UNAVAILABLE");
  const providers = providerRows(execution);
  const accounts = rows(execution?.accounts).filter((item) => item?.broker_account_id).map(accountRow);
  const commands = rows(execution?.providerCommands).map(providerCommandRow);
  const providerEvents = rows(execution?.providerEvents).map(providerEventRow);
  return {
    summary: executionProviderSummary({ execution, providers, accounts, incidents }),
    providers: providers.map((item, index) => executionProviderRow(item, index, execution)),
    accounts,
    adapters: [],
    healthChecks: providers.map(executionProviderHealthRow),
    switchWorkflow: [],
    events: [],
    incidents: rows(incidents).filter(hasIncidentId).map(incidentSummary),
    commandActions: [],
    executionModes: executionModesSummary(execution),
    circuitBreakers: circuitBreakerRows(execution, health),
    providerCommands: {
      counts: {
        all: commands.length,
        working: countBy(commands, (item) => ["pending", "leased", "sent"].includes(item.status)),
        pending: countBy(commands, (item) => item.status === "pending"),
        filled: countBy(commands, (item) => item.status === "filled"),
        partial: countBy(commands, (item) => item.status === "partially_filled"),
        rejected: countBy(commands, (item) => item.status === "rejected"),
        cancelled: countBy(commands, (item) => item.status === "cancelled"),
      },
      items: commands.slice(0, 100),
    },
    fills: providerEvents.filter((item) => item.classification === "FILL").slice(0, 30),
    partialFills: providerEvents.filter((item) => item.classification === "PARTIAL_FILL").slice(0, 30),
    rejectsAndCancels: providerEvents.filter((item) => item.classification === "REJECT_CANCEL").slice(0, 30),
  };
}

function providerCommandRow(item) {
  const envelope = item.payload || {};
  const payload = envelope.order_intent_payload || {};
  return {
    commandId: text(item.execution_provider_command_id, ""),
    orderIntentId: text(firstValue(item.portfolio_order_intent_id, item.order_intent_id), ""),
    providerId: text(item.broker_provider_code, "unavailable"),
    instrument: text(payload.instrument, "unavailable"),
    side: upper(text(firstValue(payload.action, payload.side), "unavailable")),
    quantity: number(payload.quantity, 0),
    commandType: text(item.command_type, "unavailable"),
    status: text(item.status, "unknown"),
    at: text(firstValue(item.available_at, item.created_at), "unavailable"),
  };
}

function providerEventRow(item) {
  const type = text(firstValue(item.event_type, item.event_status), "unavailable");
  return {
    eventId: text(firstValue(item.broker_provider_event_id, item.provider_event_id), ""),
    commandId: text(item.execution_provider_command_id, ""),
    orderIntentId: text(item.portfolio_order_intent_id, ""),
    eventType: type,
    status: text(item.event_status, "unavailable"),
    side: item.side ? upper(item.side) : null,
    quantity: item.quantity == null ? null : number(item.quantity, 0),
    fillQuantity: item.fill_quantity == null ? null : number(item.fill_quantity, 0),
    fillPrice: item.fill_price == null ? null : number(item.fill_price, 0),
    at: text(firstValue(item.occurred_at_utc, item.created_at), "unavailable"),
    classification: providerEventClassification(type),
  };
}

function providerEventClassification(type) {
  const normalized = upper(type);
  if (normalized.includes("PARTIAL")) return "PARTIAL_FILL";
  if (normalized.includes("FILL")) return "FILL";
  if (normalized.includes("REJECT") || normalized.includes("CANCEL")) return "REJECT_CANCEL";
  return "OTHER";
}

function executionModesSummary(execution) {
  const safety = execution?.safety || {};
  return {
    current: upper(text(safety.executionAuthorityMode, "unavailable")),
    executionEnabled: Boolean(safety.executionEnabled),
    manualTelegramExecutionEnabled: Boolean(safety.manualTelegramExecutionEnabled),
    entryOperatorApprovalRequired: Boolean(safety.entryOperatorApprovalRequired),
    liveAccountAllowed: Boolean(safety.liveAccountAllowed),
  };
}

function executionProviderSummary({ execution, providers, accounts, incidents }) {
  return {
    primaryProviderId: firstValue(nested(providers, [0, "providerId"]), "unavailable"),
    standbyProviderId: firstValue(nested(providers, [1, "providerId"]), "unavailable"),
    activeProviders: providers.length,
    degradedProviders: countBy(providers, (item) => item.status !== "OK"),
    avgLatencyMs: average(providers.map((item) => item.latencyMs)),
    fillRatePct: number(nested(execution, ["performance", "fill_rate_pct"]), 0),
    slippageR: number(nested(execution, ["performance", "slippage_r"]), 0),
    openIncidents: rows(incidents).filter(hasIncidentId).length,
    accounts: accounts.length,
  };
}

function executionProviderRow(item, index, execution) {
  return {
    ...item,
    adapter: item.providerId,
    state: item.status === "OK" ? primaryOrStandby(index) : "DEGRADED",
    role: primaryOrStandby(index),
    fillRatePct: number(nested(execution, ["performance", "fill_rate_pct"]), 0),
    browserExposure: "NONE",
  };
}

function executionProviderHealthRow(item) {
  return { checkId: `health_${item.providerId}`, label: item.label, detail: item.status, latencyMs: item.latencyMs, status: item.status === "OK" ? "PASS" : "WATCH" };
}

function primaryOrStandby(index) { return index === 0 ? "PRIMARY" : "STANDBY"; }
