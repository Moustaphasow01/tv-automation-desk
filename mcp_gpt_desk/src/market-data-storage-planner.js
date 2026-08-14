import { createHash } from "node:crypto";

export const MARKET_DATA_STORAGE_PLAN_SCHEMA_VERSION = "market_data_storage_plan_v1";

const DEFAULT_OBJECT_BASE_URI = "file://./data/object-storage/market-data";

export function planMarketDataStorage({
  capabilityReport = null,
  profiles = null,
  asOfUtc = capabilityReport?.as_of_utc || new Date().toISOString(),
  objectStorageBaseUri = process.env.DESK_OBJECT_STORAGE_BASE_URI || DEFAULT_OBJECT_BASE_URI,
  hotRetentionDays = 45,
  coldRetentionDays = 1825,
} = {}) {
  const sourceProfiles = profiles || capabilityReport?.profiles || [];
  const plannedAt = iso(asOfUtc);
  const normalizedProfiles = sourceProfiles.map(normalizeCapabilityProfile);
  const items = normalizedProfiles.map((profile) => planProfile({
    profile,
    plannedAt,
    objectStorageBaseUri,
    hotRetentionDays: boundedInteger(hotRetentionDays, 45, 1, 3650),
    coldRetentionDays: boundedInteger(coldRetentionDays, 1825, 30, 3650 * 5),
  }));
  return {
    schema_version: MARKET_DATA_STORAGE_PLAN_SCHEMA_VERSION,
    planned_at_utc: plannedAt,
    object_storage_base_uri: objectStorageBaseUri,
    source_profile_ref: capabilityReport?.profile_ref || null,
    tiers: storageTiers(),
    summary: summarize(items),
    items,
  };
}

export function storageTiers() {
  return {
    HOT_SERIES: {
      purpose: "Projection PostgreSQL courte, interrogée par live/replay/front.",
      default_format: "POSTGRES_SERIES",
      default_retention_days: 45,
      rebuildable_from: ["COLD_PARQUET", "RAW_ARCHIVE"],
    },
    COLD_PARQUET: {
      purpose: "Historique brut immuable partitionné, économique et reconstructible.",
      default_format: "PARQUET",
      default_retention_days: 1825,
      partition_by: ["provider", "environment", "instrument_code", "timeframe", "date"],
    },
    RAW_ARCHIVE: {
      purpose: "Archive source brute quand la transformation Parquet n'est pas encore disponible.",
      default_format: "JSONL",
      default_retention_days: 1825,
      partition_by: ["provider", "environment", "source_key", "date"],
    },
    HOT_AND_COLD: {
      purpose: "Double écriture logique : série chaude pour exploitation, Parquet froid pour replay/reconstruction.",
      default_format: "PARQUET",
      default_retention_days: 1825,
    },
    IGNORE: {
      purpose: "Feed absent ou non utile : aucune matérialisation tant que la capacité reste manquante.",
      default_format: null,
      default_retention_days: null,
    },
  };
}

function planProfile({ profile, plannedAt, objectStorageBaseUri, hotRetentionDays, coldRetentionDays }) {
  const tier = storageTierFor(profile);
  const needsHot = ["HOT_SERIES", "HOT_AND_COLD"].includes(tier);
  const needsCold = ["COLD_PARQUET", "HOT_AND_COLD", "RAW_ARCHIVE"].includes(tier);
  const coldFormat = tier === "RAW_ARCHIVE" ? "JSONL" : "PARQUET";
  const datePartition = partitionDate(profile.historical_start_utc || profile.profiled_at_utc || plannedAt);
  const partitionSpec = {
    provider: profile.provider,
    environment: profile.environment,
    instrument_code: profile.instrument_code,
    timeframe: profile.timeframe,
    date: datePartition,
  };
  const objectKey = objectKeyFor({ profile, tier, datePartition, format: coldFormat });
  const uri = `${trimSlash(objectStorageBaseUri)}/${objectKey}`;
  const estimatedTotalMb = number(profile.cost_profile?.estimated_total_mb);
  const estimatedAnnualMb = estimateAnnualMb({ profile, estimatedTotalMb });
  return {
    storage_plan_id: stableId("storage-plan", profile.source_key, profile.instrument_code, profile.timeframe, profile.provider, profile.environment),
    source_key: profile.source_key,
    instrument_code: profile.instrument_code,
    provider: profile.provider,
    environment: profile.environment,
    timeframe: profile.timeframe,
    capability_status: profile.status,
    blocking_classification: profile.blocking_classification,
    storage_tier: tier,
    hot_series: needsHot ? {
      required: true,
      table: "market_candles",
      retention_days: hotRetentionDays,
      window_start_utc: profile.historical_end_utc ? subtractDays(profile.historical_end_utc, hotRetentionDays) : null,
      window_end_utc: profile.historical_end_utc || null,
      latest_timestamp_utc: profile.historical_end_utc || null,
      expected_query_shape: ["latest_window", "cutoff_window", "front_snapshot"],
    } : { required: false },
    cold_object: needsCold ? {
      required: true,
      format: coldFormat,
      compression: coldFormat === "PARQUET" ? "zstd" : "gzip",
      retention_days: coldRetentionDays,
      object_key: objectKey,
      uri,
      partition_grain: "day",
      partition_spec: partitionSpec,
      schema_version: "market_data_raw_v1",
    } : { required: false },
    reconstruction: {
      can_reconstruct_dataset: profile.has_ohlcv && (needsCold || needsHot),
      source_of_truth: needsCold ? "cold_object" : needsHot ? "hot_series" : "none",
      requires_content_hash: needsCold,
    },
    cost: {
      observed_rows: profile.observed_row_count,
      measured_total_mb: decimal(estimatedTotalMb, 3),
      estimated_annual_mb: decimal(estimatedAnnualMb, 3),
    },
    rationale: rationaleFor({ profile, tier, needsHot, needsCold }),
    planned_at_utc: plannedAt,
  };
}

function normalizeCapabilityProfile(profile = {}) {
  return {
    source_key: profile.source_key || profile.feed_id || "unknown",
    instrument_code: profile.instrument_code || "UNKNOWN",
    provider: profile.provider || "tradingview",
    environment: profile.environment || "preprod",
    timeframe: String(profile.timeframe || "unknown"),
    status: profile.status || "MISSING",
    blocking_classification: profile.blocking_classification || "UNKNOWN",
    storage_recommendation: profile.storage_recommendation || "IGNORE",
    historical_start_utc: nullableIso(profile.historical_start_utc),
    historical_end_utc: nullableIso(profile.historical_end_utc),
    profiled_at_utc: nullableIso(profile.profiled_at_utc),
    observed_row_count: integer(profile.observed_row_count),
    has_ohlcv: profile.has_ohlcv === true,
    has_tick: profile.has_tick === true,
    has_bid: profile.has_bid === true,
    has_ask: profile.has_ask === true,
    has_open_interest: profile.has_open_interest === true,
    missing_capabilities: array(profile.missing_capabilities),
    cost_profile: profile.cost_profile || {},
  };
}

function storageTierFor(profile) {
  if (profile.status === "MISSING" || profile.storage_recommendation === "IGNORE") return "IGNORE";
  if (profile.storage_recommendation === "HOT_AND_COLD") return "HOT_AND_COLD";
  if (profile.storage_recommendation === "COLD_RAW") return "COLD_PARQUET";
  if (profile.has_tick || profile.has_bid || profile.has_ask || profile.has_open_interest) return "HOT_AND_COLD";
  return "HOT_SERIES";
}

function summarize(items) {
  const byTier = items.reduce((acc, item) => {
    acc[item.storage_tier] = (acc[item.storage_tier] || 0) + 1;
    return acc;
  }, {});
  return {
    item_count: items.length,
    hot_series_count: items.filter((item) => item.hot_series.required).length,
    cold_object_count: items.filter((item) => item.cold_object.required).length,
    ignored_count: items.filter((item) => item.storage_tier === "IGNORE").length,
    by_tier: byTier,
    estimated_hot_mb: decimal(sum(items.filter((item) => item.hot_series.required).map((item) => item.cost.measured_total_mb)), 3),
    estimated_cold_annual_mb: decimal(sum(items.filter((item) => item.cold_object.required).map((item) => item.cost.estimated_annual_mb)), 3),
  };
}

function rationaleFor({ profile, tier, needsHot, needsCold }) {
  if (tier === "IGNORE") return "Feed absent ou sans capacité mesurable : pas de coût de stockage tant qu'il reste non exploitable.";
  if (needsHot && needsCold) return "Flux exploitable en direct et utile en reconstruction : conserver projection chaude et archive froide.";
  if (needsCold) return "Historique utile mais peu sollicité en direct : privilégier Parquet froid reconstructible.";
  return "Série OHLCV utilisée par le live/replay : conserver en projection chaude PostgreSQL.";
}

function objectKeyFor({ profile, tier, datePartition, format }) {
  const extension = format === "PARQUET" ? "parquet" : "jsonl.gz";
  return [
    `tier=${tier.toLowerCase()}`,
    `provider=${safeSegment(profile.provider)}`,
    `environment=${safeSegment(profile.environment)}`,
    `instrument=${safeSegment(profile.instrument_code)}`,
    `timeframe=${safeSegment(profile.timeframe)}`,
    `date=${datePartition}`,
    `part-${stableId("object", profile.source_key, datePartition).slice(0, 12)}.${extension}`,
  ].join("/");
}

function estimateAnnualMb({ profile, estimatedTotalMb }) {
  if (!profile.historical_start_utc || !profile.historical_end_utc || estimatedTotalMb <= 0) return estimatedTotalMb;
  const spanDays = Math.max(1, (Date.parse(profile.historical_end_utc) - Date.parse(profile.historical_start_utc)) / 86_400_000);
  return estimatedTotalMb * (365 / spanDays);
}

function partitionDate(value) {
  return iso(value).slice(0, 10);
}

function subtractDays(value, days) {
  return new Date(Date.parse(value) - days * 86_400_000).toISOString();
}

function stableId(...parts) {
  return createHash("sha256").update(parts.map((part) => String(part || "none")).join(":")).digest("hex");
}

function trimSlash(value) {
  return String(value || DEFAULT_OBJECT_BASE_URI).replace(/\/+$/, "");
}

function safeSegment(value) {
  return encodeURIComponent(String(value || "unknown")).replace(/%/g, "_");
}

function iso(value) {
  return new Date(value).toISOString();
}

function nullableIso(value) {
  if (!value) return null;
  return iso(value);
}

function integer(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function decimal(value, digits = 2) {
  return Number(Number(value || 0).toFixed(digits));
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  const safe = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  return Math.max(min, Math.min(safe, max));
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function sum(values) {
  return values.reduce((total, value) => total + number(value), 0);
}
