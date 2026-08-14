import assert from "node:assert/strict";
import test from "node:test";
import {
  DOWNSIDE_SEMIVARIANCE_VERSION,
  MARKET_DERIVED_FEATURES_VERSION,
  REALIZED_VOLATILITY_VERSION,
  ROLLING_RELATIONSHIP_VERSION,
  RSI_WILDER_14_VERSION,
  VOLUME_PROFILE_PROXY_VERSION,
  buildDevelopingVolumeProfile,
  buildVolumeProfileLevels,
  downsideSemivariance,
  initialBalanceLevels,
  latestRsiWilder,
  priorDayLevels,
  priorWeekLevels,
  realizedVolatility,
  rollingBeta,
  rollingCorrelation,
} from "../src/market-derived-features.js";
import { buildSessionSnapshotDoc } from "../src/desk-market-feature-algorithms.js";

test("volume profile derives deterministic POC VAH VAL from closed OHLCV rows", () => {
  const profile = buildVolumeProfileLevels([
    row("2026-06-11T08:00:00.000Z", { high: 101, low: 99, close: 100, volume: 100 }),
    row("2026-06-11T08:01:00.000Z", { high: 102, low: 100, close: 101, volume: 300 }),
    row("2026-06-11T08:02:00.000Z", { high: 103, low: 101, close: 102, volume: 100 }),
    row("2026-06-11T08:03:00.000Z", { high: 130, low: 120, close: 125, volume: 1_000, is_closed: false }),
  ], { tickSize: 0.25, valueAreaPercent: 0.7 });

  assert.equal(profile.schema_version, MARKET_DERIVED_FEATURES_VERSION);
  assert.equal(profile.formula_version, VOLUME_PROFILE_PROXY_VERSION);
  assert.equal(profile.approximation, "ohlcv_typical_price_volume_bucket");
  assert.equal(profile.poc, 101);
  assert.equal(profile.vah, 101);
  assert.equal(profile.val, 100);
  assert.equal(profile.total_volume, 500);
});

test("developing volume profile is cutoff-bound and never uses future closed rows", () => {
  const profile = buildDevelopingVolumeProfile([
    row("2026-06-11T08:00:00.000Z", { high: 101, low: 99, close: 100, volume: 100 }),
    row("2026-06-11T08:01:00.000Z", { high: 102, low: 100, close: 101, volume: 300 }),
    row("2026-06-11T08:02:00.000Z", { high: 110, low: 110, close: 110, volume: 1_000 }),
  ], { cutoffUtc: "2026-06-11T08:01:00.000Z" });

  assert.equal(profile.developing, true);
  assert.equal(profile.cutoff_utc, "2026-06-11T08:01:00.000Z");
  assert.equal(profile.poc, 101);
  assert.equal(profile.total_volume, 400);
});

test("RSI prior levels and initial balance are deterministic closed-bar features", () => {
  const rows = Array.from({ length: 20 }, (_, index) => row(`2026-06-${String(index < 10 ? 10 : 11).padStart(2, "0")}T08:${String(index).padStart(2, "0")}:00.000Z`, {
    trading_date: index < 10 ? "2026-06-10" : "2026-06-11",
    high: 100 + index,
    low: 99 + index,
    close: 100 + index,
    volume: 10 + index,
  }));

  assert.equal(RSI_WILDER_14_VERSION, "rsi_wilder_14_v1");
  assert.equal(latestRsiWilder(rows) > 99, true);

  const priorDay = priorDayLevels(rows, { tradingDate: "2026-06-11" });
  assert.equal(priorDay.label, "2026-06-10");
  assert.equal(priorDay.high, 109);
  assert.equal(priorDay.low, 99);

  const priorWeek = priorWeekLevels(rows, { tradingDate: "2026-06-11" });
  assert.equal(priorWeek.row_count, 10);

  const initialBalance = initialBalanceLevels(rows, { startUtc: "2026-06-11T08:10:00.000Z", minutes: 5 });
  assert.equal(initialBalance.high, 114);
  assert.equal(initialBalance.low, 109);
});

test("realized volatility semivariance correlation and beta are closed-return features", () => {
  const left = [100, 102, 101, 104, 103, 106].map((close, index) => row(`2026-06-11T08:0${index}:00.000Z`, { close, high: close + 1, low: close - 1 }));
  const right = [50, 51, 50.5, 52, 51.5, 53].map((close, index) => row(`2026-06-11T08:0${index}:00.000Z`, { close, high: close + 1, low: close - 1 }));

  assert.equal(REALIZED_VOLATILITY_VERSION, "realized_volatility_close_return_v1");
  assert.equal(DOWNSIDE_SEMIVARIANCE_VERSION, "downside_semivariance_close_return_v1");
  assert.equal(ROLLING_RELATIONSHIP_VERSION, "rolling_correlation_beta_close_return_v1");
  assert.equal(realizedVolatility(left, { periods: 5 }) > 0, true);
  assert.equal(downsideSemivariance(left, { periods: 5 }) > 0, true);
  assert.equal(rollingCorrelation(left, right, { periods: 5 }) > 0.99, true);
  assert.equal(rollingBeta(left, right, { periods: 5 }) > 0, true);
});

test("session snapshot exposes developing POC VAH VAL instead of an empty placeholder", () => {
  const snapshot = buildSessionSnapshotDoc({
    date: "2026-06-11",
    session: "ny_open",
    instrument: "MNQ",
    cutoff_paris: "2026-06-11T10:02:00+02:00",
    computed_at: "2026-06-11T08:02:01.000Z",
    rows: [
      row("2026-06-11T08:00:00.000Z", { timestamp_paris: "2026-06-11T10:00:00+02:00", high: 101, low: 99, close: 100, volume: 100 }),
      row("2026-06-11T08:01:00.000Z", { timestamp_paris: "2026-06-11T10:01:00+02:00", high: 102, low: 100, close: 101, volume: 300 }),
    ],
  });

  assert.equal(snapshot.poc_vah_val.formula_version, VOLUME_PROFILE_PROXY_VERSION);
  assert.equal(snapshot.poc_vah_val.poc, 101);
  assert.equal(snapshot.poc_vah_val.developing, true);
});

function row(timestampUtc, overrides = {}) {
  const close = overrides.close ?? 100;
  return {
    timestamp_utc: timestampUtc,
    timestamp_paris: overrides.timestamp_paris || timestampUtc.replace(".000Z", "+00:00"),
    trading_date: overrides.trading_date || timestampUtc.slice(0, 10),
    open: overrides.open ?? close,
    high: overrides.high ?? close,
    low: overrides.low ?? close,
    close,
    volume: overrides.volume ?? 100,
    is_closed: overrides.is_closed,
  };
}
