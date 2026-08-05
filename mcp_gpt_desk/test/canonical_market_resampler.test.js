import assert from "node:assert/strict";
import test from "node:test";
import {
  auditDerivedM5AgainstProvider,
  CANONICAL_M1_TO_M5_VERSION,
  deriveCanonicalM5FromClosedM1,
  deriveCanonicalTimeframeFromClosedM1,
} from "../src/canonical-market-resampler.js";

const FEED = "prod__tradingview__MNQ1!__1";
const PROVIDER_M5_FEED = "prod__tradingview__MNQ1!__5";
const CUTOFF = "2026-07-20T10:05:00.000Z";

test("canonical resampler derives exact closed UTC M5 OHLCV from one exact M1 feed", () => {
  const source = minuteRows("2026-07-20T10:00:00.000Z", [
    [100, 102, 99, 101, 10],
    [101, 104, 100, 103, 11],
    [103, 103.5, 98, 99, 12],
    [99, 105, 98.5, 104, 13],
    [104, 106, 103, 105, 14],
  ]);
  const result = deriveCanonicalM5FromClosedM1(source, options());

  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0], {
    asset: "MNQ",
    requested_symbol: "MNQ1!",
    chart_symbol: "MNQ1!",
    timeframe: "M5",
    timestamp_utc: "2026-07-20T10:00:00.000Z",
    bar_close_utc: CUTOFF,
    timestamp_paris: "2026-07-20T12:00:00.000+02:00",
    open: 100,
    high: 106,
    low: 98,
    close: 105,
    volume: 60,
    rsi_14: null,
    atr_14: null,
  });
  assert.equal(result.lineage.derivation_version, CANONICAL_M1_TO_M5_VERSION);
  assert.equal(result.lineage.complete_buckets, 1);
  assert.equal(result.lineage.accepted_source_rows, 5);
  assert.equal(result.lineage.indicator_warmup_incomplete, true);
  assert.equal(result.lineage.indicator_ready_from_utc, null);
  assert.deepEqual(result.lineage.source_feed_ids, [FEED]);
  assert.match(result.lineage.source_rows_sha256, /^[a-f0-9]{64}$/);
});

test("runtime resampler derives a closed M15 predicate series from immutable M1 rows", () => {
  const source = minuteRows(
    "2026-07-20T10:00:00.000Z",
    Array.from({ length: 15 }, (_, index) => [
      100 + index,
      102 + index,
      99 + index,
      101 + index,
      index + 1,
    ]),
  );
  const result = deriveCanonicalTimeframeFromClosedM1(source, {
    cutoffUtc: "2026-07-20T10:15:00.000Z",
    targetTimeframe: "M15",
    asset: "MNQ",
    requestedSymbol: "MNQ1!",
    sourceDataset: "MNQ_M1",
  });

  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0], {
    asset: "MNQ",
    requested_symbol: "MNQ1!",
    chart_symbol: "MNQ1!",
    timeframe: "M15",
    timestamp_utc: "2026-07-20T10:00:00.000Z",
    bar_close_utc: "2026-07-20T10:15:00.000Z",
    timestamp_paris: "2026-07-20T12:00:00.000+02:00",
    open: 100,
    high: 116,
    low: 99,
    close: 115,
    volume: 120,
    is_closed: true,
  });
  assert.equal(result.lineage.derivation_kind, "M1_TO_M15");
  assert.equal(result.lineage.source_dataset, "MNQ_M1");
  assert.equal(result.lineage.complete_buckets, 1);
});

test("canonical resampler omits incomplete, duplicate, open and post-cutoff buckets", () => {
  const complete = minuteRows("2026-07-20T09:55:00.000Z", flatValues(5));
  const incomplete = minuteRows("2026-07-20T10:00:00.000Z", flatValues(4));
  const duplicate = minuteRows("2026-07-20T10:05:00.000Z", flatValues(5));
  duplicate.push({ ...duplicate[0] });
  const open = minuteRows("2026-07-20T10:10:00.000Z", flatValues(5));
  open[2].is_closed = false;
  const result = deriveCanonicalM5FromClosedM1(
    [...complete, ...incomplete, ...duplicate, ...open],
    options("2026-07-20T10:15:00.000Z"),
  );

  assert.deepEqual(result.rows.map((row) => row.timestamp_utc), ["2026-07-20T09:55:00.000Z"]);
  assert.equal(result.lineage.incomplete_buckets, 2);
  assert.equal(result.lineage.duplicate_buckets, 1);
  assert.equal(result.lineage.ignored_open_rows, 1);
});

test("canonical resampler never mixes aliases or a different feed_id", () => {
  const canonical = minuteRows("2026-07-20T10:00:00.000Z", flatValues(5));
  const aliasRows = canonical.map((row) => ({
    ...row,
    feed_id: "prod__tradingview__MNQ__1",
    symbol_code: "MNQ",
    high: 999,
    volume: 999,
  }));
  const result = deriveCanonicalM5FromClosedM1([...aliasRows, ...canonical], options());

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].high, 101);
  assert.equal(result.rows[0].volume, 5);
  assert.equal(result.lineage.ignored_wrong_feed_rows, 5);
});

test("canonical resampler enforces anti-lookahead at the M5 bucket close", () => {
  const rows = minuteRows("2026-07-20T10:00:00.000Z", flatValues(5));
  const beforeClose = deriveCanonicalM5FromClosedM1(rows, options("2026-07-20T10:04:59.999Z"));
  const atClose = deriveCanonicalM5FromClosedM1(rows, options(CUTOFF));

  assert.equal(beforeClose.rows.length, 0);
  assert.equal(beforeClose.lineage.ignored_after_cutoff_rows, 1);
  assert.equal(beforeClose.lineage.incomplete_buckets, 1);
  assert.equal(atClose.rows.length, 1);
});

test("canonical resampler computes indicators only after the explicit M5 warm-up", () => {
  const startMs = Date.parse("2026-07-20T08:00:00.000Z");
  const rows = Array.from({ length: 75 }, (_, index) => {
    const open = 100 + index * 0.1;
    return {
      feed_id: FEED,
      symbol_code: "MNQ1!",
      timeframe: "1",
      timestamp_utc: new Date(startMs + index * 60_000).toISOString(),
      bar_close_utc: new Date(startMs + (index + 1) * 60_000).toISOString(),
      open, high: open + 1, low: open - 1, close: open + 0.25, volume: 10, is_closed: true,
    };
  });
  const result = deriveCanonicalM5FromClosedM1(rows, options("2026-07-20T09:15:00.000Z"));

  assert.equal(result.rows.length, 15);
  assert.equal(result.rows[13].rsi_14, null);
  assert.equal(result.rows[14].rsi_14, 100);
  assert.equal(result.rows[14].atr_14 > 0, true);
  assert.equal(result.lineage.indicator_warmup_complete, true);
  assert.equal(result.lineage.indicator_warmup_incomplete, false);
  assert.equal(result.lineage.indicator_ready_from_utc, "2026-07-20T09:10:00.000Z");
});

test("provider M5 comparison is audit-only and reports synthetic divergence", () => {
  const derived = deriveCanonicalM5FromClosedM1(
    minuteRows("2026-07-20T10:00:00.000Z", flatValues(5)),
    options(),
  ).rows;
  const exactProvider = [{
    feed_id: PROVIDER_M5_FEED,
    timestamp_utc: derived[0].timestamp_utc,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 5,
  }];
  const exact = auditDerivedM5AgainstProvider(derived, exactProvider, {
    expectedFeedId: PROVIDER_M5_FEED,
  });
  const divergent = auditDerivedM5AgainstProvider(derived, [{
    ...exactProvider[0],
    high: 106,
    volume: 500,
  }], {
    expectedFeedId: PROVIDER_M5_FEED,
  });

  assert.equal(exact.status, "exact");
  assert.equal(exact.audit_only, true);
  const oneTick = auditDerivedM5AgainstProvider(derived, [{ ...exactProvider[0], high: 101.25 }], {
    expectedFeedId: PROVIDER_M5_FEED,
  });
  assert.equal(oneTick.status, "diverged");
  assert.equal(oneTick.mismatch_count, 1);
  assert.equal(oneTick.beyond_tick_tolerance_count, 0);
  assert.equal(divergent.status, "diverged");
  assert.equal(divergent.mismatch_count, 1);
  assert.equal(divergent.maximum_price_delta, 5);
  assert.equal(divergent.maximum_volume_delta, 495);
  assert.deepEqual(derived[0], deriveCanonicalM5FromClosedM1(
    minuteRows("2026-07-20T10:00:00.000Z", flatValues(5)),
    options(),
  ).rows[0]);
});

function options(cutoffUtc = CUTOFF) {
  return {
    cutoffUtc,
    expectedFeedId: FEED,
    expectedSymbol: "MNQ1!",
    requestedSymbol: "MNQ1!",
    asset: "MNQ",
  };
}

function minuteRows(startUtc, values) {
  const startMs = Date.parse(startUtc);
  return values.map(([open, high, low, close, volume], index) => ({
    feed_id: FEED,
    symbol_code: "MNQ1!",
    timeframe: "1",
    timestamp_utc: new Date(startMs + index * 60_000).toISOString(),
    bar_close_utc: new Date(startMs + (index + 1) * 60_000).toISOString(),
    open,
    high,
    low,
    close,
    volume,
    is_closed: true,
  }));
}

function flatValues(count) {
  return Array.from({ length: count }, () => [100, 101, 99, 100, 1]);
}
