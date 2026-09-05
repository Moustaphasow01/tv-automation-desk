const SYMBOLS = Object.freeze(["ZW1!", "ZC1!"]);

// Approved market-data read projection for the grains runtime. No writes here.
export async function loadGrainRuntimeMarketInputs(
  pool,
  { tradingDate, asOfUtc },
) {
  const startUtc = new Date(
    Date.parse(`${tradingDate}T00:00:00.000Z`) - 8 * 86_400_000,
  ).toISOString();
  const entries = [];
  for (const symbol of SYMBOLS) {
    for (const timeframe of ["1", "5"]) {
      const rows = await loadClosedCandles(pool, {
        symbol,
        timeframe,
        startUtc,
        asOfUtc,
      });
      entries.push([`${symbol}:${timeframe}`, rows]);
    }
  }
  const agriEvents = await loadKnownCalendar(pool, { startUtc, asOfUtc });
  const agriCalendarCoverage = await loadCalendarCoverage(pool, asOfUtc);
  return {
    rowsBySymbol: Object.fromEntries(entries),
    agriEvents,
    agriCalendarCoverage,
  };
}

async function loadCalendarCoverage(pool, asOfUtc) {
  const result = await pool.query(
    `SELECT source_id, source_type, source_status, coverage_start_utc,
            coverage_end_utc, as_of_utc, provider, dataset_version, reason_codes,
            metadata->>'source_version_hash' AS source_version_hash
       FROM market_source_coverage_manifests
      WHERE source_id = 'market_agri_events' AND as_of_utc <= $1::timestamptz`,
    [asOfUtc],
  );
  return result.rows.map((row) => ({
    sourceId: row.source_id,
    sourceType: row.source_type,
    status: row.source_status,
    coverageStart: row.coverage_start_utc?.toISOString() || null,
    coverageEnd: row.coverage_end_utc?.toISOString() || null,
    asOf: row.as_of_utc?.toISOString() || null,
    provider: row.provider,
    datasetVersion: row.dataset_version,
    sourceVersionHash: row.source_version_hash,
    reasonCodes: row.reason_codes,
  }));
}

async function loadClosedCandles(
  pool,
  { symbol, timeframe, startUtc, asOfUtc },
) {
  const result = await pool.query(
    `SELECT timestamp_utc, open, high, low, close, volume
       FROM market_candles
      WHERE feed_id = $1 AND timestamp_utc >= $2::timestamptz AND is_closed = true
        AND timestamp_utc + $4::integer * interval '1 minute' <= $3::timestamptz
      ORDER BY timestamp_utc ASC`,
    [
      `prod__tradingview__${symbol}__${timeframe}`,
      startUtc,
      asOfUtc,
      Number(timeframe),
    ],
  );
  return result.rows.map((row) => ({
    timestamp_utc: new Date(row.timestamp_utc).toISOString(),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: row.volume === null ? null : Number(row.volume),
  }));
}

async function loadKnownCalendar(pool, { startUtc, asOfUtc }) {
  const result = await pool.query(
    `SELECT market_agri_event_id, event_kind, title, event_timestamp_utc, importance,
            COALESCE(NULLIF(point_in_time_payload->>'source_published_at_utc', '')::timestamptz,
                     created_at_utc) AS source_published_at_utc
       FROM market_agri_events
      WHERE universe_key = 'US_GRAINS_CBOT'
        AND event_timestamp_utc >= $1::timestamptz
        AND event_timestamp_utc <= $2::timestamptz + interval '14 days'
        AND COALESCE(NULLIF(point_in_time_payload->>'source_published_at_utc', '')::timestamptz,
                     created_at_utc) <= $2::timestamptz
      ORDER BY event_timestamp_utc ASC, market_agri_event_id ASC`,
    [startUtc, asOfUtc],
  );
  // Detection needs the known schedule, never the later release's actual values.
  return result.rows.map((row) => ({
    market_agri_event_id: row.market_agri_event_id,
    event_kind: row.event_kind,
    title: row.title,
    importance: row.importance,
    event_timestamp_utc: new Date(row.event_timestamp_utc).toISOString(),
    source_published_at_utc: new Date(
      row.source_published_at_utc,
    ).toISOString(),
  }));
}
