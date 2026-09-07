import assert from "node:assert/strict";
import test from "node:test";

import { buildPostgresDataHealth } from "../src/persistence/postgres-data-health.js";

test("data readiness follows running grain strategy instruments instead of legacy equity defaults", async () => {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM strategy_instances")) return { rows: [{ instruments: ["ZC", "ZW"] }] };
      if (sql.includes("FROM market_feeds")) return { rows: grainFeedRows() };
      if (sql.includes("desk_service_heartbeats")) return { rows: [{ status: "healthy", details: {}, heartbeat_at_utc: "2026-08-31T12:59:00.000Z", release_version: "test" }] };
      throw new Error(`unexpected_sql:${sql}`);
    },
  };

  const result = await buildPostgresDataHealth(pool, { nowUtc: "2026-08-31T13:00:00.000Z" });

  const feedCall = calls.find((call) => call.sql.includes("FROM market_feeds"));
  assert.deepEqual(feedCall.params, [["ZC", "ZW"], "2026-08-31T13:00:00.000Z"]);
  assert.deepEqual(result.readiness_scope, {
    source: "active_strategy_instances",
    instruments: ["ZC", "ZW"],
    timeframes: ["1", "5"],
  });
  assert.equal(result.active_session, "CBOT_GRAINS_PREOPEN");
  assert.equal(result.next_eligible_at_utc, "2026-08-31T13:30:00.000Z");
  assert.equal(result.exchange_timezone, "America/Chicago");
  assert.equal(result.market_closed, true);
  assert.equal(result.ok, true);
  assert.equal(result.source_health.durable, true);
  assert.equal(result.core_feeds[0].ingestion_timing.provenance, "legacy_history_unverified");
  assert.equal(result.core_feeds[0].ingestion_timing.close_to_received.seconds, null);
  assert.equal(result.core_feeds[0].ingestion_timing.close_to_received.status, "unavailable");
});

test("data readiness evaluates active grains feed freshness from candle close time", async () => {
  const pool = {
    async query(sql) {
      if (sql.includes("FROM strategy_instances")) return { rows: [{ instruments: ["ZC", "ZW"] }] };
      if (sql.includes("FROM market_feeds")) return { rows: grainFeedRowsAt({ m1: "2026-09-04T14:25:00.000Z", m5: "2026-09-04T14:15:00.000Z" }) };
      if (sql.includes("desk_service_heartbeats")) return { rows: [{ status: "healthy", details: {}, heartbeat_at_utc: "2026-09-04T14:36:00.000Z", release_version: "test" }] };
      throw new Error(`unexpected_sql:${sql}`);
    },
  };

  const result = await buildPostgresDataHealth(pool, { nowUtc: "2026-09-04T14:36:32.000Z" });

  assert.equal(result.active_session, "CBOT_GRAINS_RTH");
  assert.equal(result.ok, true);
  assert.equal(result.state, "ready");
  assert.equal(result.core_age_seconds, 992);
  assert.equal(result.core_feeds.find((feed) => feed.timeframe === "5").closed_candle_age_seconds, 992);
});

test("data readiness treats the qualified Labor Day RTH closure as last-known, not an outage", async () => {
  const rows = grainFeedRowsAt({
    m1: "2026-09-04T18:19:00.000Z",
    m5: "2026-09-04T18:15:00.000Z",
  });
  const result = await buildPostgresDataHealth(grainHealthPool({ rows }), {
    nowUtc: "2026-09-07T15:10:00.000Z",
  });

  assert.equal(result.market_session.state, "HOLIDAY");
  assert.equal(result.market_closed, true);
  assert.equal(result.state, "HOLIDAY");
  assert.equal(result.ok, true);
  assert.equal(result.next_eligible_at_utc, "2026-09-08T13:30:00.000Z");
  assert.equal(result.freshness_policy.max_age_seconds, 96 * 60 * 60);
});

test("Labor Day last-known readiness rejects a non-Friday core candle", async () => {
  const rows = grainFeedRowsAt({
    m1: "2026-09-03T18:19:00.000Z",
    m5: "2026-09-03T18:15:00.000Z",
  });
  const result = await buildPostgresDataHealth(grainHealthPool({ rows }), {
    nowUtc: "2026-09-07T15:10:00.000Z",
  });

  assert.equal(result.market_session.state, "HOLIDAY");
  assert.equal(result.ok, false);
  assert.equal(result.state, "stale_market_closed");
  assert.equal(result.effective_market_date, "2026-09-03");
});

test("Labor Day last-known readiness rejects a truncated Friday core session", async () => {
  const rows = grainFeedRowsAt({
    m1: "2026-09-04T13:30:00.000Z",
    m5: "2026-09-04T13:30:00.000Z",
  });
  const result = await buildPostgresDataHealth(grainHealthPool({ rows }), {
    nowUtc: "2026-09-07T15:10:00.000Z",
  });

  assert.equal(result.effective_market_date, "2026-09-04");
  assert.equal(result.ok, false);
  assert.equal(result.state, "stale_market_closed");
});

test("data readiness labels reopening tolerance without making Friday candles fresh on Tuesday", async () => {
  const rows = grainFeedRowsAt({
    m1: "2026-09-04T18:19:00.000Z",
    m5: "2026-09-04T18:15:00.000Z",
  });
  const duringGrace = await buildPostgresDataHealth(grainHealthPool({ rows }), {
    nowUtc: "2026-09-08T13:40:00.000Z",
  });
  const afterGrace = await buildPostgresDataHealth(grainHealthPool({ rows }), {
    nowUtc: "2026-09-08T13:56:00.000Z",
  });

  assert.equal(duringGrace.market_closed, false);
  assert.equal(duringGrace.ok, false);
  assert.equal(duringGrace.state, "awaiting_first_closed_bar");
  assert.equal(duringGrace.effective_market_date, "2026-09-04");
  assert.equal(afterGrace.ok, false);
  assert.equal(afterGrace.state, "stale");
});

test("data readiness binds latest candles to their M5 close instead of admitting an open candle", async () => {
  const calls = [];
  const pool = grainHealthPool({
    rows: grainFeedRowsAt({ m1: "2026-09-04T14:35:00.000Z", m5: "2026-09-04T14:35:00.000Z" }),
    calls,
  });

  const result = await buildPostgresDataHealth(pool, { nowUtc: "2026-09-04T14:36:00.000Z" });
  const feedCall = calls.find((call) => call.sql.includes("FROM market_feeds"));

  assert.match(feedCall.sql, /close_utc.*<= \$2::timestamptz/s);
  assert.doesNotMatch(feedCall.sql, /timeframe::integer/);
  assert.deepEqual(feedCall.params, [["ZC", "ZW"], "2026-09-04T14:36:00.000Z"]);
  assert.equal(result.ok, false);
  assert.equal(result.state, "missing");
  assert.equal(result.core_age_seconds, null);
});

test("data readiness never treats a future candle as fresh when a legacy row reaches the projection", async () => {
  const pool = grainHealthPool({ rows: grainFeedRowsAt({ m1: "2026-09-04T14:36:00.000Z", m5: "2026-09-04T14:30:00.000Z" }) });

  const result = await buildPostgresDataHealth(pool, { nowUtc: "2026-09-04T14:36:00.000Z" });

  assert.equal(result.ok, false);
  assert.equal(result.core_age_seconds, null);
});

test("data readiness counts required instrument/timeframe pairs, not duplicate feed rows", async () => {
  const duplicateRows = grainFeedRowsAt({ m1: "2026-09-04T14:35:00.000Z", m5: "2026-09-04T14:30:00.000Z" });
  duplicateRows.push({ ...duplicateRows[0], feed_id: "prod__tradingview__ZC1!__1__duplicate" });
  const pool = grainHealthPool({ rows: duplicateRows.filter((row) => !(row.instrument_code === "ZW" && row.timeframe === "5")) });

  const result = await buildPostgresDataHealth(pool, { nowUtc: "2026-09-04T14:36:00.000Z" });

  assert.equal(result.core_feeds.length, 3);
  assert.equal(result.ok, false);
  assert.equal(result.state, "missing");
  assert.equal(result.source_health.total_count, 3);
});

test("data readiness requires every required feed to share the trading date", async () => {
  const rows = grainFeedRowsAt({ m1: "2026-09-04T14:35:00.000Z", m5: "2026-09-04T14:30:00.000Z" });
  rows[0] = { ...rows[0], latest_timestamp_utc: "2026-09-03T14:35:00.000Z" };
  const pool = grainHealthPool({ rows });

  const result = await buildPostgresDataHealth(pool, { nowUtc: "2026-09-04T14:36:00.000Z" });

  assert.equal(result.effective_market_date, null);
  assert.equal(result.ok, false);
  assert.equal(result.state, "stale");
});

test("data readiness exposes verified current-event timing without inventing legacy values", async () => {
  const rows = grainFeedRowsAt({ m1: "2026-09-04T14:35:00.000Z", m5: "2026-09-04T14:30:00.000Z" })
    .map((row) => ({
      ...row,
      latest_candle_close_utc: row.timeframe === "1" ? "2026-09-04T14:36:00.000Z" : "2026-09-04T14:35:00.000Z",
      latest_candle_event_id: `event-${row.instrument_code}-${row.timeframe}`,
      latest_source_bar_open_utc: row.latest_timestamp_utc,
      latest_source_bar_close_utc: row.timeframe === "1" ? "2026-09-04T14:36:00.000Z" : "2026-09-04T14:35:00.000Z",
      latest_timing_provenance_version: "tradingview_webhook_timing_v1",
      current_event_id: `event-${row.instrument_code}-${row.timeframe}`,
      current_event_received_at_utc: "2026-09-04T14:35:10.000Z",
      event_first_persisted_at_utc: "2026-09-04T14:35:12.000Z",
      current_event_timing_provenance_version: "tradingview_webhook_timing_v1",
    }));
  const pool = grainHealthPool({ rows });

  const result = await buildPostgresDataHealth(pool, { nowUtc: "2026-09-04T14:36:00.000Z" });
  const m5 = result.core_feeds.find((feed) => feed.timeframe === "5");
  const m1 = result.core_feeds.find((feed) => feed.timeframe === "1");

  assert.equal(m5.ingestion_timing.provenance, "current_event_linked");
  assert.equal(m5.ingestion_timing.close_to_received.seconds, 10);
  assert.equal(m5.ingestion_timing.received_to_persisted.seconds, 2);
  assert.equal(m5.ingestion_timing.close_to_first_import.status, "observed");
  assert.equal(m1.ingestion_timing.close_to_received.seconds, -50);
  assert.equal(m1.ingestion_timing.close_to_received.status, "negative_clock_skew");
});

test("data readiness does not attribute timing to a different event id", async () => {
  const rows = grainFeedRowsAt({ m1: "2026-09-04T14:35:00.000Z", m5: "2026-09-04T14:30:00.000Z" })
    .map((row) => ({
      ...row,
      latest_candle_close_utc: row.timeframe === "1" ? "2026-09-04T14:36:00.000Z" : "2026-09-04T14:35:00.000Z",
      latest_candle_event_id: `event-${row.instrument_code}-${row.timeframe}`,
      latest_timing_provenance_version: "tradingview_webhook_timing_v1",
      current_event_id: `other-event-${row.instrument_code}-${row.timeframe}`,
      current_event_received_at_utc: "2026-09-04T14:35:10.000Z",
      event_first_persisted_at_utc: "2026-09-04T14:35:12.000Z",
      current_event_timing_provenance_version: "tradingview_webhook_timing_v1",
    }));
  const result = await buildPostgresDataHealth(grainHealthPool({ rows }), { nowUtc: "2026-09-04T14:36:00.000Z" });

  assert.equal(result.core_feeds[0].ingestion_timing.provenance, "legacy_history_unverified");
  assert.equal(result.core_feeds[0].ingestion_timing.event_id, null);
  assert.equal(result.core_feeds[0].ingestion_timing.received_to_persisted.seconds, null);
  assert.equal(result.core_feeds[0].ingestion_timing.received_to_persisted.status, "unavailable");
  assert.equal(result.core_feeds[0].provenance.classification, "event_link_mismatch");
  assert.equal(result.source_health.durable, false);
});

test("data timing prefers the computed candle close and keeps sub-second negative skew explicit", async () => {
  const rows = grainFeedRowsAt({ m1: "2026-09-04T14:35:00.000Z", m5: "2026-09-04T14:30:00.000Z" })
    .map((row) => ({
      ...row,
      latest_candle_close_utc: row.timeframe === "1" ? "2026-09-04T14:36:00.000Z" : "2026-09-04T14:35:00.000Z",
      latest_candle_event_id: `event-${row.instrument_code}-${row.timeframe}`,
      latest_source_bar_close_utc: "2099-01-01T00:00:00.000Z",
      latest_timing_provenance_version: "tradingview_webhook_timing_v1",
      current_event_id: `event-${row.instrument_code}-${row.timeframe}`,
      current_event_received_at_utc: row.timeframe === "1" ? "2026-09-04T14:35:59.500Z" : "2026-09-04T14:35:10.000Z",
      event_first_persisted_at_utc: "2026-09-04T14:35:12.000Z",
      current_event_timing_provenance_version: "tradingview_webhook_timing_v1",
    }));
  const result = await buildPostgresDataHealth(grainHealthPool({ rows }), { nowUtc: "2026-09-04T14:36:00.000Z" });
  const m1 = result.core_feeds.find((feed) => feed.timeframe === "1");

  assert.equal(m1.ingestion_timing.source_bar_close_utc, "2026-09-04T14:36:00.000Z");
  assert.equal(m1.ingestion_timing.close_to_received.seconds, -0.5);
  assert.equal(m1.ingestion_timing.close_to_received.status, "negative_clock_skew");
});

function grainHealthPool({ rows, calls = [] }) {
  return {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM strategy_instances")) return { rows: [{ instruments: ["ZC", "ZW"] }] };
      if (sql.includes("FROM market_feeds")) return { rows };
      if (sql.includes("desk_service_heartbeats")) return { rows: [{ status: "healthy", details: {}, heartbeat_at_utc: "2026-09-04T14:36:00.000Z", release_version: "test" }] };
      throw new Error(`unexpected_sql:${sql}`);
    },
  };
}

function grainFeedRows() {
  return ["ZC", "ZW"].flatMap((instrument) => ["1", "5"].map((timeframe) => ({
    instrument_code: instrument,
    timeframe,
    feed_id: `prod__tradingview__${instrument}1!__${timeframe}`,
    provider: "tradingview",
    source_service: "local_tradingview_webhook",
    latest_timestamp_utc: "2026-08-28T18:20:00.000Z",
    latest_imported_at_utc: "2026-08-28T18:20:01.000Z",
    latest_source_collection: "tradingview_events",
    latest_event_received_at_utc: "2026-08-28T18:20:01.000Z",
    latest_event_alert_id: `${instrument}_${timeframe}_20260828`,
    latest_event_payload_source: "tradingview_alert_webhook",
  })));
}

function grainFeedRowsAt({ m1, m5 }) {
  return ["ZC", "ZW"].flatMap((instrument) => ["1", "5"].map((timeframe) => ({
    instrument_code: instrument,
    timeframe,
    feed_id: `prod__tradingview__${instrument}1!__${timeframe}`,
    provider: "tradingview",
    source_service: "local_tradingview_webhook",
    latest_timestamp_utc: timeframe === "1" ? m1 : m5,
    latest_imported_at_utc: "2026-09-04T14:36:01.000Z",
    latest_source_collection: "tradingview_events",
    latest_event_received_at_utc: "2026-09-04T14:36:01.000Z",
    latest_event_alert_id: `${instrument}_${timeframe}_20260904`,
    latest_event_payload_source: "tradingview_alert_webhook",
  })));
}
