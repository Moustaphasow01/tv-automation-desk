import assert from "node:assert/strict";
import test from "node:test";
import { FixedClock } from "@tv-automation/desk-time";
import { ingestTradingViewWebhook } from "../src/tradingview-webhook.js";
import { PersistentDeskStore } from "../src/store.js";
import { InMemoryDeskPersistence } from "./support/in-memory-desk-persistence.js";

test("local TradingView webhook validates, strips secrets and writes canonical documents", async () => {
  const persistence = new RecordingPersistence();
  const result = await ingestTradingViewWebhook({
    persistence,
    secret: "test-secret",
    environment: "preprod",
    now: new Date("2026-07-15T10:01:00.000Z"),
    body: {
      token: "test-secret",
      alert_id: "alert-1",
      source: "tradingview_alert_webhook",
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
      received_at_utc: "1999-01-01T00:00:00.000Z",
      persisted_at_utc: "1999-01-01T00:00:01.000Z",
      now: "1999-01-01T00:00:02.000Z",
      sourceBarCloseUtc: "1999-01-01T00:00:03.000Z",
      timingProvenanceVersion: "untrusted",
    },
  });

  assert.equal(result.statusCode, 202);
  assert.equal(result.body.accepted, 1);
  assert.equal(persistence.writes.length, 4);
  assert.equal(persistence.writes.some((write) => write.collection === "tradingview_alert_queue"), false);
  assert.equal(persistence.writes.some((write) => JSON.stringify(write.data).includes("test-secret")), false);
  const candle = persistence.writes.find((write) => write.collection.endsWith("/candles"));
  assert.equal(candle.data.feed_id, "preprod__tradingview__MES1!__5");
  assert.equal(candle.documentId, "20260715T100000Z");
  assert.equal(candle.data.symbol, "MES1!");
  assert.equal(candle.data.source, "tradingview_alert_webhook");
  assert.equal(candle.data.close, 102);
  assert.equal(candle.data.environment, "preprod");
  assert.equal(candle.data.source_bar_open_utc, "2026-07-15T10:00:00.000Z");
  assert.equal(candle.data.source_bar_close_utc, "2026-07-15T10:05:00.000Z");
  assert.equal(candle.data.received_at_utc, "2026-07-15T10:01:00.000Z");
  assert.equal(candle.data.timing_provenance_version, "tradingview_webhook_timing_v1");
  const event = persistence.writes.find((write) => write.collection === "tradingview_webhook_events");
  assert.equal(event.data.source, "tradingview_alert_webhook");
  assert.equal(event.data.source_bar_open_utc, "2026-07-15T10:00:00.000Z");
  assert.equal(event.data.source_bar_close_utc, "2026-07-15T10:05:00.000Z");
  assert.equal(event.data.received_at_utc, "2026-07-15T10:01:00.000Z");
  assert.equal(event.data.timing_provenance_version, "tradingview_webhook_timing_v1");
  assert.equal(JSON.stringify(event.data.payload).includes("1999-01-01"), false);
});

test("persistent store supplies the webhook receipt from its injected clock", async () => {
  const persistence = new InMemoryDeskPersistence();
  const store = new PersistentDeskStore(new FixedClock(Date.parse("2026-07-15T10:01:00.000Z")), persistence);
  await store.ingestTradingViewWebhook({
    secret: "test-secret",
    body: closedCandleBody({
      received_at_utc: "1999-01-01T00:00:00.000Z",
      now: "1999-01-01T00:00:01.000Z",
    }),
  });

  const event = persistence.peek("tradingview_webhook_events", persistence.ids("tradingview_webhook_events")[0]);
  assert.equal(event.received_at_utc, "2026-07-15T10:01:00.000Z");
});

test("local TradingView webhook targets the canonical prod feed environment by default", async () => {
  const persistence = new RecordingPersistence();
  const result = await ingestTradingViewWebhook({
    persistence,
    secret: "test-secret",
    now: new Date("2026-07-15T10:16:00.000Z"),
    body: {
      token: "test-secret",
      symbol: "CME_MINI:MNQ1!",
      timeframe: "15",
      timestamp_utc: "2026-07-15T10:00:00.000Z",
      bar_status: "closed",
      open: 100,
      high: 103,
      low: 99,
      close: 102,
      volume: 42,
    },
  });

  assert.equal(result.statusCode, 202);
  const candle = persistence.writes.find((write) => write.collection.endsWith("/candles"));
  assert.equal(candle.data.feed_id, "prod__tradingview__MNQ1!__15");
  assert.equal(candle.data.environment, "prod");
});

test("local TradingView webhook rejects an invalid secret without writing", async () => {
  const persistence = new RecordingPersistence();
  const result = await ingestTradingViewWebhook({ persistence, secret: "expected", body: { token: "wrong" } });
  assert.equal(result.statusCode, 401);
  assert.equal(result.body.error, "webhook_secret_invalid");
  assert.equal(persistence.writes.length, 0);
});

test("local TradingView webhook rejects stale and future candles", async () => {
  const persistence = new RecordingPersistence();
  const base = {
    token: "test-secret",
    symbol: "CME_MINI:MNQ1!",
    timeframe: "5",
    bar_status: "closed",
    open: 100,
    high: 103,
    low: 99,
    close: 102,
    volume: 42,
  };
  const stale = await ingestTradingViewWebhook({
    persistence,
    secret: "test-secret",
    now: new Date("2026-07-15T11:00:00.000Z"),
    body: { ...base, timestamp_utc: "2026-07-15T10:00:00.000Z" },
  });
  const future = await ingestTradingViewWebhook({
    persistence,
    secret: "test-secret",
    now: new Date("2026-07-15T10:00:00.000Z"),
    body: { ...base, timestamp_utc: "2026-07-15T10:10:00.000Z" },
  });

  assert.equal(stale.statusCode, 422);
  assert.equal(stale.body.results[0].error, "stale_candle_timestamp");
  assert.equal(future.statusCode, 422);
  assert.equal(future.body.results[0].error, "future_candle_timestamp");
  assert.equal(persistence.writes.length, 0);
});

test("local TradingView webhook evaluates higher-timeframe freshness from candle close", async () => {
  const persistence = new RecordingPersistence();
  const result = await ingestTradingViewWebhook({
    persistence,
    secret: "test-secret",
    now: new Date("2026-09-04T13:52:00.000Z"),
    maxAgeSeconds: 20 * 60,
    body: {
      token: "test-secret",
      symbol: "CBOT:ZC1!",
      timeframe: "15",
      timestamp_utc: "2026-09-04T13:30:00.000Z",
      bar_status: "closed",
      open: 500,
      high: 502,
      low: 499,
      close: 501,
      volume: 120,
    },
  });

  assert.equal(result.statusCode, 202);
  assert.equal(result.body.accepted, 1);
  const candle = persistence.writes.find((write) => write.collection.endsWith("/candles"));
  assert.equal(candle.data.feed_id, "prod__tradingview__ZC1!__15");
  assert.equal(candle.documentId, "20260904T133000Z");
});

class RecordingPersistence {
  writes = [];

  async writeDocuments(writes) {
    this.writes.push(...writes);
    return { ok: true, write_count: writes.length };
  }
}

function closedCandleBody(overrides = {}) {
  return {
    token: "test-secret",
    symbol: "CME_MINI:MNQ1!",
    timeframe: "5",
    timestamp_utc: "2026-07-15T10:00:00.000Z",
    bar_status: "closed",
    open: 100,
    high: 103,
    low: 99,
    close: 102,
    volume: 42,
    ...overrides,
  };
}
