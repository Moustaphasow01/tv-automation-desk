import assert from "node:assert/strict";
import test from "node:test";
import {
  MARKET_DATA_STORAGE_PLAN_SCHEMA_VERSION,
  planMarketDataStorage,
  storageTiers,
} from "../src/market-data-storage-planner.js";

const AS_OF_UTC = "2026-08-09T08:00:00.000Z";

test("market data storage planner maps capability recommendations to hot/cold tiers", () => {
  const plan = planMarketDataStorage({
    asOfUtc: AS_OF_UTC,
    objectStorageBaseUri: "file:///D:/desk-data/object-storage/market-data",
    capabilityReport: {
      profile_ref: "v5_replay_canonical_m1_m5@1.0.0",
      profiles: [
        profileFixture({
          source_key: "prod__tradingview__MNQ1!__1",
          instrument_code: "MNQ1!",
          storage_recommendation: "HOT_SERIES",
          cost_profile: { estimated_total_mb: 0.12 },
        }),
        profileFixture({
          source_key: "prod__tradingview__MNQ1!__tick",
          instrument_code: "MNQ1!",
          timeframe: "tick",
          storage_recommendation: "HOT_AND_COLD",
          has_tick: true,
          has_bid: true,
          has_ask: true,
          has_open_interest: true,
          cost_profile: { estimated_total_mb: 1.5 },
        }),
        profileFixture({
          source_key: "prod__tradingview__TVC:DXY__240",
          instrument_code: "DXY",
          timeframe: "240",
          status: "MISSING",
          has_ohlcv: false,
          storage_recommendation: "IGNORE",
          cost_profile: { estimated_total_mb: 0 },
        }),
      ],
    },
  });

  assert.equal(plan.schema_version, MARKET_DATA_STORAGE_PLAN_SCHEMA_VERSION);
  assert.equal(plan.summary.item_count, 3);
  assert.equal(plan.summary.hot_series_count, 2);
  assert.equal(plan.summary.cold_object_count, 1);
  assert.equal(plan.summary.ignored_count, 1);

  const mnqM1 = plan.items.find((item) => item.source_key === "prod__tradingview__MNQ1!__1");
  assert.equal(mnqM1.storage_tier, "HOT_SERIES");
  assert.equal(mnqM1.hot_series.required, true);
  assert.equal(mnqM1.cold_object.required, false);
  assert.equal(mnqM1.reconstruction.source_of_truth, "hot_series");

  const tick = plan.items.find((item) => item.source_key === "prod__tradingview__MNQ1!__tick");
  assert.equal(tick.storage_tier, "HOT_AND_COLD");
  assert.equal(tick.hot_series.required, true);
  assert.equal(tick.cold_object.required, true);
  assert.equal(tick.cold_object.format, "PARQUET");
  assert.equal(tick.cold_object.compression, "zstd");
  assert.match(tick.cold_object.uri, /^file:\/\/\/D:\/desk-data\/object-storage\/market-data\/tier=hot_and_cold\//);
  assert.equal(tick.reconstruction.source_of_truth, "cold_object");

  const dxy = plan.items.find((item) => item.source_key === "prod__tradingview__TVC:DXY__240");
  assert.equal(dxy.storage_tier, "IGNORE");
  assert.equal(dxy.hot_series.required, false);
  assert.equal(dxy.cold_object.required, false);
  assert.equal(dxy.reconstruction.can_reconstruct_dataset, false);
});

test("market data storage planner publishes tier semantics", () => {
  const tiers = storageTiers();

  assert.equal(tiers.HOT_SERIES.default_format, "POSTGRES_SERIES");
  assert.equal(tiers.COLD_PARQUET.default_format, "PARQUET");
  assert.deepEqual(tiers.COLD_PARQUET.partition_by, ["provider", "environment", "instrument_code", "timeframe", "date"]);
  assert.equal(tiers.IGNORE.default_format, null);
});

function profileFixture(overrides = {}) {
  return {
    source_key: "prod__tradingview__MNQ1!__1",
    instrument_code: "MNQ1!",
    provider: "tradingview",
    environment: "prod",
    timeframe: "1",
    status: "MEASURED",
    blocking_classification: "NON_BLOCKING",
    storage_recommendation: "HOT_SERIES",
    historical_start_utc: "2026-06-01T00:00:00.000Z",
    historical_end_utc: "2026-06-30T21:45:00.000Z",
    observed_row_count: 1000,
    has_ohlcv: true,
    has_tick: false,
    has_bid: false,
    has_ask: false,
    has_open_interest: false,
    missing_capabilities: ["tick", "bid", "ask", "open_interest"],
    cost_profile: { estimated_total_mb: 0.12 },
    ...overrides,
  };
}
