import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { auditMarketDataLatency } from "../src/market-data-latency-audit.js";

const base = (feed, timestamp, values = {}) => ({ feed_id: feed, timestamp_utc: timestamp, imported_at: "2026-11-02T14:35:30.000Z", updated_at: "2026-11-02T14:35:30.000Z", open: 1, high: 2, low: 1, close: 2, volume: 1, ...values });
const m1Rows = (start, values = {}) => Array.from({ length: 5 }, (_, index) => base("prod__tradingview__ZC1!__1", new Date(Date.parse(start) + index * 60000).toISOString(), { open: index ? 2 : 1, high: 3, low: 1, close: index === 4 ? 2 : 2, volume: 1, ...values }));

test("latency distinguishes zero from unknown and revised timestamps", () => {
  const result = auditMarketDataLatency({ candles: [base("prod__tradingview__ZC1!__5", "2026-11-02T14:30:00Z", { imported_at: "2026-11-02T14:35:00Z" }), base("prod__tradingview__ZC1!__5", "2026-11-02T14:35:00Z", { imported_at: null, updated_at: null }), base("prod__tradingview__ZC1!__5", "2026-11-02T14:40:00Z", { imported_at: "2026-11-02T14:45:00Z", updated_at: "2026-11-02T14:46:00Z" })] });
  const group = result.latency_by_date_instrument_timeframe[0];
  assert.equal(group.sample_count, 2); assert.equal(group.missing_import_timestamp_count, 1); assert.equal(group.unknown_arrival_count, 3); assert.equal(group.updated_since_first_insert_count, 2);
});

test("signal cohort uses exact cutoff and exposes timing anomalies", () => {
  const row = base("prod__tradingview__ZC1!__5", "2026-11-02T14:30:00Z", { imported_at: "2026-11-02T14:40:00Z" });
  const result = auditMarketDataLatency({ candles: [row], signals: [{ signal_id: "s1", instrument: "ZC", source_data_cutoff_utc: "2026-11-02T14:30:00.000Z", created_at_utc: "2026-11-02T14:34:00Z", published_at_utc: "2026-11-02T14:33:00Z" }, { signal_id: "s2", instrument: "ZC", source_data_cutoff_utc: "2026-11-02T14:31:00Z" }] });
  const matched = result.signal_cohort.rows[0];
  assert.equal(matched.close_to_created_minutes, -1); assert.equal(matched.close_to_published_minutes, -2); assert.deepEqual(matched.timing_anomalies, ["CREATED_BEFORE_M5_CLOSE", "PUBLISHED_BEFORE_M5_CLOSE", "PUBLISHED_BEFORE_CREATED"]);
  assert.equal(result.signal_cohort.rows[1].status, "UNMATCHED_EXACT_CUTOFF");
});

test("M5 reconciles exactly five M1 bars and separates volume mismatch", () => {
  const start = "2026-11-02T14:30:00Z";
  const m1 = m1Rows(start).map((row) => ({ ...row, open: String(row.open), high: String(row.high), low: String(row.low), close: String(row.close), volume: String(row.volume) }));
  const m5 = base("prod__tradingview__ZC1!__5", start, { open: 1, high: 3, low: 1, close: 2, volume: 5 });
  const window = auditMarketDataLatency({ candles: [...m1, m5] }).m1_m5_rth[0].m5.windows[0];
  assert.equal(window.status, "COMPLETE_MATCH"); assert.equal(window.volume_mismatch, false);
  const mismatch = auditMarketDataLatency({ candles: [...m1, { ...m5, volume: 7 }] }).m1_m5_rth[0].m5.windows[0];
  assert.equal(mismatch.status, "COMPLETE_MATCH"); assert.equal(mismatch.volume_mismatch, true);
});

test("identical M1 and M5 duplicates remain visible and ambiguous", () => {
  const start = "2026-11-02T14:30:00Z";
  const m1 = m1Rows(start);
  const m5 = base("prod__tradingview__ZC1!__5", start, { open: 1, high: 3, low: 1, close: 2, volume: 5 });
  const result = auditMarketDataLatency({ candles: [...m1, m1[0], m5, { ...m5 }] });
  const audit = result.m1_m5_rth[0];
  assert.equal(audit.m1.duplicate_count, 1); assert.equal(audit.m1.conflicting_duplicate_count, 0);
  assert.equal(audit.m5.windows[0].status, "AMBIGUOUS_DUPLICATE");
});

test("M1 missing, duplicate, invalid price, OHLC mismatch and boundary are explicit", () => {
  const start = "2026-11-02T14:30:00Z";
  const m1 = m1Rows(start);
  const m5 = base("prod__tradingview__ZC1!__5", start, { open: 1, high: 3, low: 1, close: 2, volume: 5 });
  const missing = auditMarketDataLatency({ candles: [...m1.slice(0, 4), m5] }).m1_m5_rth[0].m5.windows[0];
  assert.equal(missing.status, "INCOMPLETE_M1");
  const duplicate = auditMarketDataLatency({ candles: [...m1, { ...m1[0], close: 99 }, m5] }).m1_m5_rth[0].m5.windows[0];
  assert.equal(duplicate.status, "AMBIGUOUS_DUPLICATE");
  const duplicateAudit = auditMarketDataLatency({ candles: [...m1, { ...m1[0], close: 99 }, m5] }).m1_m5_rth[0].m1;
  assert.equal(duplicateAudit.conflicting_duplicate_count, 1);
  const mismatch = auditMarketDataLatency({ candles: [...m1, { ...m5, close: 8 }] }).m1_m5_rth[0].m5.windows[0];
  assert.equal(mismatch.status, "OHLC_MISMATCH");
  const invalid = auditMarketDataLatency({ candles: [...m1, { ...m5, open: null }, { ...m5, close: "" }] });
  assert.equal(invalid.input_rows.ignored_candle_count, 2);
  const boundary = auditMarketDataLatency({ candles: [base("prod__tradingview__ZC1!__5", "2026-11-02T19:20:00Z")] }).m1_m5_rth[0].m5.windows.at(-1);
  assert.equal(boundary.status, "BOUNDARY_PARTIAL_M5"); assert.equal(boundary.missing_count, undefined);
  assert.equal(auditMarketDataLatency({ candles: [] }).m1_m5_rth.length, 0);
});

test("DST conversion and negative tolerance are deterministic", () => {
  const winter = auditMarketDataLatency({ candles: [base("prod__tradingview__ZC1!__5", "2026-11-02T14:30:00Z"), base("prod__tradingview__ZC1!__5", "2026-11-02T19:20:00Z")] });
  assert.equal(winter.m1_m5_rth[0].m5.windows[0].timestamp_utc, "2026-11-02T14:30:00.000Z");
  assert.equal(winter.m1_m5_rth[0].m5.windows.at(-1).timestamp_utc, "2026-11-02T19:20:00.000Z");
  const summer = auditMarketDataLatency({ candles: [base("prod__tradingview__ZC1!__5", "2026-07-06T13:30:00Z"), base("prod__tradingview__ZC1!__5", "2026-07-06T18:20:00Z")] });
  assert.equal(summer.m1_m5_rth[0].m5.windows[0].timestamp_utc, "2026-07-06T13:30:00.000Z");
  assert.equal(summer.m1_m5_rth[0].m5.windows.at(-1).timestamp_utc, "2026-07-06T18:20:00.000Z");
  assert.throws(() => auditMarketDataLatency({ tickTolerance: -0.01 }), /non_negative/);
});

test("CLI rejects overwriting its frozen input", () => {
  const script = fileURLToPath(new URL("../scripts/audit_market_data_latency.mjs", import.meta.url));
  assert.throws(() => execFileSync(process.execPath, [script, "frozen.json", "frozen.json"], { stdio: "pipe" }), /input_and_output_paths_must_differ/);
});
