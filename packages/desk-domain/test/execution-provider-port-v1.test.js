import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BROKER_PROVIDER_EVENT_SCHEMA_VERSION_V1,
  buildExecutionProviderCommandV1,
  normalizeBrokerProviderEventV1,
} from "../index.js";

describe("execution-provider-port-v1", () => {
  it("builds a provider-neutral command from a submittable OrderIntent", () => {
    const plan = buildExecutionProviderCommandV1({
      as_of_utc: "2026-08-10T08:00:00.000Z",
      provider_profile: { provider_id: "paper-provider", adapter_id: "paper-adapter" },
      order_intent: orderIntent(),
    });

    assert.equal(plan.status, "COMMAND_READY");
    assert.equal(plan.provider_command.command_type, "SUBMIT_ORDER");
    assert.equal(plan.provider_command.provider_id, "paper-provider");
    assert.equal(plan.provider_command.account_ref.provider_account_id, "paper-sim101");
    assert.equal(plan.provider_command.contract_ref.provider_symbol, "MNQ SEP26");
    assert.equal(plan.provider_command.action, "BUY");
    assert.equal(plan.provider_command.quantity, 2);
    assert.equal(plan.provider_command.protection.stop_price, 27900);
    assert.equal(plan.provider_command.source.kind, "ORDER_INTENT");
    assert.equal(JSON.stringify(plan.provider_command).includes("NinjaTrader"), false);
  });

  it("blocks non submittable or unsupported commands before any adapter write", () => {
    const blocked = buildExecutionProviderCommandV1({
      command_type: "SUBMIT_ORDER",
      provider_profile: { provider_id: "paper-provider", enabled: false, supported_command_types: ["SYNC_ORDERS"] },
      order_intent: { ...orderIntent(), broker_submission_allowed: false },
    });

    assert.equal(blocked.status, "BLOCKED");
    assert.equal(blocked.provider_command, null);
    assert.deepEqual(blocked.issues.map((issue) => issue.code), ["PROVIDER_DISABLED", "COMMAND_NOT_SUPPORTED_BY_PROVIDER", "ORDER_INTENT_NOT_SUBMITTABLE"]);
  });

  it("protects idempotency when an active provider command already represents the intent", () => {
    const first = buildExecutionProviderCommandV1({ provider_profile: { provider_id: "paper-provider" }, order_intent: orderIntent() });
    const second = buildExecutionProviderCommandV1({
      provider_profile: { provider_id: "paper-provider" },
      order_intent: orderIntent(),
      active_provider_commands: [{ execution_provider_command_id: "execution_provider_command_existing", status: "pending", idempotency_key: first.idempotency_key }],
    });

    assert.equal(second.status, "DUPLICATE_PROTECTED");
    assert.equal(second.provider_command, null);
    assert.equal(second.duplicate_provider_command_id, "execution_provider_command_existing");
  });

  it("normalizes provider broker events with deterministic external keys and hashes", () => {
    const event = normalizeBrokerProviderEventV1({
      provider_id: "paper-provider",
      adapter_id: "paper-adapter",
      account_id: "paper-sim101",
      order_intent_id: "intent-1",
      provider_order_ref: "PO-123",
      event_type: "partial_fill",
      fill_quantity: 1,
      fill_price: 28010.25,
      occurred_at_utc: "2026-08-10T08:01:00.000Z",
      payload: { fill_id: "fill-1" },
    });
    const repeated = normalizeBrokerProviderEventV1({ ...event, broker_provider_event_id: "ignored" });

    assert.equal(event.schema_version, BROKER_PROVIDER_EVENT_SCHEMA_VERSION_V1);
    assert.equal(event.event_type, "ORDER_PARTIALLY_FILLED");
    assert.equal(event.order_status, "PARTIALLY_FILLED");
    assert.equal(event.fill_quantity, 1);
    assert.equal(event.external_event_key.startsWith("sha256:"), true);
    assert.equal(repeated.external_event_key, event.external_event_key);
  });
});

function orderIntent(overrides = {}) {
  return {
    schema_version: "portfolio_order_intent_v1",
    order_intent_id: "intent-1",
    target_position_id: "target-1",
    account_id: "paper-sim101",
    broker_account_id: "paper-sim101",
    instrument: "MNQ",
    provider_id: "paper-provider",
    provider_contract_ref: { provider_id: "paper-provider", provider_contract_id: "mnq-sep26", provider_symbol: "MNQ SEP26", instrument: "MNQ" },
    action: "BUY",
    quantity: 2,
    order_type: "MARKET",
    time_in_force: "DAY",
    lifecycle_action: "OPEN",
    broker_submission_allowed: true,
    protection: { required: true, ready: true, stop_price: 27900, target_price: 28100, max_slippage_ticks: 4, oco_required: true },
    idempotency_key: "intent-key-1",
    order_intent_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ...overrides,
  };
}
