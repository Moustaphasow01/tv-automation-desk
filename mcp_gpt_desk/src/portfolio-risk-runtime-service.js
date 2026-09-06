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
    const command = exposureCommand(input, asOf);
    if (typeof this.repository.withTheoreticalExposureSnapshot === "function") {
      const stored = await this.repository.withTheoreticalExposureSnapshot(command, (snapshot) => buildPipeline(input, asOf, snapshot));
      return pipelineResult(stored.result, stored.persistence, stored.exposure_snapshot);
    }
    const result = buildPipeline(input, asOf, legacySnapshot(input, asOf));
    const persistence = await this.repository.persistPipeline({ ...command, ...result });
    return pipelineResult(result, persistence, legacySnapshot(input, asOf));
  }

  async processPendingSignals(input = {}) {
    if (!this.signalBusRepository) throw serviceError("STRATEGY_SIGNAL_BUS_REQUIRED", "Strategy Signal Bus repository is required.");
    const nowUtc = this.#asOf(input);
    const pending = await this.signalBusRepository.pollPending({ limit: input.limit || 100, now_utc: nowUtc });
    if (!pending.length) return { status: "NO_PENDING_SIGNALS", pending_count: 0 };
    const result = await this.runPipeline({ ...input, as_of_utc: nowUtc, signals: pending.map(signalFromOutbox) });
    if (result.risk?.status === "CONFIG_MISSING") return { ...result, pending_count: pending.length,
      consumed_signal_outbox_ids: [], deferred_signal_outbox_ids: pending.map(item => item.signal_outbox_id) };
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

function buildPipeline(input, asOf, snapshot) {
  const signals = exposureConstrainedSignals(input.signals || [], snapshot);
  const allocations = buildCandidateAllocationPortfolioV1({
    as_of_utc: asOf, portfolio_scope: input.portfolio_scope || input.scope || input.account_id,
    signals, positions: snapshot.positions, marks: input.marks,
    policy: { ...(input.allocation_policy || {}), sizing_mode: input.risk_budget?.sizing_mode || input.risk_budget?.sizingMode },
  });
  if (requiresLossUsage(input.risk_budget) && snapshot.loss_usage_availability !== "KNOWN") {
    return unavailablePipeline(allocations, unavailableSnapshot(snapshot, "LOSS_USAGE_UNAVAILABLE"));
  }
  if (snapshot.availability !== "KNOWN") return unavailablePipeline(allocations, snapshot);
  const risk = evaluatePortfolioRiskBudgetV1({
    as_of_utc: asOf, account_id: input.account_id, budget: input.risk_budget,
    candidate_allocations: allocations.candidate_allocations, virtual_portfolio: allocations.virtual_portfolio,
    loss_usage: snapshot.loss_usage,
    account_capital_reference: input.account_capital_reference,
  });
  const targets = buildPortfolioTargetPositionPlanV1({
    as_of_utc: asOf, account_id: input.account_id, candidate_allocations: allocations.candidate_allocations,
    risk_budget_evaluation: risk, current_positions: snapshot.positions,
  });
  const intents = buildPortfolioOrderIntentPlanV1({
    as_of_utc: asOf, target_position_plan: targets, execution_policy: input.execution_policy,
    default_protection_plan: input.default_protection_plan, existing_order_intents: snapshot.pending_order_intents,
  });
  return { allocations, risk, targets, intents };
}

function exposureConstrainedSignals(signals, snapshot) {
  return signals.map((signal) => {
    const reason = exposureBlockReason(signal, snapshot);
    return reason ? { ...signal, portfolio_block_reason: reason } : signal;
  });
}

function exposureBlockReason(signal, snapshot) {
  const instrument = String(signal.instrument || "").toUpperCase();
  if (snapshot.availability !== "KNOWN") return snapshot.reason_codes?.[0] || "EXPOSURE_UNAVAILABLE";
  if (snapshot.qualified_signal_ids?.includes(String(signal.signal_id || ""))) return "THEORETICAL_SIGNAL_ALREADY_QUALIFIED";
  if (snapshot.reservation_instruments?.includes(instrument)) return "THEORETICAL_INTENT_RESERVED";
  const position = snapshot.positions?.find((item) => item.instrument === instrument);
  if (position) return "THEORETICAL_POSITION_RESERVED";
  return null;
}

function unavailablePipeline(allocations, snapshot) {
  const reason = snapshot.reason_codes?.[0] || "EXPOSURE_UNAVAILABLE";
  return {
    allocations,
    risk: { status: "EXPOSURE_UNAVAILABLE", allocation_evaluations: [], reason_codes: [reason] },
    targets: { status: "NO_TARGETS", target_positions: [], skipped_allocations: [{ reason }] },
    intents: { status: "NO_ORDER_INTENTS", order_intents: [], skipped_targets: [{ reason }] },
  };
}

function requiresLossUsage(budget = {}) {
  return Number(budget.max_daily_loss_r ?? budget.maxDailyLossR) > 0
    || Number(budget.max_weekly_loss_r ?? budget.maxWeeklyLossR) > 0;
}

function unavailableSnapshot(snapshot, reason) {
  return { ...snapshot, availability: "UNAVAILABLE", reason_codes: [...new Set([...(snapshot.reason_codes || []), reason])] };
}

function exposureCommand(input, asOf) {
  return {
    ...input, as_of_utc: asOf, execution_mode: input.execution_mode || input.executionMode || "SHADOW",
    portfolio_scope: input.portfolio_scope || input.scope || input.account_id,
    instruments: [...new Set((input.signals || []).map((item) => String(item.instrument || "").toUpperCase()).filter(Boolean))].sort(),
  };
}

function legacySnapshot(input, asOf) {
  const supplied = input.exposure_snapshot || input.exposureSnapshot;
  if (!supplied || supplied.availability !== "KNOWN") {
    return {
      source: "CALLER_SUPPLIED_LEGACY", as_of_utc: asOf, availability: "UNAVAILABLE",
      reason_codes: ["THEORETICAL_EXPOSURE_SNAPSHOT_REQUIRED"], positions: [], pending_order_intents: [], reservation_instruments: [],
    };
  }
  return {
    ...supplied, source: supplied.source || "CALLER_SUPPLIED_LEGACY", as_of_utc: asOf,
    positions: Array.isArray(supplied.positions) ? supplied.positions : [],
    pending_order_intents: Array.isArray(supplied.pending_order_intents) ? supplied.pending_order_intents : [],
    reservation_instruments: Array.isArray(supplied.reservation_instruments) ? supplied.reservation_instruments : [],
  };
}

function pipelineResult(result = {}, persistence, exposureSnapshot) {
  const allocations = result.allocations || {};
  const risk = result.risk || {};
  const targets = result.targets || {};
  const intents = result.intents || {};
  return { status: runtimeStatus({ allocations, risk, targets, intents }), allocations, risk, targets, intents, persistence, exposure_snapshot: exposureSnapshot };
}

function signalFromOutbox(item = {}) {
  const payload = item.payload?.payload || item.payload?.signal || item.payload || {};
  return {
    signal_id: payload.signal_id || item.signal_id,
    strategy_instance_id: payload.strategy_instance_id || item.strategy_instance_id,
    strategy_definition_id: payload.strategy_definition_id || item.strategy_definition_id,
    strategy_version_id: payload.strategy_version_id || item.strategy_version_id,
    instrument: payload.instrument || item.instrument,
    direction: payload.direction || item.direction,
    proposed_size: payload.proposed_size ?? payload.size ?? item.proposed_size ?? item.size,
    confidence: payload.confidence ?? item.confidence,
    context_risk_multiplier: payload.context_risk_multiplier ?? item.context_risk_multiplier,
    context_risk_multiplier_source: payload.context_risk_multiplier_source ?? item.context_risk_multiplier_source,
    execution_mode_origin: payload.execution_mode_origin || item.execution_mode_origin,
    generated_at_utc: payload.generated_at_utc || item.generated_at_utc,
    expires_at_utc: payload.expires_at_utc || item.expires_at_utc,
    source_data_cutoff_utc: payload.source_data_cutoff_utc || item.source_data_cutoff_utc,
    correlation_id: payload.correlation_id || item.correlation_id,
    proposed_trade_plan: payload.proposed_trade_plan || item.proposed_trade_plan,
    trade_plan_economics: payload.trade_plan_economics || item.trade_plan_economics || payload.proposed_trade_plan?.economics,
    status: item.status || payload.status || "PENDING",
  };
}

function runtimeStatus({ allocations, risk, targets, intents }) {
  if (risk.status === "CONFIG_MISSING") return "RISK_CONFIG_MISSING";
  if (risk.status === "EXPOSURE_UNAVAILABLE") return "EXPOSURE_UNAVAILABLE";
  if (intents.order_intents.length) return "ORDER_INTENTS_READY";
  if (targets.target_positions.length) return "TARGETS_READY";
  if (risk.status === "BLOCK") return "RISK_BLOCKED";
  if (allocations.candidate_allocations.length) return "NO_ORDER_INTENTS";
  return "NO_ACTIVE_SIGNALS";
}

function serviceError(code, message) { const error = new Error(message || code); error.code = code; error.statusCode = 503; return error; }
