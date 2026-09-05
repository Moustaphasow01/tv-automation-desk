import assert from "node:assert/strict";
import test from "node:test";
import { deliverTelegramCandidate } from "../src/telegram-delivery-runtime.js";

function fixture({ failure, receiptCommitFailure = false } = {}) {
  const delivery = { delivery_id: "delivery_test", profile: "trading", source_kind: "manual_test",
    source_key: "test", message: "TEST ONLY — no order", silent: true, payload: {}, attempt_count: 0, status: "pending" };
  const queries = [];
  let sends = 0;
  let commits = 0;
  let snapshot;
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql === "BEGIN") snapshot = { ...delivery };
      if (sql === "ROLLBACK") Object.assign(delivery, snapshot);
      if (sql === "COMMIT" && ++commits === 2 && receiptCommitFailure) throw new Error("injected_commit_failure");
      if (sql.includes("FOR UPDATE SKIP LOCKED")) return { rows: delivery.status === "pending" ? [{ ...delivery }] : [], rowCount: 1 };
      if (sql.includes("UPDATE telegram_delivery_outbox")) {
        if (sql.includes("SET status = 'sending'")) Object.assign(delivery, { status: "sending", lease_token: params[2] });
        else if (sql.includes("SET status = 'sent'")) delivery.status = "sent";
        else if (sql.includes("SET status = $2")) delivery.status = params[1];
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const options = { pool: { connect: async () => client }, config: { enabled: true, tradingEnabled: true },
    environment: { workerEnabled: true, tradingConfigured: true }, chatIds: { trading: "test-only" },
    nowMs: Date.parse("2026-09-05T10:00:00Z"), minIntervalMs: 1200,
    clients: { trading: { async sendMessage() { sends++; if (failure) throw failure; return { message_id: 42 }; } } } };
  return { options, queries, delivery, sendCount: () => sends };
}

test("Telegram receipt commits before a successful delivery is reported", async () => {
  const f = fixture();
  assert.equal((await deliverTelegramCandidate(f.options)).status, "sent");
  assert.equal(f.delivery.status, "sent");
  assert.equal(f.sendCount(), 1);
});

test("explicit Telegram rate rejection is retryable, not an uncertain delivery", async () => {
  const f = fixture({ failure: Object.assign(new Error("rate limit"), {
    code: "TELEGRAM_HTTP_429", retryable: true, deliveryUncertain: false, retryAfterSeconds: 26,
  }) });
  assert.equal((await deliverTelegramCandidate(f.options)).status, "pending");
  assert.ok(f.queries.some(q => q.sql.includes("available_at_utc = CASE") && q.params[2] === 27));
});

test("lost Telegram response remains uncertain and is not selected for another send", async () => {
  const f = fixture({ failure: new Error("network lost after request") });
  assert.equal((await deliverTelegramCandidate(f.options)).status, "uncertain");
  assert.equal((await deliverTelegramCandidate(f.options)).status, "idle");
  assert.equal(f.sendCount(), 1);
});

test("sent message with failed DB commit stays uncertain without an automatic second send", async () => {
  const f = fixture({ receiptCommitFailure: true });
  const result = await deliverTelegramCandidate(f.options);
  assert.equal(result.status, "uncertain");
  assert.equal(result.error, "TELEGRAM_RECEIPT_COMMIT_UNCERTAIN");
  assert.equal((await deliverTelegramCandidate(f.options)).status, "idle");
  assert.equal(f.sendCount(), 1);
  assert.equal(f.queries.some(q => q.sql.includes("SET status = $2") && q.params[1] === "pending"), false);
});

test("invalid message receipt is never reported as sent", async () => {
  const f = fixture();
  f.options.clients.trading.sendMessage = async () => ({});
  const result = await deliverTelegramCandidate(f.options);
  assert.equal(result.status, "uncertain");
  assert.equal(result.error, "TELEGRAM_MESSAGE_ID_UNVERIFIED");
});

test("muting uses the caller clock and never contacts Telegram", async () => {
  const f = fixture();
  f.options.config.mutedUntil = "2026-09-05T10:01:00Z";
  assert.equal((await deliverTelegramCandidate(f.options)).status, "muted");
  assert.equal(f.sendCount(), 0);
  assert.equal(f.queries.length, 0);
});
