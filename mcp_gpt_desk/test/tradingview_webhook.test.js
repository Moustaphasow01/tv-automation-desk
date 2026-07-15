import assert from "node:assert/strict";
import test from "node:test";
import { ingestTradingViewWebhook } from "../src/tradingview-webhook.js";

test("local TradingView webhook validates, strips secrets and writes canonical documents", async () => {
  const persistence = new RecordingPersistence();
  const result = await ingestTradingViewWebhook({
    persistence,
    secret: "test-secret",
    now: new Date("2026-07-15T10:01:00.000Z"),
    body: {
      token: "test-secret",
      alert_id: "alert-1",
      symbol: "CME_MINI:MES1!",
      timeframe: "5",
      timestamp_utc: "2026-07-15T10:00:00.000Z",
      bar_status: "closed",
      open: 100,
      high: 103,
      low: 99,
      close: 102,
      volume: 42,
      studies: { rsi_14: 55 },
    },
  });

  assert.equal(result.statusCode, 202);
  assert.equal(result.body.accepted, 1);
  assert.equal(persistence.writes.length, 5);
  assert.equal(persistence.writes.some((write) => JSON.stringify(write.data).includes("test-secret")), false);
  const candle = persistence.writes.find((write) => write.collection.endsWith("/candles"));
  assert.equal(candle.data.feed_id, "preprod__tradingview__MES1!__5");
  assert.equal(candle.documentId, "20260715T100000Z");
  assert.equal(candle.data.symbol, "MES1!");
  assert.equal(candle.data.close, 102);
  assert.equal(candle.data.environment, "preprod");
});

test("local TradingView webhook rejects an invalid secret without writing", async () => {
  const persistence = new RecordingPersistence();
  const result = await ingestTradingViewWebhook({ persistence, secret: "expected", body: { token: "wrong" } });
  assert.equal(result.statusCode, 401);
  assert.equal(result.body.error, "webhook_secret_invalid");
  assert.equal(persistence.writes.length, 0);
});

class RecordingPersistence {
  writes = [];

  async writeDocuments(writes) {
    this.writes.push(...writes);
    return { ok: true, write_count: writes.length };
  }
}
