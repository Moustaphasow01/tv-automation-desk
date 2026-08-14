import { randomUUID } from "node:crypto";

const VERSION_STATUS_TO_SQL = Object.freeze({
  DRAFT: "draft",
  IN_SIMULATION: "in_simulation",
  VALIDATED: "validated",
  PUBLISHED: "published",
  DEPRECATED: "deprecated",
});

const VERSION_STATUS_FROM_SQL = Object.freeze(Object.fromEntries(
  Object.entries(VERSION_STATUS_TO_SQL).map(([domain, sql]) => [sql, domain]),
));

const RUNTIME_STATE_TO_SQL = Object.freeze({
  CREATED: "created",
  STARTING: "starting",
  RUNNING: "running",
  PAUSED: "paused",
  STOPPING: "stopping",
  STOPPED: "stopped",
  FAILED_TO_START: "failed_to_start",
  ERRORED: "errored",
});

const RUNTIME_STATE_FROM_SQL = Object.freeze(Object.fromEntries(
  Object.entries(RUNTIME_STATE_TO_SQL).map(([domain, sql]) => [sql, domain]),
));

const EXECUTION_MODE_TO_SQL = Object.freeze({
  SHADOW: "shadow",
  PAPER: "paper",
  LIVE: "live",
});

const EXECUTION_MODE_FROM_SQL = Object.freeze(Object.fromEntries(
  Object.entries(EXECUTION_MODE_TO_SQL).map(([domain, sql]) => [sql, domain]),
));

export class PostgresStrategyKernelRepository {
  constructor(persistence) {
    this.persistence = persistence;
    this.pool = persistence?.pool || null;
  }

  get available() { return Boolean(this.pool); }

  async ready() {
    if (!this.pool) {
      throw repositoryError("STRATEGY_KERNEL_REPOSITORY_UNAVAILABLE", "PostgreSQL Strategy Kernel repository is unavailable.");
    }
    await this.persistence.initialized;
  }

  async transaction(lockKey, operation) {
    await this.ready();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockKey]);
      const scoped = new PostgresStrategyKernelRepository({ initialized: Promise.resolve(), pool: transactionPool(client) });
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

  async findDefinition(strategyDefinitionId) {
    await this.ready();
    return normalizeDefinitionRow(await one(this.pool, "SELECT * FROM strategy_definitions WHERE strategy_definition_id = $1", [strategyDefinitionId]));
  }

  async findDefinitionByExternalKey(externalKey) {
    await this.ready();
    return normalizeDefinitionRow(await one(this.pool, "SELECT * FROM strategy_definitions WHERE external_key = $1", [externalKey]));
  }

  async listDefinitions({ limit = 100 } = {}) {
    await this.ready();
    return rows(this.pool, "SELECT * FROM strategy_definitions ORDER BY created_at DESC LIMIT $1", [bounded(limit)])
      .then((items) => items.map(normalizeDefinitionRow));
  }

  async upsertDefinition(definition) {
    await this.ready();
    const row = await one(this.pool, `INSERT INTO strategy_definitions (
        strategy_definition_id, external_key, name, description, owner, asset_class,
        default_instruments, tags, metadata, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
      ON CONFLICT (strategy_definition_id) DO UPDATE SET
        external_key = EXCLUDED.external_key,
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        owner = EXCLUDED.owner,
        asset_class = EXCLUDED.asset_class,
        default_instruments = EXCLUDED.default_instruments,
        tags = EXCLUDED.tags,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at
      RETURNING *`, [
      definition.strategy_definition_id,
      definition.external_key,
      definition.name,
      definition.description,
      definition.owner,
      definition.asset_class,
      definition.default_instruments || [],
      definition.tags || [],
      json(definition.metadata),
      definition.created_at,
      definition.updated_at || definition.created_at,
    ]);
    return normalizeDefinitionRow(row);
  }

  async findVersion(strategyVersionId, { forUpdate = false } = {}) {
    await this.ready();
    return normalizeVersionRow(await one(
      this.pool,
      `SELECT * FROM strategy_versions WHERE strategy_version_id = $1${forUpdate ? " FOR UPDATE" : ""}`,
      [strategyVersionId],
    ));
  }

  async listVersions({ strategyDefinitionId = null, status = null, limit = 100 } = {}) {
    await this.ready();
    return rows(this.pool, `SELECT * FROM strategy_versions
      WHERE ($1::uuid IS NULL OR strategy_definition_id = $1)
        AND ($2::strategy_version_status IS NULL OR status = $2::strategy_version_status)
      ORDER BY created_at DESC LIMIT $3`, [
      strategyDefinitionId,
      status ? toSqlVersionStatus(status) : null,
      bounded(limit),
    ]).then((items) => items.map(normalizeVersionRow));
  }

  async upsertVersion(version) {
    await this.ready();
    const row = await one(this.pool, `INSERT INTO strategy_versions (
        strategy_version_id, strategy_definition_id, version_label, status, dsl_source_hash,
        compiled_artifact_ref, compiled_artifact_hash, validated_metrics_ref,
        runtime_contract_bundle_version, published_at, deprecated_at, metadata, created_at, updated_at
      ) VALUES ($1,$2,$3,$4::strategy_version_status,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)
      ON CONFLICT (strategy_version_id) DO UPDATE SET
        strategy_definition_id = EXCLUDED.strategy_definition_id,
        version_label = EXCLUDED.version_label,
        status = EXCLUDED.status,
        dsl_source_hash = EXCLUDED.dsl_source_hash,
        compiled_artifact_ref = EXCLUDED.compiled_artifact_ref,
        compiled_artifact_hash = EXCLUDED.compiled_artifact_hash,
        validated_metrics_ref = EXCLUDED.validated_metrics_ref,
        runtime_contract_bundle_version = EXCLUDED.runtime_contract_bundle_version,
        published_at = EXCLUDED.published_at,
        deprecated_at = EXCLUDED.deprecated_at,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at
      RETURNING *`, [
      version.strategy_version_id,
      version.strategy_definition_id,
      version.version_label,
      toSqlVersionStatus(version.status),
      version.dsl_source_hash,
      version.compiled_artifact_ref,
      version.compiled_artifact_hash,
      version.validated_metrics_ref,
      version.runtime_contract_bundle_version,
      version.published_at,
      version.deprecated_at,
      json(version.metadata),
      version.created_at,
      version.updated_at || version.created_at,
    ]);
    return normalizeVersionRow(row);
  }

  async findInstance(strategyInstanceId, { forUpdate = false } = {}) {
    await this.ready();
    return normalizeInstanceRow(await one(
      this.pool,
      `SELECT * FROM strategy_instances WHERE strategy_instance_id = $1${forUpdate ? " FOR UPDATE" : ""}`,
      [strategyInstanceId],
    ));
  }

  async listInstances({ strategyVersionId = null, runtimeState = null, executionMode = null, limit = 100 } = {}) {
    await this.ready();
    return rows(this.pool, `SELECT * FROM strategy_instances
      WHERE ($1::uuid IS NULL OR strategy_version_id = $1)
        AND ($2::strategy_instance_runtime_state IS NULL OR runtime_state = $2::strategy_instance_runtime_state)
        AND ($3::strategy_instance_execution_mode IS NULL OR execution_mode = $3::strategy_instance_execution_mode)
      ORDER BY created_at DESC LIMIT $4`, [
      strategyVersionId,
      runtimeState ? toSqlRuntimeState(runtimeState) : null,
      executionMode ? toSqlExecutionMode(executionMode) : null,
      bounded(limit),
    ]).then((items) => items.map(normalizeInstanceRow));
  }

  async hasLiveAccountConflict({ accountScope, excludeStrategyInstanceId = null } = {}) {
    await this.ready();
    if (!accountScope) return false;
    const row = await one(this.pool, `SELECT strategy_instance_id
        FROM strategy_instances
        WHERE account_scope = $1
          AND execution_mode = 'live'
          AND runtime_state IN ('created', 'starting', 'running', 'paused')
          AND strategy_instance_id IS DISTINCT FROM $2
        LIMIT 1`, [accountScope, excludeStrategyInstanceId]);
    return Boolean(row);
  }

  async upsertInstance(instance) {
    await this.ready();
    const row = await one(this.pool, `INSERT INTO strategy_instances (
        strategy_instance_id, strategy_version_id, runtime_state, execution_mode, account_scope,
        instrument_scope, session_scope, risk_budget_ref, triple_lock_validated,
        last_heartbeat_at, started_at, stopped_at, failed_at, metadata, created_at, updated_at
      ) VALUES ($1,$2,$3::strategy_instance_runtime_state,$4::strategy_instance_execution_mode,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16)
      ON CONFLICT (strategy_instance_id) DO UPDATE SET
        strategy_version_id = EXCLUDED.strategy_version_id,
        runtime_state = EXCLUDED.runtime_state,
        execution_mode = EXCLUDED.execution_mode,
        account_scope = EXCLUDED.account_scope,
        instrument_scope = EXCLUDED.instrument_scope,
        session_scope = EXCLUDED.session_scope,
        risk_budget_ref = EXCLUDED.risk_budget_ref,
        triple_lock_validated = EXCLUDED.triple_lock_validated,
        last_heartbeat_at = EXCLUDED.last_heartbeat_at,
        started_at = EXCLUDED.started_at,
        stopped_at = EXCLUDED.stopped_at,
        failed_at = EXCLUDED.failed_at,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at
      RETURNING *`, [
      instance.strategy_instance_id,
      instance.strategy_version_id,
      toSqlRuntimeState(instance.runtime_state),
      toSqlExecutionMode(instance.execution_mode),
      instance.account_scope,
      instance.instrument_scope || [],
      instance.session_scope || [],
      instance.risk_budget_ref,
      instance.triple_lock_validated === true,
      instance.last_heartbeat_at,
      instance.started_at,
      instance.stopped_at,
      instance.failed_at,
      json(instance.metadata),
      instance.created_at,
      instance.updated_at || instance.created_at,
    ]);
    return normalizeInstanceRow(row);
  }

  async appendAuditEvent(event) {
    await this.ready();
    const auditEventId = event.strategy_kernel_audit_event_id || randomUUID();
    const row = await one(this.pool, `INSERT INTO strategy_kernel_audit_events (
        strategy_kernel_audit_event_id, aggregate_type, aggregate_id, event_type, idempotency_key,
        actor, reason, previous_hash, next_hash, previous_status, next_status,
        previous_runtime_state, next_runtime_state, previous_execution_mode, next_execution_mode,
        payload, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17)
      ON CONFLICT (aggregate_type, aggregate_id, event_type, idempotency_key)
      WHERE idempotency_key IS NOT NULL
      DO UPDATE SET strategy_kernel_audit_event_id = strategy_kernel_audit_events.strategy_kernel_audit_event_id
      RETURNING *`, [
      auditEventId,
      event.aggregate_type,
      event.aggregate_id,
      event.event_type,
      event.idempotency_key || null,
      event.actor || "strategy_kernel",
      event.reason || null,
      event.previous_hash || null,
      event.next_hash || null,
      event.previous_status || null,
      event.next_status || null,
      event.previous_runtime_state || null,
      event.next_runtime_state || null,
      event.previous_execution_mode || null,
      event.next_execution_mode || null,
      json(event.payload),
      event.created_at,
    ]);
    return normalizeAuditRow(row);
  }

  async listAuditEvents({ aggregateType = null, aggregateId = null, limit = 100 } = {}) {
    await this.ready();
    return rows(this.pool, `SELECT * FROM strategy_kernel_audit_events
      WHERE ($1::text IS NULL OR aggregate_type = $1)
        AND ($2::uuid IS NULL OR aggregate_id = $2)
      ORDER BY created_at DESC LIMIT $3`, [aggregateType, aggregateId, bounded(limit)])
      .then((items) => items.map(normalizeAuditRow));
  }
}

export class DisabledStrategyKernelRepository {
  get available() { return false; }
  async ready() {
    throw repositoryError("STRATEGY_KERNEL_REPOSITORY_UNAVAILABLE", "Strategy Kernel repository is disabled.");
  }
}

export function createStrategyKernelRepository(persistence) {
  return persistence?.pool
    ? new PostgresStrategyKernelRepository(persistence)
    : new DisabledStrategyKernelRepository();
}

export function normalizeDefinitionRow(row) {
  if (!row) return null;
  return {
    schema_version: "strategy_definition_v1",
    strategy_definition_id: row.strategy_definition_id,
    external_key: row.external_key,
    name: row.name,
    description: row.description,
    owner: row.owner,
    asset_class: row.asset_class,
    default_instruments: row.default_instruments || [],
    tags: row.tags || [],
    metadata: row.metadata || {},
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

export function normalizeVersionRow(row) {
  if (!row) return null;
  return {
    schema_version: "strategy_version_v1",
    strategy_version_id: row.strategy_version_id,
    strategy_definition_id: row.strategy_definition_id,
    version_label: row.version_label,
    status: fromSqlVersionStatus(row.status),
    dsl_source_hash: row.dsl_source_hash,
    compiled_artifact_ref: row.compiled_artifact_ref,
    compiled_artifact_hash: row.compiled_artifact_hash,
    validated_metrics_ref: row.validated_metrics_ref,
    runtime_contract_bundle_version: row.runtime_contract_bundle_version,
    metadata: row.metadata || {},
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    published_at: iso(row.published_at),
    deprecated_at: iso(row.deprecated_at),
  };
}

export function normalizeInstanceRow(row) {
  if (!row) return null;
  return {
    schema_version: "strategy_instance_v1",
    strategy_instance_id: row.strategy_instance_id,
    strategy_version_id: row.strategy_version_id,
    runtime_state: fromSqlRuntimeState(row.runtime_state),
    execution_mode: fromSqlExecutionMode(row.execution_mode),
    account_scope: row.account_scope,
    instrument_scope: row.instrument_scope || [],
    session_scope: row.session_scope || [],
    risk_budget_ref: row.risk_budget_ref,
    triple_lock_validated: row.triple_lock_validated === true,
    metadata: row.metadata || {},
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    last_heartbeat_at: iso(row.last_heartbeat_at),
    started_at: iso(row.started_at),
    stopped_at: iso(row.stopped_at),
    failed_at: iso(row.failed_at),
  };
}

export function normalizeAuditRow(row) {
  if (!row) return null;
  return {
    strategy_kernel_audit_event_id: row.strategy_kernel_audit_event_id,
    aggregate_type: row.aggregate_type,
    aggregate_id: row.aggregate_id,
    event_type: row.event_type,
    idempotency_key: row.idempotency_key,
    actor: row.actor,
    reason: row.reason,
    previous_hash: row.previous_hash,
    next_hash: row.next_hash,
    previous_status: row.previous_status,
    next_status: row.next_status,
    previous_runtime_state: row.previous_runtime_state,
    next_runtime_state: row.next_runtime_state,
    previous_execution_mode: row.previous_execution_mode,
    next_execution_mode: row.next_execution_mode,
    payload: row.payload || {},
    created_at: iso(row.created_at),
  };
}

export function toSqlVersionStatus(value) { return VERSION_STATUS_TO_SQL[String(value || "").toUpperCase()] || value; }
export function fromSqlVersionStatus(value) { return VERSION_STATUS_FROM_SQL[String(value || "").toLowerCase()] || value; }
export function toSqlRuntimeState(value) { return RUNTIME_STATE_TO_SQL[String(value || "").toUpperCase()] || value; }
export function fromSqlRuntimeState(value) { return RUNTIME_STATE_FROM_SQL[String(value || "").toLowerCase()] || value; }
export function toSqlExecutionMode(value) { return EXECUTION_MODE_TO_SQL[String(value || "").toUpperCase()] || value; }
export function fromSqlExecutionMode(value) { return EXECUTION_MODE_FROM_SQL[String(value || "").toLowerCase()] || value; }

async function rows(client, sql, params = []) { return (await client.query(sql, params)).rows; }
async function one(client, sql, params = []) { return (await client.query(sql, params)).rows[0] || null; }
function json(value) { return JSON.stringify(value ?? {}); }
function iso(value) { return value ? new Date(value).toISOString() : null; }
function transactionPool(client) { return { query: (...args) => client.query(...args), connect: async () => client }; }
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
