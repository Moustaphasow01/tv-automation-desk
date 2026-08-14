import { describe, expect, it } from "vitest";
import { buildDataFoundationViewModel } from "@/features/data-foundation/viewModel";
import type {
  DataFoundationDataset,
  DataFoundationEnvelope,
  DataFoundationFeature,
  DataFoundationHotSeriesWindow,
  DataFoundationMarketProfile,
  DataFoundationStorageObject,
} from "@/operationsTypes";

describe("Data Foundation ViewModel", () => {
  it("traduit couverture, lineage et features en libellés opérateur", () => {
    const view = buildDataFoundationViewModel({
      overview: overviewFixture(),
      datasets: envelope([datasetFixture()], { lineage: [lineageFixture()] }),
      features: envelope([featureFixture()]),
      marketProfiles: envelope([marketProfileFixture()]),
      storageObjects: envelope([storageObjectFixture()]),
      hotSeriesWindows: envelope([hotWindowFixture()]),
    });

    expect(view.sourceLabel).toBe("data_foundation_v1 · POSTGRES");
    expect(view.directTableAccess).toBe(false);
    expect(view.metrics.find(metric => metric.label === "Accès direct table")?.value).toBe("Non");
    expect(view.datasetRows[0].label).toBe("Mnq 2026-06-11 Cutoff");
    expect(view.datasetRows[0].lineage).toContain("Tradingview Mnq M1");
    expect(view.featureRows[0].label).toBe("VWAP de session");
    expect(view.featureRows[0].lineage).toContain("MNQ M1");
    expect(view.coverageRows[0].label).toBe("MNQ1 · M1");
    expect(view.coverageRows[0].state).toBe("Dégradé");
    expect(view.coverageRows[0].missing).toContain("Bid");
    expect(view.storageRows[0].tier).toBe("Chaud + froid");
    expect(view.hotRows[0].backingObject).toContain("Tier=Hot");
    expect(view.warnings).toEqual([]);
  });

  it("remonte les états bloquants sans masquer les vides réels", () => {
    const view = buildDataFoundationViewModel({
      overview: { ...overviewFixture(), source: { canonical: "data_foundation_v1", storage: "postgres", direct_table_access: true } },
      features: envelope([]),
      marketProfiles: envelope([marketProfileFixture({ status: "MISSING", blocking_classification: "BLOCKING", blocking_missing_capabilities: ["ohlcv"], missing_capabilities: ["ohlcv", "volume"] })]),
    });

    expect(view.metrics.find(metric => metric.label === "Couverture bloquante")?.tone).toBe("critical");
    expect(view.metrics.find(metric => metric.label === "Accès direct table")?.tone).toBe("critical");
    expect(view.coverageRows[0].state).toBe("Bloquant");
    expect(view.warnings).toContain("Le front lit un endpoint qui annonce un accès direct table : à corriger.");
    expect(view.warnings).toContain("1 source(s) market data bloquante(s).");
    expect(view.warnings).toContain("Aucune feature publiée visible depuis l’API Data Foundation.");
  });
});

function envelope<T>(items: T[], extras: Partial<DataFoundationEnvelope<T>> = {}): DataFoundationEnvelope<T> {
  return {
    contract: "DeskDataFoundationList",
    schemaVersion: "data_foundation_rest_v1",
    generated_at_utc: "2026-08-09T08:00:00.000Z",
    audience: "front",
    source: { canonical: "data_foundation_v1", storage: "postgres", direct_table_access: false },
    items,
    count: items.length,
    ...extras,
  };
}

function overviewFixture(): DataFoundationEnvelope {
  return {
    ...envelope([]),
    counts: {
      ready_datasets: 1,
      feature_definitions: 1,
      published_feature_versions: 1,
      market_data_storage_objects: 1,
      market_data_hot_series_windows: 1,
    },
  };
}

function datasetFixture(): DataFoundationDataset {
  return {
    dataset_id: "dataset-1",
    dataset_key: "mnq-2026-06-11-cutoff",
    name: "MNQ 2026-06-11 cutoff",
    status: "READY",
    cutoff_utc: "2026-06-11T19:45:00.000Z",
    cutoff_paris: "2026-06-11T21:45:00+02:00",
    source_batch_count: 1,
    content_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    provenance_hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  };
}

function lineageFixture() {
  return {
    dataset_id: "dataset-1",
    dataset_key: "mnq-2026-06-11-cutoff",
    ingestion_batch_id: "batch-1",
    batch_key: "tv-mnq-2026-06-11",
    ordinal: 1,
    role: "source",
    source_key: "tradingview.mnq.m1",
  };
}

function featureFixture(): DataFoundationFeature {
  return {
    feature_definition_id: "feature-1",
    feature_key: "session_vwap",
    name: "Session VWAP",
    category: "price",
    output_kind: "SERIES",
    status: "ACTIVE",
    published_version: {
      feature_version_id: "version-1",
      version: "1.0.0",
      status: "PUBLISHED",
      metadata: {
        required_datasets: ["MNQ_M1", "MES_M1"],
        cutoff_policy: "session_cutoff_closed_bars",
      },
    },
  };
}

function marketProfileFixture(overrides: Partial<DataFoundationMarketProfile> = {}): DataFoundationMarketProfile {
  return {
    market_data_capability_profile_id: "profile-1",
    source_key: "prod__tradingview__MNQ1!__1",
    instrument_code: "MNQ1!",
    provider: "tradingview",
    environment: "prod",
    timeframe: "1",
    status: "PARTIAL",
    blocking_classification: "NON_BLOCKING",
    storage_recommendation: "HOT_SERIES",
    observed_row_count: 120,
    missing_capabilities: ["bid", "ask"],
    blocking_missing_capabilities: [],
    non_blocking_missing_capabilities: ["bid", "ask"],
    recommendation: "Microstructure manquante, non bloquante.",
    ...overrides,
  };
}

function storageObjectFixture(): DataFoundationStorageObject {
  return {
    market_data_storage_object_id: "object-1",
    object_key: "tier=hot_and_cold/provider=tradingview/instrument=MNQ/date=2026-06-11/part.parquet",
    storage_tier: "HOT_AND_COLD",
    storage_format: "PARQUET",
    status: "ACTIVE",
    uri: "file://./data/object-storage/market-data/tier=hot_and_cold/part.parquet",
    source_key: "prod__tradingview__MNQ1!__1",
    instrument_code: "MNQ1!",
    timeframe: "1",
    record_count: 120,
    byte_size: 4096,
    retention_days: 1825,
  };
}

function hotWindowFixture(): DataFoundationHotSeriesWindow {
  return {
    hot_series_window_id: "hot-1",
    source_key: "prod__tradingview__MNQ1!__1",
    instrument_code: "MNQ1!",
    timeframe: "1",
    hot_table: "market_candles",
    status: "ACTIVE",
    latest_timestamp_utc: "2026-06-11T19:45:00.000Z",
    retention_days: 45,
    row_count: 120,
    object_key: "tier=hot/provider=tradingview/instrument=MNQ/date=2026-06-11/part.parquet",
  };
}
