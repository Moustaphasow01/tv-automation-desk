import { randomUUID } from "node:crypto";

export class PostgresSimulationRunRegistryRepository {
  constructor(persistence) {
    this.persistence = persistence;
    this.pool = persistence?.pool || null;
  }

  get available() { return Boolean(this.pool); }

  async ready() {
    if (!this.pool) {
      throw repositoryError("SIMULATION_RUN_REGISTRY_UNAVAILABLE", "PostgreSQL Simulation Run Registry repository is unavailable.");
    }
    await this.persistence.initialized;
  }

  async transaction(lockKey, operation) {
    await this.ready();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockKey]);
      const scoped = new PostgresSimulationRunRegistryRepository({ initialized: Promise.resolve(), pool: transactionPool(client) });
      const result = await operation(scoped);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findRun(simulationRunId) {
    await this.ready();
    return normalizeRunRow(await one(this.pool, "SELECT * FROM simulation_runs WHERE simulation_run_id = $1", [simulationRunId]));
  }

  async listRuns({ strategyVersionId = null, datasetId = null, status = null, limit = 100, sort = "created_desc" } = {}) {
    await this.ready();
    return rows(this.pool, `SELECT *
      FROM simulation_runs
      WHERE ($1::uuid IS NULL OR strategy_version_id = $1)
        AND ($2::uuid IS NULL OR dataset_id = $2)
        AND ($3::simulation_run_status IS NULL OR status = $3::simulation_run_status)
      ORDER BY ${simulationRunOrderBy(sort)}
      LIMIT $4`, [
      emptyToNull(strategyVersionId),
      emptyToNull(datasetId),
      status ? String(status).toUpperCase() : null,
      bounded(limit),
    ]).then((items) => items.map(normalizeRunRow));
  }

  async upsertRun(run) {
    await this.ready();
    const row = await one(this.pool, `INSERT INTO simulation_runs (
        simulation_run_id, source_run_id, strategy_version_id, dataset_id, parameters_hash,
        reproducibility_seed, status, simulation_engine, simulation_engine_version,
        result_schema_version, cutoff, dataset_hash, compiled_artifact_hash, result_hash,
        metrics_hash, result_ref, metrics_ref, started_at_utc, completed_at_utc,
        failure_code, failure_message, idempotency_key, metadata, created_at_utc, updated_at_utc
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::simulation_run_status,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb,$24,$25)
      ON CONFLICT (simulation_run_id) DO UPDATE SET
        source_run_id = EXCLUDED.source_run_id,
        status = EXCLUDED.status,
        result_hash = EXCLUDED.result_hash,
        metrics_hash = EXCLUDED.metrics_hash,
        result_ref = EXCLUDED.result_ref,
        metrics_ref = EXCLUDED.metrics_ref,
        completed_at_utc = EXCLUDED.completed_at_utc,
        failure_code = EXCLUDED.failure_code,
        failure_message = EXCLUDED.failure_message,
        metadata = EXCLUDED.metadata,
        updated_at_utc = EXCLUDED.updated_at_utc
      RETURNING *`, [
      run.simulation_run_id,
      run.source_run_id,
      run.strategy_version_id,
      run.dataset_id,
      run.parameters_hash,
      run.reproducibility_seed,
      run.status,
      run.simulation_engine,
      run.simulation_engine_version,
      run.result_schema_version,
      run.cutoff,
      run.dataset_hash,
      run.compiled_artifact_hash,
      run.result_hash,
      run.metrics_hash,
      run.result_ref,
      run.metrics_ref,
      run.started_at_utc,
      run.completed_at_utc,
      run.failure_code,
      run.failure_message,
      run.idempotency_key,
      json(run.metadata),
      run.created_at_utc,
      run.updated_at_utc || run.created_at_utc,
    ]);
    return normalizeRunRow(row);
  }

  async upsertArtifacts(artifacts) {
    await this.ready();
    const saved = [];
    for (const artifact of artifacts) saved.push(await this.upsertArtifact(artifact));
    return saved;
  }

  async upsertArtifact(artifact) {
    await this.ready();
    const row = await one(this.pool, `INSERT INTO simulation_run_artifacts (
        simulation_run_artifact_id, simulation_run_id, artifact_kind, schema_version,
        content_hash, storage_ref, payload, created_at_utc
      ) VALUES ($1,$2,$3::simulation_run_artifact_kind,$4,$5,$6,$7::jsonb,$8)
      ON CONFLICT (simulation_run_artifact_id) DO UPDATE SET
        storage_ref = simulation_run_artifacts.storage_ref
      RETURNING *`, [
      artifact.simulation_run_artifact_id,
      artifact.simulation_run_id,
      artifact.artifact_kind,
      artifact.schema_version,
      artifact.content_hash,
      artifact.storage_ref,
      json(artifact.payload),
      artifact.created_at_utc,
    ]);
    return normalizeArtifactRow(row);
  }

  async listArtifacts({ simulationRunId = null, artifactKind = null, limit = 100 } = {}) {
    await this.ready();
    return rows(this.pool, `SELECT *
      FROM simulation_run_artifacts
      WHERE ($1::uuid IS NULL OR simulation_run_id = $1)
        AND ($2::simulation_run_artifact_kind IS NULL OR artifact_kind = $2::simulation_run_artifact_kind)
      ORDER BY created_at_utc DESC
      LIMIT $3`, [
      emptyToNull(simulationRunId),
      artifactKind ? String(artifactKind).toUpperCase() : null,
      bounded(limit),
    ]).then((items) => items.map(normalizeArtifactRow));
  }

  async appendAuditEvent(event) {
    await this.ready();
    const auditEventId = event.simulation_run_audit_event_id || randomUUID();
    const row = await one(this.pool, `INSERT INTO simulation_run_audit_events (
        simulation_run_audit_event_id, simulation_run_id, event_type, idempotency_key,
        actor, reason, previous_status, next_status, previous_hash, next_hash,
        payload, created_at_utc
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::simulation_run_status,$8::simulation_run_status,$9,$10,$11::jsonb,$12)
      ON CONFLICT (simulation_run_id, event_type, idempotency_key)
      WHERE idempotency_key IS NOT NULL
      DO UPDATE SET simulation_run_audit_event_id = simulation_run_audit_events.simulation_run_audit_event_id
      RETURNING *`, [
      auditEventId,
      event.simulation_run_id,
      event.event_type,
      event.idempotency_key || null,
      event.actor || "simulation_run_registry",
      event.reason || null,
      event.previous_status || null,
      event.next_status || null,
      event.previous_hash || null,
      event.next_hash || null,
      json(event.payload),
      event.created_at_utc,
    ]);
    return normalizeAuditRow(row);
  }
}

export class DisabledSimulationRunRegistryRepository {
  get available() { return false; }
  async ready() {
    throw repositoryError("SIMULATION_RUN_REGISTRY_UNAVAILABLE", "Simulation Run Registry repository is disabled.");
  }
  async transaction() { await this.ready(); }
  async findRun() { await this.ready(); }
  async listRuns() { await this.ready(); }
  async upsertRun() { await this.ready(); }
  async upsertArtifacts() { await this.ready(); }
  async listArtifacts() { await this.ready(); }
  async appendAuditEvent() { await this.ready(); }
}

export function createSimulationRunRegistryRepository(persistence) {
  return persistence?.pool
    ? new PostgresSimulationRunRegistryRepository(persistence)
    : new DisabledSimulationRunRegistryRepository();
}

export function normalizeRunRow(row) {
  if (!row) return null;
  return {
    schema_version: "simulation_run_registry_entry_v1",
    simulation_run_id: row.simulation_run_id,
    source_run_id: row.source_run_id,
    strategy_version_id: row.strategy_version_id,
    dataset_id: row.dataset_id,
    parameters_hash: row.parameters_hash,
    reproducibility_seed: row.reproducibility_seed,
    status: row.status,
    simulation_engine: row.simulation_engine,
    simulation_engine_version: row.simulation_engine_version,
    result_schema_version: row.result_schema_version,
    cutoff: row.cutoff,
    dataset_hash: row.dataset_hash,
    compiled_artifact_hash: row.compiled_artifact_hash,
    result_hash: row.result_hash,
    metrics_hash: row.metrics_hash,
    result_ref: row.result_ref,
    metrics_ref: row.metrics_ref,
    failure_code: row.failure_code,
    failure_message: row.failure_message,
    metadata: row.metadata || {},
    created_at_utc: iso(row.created_at_utc),
    updated_at_utc: iso(row.updated_at_utc),
    started_at_utc: iso(row.started_at_utc),
    completed_at_utc: iso(row.completed_at_utc),
  };
}

export function normalizeArtifactRow(row) {
  if (!row) return null;
  return {
    schema_version: row.schema_version,
    simulation_run_artifact_id: row.simulation_run_artifact_id,
    simulation_run_id: row.simulation_run_id,
    artifact_kind: row.artifact_kind,
    content_hash: row.content_hash,
    storage_ref: row.storage_ref,
    payload: row.payload || {},
    created_at_utc: iso(row.created_at_utc),
  };
}

export function normalizeAuditRow(row) {
  if (!row) return null;
  return {
    simulation_run_audit_event_id: row.simulation_run_audit_event_id,
    simulation_run_id: row.simulation_run_id,
    event_type: row.event_type,
    idempotency_key: row.idempotency_key,
    actor: row.actor,
    reason: row.reason,
    previous_status: row.previous_status,
    next_status: row.next_status,
    previous_hash: row.previous_hash,
    next_hash: row.next_hash,
    payload: row.payload || {},
    created_at_utc: iso(row.created_at_utc),
  };
}

async function rows(client, sql, params = []) { return (await client.query(sql, params)).rows; }
async function one(client, sql, params = []) { return (await client.query(sql, params)).rows[0] || null; }
function json(value) { return JSON.stringify(value ?? {}); }
function iso(value) { return value ? new Date(value).toISOString() : null; }
function transactionPool(client) { return { query: (...args) => client.query(...args), connect: async () => client }; }
function emptyToNull(value) { return value === "" || value === undefined ? null : value; }
function simulationRunOrderBy(sort) {
  const normalized = String(sort || "created_desc").toLowerCase();
  if (normalized === "performance_desc") {
    return "((metadata->'metrics'->>'total_r')::numeric) DESC NULLS LAST, created_at_utc DESC, simulation_run_id ASC";
  }
  if (normalized === "started_desc") {
    return "started_at_utc DESC NULLS LAST, created_at_utc DESC, simulation_run_id ASC";
  }
  return "created_at_utc DESC, updated_at_utc DESC, simulation_run_id ASC";
}
function bounded(value, fallback = 100, max = 500) {
  const parsed = Number(value);
  return Math.max(1, Math.min(Number.isFinite(parsed) ? Math.trunc(parsed) : fallback, max));
}
function repositoryError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  error.statusCode = 503;
  return error;
}
