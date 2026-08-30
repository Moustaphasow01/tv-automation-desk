import assert from "node:assert/strict";
import test from "node:test";
import { TelegramClient } from "../src/telegram-client.js";

test("Telegram client sends without exposing its token in the payload", async () => {
  const calls = [];
  const client = new TelegramClient({
    token: "123456:test-token-secret",
    profile: "admin",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        async json() { return { ok: true, result: { message_id: 42 } }; },
      };
    },
  });
  const result = await client.sendMessage({ chatId: "100", text: "Desk test", silent: true });
  assert.equal(result.message_id, 42);
  assert.equal(JSON.parse(calls[0].init.body).chat_id, "100");
  assert.equal(JSON.parse(calls[0].init.body).disable_notification, true);
  assert.equal(calls[0].init.body.includes("test-token-secret"), false);
});

test("Telegram client classifies rate limiting as retryable", async () => {
  const client = new TelegramClient({
    token: "123456:test-token-secret",
    profile: "trading",
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      async json() { return { ok: false, error_code: 429, description: "retry later", parameters: { retry_after: 26 } }; },
    }),
  });
  await assert.rejects(
    client.getMe(),
    (error) => error.code === "TELEGRAM_HTTP_429" && error.retryable === true && error.retryAfterSeconds === 26,
  );
});

test("Telegram client truncates messages below the platform limit", async () => {
  let payload;
  const client = new TelegramClient({
    token: "123456:test-token-secret",
    profile: "admin",
    fetchImpl: async (_url, init) => {
      payload = JSON.parse(init.body);
      return { ok: true, async json() { return { ok: true, result: { message_id: 1 } }; } };
    },
  });
  await client.sendMessage({ chatId: "100", text: "x".repeat(5000) });
  assert.equal(payload.text.length, 4000);
});

test("Telegram client can delete a bot-owned deployment message", async () => {
  let payload;
  const client = new TelegramClient({
    token: "123456:test-token-secret",
    profile: "admin",
    fetchImpl: async (_url, init) => {
      payload = JSON.parse(init.body);
      return { ok: true, async json() { return { ok: true, result: true }; } };
    },
  });
  assert.equal(await client.deleteMessage({ chatId: "100", messageId: 42 }), true);
  assert.deepEqual(payload, { chat_id: "100", message_id: 42 });
});
