import assert from "node:assert/strict";
import test from "node:test";
import {
  V5_REPLAY_CANONICAL_M5_MODE,
  V5_REPLAY_CANONICAL_RESAMPLER_VERSION,
  V5_REPLAY_DATA_PROFILE,
  V5_REPLAY_DATA_PROFILE_VERSION,
  buildV5ReplayRequestedCoverage,
  datasetQueryStartUtc,
  evaluateV5ReplayDatasetCoverage,
  isV5ReplayPackCoverageComplete,
} from "../src/v5-replay-data-profile.js";

test("V5 profile pins exact canonical M1 feeds and derived M5 datasets", () => {
  const mnqM1 = V5_REPLAY_DATA_PROFILE.datasets.find(({ dataset }) => dataset === "MNQ_M1");
  const mnqM5 = V5_REPLAY_DATA_PROFILE.datasets.find(({ dataset }) => dataset === "MNQ_M5");
  const megaCapsM5 = V5_REPLAY_DATA_PROFILE.datasets.find(({ dataset }) => dataset === "mega_caps_premarket");

  assert.equal(V5_REPLAY_DATA_PROFILE_VERSION, "1.1.0");
  assert.equal(V5_REPLAY_DATA_PROFILE.canonical_m5_mode, "derived_from_m1");
  assert.deepEqual(mnqM1.feedIds, ["prod__tradingview__MNQ1!__1"]);
  assert.equal(mnqM1.derivationWarmupSource, true);
  assert.equal(mnqM5.sourceMode, "derived");
  assert.equal(mnqM5.sourceDataset, "MNQ_M1");
  assert.deepEqual(mnqM5.providerAuditFeedIds, ["prod__tradingview__MNQ1!__5"]);
  assert.deepEqual(megaCapsM5.symbols, ["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "AVGO", "TSLA", "SMH", "SOXX"]);
  assert.equal(megaCapsM5.required, false);
});

test("canonical M1 query starts at context warm-up while M1 coverage remains execution-scoped", () => {
  const requested = buildV5ReplayRequestedCoverage({
    tradingDate: "2026-07-20",
    cutoffUtc: "2026-07-20T20:00:00.000Z",
    cutoffParis: "2026-07-20T22:00:00+02:00",
  });
  const mnqM1 = V5_REPLAY_DATA_PROFILE.datasets.find(({ dataset }) => dataset === "MNQ_M1");
  const rows = [
    { timestamp_utc: requested.context_start_utc },
    { timestamp_utc: requested.execution_start_utc },
    { timestamp_utc: requested.end_utc },
  ];
  const coverage = evaluateV5ReplayDatasetCoverage({ spec: mnqM1, rows, requestedCoverage: requested });

  assert.equal(datasetQueryStartUtc(mnqM1, requested), requested.context_start_utc);
  assert.equal(coverage.requested_start_utc, requested.execution_start_utc);
});

test("V5 pack completeness rejects native-provider M5 lineage", () => {
  const coverage = Object.fromEntries(["MNQ_M1", "MES_M1", "MNQ_M5", "MES_M5"].map((dataset) => [
    dataset,
    { complete: true, blocking: false },
  ]));
  const pack = {
    data_profile_id: V5_REPLAY_DATA_PROFILE.profile_id,
    data_profile_version: V5_REPLAY_DATA_PROFILE.version,
    canonical_m5_mode: V5_REPLAY_CANONICAL_M5_MODE,
    canonical_resampler_version: V5_REPLAY_CANONICAL_RESAMPLER_VERSION,
    canonical_coverage_complete: true,
    actual_coverage: { datasets: coverage },
    datasets: {
      MNQ_M1: {}, MES_M1: {},
      MNQ_M5: { source: "postgres_market_candles" },
      MES_M5: { source: "postgres_market_candles" },
    },
  };
  assert.equal(isV5ReplayPackCoverageComplete(pack), false);
  for (const dataset of ["MNQ_M5", "MES_M5"]) {
    pack.datasets[dataset] = {
      source: "canonical_derived_m1",
      derivation_version: V5_REPLAY_CANONICAL_RESAMPLER_VERSION,
    };
  }
  assert.equal(isV5ReplayPackCoverageComplete(pack), true);
});
