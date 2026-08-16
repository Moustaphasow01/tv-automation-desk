import { canonicalSha256 } from "@tv-automation/desk-domain";

export class StrategyEvaluationRuntimeRepository {
  constructor(persistence, { eventOutbox } = {}) {
    this.persistence = persistence;
    this.pool = persistence?.pool || null;
    this.eventOutbox = eventOutbox || null;
  }

  async ready() {
    if (!this.pool) throw coded("STRATEGY_EVALUATION_REPOSITORY_UNAVAILABLE", "Strategy evaluation repository is unavailable.");
    await this.persistence.initialized;
  }

  async record(input = {}) {
    await this.ready();
    const record = normalize(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(`INSERT INTO strategy_runtime_evaluations (
          strategy_evaluation_id, strategy_instance_id, strategy_version_id,
          certification_run_id, source_class, status, scheduler_run_key,
          correlation_id, causation_id, artifact_version, instrument, timeframe,
          source_data_cutoff_utc, started_at_utc, completed_at_utc,
          next_evaluation_at_utc, signal_id, reason_codes, payload_hash, payload
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb)
        ON CONFLICT (scheduler_run_key) DO UPDATE SET scheduler_run_key=strategy_runtime_evaluations.scheduler_run_key
        RETURNING *`, [
        record.strategy_evaluation_id, record.strategy_instance_id, record.strategy_version_id,
        record.certification_run_id, record.source_class, record.status, record.scheduler_run_key,
        record.correlation_id, record.causation_id, record.artifact_version, record.instrument,
        record.timeframe, record.source_data_cutoff_utc, record.started_at_utc,
        record.completed_at_utc, record.next_evaluation_at_utc, record.signal_id,
        record.reason_codes, record.payload_hash, JSON.stringify(record.payload),
      ]);
      if (this.eventOutbox) await this.eventOutbox.append({
        aggregateId: record.strategy_instance_id,
        aggregateType: "strategy_instance",
        eventType: "strategy.evaluation.completed",
        occurredAt: record.completed_at_utc,
        correlationId: record.correlation_id,
        causationId: record.causation_id,
        source: "strategy-evaluation-runtime",
        payload: {
          strategyEvaluationId: record.strategy_evaluation_id,
          strategyInstanceId: record.strategy_instance_id,
          status: record.status,
          sourceClass: record.source_class,
          sourceDataCutoff: record.source_data_cutoff_utc,
          signalId: record.signal_id,
        },
      }, client);
      await client.query("COMMIT");
      return result.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async listRecent({ limit = 100, certificationRunId = null } = {}) {
    await this.ready();
    const result = await this.pool.query(`SELECT * FROM strategy_runtime_evaluations
      WHERE ($1::text IS NULL OR certification_run_id=$1)
      ORDER BY completed_at_utc DESC LIMIT $2`, [certificationRunId || null, Math.max(1, Math.min(500, Number(limit) || 100))]);
    return result.rows;
  }
}

function normalize(input) {
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const identity = { strategy_instance_id: input.strategy_instance_id, scheduler_run_key: input.scheduler_run_key };
  return {
    strategy_evaluation_id: String(input.strategy_evaluation_id || `strategy_eval_${canonicalSha256(identity).slice(0, 24)}`),
    strategy_instance_id: input.strategy_instance_id,
    strategy_version_id: input.strategy_version_id,
    certification_run_id: input.certification_run_id || null,
    source_class: String(input.source_class || "SHADOW").toUpperCase(),
    status: String(input.status || "NO_SIGNAL").toUpperCase(),
    scheduler_run_key: String(input.scheduler_run_key),
    correlation_id: String(input.correlation_id),
    causation_id: input.causation_id || null,
    artifact_version: input.artifact_version || null,
    instrument: String(input.instrument || "MNQ").toUpperCase(),
    timeframe: String(input.timeframe || "5"),
    source_data_cutoff_utc: iso(input.source_data_cutoff_utc),
    started_at_utc: iso(input.started_at_utc),
    completed_at_utc: iso(input.completed_at_utc),
    next_evaluation_at_utc: input.next_evaluation_at_utc ? iso(input.next_evaluation_at_utc) : null,
    signal_id: input.signal_id || null,
    reason_codes: Array.isArray(input.reason_codes) ? input.reason_codes.map(String) : [],
    payload_hash: `sha256:${canonicalSha256(payload)}`,
    payload,
  };
}
function iso(value) { const parsed=Date.parse(value||""); if (!Number.isFinite(parsed)) throw coded("STRATEGY_EVALUATION_TIMESTAMP_REQUIRED", "Strategy evaluation timestamp is required."); return new Date(parsed).toISOString(); }
function coded(code,message){const error=new Error(message||code);error.code=code;return error;}
