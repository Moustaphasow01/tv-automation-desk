export const V5_REPLAY_DATA_PROFILE_ID = "v5_replay_canonical_m1_m5";
export const V5_REPLAY_DATA_PROFILE_VERSION = "1.1.0";
export const V5_REPLAY_CANONICAL_M5_MODE = "derived_from_m1";
export const V5_REPLAY_CANONICAL_RESAMPLER_VERSION = "1.0.0";

const DATASET_SPECS = [
  {
    dataset: "MNQ_M1", symbols: ["MNQ1!", "MNQ"], feedIds: ["prod__tradingview__MNQ1!__1"],
    timeframe: "1", outputTimeframe: "M1", required: true, freshnessRole: "execution",
    sourceMode: "provider", derivationWarmupSource: true,
  },
  {
    dataset: "MES_M1", symbols: ["MES1!", "MES"], feedIds: ["prod__tradingview__MES1!__1"],
    timeframe: "1", outputTimeframe: "M1", required: true, freshnessRole: "execution",
    sourceMode: "provider", derivationWarmupSource: true,
  },
  {
    dataset: "MNQ_M5", symbols: ["MNQ1!", "MNQ"], timeframe: "5", outputTimeframe: "M5",
    required: true, freshnessRole: "trigger", sourceMode: "derived", sourceDataset: "MNQ_M1",
    providerAuditFeedIds: ["prod__tradingview__MNQ1!__5"],
  },
  {
    dataset: "MES_M5", symbols: ["MES1!", "MES"], timeframe: "5", outputTimeframe: "M5",
    required: true, freshnessRole: "trigger", sourceMode: "derived", sourceDataset: "MES_M1",
    providerAuditFeedIds: ["prod__tradingview__MES1!__5"],
  },
  { dataset: "NQ_M15", symbols: ["NQ1!", "NQ"], timeframe: "15", outputTimeframe: "M15", required: false, freshnessRole: "confirmation" },
  { dataset: "NQ_H1", symbols: ["NQ1!", "NQ"], timeframe: "1H", outputTimeframe: "H1", required: false, freshnessRole: "context" },
  { dataset: "ES_M15", symbols: ["ES1!", "ES"], timeframe: "15", outputTimeframe: "M15", required: false, freshnessRole: "confirmation" },
  { dataset: "ES_H1", symbols: ["ES1!", "ES"], timeframe: "1H", outputTimeframe: "H1", required: false, freshnessRole: "context" },
  { dataset: "MNQ_H4", symbols: ["MNQ1!", "MNQ"], timeframe: "4H", outputTimeframe: "H4", required: false, freshnessRole: "context" },
  { dataset: "MES_H4", symbols: ["MES1!", "MES"], timeframe: "4H", outputTimeframe: "H4", required: false, freshnessRole: "context" },
  { dataset: "NQ_H4", symbols: ["NQ1!", "NQ"], timeframe: "4H", outputTimeframe: "H4", required: false, freshnessRole: "context" },
  { dataset: "ES_H4", symbols: ["ES1!", "ES"], timeframe: "4H", outputTimeframe: "H4", required: false, freshnessRole: "context" },
  { dataset: "US10Y_US02Y", symbols: ["US10Y", "US02Y"], timeframe: "5", outputTimeframe: "M5", required: false, freshnessRole: "context" },
  { dataset: "US10Y_US02Y_H4", symbols: ["US10Y", "US02Y"], timeframe: "4H", outputTimeframe: "H4", required: false, freshnessRole: "context" },
  { dataset: "DXY_CL_GC_VIX", symbols: ["DXY", "CL1!", "CL", "GC1!", "GC", "VIX"], timeframe: "5", outputTimeframe: "M5", required: false, freshnessRole: "context" },
  { dataset: "DXY_CL_GC_VIX_H4", symbols: ["DXY", "CL1!", "CL", "GC1!", "GC", "VIX"], timeframe: "4H", outputTimeframe: "H4", required: false, freshnessRole: "context" },
  { dataset: "indices_asie_europe", symbols: ["DAX", "DAX1!", "NKY", "NIKKEI", "NI225", "HSI", "FTSE", "CAC40", "SX5E"], timeframe: "5", outputTimeframe: "M5", required: false, freshnessRole: "context" },
  { dataset: "indices_asie_europe_H4", symbols: ["DAX", "DAX1!", "NKY", "NIKKEI", "NI225", "HSI", "FTSE", "CAC40", "SX5E"], timeframe: "4H", outputTimeframe: "H4", required: false, freshnessRole: "context" },
  { dataset: "mega_caps_premarket", symbols: ["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA"], timeframe: "5", outputTimeframe: "M5", required: false, freshnessRole: "context" },
  { dataset: "mega_caps_premarket_H4", symbols: ["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA"], timeframe: "4H", outputTimeframe: "H4", required: false, freshnessRole: "context" },
];

export const V5_REPLAY_DATA_PROFILE = Object.freeze({
  profile_id: V5_REPLAY_DATA_PROFILE_ID,
  version: V5_REPLAY_DATA_PROFILE_VERSION,
  canonical_m5_mode: V5_REPLAY_CANONICAL_M5_MODE,
  canonical_resampler_version: V5_REPLAY_CANONICAL_RESAMPLER_VERSION,
  context_lookback_days: 5,
  execution_warmup_time: "00:00:00",
  default_run_start_time: "00:15:00",
  boundary_tolerance_intervals: 1,
  gap_tolerance_multiplier: 1.5,
  datasets: Object.freeze(DATASET_SPECS.map((spec) => Object.freeze({
    ...spec,
    symbols: Object.freeze([...spec.symbols]),
    ...(spec.feedIds ? { feedIds: Object.freeze([...spec.feedIds]) } : {}),
    ...(spec.providerAuditFeedIds ? {
      providerAuditFeedIds: Object.freeze([...spec.providerAuditFeedIds]),
    } : {}),
  }))),
});

export const V5_REPLAY_CANONICAL_DATASET_IDS = Object.freeze(
  V5_REPLAY_DATA_PROFILE.datasets
    .filter((spec) => spec.required)
    .map((spec) => spec.dataset),
);

export function buildV5ReplayRequestedCoverage({
  tradingDate,
  cutoffUtc,
  cutoffParis,
  requestedStartUtc = null,
  requestedStartParis = null,
} = {}) {
  const endUtc = validIso(cutoffUtc, "V5_REPLAY_COVERAGE_END_INVALID");
  const offset = parisOffset(cutoffParis || requestedStartParis);
  const runStartUtc = validIso(
    requestedStartUtc
      || requestedStartParis
      || `${tradingDate}T${V5_REPLAY_DATA_PROFILE.default_run_start_time}${offset}`,
    "V5_REPLAY_COVERAGE_START_INVALID",
  );
  const executionStartUtc = validIso(
    `${tradingDate}T${V5_REPLAY_DATA_PROFILE.execution_warmup_time}${offset}`,
    "V5_REPLAY_EXECUTION_COVERAGE_START_INVALID",
  );
  const contextStartUtc = new Date(
    Date.parse(endUtc) - V5_REPLAY_DATA_PROFILE.context_lookback_days * 24 * 60 * 60_000,
  ).toISOString();
  return {
    profile_id: V5_REPLAY_DATA_PROFILE_ID,
    profile_version: V5_REPLAY_DATA_PROFILE_VERSION,
    trading_date: tradingDate,
    run_start_utc: runStartUtc,
    execution_start_utc: executionStartUtc,
    context_start_utc: contextStartUtc,
    end_utc: endUtc,
  };
}

export function datasetQueryStartUtc(spec, requestedCoverage) {
  return spec?.freshnessRole === "execution" && spec?.derivationWarmupSource !== true
    ? requestedCoverage.execution_start_utc
    : requestedCoverage.context_start_utc;
}

export function evaluateV5ReplayDatasetCoverage({
  spec,
  rows = [],
  requestedCoverage,
} = {}) {
  if (!spec?.dataset) throw new Error("V5_REPLAY_DATASET_SPEC_REQUIRED");
  if (!requestedCoverage) throw new Error("V5_REPLAY_REQUESTED_COVERAGE_REQUIRED");
  const intervalMinutes = timeframeDurationMinutes(spec.timeframe);
  const intervalMs = intervalMinutes * 60_000;
  const requiredStartUtc = spec.freshnessRole === "execution"
    ? requestedCoverage.execution_start_utc
    : requestedCoverage.run_start_utc;
  const requiredEndUtc = requestedCoverage.end_utc;
  const startMs = Date.parse(requiredStartUtc);
  const endMs = Date.parse(requiredEndUtc);
  const allTimestamps = uniqueSortedTimestamps(rows);
  const windowTimestamps = allTimestamps.filter((timestampMs) => (
    timestampMs >= startMs - intervalMs && timestampMs <= endMs
  ));
  const firstMs = windowTimestamps[0] ?? null;
  const lastMs = windowTimestamps.at(-1) ?? null;
  const boundaryToleranceMs = intervalMs * V5_REPLAY_DATA_PROFILE.boundary_tolerance_intervals;
  const startGapMinutes = firstMs === null ? null : Math.max(0, (firstMs - startMs) / 60_000);
  const endGapMinutes = lastMs === null ? null : Math.max(0, (endMs - lastMs) / 60_000);
  const gaps = [];
  for (let index = 1; index < windowTimestamps.length; index += 1) {
    const previousMs = windowTimestamps[index - 1];
    const currentMs = windowTimestamps[index];
    const gapMs = currentMs - previousMs;
    if (gapMs > intervalMs * V5_REPLAY_DATA_PROFILE.gap_tolerance_multiplier) {
      gaps.push({
        from_utc: new Date(previousMs).toISOString(),
        to_utc: new Date(currentMs).toISOString(),
        gap_minutes: decimal(gapMs / 60_000),
        missing_intervals: Math.max(1, Math.round(gapMs / intervalMs) - 1),
      });
    }
  }
  const startCovered = firstMs !== null && firstMs <= startMs + boundaryToleranceMs;
  const endCovered = lastMs !== null && lastMs >= endMs - boundaryToleranceMs;
  const complete = startCovered && endCovered && gaps.length === 0;
  const reasons = [];
  if (firstMs === null) reasons.push("no_rows_in_required_window");
  if (firstMs !== null && !startCovered) reasons.push("start_boundary_not_covered");
  if (lastMs !== null && !endCovered) reasons.push("end_boundary_not_covered");
  if (gaps.length) reasons.push("unexpected_internal_gaps");
  return {
    dataset: spec.dataset,
    role: spec.freshnessRole,
    required: spec.required === true,
    timeframe: spec.timeframe,
    interval_minutes: intervalMinutes,
    status: complete ? "complete" : firstMs === null ? "missing" : "partial",
    complete,
    blocking: spec.required === true && !complete,
    requested_start_utc: requiredStartUtc,
    requested_end_utc: requiredEndUtc,
    actual_start_utc: firstMs === null ? null : new Date(firstMs).toISOString(),
    actual_end_utc: lastMs === null ? null : new Date(lastMs).toISOString(),
    row_count: rows.length,
    unique_timestamp_count: windowTimestamps.length,
    start_gap_minutes: startGapMinutes === null ? null : decimal(startGapMinutes),
    end_gap_minutes: endGapMinutes === null ? null : decimal(endGapMinutes),
    gap_count: gaps.length,
    missing_interval_count: gaps.reduce((total, gap) => total + gap.missing_intervals, 0),
    maximum_gap_minutes: gaps.length ? Math.max(...gaps.map((gap) => gap.gap_minutes)) : 0,
    gaps: gaps.slice(0, 100),
    reasons,
  };
}

export function summarizeV5ReplayCoverage(entries = []) {
  const datasets = Object.fromEntries(entries.map((entry) => [entry.dataset, entry]));
  const canonical = V5_REPLAY_CANONICAL_DATASET_IDS.map((dataset) => datasets[dataset]).filter(Boolean);
  const requiredMissing = canonical.filter((entry) => entry.status === "missing").map((entry) => entry.dataset);
  const requiredIncomplete = canonical.filter((entry) => !entry.complete).map((entry) => entry.dataset);
  const contextMissing = entries
    .filter((entry) => !entry.required && entry.status === "missing")
    .map((entry) => entry.dataset);
  const contextIncomplete = entries
    .filter((entry) => !entry.required && entry.status === "partial")
    .map((entry) => entry.dataset);
  return {
    profile_id: V5_REPLAY_DATA_PROFILE_ID,
    profile_version: V5_REPLAY_DATA_PROFILE_VERSION,
    canonical_coverage_complete: canonical.length === V5_REPLAY_CANONICAL_DATASET_IDS.length
      && requiredIncomplete.length === 0,
    required_missing: requiredMissing,
    required_incomplete: requiredIncomplete,
    context_missing: contextMissing,
    context_incomplete: contextIncomplete,
    datasets,
  };
}

export function isV5ReplayPackCoverageComplete(pack) {
  if (pack?.data_profile_id !== V5_REPLAY_DATA_PROFILE_ID
    || pack?.data_profile_version !== V5_REPLAY_DATA_PROFILE_VERSION
    || pack?.canonical_m5_mode !== V5_REPLAY_CANONICAL_M5_MODE
    || pack?.canonical_resampler_version !== V5_REPLAY_CANONICAL_RESAMPLER_VERSION
    || pack?.canonical_coverage_complete !== true) {
    return false;
  }
  const datasets = pack?.actual_coverage?.datasets || pack?.quality?.actual_coverage?.datasets || {};
  return V5_REPLAY_CANONICAL_DATASET_IDS.every((dataset) => (
    pack?.datasets?.[dataset]
    && datasets[dataset]?.complete === true
    && datasets[dataset]?.blocking === false
  )) && ["MNQ_M5", "MES_M5"].every((dataset) => (
    pack?.datasets?.[dataset]?.source === "canonical_derived_m1"
    && pack?.datasets?.[dataset]?.derivation_version === V5_REPLAY_CANONICAL_RESAMPLER_VERSION
  ));
}

export function timeframeDurationMinutes(value) {
  const normalized = String(value || "").toUpperCase();
  return {
    "1": 1,
    "5": 5,
    "15": 15,
    "1H": 60,
    "4H": 240,
  }[normalized] || 5;
}

function uniqueSortedTimestamps(rows) {
  return [...new Set((rows || [])
    .map((row) => Date.parse(String(row?.timestamp_utc || "")))
    .filter(Number.isFinite))]
    .sort((left, right) => left - right);
}

function parisOffset(value) {
  return String(value || "").match(/[+-]\d{2}:\d{2}$/)?.[0] || "+01:00";
}

function validIso(value, code) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) throw new Error(`${code}:${value || "missing"}`);
  return new Date(timestamp).toISOString();
}

function decimal(value) {
  return Number(Number(value).toFixed(3));
}
