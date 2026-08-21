import { SystemClock } from "@tv-automation/desk-time";

const DEFAULT_LIMIT = 240;
const MAX_LIMIT = 1000;
const INSTRUMENT = /^[A-Z0-9!._-]{1,24}$/;
const MARKET_SERIES_CLOCK = new SystemClock();

export async function loadFrontMarketSeries(persistence, input = {}) {
  const pool = persistence?.pool || null;
  if (!pool) return unavailable("PostgreSQL market series repository is unavailable.");
  await persistence.initialized;
  const scope = marketScope(input);
  const result = await queryMarketSeries(pool, scope);
  return marketSeriesResponse(scope, result);
}

function marketScope(input) {
  const clockNow = MARKET_SERIES_CLOCK.now().utc;
  const requestedAsOf = validIso(input.as_of || input.asOf) || clockNow;
  return {
    instrument: normalizeInstrument(input.instrument || input.symbol || "MNQ"),
    timeframe: normalizeTimeframe(input.timeframe || "5"),
    limit: bounded(input.limit),
    requestedAsOf,
    asOf: new Date(Math.min(Date.parse(requestedAsOf), Date.parse(clockNow))).toISOString(),
    before: decodeCursor(input.cursor),
  };
}

async function queryMarketSeries(pool, scope) {
  const { instrument, timeframe, asOf, before, limit } = scope;
  const storageInstrument = canonicalStorageInstrument(instrument);
  const [seriesResult, timeframeResult, instrumentResult] = await Promise.all([
    pool.query(`WITH selected AS MATERIALIZED (
        SELECT feed_id, timestamp_utc, trading_date
        FROM market_candles
        WHERE symbol_code = $1 AND timeframe = $2 AND is_closed = true
          AND timestamp_utc <= $3
          AND ($4::timestamptz IS NULL OR timestamp_utc < $4)
        ORDER BY timestamp_utc DESC
        LIMIT $5
      ), scoped AS (
        SELECT feed_id, timestamp_utc, symbol_code, timeframe, trading_date,
          open, high, low, close, volume, source_collection,
          CASE WHEN SUM(COALESCE(volume, 0)) OVER (
            PARTITION BY symbol_code, timeframe, trading_date
            ORDER BY timestamp_utc ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) > 0 THEN
            SUM((((high + low + close) / 3.0) * COALESCE(volume, 0))) OVER (
              PARTITION BY symbol_code, timeframe, trading_date
              ORDER BY timestamp_utc ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) / SUM(COALESCE(volume, 0)) OVER (
              PARTITION BY symbol_code, timeframe, trading_date
              ORDER BY timestamp_utc ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            )
          ELSE NULL END AS vwap
        FROM market_candles
        WHERE symbol_code = $1 AND timeframe = $2 AND is_closed = true
          AND timestamp_utc <= $3
          AND trading_date IN (
            SELECT DISTINCT selected.trading_date
            FROM selected
          )
      )
      SELECT scoped.*
      FROM scoped
      INNER JOIN selected
        ON selected.feed_id = scoped.feed_id
        AND selected.timestamp_utc = scoped.timestamp_utc
      ORDER BY scoped.timestamp_utc DESC`, [storageInstrument, timeframe, asOf, before, limit + 1]),
    pool.query(`SELECT DISTINCT timeframe FROM market_candles
      WHERE symbol_code = $1 AND is_closed = true ORDER BY timeframe`, [storageInstrument]),
    pool.query(`SELECT DISTINCT symbol_code FROM market_candles
      WHERE is_closed = true ORDER BY symbol_code`),
  ]);
  return { series: seriesResult.rows, timeframes: timeframeResult.rows, instruments: instrumentResult.rows };
}

function canonicalStorageInstrument(instrument) {
  return ({ MNQ: "MNQ1!", MES: "MES1!", NQ: "NQ1!", ES: "ES1!" })[instrument] || instrument;
}

function marketSeriesResponse(scope, result) {
  const { instrument, timeframe, limit, requestedAsOf, asOf } = scope;
  const hasMore = result.series.length > limit;
  const selected = result.series.slice(0, limit).reverse().map(point);
  const oldest = selected[0]?.timestamp || null;
  const latest = selected.at(-1)?.timestamp || null;
  const supportedGranularities = result.timeframes.map((row) => String(row.timeframe)).filter(Boolean);
  const supportedInstruments = supportedDeskInstruments(result.instruments, instrument);
  return {
    schemaVersion: "front_market_series_v1",
    seriesId: `market:${instrument}:${timeframe}`,
    availability: selected.length ? "KNOWN" : "CONNECTED_EMPTY",
    source: "market_candles",
    sourceClass: "CANONICAL_MARKET_DATA",
    instrument,
    timeframe,
    supportedInstruments,
    timezone: "UTC",
    marketSession: "CME_GLOBEX",
    from: oldest,
    to: latest,
    dataCutoff: asOf,
    supportedTimeframes: supportedGranularities,
    supportedGranularities,
    defaultGranularity: supportedGranularities.includes("5") ? "5" : supportedGranularities[0] || null,
    maximumRangeByGranularity: maximumRanges(supportedGranularities),
    settlementLagByGranularity: Object.fromEntries(supportedGranularities.map((item) => [item, 0])),
    asOf: latest,
    requestedAsOf,
    cutoffAppliedAt: asOf,
    points: selected,
    bars: selected.map((item) => ({ ...item, complete: true })),
    vwapSeries: {
      seriesId: `vwap:${instrument}:${timeframe}:${selected[0]?.tradingDate || "session"}`,
      instrument,
      timeframe,
      sessionAnchor: selected[0]?.tradingDate || null,
      calculationVersion: "sql-cumulative-typical-price-volume-v1",
      sourceDataCutoff: asOf,
      source: "market_candles.sql_window",
      asOf: latest,
      values: selected.filter((item) => item.vwap !== null).map((item) => ({ timestamp: item.timestamp, value: item.vwap })),
    },
    gaps: identifyGaps(selected, timeframe),
    page: {
      limit,
      hasMore,
      nextCursor: hasMore && oldest ? encodeCursor(oldest) : null,
    },
    antiLookahead: selected.every((item) => Date.parse(item.timestamp) <= Date.parse(asOf)),
  };
}

function maximumRanges(timeframes) {
  const limits = { "1": "P7D", "5": "P31D", "15": "P90D", "30": "P180D", "60": "P365D", "240": "P730D", D: "P10Y", "1D": "P10Y" };
  return Object.fromEntries(timeframes.map((item) => [item, limits[item] || "P31D"]));
}

function identifyGaps(points, timeframe) {
  const minutes = Number(timeframe);
  if (!Number.isFinite(minutes) || minutes <= 0) return [];
  const expectedMs = minutes * 60_000;
  const gaps = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const delta = Date.parse(current.timestamp) - Date.parse(previous.timestamp);
    if (delta > expectedMs * 1.5) gaps.push({ from: previous.timestamp, to: current.timestamp, missingIntervals: Math.max(1, Math.round(delta / expectedMs) - 1) });
  }
  return gaps;
}

function point(row) {
  return {
    timestamp: new Date(row.timestamp_utc).toISOString(),
    tradingDate: row.trading_date || null,
    open: nullable(row.open),
    high: nullable(row.high),
    low: nullable(row.low),
    close: nullable(row.close),
    volume: nullable(row.volume),
    vwap: nullable(row.vwap),
    source: row.source_collection || "market_candles",
  };
}

function unavailable(reason) {
  return {
    schemaVersion: "front_market_series_v1",
    seriesId: null,
    availability: "UNAVAILABLE",
    source: "market_candles",
    sourceClass: "CANONICAL_MARKET_DATA",
    instrument: null,
    timeframe: null,
    supportedInstruments: [],
    supportedTimeframes: [],
    supportedGranularities: [],
    defaultGranularity: null,
    maximumRangeByGranularity: {},
    settlementLagByGranularity: {},
    timezone: "UTC",
    marketSession: null,
    from: null,
    to: null,
    dataCutoff: null,
    asOf: null,
    requestedAsOf: null,
    cutoffAppliedAt: null,
    points: [],
    bars: [],
    vwapSeries: null,
    gaps: [],
    page: { limit: DEFAULT_LIMIT, hasMore: false, nextCursor: null },
    antiLookahead: true,
    reason,
  };
}

function normalizeInstrument(value) {
  const normalized = String(value || "").trim().toUpperCase();
  const alias = ({ MQ: "MNQ", MS: "MES", MQM5: "MNQ", MSM5: "MES" })[normalized];
  if (alias) return alias;
  if (!INSTRUMENT.test(normalized)) throw inputError("MARKET_SERIES_INSTRUMENT_INVALID", "Invalid market instrument.");
  return normalized;
}

function supportedDeskInstruments(rows, requestedInstrument) {
  const symbols = rows.map((row) => deskInstrumentFromStorage(row.symbol_code)).filter(Boolean);
  return [...new Set([requestedInstrument, ...symbols])].sort((left, right) => left.localeCompare(right));
}

function deskInstrumentFromStorage(value) {
  const symbol = String(value || "").trim().toUpperCase();
  return ({ "MNQ1!": "MNQ", "MES1!": "MES", "NQ1!": "NQ", "ES1!": "ES" })[symbol] || symbol;
}

function normalizeTimeframe(value) {
  const normalized = String(value || "").trim().toUpperCase().replace(/^M/, "");
  if (!/^(1|5|15|30|60|240|D|1D)$/.test(normalized)) throw inputError("MARKET_SERIES_TIMEFRAME_INVALID", "Unsupported market timeframe.");
  return normalized;
}

function bounded(value) {
  const parsed = Number(value);
  return Math.max(1, Math.min(Number.isFinite(parsed) ? Math.trunc(parsed) : DEFAULT_LIMIT, MAX_LIMIT));
}

function validIso(value) {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw inputError("MARKET_SERIES_AS_OF_INVALID", "Invalid market asOf timestamp.");
  return new Date(parsed).toISOString();
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify({ before: value }), "utf8").toString("base64url");
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    return validIso(JSON.parse(Buffer.from(String(value), "base64url").toString("utf8")).before);
  } catch {
    throw inputError("MARKET_SERIES_CURSOR_INVALID", "Invalid market series cursor.");
  }
}

function nullable(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function inputError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 400;
  return error;
}
