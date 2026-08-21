import { randomUUID } from "node:crypto";

export class PostgresResearchExperimentRegistryRepository {
  constructor(persistence) {
    this.persistence = persistence;
    this.pool = persistence?.pool || null;
  }

  get available() { return Boolean(this.pool); }

  async ready() {
    if (!this.pool) throw repositoryError("RESEARCH_REGISTRY_UNAVAILABLE", "PostgreSQL Research Registry repository is unavailable.");
    await this.persistence.initialized;
  }

  async transaction(lockKey, operation) {
    await this.ready();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockKey]);
      const scoped = new PostgresResearchExperimentRegistryRepository({ initialized: Promise.resolve(), pool: transactionPool(client) });
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

  async findExperiment(id) {
    await this.ready();
    return normalizeExperimentRow(await one(this.pool, `SELECT ${EXPERIMENT_COLUMNS} FROM research_experiments WHERE research_experiment_id = $1`, [id]));
  }

  async findHypothesis(id) {
    await this.ready();
    return normalizeHypothesisRow(await one(this.pool, `SELECT ${HYPOTHESIS_COLUMNS} FROM research_hypotheses WHERE research_hypothesis_id = $1`, [id]));
  }

  async findCandidate(id) {
    await this.ready();
    return normalizeCandidateRow(await one(this.pool, `SELECT ${CANDIDATE_COLUMNS} FROM research_candidates WHERE research_candidate_id = $1`, [id]));
  }

  async findEvaluationReport(id) {
    await this.ready();
    return normalizeEvaluationReportRow(await one(this.pool, `SELECT ${EVALUATION_COLUMNS} FROM research_evaluation_reports WHERE research_evaluation_report_id = $1`, [id]));
  }

  async findEvaluationReportByBusinessKey({ researchCandidateId, reportKind, simulationRunId } = {}) {
    await this.ready();
    return normalizeEvaluationReportRow(await one(this.pool, `SELECT ${EVALUATION_COLUMNS} FROM research_evaluation_reports
      WHERE research_candidate_id = $1
        AND report_kind = $2::research_evaluation_report_kind
        AND simulation_run_id = $3
      LIMIT 1`, [researchCandidateId, reportKind, simulationRunId]));
  }

  async listExperiments(filters = {}) {
    await this.ready();
    return rows(this.pool, `SELECT ${EXPERIMENT_COLUMNS} FROM research_experiments
      WHERE ($1::research_experiment_status IS NULL OR status = $1::research_experiment_status)
        AND ($2::text IS NULL OR owner = $2)
      ORDER BY created_at_utc DESC LIMIT $3`, [filters.status || null, emptyToNull(filters.owner), bounded(filters.limit)])
      .then((items) => items.map(normalizeExperimentRow));
  }

  async listHypotheses(filters = {}) {
    await this.ready();
    return rows(this.pool, `SELECT ${HYPOTHESIS_COLUMNS} FROM research_hypotheses
      WHERE ($1::uuid IS NULL OR research_experiment_id = $1)
        AND ($2::research_hypothesis_status IS NULL OR status = $2::research_hypothesis_status)
      ORDER BY created_at_utc DESC LIMIT $3`, [emptyToNull(filters.researchExperimentId), filters.status || null, bounded(filters.limit)])
      .then((items) => items.map(normalizeHypothesisRow));
  }

  async listCandidates(filters = {}) {
    await this.ready();
    return rows(this.pool, `SELECT ${CANDIDATE_COLUMNS} FROM research_candidates
      WHERE ($1::uuid IS NULL OR research_experiment_id = $1)
        AND ($2::uuid IS NULL OR research_hypothesis_id = $2)
        AND ($3::uuid IS NULL OR research_candidate_id = $3)
        AND ($4::research_candidate_status IS NULL OR status = $4::research_candidate_status)
        AND ($6::uuid IS NULL OR strategy_version_id = $6)
      ORDER BY created_at_utc DESC LIMIT $5`, [emptyToNull(filters.researchExperimentId), emptyToNull(filters.researchHypothesisId), emptyToNull(filters.researchCandidateId), filters.status || null, bounded(filters.limit), emptyToNull(filters.strategyVersionId)])
      .then((items) => items.map(normalizeCandidateRow));
  }

  async listEvaluationReports(filters = {}) {
    await this.ready();
    return rows(this.pool, `SELECT ${EVALUATION_COLUMNS} FROM research_evaluation_reports
      WHERE ($1::uuid IS NULL OR research_experiment_id = $1)
        AND ($2::uuid IS NULL OR research_candidate_id = $2)
        AND ($3::research_evaluation_verdict IS NULL OR verdict = $3::research_evaluation_verdict)
        AND ($4::research_evaluation_report_kind IS NULL OR report_kind = $4::research_evaluation_report_kind)
      ORDER BY created_at_utc DESC LIMIT $5`, [emptyToNull(filters.researchExperimentId), emptyToNull(filters.researchCandidateId), filters.verdict || null, filters.reportKind || null, bounded(filters.limit)])
      .then((items) => items.map(normalizeEvaluationReportRow));
  }

  async upsertExperiment(entity) {
    await this.ready();
    const row = await one(this.pool, `INSERT INTO research_experiments (${EXPERIMENT_COLUMNS})
      VALUES ($1,$2,$3,$4,$5,$6::research_experiment_status,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14)
      ON CONFLICT (research_experiment_id) DO UPDATE SET
        status = EXCLUDED.status, winner_simulation_run_id = EXCLUDED.winner_simulation_run_id,
        metadata = EXCLUDED.metadata, updated_at_utc = EXCLUDED.updated_at_utc, completed_at_utc = EXCLUDED.completed_at_utc
      RETURNING ${EXPERIMENT_COLUMNS}`, [
      entity.research_experiment_id, entity.experiment_key, entity.name, entity.objective, entity.owner, entity.status,
      entity.comparison_metric, entity.winner_simulation_run_id, entity.candidate_selection_cutoff_utc, json(entity.budget),
      json(entity.metadata), entity.created_at_utc, entity.updated_at_utc, entity.completed_at_utc,
    ]);
    return normalizeExperimentRow(row);
  }

  async upsertHypothesis(entity) {
    await this.ready();
    const row = await one(this.pool, `INSERT INTO research_hypotheses (${HYPOTHESIS_COLUMNS})
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::research_hypothesis_status,$12,$13,$14::jsonb,$15,$16)
      ON CONFLICT (research_hypothesis_id) DO UPDATE SET
        status = EXCLUDED.status, confidence_score = EXCLUDED.confidence_score, metadata = EXCLUDED.metadata, updated_at_utc = EXCLUDED.updated_at_utc
      RETURNING ${HYPOTHESIS_COLUMNS}`, [
      entity.research_hypothesis_id, entity.research_experiment_id, entity.statement, entity.falsifiable_question,
      entity.instrument_scope, entity.timeframe_scope, entity.population_scope, json(entity.variable_set), entity.expected_outcome,
      entity.invalidation_criteria, entity.status, entity.confidence_score, entity.source_agent_mission_id, json(entity.metadata),
      entity.created_at_utc, entity.updated_at_utc,
    ]);
    return normalizeHypothesisRow(row);
  }

  async upsertCandidate(entity) {
    await this.ready();
    const row = await one(this.pool, `INSERT INTO research_candidates (${CANDIDATE_COLUMNS})
      VALUES ($1,$2,$3,$4,$5::research_candidate_source_type,$6::research_candidate_status,$7,$8,$9,$10,$11,$12,$13::research_evaluation_verdict,$14,$15,$16::jsonb,$17,$18)
      ON CONFLICT (research_candidate_id) DO UPDATE SET
        status = EXCLUDED.status, evaluation_score = EXCLUDED.evaluation_score,
        last_evaluation_verdict = EXCLUDED.last_evaluation_verdict, promotion_blocked = EXCLUDED.promotion_blocked,
        promotion_block_reason = EXCLUDED.promotion_block_reason, metadata = EXCLUDED.metadata, updated_at_utc = EXCLUDED.updated_at_utc
      RETURNING ${CANDIDATE_COLUMNS}`, [
      entity.research_candidate_id, entity.research_experiment_id, entity.research_hypothesis_id, entity.candidate_key,
      entity.source_type, entity.status, entity.strategy_definition_id, entity.strategy_version_id, entity.primary_change_summary,
      entity.deterministic_plan_ref, entity.novelty_score, entity.evaluation_score, entity.last_evaluation_verdict,
      entity.promotion_blocked, entity.promotion_block_reason, json(entity.metadata), entity.created_at_utc, entity.updated_at_utc,
    ]);
    return normalizeCandidateRow(row);
  }

  async upsertEvaluationReport(entity) {
    await this.ready();
    const row = await one(this.pool, `INSERT INTO research_evaluation_reports (${EVALUATION_COLUMNS})
      VALUES ($1,$2,$3,$4,$5::research_evaluation_report_kind,$6::research_evaluation_verdict,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12::jsonb,$13)
      ON CONFLICT (research_evaluation_report_id) DO UPDATE SET research_evaluation_report_id = research_evaluation_reports.research_evaluation_report_id
      RETURNING ${EVALUATION_COLUMNS}`, [
      entity.research_evaluation_report_id, entity.research_experiment_id, entity.research_candidate_id, entity.simulation_run_id,
      entity.report_kind, entity.verdict, entity.score, json(entity.metric_snapshot), json(entity.criteria_snapshot),
      json(entity.artifact_refs), entity.reviewer_ref, json(entity.metadata), entity.created_at_utc,
    ]);
    return normalizeEvaluationReportRow(row);
  }

  async upsertRunLink(entity) {
    await this.ready();
    const row = await one(this.pool, `INSERT INTO research_experiment_run_links (${RUN_LINK_COLUMNS})
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
      ON CONFLICT (research_experiment_id, simulation_run_id, role) DO UPDATE SET
        research_candidate_id = EXCLUDED.research_candidate_id, included_in_selection = EXCLUDED.included_in_selection, metadata = EXCLUDED.metadata
      RETURNING ${RUN_LINK_COLUMNS}`, [
      entity.research_experiment_run_link_id, entity.research_experiment_id, entity.simulation_run_id,
      entity.research_candidate_id, entity.role, entity.included_in_selection, json(entity.metadata), entity.linked_at_utc,
    ]);
    return normalizeRunLinkRow(row);
  }

  async appendAuditEvent(event) {
    await this.ready();
    const row = await one(this.pool, `INSERT INTO research_audit_events (${AUDIT_COLUMNS})
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)
      ON CONFLICT (aggregate_type, aggregate_id, event_type, idempotency_key)
      WHERE idempotency_key IS NOT NULL
      DO UPDATE SET research_audit_event_id = research_audit_events.research_audit_event_id
      RETURNING ${AUDIT_COLUMNS}`, [
      event.research_audit_event_id || randomUUID(), event.aggregate_type, event.aggregate_id, event.event_type,
      event.idempotency_key || null, event.actor, event.reason || null, event.previous_status || null,
      event.next_status || null, event.previous_hash || null, event.next_hash || null, json(event.payload), event.created_at_utc,
    ]);
    return normalizeAuditRow(row);
  }
}

export class DisabledResearchExperimentRegistryRepository {
  get available() { return false; }
  async ready() { throw repositoryError("RESEARCH_REGISTRY_UNAVAILABLE", "Research Registry repository is disabled."); }
  async transaction() { await this.ready(); }
  async findExperiment() { await this.ready(); }
  async findHypothesis() { await this.ready(); }
  async findCandidate() { await this.ready(); }
  async findEvaluationReport() { await this.ready(); }
  async findEvaluationReportByBusinessKey() { await this.ready(); }
  async listExperiments() { await this.ready(); }
  async listHypotheses() { await this.ready(); }
  async listCandidates() { await this.ready(); }
  async listEvaluationReports() { await this.ready(); }
  async upsertExperiment() { await this.ready(); }
  async upsertHypothesis() { await this.ready(); }
  async upsertCandidate() { await this.ready(); }
  async upsertEvaluationReport() { await this.ready(); }
  async upsertRunLink() { await this.ready(); }
  async appendAuditEvent() { await this.ready(); }
}

export function createResearchExperimentRegistryRepository(persistence) {
  return persistence?.pool
    ? new PostgresResearchExperimentRegistryRepository(persistence)
    : new DisabledResearchExperimentRegistryRepository();
}

const EXPERIMENT_COLUMNS = "research_experiment_id, experiment_key, name, objective, owner, status, comparison_metric, winner_simulation_run_id, candidate_selection_cutoff_utc, budget, metadata, created_at_utc, updated_at_utc, completed_at_utc";
const HYPOTHESIS_COLUMNS = "research_hypothesis_id, research_experiment_id, statement, falsifiable_question, instrument_scope, timeframe_scope, population_scope, variable_set, expected_outcome, invalidation_criteria, status, confidence_score, source_agent_mission_id, metadata, created_at_utc, updated_at_utc";
const CANDIDATE_COLUMNS = "research_candidate_id, research_experiment_id, research_hypothesis_id, candidate_key, source_type, status, strategy_definition_id, strategy_version_id, primary_change_summary, deterministic_plan_ref, novelty_score, evaluation_score, last_evaluation_verdict, promotion_blocked, promotion_block_reason, metadata, created_at_utc, updated_at_utc";
const RUN_LINK_COLUMNS = "research_experiment_run_link_id, research_experiment_id, simulation_run_id, research_candidate_id, role, included_in_selection, metadata, linked_at_utc";
const EVALUATION_COLUMNS = "research_evaluation_report_id, research_experiment_id, research_candidate_id, simulation_run_id, report_kind, verdict, score, metric_snapshot, criteria_snapshot, artifact_refs, reviewer_ref, metadata, created_at_utc";
const AUDIT_COLUMNS = "research_audit_event_id, aggregate_type, aggregate_id, event_type, idempotency_key, actor, reason, previous_status, next_status, previous_hash, next_hash, payload, created_at_utc";

export function normalizeExperimentRow(row) {
  if (!row) return null;
  return { ...row, budget: row.budget || {}, metadata: row.metadata || {}, created_at_utc: iso(row.created_at_utc), updated_at_utc: iso(row.updated_at_utc), completed_at_utc: iso(row.completed_at_utc), candidate_selection_cutoff_utc: iso(row.candidate_selection_cutoff_utc) };
}

export function normalizeHypothesisRow(row) {
  if (!row) return null;
  return { ...row, instrument_scope: row.instrument_scope || [], timeframe_scope: row.timeframe_scope || [], variable_set: row.variable_set || {}, metadata: row.metadata || {}, created_at_utc: iso(row.created_at_utc), updated_at_utc: iso(row.updated_at_utc) };
}

export function normalizeCandidateRow(row) {
  if (!row) return null;
  return { ...row, metadata: row.metadata || {}, novelty_score: numberOrNull(row.novelty_score), evaluation_score: numberOrNull(row.evaluation_score), created_at_utc: iso(row.created_at_utc), updated_at_utc: iso(row.updated_at_utc) };
}

export function normalizeEvaluationReportRow(row) {
  if (!row) return null;
  return { ...row, score: numberOrNull(row.score), metric_snapshot: row.metric_snapshot || {}, criteria_snapshot: row.criteria_snapshot || {}, artifact_refs: row.artifact_refs || [], metadata: row.metadata || {}, created_at_utc: iso(row.created_at_utc) };
}

export function normalizeRunLinkRow(row) {
  if (!row) return null;
  return { ...row, metadata: row.metadata || {}, linked_at_utc: iso(row.linked_at_utc) };
}

export function normalizeAuditRow(row) {
  if (!row) return null;
  return { ...row, payload: row.payload || {}, created_at_utc: iso(row.created_at_utc) };
}

function transactionPool(client) {
  return { query: (statement, params) => client.query(statement, params), connect: async () => ({ query: (statement, params) => client.query(statement, params), release: () => {} }) };
}

async function one(pool, statement, params = []) {
  const result = await pool.query(statement, params);
  return result.rows[0] || null;
}

async function rows(pool, statement, params = []) {
  const result = await pool.query(statement, params);
  return result.rows;
}

function json(value) {
  return JSON.stringify(value || {});
}

function emptyToNull(value) {
  return value === "" || value === undefined ? null : value;
}

function bounded(value, fallback = 100, max = 500) {
  const parsed = Number(value);
  return Math.max(1, Math.min(Number.isFinite(parsed) ? Math.trunc(parsed) : fallback, max));
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function repositoryError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  error.statusCode = 503;
  return error;
}
