import assert from "node:assert/strict";
import test from "node:test";
import {
  DataFoundationService,
  InMemoryDataFoundationRepository,
  normalizeFilters,
} from "../src/data-foundation-service.js";

const NOW = "2026-08-09T08:00:00.000Z";

test("Data Foundation service exposes controlled overview without direct table access", async () => {
  const repository = new InMemoryDataFoundationRepository({
    sources: [sourceFixture()],
    datasets: [datasetFixture()],
    features: [featureFixture()],
    featureValues: [featureValueFixture()],
    featureComputations: [computationFixture()],
  });
  const service = serviceFor(repository);

  const overview = await service.getOverview({ audience: "agent", limit: 999 });

  assert.equal(overview.generated_at_utc, NOW);
  assert.equal(overview.audience, "agent");
  assert.equal(overview.source.canonical, "data_foundation_v1");
  assert.equal(overview.source.storage, "postgres");
  assert.equal(overview.source.direct_table_access, false);
  assert.equal(overview.counts.data_sources, 1);
  assert.equal(overview.recent_datasets[0].dataset_key, "mnq-2026-06-11-cutoff");
  assert.equal(repository.calls[0][0], "getCatalogOverview");
  assert.equal(repository.calls[0][1].limit, 500);
});

test("Data Foundation service filters datasets, feature definitions and feature values", async () => {
  const repository = new InMemoryDataFoundationRepository({
    datasets: [
      datasetFixture(),
      datasetFixture({ dataset_key: "legacy", status: "ARCHIVED" }),
    ],
    lineage: [lineageFixture()],
    features: [
      featureFixture(),
      featureFixture({ feature_key: "session_vwap", category: "price" }),
    ],
    marketDataProfiles: [
      marketDataProfileFixture(),
      marketDataProfileFixture({ instrument_code: "MES1!", status: "MEASURED", blocking_classification: "NON_BLOCKING" }),
    ],
    storageObjects: [
      storageObjectFixture(),
      storageObjectFixture({ object_key: "cold/mes.parquet", instrument_code: "MES1!", storage_tier: "HOT_AND_COLD" }),
    ],
    hotSeriesWindows: [
      hotSeriesWindowFixture(),
      hotSeriesWindowFixture({ hot_series_window_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", instrument_code: "MES1!" }),
    ],
    featureValues: [
      featureValueFixture(),
      featureValueFixture({ feature_key: "session_vwap", timeframe: "M1" }),
    ],
  });
  const service = serviceFor(repository);

  const datasets = await service.listDatasets({ audience: "simulation", status: "READY", dataset_key: "mnq-2026-06-11-cutoff" });
  const features = await service.listFeatureDefinitions({ audience: "front", category: "volatility" });
  const marketProfiles = await service.listMarketDataCapabilityProfiles({ audience: "front", instrument_code: "MNQ1!", status: "PARTIAL", blocking_classification: "NON_BLOCKING" });
  const storageObjects = await service.listMarketDataStorageObjects({ audience: "front", instrument_code: "MNQ1!", storage_tier: "HOT_SERIES" });
  const hotWindows = await service.listMarketDataHotSeriesWindows({ audience: "front", instrument_code: "MNQ1!", status: "ACTIVE" });
  const values = await service.listFeatureValues({ audience: "operator", feature_key: "atr_14", dataset_key: "mnq-2026-06-11-cutoff", timeframe: "M15" });

  assert.equal(datasets.items.length, 1);
  assert.equal(datasets.lineage.length, 1);
  assert.equal(features.items.length, 1);
  assert.equal(features.items[0].published_version.version, "1.0.0");
  assert.equal(marketProfiles.items.length, 1);
  assert.equal(marketProfiles.items[0].missing_capabilities.includes("bid"), true);
  assert.equal(storageObjects.items.length, 1);
  assert.equal(storageObjects.items[0].uri.endsWith("mnq.parquet"), true);
  assert.equal(hotWindows.items.length, 1);
  assert.equal(hotWindows.items[0].hot_table, "market_candles");
  assert.equal(values.items.length, 1);
  assert.equal(values.items[0].dataset_cutoff_paris, "2026-06-11T21:45:00+02:00");
});

test("Data Foundation service rejects unauthorized audiences with Problem Details", async () => {
  const service = serviceFor(new InMemoryDataFoundationRepository());

  await assert.rejects(
    () => service.listDataSources({ audience: "public" }),
    (error) => {
      assert.equal(error.code, "DESK_FORBIDDEN");
      assert.equal(error.statusCode, 403);
      assert.equal(error.problem.schema_version, "desk_problem_details_v1");
      assert.equal(error.problem.status, 403);
      assert.equal(error.problem.code, "DESK_FORBIDDEN");
      return true;
    },
  );
});

test("Data Foundation query normalization preserves canonical filters and bounds limits", () => {
  assert.deepEqual(normalizeFilters({
    audience: "AGENT",
    kind: "market_ohlcv",
    datasetKey: "dataset-1",
    featureKey: "atr_14",
    entityKey: "MNQ",
    instrumentCode: "MNQ1!",
    blockingClassification: "NON_BLOCKING",
    storageTier: "hot_series",
    storageFormat: "parquet",
    limit: 10_000,
  }), {
    audience: "agent",
    actor: null,
    status: null,
    kind: "MARKET_OHLCV",
    provider: null,
    environment: null,
    dataSourceId: null,
    sourceKey: null,
    datasetId: null,
    datasetKey: "dataset-1",
    featureKey: "atr_14",
    category: null,
    entityKey: "MNQ",
    instrumentCode: "MNQ1!",
    timeframe: null,
    blockingClassification: "NON_BLOCKING",
    storageTier: "hot_series",
    storageFormat: "parquet",
    fromUtc: null,
    toUtc: null,
    limit: 500,
  });
});

function serviceFor(repository) {
  return new DataFoundationService({
    repository,
    clock: { now: () => ({ utc: NOW }) },
  });
}

function sourceFixture(overrides = {}) {
  return {
    data_source_id: "11111111-1111-4111-8111-111111111111",
    source_key: "tradingview.mnq.m1",
    name: "TradingView MNQ M1",
    kind: "MARKET_OHLCV",
    provider: "tradingview",
    format: "json",
    frequency: "M1",
    freshness_sla_seconds: 90,
    status: "ACTIVE",
    environment: "preprod",
    ...overrides,
  };
}

function datasetFixture(overrides = {}) {
  return {
    dataset_id: "22222222-2222-4222-8222-222222222222",
    dataset_key: "mnq-2026-06-11-cutoff",
    name: "MNQ 2026-06-11 cutoff",
    status: "READY",
    cutoff_utc: "2026-06-11T19:45:00.000Z",
    cutoff_paris: "2026-06-11T21:45:00+02:00",
    schema_version: "dataset_v1",
    source_batch_count: 1,
    content_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    provenance_hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ...overrides,
  };
}

function lineageFixture(overrides = {}) {
  return {
    dataset_id: "22222222-2222-4222-8222-222222222222",
    dataset_key: "mnq-2026-06-11-cutoff",
    ingestion_batch_id: "33333333-3333-4333-8333-333333333333",
    batch_key: "tv-mnq-2026-06-11",
    ordinal: 1,
    role: "source",
    source_key: "tradingview.mnq.m1",
    ...overrides,
  };
}

function featureFixture(overrides = {}) {
  return {
    feature_definition_id: "44444444-4444-4444-8444-444444444444",
    feature_key: "atr_14",
    name: "ATR 14",
    category: "volatility",
    output_kind: "SERIES",
    status: "ACTIVE",
    versions: [{
      feature_version_id: "55555555-5555-4555-8555-555555555555",
      version: "1.0.0",
      status: "PUBLISHED",
      formula_ref: "feature://atr/wilder/14",
      formula_hash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      deterministic: true,
      point_in_time_safe: true,
    }],
    published_version: {
      feature_version_id: "55555555-5555-4555-8555-555555555555",
      version: "1.0.0",
      status: "PUBLISHED",
    },
    ...overrides,
  };
}

function computationFixture(overrides = {}) {
  return {
    feature_computation_run_id: "66666666-6666-4666-8666-666666666666",
    feature_key: "atr_14",
    dataset_key: "mnq-2026-06-11-cutoff",
    status: "COMPLETED",
    parameters_hash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    row_count: 42,
    ...overrides,
  };
}

function featureValueFixture(overrides = {}) {
  return {
    feature_value_id: "77777777-7777-4777-8777-777777777777",
    feature_key: "atr_14",
    feature_version: "1.0.0",
    dataset_key: "mnq-2026-06-11-cutoff",
    dataset_cutoff_utc: "2026-06-11T19:45:00.000Z",
    dataset_cutoff_paris: "2026-06-11T21:45:00+02:00",
    entity_key: "MNQ",
    instrument_code: "MNQ",
    timeframe: "M15",
    observed_at_utc: "2026-06-11T07:15:00.000Z",
    available_at_utc: "2026-06-11T07:16:00.000Z",
    quality: "OK",
    value_numeric: 21.5,
    ...overrides,
  };
}

function marketDataProfileFixture(overrides = {}) {
  return {
    market_data_capability_profile_id: "88888888-8888-4888-8888-888888888888",
    source_key: "prod__tradingview__MNQ1!__1",
    instrument_code: "MNQ1!",
    provider: "tradingview",
    environment: "prod",
    timeframe: "1",
    status: "PARTIAL",
    blocking_classification: "NON_BLOCKING",
    storage_recommendation: "HOT_SERIES",
    observed_row_count: 100,
    measured_capabilities: ["ohlcv", "volume"],
    missing_capabilities: ["tick", "bid", "ask", "open_interest"],
    ...overrides,
  };
}

function storageObjectFixture(overrides = {}) {
  return {
    market_data_storage_object_id: "99999999-9999-4999-8999-999999999999",
    object_key: "hot/mnq.parquet",
    source_key: "prod__tradingview__MNQ1!__1",
    instrument_code: "MNQ1!",
    provider: "tradingview",
    environment: "prod",
    timeframe: "1",
    storage_tier: "HOT_SERIES",
    storage_format: "PARQUET",
    status: "ACTIVE",
    uri: "file://./data/object-storage/market-data/hot/mnq.parquet",
    schema_version: "market_data_raw_v1",
    record_count: 100,
    byte_size: 8000,
    ...overrides,
  };
}

function hotSeriesWindowFixture(overrides = {}) {
  return {
    hot_series_window_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    source_key: "prod__tradingview__MNQ1!__1",
    instrument_code: "MNQ1!",
    provider: "tradingview",
    environment: "prod",
    timeframe: "1",
    hot_table: "market_candles",
    window_start_utc: "2026-06-01T00:00:00.000Z",
    window_end_utc: "2026-06-30T21:45:00.000Z",
    latest_timestamp_utc: "2026-06-30T21:45:00.000Z",
    retention_days: 45,
    row_count: 100,
    status: "ACTIVE",
    ...overrides,
  };
}
