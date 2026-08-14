import { createHash } from "node:crypto";
import { SystemClock } from "@tv-automation/desk-time";
import { buildMarketDataSourceInventory } from "./market-data-coverage-service.js";

export const MARKET_DATA_CAPABILITY_PROFILE_SCHEMA_VERSION = "market_data_capability_profile_v1";

const MICROSTRUCTURE_CAPABILITIES = Object.freeze(["tick", "bid", "ask", "open_interest"]);
const REQUIRED_OHLCV_CAPABILITIES = Object.freeze(["ohlcv", "volume"]);
const MARKET_DATA_CAPABILITY_CLOCK = new SystemClock();

export async function auditMarketDataCapabilities({
  pool = null,
  asOfUtc = MARKET_DATA_CAPABILITY_CLOCK.now().utc,
  environment = "prod",
  provider = "tradingview",
  persist = false,
  dryRun = false,
} = {}) {
  const inventory = buildMarketDataSourceInventory({ environment, provider });
  const observations = pool
    ? await readMarketDataCapabilityObservations(pool, { environment, provider })
    : [];
  const report = profileMarketDataCapabilities({ observations, inventory, asOfUtc, environment, provider });
  const persistence = pool && persist
    ? await persistMarketDataCapabilityReport(pool, { report, dryRun })
    : { persisted: false, dry_run: dryRun };
  return {
    schema_version: "market_data_capability_audit_v1",
    database_status: pool ? "queried" : "not_configured",
    persistence,
    inventory,
    profile: report,
  };
}

export function profileMarketDataCapabilities({
  observations = [],
  inventory = buildMarketDataSourceInventory(),
  asOfUtc = MARKET_DATA_CAPABILITY_CLOCK.now().utc,
  environment = inventory.environment || "prod",
  provider = inventory.provider || "tradingview",
} = {}) {
  const asOf = iso(asOfUtc);
  const expectedByFeed = expectedSourceMap(inventory);
  const observationsByFeed = new Map((observations || []).map((row) => [row.feed_id || row.source_key, row]));
  const expectedFeedIds = [...expectedByFeed.keys()];
  const observedFeedIds = [...observationsByFeed.keys()].filter(Boolean);
  const allFeedIds = [...new Set([...expectedFeedIds, ...observedFeedIds])].sort();
  const profiles = allFeedIds.map((feedId) => {
    const observation = observationsByFeed.get(feedId) || { feed_id: feedId, exists: false, row_count: 0 };
    return profileObservation({
      observation,
      expectedSources: expectedByFeed.get(feedId) || [],
      asOfUtc: asOf,
      environment,
      provider,
    });
  });
  const blocking = profiles.filter((profile) => profile.blocking_classification === "BLOCKING");
  const missing = profiles.filter((profile) => profile.status === "MISSING");
  const microstructureMissing = countMissingMicrostructure(profiles);
  return {
    schema_version: MARKET_DATA_CAPABILITY_PROFILE_SCHEMA_VERSION,
    as_of_utc: asOf,
    profile_ref: `${inventory.profile_id || "market_data"}@${inventory.profile_version || inventory.version || "unknown"}`,
    environment,
    provider,
    summary: {
      profile_count: profiles.length,
      measured_count: profiles.filter((profile) => profile.status === "MEASURED").length,
      partial_count: profiles.filter((profile) => profile.status === "PARTIAL").length,
      missing_count: missing.length,
      blocking_count: blocking.length,
      non_blocking_missing_microstructure_count: microstructureMissing,
      tick_available_count: profiles.filter((profile) => profile.has_tick).length,
      bid_ask_available_count: profiles.filter((profile) => profile.has_bid && profile.has_ask).length,
      open_interest_available_count: profiles.filter((profile) => profile.has_open_interest).length,
    },
    blocking_profiles: blocking.map((profile) => profile.source_key),
    profiles,
  };
}

export async function readMarketDataCapabilityObservations(pool, {
  environment = null,
  provider = null,
  limit = 5000,
} = {}) {
  if (!pool?.query) throw new Error("MARKET_DATA_CAPABILITY_POOL_REQUIRED");
  const result = await pool.query(`
    WITH candle_gaps AS (
      SELECT c.feed_id,
             EXTRACT(EPOCH FROM c.timestamp_utc - lag(c.timestamp_utc) OVER (
               PARTITION BY c.feed_id
               ORDER BY c.timestamp_utc
             ))::integer AS gap_seconds
        FROM market_candles c
       WHERE c.is_closed = true
    ),
    gap_stats AS (
      SELECT cg.feed_id,
             max(cg.gap_seconds)::integer AS largest_gap_seconds,
             count(*) FILTER (
               WHERE cg.gap_seconds IS NOT NULL
                 AND mt.seconds IS NOT NULL
                 AND cg.gap_seconds > (mt.seconds * 1.5)
             )::integer AS missing_bar_count
        FROM candle_gaps cg
        JOIN market_feeds mf ON mf.feed_id = cg.feed_id
        LEFT JOIN market_timeframes mt ON mt.timeframe = mf.timeframe
       GROUP BY cg.feed_id
    )
    SELECT mf.feed_id,
           mf.feed_id AS source_key,
           mf.instrument_code,
           ms.symbol_code,
           mf.provider::text AS provider,
           mf.environment::text AS environment,
           mf.timeframe,
           mt.seconds AS timeframe_seconds,
           mf.enabled,
           mf.latest_timestamp_utc,
           min(c.timestamp_utc) AS historical_start_utc,
           max(c.timestamp_utc) AS historical_end_utc,
           count(c.feed_id)::integer AS row_count,
           count(c.feed_id) FILTER (WHERE c.is_closed = true)::integer AS closed_row_count,
           count(c.feed_id) FILTER (WHERE c.volume IS NOT NULL)::integer AS volume_row_count,
           COALESCE(max(gs.largest_gap_seconds), 0)::integer AS largest_gap_seconds,
           COALESCE(max(gs.missing_bar_count), 0)::integer AS missing_bar_count,
           bool_or(c.raw ? 'tick' OR c.raw ? 'last_size') AS has_tick,
           bool_or(c.raw ? 'bid' OR c.raw ? 'bid_price' OR c.raw ? 'best_bid') AS has_bid,
           bool_or(c.raw ? 'ask' OR c.raw ? 'ask_price' OR c.raw ? 'best_ask') AS has_ask,
           bool_or(c.raw ? 'open_interest' OR c.raw ? 'oi') AS has_open_interest,
           mf.metadata,
           mf.raw
      FROM market_feeds mf
      LEFT JOIN market_symbols ms ON ms.symbol_id = mf.symbol_id
      LEFT JOIN market_timeframes mt ON mt.timeframe = mf.timeframe
      LEFT JOIN market_candles c ON c.feed_id = mf.feed_id
      LEFT JOIN gap_stats gs ON gs.feed_id = mf.feed_id
     WHERE ($1::desk_data_environment IS NULL OR mf.environment = $1::desk_data_environment)
       AND ($2::desk_source_provider IS NULL OR mf.provider = $2::desk_source_provider)
     GROUP BY mf.feed_id, mf.instrument_code, ms.symbol_code, mf.provider, mf.environment,
              mf.timeframe, mt.seconds, mf.enabled, mf.latest_timestamp_utc, mf.metadata, mf.raw
     ORDER BY mf.environment, mf.provider, mf.instrument_code, mf.timeframe, mf.feed_id
     LIMIT $3
  `, [
    nullable(environment),
    nullable(provider),
    bounded(limit, 5000, 25_000),
  ]);
  return result.rows || [];
}

export async function persistMarketDataCapabilityReport(pool, {
  report,
  runKey = null,
  dryRun = false,
} = {}) {
  if (!pool?.connect) throw new Error("MARKET_DATA_CAPABILITY_PERSIST_POOL_REQUIRED");
  if (!report?.profiles) throw new Error("MARKET_DATA_CAPABILITY_REPORT_REQUIRED");
  const key = runKey || `market-data-capability:${report.environment}:${report.provider}:${report.as_of_utc}`;
  const runId = stableUuid(`capability-run:${key}`);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO market_data_capability_profile_runs (
        capability_profile_run_id, run_key, as_of_utc, environment, provider,
        profile_schema_version, source_profile_ref, profile_count,
        blocking_count, missing_count, report
      ) VALUES ($1,$2,$3,$4::desk_data_environment,$5::desk_source_provider,$6,$7,$8,$9,$10,$11::jsonb)
      ON CONFLICT (run_key) DO UPDATE SET
        as_of_utc = EXCLUDED.as_of_utc,
        profile_schema_version = EXCLUDED.profile_schema_version,
        source_profile_ref = EXCLUDED.source_profile_ref,
        profile_count = EXCLUDED.profile_count,
        blocking_count = EXCLUDED.blocking_count,
        missing_count = EXCLUDED.missing_count,
        report = EXCLUDED.report
    `, [
      runId,
      key,
      report.as_of_utc,
      report.environment,
      report.provider,
      report.schema_version,
      report.profile_ref,
      report.summary.profile_count,
      report.summary.blocking_count,
      report.summary.missing_count,
      JSON.stringify(report),
    ]);

    for (const profile of report.profiles) {
      await client.query(`INSERT INTO market_data_capability_profiles (
          market_data_capability_profile_id, capability_profile_run_id, source_key, feed_id,
          instrument_code, symbol_code, provider, environment, timeframe, timeframe_seconds,
          status, blocking_classification, storage_recommendation,
          historical_start_utc, historical_end_utc, observed_row_count, closed_row_count,
          volume_row_count, missing_bar_count, largest_gap_seconds, has_ohlcv, has_volume,
          has_tick, has_bid, has_ask, has_open_interest, measured_capabilities,
          missing_capabilities, blocking_missing_capabilities, non_blocking_missing_capabilities,
          cost_profile, recommendation, metadata, profiled_at_utc
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7::desk_source_provider,$8::desk_data_environment,$9,$10,
          $11::market_data_capability_status,$12::market_data_blocking_classification,
          $13::market_data_storage_recommendation,$14,$15,$16,$17,$18,$19,$20,$21,$22,
          $23,$24,$25,$26,$27,$28,$29,$30,$31::jsonb,$32,$33::jsonb,$34
        )
        ON CONFLICT (source_key, instrument_code, timeframe, environment, provider) DO UPDATE SET
          capability_profile_run_id = EXCLUDED.capability_profile_run_id,
          symbol_code = EXCLUDED.symbol_code,
          timeframe_seconds = EXCLUDED.timeframe_seconds,
          status = EXCLUDED.status,
          blocking_classification = EXCLUDED.blocking_classification,
          storage_recommendation = EXCLUDED.storage_recommendation,
          historical_start_utc = EXCLUDED.historical_start_utc,
          historical_end_utc = EXCLUDED.historical_end_utc,
          observed_row_count = EXCLUDED.observed_row_count,
          closed_row_count = EXCLUDED.closed_row_count,
          volume_row_count = EXCLUDED.volume_row_count,
          missing_bar_count = EXCLUDED.missing_bar_count,
          largest_gap_seconds = EXCLUDED.largest_gap_seconds,
          has_ohlcv = EXCLUDED.has_ohlcv,
          has_volume = EXCLUDED.has_volume,
          has_tick = EXCLUDED.has_tick,
          has_bid = EXCLUDED.has_bid,
          has_ask = EXCLUDED.has_ask,
          has_open_interest = EXCLUDED.has_open_interest,
          measured_capabilities = EXCLUDED.measured_capabilities,
          missing_capabilities = EXCLUDED.missing_capabilities,
          blocking_missing_capabilities = EXCLUDED.blocking_missing_capabilities,
          non_blocking_missing_capabilities = EXCLUDED.non_blocking_missing_capabilities,
          cost_profile = EXCLUDED.cost_profile,
          recommendation = EXCLUDED.recommendation,
          metadata = EXCLUDED.metadata,
          profiled_at_utc = EXCLUDED.profiled_at_utc,
          updated_at_utc = now()
      `, profileParams({ profile, runId }));
    }
    if (dryRun) await client.query("ROLLBACK");
    else await client.query("COMMIT");
    return {
      persisted: !dryRun,
      dry_run: dryRun,
      run_key: key,
      capability_profile_run_id: runId,
      profile_count: report.profiles.length,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function profileObservation({ observation = {}, expectedSources = [], asOfUtc, environment, provider }) {
  const rowCount = number(observation.row_count ?? observation.observed_row_count);
  const closedRowCount = number(observation.closed_row_count, rowCount);
  const volumeRowCount = number(observation.volume_row_count);
  const hasOhlcv = rowCount > 0 && observation.enabled !== false;
  const metadataCapabilities = {
    ...(observation.metadata?.capabilities || {}),
    ...(observation.raw?.capabilities || {}),
  };
  const timeframe = String(observation.timeframe || feedTimeframe(observation.feed_id || observation.source_key) || "unknown");
  const hasTick = bool(observation.has_tick) || bool(metadataCapabilities.tick) || ["tick", "1t", "t"].includes(timeframe.toLowerCase());
  const hasBid = bool(observation.has_bid) || bool(metadataCapabilities.bid);
  const hasAsk = bool(observation.has_ask) || bool(metadataCapabilities.ask);
  const hasOpenInterest = bool(observation.has_open_interest) || bool(metadataCapabilities.open_interest);
  const hasVolume = volumeRowCount > 0 || bool(metadataCapabilities.volume);
  const measuredCapabilities = [
    ...(hasOhlcv ? ["ohlcv"] : []),
    ...(hasVolume ? ["volume"] : []),
    ...(hasTick ? ["tick"] : []),
    ...(hasBid ? ["bid"] : []),
    ...(hasAsk ? ["ask"] : []),
    ...(hasOpenInterest ? ["open_interest"] : []),
  ];
  const missingCapabilities = [
    ...REQUIRED_OHLCV_CAPABILITIES.filter((capability) => !measuredCapabilities.includes(capability)),
    ...MICROSTRUCTURE_CAPABILITIES.filter((capability) => !measuredCapabilities.includes(capability)),
  ];
  const expectedRequired = expectedSources.some((source) => source.required === true);
  const blockingMissingCapabilities = expectedRequired
    ? REQUIRED_OHLCV_CAPABILITIES.filter((capability) => missingCapabilities.includes(capability))
    : [];
  const nonBlockingMissingCapabilities = missingCapabilities.filter((capability) => !blockingMissingCapabilities.includes(capability));
  const status = !hasOhlcv
    ? "MISSING"
    : blockingMissingCapabilities.length || !hasVolume || hasBid !== hasAsk
      ? "PARTIAL"
      : "MEASURED";
  const storageRecommendation = storageRecommendationFor({ hasTick, hasBid, hasAsk, hasOpenInterest, rowCount, timeframe });
  return {
    market_data_capability_profile_id: stableUuid(`capability:${observation.feed_id || observation.source_key || JSON.stringify(observation)}`),
    source_key: observation.source_key || observation.feed_id || "unknown",
    feed_id: observation.feed_id || null,
    instrument_code: observation.instrument_code || expectedSources[0]?.symbols?.[0] || feedInstrument(observation.feed_id) || "UNKNOWN",
    symbol_code: observation.symbol_code || null,
    provider: observation.provider || provider,
    environment: observation.environment || environment,
    timeframe,
    timeframe_seconds: numberOrNull(observation.timeframe_seconds),
    status,
    blocking_classification: blockingMissingCapabilities.length ? "BLOCKING" : "NON_BLOCKING",
    storage_recommendation: storageRecommendation,
    historical_start_utc: nullableIso(observation.historical_start_utc),
    historical_end_utc: nullableIso(observation.historical_end_utc || observation.latest_timestamp_utc),
    observed_row_count: rowCount,
    closed_row_count: closedRowCount,
    volume_row_count: volumeRowCount,
    missing_bar_count: number(observation.missing_bar_count),
    largest_gap_seconds: numberOrNull(observation.largest_gap_seconds),
    has_ohlcv: hasOhlcv,
    has_volume: hasVolume,
    has_tick: hasTick,
    has_bid: hasBid,
    has_ask: hasAsk,
    has_open_interest: hasOpenInterest,
    measured_capabilities: measuredCapabilities,
    missing_capabilities: missingCapabilities,
    blocking_missing_capabilities: blockingMissingCapabilities,
    non_blocking_missing_capabilities: nonBlockingMissingCapabilities,
    cost_profile: costProfile({ rowCount, hasTick, hasBid, hasAsk, hasOpenInterest }),
    recommendation: recommendationText({ status, blockingMissingCapabilities, nonBlockingMissingCapabilities, storageRecommendation }),
    metadata: {
      expected_datasets: expectedSources.map((source) => source.dataset),
      expected_roles: [...new Set(expectedSources.map((source) => source.role).filter(Boolean))],
      profile_reason: expectedSources.length ? "profiled_against_v5_inventory" : "observed_feed_outside_v5_inventory",
    },
    profiled_at_utc: asOfUtc,
  };
}

function expectedSourceMap(inventory) {
  const map = new Map();
  for (const source of inventory.sources || []) {
    for (const feedId of [...(source.expected_feeds || []), ...(source.provider_audit_feeds || [])]) {
      if (!map.has(feedId)) map.set(feedId, []);
      map.get(feedId).push(source);
    }
  }
  return map;
}

function countMissingMicrostructure(profiles) {
  return profiles.reduce((count, profile) => count + profile.non_blocking_missing_capabilities
    .filter((capability) => MICROSTRUCTURE_CAPABILITIES.includes(capability)).length, 0);
}

function storageRecommendationFor({ hasTick, hasBid, hasAsk, hasOpenInterest, rowCount, timeframe }) {
  if (hasTick || hasBid || hasAsk || hasOpenInterest) return "HOT_AND_COLD";
  if (rowCount <= 0) return "IGNORE";
  const normalized = String(timeframe || "").toLowerCase();
  if (["1", "1m", "m1", "5", "5m", "m5", "15", "15m", "m15"].includes(normalized)) return "HOT_SERIES";
  return "COLD_RAW";
}

function recommendationText({ status, blockingMissingCapabilities, nonBlockingMissingCapabilities, storageRecommendation }) {
  if (blockingMissingCapabilities.length) {
    return `Bloquant simulation/live: ${blockingMissingCapabilities.join(", ")} absent.`;
  }
  if (status === "MISSING") return "Source absente ou sans historique mesurable ; conserver comme non bloquant tant qu'elle n'est pas requise.";
  if (nonBlockingMissingCapabilities.length) {
    return `Microstructure manquante (${nonBlockingMissingCapabilities.join(", ")}), non bloquante pour V5 OHLCV ; à intégrer dans le choix ${storageRecommendation}.`;
  }
  return `Capacité mesurée ; stockage recommandé ${storageRecommendation}.`;
}

function costProfile({ rowCount, hasTick, hasBid, hasAsk, hasOpenInterest }) {
  const estimatedBytesPerRow = 80
    + (hasTick ? 24 : 0)
    + (hasBid || hasAsk ? 32 : 0)
    + (hasOpenInterest ? 16 : 0);
  return {
    estimated_bytes_per_row: estimatedBytesPerRow,
    estimated_total_mb: decimal((rowCount * estimatedBytesPerRow) / (1024 * 1024), 3),
  };
}

function profileParams({ profile, runId }) {
  return [
    profile.market_data_capability_profile_id,
    runId,
    profile.source_key,
    profile.feed_id,
    profile.instrument_code,
    profile.symbol_code,
    profile.provider,
    profile.environment,
    profile.timeframe,
    profile.timeframe_seconds,
    profile.status,
    profile.blocking_classification,
    profile.storage_recommendation,
    profile.historical_start_utc,
    profile.historical_end_utc,
    profile.observed_row_count,
    profile.closed_row_count,
    profile.volume_row_count,
    profile.missing_bar_count,
    profile.largest_gap_seconds,
    profile.has_ohlcv,
    profile.has_volume,
    profile.has_tick,
    profile.has_bid,
    profile.has_ask,
    profile.has_open_interest,
    profile.measured_capabilities,
    profile.missing_capabilities,
    profile.blocking_missing_capabilities,
    profile.non_blocking_missing_capabilities,
    JSON.stringify(profile.cost_profile),
    profile.recommendation,
    JSON.stringify(profile.metadata),
    profile.profiled_at_utc,
  ];
}

function stableUuid(value) {
  const hex = createHash("sha256").update(String(value)).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function feedTimeframe(feedId = "") {
  const parts = String(feedId).split("__");
  return parts.length ? parts[parts.length - 1] : null;
}

function feedInstrument(feedId = "") {
  const parts = String(feedId).split("__");
  return parts.length >= 3 ? parts[2] : null;
}

function bool(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : null;
}

function nullable(value) {
  if (value === null || value === undefined || value === "") return null;
  return value;
}

function iso(value) {
  return new Date(value).toISOString();
}

function nullableIso(value) {
  if (!value) return null;
  return iso(value);
}

function decimal(value, digits = 2) {
  return Number(Number(value || 0).toFixed(digits));
}

function bounded(value, fallback = 100, max = 500) {
  const parsed = Number(value);
  return Math.max(1, Math.min(Number.isFinite(parsed) ? Math.trunc(parsed) : fallback, max));
}
