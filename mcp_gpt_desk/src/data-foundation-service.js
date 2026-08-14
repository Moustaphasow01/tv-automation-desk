import { problemDetailsFromError } from "@tv-automation/desk-domain";
import { SystemClock } from "@tv-automation/desk-time";

const ALLOWED_AUDIENCES = new Set(["front", "simulation", "agent", "operator"]);

export class DataFoundationService {
  constructor({ repository, clock } = {}) {
    this.repository = repository;
    this.clock = clock || new SystemClock();
  }

  async getOverview(filters = {}) {
    return this.#guardedRead(filters, async (normalized) => ({
      generated_at_utc: this.#nowUtc(),
      audience: normalized.audience,
      source: sourceDescriptor(),
      ...(await this.repository.getCatalogOverview(normalized)),
    }));
  }

  async listDataSources(filters = {}) {
    return this.#guardedRead(filters, async (normalized) => ({
      generated_at_utc: this.#nowUtc(),
      audience: normalized.audience,
      source: sourceDescriptor(),
      items: await this.repository.listDataSources(normalized),
    }));
  }

  async listIngestionBatches(filters = {}) {
    return this.#guardedRead(filters, async (normalized) => ({
      generated_at_utc: this.#nowUtc(),
      audience: normalized.audience,
      source: sourceDescriptor(),
      items: await this.repository.listIngestionBatches(normalized),
    }));
  }

  async listDatasets(filters = {}) {
    return this.#guardedRead(filters, async (normalized) => {
      const [datasets, lineage] = await Promise.all([
        this.repository.listDatasets(normalized),
        this.repository.listDatasetLineage(normalized),
      ]);
      return {
        generated_at_utc: this.#nowUtc(),
        audience: normalized.audience,
        source: sourceDescriptor(),
        items: datasets,
        lineage,
      };
    });
  }

  async listFeatureDefinitions(filters = {}) {
    return this.#guardedRead(filters, async (normalized) => ({
      generated_at_utc: this.#nowUtc(),
      audience: normalized.audience,
      source: sourceDescriptor(),
      items: await this.repository.listFeatureDefinitions(normalized),
    }));
  }

  async listFeatureValues(filters = {}) {
    return this.#guardedRead(filters, async (normalized) => ({
      generated_at_utc: this.#nowUtc(),
      audience: normalized.audience,
      source: sourceDescriptor(),
      items: await this.repository.listFeatureValues(normalized),
    }));
  }

  async listFeatureComputationRuns(filters = {}) {
    return this.#guardedRead(filters, async (normalized) => ({
      generated_at_utc: this.#nowUtc(),
      audience: normalized.audience,
      source: sourceDescriptor(),
      items: await this.repository.listFeatureComputationRuns(normalized),
    }));
  }

  async listMarketDataCapabilityProfiles(filters = {}) {
    return this.#guardedRead(filters, async (normalized) => ({
      generated_at_utc: this.#nowUtc(),
      audience: normalized.audience,
      source: sourceDescriptor(),
      items: await this.repository.listMarketDataCapabilityProfiles(normalized),
    }));
  }

  async listMarketDataStorageObjects(filters = {}) {
    return this.#guardedRead(filters, async (normalized) => ({
      generated_at_utc: this.#nowUtc(),
      audience: normalized.audience,
      source: sourceDescriptor(),
      items: await this.repository.listMarketDataStorageObjects(normalized),
    }));
  }

  async listMarketDataHotSeriesWindows(filters = {}) {
    return this.#guardedRead(filters, async (normalized) => ({
      generated_at_utc: this.#nowUtc(),
      audience: normalized.audience,
      source: sourceDescriptor(),
      items: await this.repository.listMarketDataHotSeriesWindows(normalized),
    }));
  }

  async #guardedRead(filters, operation) {
    try {
      const normalized = normalizeFilters(filters);
      if (!ALLOWED_AUDIENCES.has(normalized.audience)) {
        throw serviceError("DESK_FORBIDDEN", `Data Foundation audience is not allowed: ${normalized.audience}.`, 403, {
          allowed_audiences: [...ALLOWED_AUDIENCES],
          supplied_audience: normalized.audience,
        });
      }
      return await operation(normalized);
    } catch (error) {
      throw withProblemDetails(error);
    }
  }

  #nowUtc() {
    const now = this.clock?.now?.();
    if (typeof now === "string") return new Date(now).toISOString();
    if (now?.utc) return new Date(now.utc).toISOString();
    return new SystemClock().now().utc;
  }
}

export class InMemoryDataFoundationRepository {
  constructor(seed = {}) {
    this.overview = seed.overview || {};
    this.sources = seed.sources || [];
    this.ingestionBatches = seed.ingestionBatches || [];
    this.datasets = seed.datasets || [];
    this.lineage = seed.lineage || [];
    this.features = seed.features || [];
    this.featureValues = seed.featureValues || [];
    this.featureComputations = seed.featureComputations || [];
    this.marketDataProfiles = seed.marketDataProfiles || [];
    this.storageObjects = seed.storageObjects || [];
    this.hotSeriesWindows = seed.hotSeriesWindows || [];
    this.calls = [];
  }

  async getCatalogOverview(filters = {}) {
    this.calls.push(["getCatalogOverview", clone(filters)]);
    return clone({
      counts: this.overview.counts || {
        data_sources: this.sources.length,
        datasets: this.datasets.length,
        feature_definitions: this.features.length,
        feature_value_points: this.featureValues.length,
        market_data_capability_profiles: this.marketDataProfiles.length,
        market_data_storage_objects: this.storageObjects.length,
        market_data_hot_series_windows: this.hotSeriesWindows.length,
      },
      recent_sources: this.sources,
      recent_datasets: this.datasets,
      feature_catalog: this.features,
      recent_feature_computations: this.featureComputations,
    });
  }

  async listDataSources(filters = {}) {
    this.calls.push(["listDataSources", clone(filters)]);
    return filtered(this.sources, filters, {
      status: "status",
      kind: "kind",
      provider: "provider",
      environment: "environment",
    });
  }

  async listIngestionBatches(filters = {}) {
    this.calls.push(["listIngestionBatches", clone(filters)]);
    return filtered(this.ingestionBatches, filters, {
      status: "status",
      sourceKey: "source_key",
      dataSourceId: "data_source_id",
    });
  }

  async listDatasets(filters = {}) {
    this.calls.push(["listDatasets", clone(filters)]);
    return filtered(this.datasets, filters, {
      status: "status",
      datasetKey: "dataset_key",
    });
  }

  async listDatasetLineage(filters = {}) {
    this.calls.push(["listDatasetLineage", clone(filters)]);
    return filtered(this.lineage, filters, {
      datasetKey: "dataset_key",
      datasetId: "dataset_id",
    });
  }

  async listFeatureDefinitions(filters = {}) {
    this.calls.push(["listFeatureDefinitions", clone(filters)]);
    return filtered(this.features, filters, {
      status: "status",
      category: "category",
    });
  }

  async listFeatureValues(filters = {}) {
    this.calls.push(["listFeatureValues", clone(filters)]);
    return filtered(this.featureValues, filters, {
      featureKey: "feature_key",
      datasetKey: "dataset_key",
      entityKey: "entity_key",
      instrumentCode: "instrument_code",
      timeframe: "timeframe",
    });
  }

  async listFeatureComputationRuns(filters = {}) {
    this.calls.push(["listFeatureComputationRuns", clone(filters)]);
    return filtered(this.featureComputations, filters, {
      featureKey: "feature_key",
      datasetKey: "dataset_key",
      status: "status",
    });
  }

  async listMarketDataCapabilityProfiles(filters = {}) {
    this.calls.push(["listMarketDataCapabilityProfiles", clone(filters)]);
    return filtered(this.marketDataProfiles, filters, {
      sourceKey: "source_key",
      instrumentCode: "instrument_code",
      timeframe: "timeframe",
      status: "status",
      blockingClassification: "blocking_classification",
    });
  }

  async listMarketDataStorageObjects(filters = {}) {
    this.calls.push(["listMarketDataStorageObjects", clone(filters)]);
    return filtered(this.storageObjects, filters, {
      sourceKey: "source_key",
      instrumentCode: "instrument_code",
      timeframe: "timeframe",
      storageTier: "storage_tier",
      storageFormat: "storage_format",
      status: "status",
    });
  }

  async listMarketDataHotSeriesWindows(filters = {}) {
    this.calls.push(["listMarketDataHotSeriesWindows", clone(filters)]);
    return filtered(this.hotSeriesWindows, filters, {
      sourceKey: "source_key",
      instrumentCode: "instrument_code",
      timeframe: "timeframe",
      status: "status",
    });
  }
}

export function normalizeFilters(input = {}) {
  const limit = bounded(input.limit, input.defaultLimit || 100, input.maxLimit || 500);
  return {
    audience: String(input.audience || "front").toLowerCase(),
    actor: input.actor || null,
    status: nullable(input.status),
    kind: input.kind ? String(input.kind).toUpperCase() : null,
    provider: nullable(input.provider),
    environment: nullable(input.environment),
    dataSourceId: nullable(input.data_source_id || input.dataSourceId),
    sourceKey: nullable(input.source_key || input.sourceKey),
    datasetId: nullable(input.dataset_id || input.datasetId),
    datasetKey: nullable(input.dataset_key || input.datasetKey),
    featureKey: nullable(input.feature_key || input.featureKey),
    category: nullable(input.category),
    entityKey: nullable(input.entity_key || input.entityKey),
    instrumentCode: nullable(input.instrument_code || input.instrumentCode),
    timeframe: nullable(input.timeframe),
    blockingClassification: nullable(input.blocking_classification || input.blockingClassification),
    storageTier: nullable(input.storage_tier || input.storageTier),
    storageFormat: nullable(input.storage_format || input.storageFormat),
    fromUtc: nullable(input.from_utc || input.fromUtc),
    toUtc: nullable(input.to_utc || input.toUtc),
    limit,
  };
}

export function dataFoundationProblem(code, message, statusCode = 500, details = {}) {
  return withProblemDetails(serviceError(code, message, statusCode, details));
}

function sourceDescriptor() {
  return {
    canonical: "data_foundation_v1",
    storage: "postgres",
    direct_table_access: false,
    contracts: {
      data_source: "DeskDataSourceContract_v1",
      dataset: "DeskDatasetContract_v1",
      feature_definition: "DeskFeatureDefinitionContract_v1",
      feature_value: "DeskFeatureValueContract_v1",
    },
  };
}

function serviceError(code, message, statusCode, details = {}) {
  const error = new Error(message || code);
  error.code = code;
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function withProblemDetails(error) {
  if (!error.problem) {
    error.problem = problemDetailsFromError(error, {
      fallbackCode: error.code || "DESK_INTERNAL_ERROR",
      includeTechnicalDetails: true,
    });
  }
  return error;
}

function filtered(items = [], filters = {}, mapping = {}) {
  const limit = bounded(filters.limit);
  return clone(items)
    .filter((item) => Object.entries(mapping).every(([filterKey, itemKey]) => {
      if (filters[filterKey] === null || filters[filterKey] === undefined || filters[filterKey] === "") return true;
      return String(item[itemKey] || "").toUpperCase() === String(filters[filterKey]).toUpperCase();
    }))
    .slice(0, limit);
}

function nullable(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function bounded(value, fallback = 100, max = 500) {
  const parsed = Number(value);
  return Math.max(1, Math.min(Number.isFinite(parsed) ? Math.trunc(parsed) : fallback, max));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}
