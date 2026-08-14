import assert from "node:assert/strict";
import test from "node:test";

import { isTelegramTradingAlertSourceAllowed } from "../src/telegram-alert-service.js";

test("Telegram trading projection ignores historical N14 acceptance artifacts", () => {
  assert.equal(isTelegramTradingAlertSourceAllowed({
    kind: "management_intent",
    sourceId: "management_intent_gateway_123",
    payload: {
      reason: "N14 physical acceptance: move_stop",
      trade_id: "trade_order_intent_gateway_123",
    },
  }), false);

  assert.equal(isTelegramTradingAlertSourceAllowed({
    kind: "order_intent",
    sourceId: "order_intent_real_123",
    payload: {
      strategy: "breakout_retest_v5",
      rationale: "Breakout confirmé sur MNQ, retest propre, risque borné.",
      decision_id: "trade_decision_real_123",
    },
  }), true);
});
