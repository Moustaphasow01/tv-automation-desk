import assert from "node:assert/strict";
import test from "node:test";

import { TelegramAlertService, isTelegramTradingAlertSourceAllowed } from "../src/telegram-alert-service.js";
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

test("queued OrderIntent that expires before delivery is suppressed without contacting Telegram", async () => {
  const queries = [];
  const delivery = {
    delivery_id: "telegram_delivery_expired",
    profile: "trading",
    source_key: "order_intent:portfolio_order_intent_expired",
    source_kind: "order_intent",
    status: "pending",
    message: "must not be sent",
    payload: {
      source_state: "awaiting_confirmation",
      expires_at: "2026-08-31T16:30:33.423Z",
    },
    attempt_count: 0,
  };
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("FROM telegram_delivery_outbox") && sql.includes("FOR UPDATE SKIP LOCKED")) return { rows: [delivery] };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const persistence = {
    initialized: Promise.resolve(),
    pool: {
      async query(sql) {
        if (sql.includes("telegram_runtime_config")) {
          return { rows: [{ enabled: true, admin_enabled: true, trading_enabled: true, commands_enabled: true, revision: 1 }] };
        }
        return { rows: [] };
      },
      async connect() { return client; },
    },
  };
  const service = new TelegramAlertService({
    persistence,
    clock: { now: () => ({ utc: "2026-08-31T16:30:52.714Z" }) },
    env: {
      DESK_TELEGRAM_ENABLED: "true",
      TELEGRAM_ALERT_BOT_TOKEN: "test-token",
      TELEGRAM_ALERT_CHAT_ID: "123",
    },
  });
  let sends = 0;
  service.clients.trading.sendMessage = async () => { sends += 1; return { message_id: 1 }; };

  const result = await service.deliverNext();

  assert.deepEqual(result, {
    status: "suppressed",
    deliveryId: "telegram_delivery_expired",
    reason: "ORDER_INTENT_EXPIRED_BEFORE_TELEGRAM_DELIVERY",
  });
  assert.equal(sends, 0);
  assert.ok(queries.some(({ sql, params }) => sql.includes("status = 'suppressed'")
    && params[1] === "ORDER_INTENT_EXPIRED_BEFORE_TELEGRAM_DELIVERY"));
  assert.equal(queries.some(({ sql }) => sql.includes("telegram_delivery_attempts")), false);
});
