import assert from "node:assert/strict";
import test from "node:test";
import {
  MARKET_CONTEXT_SUPERSEDE_READY_SQL,
  detectMarketContextEventReasons,
  marketContextFreshnessThresholdMs,
  marketContextSourceReasonSignature,
} from "../src/market-context-task-scheduler.js";

test("market context scheduler detects session, source, volatility, structure and agri triggers deterministically", () => {
  const cutoff = "2026-09-01T14:30:00.000Z";
  const reasons = detectMarketContextEventReasons({
    cutoff,
    canonicalMarketSession: { marketSession: "CBOT_GRAINS_RTH" },
    previousSnapshot: {
      marketSession: "CBOT_GRAINS_PREOPEN",
      sourceStates: [{ sourceId: "ZC_1", status: "STALE" }],
    },
    sourceStates: [{ sourceId: "ZC_1", status: "AVAILABLE" }],
    series: {
      "ZC:1": {
        return: 0.009,
        bars: [
          { high: 440, low: 438, close: 439 },
          { high: 441, low: 439, close: 440 },
          { high: 442, low: 440, close: 441 },
          { high: 445, low: 441, close: 444 },
        ],
      },
    },
    coveredAgriEvents: [{ importance: "CRITICAL", event_timestamp_utc: "2026-09-01T14:40:00.000Z" }],
  });

  assert.deepEqual(reasons, [
    "HIGH_AGRI_EVENT_NEARBY",
    "SESSION_TRANSITION",
    "SOURCE_ZC_1_STALE_TO_AVAILABLE",
    "STRUCTURE_BREAK_ZC_1",
    "VOLATILITY_SHOCK_ZC_1",
  ]);
});

test("market context scheduler inherits the active readiness freshness budget", () => {
  assert.equal(marketContextFreshnessThresholdMs({ timeframe: "1" }), 150_000);
  assert.equal(marketContextFreshnessThresholdMs({ timeframe: "5" }), 420_000);
  assert.equal(marketContextFreshnessThresholdMs({
    timeframe: "1",
    readinessPolicy: { max_age_seconds: 1200 },
  }), 1_200_000);
  assert.equal(marketContextFreshnessThresholdMs({
    timeframe: "5",
    readinessPolicy: { max_age_seconds: 1200 },
  }), 1_200_000);
});

test("market context scheduler does not dedupe on raw candle timestamps", () => {
  assert.deepEqual(
    marketContextSourceReasonSignature({
      sourceId: "ZC_1",
      status: "AVAILABLE",
      coverageEnd: "2026-09-02T16:59:00.000Z",
      datasetVersion: "market_candles_v1",
    }),
    marketContextSourceReasonSignature({
      sourceId: "ZC_1",
      status: "AVAILABLE",
      coverageEnd: "2026-09-02T17:00:00.000Z",
      datasetVersion: "market_candles_v1",
    }),
  );
});

test("market context supersede SQL only cancels ready live context tasks", () => {
  assert.match(MARKET_CONTEXT_SUPERSEDE_READY_SQL, /t\.status = 'READY'/);
  assert.match(MARKET_CONTEXT_SUPERSEDE_READY_SQL, /SET status = 'CANCELLED'/);
  assert.match(MARKET_CONTEXT_SUPERSEDE_READY_SQL, /SET status = 'SKIPPED'/);
  assert.match(MARKET_CONTEXT_SUPERSEDE_READY_SQL, /d\.source_data_cutoff_utc <= \$1::timestamptz/);
  assert.doesNotMatch(MARKET_CONTEXT_SUPERSEDE_READY_SQL, /t\.status IN \('CLAIMED','RUNNING'\)/);
});
