import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adaptExecutionProviderCommandToPickMyTradeWebhookV1,
  adaptPickMyTradeWebhookEventToBrokerProviderEventV1,
  buildExecutionProviderCommandV1,
} from "../index.js";

const now = "2026-08-10T08:00:00.000Z";

describe("pickmytrade provider adapter v1", () => {
  it("translates a provider-neutral submit command into a paper webhook envelope", () => {
    const plan = pickMyTradePlan();
    const adapted = adaptExecutionProviderCommandToPickMyTradeWebhookV1({
      provider_command: plan.provider_command,
      mode: "PAPER_ONLY",
      broker: "tradovate",
      webhook_url: "https://webhook.pickmytrade.trade/add-trade-data",
      now,
    });

    assert.equal(adapted.status, "ADAPTER_COMMAND_READY");
    assert.equal(adapted.bridge_mode, "PAPER_ONLY");
    assert.equal(adapted.transport.secret_material_included, false);
    assert.equal(adapted.webhook_payload.account_id, "pickmytrade_tradovate_trial");
    assert.equal(adapted.webhook_payload.symbol, "MNQ 09-26");
    assert.equal(adapted.webhook_payload.action, "buy");
    assert.equal(adapted.webhook_payload.quantity, 1);
    assert.equal(adapted.webhook_payload.stop_loss_price, 27900);
    assert.equal(adapted.webhook_payload.take_profit_price, 28100);
    assert.equal(adapted.webhook_payload.client_ref, plan.provider_command.idempotency_key);
    assert.equal("token" in adapted.webhook_payload, false);
  });

  it("fails closed outside the paper-only pilot mode", () => {
    const adapted = adaptExecutionProviderCommandToPickMyTradeWebhookV1({
      provider_command: pickMyTradePlan().provider_command,
      mode: "LIVE",
      now,
    });

    assert.equal(adapted.status, "ADAPTER_BLOCKED");
    assert.equal(adapted.webhook_payload, null);
    assert.equal(adapted.issues.some((issue) => issue.code === "PICKMYTRADE_ADAPTER_PAPER_ONLY_REQUIRED"), true);
  });

  it("rejects sensitive material in adapter input", () => {
    const adapted = adaptExecutionProviderCommandToPickMyTradeWebhookV1({
      provider_command: pickMyTradePlan().provider_command,
      mode: "PAPER_ONLY",
      token: "operator-token-must-not-enter-domain",
      now,
    });

    assert.equal(adapted.status, "ADAPTER_BLOCKED");
    assert.equal(adapted.webhook_payload, null);
    assert.equal(adapted.issues.some((issue) => issue.code === "PICKMYTRADE_ADAPTER_SECRET_FORBIDDEN"), true);
  });

  it("rejects webhook URLs that carry sensitive URL parts", () => {
    const adapted = adaptExecutionProviderCommandToPickMyTradeWebhookV1({
      provider_command: pickMyTradePlan().provider_command,
      mode: "PAPER_ONLY",
      webhook_url: "https://webhook.pickmytrade.trade/add-trade-data?token=forbidden",
      now,
    });

    assert.equal(adapted.status, "ADAPTER_BLOCKED");
    assert.equal(adapted.webhook_payload, null);
    assert.equal(adapted.issues.some((issue) => issue.code === "PICKMYTRADE_ADAPTER_WEBHOOK_URL_SECRET_RISK"), true);
  });

  it("normalizes a PickMyTrade status event into broker provider event v1", () => {
    const event = adaptPickMyTradeWebhookEventToBrokerProviderEventV1({
      pickmytrade_event: {
        event_id: "pmt-event-1",
        status: "filled",
        account_id: "pickmytrade_tradovate_trial",
        order_intent_id: "intent-1",
        execution_provider_command_id: "execution_provider_command_1",
        order_id: "PMT-123",
        symbol: "MNQ 09-26",
        action: "BUY",
        quantity: 1,
        filled_quantity: 1,
        avg_fill_price: 28010.25,
        timestamp: "2026-08-10T08:01:00.000Z",
      },
      now,
    });

    assert.equal(event.schema_version, "broker_provider_event_v1");
    assert.equal(event.provider_id, "pickmytrade");
    assert.equal(event.adapter_id, "pickmytrade-webhook");
    assert.equal(event.event_type, "ORDER_FILLED");
    assert.equal(event.order_status, "FILLED");
    assert.equal(event.external_event_key, "pmt-event-1");
    assert.equal(event.provider_order_ref, "PMT-123");
    assert.equal(event.fill_quantity, 1);
    assert.equal(event.fill_price, 28010.25);
  });
});

function pickMyTradePlan() {
  return buildExecutionProviderCommandV1({
    as_of_utc: now,
    provider_profile: { provider_id: "pickmytrade", adapter_id: "pickmytrade-webhook" },
    order_intent: orderIntent(),
  });
}

function orderIntent() {
  return {
    order_intent_id: "intent-1",
    account_id: "desk-paper-account",
    broker_account_id: "desk-paper-account",
    provider_account_id: "pickmytrade_tradovate_trial",
    instrument: "MNQ",
    provider_id: "pickmytrade",
    provider_contract_ref: { provider_id: "pickmytrade", provider_contract_id: "pmt-mnq-09-26", provider_symbol: "MNQ 09-26", instrument: "MNQ" },
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
