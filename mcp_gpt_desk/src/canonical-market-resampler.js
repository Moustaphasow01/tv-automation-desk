import { canonicalSha256 } from "@tv-automation/desk-domain";
import { toParisIso } from "@tv-automation/desk-time";

export const CANONICAL_M1_TO_M5_VERSION = "1.0.0";
export const CANONICAL_M5_MODE = "derived_from_m1";
export const CANONICAL_M1_RUNTIME_RESAMPLER_VERSION = "1.1.0";

const MINUTE_MS = 60_000;
const BUCKET_MS = 5 * MINUTE_MS;
const EXPECTED_OFFSETS = Object.freeze([0, 1, 2, 3, 4].map((minute) => minute * MINUTE_MS));

export function deriveCanonicalTimeframeFromClosedM1(rows = [], {
  cutoffUtc,
  targetTimeframe,
  asset = null,
  requestedSymbol = null,
  sourceDataset = null,
} = {}) {
  const cutoffMs = parseTimestamp(cutoffUtc);
  if (!Number.isFinite(cutoffMs)) throw new Error("CANONICAL_RUNTIME_CUTOFF_INVALID");
  const target = runtimeTarget(targetTimeframe);
  if (!target) throw new Error(`CANONICAL_RUNTIME_TIMEFRAME_UNSUPPORTED:${targetTimeframe}`);
  const { minutes: targetMinutes, timeframe: normalizedTargetTimeframe } = target;
  const bucketMs = targetMinutes * MINUTE_MS;
  const buckets = new Map();
  const counters = {
    input_rows: rows.length,
    accepted_source_rows: 0,
    ignored_wrong_timeframe_rows: 0,
    ignored_open_rows: 0,
    ignored_invalid_rows: 0,
    ignored_after_cutoff_rows: 0,
    complete_buckets: 0,
    incomplete_buckets: 0,
    duplicate_buckets: 0,
  };

  for (const row of rows) {
    if (canonicalTimeframe(row?.timeframe || row?.interval) !== "1") {
      counters.ignored_wrong_timeframe_rows += 1;
      continue;
    }
    if (row?.is_closed === false || row?.closed === false) {
      counters.ignored_open_rows += 1;
      continue;
    }
    const timestampMs = parseTimestamp(
      row?.timestamp_utc || row?.timestamp_paris || row?.timestamp,
    );
    const closeMs = explicitCloseMs(row, timestampMs);
    if (!Number.isFinite(timestampMs)
      || !Number.isFinite(closeMs)
      || timestampMs % MINUTE_MS !== 0
      || closeMs !== timestampMs + MINUTE_MS
      || !validOhlc(row)) {
      counters.ignored_invalid_rows += 1;
      continue;
    }
    if (closeMs > cutoffMs) {
      counters.ignored_after_cutoff_rows += 1;
      continue;
    }
    const bucketStartMs = Math.floor(timestampMs / bucketMs) * bucketMs;
    const bucket = buckets.get(bucketStartMs) || [];
    bucket.push({ row, timestampMs, closeMs });
    buckets.set(bucketStartMs, bucket);
    counters.accepted_source_rows += 1;
  }

  const derivedRows = [];
  const sourceRowsForHash = [];
  for (const [bucketStartMs, bucket] of [...buckets.entries()].sort(([left], [right]) => left - right)) {
    const byTimestamp = new Map();
    let duplicate = false;
    for (const item of bucket) {
      if (byTimestamp.has(item.timestampMs)) duplicate = true;
      byTimestamp.set(item.timestampMs, item);
    }
    if (duplicate) {
      counters.duplicate_buckets += 1;
      continue;
    }
    const expectedTimestamps = Array.from(
      { length: targetMinutes },
      (_, index) => bucketStartMs + index * MINUTE_MS,
    );
    if (byTimestamp.size !== targetMinutes
      || !expectedTimestamps.every((timestamp) => byTimestamp.has(timestamp))) {
      counters.incomplete_buckets += 1;
      continue;
    }
    const ordered = expectedTimestamps.map((timestamp) => byTimestamp.get(timestamp));
    const bucketCloseMs = bucketStartMs + bucketMs;
    if (bucketCloseMs > cutoffMs || ordered.some((item) => item.closeMs > cutoffMs)) {
      counters.incomplete_buckets += 1;
      continue;
    }
    const volumeValues = ordered
      .map(({ row }) => nullableNumber(row.volume))
      .filter((value) => value !== null);
    derivedRows.push({
      ...(asset ? { asset } : {}),
      ...(requestedSymbol ? {
        requested_symbol: requestedSymbol,
        chart_symbol: requestedSymbol,
      } : {}),
      timeframe: normalizedTargetTimeframe,
      timestamp_utc: new Date(bucketStartMs).toISOString(),
      bar_close_utc: new Date(bucketCloseMs).toISOString(),
      timestamp_paris: toParisIso(bucketStartMs),
      open: numberValue(ordered[0].row.open),
      high: Math.max(...ordered.map(({ row }) => numberValue(row.high))),
      low: Math.min(...ordered.map(({ row }) => numberValue(row.low))),
      close: numberValue(ordered.at(-1).row.close),
      volume: volumeValues.length ? volumeValues.reduce((total, value) => total + value, 0) : null,
      is_closed: true,
    });
    sourceRowsForHash.push(...ordered.map(({ row, timestampMs, closeMs }) => ({
      timestamp_utc: new Date(timestampMs).toISOString(),
      bar_close_utc: new Date(closeMs).toISOString(),
      open: numberValue(row.open),
      high: numberValue(row.high),
      low: numberValue(row.low),
      close: numberValue(row.close),
      volume: nullableNumber(row.volume),
    })));
    counters.complete_buckets += 1;
  }

  return {
    rows: derivedRows,
    lineage: {
      derivation_kind: `M1_TO_${normalizedTargetTimeframe}`,
      derivation_version: CANONICAL_M1_RUNTIME_RESAMPLER_VERSION,
      source_dataset: sourceDataset,
      source_timeframe: "M1",
      target_timeframe: normalizedTargetTimeframe,
      bucket_alignment: `UTC_EPOCH_${targetMinutes}M`,
      closed_only: true,
      source_rows_sha256: canonicalSha256(sourceRowsForHash),
      ...counters,
    },
  };
}

export function deriveCanonicalM5FromClosedM1(rows = [], {
  cutoffUtc,
  expectedFeedId,
  expectedSymbol,
  asset,
  requestedSymbol = expectedSymbol,
} = {}) {
  const cutoffMs = parseTimestamp(cutoffUtc);
  if (!Number.isFinite(cutoffMs)) throw new Error("CANONICAL_M5_CUTOFF_INVALID");
  if (!expectedFeedId) throw new Error("CANONICAL_M5_FEED_ID_REQUIRED");
  if (!expectedSymbol) throw new Error("CANONICAL_M5_SYMBOL_REQUIRED");

  const counters = {
    input_rows: rows.length,
    accepted_source_rows: 0,
    ignored_wrong_feed_rows: 0,
    ignored_wrong_symbol_rows: 0,
    ignored_wrong_timeframe_rows: 0,
    ignored_open_rows: 0,
    ignored_invalid_rows: 0,
    ignored_after_cutoff_rows: 0,
    complete_buckets: 0,
    incomplete_buckets: 0,
    duplicate_buckets: 0,
  };
  const buckets = new Map();

  for (const row of rows) {
    if (String(row?.feed_id || "") !== expectedFeedId) {
      counters.ignored_wrong_feed_rows += 1;
      continue;
    }
    if (canonicalSymbol(row?.symbol_code || row?.symbol) !== canonicalSymbol(expectedSymbol)) {
      counters.ignored_wrong_symbol_rows += 1;
      continue;
    }
    if (canonicalTimeframe(row?.timeframe) !== "1") {
      counters.ignored_wrong_timeframe_rows += 1;
      continue;
    }
    if (row?.is_closed !== true) {
      counters.ignored_open_rows += 1;
      continue;
    }
    const timestampMs = parseTimestamp(row?.timestamp_utc);
    const closeMs = explicitCloseMs(row, timestampMs);
    if (!Number.isFinite(timestampMs)
      || !Number.isFinite(closeMs)
      || timestampMs % MINUTE_MS !== 0
      || closeMs !== timestampMs + MINUTE_MS
      || !validOhlc(row)) {
      counters.ignored_invalid_rows += 1;
      continue;
    }
    if (closeMs > cutoffMs) {
      counters.ignored_after_cutoff_rows += 1;
      continue;
    }
    const bucketStartMs = Math.floor(timestampMs / BUCKET_MS) * BUCKET_MS;
    const bucket = buckets.get(bucketStartMs) || [];
    bucket.push({ row, timestampMs, closeMs });
    buckets.set(bucketStartMs, bucket);
    counters.accepted_source_rows += 1;
  }

  const derivedRows = [];
  const sourceRowsForHash = [];
  for (const [bucketStartMs, bucket] of [...buckets.entries()].sort(([left], [right]) => left - right)) {
    const byTimestamp = new Map();
    let duplicate = false;
    for (const item of bucket) {
      if (byTimestamp.has(item.timestampMs)) duplicate = true;
      const values = byTimestamp.get(item.timestampMs) || [];
      values.push(item);
      byTimestamp.set(item.timestampMs, values);
    }
    if (duplicate) {
      counters.duplicate_buckets += 1;
      continue;
    }
    const expectedTimestamps = EXPECTED_OFFSETS.map((offset) => bucketStartMs + offset);
    if (byTimestamp.size !== 5 || !expectedTimestamps.every((timestamp) => byTimestamp.has(timestamp))) {
      counters.incomplete_buckets += 1;
      continue;
    }
    const ordered = expectedTimestamps.map((timestamp) => byTimestamp.get(timestamp)[0]);
    const bucketCloseMs = bucketStartMs + BUCKET_MS;
    if (bucketCloseMs > cutoffMs || ordered.some((item) => item.closeMs > cutoffMs)) {
      counters.incomplete_buckets += 1;
      continue;
    }
    const volumeValues = ordered
      .map(({ row }) => nullableNumber(row.volume))
      .filter((value) => value !== null);
    derivedRows.push({
      asset: asset || canonicalAsset(expectedSymbol),
      requested_symbol: requestedSymbol,
      chart_symbol: expectedSymbol,
      timeframe: "M5",
      timestamp_utc: new Date(bucketStartMs).toISOString(),
      bar_close_utc: new Date(bucketCloseMs).toISOString(),
      timestamp_paris: toParisIso(bucketStartMs),
      open: numberValue(ordered[0].row.open),
      high: Math.max(...ordered.map(({ row }) => numberValue(row.high))),
      low: Math.min(...ordered.map(({ row }) => numberValue(row.low))),
      close: numberValue(ordered.at(-1).row.close),
      volume: volumeValues.length ? volumeValues.reduce((total, value) => total + value, 0) : null,
      rsi_14: null,
      atr_14: null,
    });
    sourceRowsForHash.push(...ordered.map(({ row, timestampMs, closeMs }) => ({
      feed_id: expectedFeedId,
      symbol_code: expectedSymbol,
      timeframe: "1",
      timestamp_utc: new Date(timestampMs).toISOString(),
      bar_close_utc: new Date(closeMs).toISOString(),
      open: numberValue(row.open),
      high: numberValue(row.high),
      low: numberValue(row.low),
      close: numberValue(row.close),
      volume: nullableNumber(row.volume),
    })));
    counters.complete_buckets += 1;
  }

  enrichWilderIndicators(derivedRows);
  const indicatorReadyRow = derivedRows.find((row) => row.rsi_14 !== null && row.atr_14 !== null) || null;
  return {
    rows: derivedRows,
    lineage: {
      derivation_kind: "M1_TO_M5",
      derivation_version: CANONICAL_M1_TO_M5_VERSION,
      canonical_m5_mode: CANONICAL_M5_MODE,
      source_dataset: asset ? `${asset}_M1` : null,
      source_timeframe: "1",
      source_feed_ids: [expectedFeedId],
      source_rows_sha256: canonicalSha256(sourceRowsForHash),
      bucket_alignment: "UTC_EPOCH_5M",
      closed_only: true,
      indicator_algorithm: "WILDER_RSI14_ATR14",
      indicator_warmup_required_buckets: 15,
      indicator_warmup_complete: indicatorReadyRow !== null,
      indicator_warmup_incomplete: indicatorReadyRow === null,
      indicator_ready_from_utc: indicatorReadyRow?.timestamp_utc || null,
      ...counters,
    },
  };
}

export function auditDerivedM5AgainstProvider(derivedRows = [], providerRows = [], {
  expectedFeedId = null,
  tickSize = 0.25,
  sampleLimit = 20,
} = {}) {
  const provider = providerRows
    .filter((row) => !expectedFeedId || String(row?.feed_id || "") === expectedFeedId)
    .map(normalizeProviderM5)
    .filter(Boolean);
  const providerByTimestamp = new Map(provider.map((row) => [row.timestamp_utc, row]));
  const derivedByTimestamp = new Map(derivedRows.map((row) => [row.timestamp_utc, row]));
  const mismatches = [];
  let compared = 0;
  let maximumPriceDelta = 0;
  let maximumVolumeDelta = 0;
  let beyondTickToleranceCount = 0;
  for (const row of derivedRows) {
    const candidate = providerByTimestamp.get(row.timestamp_utc);
    if (!candidate) continue;
    compared += 1;
    const priceDeltas = Object.fromEntries(["open", "high", "low", "close"].map((field) => [
      field,
      absoluteDelta(row[field], candidate[field]),
    ]));
    const volumeDelta = absoluteDelta(row.volume, candidate.volume);
    const rowMaximumPriceDelta = Math.max(...Object.values(priceDeltas));
    maximumPriceDelta = Math.max(maximumPriceDelta, rowMaximumPriceDelta);
    maximumVolumeDelta = Math.max(maximumVolumeDelta, volumeDelta);
    if (rowMaximumPriceDelta > tickSize) beyondTickToleranceCount += 1;
    if (rowMaximumPriceDelta > 0 || volumeDelta > 0) {
      mismatches.push({
        timestamp_utc: row.timestamp_utc,
        price_deltas: priceDeltas,
        volume_delta: volumeDelta,
        derived: pickOhlcv(row),
        provider: pickOhlcv(candidate),
      });
    }
  }
  const missingProviderBuckets = derivedRows
    .filter((row) => !providerByTimestamp.has(row.timestamp_utc))
    .map((row) => row.timestamp_utc);
  const providerOnlyBuckets = provider
    .filter((row) => !derivedByTimestamp.has(row.timestamp_utc))
    .map((row) => row.timestamp_utc);
  const status = !provider.length
    ? "missing"
    : mismatches.length || missingProviderBuckets.length || providerOnlyBuckets.length
      ? "diverged"
      : "exact";
  return {
    status,
    audit_only: true,
    expected_feed_id: expectedFeedId,
    provider_row_count: provider.length,
    derived_row_count: derivedRows.length,
    compared_buckets: compared,
    mismatch_count: mismatches.length,
    beyond_tick_tolerance_count: beyondTickToleranceCount,
    missing_provider_bucket_count: missingProviderBuckets.length,
    provider_only_bucket_count: providerOnlyBuckets.length,
    maximum_price_delta: round(maximumPriceDelta),
    maximum_volume_delta: round(maximumVolumeDelta),
    tick_size: tickSize,
    samples: mismatches.slice(0, sampleLimit),
    missing_provider_buckets: missingProviderBuckets.slice(0, sampleLimit),
    provider_only_buckets: providerOnlyBuckets.slice(0, sampleLimit),
  };
}

function enrichWilderIndicators(rows) {
  if (!rows.length) return rows;
  const period = 14;
  let averageGain = null;
  let averageLoss = null;
  let averageTrueRange = null;
  const gains = [];
  const losses = [];
  const trueRanges = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const previous = rows[index - 1];
    const change = row.close - previous.close;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    const trueRange = Math.max(
      row.high - row.low,
      Math.abs(row.high - previous.close),
      Math.abs(row.low - previous.close),
    );
    gains.push(gain);
    losses.push(loss);
    trueRanges.push(trueRange);
    if (index === period) {
      averageGain = average(gains.slice(0, period));
      averageLoss = average(losses.slice(0, period));
      averageTrueRange = average(trueRanges.slice(0, period));
    } else if (index > period) {
      averageGain = ((averageGain * (period - 1)) + gain) / period;
      averageLoss = ((averageLoss * (period - 1)) + loss) / period;
      averageTrueRange = ((averageTrueRange * (period - 1)) + trueRange) / period;
    }
    if (index >= period) {
      row.rsi_14 = round(averageLoss === 0 ? 100 : 100 - (100 / (1 + averageGain / averageLoss)));
      row.atr_14 = round(averageTrueRange);
    }
  }
  return rows;
}

function normalizeProviderM5(row) {
  const timestampMs = parseTimestamp(row?.timestamp_utc);
  if (!Number.isFinite(timestampMs) || !validOhlc(row)) return null;
  return {
    timestamp_utc: new Date(timestampMs).toISOString(),
    open: numberValue(row.open),
    high: numberValue(row.high),
    low: numberValue(row.low),
    close: numberValue(row.close),
    volume: nullableNumber(row.volume),
  };
}

function explicitCloseMs(row, timestampMs) {
  for (const field of ["bar_close_utc", "close_timestamp_utc", "candle_close_utc", "timestamp_close_utc"]) {
    if (row?.[field] !== null && row?.[field] !== undefined && row?.[field] !== "") {
      return parseTimestamp(row[field]);
    }
  }
  return Number.isFinite(timestampMs) ? timestampMs + MINUTE_MS : Number.NaN;
}

function validOhlc(row) {
  return ["open", "high", "low", "close"].every((field) => Number.isFinite(Number(row?.[field])));
}

function numberValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`CANONICAL_M5_OHLC_INVALID:${value}`);
  return parsed;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTimestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function canonicalSymbol(value) {
  return String(value || "").trim().toUpperCase();
}

function canonicalTimeframe(value) {
  return String(value || "").trim().toUpperCase().replace(/^M/, "");
}

function canonicalAsset(symbol) {
  return canonicalSymbol(symbol).replace(/1!$/, "");
}

function runtimeTarget(value) {
  const normalized = String(value || "").trim().toUpperCase();
  const aliases = {
    "5": { minutes: 5, timeframe: "M5" },
    "5M": { minutes: 5, timeframe: "M5" },
    M5: { minutes: 5, timeframe: "M5" },
    "15": { minutes: 15, timeframe: "M15" },
    "15M": { minutes: 15, timeframe: "M15" },
    M15: { minutes: 15, timeframe: "M15" },
    "60": { minutes: 60, timeframe: "H1" },
    "1H": { minutes: 60, timeframe: "H1" },
    H1: { minutes: 60, timeframe: "H1" },
    "240": { minutes: 240, timeframe: "H4" },
    "4H": { minutes: 240, timeframe: "H4" },
    H4: { minutes: 240, timeframe: "H4" },
  };
  return aliases[normalized] || null;
}

function average(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function absoluteDelta(left, right) {
  if (left === null && right === null) return 0;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return Number.POSITIVE_INFINITY;
  return Math.abs(leftNumber - rightNumber);
}

function pickOhlcv(row) {
  return Object.fromEntries(["open", "high", "low", "close", "volume"].map((field) => [field, row[field]]));
}

function round(value, digits = 8) {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
