import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { PostgresDeskPersistence } from "../src/persistence/postgres-desk-persistence.js";
import { ingestTradingViewWebhook } from "../src/tradingview-webhook.js";
import { createTheoreticalTestDatabase } from "./support/theoretical-postgres-fixtures.js";

test("PostgreSQL data health links current events without admitting future, open, or H1 candles", {
  skip: process.env.RUN_POSTGRES_TESTS !== "1",
}, async (t) => {
  const database = await createTheoreticalTestDatabase();
  t.after(() => database.close());
  const persistence = new PostgresDeskPersistence({ pool: database.pool, schemaMode: "validate" });
  const now = new Date(Date.now());
  await seedRunningScope(database.pool, now);
  const state = await ingestCurrentClosedCandles(persistence, now);
  await insertExcludedCandles(database.pool, state.mnqM1FeedId, now);
  await makeLegacyAndMismatchedCandleLineage(persistence, database.pool, state, now);

  const health = await getDataHealthSummary(persistence, now);

  assertCoreScopeExcludesH1AndUnclosedData(health, state);
  assertCurrentCorrectionTiming(health, state.correctedMnqM5EventId);
  assertLegacyAndMismatchedLineage(health);
});

async function seedRunningScope(pool, now) {
  const definitionId = randomUUID();
  const versionId = randomUUID();
  const instanceId = randomUUID();
  const hash = `sha256:${"1".repeat(64)}`;
  await pool.query(
    `INSERT INTO strategy_definitions (strategy_definition_id, external_key, name, owner)
     VALUES ($1, $2, 'Health timing integration', 'test')`,
    [definitionId, `health-timing-${definitionId}`],
  );
  await pool.query(
    `INSERT INTO strategy_versions (
       strategy_version_id, strategy_definition_id, version_label, dsl_source_hash,
       compiled_artifact_ref, compiled_artifact_hash, runtime_contract_bundle_version
     ) VALUES ($1, $2, 'v1', $3, 'test://artifact', $3, 'test-v1')`,
    [versionId, definitionId, hash],
  );
  await pool.query(
    `INSERT INTO strategy_instances (
       strategy_instance_id, strategy_version_id, runtime_state, execution_mode,
       instrument_scope, last_heartbeat_at
     ) VALUES ($1, $2, 'running', 'shadow', ARRAY['MNQ', 'MES'], $3::timestamptz)`,
    [instanceId, versionId, now.toISOString()],
  );
}

async function ingestCurrentClosedCandles(persistence, now) {
  const mnqM1 = await ingestClosedCandle(persistence, now, "MNQ1!", "1");
  const mnqM5 = await ingestClosedCandle(persistence, now, "MNQ1!", "5");
  const mesM1 = await ingestClosedCandle(persistence, now, "MES1!", "1");
  const mesM5 = await ingestClosedCandle(persistence, now, "MES1!", "5");
  await ingestClosedCandle(persistence, now, "MNQ1!", "1H");
  const correction = await ingestClosedCandle(persistence, now, "MNQ1!", "5", { alert_id: "mnq-corrected", high: 105, close: 104 });
  return {
    mnqM1FeedId: mnqM1.market_feed_id,
    mnqM1TimestampUtc: mnqM1.timestamp_utc,
    mnqM5FeedId: mnqM5.market_feed_id,
    mnqM5TimestampUtc: mnqM5.timestamp_utc,
    mesM1FeedId: mesM1.market_feed_id,
    mesM1TimestampUtc: mesM1.timestamp_utc,
    mesM5FeedId: mesM5.market_feed_id,
    mesM5TimestampUtc: mesM5.timestamp_utc,
    correctedMnqM5EventId: correction.event_id,
    ignored: [mnqM5, mesM1, mesM5],
  };
}

async function ingestClosedCandle(persistence, now, symbol, timeframe, correction = {}) {
  const seconds = timeframe === "1H" ? 3600 : Number(timeframe) * 60;
  const timestampUtc = new Date(now.getTime() - ((seconds + 5) * 1000)).toISOString();
  const result = await ingestTradingViewWebhook({
    persistence,
    secret: "test-secret",
    now,
    body: {
      token: "test-secret",
      source: "tradingview_alert_webhook",
      alert_id: `${symbol}-${timeframe}`,
      symbol: `CME_MINI:${symbol}`,
      timeframe,
      timestamp_utc: timestampUtc,
      bar_status: "closed",
      open: 100,
      high: 103,
      low: 99,
      close: 102,
      volume: 42,
      ...correction,
    },
  });
  assert.equal(result.statusCode, 202);
  return { ...result.body.results[0], timestamp_utc: timestampUtc };
}

async function insertExcludedCandles(pool, feedId, now) {
  await insertMarketCandle(pool, feedId, new Date(now.getTime() + 60_000), true);
  await insertMarketCandle(pool, feedId, new Date(now.getTime() - 30_000), false);
}

async function insertMarketCandle(pool, feedId, timestamp, isClosed) {
  await pool.query(
    `INSERT INTO market_candles (
       feed_id, timestamp_utc, symbol_code, timeframe, open, high, low, close, is_closed, raw
     ) VALUES ($1, $2::timestamptz, 'MNQ1!', '1', 100, 103, 99, 102, $3, '{}'::jsonb)`,
    [feedId, timestamp.toISOString(), isClosed],
  );
}

async function makeLegacyAndMismatchedCandleLineage(persistence, pool, state, now) {
  await pool.query(
    `UPDATE market_candles
     SET raw = raw - 'event_id' - 'timing_provenance_version'
     WHERE feed_id = $1 AND timestamp_utc = $2::timestamptz`,
    [state.mesM1FeedId, state.mesM1TimestampUtc],
  );
  await pool.query(
    `UPDATE market_candles
     SET raw = jsonb_set(raw, '{event_id}', $3::jsonb)
     WHERE feed_id = $1 AND timestamp_utc = $2::timestamptz`,
    [state.mesM5FeedId, state.mesM5TimestampUtc, JSON.stringify("event_nonmatching")],
  );
  await persistence.writeDocuments([{
    collection: DESK_COLLECTIONS.tradingviewWebhookEvents,
    documentId: `event_unlinked_${randomUUID()}`,
    data: {
      feed_id: state.mnqM5FeedId,
      symbol: "MNQ1!",
      timeframe: "5",
      timestamp_utc: state.mnqM5TimestampUtc,
      received_at_utc: new Date(now.getTime() + 1_000).toISOString(),
      alert_id: "unlinked-rescue",
      source: "tradingview_desktop_recent_ohlcv_rescue",
      status: "ACCEPTED",
      payload: { source: "tradingview_desktop_recent_ohlcv_rescue" },
    },
    merge: true,
  }]);
}

function getDataHealthSummary(persistence, now) {
  return persistence.dataHealth({ nowUtc: now.toISOString() });
}

function assertCoreScopeExcludesH1AndUnclosedData(health, state) {
  assert.deepEqual(health.readiness_scope.instruments, ["MES", "MNQ"]);
  assert.equal(health.core_feeds.length, 4);
  assert.equal(health.core_feeds.every((feed) => ["1", "5"].includes(feed.timeframe)), true);
  const mnqM1 = health.core_feeds.find((feed) => feed.instrument === "MNQ" && feed.timeframe === "1");
  assert.equal(new Date(mnqM1.latest_timestamp_utc).toISOString(), state.mnqM1TimestampUtc);
  assert.ok(mnqM1.closed_candle_age_seconds >= 0);
}

function assertCurrentCorrectionTiming(health, correctedEventId) {
  const mnqM5 = health.core_feeds.find((feed) => feed.instrument === "MNQ" && feed.timeframe === "5");
  assert.equal(mnqM5.ingestion_timing.provenance, "current_event_linked");
  assert.equal(mnqM5.ingestion_timing.event_id, correctedEventId);
  assert.equal(mnqM5.latest_alert_id, "mnq-corrected");
  assert.equal(mnqM5.latest_source, "tradingview_alert_webhook");
  assert.match(mnqM5.ingestion_timing.event_first_persisted_at_utc, /^\d{4}-\d{2}-\d{2}T/);
  assert.notEqual(mnqM5.ingestion_timing.close_to_first_import.seconds, null);
}

function assertLegacyAndMismatchedLineage(health) {
  const mesM1 = health.core_feeds.find((feed) => feed.instrument === "MES" && feed.timeframe === "1");
  const mesM5 = health.core_feeds.find((feed) => feed.instrument === "MES" && feed.timeframe === "5");
  assert.equal(mesM1.ingestion_timing.provenance, "legacy_history_unverified");
  assert.equal(mesM1.ingestion_timing.close_to_received.seconds, null);
  assert.equal(mesM5.ingestion_timing.provenance, "legacy_history_unverified");
  assert.equal(mesM5.provenance.classification, "event_link_mismatch");
  assert.equal(health.source_health.durable, false);
}
