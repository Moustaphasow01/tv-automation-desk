import assert from "node:assert/strict";
import test from "node:test";
import {
  auditMarketDataCoverage,
  buildMarketDataSourceInventory,
  evaluateMarketDataCoverage,
  readMarketDataCoverageObservations,
} from "../src/market-data-coverage-service.js";

test("market data inventory exposes required canonical feeds and optional context sources", () => {
  const inventory = buildMarketDataSourceInventory();
  const mnq = inventory.sources.find((item) => item.dataset === "MNQ_M1");
  const dxy = inventory.sources.find((item) => item.dataset === "DXY_CL_GC_VIX");
  const megaCaps = inventory.sources.find((item) => item.dataset === "mega_caps_premarket");

  assert.equal(inventory.profile_id, "v5_replay_canonical_m1_m5");
  assert.deepEqual(mnq.expected_feeds, ["prod__tradingview__MNQ1!__1"]);
  assert.equal(mnq.required, true);
  assert.equal(mnq.severity_if_missing, "blocking");
  assert.equal(dxy.required, false);
  assert.equal(dxy.severity_if_missing, "degraded");
  assert.ok(dxy.expected_feeds.includes("prod__tradingview__DXY__5"));
  assert.equal(megaCaps.required, false);
  for (const feed of ["prod__tradingview__AMZN__5", "prod__tradingview__META__5", "prod__tradingview__GOOGL__5", "prod__tradingview__AVGO__5"]) {
    assert.ok(megaCaps.expected_feeds.includes(feed), feed);
  }
});

test("coverage blocks only missing required execution feeds and degrades optional context", () => {
  const inventory = buildMarketDataSourceInventory();
  const report = evaluateMarketDataCoverage({
    inventory,
    asOfUtc: "2026-07-27T08:03:00.000Z",
    observations: [
      {
        feed_id: "prod__tradingview__MNQ1!__1",
        symbol_id: "tradingview:MNQ1!",
        enabled: true,
        latest_timestamp_utc: "2026-07-27T08:01:00.000Z",
        row_count: 120,
      },
      {
        feed_id: "prod__tradingview__MES1!__1",
        symbol_id: "tradingview:MES1!",
        enabled: true,
        latest_timestamp_utc: "2026-07-27T08:01:00.000Z",
        row_count: 120,
      },
    ],
  });

  assert.equal(report.execution_allowed, true);
  assert.equal(report.status, "degraded");
  assert.equal(report.datasets.MNQ_M1.status, "ready");
  assert.equal(report.datasets.MNQ_M5.status, "ready_derived");
  assert.equal(report.datasets.DXY_CL_GC_VIX.impact, "degraded");
});

test("coverage reports stale required feeds as blocking", () => {
  const inventory = buildMarketDataSourceInventory();
  const report = evaluateMarketDataCoverage({
    inventory,
    asOfUtc: "2026-07-27T08:10:00.000Z",
    observations: [
      {
        feed_id: "prod__tradingview__MNQ1!__1",
        symbol_id: "tradingview:MNQ1!",
        enabled: true,
        latest_timestamp_utc: "2026-07-27T08:00:00.000Z",
        row_count: 120,
      },
      {
        feed_id: "prod__tradingview__MES1!__1",
        symbol_id: "tradingview:MES1!",
        enabled: true,
        latest_timestamp_utc: "2026-07-27T08:09:00.000Z",
        row_count: 120,
      },
    ],
  });

  assert.equal(report.execution_allowed, false);
  assert.equal(report.datasets.MNQ_M1.status, "stale");
  assert.equal(report.datasets.MNQ_M5.status, "stale");
  assert.ok(report.blocking_datasets.includes("MNQ_M1"));
  assert.ok(report.blocking_datasets.includes("MNQ_M5"));
});

test("PostgreSQL observation reader queries exact expected feeds", async () => {
  const calls = [];
  const pool = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [{ feed_id: "prod__tradingview__MNQ1!__1", symbol_id: "tradingview:MNQ1!", enabled: true, latest_timestamp_utc: "2026-07-27T08:01:00.000Z", row_count: 1 }] };
    },
  };
  const rows = await readMarketDataCoverageObservations(pool, { inventory: buildMarketDataSourceInventory() });

  assert.equal(rows.length, 1);
  assert.match(calls[0].sql, /WITH wanted/);
  assert.ok(calls[0].values[0].includes("prod__tradingview__MNQ1!__1"));
  assert.ok(calls[0].values[0].includes("prod__tradingview__MES1!__1"));
});

test("audit runs without a database and returns an explicit not_configured state", async () => {
  const report = await auditMarketDataCoverage({ asOfUtc: "2026-07-27T08:03:00.000Z" });
  assert.equal(report.database_status, "not_configured");
  assert.equal(report.coverage.execution_allowed, false);
  assert.equal(report.coverage.datasets.MNQ_M1.reason, "feed_not_found");
});
