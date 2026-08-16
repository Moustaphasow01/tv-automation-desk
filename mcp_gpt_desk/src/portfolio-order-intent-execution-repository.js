import {
  activeProviderStatuses,
  boundedLimit,
  clone,
  DEFAULT_REPOSITORY_NOW_UTC,
  intentPayload,
  json,
  normalizeLineage,
  one,
  providerCommandEnvelope,
  repositoryError,
  rows,
  text,
  toSqlCommandType,
} from "./portfolio-order-intent-execution-repository-common.js";
import {
  gateToLineageFields,
  humanGatePersistenceIssue,
  InMemoryHumanExecutionGateRepository,
  PostgresHumanExecutionGateRepository,
} from "./portfolio-order-intent-human-gate-repository.js";
import {
  InMemoryProviderLifecycleRepository,
  PostgresProviderLifecycleRepository,
} from "./portfolio-order-intent-provider-lifecycle-repository.js";
import { DomainEventOutboxRepository } from "./domain-event-outbox-repository.js";

export { intentPayload, normalizeLineage } from "./portfolio-order-intent-execution-repository-common.js";

export class PostgresPortfolioOrderIntentExecutionRepository {
  constructor(persistence) {
    this.persistence = persistence;
    this.pool = persistence?.pool || null;
    this.domainEvents = this.pool ? new DomainEventOutboxRepository(persistence) : null;
    this.humanGateRepository = new PostgresHumanExecutionGateRepository(this);
    this.providerLifecycleRepository = new PostgresProviderLifecycleRepository(this);
  }

  get available() { return Boolean(this.pool); }

  async ready() {
    if (!this.pool) throw repositoryError("EXECUTION_PROVIDER_REPOSITORY_UNAVAILABLE", "Execution provider repository is unavailable.");
    await this.persistence.initialized;
  }

  async listSubmittablePortfolioOrderIntents({ limit = 100, providerId = null, accountId = null } = {}) {
    await this.ready();
    return rows(this.pool, `SELECT l.*, l.payload AS order_intent_payload,
        t.account_id AS target_account_id, t.instrument AS target_instrument,
        t.net_target_size, t.delta_size, t.risk_approved_net_size,
        g.human_execution_gate_id, g.status AS human_gate_status, g.revision AS human_gate_revision,
        g.operator_id AS human_gate_operator_id, g.idempotency_key AS human_gate_idempotency_key,
        g.confirmed_at_utc AS human_gate_confirmed_at_utc, g.rejected_at_utc AS human_gate_rejected_at_utc,
        g.expires_at_utc AS human_gate_expires_at_utc, g.terms_hash AS human_gate_terms_hash,
        array_remove(array_agg(DISTINCT a.candidate_allocation_id), NULL) AS candidate_allocation_ids,
        array_remove(array_agg(DISTINCT r.risk_decision_id), NULL) AS risk_decision_ids
      FROM portfolio_order_intent_lineage l
      JOIN portfolio_target_positions t ON t.target_position_id = l.target_position_id
      LEFT JOIN human_execution_gates g ON g.portfolio_order_intent_id = l.portfolio_order_intent_id
      LEFT JOIN portfolio_target_position_allocations a ON a.target_position_id = t.target_position_id
      LEFT JOIN portfolio_target_position_risk_decisions r ON r.target_position_id = t.target_position_id
      WHERE l.broker_submission_allowed = true
        AND l.status = 'READY'
        AND ($1::text IS NULL OR COALESCE(l.payload->>'provider_id', l.payload #>> '{provider_contract_ref,provider_id}') = $1)
        AND ($2::text IS NULL OR t.account_id = $2 OR l.payload->>'account_id' = $2 OR l.payload->>'broker_account_id' = $2)
      GROUP BY l.portfolio_order_intent_id, t.target_position_id, g.human_execution_gate_id
      ORDER BY l.created_at_utc ASC
      LIMIT $3`, [text(providerId) || null, text(accountId) || null, boundedLimit(limit)]);
  }

  async listActiveProviderCommands({ portfolioOrderIntentId = null, tradeOrderIntentId = null } = {}) {
    await this.ready();
    return rows(this.pool, `SELECT *
      FROM broker_provider_commands
      WHERE status IN ('pending', 'leased', 'sent', 'acknowledged', 'unknown', 'reconciliation_required')
        AND (
          ($1::text IS NOT NULL AND portfolio_order_intent_id = $1)
          OR ($2::text IS NOT NULL AND order_intent_id = $2)
        )
      ORDER BY created_at DESC`, [text(portfolioOrderIntentId) || null, text(tradeOrderIntentId) || null]);
  }

  async persistProviderCommand({ lineage, plan, nowUtc } = {}) {
    await this.ready();
    const command = plan?.provider_command;
    if (!command) throw repositoryError("EXECUTION_PROVIDER_COMMAND_REQUIRED", "A COMMAND_READY provider command is required.");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await one(client, `SELECT *
        FROM portfolio_order_intent_lineage
        WHERE portfolio_order_intent_id = $1
          AND broker_submission_allowed = true
          AND status = 'READY'
        FOR UPDATE`, [lineage.portfolio_order_intent_id]);
      if (!locked) {
        await client.query("COMMIT");
        return { status: "BLOCKED", reason: "PORTFOLIO_ORDER_INTENT_NOT_SUBMITTABLE", provider_command: null };
      }
      const gate = await one(client, `SELECT *
        FROM human_execution_gates
        WHERE portfolio_order_intent_id = $1
        FOR UPDATE`, [lineage.portfolio_order_intent_id]);
      const gateIssue = humanGatePersistenceIssue({ lineage: normalizeLineage({ ...locked, order_intent_payload: locked.payload }), gate, nowUtc });
      if (gateIssue) {
        await client.query(
          `INSERT INTO portfolio_order_intent_execution_states (
            portfolio_order_intent_id, lifecycle_status, payload
          ) VALUES ($1,'BLOCKED',$2::jsonb)
          ON CONFLICT (portfolio_order_intent_id) DO UPDATE SET
            lifecycle_status = 'BLOCKED',
            payload = portfolio_order_intent_execution_states.payload || EXCLUDED.payload,
            revision = portfolio_order_intent_execution_states.revision + 1,
            updated_at_utc = now()`,
          [lineage.portfolio_order_intent_id, json({ reason: gateIssue })],
        );
        await client.query("COMMIT");
        return { status: "BLOCKED", reason: gateIssue, provider_command: null };
      }
      const existing = await one(client, "SELECT * FROM broker_provider_commands WHERE idempotency_key = $1 FOR UPDATE", [command.idempotency_key]);
      if (existing) {
        await client.query("COMMIT");
        return { status: "IDEMPOTENT", provider_command: existing };
      }
      const inserted = await one(client, `INSERT INTO broker_provider_commands (
          execution_provider_command_id, portfolio_order_intent_id, order_intent_id,
          broker_provider_code, broker_account_id, broker_contract_id, command_type,
          status, adapter_id, idempotency_key, command_hash, payload, available_at, expires_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7::execution_provider_command_type,
          'pending',$8,$9,$10,$11::jsonb,$12,$13)
        RETURNING *`, [
        command.execution_provider_command_id,
        lineage.portfolio_order_intent_id,
        lineage.trade_order_intent_id || null,
        command.provider_id,
        command.account_ref?.provider_account_id || command.account_ref?.account_id || null,
        command.contract_ref?.provider_contract_id || null,
        toSqlCommandType(command.command_type),
        command.adapter_id || null,
        command.idempotency_key,
        command.command_hash,
        json(providerCommandEnvelope({ lineage, plan, nowUtc })),
        nowUtc,
        command.expires_at_utc || null,
      ]);
      await client.query(
        `INSERT INTO portfolio_order_intent_execution_states (
          portfolio_order_intent_id, execution_provider_command_id, lifecycle_status, payload
        ) VALUES ($1,$2,'PROVIDER_COMMAND_READY',$3::jsonb)
        ON CONFLICT (portfolio_order_intent_id) DO UPDATE SET
          execution_provider_command_id = EXCLUDED.execution_provider_command_id,
          lifecycle_status = 'PROVIDER_COMMAND_READY',
          payload = portfolio_order_intent_execution_states.payload || EXCLUDED.payload,
          revision = portfolio_order_intent_execution_states.revision + 1,
          updated_at_utc = now()`,
        [lineage.portfolio_order_intent_id, inserted.execution_provider_command_id, json({ materialized_at_utc: nowUtc })],
      );
      await this.domainEvents.append({
        aggregateId: inserted.execution_provider_command_id,
        aggregateType: "provider_command",
        eventType: "provider.command.created",
        occurredAt: nowUtc,
        correlationId: lineage.payload?.correlation_id || lineage.payload?.correlationId || lineage.portfolio_order_intent_id,
        causationId: lineage.portfolio_order_intent_id,
        source: "execution-gateway",
        payload: {
          providerCommandId: inserted.execution_provider_command_id,
          orderIntentId: lineage.portfolio_order_intent_id,
          providerCode: inserted.broker_provider_code,
          accountId: inserted.broker_account_id,
          commandType: inserted.command_type,
          status: inserted.status,
        },
      }, client);
      await client.query("COMMIT");
      return { status: "PERSISTED", provider_command: inserted };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async ensureHumanGate(input = {}) { return this.humanGateRepository.ensureHumanGate(input); }
  async confirmHumanGate(input = {}) { return this.humanGateRepository.confirmHumanGate(input); }
  async rejectHumanGate(input = {}) { return this.humanGateRepository.rejectHumanGate(input); }
  async claimProviderCommand(input = {}) { return this.providerLifecycleRepository.claimProviderCommand(input); }
  async completeProviderDispatch(input = {}) { return this.providerLifecycleRepository.completeProviderDispatch(input); }
  async recordBrokerProviderEvent(input = {}) { return this.providerLifecycleRepository.recordBrokerProviderEvent(input); }
}

export class InMemoryPortfolioOrderIntentExecutionRepository {
  constructor({ lineages = [], providerCommands = [], humanGates = [], providerEvents = [], executionStates = [] } = {}) {
    this.lineages = new Map();
    this.providerCommands = new Map();
    this.humanGates = new Map();
    this.humanGateEvents = new Map();
    this.providerEvents = new Map();
    this.executionStates = new Map();
    this.humanGateRepository = new InMemoryHumanExecutionGateRepository(this);
    this.providerLifecycleRepository = new InMemoryProviderLifecycleRepository(this);
    for (const lineage of lineages) this.upsertLineage(lineage);
    for (const command of providerCommands) this.providerCommands.set(command.execution_provider_command_id, clone(command));
    for (const gate of humanGates) this.humanGates.set(gate.portfolio_order_intent_id, clone(gate));
    for (const event of providerEvents) this.providerEvents.set(event.external_event_key, clone(event));
    for (const state of executionStates) this.executionStates.set(state.portfolio_order_intent_id, clone(state));
  }

  get available() { return true; }

  upsertLineage(lineage) {
    const normalized = normalizeLineage(lineage);
    this.lineages.set(normalized.portfolio_order_intent_id, normalized);
    return normalized;
  }

  async listSubmittablePortfolioOrderIntents({ limit = 100, providerId = null, accountId = null } = {}) {
    return [...this.lineages.values()]
      .filter((lineage) => lineage.broker_submission_allowed === true && lineage.status === "READY")
      .filter((lineage) => !providerId || intentPayload(lineage).provider_id === providerId || intentPayload(lineage).provider_contract_ref?.provider_id === providerId)
      .filter((lineage) => !accountId || lineage.target_account_id === accountId || intentPayload(lineage).account_id === accountId || intentPayload(lineage).broker_account_id === accountId)
      .slice(0, boundedLimit(limit))
      .map((lineage) => ({ ...clone(lineage), ...gateToLineageFields(this.humanGates.get(lineage.portfolio_order_intent_id)) }));
  }

  async listActiveProviderCommands({ portfolioOrderIntentId = null, tradeOrderIntentId = null } = {}) {
    return [...this.providerCommands.values()]
      .filter((command) => activeProviderStatuses().has(String(command.status || "").toLowerCase()))
      .filter((command) => (portfolioOrderIntentId && command.portfolio_order_intent_id === portfolioOrderIntentId)
        || (tradeOrderIntentId && command.order_intent_id === tradeOrderIntentId))
      .map(clone);
  }

  async persistProviderCommand({ lineage, plan, nowUtc } = {}) {
    const command = plan?.provider_command;
    if (!command) throw repositoryError("EXECUTION_PROVIDER_COMMAND_REQUIRED", "A COMMAND_READY provider command is required.");
    const locked = this.lineages.get(lineage.portfolio_order_intent_id);
    if (!locked || locked.broker_submission_allowed !== true || locked.status !== "READY") {
      return { status: "BLOCKED", reason: "PORTFOLIO_ORDER_INTENT_NOT_SUBMITTABLE", provider_command: null };
    }
    const gateIssue = humanGatePersistenceIssue({ lineage: locked, gate: this.humanGates.get(lineage.portfolio_order_intent_id), nowUtc });
    if (gateIssue) {
      this.#upsertState({ portfolioOrderIntentId: lineage.portfolio_order_intent_id, status: "BLOCKED", payload: { reason: gateIssue } });
      return { status: "BLOCKED", reason: gateIssue, provider_command: null };
    }
    const existing = [...this.providerCommands.values()].find((item) => item.idempotency_key === command.idempotency_key);
    if (existing) return { status: "IDEMPOTENT", provider_command: clone(existing) };
    const row = {
      execution_provider_command_id: command.execution_provider_command_id,
      portfolio_order_intent_id: lineage.portfolio_order_intent_id,
      order_intent_id: lineage.trade_order_intent_id || null,
      broker_provider_code: command.provider_id,
      broker_account_id: command.account_ref?.provider_account_id || command.account_ref?.account_id || null,
      broker_contract_id: command.contract_ref?.provider_contract_id || null,
      command_type: toSqlCommandType(command.command_type),
      status: "pending",
      adapter_id: command.adapter_id || null,
      idempotency_key: command.idempotency_key,
      command_hash: command.command_hash,
      payload: providerCommandEnvelope({ lineage, plan, nowUtc }),
      available_at: nowUtc,
      expires_at: command.expires_at_utc || null,
    };
    this.providerCommands.set(row.execution_provider_command_id, clone(row));
    this.#upsertState({
      portfolioOrderIntentId: lineage.portfolio_order_intent_id,
      commandId: row.execution_provider_command_id,
      status: "PROVIDER_COMMAND_READY",
      payload: { materialized_at_utc: nowUtc },
    });
    return { status: "PERSISTED", provider_command: clone(row) };
  }

  async ensureHumanGate(input = {}) { return this.humanGateRepository.ensureHumanGate(input); }
  async confirmHumanGate(input = {}) { return this.humanGateRepository.confirmHumanGate(input); }
  async rejectHumanGate(input = {}) { return this.humanGateRepository.rejectHumanGate(input); }
  async claimProviderCommand(input = {}) { return this.providerLifecycleRepository.claimProviderCommand(input); }
  async completeProviderDispatch(input = {}) { return this.providerLifecycleRepository.completeProviderDispatch(input); }
  async recordBrokerProviderEvent(input = {}) { return this.providerLifecycleRepository.recordBrokerProviderEvent(input); }

  #upsertState({ portfolioOrderIntentId, commandId = null, status, providerOrderRef = null, payload = {} }) {
    const id = text(portfolioOrderIntentId);
    const previous = this.executionStates.get(id) || { portfolio_order_intent_id: id, filled_quantity: 0, revision: 0, payload: {} };
    const next = {
      ...previous,
      execution_provider_command_id: commandId || previous.execution_provider_command_id || null,
      lifecycle_status: status,
      provider_order_ref: providerOrderRef || previous.provider_order_ref || null,
      payload: { ...(previous.payload || {}), ...payload },
      revision: Number(previous.revision || 0) + 1,
      updated_at_utc: payload.nowUtc || DEFAULT_REPOSITORY_NOW_UTC,
    };
    this.executionStates.set(id, clone(next));
    return next;
  }

}

export function createPortfolioOrderIntentExecutionRepository(persistence) {
  return persistence?.pool
    ? new PostgresPortfolioOrderIntentExecutionRepository(persistence)
    : new InMemoryPortfolioOrderIntentExecutionRepository();
}
