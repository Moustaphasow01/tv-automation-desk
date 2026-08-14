import { SystemClock } from "@tv-automation/desk-time";
import {
  buildCandidateAllocationPortfolioV1,
  buildPortfolioOrderIntentPlanV1,
  buildPortfolioTargetPositionPlanV1,
  evaluatePortfolioRiskBudgetV1,
} from "@tv-automation/desk-domain";
import { createPortfolioRiskRuntimeRepository } from "./portfolio-risk-runtime-repository.js";

export class PortfolioRiskRuntimeService {
  constructor({ repository, signalBusRepository, clock } = {}) {
    this.repository = repository || createPortfolioRiskRuntimeRepository(null);
    this.signalBusRepository = signalBusRepository || null;
    this.clock = clock || new SystemClock();
  }

  async runPipeline(input = {}) {
    if (!this.repository?.persistPipeline) throw serviceError("PORTFOLIO_RISK_REPOSITORY_UNAVAILABLE", "Portfolio Risk repository is required.");
    const asOf = this.#asOf(input);
    const allocations = buildCandidateAllocationPortfolioV1({
      as_of_utc: asOf,
      portfolio_scope: input.portfolio_scope || input.scope || input.account_id,
      signals: input.signals || [],
      positions: input.virtual_positions || input.positions || [],
      marks: input.marks,
      policy: input.allocation_policy,
    });
    const risk = evaluatePortfolioRiskBudgetV1({
      as_of_utc: asOf,
      account_id: input.account_id,
      budget: input.risk_budget,
      candidate_allocations: allocations.candidate_allocations,
      virtual_portfolio: input.virtual_portfolio || allocations.virtual_portfolio,
    });
    const targets = buildPortfolioTargetPositionPlanV1({
      as_of_utc: asOf,
      account_id: input.account_id,
      candidate_allocations: allocations.candidate_allocations,
      risk_budget_evaluation: risk,
      current_positions: input.current_positions || [],
    });
    const intents = buildPortfolioOrderIntentPlanV1({
      as_of_utc: asOf,
      target_position_plan: targets,
      execution_policy: input.execution_policy,
      default_protection_plan: input.default_protection_plan,
      existing_order_intents: input.existing_order_intents || [],
    });
    const persistence = await this.repository.persistPipeline({
      as_of_utc: asOf,
      account_id: input.account_id,
      portfolio_scope: allocations.portfolio_scope,
      idempotency_key: input.idempotency_key,
      correlation_id: input.correlation_id,
      allocations,
      risk,
      targets,
      intents,
    });
    return { status: runtimeStatus({ allocations, risk, targets, intents }), allocations, risk, targets, intents, persistence };
  }

  async processPendingSignals(input = {}) {
    if (!this.signalBusRepository) throw serviceError("STRATEGY_SIGNAL_BUS_REQUIRED", "Strategy Signal Bus repository is required.");
    const nowUtc = this.#asOf(input);
    const pending = await this.signalBusRepository.pollPending({ limit: input.limit || 100, now_utc: nowUtc });
    if (!pending.length) return { status: "NO_PENDING_SIGNALS", pending_count: 0 };
    const result = await this.runPipeline({ ...input, as_of_utc: nowUtc, signals: pending.map(signalFromOutbox) });
    const consumed = [];
    for (const item of pending) {
      const row = await this.signalBusRepository.markConsumed({ signal_outbox_id: item.signal_outbox_id, consumer_id: input.consumer_id || "portfolio-risk-runtime", now_utc: nowUtc });
      consumed.push(row.signal_outbox_id);
    }
    return { ...result, pending_count: pending.length, consumed_signal_outbox_ids: consumed };
  }

  #asOf(input) {
    const value = input.as_of_utc || input.asOfUtc || this.clock.now();
    if (typeof value === "string") return new Date(value).toISOString();
    if (value?.utc) return new Date(value.utc).toISOString();
    return new Date(value).toISOString();
  }
}

function signalFromOutbox(item = {}) {
  const payload = item.payload?.payload || item.payload?.signal || item.payload || {};
  return {
    signal_id: payload.signal_id || item.signal_id,
    strategy_instance_id: payload.strategy_instance_id || item.strategy_instance_id,
    strategy_version_id: payload.strategy_version_id || item.strategy_version_id,
    instrument: payload.instrument || item.instrument,
    direction: payload.direction || item.direction,
    proposed_size: payload.proposed_size || payload.size || item.proposed_size || item.size,
    confidence: payload.confidence || item.confidence,
    execution_mode_origin: payload.execution_mode_origin || item.execution_mode_origin,
    generated_at_utc: payload.generated_at_utc || item.generated_at_utc,
    expires_at_utc: payload.expires_at_utc || item.expires_at_utc,
    correlation_id: payload.correlation_id || item.correlation_id,
    status: item.status || payload.status || "PENDING",
  };
}

function runtimeStatus({ allocations, risk, targets, intents }) {
  if (intents.order_intents.length) return "ORDER_INTENTS_READY";
  if (targets.target_positions.length) return "TARGETS_READY";
  if (risk.status === "BLOCK") return "RISK_BLOCKED";
  if (allocations.candidate_allocations.length) return "NO_ORDER_INTENTS";
  return "NO_ACTIVE_SIGNALS";
}

function serviceError(code, message) { const error = new Error(message || code); error.code = code; error.statusCode = 503; return error; }
