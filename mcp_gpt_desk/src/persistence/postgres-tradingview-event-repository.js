export async function upsertTradingViewEventDocument(client, {
  eventId,
  data,
  merge,
  ensureMarketFeed,
  eventRow,
}) {
  const row = eventRow(eventId, data);
  if (row.feed_id) await ensureMarketFeed(client, row.feed_id, data);
  await client.query(
    `INSERT INTO tradingview_events (
       event_id, feed_id, symbol_code, timeframe, timestamp_utc, received_at,
       alert_id, status, payload, raw
     ) VALUES (
       $1, $2, $3, $4, $5::timestamptz, $6::timestamptz,
       $7, $8, $9::jsonb, $10::jsonb
     )
     ON CONFLICT(event_id) DO UPDATE
     SET feed_id = CASE WHEN tradingview_events.raw ? 'timing_provenance_version' THEN tradingview_events.feed_id ELSE EXCLUDED.feed_id END,
         symbol_code = CASE WHEN tradingview_events.raw ? 'timing_provenance_version' THEN tradingview_events.symbol_code ELSE EXCLUDED.symbol_code END,
         timeframe = CASE WHEN tradingview_events.raw ? 'timing_provenance_version' THEN tradingview_events.timeframe ELSE EXCLUDED.timeframe END,
         timestamp_utc = CASE WHEN tradingview_events.raw ? 'timing_provenance_version' THEN tradingview_events.timestamp_utc ELSE EXCLUDED.timestamp_utc END,
         received_at = COALESCE(tradingview_events.received_at, EXCLUDED.received_at),
         alert_id = CASE WHEN tradingview_events.raw ? 'timing_provenance_version' THEN tradingview_events.alert_id ELSE EXCLUDED.alert_id END,
         status = CASE WHEN tradingview_events.raw ? 'timing_provenance_version' THEN tradingview_events.status ELSE EXCLUDED.status END,
         payload = CASE
           WHEN tradingview_events.raw ? 'timing_provenance_version' THEN tradingview_events.payload
           WHEN $11::boolean THEN tradingview_events.payload || EXCLUDED.payload
           ELSE EXCLUDED.payload
         END,
         raw = CASE
           WHEN tradingview_events.raw ? 'timing_provenance_version' THEN tradingview_events.raw
           WHEN $11::boolean THEN tradingview_events.raw || (EXCLUDED.raw - ARRAY['received_at_utc', 'source_bar_open_utc', 'source_bar_close_utc', 'timing_provenance_version'])
           ELSE EXCLUDED.raw - ARRAY['received_at_utc', 'source_bar_open_utc', 'source_bar_close_utc', 'timing_provenance_version']
         END,
         updated_at = now()`,
    [
      row.event_id,
      row.feed_id,
      row.symbol_code,
      row.timeframe,
      row.timestamp_utc,
      row.received_at,
      row.alert_id,
      row.status,
      JSON.stringify(row.payload),
      JSON.stringify(row.raw),
      merge,
    ],
  );
}
