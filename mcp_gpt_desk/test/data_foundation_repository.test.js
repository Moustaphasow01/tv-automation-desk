import assert from "node:assert/strict";
import test from "node:test";
import {
  PostgresDataFoundationRepository,
  normalizeFeatureDefinitionRow,
  normalizeFeatureValueRow,
  normalizeMarketDataHotSeriesWindowRow,
  normalizeMarketDataCapabilityProfileRow,
  normalizeMarketDataStorageObjectRow,
  toSqlDatasetStatus,
  toSqlFeatureComputationStatus,
} from "../src/data-foundation-repository.js";

test("Postgres Data Foundation repository reads feature values with dataset and version provenance", async () => {
  const queries = [];
  const repository = new PostgresDataFoundationRepository({
    initialized: Promise.resolve(),
    pool: {
      async query(sql, params = []) {
        queries.push({ sql, params });
        return {
          rows: [{
            feature_value_id: "77777777-7777-4777-8777-777777777777",
            feature_computation_run_id: "66666666-6666-4666-8666-666666666666",
            feature_definition_id: "44444444-4444-4444-8444-444444444444",
            feature_version_id: "55555555-5555-4555-8555-555555555555",
            feature_key: "atr_14",
            feature_name: "ATR 14",
            feature_version: "1.0.0",
            formula_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            output_kind: "SERIES",
            dataset_id: "22222222-2222-4222-8222-222222222222",
            dataset_key: "mnq-2026-06-11-cutoff",
            cutoff_utc: "2026-06-11T19:45:00.000Z",
            cutoff_paris: "2026-06-11T21:45:00+02:00",
            dataset_provenance_hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            parameters_hash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            output_hash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
            computation_provenance_hash: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            entity_key: "MNQ",
            instrument_code: "MNQ",
            timeframe: "M15",
            observed_at_utc: "2026-06-11T07:15:00.000Z",
            available_at_utc: "2026-06-11T07:16:00.000Z",
            quality: "OK",
            value_numeric: "21.5",
            value_json: null,
            source_row_hash: null,
            metadata: { unit: "points" },
            created_at_utc: "2026-06-11T07:16:01.000Z",
          }],
        };
      },
    },
  });

  const values = await repository.listFeatureValues({
    featureKey: "atr_14",
    datasetKey: "mnq-2026-06-11-cutoff",
    entityKey: "MNQ",
    timeframe: "M15",
    fromUtc: "2026-06-11T07:00:00.000Z",
    toUtc: "2026-06-11T08:00:00.000Z",
    limit: 50,
  });

  assert.match(queries[0].sql, /FROM feature_value_points fvp/);
  assert.match(queries[0].sql, /JOIN feature_computation_runs fcr/);
  assert.match(queries[0].sql, /JOIN feature_versions fv/);
  assert.match(queries[0].sql, /JOIN feature_definitions fd/);
  assert.match(queries[0].sql, /JOIN datasets d/);
  assert.deepEqual(queries[0].params.slice(0, 5), ["atr_14", "mnq-2026-06-11-cutoff", "MNQ", null, "M15"]);
  assert.equal(values[0].dataset_cutoff_utc, "2026-06-11T19:45:00.000Z");
  assert.equal(values[0].dataset_provenance_hash, "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  assert.equal(values[0].value_numeric, 21.5);
});

test("Postgres Data Foundation repository exposes catalog overview from canonical tables", async () => {
  const queries = [];
  const repository = new PostgresDataFoundationRepository({
    initialized: Promise.resolve(),
    pool: {
      async query(sql, params = []) {
        queries.push({ sql, params });
        if (/SELECT\s+\(SELECT count\(\*\)::int FROM data_sources\)/.test(sql)) {
          return { rows: [{ data_sources: 1, datasets: 1, feature_definitions: 1, feature_value_points: 1 }] };
        }
        return { rows: [] };
      },
    },
  });

  const overview = await repository.getCatalogOverview({ limit: 12 });

  assert.equal(overview.counts.data_sources, 1);
  assert.equal(overview.counts.datasets, 1);
  assert.equal(queries.some((query) => /FROM data_sources/.test(query.sql)), true);
  assert.equal(queries.some((query) => /FROM datasets/.test(query.sql)), true);
  assert.equal(queries.some((query) => /FROM feature_definitions fd/.test(query.sql)), true);
  assert.equal(queries.some((query) => /FROM feature_computation_runs fcr/.test(query.sql)), true);
});

test("Postgres Data Foundation repository lists market data capability profiles with run provenance", async () => {
  const queries = [];
  const repository = new PostgresDataFoundationRepository({
    initialized: Promise.resolve(),
    pool: {
      async query(sql, params = []) {
        queries.push({ sql, params });
        return {
          rows: [{
            market_data_capability_profile_id: "88888888-8888-4888-8888-888888888888",
            capability_profile_run_id: "99999999-9999-4999-8999-999999999999",
            run_key: "market-data-capability:prod:tradingview:2026-08-09T08:00:00.000Z",
            run_as_of_utc: "2026-08-09T08:00:00.000Z",
            source_profile_ref: "v5_replay_data_profile@1.0.0",
            source_key: "prod__tradingview__MNQ1!__1",
            feed_id: "prod__tradingview__MNQ1!__1",
            instrument_code: "MNQ1!",
            symbol_code: "MNQ",
            provider: "tradingview",
            environment: "prod",
            timeframe: "1",
            timeframe_seconds: "60",
            status: "PARTIAL",
            blocking_classification: "NON_BLOCKING",
            storage_recommendation: "HOT_SERIES",
            historical_start_utc: "2026-06-01T00:00:00.000Z",
            historical_end_utc: "2026-06-30T21:45:00.000Z",
            observed_row_count: "1000",
            closed_row_count: "1000",
            volume_row_count: "1000",
            missing_bar_count: "0",
            largest_gap_seconds: "120",
            has_ohlcv: true,
            has_volume: true,
            has_tick: false,
            has_bid: false,
            has_ask: false,
            has_open_interest: false,
            measured_capabilities: ["ohlcv", "volume"],
            missing_capabilities: ["tick", "bid", "ask", "open_interest"],
            blocking_missing_capabilities: [],
            non_blocking_missing_capabilities: ["tick", "bid", "ask", "open_interest"],
            cost_profile: { estimated_total_mb: 0.08 },
            recommendation: "Microstructure manquante, non bloquante.",
            metadata: {},
            profiled_at_utc: "2026-08-09T08:00:00.000Z",
            created_at_utc: "2026-08-09T08:00:00.000Z",
            updated_at_utc: "2026-08-09T08:00:00.000Z",
          }],
        };
      },
    },
  });

  const profiles = await repository.listMarketDataCapabilityProfiles({
    sourceKey: "prod__tradingview__MNQ1!__1",
    instrumentCode: "MNQ1!",
    timeframe: "1",
    status: "partial",
    blockingClassification: "non_blocking",
    limit: 50,
  });

  assert.match(queries[0].sql, /FROM market_data_capability_profiles p/);
  assert.match(queries[0].sql, /LEFT JOIN market_data_capability_profile_runs r/);
  assert.deepEqual(queries[0].params, ["prod__tradingview__MNQ1!__1", "MNQ1!", "1", "PARTIAL", "NON_BLOCKING", 50]);
  assert.equal(profiles[0].run_key.startsWith("market-data-capability:"), true);
  assert.equal(profiles[0].timeframe_seconds, 60);
  assert.equal(profiles[0].blocking_classification, "NON_BLOCKING");
  assert.deepEqual(profiles[0].non_blocking_missing_capabilities, ["tick", "bid", "ask", "open_interest"]);
});

test("Postgres Data Foundation repository lists hot/cold market storage read models", async () => {
  const queries = [];
  const repository = new PostgresDataFoundationRepository({
    initialized: Promise.resolve(),
    pool: {
      async query(sql, params = []) {
        queries.push({ sql, params });
        if (/FROM market_data_storage_objects mso/.test(sql)) {
          return {
            rows: [{
              market_data_storage_object_id: "99999999-9999-4999-8999-999999999999",
              object_key: "tier=hot_and_cold/provider=tradingview/instrument=MNQ1!/date=2026-06-01/part.parquet",
              storage_tier: "HOT_AND_COLD",
              storage_format: "PARQUET",
              status: "ACTIVE",
              uri: "file://./data/object-storage/market-data/tier=hot_and_cold/part.parquet",
              dataset_id: "22222222-2222-4222-8222-222222222222",
              dataset_key: "mnq-2026-06-11-cutoff",
              batch_key: "tv-mnq-2026-06-11",
              capability_status: "MEASURED",
              capability_blocking_classification: "NON_BLOCKING",
              source_key: "prod__tradingview__MNQ1!__1",
              provider: "tradingview",
              environment: "prod",
              instrument_code: "MNQ1!",
              timeframe: "1",
              time_range_start_utc: "2026-06-01T00:00:00.000Z",
              time_range_end_utc: "2026-06-30T21:45:00.000Z",
              partition_grain: "day",
              partition_spec: { instrument_code: "MNQ1!" },
              schema_version: "market_data_raw_v1",
              compression: "zstd",
              record_count: "120",
              byte_size: "9600",
              retention_days: "1825",
              created_at_utc: "2026-08-09T08:00:00.000Z",
              updated_at_utc: "2026-08-09T08:00:00.000Z",
            }],
          };
        }
        return {
          rows: [{
            hot_series_window_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            source_key: "prod__tradingview__MNQ1!__1",
            provider: "tradingview",
            environment: "prod",
            instrument_code: "MNQ1!",
            timeframe: "1",
            hot_table: "market_candles",
            object_key: "tier=hot_and_cold/provider=tradingview/instrument=MNQ1!/date=2026-06-01/part.parquet",
            storage_object_uri: "file://./data/object-storage/market-data/tier=hot_and_cold/part.parquet",
            capability_status: "MEASURED",
            capability_blocking_classification: "NON_BLOCKING",
            window_start_utc: "2026-06-01T00:00:00.000Z",
            window_end_utc: "2026-06-30T21:45:00.000Z",
            latest_timestamp_utc: "2026-06-30T21:45:00.000Z",
            retention_days: "45",
            row_count: "120",
            status: "ACTIVE",
            created_at_utc: "2026-08-09T08:00:00.000Z",
            updated_at_utc: "2026-08-09T08:00:00.000Z",
          }],
        };
      },
    },
  });

  const storageObjects = await repository.listMarketDataStorageObjects({
    instrumentCode: "MNQ1!",
    timeframe: "1",
    storageTier: "hot_and_cold",
    storageFormat: "parquet",
    status: "active",
    limit: 10,
  });
  const hotWindows = await repository.listMarketDataHotSeriesWindows({
    sourceKey: "prod__tradingview__MNQ1!__1",
    status: "active",
    limit: 10,
  });

  assert.match(queries[0].sql, /FROM market_data_storage_objects mso/);
  assert.deepEqual(queries[0].params, [null, "MNQ1!", "1", "HOT_AND_COLD", "PARQUET", "ACTIVE", 10]);
  assert.equal(storageObjects[0].dataset_key, "mnq-2026-06-11-cutoff");
  assert.equal(storageObjects[0].record_count, 120);
  assert.match(queries[1].sql, /FROM market_data_hot_series_windows hsw/);
  assert.deepEqual(queries[1].params, ["prod__tradingview__MNQ1!__1", null, null, "ACTIVE", 10]);
  assert.equal(hotWindows[0].hot_table, "market_candles");
  assert.equal(hotWindows[0].row_count, 120);
});

test("Data Foundation repository normalizers keep feature versions and cutoff fields stable", () => {
  const definition = normalizeFeatureDefinitionRow({
    feature_definition_id: "44444444-4444-4444-8444-444444444444",
    feature_key: "atr_14",
    name: "ATR 14",
    category: "volatility",
    output_kind: "SERIES",
    status: "ACTIVE",
    description: null,
    metadata: {},
    created_at_utc: "2026-08-09T08:00:00.000Z",
    updated_at_utc: "2026-08-09T08:00:00.000Z",
    versions: JSON.stringify([{
      feature_version_id: "55555555-5555-4555-8555-555555555555",
      version: "1.0.0",
      status: "PUBLISHED",
      formula_ref: "feature://atr/wilder/14",
      formula_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      deterministic: true,
      point_in_time_safe: true,
      published_at_utc: "2026-08-09T08:00:00.000Z",
      metadata: {},
    }]),
  });
  const value = normalizeFeatureValueRow({
    feature_value_id: "77777777-7777-4777-8777-777777777777",
    feature_key: "atr_14",
    feature_version: "1.0.0",
    dataset_key: "dataset-1",
    cutoff_utc: "2026-08-09T08:00:00.000Z",
    cutoff_paris: "2026-08-09T10:00:00+02:00",
    entity_key: "MNQ",
    observed_at_utc: "2026-08-09T07:59:00.000Z",
    available_at_utc: "2026-08-09T08:00:00.000Z",
    quality: "OK",
    value_numeric: "12.25",
  });

  assert.equal(definition.versions[0].status, "PUBLISHED");
  assert.equal(definition.published_version.version, "1.0.0");
  assert.equal(value.dataset_cutoff_paris, "2026-08-09T10:00:00+02:00");
  assert.equal(value.value_numeric, 12.25);
  assert.equal(toSqlDatasetStatus("ready"), "READY");
  assert.equal(toSqlFeatureComputationStatus("completed"), "COMPLETED");

  const marketProfile = normalizeMarketDataCapabilityProfileRow({
    market_data_capability_profile_id: "88888888-8888-4888-8888-888888888888",
    source_key: "prod__tradingview__MNQ1!__1",
    instrument_code: "MNQ1!",
    provider: "tradingview",
    environment: "prod",
    timeframe: "1",
    timeframe_seconds: "60",
    status: "PARTIAL",
    blocking_classification: "NON_BLOCKING",
    observed_row_count: "42",
    has_ohlcv: true,
    has_volume: true,
    measured_capabilities: ["ohlcv", "volume"],
    missing_capabilities: ["bid", "ask"],
    profiled_at_utc: "2026-08-09T08:00:00.000Z",
  });
  assert.equal(marketProfile.observed_row_count, 42);
  assert.equal(marketProfile.has_ohlcv, true);
  assert.deepEqual(marketProfile.missing_capabilities, ["bid", "ask"]);

  const storageObject = normalizeMarketDataStorageObjectRow({
    market_data_storage_object_id: "99999999-9999-4999-8999-999999999999",
    object_key: "cold/mnq.parquet",
    storage_tier: "COLD_PARQUET",
    storage_format: "PARQUET",
    status: "PLANNED",
    uri: "file://./data/object-storage/market-data/cold/mnq.parquet",
    source_key: "prod__tradingview__MNQ1!__1",
    provider: "tradingview",
    environment: "prod",
    instrument_code: "MNQ1!",
    timeframe: "1",
    partition_grain: "day",
    schema_version: "market_data_raw_v1",
    record_count: "42",
    byte_size: "2048",
  });
  const hotWindow = normalizeMarketDataHotSeriesWindowRow({
    hot_series_window_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    source_key: "prod__tradingview__MNQ1!__1",
    provider: "tradingview",
    environment: "prod",
    instrument_code: "MNQ1!",
    timeframe: "1",
    hot_table: "market_candles",
    window_start_utc: "2026-06-01T00:00:00.000Z",
    window_end_utc: "2026-06-30T21:45:00.000Z",
    retention_days: "45",
    row_count: "42",
    status: "ACTIVE",
  });
  assert.equal(storageObject.byte_size, 2048);
  assert.equal(hotWindow.retention_days, 45);
});
