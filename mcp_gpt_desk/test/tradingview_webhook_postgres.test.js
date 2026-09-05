import assert from "node:assert/strict";
import test from "node:test";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { PostgresDeskPersistence } from "../src/persistence/postgres-desk-persistence.js";
import { ingestTradingViewWebhook } from "../src/tradingview-webhook.js";
import { createTheoreticalTestDatabase } from "./support/theoretical-postgres-fixtures.js";

test("TradingView receipt provenance survives retries in an isolated PostgreSQL database", {
  skip: process.env.RUN_POSTGRES_TESTS !== "1",
}, async (t) => {
  const database = await createTheoreticalTestDatabase();
  t.after(() => database.close());
  const persistence = new PostgresDeskPersistence({ pool: database.pool, schemaMode: "validate" });
  const state = await persistInitialWebhook(persistence, database.pool);

  await t.test("canonical timing ignores body supplied provenance values", async () => assertCanonicalTiming(persistence, state));
  await t.test("an earlier-clock retry cannot rewrite the first event receipt", async () => assertRetryPreservesReceipt(persistence, state));
  await t.test("a corrected OHLC revision changes candle lineage but keeps first candle insertion", async () => assertCorrectionLineage(persistence, database.pool, state));
  await t.test("get and list expose the same immutable event provenance", async () => assertSpecializedEventReads(persistence, state));
  await t.test("versioned event identity and payload stay frozen on direct persistence conflicts", async () => assertVersionedEventImmutability(persistence, state));
  await t.test("legacy event conflicts retain legacy status and first receipt", async () => assertLegacyCompatibility(persistence, state));
  await t.test("ingestion has no broker side effect", async () => assertNoBrokerCommands(database.pool));
});

async function persistInitialWebhook(persistence, pool) {
  const firstReceipt = new Date("2026-09-05T10:05:00.000Z");
  const first = await ingestTradingViewWebhook({ persistence, secret: "test-secret", now: firstReceipt, body: closedCandleBody({
    now: "1999-01-01T00:00:00.000Z", received_at_utc: "1999-01-01T00:00:01.000Z", persisted_at_utc: "1999-01-01T00:00:02.000Z",
    receivedAtUtc: "1999-01-01T00:00:00.000Z", persistedAtUtc: "1999-01-01T00:00:00.000Z",
    eventFirstPersistedAtUtc: "1999-01-01T00:00:00.000Z", imported_at: "1999-01-01T00:00:00.000Z",
    sourceBarCloseUtc: "1999-01-01T00:00:03.000Z", timingProvenanceVersion: "forged",
  }) });
  const result = first.body.results[0];
  return {
    firstReceipt,
    firstEventId: result.event_id,
    feedId: result.market_feed_id,
    candleId: result.market_feed_candle_id,
    candleImportedAt: await candleImportedAt(pool, result.market_feed_id, "2026-09-05T10:00:00.000Z"),
  };
}

async function assertCanonicalTiming(persistence, state) {
  const event = await eventById(persistence, state.firstEventId);
  const candle = await candleByState(persistence, state);
  assert.equal(event.received_at_utc, state.firstReceipt.toISOString());
  assert.equal(event.source_bar_close_utc, "2026-09-05T10:05:00.000Z");
  assert.equal(event.timing_provenance_version, "tradingview_webhook_timing_v1");
  assert.match(event.event_first_persisted_at_utc, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(candle.source_bar_open_utc, "2026-09-05T10:00:00.000Z");
  assert.equal(candle.source_bar_close_utc, "2026-09-05T10:05:00.000Z");
  assert.equal(JSON.stringify(event.payload).includes("1999-01-01"), false);
}

async function assertRetryPreservesReceipt(persistence, state) {
  const retry = await ingestTradingViewWebhook({ persistence, secret: "test-secret", now: new Date("2026-09-05T10:03:00.000Z"), body: closedCandleBody() });
  assert.equal(retry.body.results[0].event_id, state.firstEventId);
  assert.equal((await eventById(persistence, state.firstEventId)).received_at_utc, state.firstReceipt.toISOString());
}

async function assertCorrectionLineage(persistence, pool, state) {
  const correctionReceipt = new Date("2026-09-05T10:08:00.000Z");
  const correction = await ingestTradingViewWebhook({ persistence, secret: "test-secret", now: correctionReceipt, body: closedCandleBody({ high: 105, close: 104 }) });
  state.correctedEventId = correction.body.results[0].event_id;
  const candle = await candleByState(persistence, state);
  assert.notEqual(state.correctedEventId, state.firstEventId);
  assert.equal(candle.event_id, state.correctedEventId);
  assert.equal(candle.close, 104);
  assert.equal(candle.received_at_utc, correctionReceipt.toISOString());
  assert.equal(await candleImportedAt(pool, state.feedId, "2026-09-05T10:00:00.000Z"), state.candleImportedAt);
  assert.equal((await eventById(persistence, state.firstEventId)).received_at_utc, state.firstReceipt.toISOString());
}

async function assertSpecializedEventReads(persistence, state) {
  const fromGet = await eventById(persistence, state.correctedEventId);
  const fromList = (await persistence.listDocuments(DESK_COLLECTIONS.tradingviewWebhookEvents, 20)).find((event) => event.event_id === state.correctedEventId);
  assert.deepEqual(timingProjection(fromList), timingProjection(fromGet));
}

async function assertVersionedEventImmutability(persistence, state) {
  const before = await eventById(persistence, state.firstEventId);
  await persistence.writeDocuments([{ collection: DESK_COLLECTIONS.tradingviewWebhookEvents, documentId: state.firstEventId, data: { ...versionedConflict(), event_id: state.firstEventId }, merge: true }]);
  const after = await eventById(persistence, state.firstEventId);
  assert.deepEqual(eventIdentity(after), eventIdentity(before));
  assert.deepEqual(after.payload, before.payload);
  assert.equal(after.received_at_utc, state.firstReceipt.toISOString());
}

async function assertLegacyCompatibility(persistence, state) {
  await persistence.writeDocuments([{ collection: DESK_COLLECTIONS.tradingviewWebhookEvents, documentId: "event_legacy", data: legacyEvent(), merge: true }]);
  await persistence.writeDocuments([{ collection: DESK_COLLECTIONS.tradingviewWebhookEvents, documentId: "event_legacy", data: { ...legacyEvent(), received_at_utc: "2026-09-05T10:09:00.000Z", timing_provenance_version: "tradingview_webhook_timing_v1" }, merge: true }]);
  const legacy = await eventById(persistence, "event_legacy");
  assert.equal(legacy.received_at_utc, state.firstReceipt.toISOString());
  assert.equal(legacy.timing_provenance_version, undefined);
}

async function assertNoBrokerCommands(pool) {
  const commands = await pool.query("SELECT count(*)::integer AS count FROM broker_provider_commands");
  assert.equal(commands.rows[0].count, 0);
}

function candleByState(persistence, state) {
  return persistence.getDocument(`${DESK_COLLECTIONS.marketFeeds}/${state.feedId}/${DESK_COLLECTIONS.marketFeedCandles}`, state.candleId);
}

async function candleImportedAt(pool, feedId, timestampUtc) {
  const result = await pool.query("SELECT imported_at FROM market_candles WHERE feed_id = $1 AND timestamp_utc = $2::timestamptz", [feedId, timestampUtc]);
  return result.rows[0].imported_at.toISOString();
}

function eventById(persistence, eventId) {
  return persistence.getDocument(DESK_COLLECTIONS.tradingviewWebhookEvents, eventId);
}

function timingProjection(event) {
  return { event_id: event.event_id, received_at_utc: event.received_at_utc, event_first_persisted_at_utc: event.event_first_persisted_at_utc, source_bar_open_utc: event.source_bar_open_utc, source_bar_close_utc: event.source_bar_close_utc, timing_provenance_version: event.timing_provenance_version };
}

function eventIdentity(event) {
  return { feed_id: event.feed_id, symbol: event.symbol, timeframe: event.timeframe, timestamp_utc: event.timestamp_utc, alert_id: event.alert_id, status: event.status };
}

function closedCandleBody(overrides = {}) {
  return { token: "test-secret", source: "tradingview_alert_webhook", alert_id: "alert-1", symbol: "CME_MINI:MNQ1!", timeframe: "5", timestamp_utc: "2026-09-05T10:00:00.000Z", bar_status: "closed", open: 100, high: 103, low: 99, close: 102, volume: 42, ...overrides };
}

function versionedConflict() {
  return { feed_id: "prod__tradingview__MES1!__5", symbol: "MES1!", timeframe: "5", timestamp_utc: "2026-09-05T10:05:00.000Z", received_at_utc: "2026-09-05T10:10:00.000Z", alert_id: "mutated-alert", status: "MUTATED", payload: { close: 999 }, source_bar_open_utc: "2026-09-05T10:05:00.000Z", source_bar_close_utc: "2026-09-05T10:10:00.000Z", timing_provenance_version: "tradingview_webhook_timing_v1" };
}

function legacyEvent() {
  return { event_id: "event_legacy", feed_id: "prod__tradingview__MNQ1!__5", symbol: "MNQ1!", timeframe: "5", timestamp_utc: "2026-09-05T10:00:00.000Z", received_at_utc: "2026-09-05T10:05:00.000Z", alert_id: "legacy-alert", status: "ACCEPTED", payload: {} };
}
