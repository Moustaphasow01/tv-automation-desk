const DATA_SOURCE_STATUS_TO_SQL = Object.freeze({
  ACTIVE: "ACTIVE",
  DEPRECATED: "DEPRECATED",
});

const DATASET_STATUS_TO_SQL = Object.freeze({
  BUILDING: "BUILDING",
  READY: "READY",
  ARCHIVED: "ARCHIVED",
});

const FEATURE_DEFINITION_STATUS_TO_SQL = Object.freeze({
  ACTIVE: "ACTIVE",
  DEPRECATED: "DEPRECATED",
});

const FEATURE_VERSION_STATUS_TO_SQL = Object.freeze({
  DRAFT: "DRAFT",
  VALIDATED: "VALIDATED",
  PUBLISHED: "PUBLISHED",
  DEPRECATED: "DEPRECATED",
});

const FEATURE_COMPUTATION_STATUS_TO_SQL = Object.freeze({
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
});

export class PostgresDataFoundationRepository {
  constructor(persistence) {
    this.persistence = persistence;
    this.pool = persistence?.pool || null;
  }

  get available() { return Boolean(this.pool); }

  async ready() {
    if (!this.pool) {
      throw repositoryError("DESK_DEPENDENCY_UNAVAILABLE", "PostgreSQL Data Foundation repository is unavailable.");
    }
    await this.persistence.initialized;
  }

  async getCatalogOverview({ limit = 25 } = {}) {
    await this.ready();
    const boundedLimit = bounded(limit, 25, 100);
    const [counts, sources, datasets, features, computations] = await Promise.all([
      one(this.pool, `SELECT
          (SELECT count(*)::int FROM data_sources) AS data_sources,
          (SELECT count(*)::int FROM data_sources WHERE status = 'ACTIVE') AS active_data_sources,
          (SELECT count(*)::int FROM ingestion_batches) AS ingestion_batches,
          (SELECT count(*)::int FROM ingestion_batches WHERE status = 'FAILED') AS failed_ingestion_batches,
          (SELECT count(*)::int FROM datasets) AS datasets,
          (SELECT count(*)::int FROM datasets WHERE status = 'READY') AS ready_datasets,
          (SELECT count(*)::int FROM feature_definitions) AS feature_definitions,
          (SELECT count(*)::int FROM feature_versions WHERE status = 'PUBLISHED') AS published_feature_versions,
          (SELECT count(*)::int FROM feature_computation_runs) AS feature_computation_runs,
          (SELECT count(*)::int FROM feature_value_points) AS feature_value_points,
          (SELECT count(*)::int FROM market_data_capability_profiles) AS market_data_capability_profiles,
          (SELECT count(*)::int FROM market_data_storage_objects) AS market_data_storage_objects,
          (SELECT count(*)::int FROM market_data_hot_series_windows) AS market_data_hot_series_windows`),
      this.listDataSources({ limit: boundedLimit }),
      this.listDatasets({ limit: boundedLimit }),
      this.listFeatureDefinitions({ limit: boundedLimit }),
      this.listFeatureComputationRuns({ limit: boundedLimit }),
    ]);
    return {
      counts: counts || {},
      recent_sources: sources,
      recent_datasets: datasets,
      feature_catalog: features,
      recent_feature_computations: computations,
    };
  }

  async listDataSources({ status = null, kind = null, provider = null, environment = null, limit = 100 } = {}) {
    await this.ready();
    return rows(this.pool, `SELECT *
      FROM data_sources
      WHERE ($1::data_source_status IS NULL OR status = $1::data_source_status)
        AND ($2::data_source_kind IS NULL OR kind = $2::data_source_kind)
        AND ($3::text IS NULL OR provider = $3)
        AND ($4::desk_data_environment IS NULL OR environment = $4::desk_data_environment)
      ORDER BY updated_at_utc DESC, created_at_utc DESC
      LIMIT $5`, [
      toSqlDataSourceStatus(status),
      kind ? String(kind).toUpperCase() : null,
      emptyToNull(provider),
      emptyToNull(environment),
      bounded(limit),
    ]).then((items) => items.map(normalizeDataSourceRow));
  }

  async listIngestionBatches({ dataSourceId = null, sourceKey = null, status = null, limit = 100 } = {}) {
    await this.ready();
    return rows(this.pool, `SELECT ib.*, ds.source_key, ds.kind AS source_kind, ds.provider AS source_provider
      FROM ingestion_batches ib
      JOIN data_sources ds ON ds.data_source_id = ib.data_source_id
      WHERE ($1::uuid IS NULL OR ib.data_source_id = $1)
        AND ($2::text IS NULL OR ds.source_key = $2)
        AND ($3::ingestion_batch_status IS NULL OR ib.status = $3::ingestion_batch_status)
      ORDER BY ib.ingested_at_utc DESC, ib.created_at_utc DESC
      LIMIT $4`, [
      emptyToNull(dataSourceId),
      emptyToNull(sourceKey),
      status ? String(status).toUpperCase() : null,
      bounded(limit),
    ]).then((items) => items.map(normalizeIngestionBatchRow));
  }

  async listDatasets({ status = null, datasetKey = null, limit = 100 } = {}) {
    await this.ready();
    return rows(this.pool, `SELECT *
      FROM datasets
      WHERE ($1::dataset_status IS NULL OR status = $1::dataset_status)
        AND ($2::text IS NULL OR dataset_key = $2)
      ORDER BY cutoff_utc DESC NULLS LAST, updated_at_utc DESC
      LIMIT $3`, [
      toSqlDatasetStatus(status),
      emptyToNull(datasetKey),
      bounded(limit),
    ]).then((items) => items.map(normalizeDatasetRow));
  }

  async listDatasetLineage({ datasetId = null, datasetKey = null, limit = 200 } = {}) {
    await this.ready();
    return rows(this.pool, `SELECT
        dib.*,
        d.dataset_key,
        d.cutoff_utc,
        d.cutoff_paris,
        ib.batch_key,
        ib.status AS ingestion_status,
        ib.content_hash AS ingestion_content_hash,
        ib.provenance_hash AS ingestion_provenance_hash,
        ds.source_key,
        ds.kind AS source_kind,
        ds.provider AS source_provider
      FROM dataset_ingestion_batches dib
      JOIN datasets d ON d.dataset_id = dib.dataset_id
      JOIN ingestion_batches ib ON ib.ingestion_batch_id = dib.ingestion_batch_id
      JOIN data_sources ds ON ds.data_source_id = ib.data_source_id
      WHERE ($1::uuid IS NULL OR dib.dataset_id = $1)
        AND ($2::text IS NULL OR d.dataset_key = $2)
      ORDER BY d.cutoff_utc DESC NULLS LAST, dib.ordinal
      LIMIT $3`, [
      emptyToNull(datasetId),
      emptyToNull(datasetKey),
      bounded(limit, 200, 1000),
    ]).then((items) => items.map(normalizeDatasetLineageRow));
  }

  async listFeatureDefinitions({ status = null, category = null, limit = 100 } = {}) {
    await this.ready();
    return rows(this.pool, `SELECT
        fd.*,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'feature_version_id', fv.feature_version_id,
              'version', fv.version,
              'status', fv.status,
              'formula_ref', fv.formula_ref,
              'formula_hash', fv.formula_hash,
              'deterministic', fv.deterministic,
              'point_in_time_safe', fv.point_in_time_safe,
              'min_dataset_schema_version', fv.min_dataset_schema_version,
              'published_at_utc', fv.published_at_utc,
              'deprecated_at_utc', fv.deprecated_at_utc,
              'created_at_utc', fv.created_at_utc,
              'updated_at_utc', fv.updated_at_utc,
              'metadata', fv.metadata
            )
            ORDER BY fv.created_at_utc DESC
          ) FILTER (WHERE fv.feature_version_id IS NOT NULL),
          '[]'::jsonb
        ) AS versions
      FROM feature_definitions fd
      LEFT JOIN feature_versions fv ON fv.feature_definition_id = fd.feature_definition_id
      WHERE ($1::feature_definition_status IS NULL OR fd.status = $1::feature_definition_status)
        AND ($2::text IS NULL OR fd.category = $2)
      GROUP BY fd.feature_definition_id
      ORDER BY fd.updated_at_utc DESC, fd.created_at_utc DESC
      LIMIT $3`, [
      toSqlFeatureDefinitionStatus(status),
      emptyToNull(category),
      bounded(limit),
    ]).then((items) => items.map(normalizeFeatureDefinitionRow));
  }

  async listFeatureComputationRuns({
    featureKey = null,
    datasetKey = null,
    status = null,
    limit = 100,
  } = {}) {
    await this.ready();
    return rows(this.pool, `SELECT
        fcr.*,
        fv.version AS feature_version,
        fv.status AS feature_version_status,
        fd.feature_key,
        fd.name AS feature_name,
        d.dataset_key,
        d.cutoff_utc,
        d.cutoff_paris
      FROM feature_computation_runs fcr
      JOIN feature_versions fv ON fv.feature_version_id = fcr.feature_version_id
      JOIN feature_definitions fd ON fd.feature_definition_id = fv.feature_definition_id
      JOIN datasets d ON d.dataset_id = fcr.dataset_id
      WHERE ($1::text IS NULL OR fd.feature_key = $1)
        AND ($2::text IS NULL OR d.dataset_key = $2)
        AND ($3::feature_computation_status IS NULL OR fcr.status = $3::feature_computation_status)
      ORDER BY fcr.completed_at_utc DESC NULLS LAST, fcr.started_at_utc DESC
      LIMIT $4`, [
      emptyToNull(featureKey),
      emptyToNull(datasetKey),
      toSqlFeatureComputationStatus(status),
      bounded(limit),
    ]).then((items) => items.map(normalizeFeatureComputationRow));
  }

  async listFeatureValues({
    featureKey = null,
    datasetKey = null,
    entityKey = null,
    instrumentCode = null,
    timeframe = null,
    fromUtc = null,
    toUtc = null,
    limit = 500,
  } = {}) {
    await this.ready();
    return rows(this.pool, `SELECT
        fvp.*,
        fcr.feature_computation_run_id,
        fcr.parameters_hash,
        fcr.output_hash,
        fcr.provenance_hash AS computation_provenance_hash,
        fv.feature_version_id,
        fv.version AS feature_version,
        fv.formula_hash,
        fd.feature_definition_id,
        fd.feature_key,
        fd.name AS feature_name,
        fd.output_kind,
        d.dataset_id,
        d.dataset_key,
        d.cutoff_utc,
        d.cutoff_paris,
        d.provenance_hash AS dataset_provenance_hash
      FROM feature_value_points fvp
      JOIN feature_computation_runs fcr ON fcr.feature_computation_run_id = fvp.feature_computation_run_id
      JOIN feature_versions fv ON fv.feature_version_id = fcr.feature_version_id
      JOIN feature_definitions fd ON fd.feature_definition_id = fv.feature_definition_id
      JOIN datasets d ON d.dataset_id = fcr.dataset_id
      WHERE ($1::text IS NULL OR fd.feature_key = $1)
        AND ($2::text IS NULL OR d.dataset_key = $2)
        AND ($3::text IS NULL OR fvp.entity_key = $3)
        AND ($4::text IS NULL OR fvp.instrument_code = $4)
        AND ($5::text IS NULL OR fvp.timeframe = $5)
        AND ($6::timestamptz IS NULL OR fvp.observed_at_utc >= $6::timestamptz)
        AND ($7::timestamptz IS NULL OR fvp.observed_at_utc <= $7::timestamptz)
      ORDER BY fvp.observed_at_utc DESC, fvp.created_at_utc DESC
      LIMIT $8`, [
      emptyToNull(featureKey),
      emptyToNull(datasetKey),
      emptyToNull(entityKey),
      emptyToNull(instrumentCode),
      emptyToNull(timeframe),
      emptyToNull(fromUtc),
      emptyToNull(toUtc),
      bounded(limit, 500, 5000),
    ]).then((items) => items.map(normalizeFeatureValueRow));
  }

  async listMarketDataCapabilityProfiles({
    sourceKey = null,
    instrumentCode = null,
    timeframe = null,
    status = null,
    blockingClassification = null,
    limit = 500,
  } = {}) {
    await this.ready();
    return rows(this.pool, `SELECT p.*, r.run_key, r.as_of_utc AS run_as_of_utc, r.source_profile_ref
      FROM market_data_capability_profiles p
      LEFT JOIN market_data_capability_profile_runs r
        ON r.capability_profile_run_id = p.capability_profile_run_id
      WHERE ($1::text IS NULL OR p.source_key = $1)
        AND ($2::text IS NULL OR p.instrument_code = $2)
        AND ($3::text IS NULL OR p.timeframe = $3)
        AND ($4::market_data_capability_status IS NULL OR p.status = $4::market_data_capability_status)
        AND ($5::market_data_blocking_classification IS NULL OR p.blocking_classification = $5::market_data_blocking_classification)
      ORDER BY p.profiled_at_utc DESC, p.instrument_code, p.timeframe, p.source_key
      LIMIT $6`, [
      emptyToNull(sourceKey),
      emptyToNull(instrumentCode),
      emptyToNull(timeframe),
      status ? String(status).toUpperCase() : null,
      blockingClassification ? String(blockingClassification).toUpperCase() : null,
      bounded(limit, 500, 5000),
    ]).then((items) => items.map(normalizeMarketDataCapabilityProfileRow));
  }

  async listMarketDataStorageObjects({
    sourceKey = null,
    instrumentCode = null,
    timeframe = null,
    storageTier = null,
    storageFormat = null,
    status = null,
    limit = 500,
  } = {}) {
    await this.ready();
    return rows(this.pool, `SELECT mso.*, d.dataset_key, ib.batch_key, mcp.status AS capability_status,
             mcp.blocking_classification AS capability_blocking_classification
      FROM market_data_storage_objects mso
      LEFT JOIN datasets d ON d.dataset_id = mso.dataset_id
      LEFT JOIN ingestion_batches ib ON ib.ingestion_batch_id = mso.ingestion_batch_id
      LEFT JOIN market_data_capability_profiles mcp
        ON mcp.market_data_capability_profile_id = mso.market_data_capability_profile_id
      WHERE ($1::text IS NULL OR mso.source_key = $1)
        AND ($2::text IS NULL OR mso.instrument_code = $2)
        AND ($3::text IS NULL OR mso.timeframe = $3)
        AND ($4::market_data_storage_tier IS NULL OR mso.storage_tier = $4::market_data_storage_tier)
        AND ($5::market_data_storage_format IS NULL OR mso.storage_format = $5::market_data_storage_format)
        AND ($6::market_data_storage_object_status IS NULL OR mso.status = $6::market_data_storage_object_status)
      ORDER BY mso.updated_at_utc DESC, mso.instrument_code, mso.timeframe, mso.storage_tier
      LIMIT $7`, [
      emptyToNull(sourceKey),
      emptyToNull(instrumentCode),
      emptyToNull(timeframe),
      storageTier ? String(storageTier).toUpperCase() : null,
      storageFormat ? String(storageFormat).toUpperCase() : null,
      status ? String(status).toUpperCase() : null,
      bounded(limit, 500, 5000),
    ]).then((items) => items.map(normalizeMarketDataStorageObjectRow));
  }

  async listMarketDataHotSeriesWindows({
    sourceKey = null,
    instrumentCode = null,
    timeframe = null,
    status = null,
    limit = 500,
  } = {}) {
    await this.ready();
    return rows(this.pool, `SELECT hsw.*, mso.object_key, mso.uri AS storage_object_uri,
             mcp.status AS capability_status,
             mcp.blocking_classification AS capability_blocking_classification
      FROM market_data_hot_series_windows hsw
      LEFT JOIN market_data_storage_objects mso
        ON mso.market_data_storage_object_id = hsw.market_data_storage_object_id
      LEFT JOIN market_data_capability_profiles mcp
        ON mcp.market_data_capability_profile_id = hsw.market_data_capability_profile_id
      WHERE ($1::text IS NULL OR hsw.source_key = $1)
        AND ($2::text IS NULL OR hsw.instrument_code = $2)
        AND ($3::text IS NULL OR hsw.timeframe = $3)
        AND ($4::market_data_storage_object_status IS NULL OR hsw.status = $4::market_data_storage_object_status)
      ORDER BY hsw.latest_timestamp_utc DESC NULLS LAST, hsw.window_end_utc DESC
      LIMIT $5`, [
      emptyToNull(sourceKey),
      emptyToNull(instrumentCode),
      emptyToNull(timeframe),
      status ? String(status).toUpperCase() : null,
      bounded(limit, 500, 5000),
    ]).then((items) => items.map(normalizeMarketDataHotSeriesWindowRow));
  }
}

export class DisabledDataFoundationRepository {
  get available() { return false; }
  async ready() {
    throw repositoryError("DESK_DEPENDENCY_UNAVAILABLE", "Data Foundation repository is disabled.");
  }
}

export function createDataFoundationRepository(persistence) {
  return persistence?.pool
    ? new PostgresDataFoundationRepository(persistence)
    : new DisabledDataFoundationRepository();
}

export function normalizeDataSourceRow(row) {
  if (!row) return null;
  return {
    data_source_id: row.data_source_id,
    source_key: row.source_key,
    name: row.name,
    kind: row.kind,
    provider: row.provider,
    format: row.format,
    frequency: row.frequency,
    freshness_sla_seconds: numberOrNull(row.freshness_sla_seconds),
    status: row.status,
    environment: row.environment,
    configuration: row.configuration || {},
    metadata: row.metadata || {},
    created_at_utc: iso(row.created_at_utc),
    updated_at_utc: iso(row.updated_at_utc),
  };
}

export function normalizeIngestionBatchRow(row) {
  if (!row) return null;
  return {
    ingestion_batch_id: row.ingestion_batch_id,
    data_source_id: row.data_source_id,
    source_key: row.source_key || null,
    source_kind: row.source_kind || null,
    source_provider: row.source_provider || null,
    batch_key: row.batch_key,
    status: row.status,
    source_window_start_utc: iso(row.source_window_start_utc),
    source_window_end_utc: iso(row.source_window_end_utc),
    ingested_at_utc: iso(row.ingested_at_utc),
    completed_at_utc: iso(row.completed_at_utc),
    schema_version: row.schema_version,
    record_count: numberOrNull(row.record_count) ?? 0,
    rejected_count: numberOrNull(row.rejected_count) ?? 0,
    content_hash: row.content_hash || null,
    provenance_hash: row.provenance_hash || null,
    storage_ref: row.storage_ref || null,
    failure_code: row.failure_code || null,
    failure_message: row.failure_message || null,
    metadata: row.metadata || {},
    created_at_utc: iso(row.created_at_utc),
    updated_at_utc: iso(row.updated_at_utc),
  };
}

export function normalizeDatasetRow(row) {
  if (!row) return null;
  return {
    dataset_id: row.dataset_id,
    dataset_key: row.dataset_key,
    name: row.name,
    status: row.status,
    time_range_start_utc: iso(row.time_range_start_utc),
    time_range_end_utc: iso(row.time_range_end_utc),
    cutoff_utc: iso(row.cutoff_utc),
    cutoff_paris: row.cutoff_paris || null,
    cutoff_timezone: row.cutoff_timezone,
    schema_version: row.schema_version,
    source_batch_count: numberOrNull(row.source_batch_count) ?? 0,
    content_hash: row.content_hash || null,
    provenance_hash: row.provenance_hash || null,
    build_parameters_hash: row.build_parameters_hash || null,
    rebuilt_from_dataset_id: row.rebuilt_from_dataset_id || null,
    archived_at_utc: iso(row.archived_at_utc),
    metadata: row.metadata || {},
    created_at_utc: iso(row.created_at_utc),
    updated_at_utc: iso(row.updated_at_utc),
  };
}

export function normalizeDatasetLineageRow(row) {
  if (!row) return null;
  return {
    dataset_id: row.dataset_id,
    dataset_key: row.dataset_key,
    cutoff_utc: iso(row.cutoff_utc),
    cutoff_paris: row.cutoff_paris || null,
    ingestion_batch_id: row.ingestion_batch_id,
    batch_key: row.batch_key,
    ordinal: numberOrNull(row.ordinal),
    role: row.role,
    included_record_count: numberOrNull(row.included_record_count) ?? 0,
    source_key: row.source_key,
    source_kind: row.source_kind,
    source_provider: row.source_provider,
    ingestion_status: row.ingestion_status,
    source_provenance_hash: row.source_provenance_hash || row.ingestion_provenance_hash || null,
    ingestion_content_hash: row.ingestion_content_hash || null,
    metadata: row.metadata || {},
    created_at_utc: iso(row.created_at_utc),
  };
}

export function normalizeFeatureDefinitionRow(row) {
  if (!row) return null;
  const versions = arrayFromJson(row.versions).map(normalizeFeatureVersionJson);
  return {
    feature_definition_id: row.feature_definition_id,
    feature_key: row.feature_key,
    name: row.name,
    category: row.category,
    output_kind: row.output_kind,
    status: row.status,
    description: row.description || null,
    versions,
    published_version: versions.find((version) => version.status === "PUBLISHED") || null,
    metadata: row.metadata || {},
    created_at_utc: iso(row.created_at_utc),
    updated_at_utc: iso(row.updated_at_utc),
  };
}

export function normalizeFeatureComputationRow(row) {
  if (!row) return null;
  return {
    feature_computation_run_id: row.feature_computation_run_id,
    feature_version_id: row.feature_version_id,
    feature_key: row.feature_key,
    feature_name: row.feature_name,
    feature_version: row.feature_version,
    feature_version_status: row.feature_version_status,
    dataset_id: row.dataset_id,
    dataset_key: row.dataset_key,
    cutoff_utc: iso(row.cutoff_utc),
    cutoff_paris: row.cutoff_paris || null,
    parameters_hash: row.parameters_hash,
    status: row.status,
    engine_version: row.engine_version,
    row_count: numberOrNull(row.row_count) ?? 0,
    output_hash: row.output_hash || null,
    provenance_hash: row.provenance_hash || null,
    storage_ref: row.storage_ref || null,
    started_at_utc: iso(row.started_at_utc),
    completed_at_utc: iso(row.completed_at_utc),
    failure_code: row.failure_code || null,
    failure_message: row.failure_message || null,
    metadata: row.metadata || {},
    created_at_utc: iso(row.created_at_utc),
    updated_at_utc: iso(row.updated_at_utc),
  };
}

export function normalizeFeatureValueRow(row) {
  if (!row) return null;
  return {
    feature_value_id: row.feature_value_id,
    feature_computation_run_id: row.feature_computation_run_id,
    feature_definition_id: row.feature_definition_id,
    feature_version_id: row.feature_version_id,
    feature_key: row.feature_key,
    feature_name: row.feature_name,
    feature_version: row.feature_version,
    formula_hash: row.formula_hash || null,
    output_kind: row.output_kind,
    dataset_id: row.dataset_id,
    dataset_key: row.dataset_key,
    dataset_cutoff_utc: iso(row.cutoff_utc),
    dataset_cutoff_paris: row.cutoff_paris || null,
    dataset_provenance_hash: row.dataset_provenance_hash || null,
    parameters_hash: row.parameters_hash,
    computation_output_hash: row.output_hash || null,
    computation_provenance_hash: row.computation_provenance_hash || null,
    entity_key: row.entity_key,
    instrument_code: row.instrument_code || null,
    timeframe: row.timeframe || null,
    observed_at_utc: iso(row.observed_at_utc),
    available_at_utc: iso(row.available_at_utc),
    quality: row.quality,
    value_numeric: numberOrNull(row.value_numeric),
    value_json: row.value_json || null,
    source_row_hash: row.source_row_hash || null,
    metadata: row.metadata || {},
    created_at_utc: iso(row.created_at_utc),
  };
}

export function normalizeMarketDataCapabilityProfileRow(row) {
  if (!row) return null;
  return {
    market_data_capability_profile_id: row.market_data_capability_profile_id,
    capability_profile_run_id: row.capability_profile_run_id || null,
    run_key: row.run_key || null,
    run_as_of_utc: iso(row.run_as_of_utc),
    source_profile_ref: row.source_profile_ref || null,
    source_key: row.source_key,
    feed_id: row.feed_id || null,
    data_source_id: row.data_source_id || null,
    instrument_code: row.instrument_code,
    symbol_code: row.symbol_code || null,
    provider: row.provider,
    environment: row.environment,
    timeframe: row.timeframe,
    timeframe_seconds: numberOrNull(row.timeframe_seconds),
    status: row.status,
    blocking_classification: row.blocking_classification,
    storage_recommendation: row.storage_recommendation,
    historical_start_utc: iso(row.historical_start_utc),
    historical_end_utc: iso(row.historical_end_utc),
    observed_row_count: numberOrNull(row.observed_row_count) ?? 0,
    closed_row_count: numberOrNull(row.closed_row_count) ?? 0,
    volume_row_count: numberOrNull(row.volume_row_count) ?? 0,
    missing_bar_count: numberOrNull(row.missing_bar_count) ?? 0,
    largest_gap_seconds: numberOrNull(row.largest_gap_seconds),
    has_ohlcv: row.has_ohlcv === true,
    has_volume: row.has_volume === true,
    has_tick: row.has_tick === true,
    has_bid: row.has_bid === true,
    has_ask: row.has_ask === true,
    has_open_interest: row.has_open_interest === true,
    measured_capabilities: row.measured_capabilities || [],
    missing_capabilities: row.missing_capabilities || [],
    blocking_missing_capabilities: row.blocking_missing_capabilities || [],
    non_blocking_missing_capabilities: row.non_blocking_missing_capabilities || [],
    cost_profile: row.cost_profile || {},
    recommendation: row.recommendation || null,
    metadata: row.metadata || {},
    profiled_at_utc: iso(row.profiled_at_utc),
    created_at_utc: iso(row.created_at_utc),
    updated_at_utc: iso(row.updated_at_utc),
  };
}

export function normalizeMarketDataStorageObjectRow(row) {
  if (!row) return null;
  return {
    market_data_storage_object_id: row.market_data_storage_object_id,
    object_key: row.object_key,
    storage_tier: row.storage_tier,
    storage_format: row.storage_format,
    status: row.status,
    uri: row.uri,
    dataset_id: row.dataset_id || null,
    dataset_key: row.dataset_key || null,
    ingestion_batch_id: row.ingestion_batch_id || null,
    batch_key: row.batch_key || null,
    market_data_capability_profile_id: row.market_data_capability_profile_id || null,
    capability_status: row.capability_status || null,
    capability_blocking_classification: row.capability_blocking_classification || null,
    source_key: row.source_key,
    provider: row.provider,
    environment: row.environment,
    instrument_code: row.instrument_code,
    timeframe: row.timeframe,
    time_range_start_utc: iso(row.time_range_start_utc),
    time_range_end_utc: iso(row.time_range_end_utc),
    partition_grain: row.partition_grain,
    partition_spec: row.partition_spec || {},
    schema_version: row.schema_version,
    compression: row.compression || null,
    record_count: numberOrNull(row.record_count) ?? 0,
    byte_size: numberOrNull(row.byte_size) ?? 0,
    content_hash: row.content_hash || null,
    provenance_hash: row.provenance_hash || null,
    retention_days: numberOrNull(row.retention_days),
    metadata: row.metadata || {},
    created_at_utc: iso(row.created_at_utc),
    updated_at_utc: iso(row.updated_at_utc),
  };
}

export function normalizeMarketDataHotSeriesWindowRow(row) {
  if (!row) return null;
  return {
    hot_series_window_id: row.hot_series_window_id,
    source_key: row.source_key,
    provider: row.provider,
    environment: row.environment,
    instrument_code: row.instrument_code,
    timeframe: row.timeframe,
    hot_table: row.hot_table,
    market_data_storage_object_id: row.market_data_storage_object_id || null,
    object_key: row.object_key || null,
    storage_object_uri: row.storage_object_uri || null,
    market_data_capability_profile_id: row.market_data_capability_profile_id || null,
    capability_status: row.capability_status || null,
    capability_blocking_classification: row.capability_blocking_classification || null,
    window_start_utc: iso(row.window_start_utc),
    window_end_utc: iso(row.window_end_utc),
    latest_timestamp_utc: iso(row.latest_timestamp_utc),
    retention_days: numberOrNull(row.retention_days) ?? 0,
    row_count: numberOrNull(row.row_count) ?? 0,
    status: row.status,
    metadata: row.metadata || {},
    created_at_utc: iso(row.created_at_utc),
    updated_at_utc: iso(row.updated_at_utc),
  };
}

export function toSqlDataSourceStatus(value) { return enumValue(DATA_SOURCE_STATUS_TO_SQL, value); }
export function toSqlDatasetStatus(value) { return enumValue(DATASET_STATUS_TO_SQL, value); }
export function toSqlFeatureDefinitionStatus(value) { return enumValue(FEATURE_DEFINITION_STATUS_TO_SQL, value); }
export function toSqlFeatureVersionStatus(value) { return enumValue(FEATURE_VERSION_STATUS_TO_SQL, value); }
export function toSqlFeatureComputationStatus(value) { return enumValue(FEATURE_COMPUTATION_STATUS_TO_SQL, value); }

async function rows(client, sql, params = []) { return (await client.query(sql, params)).rows || []; }
async function one(client, sql, params = []) { return (await client.query(sql, params)).rows?.[0] || null; }

function normalizeFeatureVersionJson(row) {
  return {
    feature_version_id: row.feature_version_id,
    version: row.version,
    status: row.status,
    formula_ref: row.formula_ref,
    formula_hash: row.formula_hash || null,
    deterministic: row.deterministic === true,
    point_in_time_safe: row.point_in_time_safe === true,
    min_dataset_schema_version: row.min_dataset_schema_version || null,
    published_at_utc: iso(row.published_at_utc),
    deprecated_at_utc: iso(row.deprecated_at_utc),
    metadata: row.metadata || {},
    created_at_utc: iso(row.created_at_utc),
    updated_at_utc: iso(row.updated_at_utc),
  };
}

function arrayFromJson(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function enumValue(map, value) {
  if (value === null || value === undefined || value === "") return null;
  return map[String(value).toUpperCase()] || String(value);
}

function emptyToNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function iso(value) {
  if (!value) return null;
  return new Date(value).toISOString();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bounded(value, fallback = 100, max = 500) {
  const parsed = Number(value);
  return Math.max(1, Math.min(Number.isFinite(parsed) ? Math.trunc(parsed) : fallback, max));
}

function repositoryError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  error.statusCode = code === "DESK_DEPENDENCY_UNAVAILABLE" ? 503 : 409;
  return error;
}
