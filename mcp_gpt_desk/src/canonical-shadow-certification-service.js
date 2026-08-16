import { canonicalSha256 } from "@tv-automation/desk-domain";
import { AiContextGateService } from "./ai-context-gate-service.js";
import { createAiContextGateRepository } from "./ai-context-gate-repository.js";
import { DomainEventOutboxRepository } from "./domain-event-outbox-repository.js";
import { PortfolioOrderIntentExecutionService } from "./portfolio-order-intent-execution-service.js";
import { createPortfolioOrderIntentExecutionRepository } from "./portfolio-order-intent-execution-repository.js";
import { PortfolioRiskRuntimeService } from "./portfolio-risk-runtime-service.js";
import { createPortfolioRiskRuntimeRepository } from "./portfolio-risk-runtime-repository.js";
import { StrategyEvaluationRuntimeRepository } from "./strategy-evaluation-runtime-repository.js";
import { StrategySignalBusService } from "./strategy-signal-bus-service.js";
import { createStrategySignalBusRepository } from "./strategy-signal-bus-repository.js";
import { bootstrapDemoPaperAutonomousResearch } from "./research/demo-paper-autonomous-bootstrap.js";

export class CanonicalShadowCertificationService {
  constructor({ store, clock } = {}) {
    if (!store?.persistence?.pool) throw coded("CERTIFICATION_POSTGRES_REQUIRED", "Canonical certification requires PostgreSQL.");
    this.store = store;
    this.clock = clock || store.clock;
    this.events = new DomainEventOutboxRepository(store.persistence);
    this.evaluations = new StrategyEvaluationRuntimeRepository(store.persistence, { eventOutbox: this.events });
    this.signalBusRepository = createStrategySignalBusRepository(store.persistence);
    this.signalBus = new StrategySignalBusService({ repository: this.signalBusRepository, clock: this.clock });
    this.context = new AiContextGateService({ repository: createAiContextGateRepository(store.persistence) });
    this.risk = new PortfolioRiskRuntimeService({
      repository: createPortfolioRiskRuntimeRepository(store.persistence),
      signalBusRepository: this.signalBusRepository,
      clock: this.clock,
    });
    this.execution = new PortfolioOrderIntentExecutionService({
      repository: createPortfolioOrderIntentExecutionRepository(store.persistence),
      clock: this.clock,
    });
  }

  async run(input = {}) {
    const now = this.#now();
    const certificationRunId = String(input.certification_run_id || input.certificationRunId || `cert_shadow_${now.slice(0, 10).replaceAll("-", "")}_${canonicalSha256(now).slice(0, 10)}`);
    const correlationId = `corr_${certificationRunId}`;
    const before = await providerCounts(this.store.persistence.pool);
    const signal = await certifySignal(this, { input, certificationRunId, correlationId });
    const pipeline = await certifyDecisionPipeline(this, { ...signal, certificationRunId, correlationId, now });
    const shadowDispatch = await this.execution.materializeReadyCommands({ execution_mode: "SHADOW", as_of_utc: now });
    const after = await providerCounts(this.store.persistence.pool);
    assertProviderCountsUnchanged(before, after);
    return {
      status: "CERTIFIED_AWAITING_HUMAN_GATE",
      sourceClass: "CERTIFICATION_REPLAY",
      environment: "SHADOW",
      certificationRunId,
      correlationId,
      strategyInstanceId: signal.bootstrap.strategy.instance_id,
      strategyEvaluationId: signal.evaluation.strategy_evaluation_id,
      signalId: signal.signalId,
      contextDecisionId: pipeline.contextId,
      portfolioArbitrationRunId: pipeline.runId,
      riskDecisionId: pipeline.riskDecision.risk_decision_id,
      targetPositionId: pipeline.target.id,
      orderIntentId: pipeline.intent.order_intent_id,
      humanGateId: pipeline.gate.human_execution_gate_id,
      humanGateStatus: pipeline.gate.status,
      shadowDispatch,
      providerCounts: { before, after, unchanged: true },
      physicalExecution: false,
      autoExecution: false,
      live: false,
    };
  }

  #now() {
    const value = this.clock?.now?.();
    if (!value) throw coded("CERTIFICATION_CLOCK_REQUIRED", "Canonical certification requires an injected clock.");
    return iso(value.utc || value);
  }
}

async function certifySignal(service, { input, certificationRunId, correlationId }) {
  const bootstrap = await bootstrapDemoPaperAutonomousResearch({
    store: service.store,
    input: { ...input.scope, idempotency_key: `bootstrap:${certificationRunId}`, correlation_id: correlationId, reason: "Isolated SHADOW certification replay; no provider dispatch.", certification_replay: true },
    actor: { kind: "certification-runtime" },
  });
  const position = await firstCanonicalPosition(service.store.persistence.pool, bootstrap.simulation.simulation_run_id);
  if (!position) throw coded("CERTIFICATION_SIGNAL_NOT_FOUND", "The sealed canonical simulation produced no position to certify.");
  const generatedAt = iso(position.entry_row?.timestamp_utc || position.entry_time);
  const signalId = uuidFromHash(canonicalSha256({ certificationRunId, position_id: position.position_id }));
  const evaluation = await service.evaluations.record({
    strategy_instance_id: bootstrap.strategy.instance_id, strategy_version_id: bootstrap.strategy.version_id,
    certification_run_id: certificationRunId, source_class: "CERTIFICATION_REPLAY", status: "SIGNAL_CREATED",
    scheduler_run_key: `certification:${certificationRunId}:${generatedAt}`, correlation_id: correlationId,
    causation_id: bootstrap.simulation.simulation_run_id, artifact_version: bootstrap.strategy.compiled_artifact_hash,
    instrument: position.instrument, timeframe: "5", source_data_cutoff_utc: generatedAt, started_at_utc: generatedAt,
    completed_at_utc: service.clock.now().utc, next_evaluation_at_utc: null, signal_id: signalId,
    reason_codes: ["CANONICAL_SIMULATION_POSITION_OBSERVED", "CERTIFICATION_REPLAY_ISOLATED"],
    payload: { certificationRunId, simulationRunId: bootstrap.simulation.simulation_run_id, positionId: position.position_id, sourceClass: "CERTIFICATION_REPLAY" },
  });
  const expiresAt = new Date(Date.parse(generatedAt) + 30 * 60_000).toISOString();
  const normalized = certificationSignal({ bootstrap, position, certificationRunId, correlationId, signalId, generatedAt, expiresAt });
  await service.signalBus.publishSignal({ ...normalized, strategy_evaluation_id: evaluation.strategy_evaluation_id }, { idempotency_key: `publish:${certificationRunId}` });
  return { bootstrap, evaluation, generatedAt, signalId };
}

async function certifyDecisionPipeline(service, input) {
  const { bootstrap, evaluation, generatedAt, signalId, certificationRunId, correlationId, now } = input;
  const context = await service.context.evaluateAndPersist({
    idempotency_key: `context:${certificationRunId}:${signalId}`,
    policy: { mode: "SHADOW", policy_version: "shadow-certification-context-v1", model_policy_version: "deterministic-certification-advisory-v1" },
    signal_id: signalId, correlation_id: correlationId,
    advisory: { recommendation: "TAKE", confidence: 0.75, risk_multiplier: 1, reason_codes: ["CANONICAL_SIGNAL_VALID", "CERTIFICATION_REPLAY_ISOLATED"], anomalies: [], rationale: "SHADOW certification validates domain lineage only; it grants no broker authority.", model_ref: "policy://shadow-certification-context-v1", evidence_refs: [`simulation-run://${bootstrap.simulation.simulation_run_id}`, `strategy-evaluation://${evaluation.strategy_evaluation_id}`], issued_at_utc: generatedAt },
    as_of_utc: generatedAt,
  });
  const contextId = context.persistence?.decision?.ai_context_gate_decision_id || context.persistence?.decision?.decision_id;
  const pipeline = await service.risk.processPendingSignals(riskInput({ certificationRunId, correlationId, generatedAt, contextId }));
  if (!pipeline.intents?.order_intents?.length) throw coded("CERTIFICATION_ORDER_INTENT_NOT_CREATED", `Canonical Risk pipeline ended with ${pipeline.status}.`);
  const intent = pipeline.intents.order_intents[0];
  const gate = await service.execution.ensureHumanGate({ portfolioOrderIntentId: intent.order_intent_id, expiresAtUtc: new Date(Date.parse(now) + 24 * 60 * 60_000).toISOString(), correlationId, as_of_utc: now });
  return { contextId, runId: pipeline.persistence?.portfolio_arbitration_run_id, riskDecision: pipeline.risk.allocation_evaluations[0], target: pipeline.targets.target_positions[0], intent, gate };
}

function certificationSignal({ bootstrap, position, certificationRunId, correlationId, signalId, generatedAt, expiresAt }) {
  const direction = String(position.direction || "").toUpperCase();
  const entry = Number(position.entry_order?.limit_price ?? position.entry_raw_price ?? position.entry_price);
  return {
    signal_id: signalId,
    strategy_definition_id: bootstrap.strategy.definition_id,
    strategy_instance_id: bootstrap.strategy.instance_id,
    strategy_version_id: bootstrap.strategy.version_id,
    instrument: position.instrument,
    direction,
    confidence: 0.75,
    timeframe: "5",
    session: sessionFor(position.entry_row?.timestamp_paris || position.entry_time),
    source_data_cutoff_utc: generatedAt,
    execution_mode_origin: "SHADOW",
    generated_at_utc: generatedAt,
    expires_at_utc: expiresAt,
    correlation_id: correlationId,
    source_class: "CERTIFICATION_REPLAY",
    certification_run_id: certificationRunId,
    proposed_size: Number(position.quantity || 1),
    setup: { setup_id: position.setup_id, pattern: "BREAKOUT_RETEST", source_class: "CERTIFICATION_REPLAY" },
    predicates: [{ code: "CANONICAL_SIMULATION_POSITION_OPENED", state: "SATISFIED" }],
    evidence: [{ kind: "SIMULATION_POSITION", ref: `simulation-run://${bootstrap.simulation.simulation_run_id}/positions/${position.position_id}` }],
    reason_codes: ["CANONICAL_SIMULATION_POSITION_OBSERVED", "CERTIFICATION_REPLAY_ISOLATED"],
    signal_quality: { availability: "KNOWN", anti_lookahead: true, source_data_cutoff_utc: generatedAt },
    proposed_trade_plan: {
      instrument: position.instrument,
      direction,
      order_type: position.entry_order?.order_type || "LIMIT",
      entry_price: entry,
      stop_price: Number(position.stop_loss),
      targets: [{ label: "T1", price: Number(position.take_profit_1) }],
      time_in_force: "DAY",
      source_kind: "CANONICAL_SIMULATION",
      source_data_cutoff_utc: generatedAt,
      invalidation: { price: Number(position.stop_loss), reason_code: "STOP_INVALIDATION" },
    },
    payload: { certificationRunId, sourceClass: "CERTIFICATION_REPLAY", simulationRunId: bootstrap.simulation.simulation_run_id },
  };
}

function riskInput({ certificationRunId, correlationId, generatedAt, contextId }) {
  return {
    now_utc: generatedAt,
    as_of_utc: generatedAt,
    account_id: "shadow_certification",
    portfolio_scope: `certification:${certificationRunId}`,
    consumer_id: `certification-risk:${certificationRunId}`,
    idempotency_key: `portfolio-risk:${certificationRunId}`,
    correlation_id: correlationId,
    ai_context_decision_id: contextId,
    risk_budget: {
      budget_id: "shadow-certification-risk-v1",
      max_portfolio_abs_size: 2,
      max_account_abs_size: { shadow_certification: 2 },
      max_instrument_abs_size: { MNQ: 2, MES: 2 },
      metadata: { certification_run_id: certificationRunId },
    },
    execution_policy: {
      provider_id: "provider-neutral",
      account_id: "shadow_certification",
      broker_account_id: "shadow_certification",
      submission_enabled: false,
      order_type: "LIMIT",
      time_in_force: "DAY",
      provider_contracts: { MNQ: { provider_id: "provider-neutral", provider_contract_id: "shadow_mnq", provider_symbol: "MNQ", instrument: "MNQ" } },
    },
  };
}

async function firstCanonicalPosition(pool, simulationRunId) {
  const result = await pool.query(`SELECT payload->'items'->0 AS position FROM simulation_run_artifacts
    WHERE simulation_run_id=$1 AND artifact_kind='POSITIONS' AND jsonb_array_length(COALESCE(payload->'items','[]'::jsonb))>0
    ORDER BY created_at_utc DESC LIMIT 1`, [simulationRunId]);
  return result.rows[0]?.position || null;
}
async function providerCounts(pool) {
  const result = await pool.query(`SELECT
    (SELECT count(*)::int FROM broker_provider_commands) AS commands,
    (SELECT count(*)::int FROM broker_provider_events) AS events`);
  return result.rows[0];
}
function assertProviderCountsUnchanged(before, after) {
  if (Number(before.commands) !== Number(after.commands) || Number(before.events) !== Number(after.events)) {
    throw coded("CERTIFICATION_PROVIDER_SIDE_EFFECT_DETECTED", "Provider command/event count changed during SHADOW certification.");
  }
}
function sessionFor(value) { const time=String(value||"").slice(11,16); return time >= "15:30" && time <= "22:00" ? "ny_open" : "asia_open"; }
function uuidFromHash(hash) {
  const clean = String(hash || "").replace(/^sha256:/, "").padEnd(32, "0");
  const variant = ((Number.parseInt(clean[16] || "8", 16) & 0x3) | 0x8).toString(16);
  return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-4${clean.slice(13, 16)}-${variant}${clean.slice(17, 20)}-${clean.slice(20, 32)}`;
}
function iso(value) { const parsed=Date.parse(value||""); if(!Number.isFinite(parsed)) throw coded("CERTIFICATION_TIMESTAMP_INVALID", "Certification timestamp is invalid."); return new Date(parsed).toISOString(); }
function coded(code,message){const error=new Error(message||code);error.code=code;return error;}
