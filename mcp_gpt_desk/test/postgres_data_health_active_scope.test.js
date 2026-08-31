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
  assert.deepEqual(feedCall.params, [["ZC", "ZW"]]);
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
});

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
