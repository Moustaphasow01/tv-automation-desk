import { evaluateTheoreticalEntryIntent, evaluateTheoreticalTradeExit } from "./theoretical-execution-engine.js";

// Persistence adapter only: touch/fill semantics belong to the shared simulator.
// M1 timestamps are bar OPEN times; OHLC is available after the minute closes.
export async function latestClosedCandleForIntent(repository, intent, { now = new Date().toISOString() } = {}) {
  await repository.ready();
  const candles = (await repository.pool.query(`SELECT mc.*
    FROM market_candles mc JOIN market_feeds mf ON mf.feed_id = mc.feed_id
    WHERE mf.instrument_code = $1 AND mc.timeframe = '1' AND mc.is_closed = true
      AND mc.timestamp_utc >= $2::timestamptz
      AND mc.timestamp_utc + interval '1 minute' <= $3::timestamptz
      AND ($4::timestamptz IS NULL OR mc.timestamp_utc + interval '1 minute' <= $4::timestamptz)
    ORDER BY mc.timestamp_utc ASC, mc.feed_id ASC LIMIT 5000`, [
    intent.contract_instrument_code || intent.instrument_code,
    intent.requested_at, now, intent.expires_at || null,
  ])).rows;
  const uniqueCandles = uniqueMinuteCandles(candles);
  const touched = uniqueCandles.find((candle) => evaluateTheoreticalEntryIntent({
    intent, candle, now, contract: { instrument_code: intent.instrument_code, tick_size: intent.tick_size },
  }).action === "fill_entry");
  if (touched) return touched;
  const last = uniqueCandles.at(-1);
  return last ? { ...last, theoretical_window_complete: completeEntryWindow(intent, uniqueCandles, now) } : null;
}

export async function latestClosedCandleForTrade(repository, trade, { now = new Date().toISOString() } = {}) {
  await repository.ready();
  const candles = (await repository.pool.query(`SELECT mc.*
    FROM market_candles mc JOIN market_feeds mf ON mf.feed_id = mc.feed_id
    WHERE mf.instrument_code = $1 AND mc.timeframe = '1' AND mc.is_closed = true
      AND mc.timestamp_utc > $2::timestamptz
      AND mc.timestamp_utc + interval '1 minute' <= $3::timestamptz
    ORDER BY mc.timestamp_utc ASC, mc.feed_id ASC LIMIT 500`, [
    trade.instrument_code, trade.theoretical_cursor_at_utc || trade.opened_at, now,
  ])).rows;
  return candles.find((candle) => ["fill_exit", "review_exit"].includes(
    evaluateTheoreticalTradeExit({ trade, candle }).action,
  )) || candles.at(-1) || null;
}

function uniqueMinuteCandles(candles) {
  const byTime = new Map();
  for (const candle of candles) {
    const time = new Date(candle.timestamp_utc).toISOString();
    if (!byTime.has(time)) byTime.set(time, candle);
  }
  return [...byTime.values()];
}

function completeEntryWindow(intent, candles, now) {
  const start = Math.ceil(Date.parse(intent.requested_at) / 60_000) * 60_000;
  const end = Math.floor(Date.parse(intent.expires_at) / 60_000) * 60_000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || Date.parse(now) < Date.parse(intent.expires_at)) return false;
  if (Date.parse(intent.expires_at) !== end) return false;
  const expected = (end - start) / 60_000;
  // Missing minutes must not turn into a fabricated expiration. Session-aware
  // coverage/reconciliation is a separate domain decision, never an SQL default.
  return candles.length === expected && candles.every((candle, index) =>
    Date.parse(candle.timestamp_utc) === start + index * 60_000);
}
