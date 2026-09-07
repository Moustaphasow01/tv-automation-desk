import {
  canonicalSha256,
  normalizeMarketContextSnapshotV1,
  normalizeMarketDeskBriefV1,
  normalizeMarketSourceStateV1,
} from "@tv-automation/desk-domain";
import { SystemClock } from "@tv-automation/desk-time";
import { loadCurrentGrainsCalendar } from "./persistence/postgres-grains-calendar-current-state.js";

const DEFAULT_READ_BUDGET_MS = 15_000;
const CORE_STATEMENT_TIMEOUT_MS = 1_000;
const MAX_ENRICHMENT_STATEMENT_TIMEOUT_MS = 700;
const MIN_STATEMENT_TIMEOUT_MS = 50;
const READ_BUDGET_RESERVE_MS = 100;

const CURRENT_CONTEXT_SQL = `WITH latest_snapshot AS (
  SELECT * FROM market_context_snapshots
  WHERE universe=$1 ORDER BY created_at_utc DESC LIMIT 1
)
SELECT row_to_json(snapshot_row) AS snapshot,
  (SELECT row_to_json(brief_row) FROM market_desk_briefs brief_row
    WHERE brief_row.market_context_snapshot_id=snapshot_row.market_context_snapshot_id
    ORDER BY brief_row.created_at_utc DESC LIMIT 1) AS brief
FROM latest_snapshot snapshot_row`;

export class MarketContextRepository {
  constructor(persistence, { eventOutbox = null, clock = new SystemClock() } = {}) {
    this.persistence = persistence;
    this.pool = persistence?.pool || null;
    this.eventOutbox = eventOutbox;
    this.clock = clock;
  }

  async current(universe = "US_GRAINS_CBOT", nowUtc = null, options = {}) {
    const asOfUtc = nowUtc || this.clock.now().utc;
    await this.#ready();
    const readBudgetMs = boundedReadBudget(options.readBudgetMs);
    const records = await readCurrentRecords(this.pool, { universe, asOfUtc, readBudgetMs });
    return mapCurrentRecords(records, { universe, asOfUtc });
  }

  async calendarAt(asOfUtc) {
    await this.#ready();
    return loadCurrentGrainsCalendar(this.pool, asOfUtc);
  }

  async upsertSourceCoverage(input = {}) {
    await this.#ready();
    const state = normalizeMarketSourceStateV1(input, { cutoff: input.dataCutoff || input.asOf });
    const result = await this.pool.query(`INSERT INTO market_source_coverage_manifests (
      source_id, source_type, source_status, required_for, coverage_start_utc, coverage_end_utc,
      as_of_utc, data_cutoff_utc, last_successful_import_at_utc, provider, dataset_version, missingness,
      reason_codes, metadata, updated_at_utc
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,now())
    ON CONFLICT (source_id) DO UPDATE SET
      source_type=EXCLUDED.source_type, source_status=EXCLUDED.source_status,
      required_for=EXCLUDED.required_for,
      coverage_start_utc=EXCLUDED.coverage_start_utc, coverage_end_utc=EXCLUDED.coverage_end_utc,
      as_of_utc=EXCLUDED.as_of_utc, data_cutoff_utc=EXCLUDED.data_cutoff_utc,
      last_successful_import_at_utc=EXCLUDED.last_successful_import_at_utc,
      provider=EXCLUDED.provider, dataset_version=EXCLUDED.dataset_version,
      missingness=EXCLUDED.missingness, reason_codes=EXCLUDED.reason_codes,
      metadata=EXCLUDED.metadata, updated_at_utc=now() RETURNING *`, [
      state.sourceId, state.sourceType, state.status, state.requiredFor, state.coverageStart, state.coverageEnd,
      state.asOf || this.clock.now().utc, state.dataCutoff, state.lastSuccessfulAt, state.provider,
      state.datasetVersion, state.missingness, state.reasonCodes, JSON.stringify(input.metadata || {}),
    ]);
    return mapCoverage(result.rows[0]);
  }

  async persistAnalysis({ snapshot: snapshotInput, brief: briefInput } = {}) {
    await this.#ready();
    const snapshot = normalizeMarketContextSnapshotV1(snapshotInput);
    const brief = normalizeMarketDeskBriefV1({ ...briefInput, marketContextSnapshotId: snapshot.marketContextSnapshotId });
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const invalidated = await invalidateCurrent(client, snapshot);
      await this.#appendInvalidationEvents(client, invalidated, snapshot);
      await insertSnapshot(client, snapshot);
      await insertBrief(client, brief);
      await this.#appendEvents(client, snapshot, brief);
      await client.query("COMMIT");
      return { snapshot, brief };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async #appendEvents(client, snapshot, brief) {
    if (!this.eventOutbox) return;
    await this.eventOutbox.append({
      aggregateId: snapshot.marketContextSnapshotId, aggregateType: "market_context_snapshot",
      eventType: "market.context.snapshot.published", occurredAt: snapshot.createdAt,
      source: "market-context-application", correlationId: snapshot.marketContextSnapshotId,
      causationId: snapshot.taskId, payload: snapshot,
    }, client);
    await this.eventOutbox.append({
      aggregateId: brief.marketDeskBriefId, aggregateType: "market_desk_brief",
      eventType: "market.desk.brief.published", occurredAt: brief.createdAt,
      source: "market-context-application", correlationId: snapshot.marketContextSnapshotId,
      causationId: snapshot.marketContextSnapshotId, payload: brief,
    }, client);
  }

  async #appendInvalidationEvents(client, invalidated, replacement) {
    if (!this.eventOutbox) return;
    for (const item of invalidated.snapshots) {
      await this.eventOutbox.append({
        aggregateId: item.market_context_snapshot_id, aggregateType: "market_context_snapshot",
        eventType: "market.context.snapshot.invalidated", occurredAt: replacement.createdAt,
        source: "market-context-application", correlationId: replacement.marketContextSnapshotId,
        causationId: replacement.taskId,
        payload: { snapshotId: item.market_context_snapshot_id, supersededBy: replacement.marketContextSnapshotId, reasonCode: "SUPERSEDED" },
      }, client);
    }
    for (const item of invalidated.briefs) {
      await this.eventOutbox.append({
        aggregateId: item.market_desk_brief_id, aggregateType: "market_desk_brief",
        eventType: "market.desk.brief.invalidated", occurredAt: replacement.createdAt,
        source: "market-context-application", correlationId: replacement.marketContextSnapshotId,
        causationId: replacement.taskId,
        payload: { briefId: item.market_desk_brief_id, supersededBySnapshotId: replacement.marketContextSnapshotId, reasonCode: "SUPERSEDED" },
      }, client);
    }
  }

  async #ready() {
    if (!this.pool) throw coded("MARKET_CONTEXT_REPOSITORY_UNAVAILABLE");
    await this.persistence.initialized;
  }
}

async function readCurrentRecords(pool, { universe, asOfUtc, readBudgetMs }) {
  const deadline = performance.now() + readBudgetMs;
  const client = await acquireReadClient(pool);
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const core = await readCore(client, { universe, deadline });
    const enrichment = await readEnrichments(client, { universe, asOfUtc, deadline });
    await client.query("COMMIT");
    return { core, ...enrichment };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw sanitizeCoreReadError(error);
  } finally {
    client.release();
  }
}

async function acquireReadClient(pool) {
  try {
    return await pool.connect();
  } catch (error) {
    throw coded(isPoolCheckoutTimeout(error)
      ? "MARKET_CONTEXT_POOL_CHECKOUT_TIMEOUT"
      : "MARKET_CONTEXT_READ_UNAVAILABLE", error);
  }
}

async function readCore(client, { universe, deadline }) {
  const remaining = remainingBudget(deadline);
  if (remaining < MIN_STATEMENT_TIMEOUT_MS) throw coded("MARKET_CONTEXT_READ_BUDGET_EXHAUSTED");
  const timeoutMs = Math.min(CORE_STATEMENT_TIMEOUT_MS, remaining);
  await setLocalStatementTimeout(client, timeoutMs);
  try {
    return await client.query(CURRENT_CONTEXT_SQL, [universe]);
  } finally {
    await client.query("SET LOCAL statement_timeout = 0").catch(() => {});
  }
}

async function readEnrichments(client, { universe, asOfUtc, deadline }) {
  const values = {};
  const diagnostics = [];
  const steps = enrichmentSteps(universe, asOfUtc);
  let remainingStatements = steps.reduce((total, step) => total + step.statementCount, 0);
  for (const step of steps) {
    const budget = enrichmentStatementBudget(deadline, remainingStatements);
    remainingStatements -= step.statementCount;
    if (budget < MIN_STATEMENT_TIMEOUT_MS) {
      diagnostics.push(readDiagnostic(step.name, "MARKET_CONTEXT_READ_BUDGET_EXHAUSTED"));
      values[step.name] = null;
      continue;
    }
    const result = await readEnrichment(client, step, budget);
    values[step.name] = result.value;
    if (result.diagnostic) diagnostics.push(result.diagnostic);
  }
  return { values, diagnostics };
}

async function readEnrichment(client, step, timeoutMs) {
  const savepoint = `market_context_${step.name.replaceAll("-", "_")}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  await setLocalStatementTimeout(client, timeoutMs);
  try {
    const value = await step.read(client);
    await client.query("SET LOCAL statement_timeout = 0");
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    return { value, diagnostic: null };
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    return { value: null, diagnostic: readDiagnostic(step.name, enrichmentErrorCode(error)) };
  }
}

function enrichmentSteps(universe, asOfUtc) {
  return [
    { name: "brief-history", statementCount: 1, read: (client) => client.query(`SELECT * FROM market_desk_briefs
      WHERE universe=$1 ORDER BY created_at_utc DESC LIMIT 12`, [universe]) },
    { name: "source-coverage", statementCount: 1, read: (client) => client.query(
      "SELECT * FROM market_source_coverage_manifests ORDER BY source_id") },
    { name: "prefilter-decisions", statementCount: 1, read: (client) => client.query(`SELECT market_context_prefilter_decision_id,
      market_context_snapshot_id, signal_id, decision, reason_codes, source_data_cutoff_utc, decided_at_utc
      FROM market_context_prefilter_decisions
      WHERE universe=$1 AND decided_at_utc >= $2::timestamptz - interval '24 hours'
      ORDER BY decided_at_utc DESC LIMIT 500`, [universe, asOfUtc]) },
    { name: "worker-runtime", statementCount: 1, read: (client) => client.query(WORKER_RUNTIME_SQL) },
    { name: "agri-calendar", statementCount: 3, read: (client) => loadCurrentGrainsCalendar(client, asOfUtc) },
  ];
}

const WORKER_RUNTIME_SQL = `SELECT m.model_policy,
  count(t.agent_task_id)::int AS task_count,
  count(*) FILTER (WHERE t.status='DONE')::int AS success_count,
  count(*) FILTER (WHERE t.status IN ('ERROR','CANCELLED'))::int AS failure_count,
  count(*) FILTER (WHERE t.status IN ('READY','CLAIMED','RUNNING'))::int AS active_count,
  coalesce(sum(greatest(t.attempt_count - 1, 0)),0)::bigint AS retry_count,
  max(t.completed_at_utc) AS last_completed_at,
  avg(r.total_latency_ms)::bigint AS average_latency_ms,
  coalesce(sum(r.total_tokens),0)::bigint AS total_tokens,
  coalesce(sum(r.cost_micros_usd),0)::bigint AS cost_micros_usd
  FROM agent_missions m
  LEFT JOIN agent_tasks t ON t.agent_mission_id=m.agent_mission_id
    AND t.task_type='LIVE_US_GRAINS_MARKET_CONTEXT_REFRESH'
  LEFT JOIN agent_task_run_metrics r ON r.agent_task_id=t.agent_task_id
  WHERE m.mission_key='us-grains-market-context-live'
  GROUP BY m.agent_mission_id, m.model_policy`;

function mapCurrentRecords(records, { universe, asOfUtc }) {
  const core = records.core.rows[0] || {};
  const briefHistoryRows = records.values["brief-history"]?.rows;
  const coverageRows = records.values["source-coverage"]?.rows;
  const prefilterRows = records.values["prefilter-decisions"]?.rows;
  const workerRows = records.values["worker-runtime"]?.rows;
  const calendar = records.values["agri-calendar"];
  const fallbackHistory = core.brief ? [core.brief] : [];
  return {
    universe,
    snapshot: mapSnapshot(core.snapshot, asOfUtc),
    brief: mapBrief(core.brief, asOfUtc),
    briefHistory: mapBriefHistoryRows(briefHistoryRows || fallbackHistory, asOfUtc),
    sourceStates: mapSourceStates(coverageRows, calendar),
    agriEvents: calendar?.events ?? null,
    prefilterDecisions: prefilterRows ? prefilterRows.map(mapPrefilterDecision) : null,
    workerRuntime: workerRows?.[0] ? mapWorkerRuntime(workerRows[0], asOfUtc) : null,
    readStatus: records.diagnostics.length ? "PARTIAL" : "AVAILABLE",
    readDiagnostics: records.diagnostics,
    asOf: asOfUtc,
  };
}

function mapBriefHistoryRows(rows, asOfUtc) {
  return rows.map((row, index, history) => mapBriefHistory(
    row, asOfUtc, index === 0,
    index === 0 ? null : history[index - 1]?.market_desk_brief_id || null,
  ));
}

function mapSourceStates(coverageRows, calendar) {
  const coverage = Array.isArray(coverageRows)
    ? coverageRows.filter((row) => row.source_id !== "market_agri_events").map(mapCoverage)
    : [];
  return calendar?.sourceState ? [...coverage, calendar.sourceState] : coverage;
}

function enrichmentStatementBudget(deadline, remainingStatements) {
  const remaining = remainingBudget(deadline);
  if (remainingStatements <= 0) return 0;
  return Math.min(MAX_ENRICHMENT_STATEMENT_TIMEOUT_MS, Math.floor(remaining / remainingStatements));
}

function remainingBudget(deadline) {
  return Math.max(0, deadline - performance.now() - READ_BUDGET_RESERVE_MS);
}

function boundedReadBudget(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(500, Math.min(60_000, Math.trunc(parsed))) : DEFAULT_READ_BUDGET_MS;
}

function setLocalStatementTimeout(client, timeoutMs) {
  const bounded = Math.max(MIN_STATEMENT_TIMEOUT_MS, Math.trunc(timeoutMs));
  return client.query(`SET LOCAL statement_timeout = '${bounded}ms'`);
}

function readDiagnostic(component, code) {
  return { component, status: "UNAVAILABLE", code };
}

function enrichmentErrorCode(error) {
  return error?.code === "57014"
    ? "MARKET_CONTEXT_ENRICHMENT_TIMEOUT"
    : "MARKET_CONTEXT_ENRICHMENT_UNAVAILABLE";
}

function sanitizeCoreReadError(error) {
  if (String(error?.code || "").startsWith("MARKET_CONTEXT_")) return error;
  return coded(error?.code === "57014" ? "MARKET_CONTEXT_CORE_TIMEOUT" : "MARKET_CONTEXT_CORE_READ_UNAVAILABLE", error);
}

function isPoolCheckoutTimeout(error) {
  return error?.message === "timeout exceeded when trying to connect";
}

async function invalidateCurrent(client, snapshot) {
  const snapshots = await client.query(`UPDATE market_context_snapshots SET status='INVALIDATED',
    invalidation_reason='SUPERSEDED', revision=revision+1,
    payload=payload || '{"status":"INVALIDATED","invalidationReason":"SUPERSEDED"}'::jsonb
    WHERE universe=$1 AND status='AVAILABLE' AND market_context_snapshot_id<>$2
    RETURNING market_context_snapshot_id`,
  [snapshot.universe, snapshot.marketContextSnapshotId]);
  const snapshotIds = snapshots.rows.map((row) => row.market_context_snapshot_id);
  const briefs = snapshotIds.length ? await client.query(`UPDATE market_desk_briefs SET status='INVALIDATED',
    invalidation_reason='SUPERSEDED', revision=revision+1,
    payload=payload || '{"status":"INVALIDATED","invalidationReason":"SUPERSEDED"}'::jsonb
    WHERE market_context_snapshot_id = ANY($1::text[]) AND status='AVAILABLE'
    RETURNING market_desk_brief_id`, [snapshotIds]) : { rows: [] };
  return { snapshots: snapshots.rows, briefs: briefs.rows };
}

async function insertSnapshot(client, value) {
  await client.query(`INSERT INTO market_context_snapshots (
    market_context_snapshot_id, schema_version, universe, status, created_at_utc,
    valid_from_utc, valid_until_utc, source_data_cutoff_utc, market_state, market_session,
    supersedes_snapshot_id, invalidation_reason, worker_id, agent_task_id,
    model_policy_version, prompt_version, payload, payload_hash, correlation_id, causation_id
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20)
  ON CONFLICT (market_context_snapshot_id) DO NOTHING`, [
    value.marketContextSnapshotId, value.schemaVersion, value.universe, value.status,
    value.createdAt, value.validFrom, value.validUntil, value.sourceDataCutoff,
    value.marketState, value.marketSession, value.supersedesSnapshotId,
    value.invalidationReason, value.workerId, uuidOrNull(value.taskId), value.modelPolicyVersion,
    value.promptVersion, JSON.stringify(value), hash(value), value.marketContextSnapshotId, value.taskId,
  ]);
}

async function insertBrief(client, value) {
  await client.query(`INSERT INTO market_desk_briefs (
    market_desk_brief_id, market_context_snapshot_id, schema_version, universe, status,
    created_at_utc, valid_from_utc, valid_until_utc, source_data_cutoff_utc,
    supersedes_brief_id, invalidation_reason, worker_id, agent_task_id,
    model_policy_version, prompt_version, payload, payload_hash, correlation_id, causation_id
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19)
  ON CONFLICT (market_desk_brief_id) DO NOTHING`, [
    value.marketDeskBriefId, value.marketContextSnapshotId, value.schemaVersion, value.universe,
    value.status, value.createdAt, value.validFrom, value.validUntil, value.sourceDataCutoff,
    value.supersedesBriefId, value.invalidationReason, value.workerId, uuidOrNull(value.taskId),
    value.modelPolicyVersion, value.promptVersion, JSON.stringify(value), hash(value),
    value.marketContextSnapshotId, value.marketContextSnapshotId,
  ]);
}

function mapSnapshot(row, nowUtc) {
  if (!row) return null;
  const payload = row.payload || {};
  const expired = new Date(row.valid_until_utc).getTime() < Date.parse(nowUtc);
  return { ...payload, status: expired && payload.status === "AVAILABLE" ? "STALE" : payload.status };
}

function mapBrief(row, nowUtc) {
  if (!row) return null;
  const payload = row.payload || {};
  const expired = new Date(row.valid_until_utc).getTime() < Date.parse(nowUtc);
  return { ...payload, status: expired && payload.status === "AVAILABLE" ? "STALE" : payload.status };
}

function mapBriefHistory(row, nowUtc, current, supersededBy) {
  return {
    ...mapBrief(row, nowUtc),
    revision: Number(row.revision || 0),
    historical: !current,
    current,
    supersededBy,
    invalidationReason: row.invalidation_reason || row.payload?.invalidationReason || null,
  };
}

function mapCoverage(row = {}) {
  return normalizeMarketSourceStateV1({
    sourceId: row.source_id, sourceType: row.source_type, status: row.source_status,
    requiredFor: row.required_for,
    coverageStart: row.coverage_start_utc, coverageEnd: row.coverage_end_utc,
    asOf: row.as_of_utc, dataCutoff: row.data_cutoff_utc, lastSuccessfulAt: row.last_successful_import_at_utc,
    provider: row.provider, datasetVersion: row.dataset_version, missingness: row.missingness,
    reasonCodes: row.reason_codes,
  }, { cutoff: row.data_cutoff_utc || row.as_of_utc });
}

function mapPrefilterDecision(row = {}) {
  return {
    marketContextPrefilterDecisionId: row.market_context_prefilter_decision_id,
    marketContextSnapshotId: row.market_context_snapshot_id,
    signalId: row.signal_id,
    decision: row.decision,
    reasonCodes: row.reason_codes || [],
    sourceDataCutoff: row.source_data_cutoff_utc,
    decidedAt: row.decided_at_utc,
  };
}

function mapWorkerRuntime(row, nowUtc) {
  const policy = row?.model_policy || {};
  return {
    availability: "AVAILABLE",
    reasonCodes: [],
    taskType: "LIVE_US_GRAINS_MARKET_CONTEXT_REFRESH",
    lane: "live",
    cadenceMinutes: { marketOpen: 30, marketClosed: 60 },
    timeoutMs: Number(policy.timeout_ms || 780_000),
    modelPolicy: policy,
    taskCount: Number(row?.task_count || 0),
    successCount: Number(row?.success_count || 0),
    failureCount: Number(row?.failure_count || 0),
    activeCount: Number(row?.active_count || 0),
    lastCompletedAt: row?.last_completed_at || null,
    lastSuccessfulBriefAt: row?.last_completed_at || null,
    briefAgeSeconds: row?.last_completed_at ? Math.max(0, Math.round((Date.parse(nowUtc) - Date.parse(row.last_completed_at)) / 1000)) : null,
    retryCount: Number(row?.retry_count || 0),
    averageLatencyMs: row?.average_latency_ms === null || row?.average_latency_ms === undefined ? null : Number(row.average_latency_ms),
    totalTokens: Number(row?.total_tokens || 0),
    costMicrosUsd: Number(row?.cost_micros_usd || 0),
  };
}

function hash(value) { return `sha256:${canonicalSha256(value)}`; }
function uuidOrNull(value) { return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(value || "")) ? value : null; }
function coded(code, cause = null) {
  const error = new Error(code, cause ? { cause } : undefined);
  error.code = code;
  return error;
}
