import assert from "node:assert/strict";
import test from "node:test";

import { isTelegramTradingAlertSourceAllowed } from "../src/telegram-alert-service.js";
import { telegramRetryDelaySeconds, telegramSourceKindsToBaseline } from "../src/telegram-alert-utilities.js";

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

test("new Telegram source kinds are baselined without replaying historical rows", () => {
  const candidates = [
    { sourceKind: "known_kind", sourceKey: "known:2" },
    { sourceKind: "canonical_order_intent", sourceKey: "intent:old-1" },
    { sourceKind: "canonical_order_intent", sourceKey: "intent:old-2" },
  ];
  assert.deepEqual(
    [...telegramSourceKindsToBaseline({ candidates, existingSourceKinds: ["known_kind"] })],
    ["canonical_order_intent"],
  );
  assert.deepEqual(
    [...telegramSourceKindsToBaseline({ candidates, existingSourceKinds: [], globalBaseline: true })].sort(),
    ["canonical_order_intent", "known_kind"],
  );
});

test("Telegram retries honor the provider retry-after window", () => {
  assert.equal(telegramRetryDelaySeconds({ retryAfterSeconds: 26 }, 1), 27);
  assert.equal(telegramRetryDelaySeconds({}, 3), 60);
  assert.equal(telegramRetryDelaySeconds({ retryAfterSeconds: 600 }, 1), 300);
});
