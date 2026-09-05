import { loadGrainsCalendarVersionAt } from "./postgres-grains-calendar-ledger.js";

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
  const calendar = await loadGrainsCalendarVersionAt(pool, {
    startUtc,
    asOfUtc,
  });
  return {
    rowsBySymbol: Object.fromEntries(entries),
    ...calendar,
  };
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
