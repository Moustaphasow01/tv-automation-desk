import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adaptExecutionProviderCommandToNinjaAddonV1,
  adaptExecutionProviderCommandToPickMyTradeWebhookV1,
  adaptNinjaAddonEventToBrokerProviderEventV1,
  adaptPickMyTradeWebhookEventToBrokerProviderEventV1,
  buildExecutionProviderCommandV1,
} from "../index.js";

const now = "2026-08-10T08:00:00.000Z";

describe("execution provider multi-provider contract v1", () => {
  it("preserves canonical OrderIntent semantics across NinjaTrader and PickMyTrade adapters", () => {
    const ninjaPlan = buildPlan("ninjatrader");
    const pickPlan = buildPlan("pickmytrade");
    const ninja = adaptNinja(ninjaPlan.provider_command);
    const pick = adaptPickMyTrade(pickPlan.provider_command);

    assert.equal(ninjaPlan.status, "COMMAND_READY");
    assert.equal(pickPlan.status, "COMMAND_READY");
    assert.deepEqual(commandSemantics(ninjaPlan.provider_command), commandSemantics(pickPlan.provider_command));
    assert.equal(JSON.stringify(ninjaPlan.provider_command).includes("webhook"), false);
    assert.equal(JSON.stringify(pickPlan.provider_command).includes("Sim101"), false);
    assert.equal(ninja.status, "ADAPTER_COMMAND_READY");
    assert.equal(pick.status, "ADAPTER_COMMAND_READY");
    assert.equal(ninja.addon_command.protective_stop, pick.webhook_payload.stop_loss_price);
    assert.equal(ninja.addon_command.profit_target, pick.webhook_payload.take_profit_price);
  });

  it("protects duplicate submission per provider while keeping provider scopes distinct", () => {
    const firstNinja = buildPlan("ninjatrader");
    const duplicateNinja = buildPlan("ninjatrader", { active_provider_commands: [activeCommand(firstNinja)] });
    const pickWithNinjaActive = buildPlan("pickmytrade", { active_provider_commands: [activeCommand(firstNinja)] });

    assert.equal(duplicateNinja.status, "DUPLICATE_PROTECTED");
    assert.equal(duplicateNinja.provider_command, null);
    assert.equal(pickWithNinjaActive.status, "COMMAND_READY");
    assert.notEqual(firstNinja.idempotency_key, pickWithNinjaActive.idempotency_key);
  });

  it("normalizes fill reject protection and heartbeat events into the shared broker event contract", () => {
    for (const [label, expectedType, ninjaInput, pickInput] of eventScenarios()) {
      const ninjaEvent = adaptNinjaAddonEventToBrokerProviderEventV1(ninjaInput);
      const pickEvent = adaptPickMyTradeWebhookEventToBrokerProviderEventV1(pickInput);

      assert.equal(ninjaEvent.schema_version, "broker_provider_event_v1", label);
      assert.equal(pickEvent.schema_version, "broker_provider_event_v1", label);
      assert.equal(ninjaEvent.event_type, expectedType, label);
      assert.equal(pickEvent.event_type, expectedType, label);
      assert.equal(ninjaEvent.provider_id, "ninjatrader", label);
      assert.equal(pickEvent.provider_id, "pickmytrade", label);
    }
  });

  it("fails closed for unimplemented management and sync commands at each provider adapter edge", () => {
    for (const commandType of ["MOVE_STOP", "MOVE_TARGET", "CANCEL_ORDER", "SYNC_POSITIONS"]) {
      const ninjaPlan = buildPlan("ninjatrader", { command_type: commandType });
      const pickPlan = buildPlan("pickmytrade", { command_type: commandType });

      assert.equal(adaptNinja(ninjaPlan.provider_command).status, "ADAPTER_BLOCKED", commandType);
      assert.equal(adaptPickMyTrade(pickPlan.provider_command).status, "ADAPTER_BLOCKED", commandType);
    }
  });
});

function buildPlan(provider, overrides = {}) {
  return buildExecutionProviderCommandV1({
    as_of_utc: now,
    command_type: overrides.command_type || "SUBMIT_ORDER",
    provider_profile: providerProfile(provider),
    order_intent: orderIntent(provider),
    active_provider_commands: overrides.active_provider_commands || [],
  });
}

function providerProfile(provider) {
  return provider === "ninjatrader"
    ? { provider_id: "ninjatrader", adapter_id: "ninjatrader-addon" }
    : { provider_id: "pickmytrade", adapter_id: "pickmytrade-webhook" };
}

function orderIntent(provider) {
  return {
    order_intent_id: "intent-multi-provider-1",
    account_id: `${provider}_paper_account`,
    broker_account_id: `${provider}_paper_account`,
    provider_account_id: provider === "ninjatrader" ? "ninjatrader_paper_local" : "pickmytrade_tradovate_trial",
    instrument: "MNQ",
    provider_id: provider,
    provider_contract_ref: { provider_id: provider, provider_contract_id: `${provider}-mnq-09-26`, provider_symbol: "MNQ 09-26", instrument: "MNQ" },
    action: "BUY",
    quantity: 1,
    order_type: "MARKET",
    time_in_force: "DAY",
    lifecycle_action: "OPEN",
    broker_submission_allowed: true,
    protection: { required: true, ready: true, stop_price: 27900, target_price: 28100, max_slippage_ticks: 4, oco_required: true },
    idempotency_key: "intent-multi-provider-key-1",
  };
}

function adaptNinja(command) {
  return adaptExecutionProviderCommandToNinjaAddonV1({
    provider_command: command,
    account_name: "Sim101",
    atm_strategy_name: "TVA_SIM_SAFE_1X_320_400",
    atm_strategy_id: "desk_atm_intent_multi_provider_1",
    now,
  });
}

function adaptPickMyTrade(command) {
  return adaptExecutionProviderCommandToPickMyTradeWebhookV1({
    provider_command: command,
    mode: "PAPER_ONLY",
    broker: "tradovate",
    webhook_url: "https://webhook.pickmytrade.trade/add-trade-data",
    now,
  });
}

function commandSemantics(command) {
  return {
    command_type: command.command_type,
    order_intent_id: command.order_intent_id,
    action: command.action,
    quantity: command.quantity,
    order_type: command.order_type,
    time_in_force: command.time_in_force,
    stop_price: command.protection.stop_price,
    target_price: command.protection.target_price,
    oco_required: command.protection.oco_required,
  };
}

function activeCommand(plan) {
  return { execution_provider_command_id: plan.provider_command.execution_provider_command_id, status: "pending", idempotency_key: plan.idempotency_key };
}

function eventScenarios() {
  return [
    ["fill", "ORDER_FILLED", ninjaExecution("ninja-fill-1", { filled: 1, price: 28010.25 }), pickStatus("pick-fill-1", { status: "filled", filled_quantity: 1, avg_fill_price: 28010.25 })],
    ["reject", "ORDER_REJECTED", ninjaCommand("ninja-reject-1", "rejected"), pickStatus("pick-reject-1", { status: "rejected" })],
    ["protection", "PROTECTION_UPDATED", ninjaProtection("ninja-protection-1"), pickStatus("pick-protection-1", { event_type: "protection_updated" })],
    ["heartbeat", "PROVIDER_HEARTBEAT", ninjaConnection("ninja-heartbeat-1"), pickStatus("pick-heartbeat-1", { event_type: "heartbeat" })],
  ];
}

function ninjaExecution(eventId, payload) {
  return { provider_id: "ninjatrader", adapter_id: "ninjatrader-addon", account_id: "ninjatrader_paper_local", addon_event: baseNinjaEvent("execution", eventId, payload) };
}

function ninjaCommand(eventId, status) {
  return { provider_id: "ninjatrader", adapter_id: "ninjatrader-addon", account_id: "ninjatrader_paper_local", addon_event: baseNinjaEvent("command", eventId, { status }) };
}

function ninjaProtection(eventId) {
  return { provider_id: "ninjatrader", adapter_id: "ninjatrader-addon", account_id: "ninjatrader_paper_local", addon_event: baseNinjaEvent("command", eventId, { status: "protection_updated", stop_price: 27925 }) };
}

function ninjaConnection(eventId) {
  return { provider_id: "ninjatrader", adapter_id: "ninjatrader-addon", account_id: "ninjatrader_paper_local", addon_event: baseNinjaEvent("connection", eventId, { status: "connected" }) };
}

function baseNinjaEvent(eventType, eventId, payload) {
  return { event_type: eventType, event_id: eventId, intent_id: "intent-multi-provider-1", command_id: "execution_provider_command_1", occurred_at: now, payload: { order_id: `${eventId}-order`, instrument: "MNQ 09-26", side: "BUY", quantity: 1, ...payload } };
}

function pickStatus(eventId, overrides) {
  return { pickmytrade_event: { event_id: eventId, account_id: "pickmytrade_tradovate_trial", order_intent_id: "intent-multi-provider-1", execution_provider_command_id: "execution_provider_command_2", order_id: `${eventId}-order`, symbol: "MNQ 09-26", action: "BUY", quantity: 1, timestamp: now, ...overrides } };
}
