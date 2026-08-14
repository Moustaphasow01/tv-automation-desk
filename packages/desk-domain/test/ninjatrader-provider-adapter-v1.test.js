import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adaptExecutionProviderCommandToNinjaAddonV1,
  adaptNinjaAddonEventToBrokerProviderEventV1,
  buildExecutionProviderCommandV1,
} from "../index.js";

const now = "2026-08-10T08:00:00.000Z";

describe("ninjatrader provider adapter v1", () => {
  it("translates a provider-neutral submit command into a safe AddOn entry command", () => {
    const plan = buildExecutionProviderCommandV1({ as_of_utc: now, provider_profile: { provider_id: "ninjatrader", adapter_id: "ninjatrader-addon" }, order_intent: orderIntent() });
    const adapted = adaptExecutionProviderCommandToNinjaAddonV1({
      provider_command: plan.provider_command,
      account_name: "Sim101",
      atm_strategy_name: "TVA_SIM_SAFE_1X_320_400",
      atm_strategy_id: "desk_atm_intent_1",
      now,
    });

    assert.equal(adapted.status, "ADAPTER_COMMAND_READY");
    assert.equal(adapted.addon_command.action, "place_entry");
    assert.equal(adapted.addon_command.account_name, "Sim101");
    assert.equal(adapted.addon_command.instrument, "MNQ 09-26");
    assert.equal(adapted.addon_command.quantity, 1);
    assert.equal(adapted.addon_command.protective_stop, 27900);
    assert.equal(adapted.addon_command.profit_target, 28100);
    assert.equal(adapted.addon_command.atm_strategy_name, "TVA_SIM_SAFE_1X_320_400");
  });

  it("fails closed when an adapter-specific safety prerequisite is missing", () => {
    const plan = buildExecutionProviderCommandV1({ as_of_utc: now, provider_profile: { provider_id: "ninjatrader", adapter_id: "ninjatrader-addon" }, order_intent: orderIntent() });
    const adapted = adaptExecutionProviderCommandToNinjaAddonV1({ provider_command: plan.provider_command, account_name: "Live001", now });

    assert.equal(adapted.status, "ADAPTER_BLOCKED");
    assert.equal(adapted.addon_command, null);
    assert.deepEqual(adapted.issues.map((issue) => issue.code), [
      "NINJA_ADAPTER_SIM_ACCOUNT_REQUIRED",
      "NINJA_ADAPTER_ATM_TEMPLATE_REQUIRED",
      "NINJA_ADAPTER_ATM_ID_REQUIRED",
    ]);
  });

  it("normalizes AddOn execution events into broker provider events", () => {
    const event = adaptNinjaAddonEventToBrokerProviderEventV1({
      provider_id: "ninjatrader",
      adapter_id: "ninjatrader-addon",
      account_id: "ninjatrader_paper_local",
      addon_event: {
        event_type: "execution",
        event_id: "addon-event-fill-1",
        intent_id: "intent-1",
        command_id: "execution_provider_command_1",
        occurred_at: "2026-08-10T08:01:00.000Z",
        payload: { order_id: "NT-123", instrument: "MNQ 09-26", side: "BUY", quantity: 2, filled: 1, price: 28010.25 },
      },
      now,
    });

    assert.equal(event.schema_version, "broker_provider_event_v1");
    assert.equal(event.event_type, "ORDER_PARTIALLY_FILLED");
    assert.equal(event.provider_id, "ninjatrader");
    assert.equal(event.adapter_id, "ninjatrader-addon");
    assert.equal(event.order_intent_id, "intent-1");
    assert.equal(event.external_event_key, "addon-event-fill-1");
    assert.equal(event.fill_quantity, 1);
    assert.equal(event.fill_price, 28010.25);
  });
});

function orderIntent() {
  return {
    order_intent_id: "intent-1",
    account_id: "ninjatrader_paper_local",
    broker_account_id: "ninjatrader_paper_local",
    instrument: "MNQ",
    provider_id: "ninjatrader",
    provider_contract_ref: { provider_id: "ninjatrader", provider_contract_id: "nt-mnq-09-26", provider_symbol: "MNQ 09-26", instrument: "MNQ" },
    action: "BUY",
    quantity: 1,
    order_type: "MARKET",
    time_in_force: "DAY",
    lifecycle_action: "OPEN",
    broker_submission_allowed: true,
    protection: { required: true, ready: true, stop_price: 27900, target_price: 28100, max_slippage_ticks: 4, oco_required: true },
    idempotency_key: "intent-key-1",
  };
}
