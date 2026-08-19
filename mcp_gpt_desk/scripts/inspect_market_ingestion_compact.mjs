#!/usr/bin/env node
import { createDeskStoreFromEnv } from "../src/store.js";

const store = createDeskStoreFromEnv();

try {
  await store.persistence.initialized;
  const pool = store.persistence.pool;
  const q = async (sql, params = []) => (await pool.query(sql, params)).rows;

  const tables = await q(
    `
      SELECT table_name
        FROM information_schema.tables
       WHERE table_schema = 'public'
         AND (
           table_name ILIKE '%tradingview%'
           OR table_name IN ('market_feeds', 'market_candles', 'live_data_feed_status')
         )
       ORDER BY table_name
    `,
  );

  const feeds = await q(
    `
      SELECT feed_id,
             instrument_code,
             symbol_id,
             timeframe,
             status::text AS status,
             enabled,
             latest_timestamp_utc,
             updated_at
        FROM market_feeds
       WHERE feed_id LIKE 'prod__tradingview__%'
       ORDER BY feed_id
    `,
  );

  const candles = await q(
    `
      SELECT feed_id,
             symbol_code,
             timeframe,
             max(timestamp_utc) AS latest_timestamp_utc,
             max(updated_at) AS latest_db_update_utc,
             count(*)::int AS rows
        FROM market_candles
       WHERE feed_id LIKE 'prod__tradingview__%'
       GROUP BY 1,2,3
       ORDER BY feed_id
    `,
  );

  const events = await q(
    `
      SELECT feed_id,
             symbol_code,
             timeframe,
             status::text AS status,
             max(timestamp_utc) AS latest_candle_utc,
             max(received_at) AS latest_received_at,
             count(*)::int AS rows
        FROM tradingview_events
       WHERE received_at > now() - interval '24 hours'
       GROUP BY 1,2,3,4
       ORDER BY latest_received_at DESC
       LIMIT 30
    `,
  ).catch((error) => [{ error: error.code || error.message }]);

  const recentEvents = await q(
    `
      SELECT event_id,
             feed_id,
             symbol_code,
             timeframe,
             timestamp_utc,
             received_at,
             status::text AS status,
             alert_id
        FROM tradingview_events
       ORDER BY received_at DESC
       LIMIT 12
    `,
  ).catch((error) => [{ error: error.code || error.message }]);

  console.log(JSON.stringify({
    inspected_at_utc: new Date().toISOString(),
    tables: tables.map((row) => row.table_name),
    feeds,
    candles,
    tradingview_events_24h: events,
    recent_tradingview_events: recentEvents,
  }, null, 2));
} finally {
  await store.persistence.close?.();
}
