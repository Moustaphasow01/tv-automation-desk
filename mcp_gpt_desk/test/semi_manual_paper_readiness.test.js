import assert from "node:assert/strict";
import test from "node:test";

import { brokerExecutionEnvironment } from "@tv-automation/desk-domain";
import { AiContextGateService } from "../src/ai-context-gate-service.js";
import { InMemoryAiContextGateRepository } from "../src/ai-context-gate-repository.js";
import { BrokerExecutionService } from "../src/broker-execution-service.js";
import { PortfolioOrderIntentExecutionService } from "../src/portfolio-order-intent-execution-service.js";
import { InMemoryPortfolioOrderIntentExecutionRepository } from "../src/portfolio-order-intent-execution-repository.js";
import { PortfolioRiskRuntimeService } from "../src/portfolio-risk-runtime-service.js";
import { InMemoryPortfolioRiskRuntimeRepository } from "../src/portfolio-risk-runtime-repository.js";
import { buildTelegramTradingMessage } from "../src/telegram-trading-message.js";

const NOW = "2026-08-14T09:20:00.000Z";
const CLOCK = { now: () => ({ utc: NOW, paris: "2026-08-14T11:20:00+02:00" }) };
const MANUAL_ENVIRONMENT = brokerExecutionEnvironment({
  DESK_MANUAL_TELEGRAM_EXECUTION_ENABLED: "true",
  DESK_BROKER_EXECUTION_ENABLED: "false",
  DESK_NINJA_BRIDGE_MODE: "disabled",
  DESK_NINJA_KILL_SWITCH: "true",
});

test("LOT-012 SEMI_MANUAL path notifies operator and blocks broker dispatch until Human Gate", async () => {
  const context = await runContextGate();
  const pipeline = await runPortfolioRiskPipeline({ proposed_size: 2 });
  const lineage = lineageFromPipeline(pipeline);
  const executionRepository = new InMemoryPortfolioOrderIntentExecutionRepository({ lineages: [lineage] });
  const execution = new PortfolioOrderIntentExecutionService({ repository: executionRepository, clock: CLOCK });

  const blocked = await execution.materializeReadyCommands({
    provider_profile: providerProfile(),
    execution_mode: "SEMI_MANUAL",
  });
  const notification = buildManualNotification({ context, lineage });

  assert.equal(context.status, "SHADOW_RECORDED");
  assert.equal(pipeline.status, "ORDER_INTENTS_READY");
  assert.equal(blocked.status, "BLOCKED");
  assert.equal(blocked.count, 0);
  assert.equal(blocked.items[0].reason, "HUMAN_CONFIRMATION_REQUIRED");
  assert.equal(executionRepository.providerCommands.size, 0);
  assert.match(notification, /MANUAL ACTION REQUIRED/);
  assert.match(notification, /Human Gate: AWAITING_MANUAL_CONFIRMATION/);
  assert.match(notification, /Strategy: TD2-P0-MNQ-IB-REVERSAL/);
  assert.match(notification, /Risk: APPROVED/);
  assert.match(notification, /Context: TAKE/);
  assert.match(notification, /Invalidation:/);
  assert.match(notification, /Aucun ordre Ninja\/broker n’a été envoyé/);
});

test("LOT-012 operator confirm is idempotent and immutable before PAPER provider command", async () => {
  const pipeline = await runPortfolioRiskPipeline({ proposed_size: 2 });
  const lineage = lineageFromPipeline(pipeline);
  const repository = new InMemoryPortfolioOrderIntentExecutionRepository({ lineages: [lineage] });
  const execution = new PortfolioOrderIntentExecutionService({ repository, clock: CLOCK });

  const wrongQuantity = await execution.confirmHumanGate(confirmInput(lineage, {
    idempotencyKey: "lot-012-confirm-wrong-quantity",
    approvedTerms: { quantity: 3 },
  }));
  const wrongAccount = await execution.confirmHumanGate(confirmInput(lineage, {
    idempotencyKey: "lot-012-confirm-wrong-account",
    approvedTerms: { account_id: "live_account_001" },
  }));
  const first = await execution.confirmHumanGate(confirmInput(lineage));
  const second = await execution.confirmHumanGate(confirmInput(lineage));
  const materialized = await execution.materializeReadyCommands({
    provider_profile: providerProfile(),
    execution_mode: "PAPER",
    allowed_paper_accounts: ["ninjatrader_paper_local"],
  });

  assert.equal(wrongQuantity.status, "REFUSED");
  assert.equal(wrongQuantity.reason, "HUMAN_GATE_QUANTITY_IMMUTABLE");
  assert.equal(wrongAccount.status, "REFUSED");
  assert.equal(wrongAccount.reason, "HUMAN_GATE_ACCOUNT_IMMUTABLE");
  assert.equal(first.status, "CONFIRMED");
  assert.equal(second.status, "CONFIRMED");
  assert.equal(second.idempotent, true);
  assert.equal(materialized.status, "PROVIDER_COMMANDS_READY");
  assert.equal(materialized.count, 1);
  assert.equal(repository.providerCommands.size, 1);
});

test("LOT-012 expired and stale intents fail closed before provider command", async () => {
  const pipeline = await runPortfolioRiskPipeline({ proposed_size: 1 });
  const lineage = lineageFromPipeline(pipeline);
  const repository = new InMemoryPortfolioOrderIntentExecutionRepository({ lineages: [lineage] });
  const execution = new PortfolioOrderIntentExecutionService({ repository, clock: CLOCK });

  await execution.ensureHumanGate({
    portfolioOrderIntentId: lineage.portfolio_order_intent_id,
    expiresAtUtc: "2026-08-14T09:10:00.000Z",
  });
  const confirmation = await execution.confirmHumanGate(confirmInput(lineage));
  const materialized = await execution.materializeReadyCommands({
    provider_profile: providerProfile(),
    execution_mode: "PAPER",
  });

  assert.equal(confirmation.status, "REFUSED");
  assert.equal(confirmation.reason, "HUMAN_GATE_EXPIRED");
  assert.equal(materialized.status, "BLOCKED");
  assert.equal(materialized.items[0].reason, "HUMAN_GATE_EXPIRED");
  assert.equal(repository.providerCommands.size, 0);
});

test("LOT-012 operator reject blocks PAPER provider command with explicit reason", async () => {
  const pipeline = await runPortfolioRiskPipeline({ proposed_size: 1 });
  const lineage = lineageFromPipeline(pipeline);
  const repository = new InMemoryPortfolioOrderIntentExecutionRepository({ lineages: [lineage] });
  const execution = new PortfolioOrderIntentExecutionService({ repository, clock: CLOCK });

  const rejection = await execution.rejectHumanGate({
    portfolioOrderIntentId: lineage.portfolio_order_intent_id,
    idempotencyKey: "lot-012-reject-human-gate",
    operatorId: "operator@example.test",
    reason: "manual operator skipped setup",
  });
  const materialized = await execution.materializeReadyCommands({
    provider_profile: providerProfile(),
    execution_mode: "PAPER",
  });

  assert.equal(rejection.status, "REJECTED");
  assert.equal(materialized.status, "BLOCKED");
  assert.equal(materialized.items[0].reason, "HUMAN_GATE_REJECTED");
  assert.equal(repository.providerCommands.size, 0);
});

test("LOT-012 stale signal produces no OrderIntent to notify or dispatch", async () => {
  const pipeline = await runPortfolioRiskPipeline({
    proposed_size: 1,
    signal_expires_at_utc: "2026-08-14T09:10:00.000Z",
  });

  assert.equal(pipeline.status, "NO_ACTIVE_SIGNALS");
  assert.equal(pipeline.allocations.candidate_allocations.length, 0);
  assert.equal(pipeline.targets.target_positions.length, 0);
  assert.equal(pipeline.intents.order_intents.length, 0);
});

test("LOT-012 manual external fills are matched or flagged without mutating theoretical fills", async () => {
  const pipeline = await runPortfolioRiskPipeline({ proposed_size: 2 });
  const lineage = lineageFromPipeline(pipeline);
  const repository = new TheoreticalFakeRepository({ entryCandle: candle({ low: 28001 }) });
  const broker = new BrokerExecutionService({
    repository,
    persistence: {},
    clock: CLOCK,
    environment: MANUAL_ENVIRONMENT,
  });

  const matched = await broker.recordManualExecutionEvent(manualEvent(lineage, { quantity: 2, idempotencyKey: "lot-012-manual-fill-match" }), { kind: "telegram-operator" });
  const mismatch = await broker.recordManualExecutionEvent(manualEvent(lineage, { quantity: 3, idempotencyKey: "lot-012-manual-fill-mismatch" }), { kind: "front-operator" });
  const theoretical = await broker.processTheoreticalExecution();

  assert.equal(matched.event.payload.manual_reconciliation.status, "MATCHED_MANUAL_EXECUTION");
  assert.equal(mismatch.event.payload.manual_reconciliation.status, "RECONCILIATION_MISMATCH");
  assert.deepEqual(mismatch.event.payload.manual_reconciliation.mismatches.map((item) => item.field), ["quantity"]);
  assert.equal(theoretical.status, "NO_THEORETICAL_FILL");
  assert.equal(repository.entryFill, null);
  assert.equal(repository.manualEvents.length, 2);
});

test("LOT-012 market moved does not fill a theoretical LIMIT until a closed candle touches", async () => {
  const untouched = new TheoreticalFakeRepository({ entryCandle: candle({ low: 28001 }) });
  const touched = new TheoreticalFakeRepository({ entryCandle: candle({ low: 27999.75 }) });

  const noFill = await brokerWith(untouched).processTheoreticalExecution();
  const fill = await brokerWith(touched).processTheoreticalExecution();

  assert.equal(noFill.entries[0].reason, "LIMIT_NOT_TOUCHED");
  assert.equal(untouched.entryFill, null);
  assert.equal(fill.entries[0].action, "fill_entry");
  assert.equal(touched.entryFill.result.price, 28000);
});

async function runContextGate() {
  const service = new AiContextGateService({ repository: new InMemoryAiContextGateRepository() });
  return service.evaluateAndPersist({
    idempotency_key: "lot-012-ai-context-gate",
    policy: { mode: "SHADOW", policy_version: "lot-012-policy-v1", model_policy_version: "agent-routing-ultra-v1" },
    signal_id: "signal-lot-012",
    advisory: {
      recommendation: "TAKE",
      confidence: 0.78,
      risk_multiplier: 1,
      reason_codes: ["CONTEXT_ALIGNED", "VOLATILITY_ACCEPTABLE"],
      anomalies: [],
      invalidation: { condition: "MNQ closes below IB low", reason_code: "IB_FAILURE" },
      rationale: "Context Gate observes the deterministic signal and does not create orders.",
      model_ref: "codex/context-gate/ultra",
      evidence_refs: [{ ref: "dataset:lot-012:2026-08-14T09:15Z" }],
      issued_at_utc: "2026-08-14T09:19:30.000Z",
    },
    as_of_utc: NOW,
  });
}

async function runPortfolioRiskPipeline(overrides = {}) {
  const repository = new InMemoryPortfolioRiskRuntimeRepository();
  const service = new PortfolioRiskRuntimeService({ repository, clock: CLOCK });
  return service.runPipeline(commandFixture(overrides));
}

function buildManualNotification({ context, lineage }) {
  const intent = lineage.order_intent_payload;
  return buildTelegramTradingMessage({
    kind: "order_intent",
    state: "awaiting_manual_confirmation",
    sourceId: intent.order_intent_id,
    occurredAt: NOW,
    manualTelegramExecution: true,
    payload: {
      ...intent,
      side: intent.action,
      limit_price: 28000,
      protective_stop: intent.protection.stop_price,
      profit_target: intent.protection.target_price,
      strategy_id: "TD2-P0-MNQ-IB-REVERSAL",
      strategy_instance_id: "strategy-instance-lot-012",
      human_gate_status: "AWAITING_MANUAL_CONFIRMATION",
      risk_decision: "APPROVED",
      context_gate_decision: context.result.decision.recommendation,
      invalidation: context.result.decision.invalidation,
      rationale: "Signal déterministe validé par contexte; ordre à poser uniquement par opérateur.",
    },
  });
}

function lineageFromPipeline(result) {
  const intent = result.intents.order_intents[0];
  const target = result.targets.target_positions[0];
  return {
    portfolio_order_intent_id: intent.order_intent_id,
    target_position_id: intent.target_position_id,
    trade_order_intent_id: null,
    idempotency_key: intent.idempotency_key,
    status: intent.status,
    broker_submission_allowed: intent.broker_submission_allowed,
    quantity: intent.quantity,
    payload: intent,
    order_intent_payload: intent,
    target_account_id: target.account_id,
    target_instrument: target.instrument,
    candidate_allocation_ids: target.candidate_allocation_ids,
    risk_decision_ids: target.derived_from_risk_decision_ids,
  };
}

function commandFixture(overrides = {}) {
  return {
    as_of_utc: NOW,
    account_id: "ninjatrader_paper_local",
    portfolio_scope: "ninjatrader_paper_local",
    idempotency_key: `lot-012:${overrides.proposed_size || 1}:${overrides.signal_expires_at_utc || "valid"}`,
    signals: [{
      signal_id: "signal-lot-012",
      strategy_instance_id: "strategy-instance-lot-012",
      strategy_version_id: "strategy-version-lot-012",
      instrument: "MNQ",
      direction: "LONG",
      proposed_size: overrides.proposed_size || 1,
      confidence: 0.78,
      execution_mode_origin: "PAPER",
      generated_at_utc: "2026-08-14T09:18:00.000Z",
      expires_at_utc: overrides.signal_expires_at_utc || "2026-08-14T09:45:00.000Z",
      status: "ACTIVE",
    }],
    risk_budget: {
      budget_id: "risk-budget-lot-012",
      max_portfolio_abs_size: 10,
      max_account_abs_size: { ninjatrader_paper_local: 10 },
      max_instrument_abs_size: { MNQ: 4 },
    },
    execution_policy: {
      provider_id: "ninjatrader",
      broker_account_id: "ninjatrader_paper_local",
      submission_enabled: true,
      order_type: "LIMIT",
      time_in_force: "DAY",
      provider_contracts: { MNQ: { provider_contract_id: "nt_mnq", provider_symbol: "MNQ SEP26", instrument: "MNQ" } },
    },
    default_protection_plan: { stop_price: 27950, target_price: 28100, max_slippage_ticks: 4 },
  };
}

function confirmInput(lineage, overrides = {}) {
  return {
    portfolioOrderIntentId: lineage.portfolio_order_intent_id,
    idempotencyKey: "lot-012-confirm-human-gate",
    operatorId: "operator@example.test",
    approvedTerms: {
      account_id: lineage.target_account_id,
      broker_account_id: lineage.target_account_id,
      instrument: lineage.target_instrument,
      action: lineage.payload.action,
      quantity: lineage.quantity,
    },
    ...overrides,
  };
}

function providerProfile(overrides = {}) {
  return {
    provider_id: "ninjatrader",
    adapter_id: "ninjatrader-addon",
    provider_account_id: "ninjatrader_paper_local",
    contracts: { MNQ: { provider_contract_id: "nt_mnq", provider_symbol: "MNQ SEP26", instrument: "MNQ" } },
    ...overrides,
  };
}

function manualEvent(lineage, overrides = {}) {
  return {
    eventType: "filled",
    orderIntentId: lineage.portfolio_order_intent_id,
    instrument: lineage.target_instrument,
    side: lineage.payload.action,
    expectedInstrument: lineage.target_instrument,
    expectedSide: lineage.payload.action,
    expectedQuantity: lineage.quantity,
    price: 28000,
    quantity: lineage.quantity,
    source: "telegram",
    reason: "operator reported external paper fill",
    ...overrides,
  };
}

function brokerWith(repository) {
  return new BrokerExecutionService({ repository, persistence: {}, clock: CLOCK, environment: MANUAL_ENVIRONMENT });
}

class TheoreticalFakeRepository {
  constructor({ entryCandle = null } = {}) {
    this.available = true;
    this.entryCandle = entryCandle;
    this.entryFill = null;
    this.entryExpired = null;
    this.manualEvents = [];
  }

  async listTheoreticalEntryCandidates() { return [entryCandidate()]; }
  async latestClosedCandleForIntent() { return this.entryCandle; }
  async listTheoreticalOpenTrades() { return []; }
  async recordTheoreticalEntryFill(input) { this.entryFill = input; return { event: { theoretical_execution_event_id: "theoretical_event_fill" } }; }
  async recordTheoreticalEntryExpired(input) { this.entryExpired = input; return { event: { theoretical_execution_event_id: "theoretical_event_expired" } }; }
  async recordTheoreticalExitFill(input) { this.exitFill = input; return { event: { theoretical_execution_event_id: "theoretical_event_exit" } }; }
  async recordTheoreticalReviewRequired(input) { this.review = input; return { event: { theoretical_execution_event_id: "theoretical_event_review" } }; }
  async recordManualExecutionEvent({ event }) { this.manualEvents.push(event); return { manual_execution_event_id: `manual_${this.manualEvents.length}`, ...event }; }
}

function entryCandidate() {
  return {
    order_intent_id: "portfolio_order_intent_lot_012",
    trade_decision_id: "trade_decision_lot_012",
    broker_account_id: "ninjatrader_paper_local",
    broker_contract_id: "nt_mnq",
    side: "buy",
    order_type: "limit",
    quantity: 2,
    limit_price: 28000,
    stop_price: null,
    requested_at: "2026-08-14T09:18:00.000Z",
    expires_at: "2026-08-14T09:45:00.000Z",
    bracket: { stop_price: 27950, target_price: 28100 },
    payload: { instrument: "MNQ", atm_strategy_id: "desk_manual" },
    instrument_code: "MNQ",
    contract_instrument_code: "MNQ",
    decision_side: "long",
    trading_date: "2026-08-14",
    session: "ny_open",
    strategy_id: "TD2-P0-MNQ-IB-REVERSAL",
    entry_plan: { order_type: "limit", entry_price: 28000, limit_price: 28000 },
    risk_plan: { stop_price: 27950, target_price: 28100 },
  };
}

function candle({ low = 27999.75, high = 28025, open = 28010, close = 28020 } = {}) {
  return {
    feed_id: "prod__tradingview__MNQ1!__1",
    symbol_code: "MNQ",
    timeframe: "1",
    timestamp_utc: NOW,
    open,
    high,
    low,
    close,
  };
}
