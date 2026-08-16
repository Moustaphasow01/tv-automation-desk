import { canonicalSha256 } from "@tv-automation/desk-domain";
import { DomainEventOutboxRepository } from "./domain-event-outbox-repository.js";

export class PostgresAiContextGateRepository {
  constructor(persistence) {
    this.persistence = persistence;
    this.pool = persistence?.pool || null;
    this.domainEvents = this.pool ? new DomainEventOutboxRepository(persistence) : null;
  }

  get available() { return Boolean(this.pool); }

  async ready() {
    if (!this.pool) throw repositoryError("AI_CONTEXT_GATE_REPOSITORY_UNAVAILABLE", "AI Context Gate repository is unavailable.");
    await this.persistence.initialized;
  }

  async recordDecision(input = {}) {
    await this.ready();
    const record = normalizeDecisionRecord(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await one(client, "SELECT * FROM ai_context_gate_decisions WHERE idempotency_key = $1", [record.idempotency_key]);
      if (existing) {
        await client.query("COMMIT");
        return { status: "IDEMPOTENT", decision: existing };
      }
      await insertDecision(client, record);
      await insertEvents(client, record);
      await this.domainEvents.append({
        aggregateId: record.ai_context_gate_decision_id,
        aggregateType: "ai_context_decision",
        eventType: "ai_context.decision.created",
        occurredAt: record.decided_at_utc,
        correlationId: record.correlation_id || `ai-context:${record.ai_context_gate_decision_id}`,
        causationId: record.signal_id || record.candidate_allocation_id || record.agent_task_id || null,
        source: "ai-context-gate",
        payload: {
          decisionId: record.ai_context_gate_decision_id,
          signalId: record.signal_id,
          candidateAllocationId: record.candidate_allocation_id,
          recommendation: record.recommendation,
          status: record.status,
          reasonCodes: record.reason_codes,
          fallbackApplied: record.fallback_applied,
          decidedAt: record.decided_at_utc,
        },
      }, client);
      await client.query("COMMIT");
      return { status: "RECORDED", decision: record };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listDecisions({ limit = 100 } = {}) {
    await this.ready();
    const result = await this.pool.query(
      "SELECT * FROM ai_context_gate_decisions ORDER BY decided_at_utc DESC, created_at_utc DESC LIMIT $1",
      [Math.max(1, Math.min(500, Number(limit) || 100))],
    );
    return { items: result.rows };
  }
}

export class InMemoryAiContextGateRepository {
  constructor() {
    this.decisions = new Map();
    this.idempotency = new Map();
    this.events = [];
  }

  get available() { return true; }

  async recordDecision(input = {}) {
    const record = normalizeDecisionRecord(input);
    if (this.idempotency.has(record.idempotency_key)) {
      return { status: "IDEMPOTENT", decision: this.decisions.get(this.idempotency.get(record.idempotency_key)) };
    }
    this.decisions.set(record.ai_context_gate_decision_id, clone(record));
    this.idempotency.set(record.idempotency_key, record.ai_context_gate_decision_id);
    this.events.push(...eventRows(record).map(clone));
    return { status: "RECORDED", decision: record };
  }

  async listDecisions({ limit = 100 } = {}) {
    return { items: [...this.decisions.values()].sort((a, b) => b.decided_at_utc.localeCompare(a.decided_at_utc)).slice(0, limit) };
  }
}

export function createAiContextGateRepository(persistence) {
  return persistence?.pool ? new PostgresAiContextGateRepository(persistence) : new InMemoryAiContextGateRepository();
}

export function normalizeDecisionRecord(input = {}) {
  const result = object(input.result || input.decision || input);
  const advisory = object(result.advisory);
  const subject = object(advisory.subject);
  const retry = object(result.retry);
  const idempotencyKey = text(input.idempotency_key || input.idempotencyKey)
    || `ai-context:${hash({ execution_hash: result.execution_hash, subject, as_of_utc: result.as_of_utc })}`;
  const payload = result;
  const id = text(input.ai_context_gate_decision_id || input.decision_id)
    || `aictx_dec_${canonicalSha256({ idempotency_key: idempotencyKey }).slice(0, 24)}`;
  return {
    ai_context_gate_decision_id: id,
    idempotency_key: idempotencyKey,
    correlation_id: text(input.correlation_id || input.correlationId) || null,
    ...subjectColumns(input, subject),
    mode: upper(result.mode || "SHADOW"),
    status: upper(result.status || "FALLBACK_WAIT"),
    recommendation: upper(advisory.recommendation || result.recommendation || "WAIT"),
    ...decisionColumns(result, advisory, retry),
    payload_hash: hash(payload),
    payload,
    decided_at_utc: iso(result.as_of_utc || input.decided_at_utc || input.decidedAtUtc),
  };
}

function subjectColumns(input, subject) {
  return {
    agent_task_id: text(input.agent_task_id || input.agentTaskId) || null,
    signal_id: text(subject.signal_id || input.signal_id || input.signalId) || null,
    candidate_allocation_id: text(subject.candidate_allocation_id || input.candidate_allocation_id || input.candidateAllocationId) || null,
    position_id: text(subject.position_id || input.position_id || input.positionId) || null,
  };
}

function decisionColumns(result, advisory, retry) {
  return {
    confidence: numberOrNull(advisory.confidence),
    risk_multiplier: number(advisory.risk_multiplier),
    fallback_applied: result.fallback_applied === true,
    fallback_reason: text(result.fallback_reason) || null,
    retry_allowed: retry.retry_allowed === true,
    retry_attempt: integer(retry.attempt),
    max_retry_attempts: integer(retry.max_attempts),
    policy_version: text(result.policy_version),
    model_policy_version: text(result.model_policy_version) || null,
    model_ref: text(advisory.model_ref) || null,
    advisory_hash: text(advisory.advisory_hash) || null,
    execution_hash: text(result.execution_hash),
    isolation_proof_hash: text(result.isolation?.proof_hash) || null,
    reason_codes: array(advisory.reason_codes),
    anomalies: array(advisory.anomalies),
    rationale: text(advisory.rationale),
  };
}

async function insertDecision(client, record) {
  await client.query(`INSERT INTO ai_context_gate_decisions (
      ai_context_gate_decision_id, idempotency_key, agent_task_id, signal_id,
      candidate_allocation_id, position_id, mode, status, recommendation, confidence,
      risk_multiplier, fallback_applied, fallback_reason, retry_allowed, retry_attempt,
      max_retry_attempts, policy_version, model_policy_version, model_ref, advisory_hash,
      execution_hash, isolation_proof_hash, reason_codes, anomalies, rationale,
      payload_hash, payload, decided_at_utc
    ) VALUES (
      $1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
      $21,$22,$23,$24,$25,$26,$27::jsonb,$28
    )`, [
    record.ai_context_gate_decision_id, record.idempotency_key, record.agent_task_id,
    record.signal_id, record.candidate_allocation_id, record.position_id, record.mode,
    record.status, record.recommendation, record.confidence, record.risk_multiplier,
    record.fallback_applied, record.fallback_reason, record.retry_allowed, record.retry_attempt,
    record.max_retry_attempts, record.policy_version, record.model_policy_version, record.model_ref,
    record.advisory_hash, record.execution_hash, record.isolation_proof_hash, record.reason_codes,
    record.anomalies, record.rationale, record.payload_hash, json(record.payload), record.decided_at_utc,
  ]);
}

async function insertEvents(client, record) {
  for (const event of eventRows(record)) {
    await client.query(`INSERT INTO ai_context_gate_events (
        ai_context_gate_event_id, ai_context_gate_decision_id, event_type,
        occurred_at_utc, payload_hash, payload
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`, [
      event.ai_context_gate_event_id, event.ai_context_gate_decision_id, event.event_type,
      event.occurred_at_utc, event.payload_hash, json(event.payload),
    ]);
  }
}

function eventRows(record) {
  const base = {
    status: record.status,
    fallback_reason: record.fallback_reason,
    retry_allowed: record.retry_allowed,
    recommendation: record.recommendation,
  };
  const types = [
    "DECISION_RECORDED",
    ...(record.fallback_applied ? ["FALLBACK_APPLIED"] : []),
    ...(record.retry_allowed ? ["RETRY_PLANNED"] : []),
    ...(record.status === "ENFORCED_BLOCKED" ? ["ENFORCEMENT_BLOCKED"] : []),
  ];
  return types.map((eventType) => {
    const payload = { ...base, event_type: eventType };
    return {
      ai_context_gate_event_id: `aictx_evt_${canonicalSha256({ decision_id: record.ai_context_gate_decision_id, event_type: eventType, payload }).slice(0, 24)}`,
      ai_context_gate_decision_id: record.ai_context_gate_decision_id,
      event_type: eventType,
      occurred_at_utc: record.decided_at_utc,
      payload_hash: hash(payload),
      payload,
    };
  });
}

async function one(client, sql, params = []) { return (await client.query(sql, params)).rows[0] || null; }
function repositoryError(code, message) { const error = new Error(message || code); error.code = code; error.statusCode = 503; return error; }
function hash(value) { return `sha256:${canonicalSha256(value)}`; }
function json(value) { return JSON.stringify(value ?? {}); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : []; }
function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).toUpperCase(); }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function numberOrNull(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function integer(value) { return Math.max(0, Math.trunc(number(value))); }
function iso(value) {
  const parsed = Date.parse(value || "");
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  throw repositoryError("AI_CONTEXT_GATE_DECIDED_AT_REQUIRED", "AI Context Gate decision requires an explicit timestamp.");
}
