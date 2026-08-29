import { SystemClock } from "@tv-automation/desk-time";
import { AiContextGateService } from "./ai-context-gate-service.js";
import { createAiContextGateRepository } from "./ai-context-gate-repository.js";
import { PortfolioOrderIntentExecutionService } from "./portfolio-order-intent-execution-service.js";
import { createPortfolioOrderIntentExecutionRepository } from "./portfolio-order-intent-execution-repository.js";
import { PortfolioRiskRuntimeService } from "./portfolio-risk-runtime-service.js";
import { createPortfolioRiskRuntimeRepository } from "./portfolio-risk-runtime-repository.js";
import { createStrategySignalBusRepository } from "./strategy-signal-bus-repository.js";

export class StrategySignalDecisionPipelineService {
  constructor({ signalBusRepository, contextGate, riskRuntime, execution, providerCounts = null, clock } = {}) {
    if (!signalBusRepository) throw serviceError("STRATEGY_SIGNAL_DECISION_PIPELINE_SIGNAL_BUS_REQUIRED");
    this.signalBusRepository = signalBusRepository;
    this.contextGate = contextGate;
    this.riskRuntime = riskRuntime;
    this.execution = execution;
    this.providerCounts = providerCounts;
    this.clock = clock || new SystemClock();
  }

  async runOnce(input = {}) {
    const nowUtc = asOf(input, this.clock);
    const before = await optionalProviderCounts(this.providerCounts);
    const pending = await this.signalBusRepository.pollPending({ limit: input.limit || 100, now_utc: nowUtc });
    const scoped = pending.filter((item) => signalInScope(item, input));
    if (!scoped.length) return idleResult({ nowUtc, pending, before });
    const contextDecisions = await this.#recordContextDecisions(scoped, nowUtc);
    const pipeline = await this.riskRuntime.runPipeline({
      as_of_utc: nowUtc,
      account_id: accountId(input),
      portfolio_scope: input.portfolio_scope || input.scope || accountId(input),
      idempotency_key: idempotencyKey(input, scoped, nowUtc),
      correlation_id: scoped[0]?.correlation_id || `strategy-signal-decision:${nowUtc}`,
      signals: scoped,
      risk_budget: riskBudget(input),
      execution_policy: executionPolicy(input),
    });
    const consumed = await this.#consume(scoped, input, nowUtc);
    const humanGates = await this.#ensureHumanGates(pipeline, nowUtc);
    const shadowDispatch = await this.execution.materializeReadyCommands({
      execution_mode: "SHADOW",
      as_of_utc: nowUtc,
      account_id: accountId(input),
      provider_id: "provider-neutral-shadow",
    });
    const after = await optionalProviderCounts(this.providerCounts);
    assertProviderSideEffectsUnchanged(before, after);
    return {
      status: pipelineStatus(pipeline, humanGates),
      as_of_utc: nowUtc,
      pending_seen: pending.length,
      scoped_signal_count: scoped.length,
      context_decision_count: contextDecisions.length,
      portfolio_arbitration_run_id: pipeline.persistence?.portfolio_arbitration_run_id || null,
      risk_decision_count: pipeline.risk?.allocation_evaluations?.length || 0,
      target_position_count: pipeline.targets?.target_positions?.length || 0,
      order_intent_count: pipeline.intents?.order_intents?.length || 0,
      order_intent_ids: (pipeline.intents?.order_intents || []).map((intent) => intent.order_intent_id).filter(Boolean),
      human_gate_count: humanGates.length,
      human_gate_ids: humanGates.map((gate) => gate?.human_execution_gate_id).filter(Boolean),
      consumed_signal_outbox_ids: consumed,
      shadow_dispatch: shadowDispatch,
      provider_counts: { before, after, unchanged: true },
    };
  }

  async #recordContextDecisions(signals, nowUtc) {
    if (!this.contextGate) return [];
    const decisions = [];
    for (const signal of signals) {
      const result = await this.contextGate.evaluateAndPersist({
        idempotency_key: `ai-context:shadow-live:${signal.signal_id}`,
        signal_id: signal.signal_id,
        correlation_id: signal.correlation_id,
        subject_type: "SIGNAL",
        subject_id: signal.signal_id,
        policy: {
          enabled: true,
          mode: "SHADOW",
          policy_version: "shadow-live-ai-context-advisory-v1",
          model_policy_version: "deterministic-runtime-context-placeholder-v1",
        },
        advisory: {
          recommendation: "TAKE",
          confidence: 0.5,
          risk_multiplier: 1,
          reason_codes: ["AI_CONTEXT_GATE_SHADOW_RECORDED", "NO_BINDING_CONTEXT_FILTER_ACTIVE"],
          anomalies: [],
          rationale: "SHADOW live context advisory records lineage only. Portfolio and Global Risk remain the binding gates.",
          model_ref: "policy://shadow-live-ai-context-advisory-v1",
          evidence_refs: [{ ref: `strategy-signal://${signal.signal_id}` }],
          issued_at_utc: nowUtc,
        },
        as_of_utc: nowUtc,
      });
      decisions.push(result.persistence?.decision || result.result);
    }
    return decisions;
  }

  async #consume(signals, input, nowUtc) {
    const consumed = [];
    for (const item of signals) {
      const row = await this.signalBusRepository.markConsumed({
        signal_outbox_id: item.signal_outbox_id,
        consumer_id: input.consumer_id || "strategy-signal-decision-pipeline",
        now_utc: nowUtc,
      });
      if (row?.signal_outbox_id) consumed.push(row.signal_outbox_id);
    }
    return consumed;
  }

  async #ensureHumanGates(pipeline, nowUtc) {
    const intents = readyOrderIntents(pipeline);
    const gates = [];
    for (const intent of intents) {
      const gate = await this.execution.ensureHumanGate({
        portfolioOrderIntentId: intent.order_intent_id,
        expiresAtUtc: intent.expires_at_utc || new Date(Date.parse(nowUtc) + 30 * 60_000).toISOString(),
        correlationId: intent.correlation_id || pipeline.persistence?.portfolio_arbitration_run_id || null,
        as_of_utc: nowUtc,
      });
      gates.push(gate);
    }
    return gates;
  }
}

export function createStrategySignalDecisionPipelineService({ store } = {}) {
  const signalBusRepository = createStrategySignalBusRepository(store.persistence);
  return new StrategySignalDecisionPipelineService({
    signalBusRepository,
    contextGate: new AiContextGateService({ repository: createAiContextGateRepository(store.persistence) }),
    riskRuntime: new PortfolioRiskRuntimeService({
      repository: createPortfolioRiskRuntimeRepository(store.persistence),
      signalBusRepository,
      clock: store.clock,
    }),
    execution: new PortfolioOrderIntentExecutionService({
      repository: createPortfolioOrderIntentExecutionRepository(store.persistence),
      clock: store.clock,
    }),
    providerCounts: store.persistence?.pool ? () => countProviderRows(store.persistence.pool) : null,
    clock: store.clock,
  });
}

function signalInScope(item, input) {
  const allowedSourceClasses = stringSet(input.source_classes || input.sourceClasses || ["LIVE", "SHADOW"]);
  const allowedModes = stringSet(input.execution_modes || input.executionModes || ["SHADOW"]);
  const strategyVersionIds = new Set(array(input.strategy_version_ids || input.strategyVersionIds).map(String));
  const certificationRunIds = new Set(array(input.certification_run_ids || input.certificationRunIds).map(String));
  const certificationRunId = input.certification_run_id || input.certificationRunId;
  if (certificationRunId) certificationRunIds.add(String(certificationRunId));
  if (!allowedSourceClasses.has(String(item.source_class || "LIVE").toUpperCase())) return false;
  if (!allowedModes.has(String(item.execution_mode_origin || "SHADOW").toUpperCase())) return false;
  if (strategyVersionIds.size && !strategyVersionIds.has(String(item.strategy_version_id))) return false;
  if (certificationRunIds.size && !certificationRunIds.has(String(item.certification_run_id || ""))) return false;
  return true;
}

function riskBudget(input) {
  const account = accountId(input);
  const maxAbs = positiveNumber(input.max_abs_size || input.maxAbsSize || process.env.DESK_SHADOW_RISK_MAX_ABS_SIZE, 20);
  return input.risk_budget || input.riskBudget || {
    budget_id: "shadow-live-risk-budget-v1",
    max_portfolio_abs_size: maxAbs,
    max_account_abs_size: { [account]: maxAbs },
    max_instrument_abs_size: { MNQ: maxAbs, MES: maxAbs, ZC: maxAbs, ZW: maxAbs },
    max_correlation_group_abs_size: { equity_index: maxAbs, grains: maxAbs },
    metadata: {
      execution_mode: "SHADOW",
      source: "strategy-signal-decision-pipeline",
    },
  };
}

function executionPolicy(input) {
  const account = accountId(input);
  return input.execution_policy || input.executionPolicy || {
    provider_id: "provider-neutral-shadow",
    account_id: account,
    broker_account_id: account,
    submission_enabled: false,
    order_type: "LIMIT",
    time_in_force: "DAY",
  };
}

async function countProviderRows(pool) {
  const result = await pool.query(`SELECT
    (SELECT count(*)::int FROM broker_provider_commands) AS commands,
    (SELECT count(*)::int FROM broker_provider_events) AS events`);
  return result.rows[0] || { commands: 0, events: 0 };
}

async function optionalProviderCounts(counter) {
  return typeof counter === "function" ? counter() : null;
}

function assertProviderSideEffectsUnchanged(before, after) {
  if (!before || !after) return;
  if (Number(before.commands) !== Number(after.commands) || Number(before.events) !== Number(after.events)) {
    throw serviceError("STRATEGY_SIGNAL_PIPELINE_PROVIDER_SIDE_EFFECT_DETECTED");
  }
}

function idleResult({ nowUtc, pending, before }) {
  return {
    status: pending.length ? "NO_SCOPED_PENDING_SIGNALS" : "NO_PENDING_SIGNALS",
    as_of_utc: nowUtc,
    pending_seen: pending.length,
    scoped_signal_count: 0,
    context_decision_count: 0,
    risk_decision_count: 0,
    target_position_count: 0,
    order_intent_count: 0,
    human_gate_count: 0,
    consumed_signal_outbox_ids: [],
    provider_counts: { before, after: before, unchanged: true },
  };
}

function readyOrderIntents(pipeline) {
  return (pipeline.intents?.order_intents || []).filter((intent) => String(intent.status || "").toUpperCase() === "READY");
}

function pipelineStatus(pipeline, humanGates = []) {
  if (humanGates.length) return "HUMAN_GATE_READY";
  if (pipeline.intents?.order_intents?.length) return "ORDER_INTENT_NOT_READY";
  return pipeline.status || "NO_ORDER_INTENT";
}

function idempotencyKey(input, signals, nowUtc) {
  return input.idempotency_key || input.idempotencyKey || `strategy-signal-decision:${nowUtc}:${signals.map((item) => item.signal_id).sort().join(",")}`;
}

function accountId(input) { return String(input.account_id || input.accountId || process.env.DESK_SHADOW_RUNTIME_ACCOUNT_ID || "shadow_live"); }
function asOf(input, clock) {
  const value = input.as_of_utc || input.asOfUtc || input.now_utc || input.nowUtc || clock.now();
  if (typeof value === "string") return new Date(value).toISOString();
  if (value?.utc) return new Date(value.utc).toISOString();
  return new Date(value).toISOString();
}
function array(value) { return Array.isArray(value) ? value : []; }
function stringSet(value) { return new Set(array(value).map((item) => String(item).toUpperCase())); }
function positiveNumber(value, fallback) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback; }
function serviceError(code) { const error = new Error(code); error.code = code; error.statusCode = 503; return error; }
