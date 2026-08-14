import assert from "node:assert/strict";
import test from "node:test";
import {
  MARKET_DATA_CAPABILITY_PROFILE_SCHEMA_VERSION,
  persistMarketDataCapabilityReport,
  profileMarketDataCapabilities,
  readMarketDataCapabilityObservations,
} from "../src/market-data-capability-profiler.js";

const AS_OF_UTC = "2026-08-09T08:00:00.000Z";

test("market data capability profiler separates blocking OHLCV gaps from non-blocking microstructure gaps", () => {
  const report = profileMarketDataCapabilities({
    asOfUtc: AS_OF_UTC,
    environment: "prod",
    provider: "tradingview",
    inventory: inventoryFixture(),
    observations: [
      {
        feed_id: "prod__tradingview__MNQ1!__1",
        source_key: "prod__tradingview__MNQ1!__1",
        instrument_code: "MNQ1!",
        provider: "tradingview",
        environment: "prod",
        timeframe: "1",
        timeframe_seconds: 60,
        enabled: true,
        row_count: 100,
        closed_row_count: 100,
        volume_row_count: 100,
        has_tick: false,
        has_bid: false,
        has_ask: false,
        has_open_interest: false,
        historical_start_utc: "2026-06-01T00:00:00.000Z",
        historical_end_utc: "2026-06-01T02:00:00.000Z",
      },
      {
        feed_id: "prod__tradingview__MNQ1!__tick",
        source_key: "prod__tradingview__MNQ1!__tick",
        instrument_code: "MNQ1!",
        provider: "tradingview",
        environment: "prod",
        timeframe: "tick",
        enabled: true,
        row_count: 3,
        closed_row_count: 3,
        volume_row_count: 3,
        has_tick: true,
        has_bid: true,
        has_ask: true,
        has_open_interest: true,
        historical_start_utc: "2026-06-01T00:00:00.000Z",
        historical_end_utc: "2026-06-01T00:00:03.000Z",
      },
    ],
  });

  assert.equal(report.schema_version, MARKET_DATA_CAPABILITY_PROFILE_SCHEMA_VERSION);
  assert.equal(report.summary.profile_count, 4);
  assert.equal(report.summary.blocking_count, 1);

  const mnq = report.profiles.find((profile) => profile.source_key === "prod__tradingview__MNQ1!__1");
  assert.equal(mnq.status, "MEASURED");
  assert.equal(mnq.blocking_classification, "NON_BLOCKING");
  assert.deepEqual(mnq.measured_capabilities, ["ohlcv", "volume"]);
  assert.deepEqual(mnq.non_blocking_missing_capabilities, ["tick", "bid", "ask", "open_interest"]);
  assert.equal(mnq.storage_recommendation, "HOT_SERIES");

  const mes = report.profiles.find((profile) => profile.source_key === "prod__tradingview__MES1!__1");
  assert.equal(mes.status, "MISSING");
  assert.equal(mes.blocking_classification, "BLOCKING");
  assert.deepEqual(mes.blocking_missing_capabilities, ["ohlcv", "volume"]);

  const tick = report.profiles.find((profile) => profile.source_key === "prod__tradingview__MNQ1!__tick");
  assert.equal(tick.status, "MEASURED");
  assert.equal(tick.storage_recommendation, "HOT_AND_COLD");
  assert.equal(tick.has_bid, true);
  assert.equal(tick.has_ask, true);
  assert.equal(tick.has_open_interest, true);

  const optionalDxy = report.profiles.find((profile) => profile.source_key === "prod__tradingview__TVC:DXY__240");
  assert.equal(optionalDxy.status, "MISSING");
  assert.equal(optionalDxy.blocking_classification, "NON_BLOCKING");
});

test("market data capability profiler reads feed/candle observations with bounded scope", async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [{ feed_id: "prod__tradingview__MNQ1!__1", row_count: 1 }] };
    },
  };

  const rows = await readMarketDataCapabilityObservations(pool, {
    environment: "prod",
    provider: "tradingview",
    limit: 99_999,
  });

  assert.equal(rows.length, 1);
  assert.match(queries[0].sql, /WITH candle_gaps AS/);
  assert.match(queries[0].sql, /FROM market_feeds mf/);
  assert.match(queries[0].sql, /LEFT JOIN market_candles c/);
  assert.match(queries[0].sql, /bool_or\(c\.raw \? 'bid'/);
  assert.deepEqual(queries[0].params, ["prod", "tradingview", 25_000]);
});

test("market data capability profiler persists run and profile rows transactionally", async () => {
  const report = profileMarketDataCapabilities({
    asOfUtc: AS_OF_UTC,
    environment: "prod",
    provider: "tradingview",
    inventory: inventoryFixture({ sources: [inventoryFixture().sources[0]] }),
    observations: [{
      feed_id: "prod__tradingview__MNQ1!__1",
      source_key: "prod__tradingview__MNQ1!__1",
      instrument_code: "MNQ1!",
      provider: "tradingview",
      environment: "prod",
      timeframe: "1",
      enabled: true,
      row_count: 10,
      closed_row_count: 10,
      volume_row_count: 10,
      historical_start_utc: "2026-06-01T00:00:00.000Z",
      historical_end_utc: "2026-06-01T00:10:00.000Z",
    }],
  });
  const queries = [];
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      return { rows: [] };
    },
    release() {
      queries.push({ sql: "RELEASE", params: [] });
    },
  };
  const pool = { async connect() { return client; } };

  const result = await persistMarketDataCapabilityReport(pool, { report, dryRun: true });

  assert.equal(result.persisted, false);
  assert.equal(result.dry_run, true);
  assert.equal(result.profile_count, 1);
  assert.equal(queries[0].sql, "BEGIN");
  assert.equal(queries.some((query) => /INSERT INTO market_data_capability_profile_runs/.test(query.sql)), true);
  assert.equal(queries.some((query) => /INSERT INTO market_data_capability_profiles/.test(query.sql)), true);
  assert.equal(queries.some((query) => query.sql === "ROLLBACK"), true);
  assert.equal(queries.some((query) => query.sql === "COMMIT"), false);
});

function inventoryFixture(overrides = {}) {
  return {
    profile_id: "test_market_data_profile",
    profile_version: "1.0.0",
    environment: "prod",
    provider: "tradingview",
    sources: [
      {
        dataset: "MNQ_M1",
        role: "execution",
        required: true,
        symbols: ["MNQ1!"],
        expected_feeds: ["prod__tradingview__MNQ1!__1"],
      },
      {
        dataset: "MES_M1",
        role: "execution",
        required: true,
        symbols: ["MES1!"],
        expected_feeds: ["prod__tradingview__MES1!__1"],
      },
      {
        dataset: "DXY_H4",
        role: "context",
        required: false,
        symbols: ["DXY"],
        expected_feeds: ["prod__tradingview__TVC:DXY__240"],
      },
      {
        dataset: "MNQ_TICK",
        role: "microstructure",
        required: false,
        symbols: ["MNQ1!"],
        expected_feeds: ["prod__tradingview__MNQ1!__tick"],
      },
    ],
    ...overrides,
  };
}
