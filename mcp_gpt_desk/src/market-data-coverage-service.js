import {
  V5_REPLAY_DATA_PROFILE,
} from "./v5-replay-data-profile.js";
import { SystemClock } from "@tv-automation/desk-time";

export const MARKET_DATA_COVERAGE_SCHEMA_VERSION = "market_data_coverage_report_v1";
const MARKET_DATA_COVERAGE_CLOCK = new SystemClock();

export const DEFAULT_FRESHNESS_THRESHOLDS_MINUTES = Object.freeze({
  execution: 3,
  trigger: 8,
  confirmation: 45,
  context: 24 * 60,
});

export function buildMarketDataSourceInventory({
  profile = V5_REPLAY_DATA_PROFILE,
  environment = "prod",
  provider = "tradingview",
} = {}) {
  const sources = profile.datasets.map((spec) => {
    const expectedFeeds = spec.feedIds?.length
      ? [...spec.feedIds]
      : spec.sourceMode === "derived"
        ? []
        : spec.symbols.map((symbol) => feedId({ environment, provider, symbol, timeframe: spec.timeframe }));
    return {
      dataset: spec.dataset,
      role: spec.freshnessRole,
      required: spec.required === true,
      source_mode: spec.sourceMode || "provider",
      source_dataset: spec.sourceDataset || null,
      timeframe: spec.timeframe,
      output_timeframe: spec.outputTimeframe,
      symbols: [...spec.symbols],
      expected_feeds: expectedFeeds,
      provider_audit_feeds: [...(spec.providerAuditFeedIds || [])],
      freshness_threshold_minutes: DEFAULT_FRESHNESS_THRESHOLDS_MINUTES[spec.freshnessRole]
        ?? DEFAULT_FRESHNESS_THRESHOLDS_MINUTES.context,
      severity_if_missing: spec.required === true ? "blocking" : "degraded",
    };
  });
  return {
    schema_version: "market_data_source_inventory_v1",
    profile_id: profile.profile_id,
    profile_version: profile.version,
    environment,
    provider,
    sources,
  };
}

export function evaluateMarketDataCoverage({
  inventory = buildMarketDataSourceInventory(),
  observations = [],
  asOfUtc = MARKET_DATA_COVERAGE_CLOCK.now().utc,
} = {}) {
  const asOfMs = Date.parse(asOfUtc);
  if (!Number.isFinite(asOfMs)) throw new Error(`MARKET_DATA_COVERAGE_AS_OF_INVALID:${asOfUtc || "missing"}`);
  const observationByFeed = new Map(observations.map((item) => [item.feed_id, normalizeObservation(item)]));
  const datasetReports = [];
  const reportByDataset = new Map();

  for (const source of inventory.sources) {
    const report = source.source_mode === "derived"
      ? evaluateDerivedSource(source, reportByDataset)
      : evaluateProviderSource(source, observationByFeed, asOfMs);
    datasetReports.push(report);
    reportByDataset.set(report.dataset, report);
  }

  const required = datasetReports.filter((item) => item.required);
  const blocking = datasetReports.filter((item) => item.impact === "blocking");
  const degraded = datasetReports.filter((item) => item.impact === "degraded");
  return {
    schema_version: MARKET_DATA_COVERAGE_SCHEMA_VERSION,
    as_of_utc: new Date(asOfMs).toISOString(),
    profile_id: inventory.profile_id,
    profile_version: inventory.profile_version,
    execution_allowed: blocking.length === 0,
    status: blocking.length ? "blocked" : degraded.length ? "degraded" : "ready",
    summary: {
      dataset_count: datasetReports.length,
      required_count: required.length,
      required_ready_count: required.filter((item) => item.status === "ready" || item.status === "ready_derived").length,
      blocking_count: blocking.length,
      degraded_count: degraded.length,
      missing_count: datasetReports.filter((item) => item.status === "missing").length,
      stale_count: datasetReports.filter((item) => item.status === "stale").length,
    },
    blocking_datasets: blocking.map((item) => item.dataset),
    degraded_datasets: degraded.map((item) => item.dataset),
    datasets: Object.fromEntries(datasetReports.map((item) => [item.dataset, item])),
  };
}

export async function readMarketDataCoverageObservations(pool, {
  inventory = buildMarketDataSourceInventory(),
} = {}) {
  if (!pool?.query) throw new Error("MARKET_DATA_COVERAGE_POOL_REQUIRED");
  const feedIds = [...new Set(inventory.sources.flatMap((source) => [
    ...source.expected_feeds,
    ...source.provider_audit_feeds,
  ]))].sort();
  if (!feedIds.length) return [];
  const result = await pool.query(`
    WITH wanted(feed_id) AS (
      SELECT unnest($1::text[])
    )
    SELECT wanted.feed_id,
           mf.symbol_id,
           mf.instrument_code,
           mf.timeframe,
           mf.environment::text AS environment,
           mf.provider::text AS provider,
           mf.enabled,
           COALESCE(mf.latest_timestamp_utc, max(c.timestamp_utc)) AS latest_timestamp_utc,
           count(c.feed_id)::integer AS row_count
      FROM wanted
      LEFT JOIN market_feeds mf ON mf.feed_id = wanted.feed_id
      LEFT JOIN market_candles c ON c.feed_id = wanted.feed_id AND c.is_closed = true
     GROUP BY wanted.feed_id, mf.symbol_id, mf.instrument_code, mf.timeframe,
              mf.environment, mf.provider, mf.enabled, mf.latest_timestamp_utc
     ORDER BY wanted.feed_id
  `, [feedIds]);
  return result.rows || [];
}

export async function auditMarketDataCoverage({
  pool = null,
  asOfUtc = MARKET_DATA_COVERAGE_CLOCK.now().utc,
  profile = V5_REPLAY_DATA_PROFILE,
  environment = "prod",
  provider = "tradingview",
} = {}) {
  const inventory = buildMarketDataSourceInventory({ profile, environment, provider });
  const observations = pool ? await readMarketDataCoverageObservations(pool, { inventory }) : [];
  return {
    inventory,
    coverage: evaluateMarketDataCoverage({ inventory, observations, asOfUtc }),
    database_status: pool ? "queried" : "not_configured",
  };
}

function evaluateProviderSource(source, observationByFeed, asOfMs) {
  const feedReports = source.expected_feeds.map((feedIdValue) => {
    const observation = observationByFeed.get(feedIdValue);
    return evaluateFeedObservation({
      feedId: feedIdValue,
      observation,
      thresholdMinutes: source.freshness_threshold_minutes,
      asOfMs,
    });
  });
  const best = feedReports.find((item) => item.status === "ready")
    || feedReports.find((item) => item.status === "stale")
    || feedReports[0]
    || { status: "missing", feed_id: null, latest_timestamp_utc: null, age_minutes: null, row_count: 0 };
  return datasetReportFromFeed({ source, best, feedReports });
}

function evaluateDerivedSource(source, reportByDataset) {
  const upstream = reportByDataset.get(source.source_dataset);
  const ready = upstream && ["ready", "ready_derived"].includes(upstream.status);
  const status = ready ? "ready_derived" : upstream?.status || "missing";
  const impact = ready ? "none" : source.required ? "blocking" : "degraded";
  return {
    dataset: source.dataset,
    role: source.role,
    required: source.required,
    source_mode: source.source_mode,
    source_dataset: source.source_dataset,
    status,
    impact,
    reason: ready ? "derived_from_ready_source_dataset" : "source_dataset_not_ready",
    latest_timestamp_utc: upstream?.latest_timestamp_utc || null,
    age_minutes: upstream?.age_minutes ?? null,
    row_count: upstream?.row_count || 0,
    expected_feeds: source.expected_feeds,
    provider_audit_feeds: source.provider_audit_feeds,
    feed_reports: [],
  };
}

function datasetReportFromFeed({ source, best, feedReports }) {
  const impact = best.status === "ready"
    ? "none"
    : source.required ? "blocking" : "degraded";
  return {
    dataset: source.dataset,
    role: source.role,
    required: source.required,
    source_mode: source.source_mode,
    source_dataset: source.source_dataset,
    status: best.status,
    impact,
    reason: best.reason,
    latest_timestamp_utc: best.latest_timestamp_utc,
    age_minutes: best.age_minutes,
    row_count: best.row_count,
    expected_feeds: source.expected_feeds,
    provider_audit_feeds: source.provider_audit_feeds,
    selected_feed_id: best.feed_id,
    feed_reports: feedReports,
  };
}

function evaluateFeedObservation({ feedId, observation, thresholdMinutes, asOfMs }) {
  if (!observation?.feed_id || observation.exists === false) {
    return {
      feed_id: feedId,
      status: "missing",
      reason: "feed_not_found",
      latest_timestamp_utc: null,
      age_minutes: null,
      row_count: 0,
    };
  }
  if (!observation.enabled) {
    return {
      feed_id: feedId,
      status: "missing",
      reason: "feed_disabled",
      latest_timestamp_utc: observation.latest_timestamp_utc,
      age_minutes: null,
      row_count: observation.row_count,
    };
  }
  const latestMs = Date.parse(String(observation.latest_timestamp_utc || ""));
  if (!Number.isFinite(latestMs)) {
    return {
      feed_id: feedId,
      status: "missing",
      reason: "latest_timestamp_missing",
      latest_timestamp_utc: null,
      age_minutes: null,
      row_count: observation.row_count,
    };
  }
  const ageMinutes = decimal((asOfMs - latestMs) / 60_000);
  const stale = ageMinutes > thresholdMinutes;
  return {
    feed_id: feedId,
    status: stale ? "stale" : "ready",
    reason: stale ? "freshness_threshold_exceeded" : "fresh",
    latest_timestamp_utc: new Date(latestMs).toISOString(),
    age_minutes: ageMinutes,
    row_count: observation.row_count,
  };
}

function normalizeObservation(item) {
  return {
    ...item,
    exists: item.exists !== false && item.symbol_id !== null && item.symbol_id !== undefined,
    enabled: item.enabled !== false,
    row_count: Number(item.row_count || 0),
  };
}

function feedId({ environment, provider, symbol, timeframe }) {
  return `${environment}__${provider}__${symbol}__${timeframe}`;
}

function decimal(value) {
  return Number(Number(value).toFixed(3));
}
