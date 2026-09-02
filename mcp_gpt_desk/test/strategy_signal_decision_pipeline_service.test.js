import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAiContextGateRepository } from "../src/ai-context-gate-repository.js";
import { AiContextGateService } from "../src/ai-context-gate-service.js";
import { InMemoryPortfolioOrderIntentExecutionRepository } from "../src/portfolio-order-intent-execution-repository.js";
import { PortfolioOrderIntentExecutionService } from "../src/portfolio-order-intent-execution-service.js";
import { InMemoryPortfolioRiskRuntimeRepository } from "../src/portfolio-risk-runtime-repository.js";
import { PortfolioRiskRuntimeService } from "../src/portfolio-risk-runtime-service.js";
import { StrategySignalDecisionPipelineService } from "../src/strategy-signal-decision-pipeline-service.js";
import { InMemoryStrategySignalBusRepository } from "../src/strategy-signal-bus-repository.js";

const NOW = "2026-08-17T09:15:00.000Z";

test("strategy signal decision pipeline opens Human Gate without provider side effects in SHADOW", async () => {
  const signalBusRepository = new InMemoryStrategySignalBusRepository();
  await signalBusRepository.publish(signalOutbox());
  const riskRepository = new InMemoryPortfolioRiskRuntimeRepository();
  const executionRepository = new InMemoryPortfolioOrderIntentExecutionRepository();
  const service = new StrategySignalDecisionPipelineService({
    signalBusRepository,
    contextGate: new AiContextGateService({ repository: new InMemoryAiContextGateRepository() }),
    riskRuntime: new PortfolioRiskRuntimeService({ repository: riskRepository, clock: clock() }),
    execution: new PortfolioOrderIntentExecutionService({ repository: executionRepository, clock: clock() }),
    providerCounts: async () => ({ commands: 0, events: 0 }),
    clock: clock(),
  });

  const result = await service.runOnce({ now_utc: NOW, account_id: "shadow_live" });

  assert.equal(result.status, "HUMAN_GATE_READY");
  assert.equal(result.scoped_signal_count, 1);
  assert.equal(result.context_decision_count, 1);
  assert.equal(result.risk_decision_count, 1);
  assert.equal(result.target_position_count, 1);
  assert.equal(result.order_intent_count, 1);
  assert.equal(result.human_gate_count, 1);
  const allocation = [...riskRepository.allocations.values()][0];
  assert.equal(allocation.proposed_size, 2);
  const orderIntent = [...riskRepository.orderIntents.values()][0];
  assert.equal(orderIntent.status, "READY");
  assert.equal(orderIntent.quantity, 2);
  assert.equal(orderIntent.protection.stop_price, 27980);
  assert.equal(orderIntent.protection.target_price, 28040);
  assert.equal(result.shadow_dispatch.status, "SKIPPED");
  assert.equal(result.shadow_dispatch.reason, "SHADOW_NO_PHYSICAL_DISPATCH");
  assert.deepEqual(result.provider_counts.before, { commands: 0, events: 0 });
  assert.deepEqual(result.provider_counts.after, { commands: 0, events: 0 });
  assert.equal((await signalBusRepository.pollPending({ now_utc: NOW })).length, 0);
});

test("strategy signal decision pipeline does not borrow protection from another signal", async () => {
  const signalBusRepository = new InMemoryStrategySignalBusRepository();
  await signalBusRepository.publish(signalOutbox({
    signal_id: "signal-no-plan",
    dedupe_key: "signal-no-plan",
    proposed_trade_plan: null,
    trade_plan_economics: null,
    availability: "PARTIAL",
    payload: { schema_version: "desk_event_envelope_v1", payload: { ...signalCore({ signal_id: "signal-no-plan" }), proposed_trade_plan: null, trade_plan_economics: null, availability: "PARTIAL" } },
  }));
  const riskRepository = new InMemoryPortfolioRiskRuntimeRepository();
  const service = new StrategySignalDecisionPipelineService({
    signalBusRepository,
    contextGate: new AiContextGateService({ repository: new InMemoryAiContextGateRepository() }),
    riskRuntime: new PortfolioRiskRuntimeService({ repository: riskRepository, clock: clock() }),
    execution: new PortfolioOrderIntentExecutionService({ repository: new InMemoryPortfolioOrderIntentExecutionRepository(), clock: clock() }),
    providerCounts: async () => ({ commands: 0, events: 0 }),
    clock: clock(),
  });

  const result = await service.runOnce({ now_utc: NOW, account_id: "shadow_live" });

  assert.equal(result.status, "ORDER_INTENT_NOT_READY");
  assert.equal(result.order_intent_count, 1);
  assert.equal(result.human_gate_count, 0);
  const orderIntent = [...riskRepository.orderIntents.values()][0];
  assert.equal(orderIntent.status, "PROTECTION_REQUIRED");
  assert.deepEqual(orderIntent.protection.missing, ["STOP_PRICE_REQUIRED", "TARGET_PRICE_REQUIRED"]);
});

test("strategy signal decision pipeline preserves the complete grain trade plan through Risk and Human Gate", async () => {
  const signalBusRepository = new InMemoryStrategySignalBusRepository();
  await signalBusRepository.publish(signalOutbox({
    signal_id: "signal-zw-plan",
    dedupe_key: "signal-zw-plan",
    instrument: "ZW",
    proposed_size: 1,
    proposed_trade_plan: {
      schema_version: "strategy_signal_trade_plan_v1",
      availability: "KNOWN",
      instrument: "ZW",
      direction: "LONG",
      order_type: "LIMIT",
      entry: { availability: "KNOWN", type: "ZONE", price: 754, low: 753.75, high: 754.25, calculation_price: 754 },
      stop: { availability: "KNOWN", price: 752.25 },
      targets: [{ availability: "KNOWN", label: "TP1", price: 756.75 }],
      time_in_force: "DAY",
    },
    trade_plan_economics: {
      schema_version: "trade_plan_economics_v1",
      availability: "KNOWN",
      instrument: "ZW",
      direction: "LONG",
      entry_price: 754,
      stop_price: 752.25,
      stop_distance_points: 1.75,
      stop_distance_ticks: 7,
      tick_size: 0.25,
      tick_value: 12.5,
      currency: "USD",
      risk_per_contract: 87.5,
      targets: [{ label: "TP1", price: 756.75, reward_risk: 1.5714, expected_r: 1.5714, availability: "KNOWN" }],
    },
  }));
  const riskRepository = new InMemoryPortfolioRiskRuntimeRepository();
  const executionRepository = new InMemoryPortfolioOrderIntentExecutionRepository();
  const service = new StrategySignalDecisionPipelineService({
    signalBusRepository,
    contextGate: new AiContextGateService({ repository: new InMemoryAiContextGateRepository() }),
    riskRuntime: new PortfolioRiskRuntimeService({ repository: riskRepository, clock: clock() }),
    execution: new PortfolioOrderIntentExecutionService({ repository: executionRepository, clock: clock() }),
    providerCounts: async () => ({ commands: 0, events: 0 }),
    clock: clock(),
  });

  const result = await service.runOnce({ now_utc: NOW, account_id: "shadow_live" });
  const orderIntent = [...riskRepository.orderIntents.values()][0];

  assert.equal(result.status, "HUMAN_GATE_READY");
  assert.equal(orderIntent.instrument, "ZW");
  assert.equal(orderIntent.execution_terms.entry.price, 754);
  assert.equal(orderIntent.execution_terms.entry.low, 753.75);
  assert.equal(orderIntent.execution_terms.entry.high, 754.25);
  assert.equal(orderIntent.execution_terms.stop.price, 752.25);
  assert.equal(orderIntent.execution_terms.targets[0].price, 756.75);
  assert.equal(orderIntent.risk_snapshot.risk_per_contract, 87.5);
  assert.equal(orderIntent.broker_submission_allowed, false);
});

test("strategy signal decision pipeline fails closed before Risk when grain context is unavailable", async () => {
  const signalBusRepository = new InMemoryStrategySignalBusRepository();
  const published = await signalBusRepository.publish(signalOutbox({
    signal_id: "signal-zc-context-wait",
    dedupe_key: "signal-zc-context-wait",
    instrument: "ZC",
  }));
  let riskCalls = 0;
  let humanGateCalls = 0;
  const service = new StrategySignalDecisionPipelineService({
    signalBusRepository,
    contextPrefilter: {
      async evaluate(signals) {
        return signals.map((signal) => ({
          signal,
          decision: "WAIT",
          admissible: false,
          reasonCodes: ["MARKET_CONTEXT_MISSING"],
        }));
      },
    },
    contextGate: new AiContextGateService({ repository: new InMemoryAiContextGateRepository() }),
    riskRuntime: { async runPipeline() { riskCalls += 1; return {}; } },
    execution: {
      async ensureHumanGate() { humanGateCalls += 1; return {}; },
      async materializeReadyCommands() { throw new Error("provider path must remain unreachable"); },
    },
    providerCounts: async () => ({ commands: 0, events: 0 }),
    clock: clock(),
  });

  const result = await service.runOnce({ now_utc: NOW, account_id: "shadow_live" });

  assert.equal(result.status, "CONTEXT_WAITING");
  assert.equal(result.context_prefilter.evaluated, 1);
  assert.equal(result.context_prefilter.admissible, 0);
  assert.equal(result.context_prefilter.wait, 1);
  assert.equal(result.context_prefilter.rejected, 0);
  assert.deepEqual(result.context_prefilter.decisions[0], {
    signal_id: "signal-zc-context-wait",
    decision: "WAIT",
    reason_codes: ["MARKET_CONTEXT_MISSING"],
  });
  assert.equal(riskCalls, 0);
  assert.equal(humanGateCalls, 0);
  assert.equal(result.order_intent_count, 0);
  assert.equal(result.human_gate_count, 0);
  assert.deepEqual(result.consumed_signal_outbox_ids, []);
  assert.deepEqual(result.deferred_signal_outbox_ids, [published.signal_outbox_id]);
  assert.deepEqual((await signalBusRepository.pollPending({ now_utc: NOW })).map((signal) => signal.signal_id), ["signal-zc-context-wait"]);
  assert.deepEqual(result.provider_counts, {
    before: { commands: 0, events: 0 },
    after: { commands: 0, events: 0 },
    unchanged: true,
  });
});

test("strategy signal decision pipeline consumes rejected signals without sending them to Risk", async () => {
  const signalBusRepository = new InMemoryStrategySignalBusRepository();
  const published = await signalBusRepository.publish(signalOutbox({
    signal_id: "signal-zc-context-reject",
    dedupe_key: "signal-zc-context-reject",
    instrument: "ZC",
  }));
  let riskCalls = 0;
  const service = new StrategySignalDecisionPipelineService({
    signalBusRepository,
    contextPrefilter: {
      async evaluate(signals) {
        return signals.map((signal) => ({
          signal,
          decision: "REJECT",
          admissible: false,
          reasonCodes: ["COUNTER_CONTEXT_DIRECTION"],
        }));
      },
    },
    contextGate: new AiContextGateService({ repository: new InMemoryAiContextGateRepository() }),
    riskRuntime: { async runPipeline() { riskCalls += 1; return {}; } },
    execution: {
      async ensureHumanGate() { return {}; },
      async materializeReadyCommands() { throw new Error("provider path must remain unreachable"); },
    },
    providerCounts: async () => ({ commands: 0, events: 0 }),
    clock: clock(),
  });

  const result = await service.runOnce({ now_utc: NOW, account_id: "shadow_live" });

  assert.equal(result.status, "CONTEXT_FILTERED");
  assert.equal(riskCalls, 0);
  assert.deepEqual(result.consumed_signal_outbox_ids, [published.signal_outbox_id]);
  assert.deepEqual(result.deferred_signal_outbox_ids, []);
  assert.equal((await signalBusRepository.pollPending({ now_utc: NOW })).length, 0);
});

test("strategy signal decision pipeline expires stale pending signals before polling", async () => {
  const signalBusRepository = new InMemoryStrategySignalBusRepository();
  const published = await signalBusRepository.publish(signalOutbox({
    signal_id: "signal-expired-before-context",
    dedupe_key: "signal-expired-before-context",
    generated_at_utc: "2026-08-17T08:00:00.000Z",
    expires_at_utc: "2026-08-17T08:45:00.000Z",
  }));
  const service = new StrategySignalDecisionPipelineService({
    signalBusRepository,
    contextGate: new AiContextGateService({ repository: new InMemoryAiContextGateRepository() }),
    riskRuntime: new PortfolioRiskRuntimeService({ repository: new InMemoryPortfolioRiskRuntimeRepository(), clock: clock() }),
    execution: new PortfolioOrderIntentExecutionService({ repository: new InMemoryPortfolioOrderIntentExecutionRepository(), clock: clock() }),
    providerCounts: async () => ({ commands: 0, events: 0 }),
    clock: clock(),
  });

  const result = await service.runOnce({ now_utc: NOW, account_id: "shadow_live" });
  const saved = (await signalBusRepository.listRecent()).find((signal) => signal.signal_id === "signal-expired-before-context");

  assert.equal(result.status, "NO_PENDING_SIGNALS");
  assert.deepEqual(result.expired_signal_outbox_ids, [published.signal_outbox_id]);
  assert.equal(saved.status, "CANCELLED");
  assert.equal(saved.last_error, "SIGNAL_EXPIRED_BEFORE_DECISION_PIPELINE");
  assert.equal((await signalBusRepository.pollPending({ now_utc: NOW })).length, 0);
});

function signalCore(overrides = {}) {
  const signal = {
    signal_id: "signal-001",
    strategy_definition_id: "definition-001",
    strategy_instance_id: "instance-001",
    strategy_version_id: "version-001",
    instrument: "MNQ",
    direction: "LONG",
    proposed_size: 2,
    confidence: 0.72,
    execution_mode_origin: "SHADOW",
    generated_at_utc: "2026-08-17T09:10:00.000Z",
    expires_at_utc: "2026-08-17T09:30:00.000Z",
    correlation_id: "corr-signal-001",
    timeframe: "5",
    session: "canonical_strategy_runtime",
    source_data_cutoff_utc: "2026-08-17T09:10:00.000Z",
    source_class: "LIVE",
    setup: { setup_id: "setup-001", pattern: "BREAKOUT_RETEST" },
    predicates: [{ code: "CANONICAL_STRATEGY_CONDITIONS_SATISFIED", state: "SATISFIED" }],
    evidence: [{ kind: "TEST", ref: "test://strategy-signal" }],
    reason_codes: ["CANONICAL_STRATEGY_CONDITIONS_SATISFIED"],
    proposed_trade_plan: {
      order_type: "LIMIT",
      instrument: "MNQ",
      direction: "LONG",
      entry_price: 28000,
      stop_price: 27980,
      targets: [28040],
      source_data_cutoff_utc: "2026-08-17T09:10:00.000Z",
    },
    trade_plan_economics: {
      risk_points: 20,
      reward_points: 40,
      rr: 2,
    },
    availability: "KNOWN",
    payload_hash: "hash",
    dedupe_key: "signal-001",
    status: "PENDING",
  };
  return { ...signal, ...overrides };
}

function signalOutbox(overrides = {}) {
  const signal = signalCore(overrides);
  return {
    ...signal,
    payload: overrides.payload || { schema_version: "desk_event_envelope_v1", payload: signal },
  };
}

function clock() {
  return { now: () => ({ utc: NOW }) };
}
