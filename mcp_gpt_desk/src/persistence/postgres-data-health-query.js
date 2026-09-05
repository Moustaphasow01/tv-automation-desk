const CORE_FEED_HEALTH_SQL = `SELECT DISTINCT ON (mf.instrument_code, mf.timeframe)
                mf.instrument_code,
                mf.timeframe,
                mf.feed_id,
                mf.provider,
                mf.source_service,
                latest.timestamp_utc AS latest_timestamp_utc,
                latest.close_utc AS latest_candle_close_utc,
                latest.imported_at AS latest_imported_at_utc,
                latest.source_collection AS latest_source_collection,
                latest.raw->>'source' AS latest_candle_source,
                latest.raw->>'event_id' AS latest_candle_event_id,
                latest.raw->>'source_bar_open_utc' AS latest_source_bar_open_utc,
                latest.raw->>'source_bar_close_utc' AS latest_source_bar_close_utc,
                latest.raw->>'timing_provenance_version' AS latest_timing_provenance_version,
                event.received_at AS latest_event_received_at_utc,
                event.alert_id AS latest_event_alert_id,
                event.payload->>'source' AS latest_event_payload_source,
                event.raw->>'source' AS latest_event_raw_source,
                first_receipt.received_at AS earliest_available_received_at_utc,
                current_event.event_id AS current_event_id,
                current_event.received_at AS current_event_received_at_utc,
                current_event.imported_at AS event_first_persisted_at_utc,
                current_event.alert_id AS current_event_alert_id,
                current_event.payload->>'source' AS current_event_payload_source,
                current_event.raw->>'source' AS current_event_raw_source,
                current_event.raw->>'timing_provenance_version' AS current_event_timing_provenance_version
         FROM market_feeds mf
         LEFT JOIN LATERAL (
           SELECT mc.timestamp_utc,
                  mc.timestamp_utc + CASE mf.timeframe
                    WHEN '1' THEN interval '1 minute'
                    WHEN '5' THEN interval '5 minutes'
                  END AS close_utc,
                  mc.imported_at,
                  mc.source_collection,
                  mc.raw
           FROM market_candles mc
           WHERE mc.feed_id = mf.feed_id
             AND mc.is_closed = true
             AND mc.timestamp_utc + CASE mf.timeframe
               WHEN '1' THEN interval '1 minute'
               WHEN '5' THEN interval '5 minutes'
             END <= $2::timestamptz
           ORDER BY mc.timestamp_utc DESC
           LIMIT 1
         ) latest ON true
         LEFT JOIN LATERAL (
           SELECT te.received_at, te.alert_id, te.payload, te.raw
           FROM tradingview_events te
           WHERE te.feed_id = mf.feed_id
             AND te.timestamp_utc = latest.timestamp_utc
           ORDER BY te.received_at DESC NULLS LAST, te.updated_at DESC
           LIMIT 1
         ) event ON true
         LEFT JOIN LATERAL (
           SELECT min(te.received_at) AS received_at
           FROM tradingview_events te
           WHERE te.feed_id = mf.feed_id
             AND te.timestamp_utc = latest.timestamp_utc
         ) first_receipt ON true
         LEFT JOIN LATERAL (
           SELECT te.event_id, te.received_at, te.imported_at, te.alert_id, te.payload, te.raw
           FROM tradingview_events te
           WHERE te.feed_id = mf.feed_id
             AND te.event_id = latest.raw->>'event_id'
             AND te.timestamp_utc = latest.timestamp_utc
             AND te.timeframe = mf.timeframe
             AND latest.raw->>'timing_provenance_version' = 'tradingview_webhook_timing_v1'
             AND te.raw->>'timing_provenance_version' = 'tradingview_webhook_timing_v1'
           LIMIT 1
         ) current_event ON true
         WHERE mf.enabled = true
           AND mf.environment = 'prod'
           AND mf.instrument_code = ANY($1::text[])
           AND mf.timeframe IN ('1', '5')
         ORDER BY mf.instrument_code,
                  mf.timeframe,
                  latest.timestamp_utc DESC NULLS LAST,
                  mf.feed_id`;

export function coreFeedHealthSql() {
  return CORE_FEED_HEALTH_SQL;
}
