import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { loadFrontMarketSeries } from "../src/front-market-series-service.js";

describe("Front canonical market series", () => {
  test("publishes bounded OHLCV, deterministic VWAP, gaps, granularities and opaque pagination", async () => {
    const persistence = fixturePersistence();
    const result = await loadFrontMarketSeries(persistence, { instrument: "MNQ", timeframe: "M5", as_of: "2026-08-12T14:10:00.000Z", limit: 2 });

    assert.equal(result.availability, "KNOWN");
    assert.equal(result.seriesId, "market:MNQ:5");
    assert.deepEqual(result.supportedInstruments, ["MES", "MNQ"]);
    assert.deepEqual(result.supportedGranularities, ["1", "5", "15"]);
    assert.equal(result.defaultGranularity, "5");
    assert.equal(result.bars.length, 2);
    assert.equal(result.bars.every((bar) => bar.complete === true), true);
    assert.equal(result.points[0].timestamp, "2026-08-12T14:00:00.000Z");
    assert.equal(result.points[1].timestamp, "2026-08-12T14:10:00.000Z");
    assert.deepEqual(result.vwapSeries.values.map((item) => item.value), [20000.5, 20001]);
    assert.equal(result.gaps[0].missingIntervals, 1);
    assert.equal(result.page.hasMore, true);
    assert.equal(typeof result.page.nextCursor, "string");
    assert.equal(result.antiLookahead, true);
  });

  test("returns CONNECTED_EMPTY rather than a false zero series", async () => {
    const persistence = { initialized: Promise.resolve(), pool: { async query(sql) { return { rows: sql.includes("DISTINCT timeframe") ? [{ timeframe: "5" }] : [] }; } } };
    const result = await loadFrontMarketSeries(persistence, { instrument: "MNQ", timeframe: "5", as_of: "2026-08-12T14:10:00.000Z" });
    assert.equal(result.availability, "CONNECTED_EMPTY");
    assert.deepEqual(result.bars, []);
    assert.equal(result.asOf, null);
  });

  test("resolves desk instrument aliases to canonical continuous-contract storage symbols", async () => {
    const queriedSymbols = [];
    const persistence = {
      initialized: Promise.resolve(),
      pool: {
        async query(sql, values = []) {
          if (values.length) queriedSymbols.push(values[0]);
          if (sql.includes("DISTINCT symbol_code")) return { rows: [{ symbol_code: "MNQ1!" }, { symbol_code: "MES1!" }] };
          return { rows: [] };
        },
      },
    };

    const result = await loadFrontMarketSeries(persistence, { instrument: "MQ", timeframe: "5" });

    assert.deepEqual(queriedSymbols, ["MNQ1!", "MNQ1!"]);
    assert.equal(result.instrument, "MNQ", "the operator-facing instrument remains the normalized desk symbol");
    assert.deepEqual(result.supportedInstruments, ["MES", "MNQ"]);
  });

  test("resolves grain roots to continuous-contract storage symbols without leaking aliases to the Front", async () => {
    const queriedSymbols = [];
    const persistence = {
      initialized: Promise.resolve(),
      pool: {
        async query(sql, values = []) {
          if (values.length) queriedSymbols.push(values[0]);
          if (sql.includes("DISTINCT symbol_code")) return { rows: [{ symbol_code: "ZW1!" }, { symbol_code: "ZC1!" }] };
          return { rows: [] };
        },
      },
    };

    const result = await loadFrontMarketSeries(persistence, { instrument: "ZW", timeframe: "5" });

    assert.deepEqual(queriedSymbols, ["ZW1!", "ZW1!"]);
    assert.equal(result.instrument, "ZW");
    assert.deepEqual(result.supportedInstruments, ["ZC", "ZW"]);
  });

  test("normalizes higher-timeframe aliases to the canonical BFF/storage contract", async () => {
    const queriedTimeframes = [];
    const persistence = {
      initialized: Promise.resolve(),
      pool: {
        async query(sql, values = []) {
          if (values.length >= 2) queriedTimeframes.push(values[1]);
          if (sql.includes("DISTINCT timeframe")) return { rows: [{ timeframe: "1" }, { timeframe: "5" }, { timeframe: "1H" }, { timeframe: "4H" }] };
          if (sql.includes("DISTINCT symbol_code")) return { rows: [{ symbol_code: "ZC1!" }, { symbol_code: "ZW1!" }] };
          return { rows: [
            { feed_id: "feed-h1-1", timestamp_utc: "2026-09-02T15:00:00.000Z", trading_date: "2026-09-02", open: 540, high: 544, low: 539, close: 543, volume: 1000, source_collection: "market_candles" },
            { feed_id: "feed-h1-2", timestamp_utc: "2026-09-02T14:00:00.000Z", trading_date: "2026-09-02", open: 538, high: 541, low: 537, close: 540, volume: 1000, source_collection: "market_candles" },
          ] };
        },
      },
    };

    const result = await loadFrontMarketSeries(persistence, { instrument: "ZC", timeframe: "H1", as_of: "2026-09-02T16:00:00.000Z" });

    assert.equal(result.availability, "KNOWN");
    assert.equal(result.seriesId, "market:ZC:1H");
    assert.equal(result.timeframe, "1H");
    assert.deepEqual(queriedTimeframes, ["1H"]);
    assert.deepEqual(result.supportedGranularities, ["1", "5", "1H", "4H"]);
    assert.equal(result.maximumRangeByGranularity["1H"], "P365D");
    assert.equal(result.gaps.length, 0);
  });

  test("rejects unsupported timeframes and malformed cursors", async () => {
    const persistence = fixturePersistence();
    await assert.rejects(() => loadFrontMarketSeries(persistence, { instrument: "MNQ", timeframe: "2" }), (error) => error.code === "MARKET_SERIES_TIMEFRAME_INVALID");
    await assert.rejects(() => loadFrontMarketSeries(persistence, { instrument: "MNQ", timeframe: "5", cursor: "not-a-cursor" }), (error) => error.code === "MARKET_SERIES_CURSOR_INVALID");
  });
});

function fixturePersistence() {
  return {
    initialized: Promise.resolve(),
    pool: {
      async query(sql) {
        if (sql.includes("DISTINCT timeframe")) return { rows: [{ timeframe: "1" }, { timeframe: "5" }, { timeframe: "15" }] };
        if (sql.includes("DISTINCT symbol_code")) return { rows: [{ symbol_code: "MNQ1!" }, { symbol_code: "MES1!" }] };
        return { rows: [
          candle("2026-08-12T14:10:00.000Z", 20001, 20001),
          candle("2026-08-12T14:00:00.000Z", 20000, 20000.5),
          candle("2026-08-12T13:55:00.000Z", 19999, 20000),
        ] };
      },
    },
  };
}

function candle(timestamp, close, vwap) {
  return { feed_id: `feed-${timestamp}`, timestamp_utc: timestamp, symbol_code: "MNQ", timeframe: "5", trading_date: "2026-08-12", open: close - 1, high: close + 1, low: close - 2, close, volume: 100, source_collection: "market_candles", vwap };
}
