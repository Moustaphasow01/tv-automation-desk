import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PortfolioRiskRuntimeService } from "../src/portfolio-risk-runtime-service.js";
import { InMemoryPortfolioRiskRuntimeRepository } from "../src/portfolio-risk-runtime-repository.js";
import { InMemoryPortfolioOrderIntentExecutionRepository } from "../src/portfolio-order-intent-execution-repository.js";
import { PortfolioOrderIntentExecutionService } from "../src/portfolio-order-intent-execution-service.js";

const NOW = "2026-08-14T09:20:00.000Z";

describe("LOT-005 Human Execution Gate + provider lifecycle", () => {
  test("Risk APPROVED without operator confirmation creates zero provider commands", async () => {
    const { repository, service } = await runtime();

    const result = await service.materializeReadyCommands({ provider_profile: providerProfile() });

    assert.equal(result.status, "BLOCKED");
    assert.equal(result.count, 0);
    assert.equal(result.items[0].reason, "HUMAN_CONFIRMATION_REQUIRED");
    assert.equal(repository.providerCommands.size, 0);
  });

  test("Risk APPROVED plus operator CONFIRM creates exactly one provider command", async () => {
    const { lineage, repository, service } = await runtime();

    const confirmation = await service.confirmHumanGate(confirmInput(lineage));
    const result = await service.materializeReadyCommands({ provider_profile: providerProfile() });

    assert.equal(confirmation.status, "CONFIRMED");
    assert.equal(result.status, "PROVIDER_COMMANDS_READY");
    assert.equal(result.count, 1);
    assert.equal(repository.providerCommands.size, 1);
    assert.equal([...repository.providerCommands.values()][0].portfolio_order_intent_id, lineage.portfolio_order_intent_id);
  });

  test("double CONFIRM and replay materialization remain idempotent", async () => {
    const { lineage, repository, service } = await runtime();

    assert.equal((await service.confirmHumanGate(confirmInput(lineage))).status, "CONFIRMED");
    assert.equal((await service.confirmHumanGate(confirmInput(lineage))).idempotent, true);
    assert.equal((await service.materializeReadyCommands({ provider_profile: providerProfile() })).count, 1);
    assert.equal((await service.materializeReadyCommands({ provider_profile: providerProfile() })).duplicates, 1);

    assert.equal(repository.humanGates.size, 1);
    assert.equal(repository.providerCommands.size, 1);
  });

  test("Risk REJECTED cannot be force-confirmed into a provider command", async () => {
    const { lineage, repository, service } = await runtime({ risk_budget: { max_portfolio_abs_size: 0, max_account_abs_size: { ninjatrader_paper_local: 0 }, max_instrument_abs_size: { MNQ: 0 } } });

    const confirmation = await service.confirmHumanGate(confirmInput(lineage));
    const result = await service.materializeReadyCommands({ provider_profile: providerProfile() });

    assert.equal(confirmation.status, "REFUSED");
    assert.equal(confirmation.reason, "PORTFOLIO_ORDER_INTENT_NOT_SUBMITTABLE");
    assert.equal(result.status, "NO_PORTFOLIO_ORDER_INTENTS");
    assert.equal(repository.providerCommands.size, 0);
  });

  test("expired intent refuses confirmation and never dispatches", async () => {
    const { lineage, repository, service } = await runtime();

    await service.ensureHumanGate({
      portfolioOrderIntentId: lineage.portfolio_order_intent_id,
      expiresAtUtc: "2026-08-14T09:10:00.000Z",
    });
    const confirmation = await service.confirmHumanGate(confirmInput(lineage));
    const result = await service.materializeReadyCommands({ provider_profile: providerProfile() });

    assert.equal(confirmation.status, "REFUSED");
    assert.equal(confirmation.reason, "HUMAN_GATE_EXPIRED");
    assert.equal(result.status, "BLOCKED");
    assert.equal(repository.providerCommands.size, 0);
  });

  test("operator cannot increase quantity or change account after Risk", async () => {
    const { lineage, service } = await runtime({ proposed_size: 2 });

    const bigger = await service.confirmHumanGate(confirmInput(lineage, { idempotencyKey: "confirm-too-big", approvedTerms: { quantity: 5 } }));
    const wrongAccount = await service.confirmHumanGate(confirmInput(lineage, { idempotencyKey: "confirm-wrong-account", approvedTerms: { account_id: "live_account_001" } }));

    assert.equal(bigger.status, "REFUSED");
    assert.equal(bigger.reason, "HUMAN_GATE_QUANTITY_IMMUTABLE");
    assert.equal(wrongAccount.status, "REFUSED");
    assert.equal(wrongAccount.reason, "HUMAN_GATE_ACCOUNT_IMMUTABLE");
  });

  test("SHADOW confirmation produces zero physical provider command", async () => {
    const { lineage, repository, service } = await runtime();

    await service.confirmHumanGate(confirmInput(lineage));
    const result = await service.materializeReadyCommands({ provider_profile: providerProfile(), execution_mode: "SHADOW" });

    assert.equal(result.status, "SKIPPED");
    assert.equal(result.reason, "SHADOW_NO_PHYSICAL_DISPATCH");
    assert.equal(repository.providerCommands.size, 0);
  });

  test("PAPER wrong account and implicit LIVE are rejected before provider command", async () => {
    const wrongPaper = await runtime({ account_id: "live_account_001" });
    await wrongPaper.service.confirmHumanGate(confirmInput(wrongPaper.lineage, {
      approvedTerms: {
        account_id: "live_account_001",
        broker_account_id: "live_account_001",
        instrument: "MNQ",
        action: "BUY",
        quantity: wrongPaper.lineage.quantity,
      },
    }));
    const paperResult = await wrongPaper.service.materializeReadyCommands({ provider_profile: providerProfile({ provider_account_id: "live_account_001" }), execution_mode: "PAPER" });
    const live = await runtime();
    await live.service.confirmHumanGate(confirmInput(live.lineage));
    const liveResult = await live.service.materializeReadyCommands({ provider_profile: providerProfile(), execution_mode: "LIVE" });

    assert.equal(paperResult.status, "BLOCKED");
    assert.equal(paperResult.items[0].reason, "PAPER_ACCOUNT_NOT_ALLOWED");
    assert.equal(wrongPaper.repository.providerCommands.size, 0);
    assert.equal(liveResult.status, "BLOCKED");
    assert.equal(liveResult.reason, "LIVE_IMPLICIT_DISPATCH_FORBIDDEN");
    assert.equal(live.repository.providerCommands.size, 0);
  });

  test("provider claim is concurrent/idempotent and ACK is not a fill", async () => {
    const { lineage, repository, service } = await runtime({ proposed_size: 2 });
    await service.confirmHumanGate(confirmInput(lineage));
    await service.materializeReadyCommands({ provider_profile: providerProfile() });

    const firstClaim = await service.claimProviderCommand({ providerId: "ninjatrader", dispatcherId: "addon-a", leaseToken: "lease-a", leaseSeconds: 60 });
    const secondClaim = await service.claimProviderCommand({ providerId: "ninjatrader", dispatcherId: "addon-b", leaseToken: "lease-b", leaseSeconds: 60 });
    await service.completeProviderDispatch({
      execution_provider_command_id: firstClaim.work.execution_provider_command_id,
      leaseToken: "lease-a",
      status: "acknowledged",
      providerOrderRef: "NT-ORDER-1",
    });
    await service.recordBrokerProviderEvent(providerEvent(firstClaim.work, { event_type: "ORDER_ACCEPTED", provider_order_ref: "NT-ORDER-1" }));

    const state = repository.executionStates.get(lineage.portfolio_order_intent_id);
    assert.equal(firstClaim.status, "CLAIMED");
    assert.equal(secondClaim.status, "NO_WORK");
    assert.equal(state.lifecycle_status, "ACKNOWLEDGED");
    assert.equal(state.filled_quantity, 0);
  });

  test("partial/full fills evolve state while duplicate fill events do not double count", async () => {
    const { lineage, repository, service } = await runtime({ proposed_size: 2 });
    await service.confirmHumanGate(confirmInput(lineage));
    await service.materializeReadyCommands({ provider_profile: providerProfile() });
    const claim = await service.claimProviderCommand({ providerId: "ninjatrader", dispatcherId: "addon-a", leaseToken: "lease-a" });

    const partial = providerEvent(claim.work, { event_type: "ORDER_PARTIALLY_FILLED", fill_quantity: 1, fill_price: 28010.25, external_event_key: "fill-partial-1" });
    const full = providerEvent(claim.work, { event_type: "ORDER_FILLED", fill_quantity: 2, fill_price: 28012.5, external_event_key: "fill-full-1" });
    const recordedPartial = await service.recordBrokerProviderEvent(partial);
    const duplicatePartial = await service.recordBrokerProviderEvent(partial);
    const recordedFull = await service.recordBrokerProviderEvent(full);

    const state = repository.executionStates.get(lineage.portfolio_order_intent_id);
    assert.equal(recordedPartial.status, "RECORDED");
    assert.equal(duplicatePartial.status, "DUPLICATE");
    assert.equal(recordedFull.status, "RECORDED");
    assert.equal(state.lifecycle_status, "FILLED");
    assert.equal(state.filled_quantity, 2);
    assert.equal(state.average_fill_price, 28012.5);
  });

  test("provider reject and communication timeout do not blind-resend", async () => {
    const rejected = await runtime();
    await rejected.service.confirmHumanGate(confirmInput(rejected.lineage));
    await rejected.service.materializeReadyCommands({ provider_profile: providerProfile() });
    const claim = await rejected.service.claimProviderCommand({ providerId: "ninjatrader", dispatcherId: "addon-a", leaseToken: "lease-a" });
    await rejected.service.recordBrokerProviderEvent(providerEvent(claim.work, { event_type: "ORDER_REJECTED", external_event_key: "reject-1" }));

    const unknown = await runtime();
    await unknown.service.confirmHumanGate(confirmInput(unknown.lineage));
    await unknown.service.materializeReadyCommands({ provider_profile: providerProfile() });
    const unknownClaim = await unknown.service.claimProviderCommand({ providerId: "ninjatrader", dispatcherId: "addon-a", leaseToken: "lease-timeout" });
    await unknown.service.completeProviderDispatch({
      execution_provider_command_id: unknownClaim.work.execution_provider_command_id,
      leaseToken: "lease-timeout",
      status: "timeout",
      error: "COMMUNICATION_LOST_AFTER_SEND",
    });
    const replay = await unknown.service.materializeReadyCommands({ provider_profile: providerProfile() });

    assert.equal(rejected.repository.executionStates.get(rejected.lineage.portfolio_order_intent_id).lifecycle_status, "REJECTED");
    assert.equal(unknown.repository.executionStates.get(unknown.lineage.portfolio_order_intent_id).lifecycle_status, "UNKNOWN");
    assert.equal(replay.status, "DUPLICATE_PROTECTED");
    assert.equal(unknown.repository.providerCommands.size, 1);
  });

  test("operator can undo a decision inside the backend window before provider dispatch", async () => {
    const { lineage, repository } = await runtime();
    const service = new PortfolioOrderIntentExecutionService({ repository, clock: clock(), humanGateUndoPolicy: { enabled: true, windowSeconds: 10 } });
    const confirmed = await service.confirmHumanGate(confirmInput(lineage));

    const reverted = await service.undoHumanGate({
      portfolioOrderIntentId: lineage.portfolio_order_intent_id,
      expectedRevision: confirmed.gate.revision,
      idempotencyKey: "undo-human-gate-1",
      operatorId: "operator@example.test",
      reason: "Correction immédiate de la déclaration opérateur.",
      as_of_utc: "2026-08-14T09:20:05.000Z",
    });

    assert.equal(reverted.status, "REVERTED");
    assert.equal(reverted.gate.status, "AWAITING_MANUAL_CONFIRMATION");
    assert.equal(reverted.gate.revision, 3);
    assert.equal([...repository.humanGateEvents.values()].at(-1).event_type, "REVERTED");
    assert.equal(repository.providerCommands.size, 0);
  });

  test("undo fails closed once a provider command exists", async () => {
    const { lineage, repository } = await runtime();
    const service = new PortfolioOrderIntentExecutionService({ repository, clock: clock(), humanGateUndoPolicy: { enabled: true, windowSeconds: 10 } });
    const confirmed = await service.confirmHumanGate(confirmInput(lineage));
    await service.materializeReadyCommands({ provider_profile: providerProfile() });

    const reverted = await service.undoHumanGate({
      portfolioOrderIntentId: lineage.portfolio_order_intent_id,
      expectedRevision: confirmed.gate.revision,
      idempotencyKey: "undo-human-gate-after-provider",
      operatorId: "operator@example.test",
      reason: "Tentative trop tardive.",
      as_of_utc: "2026-08-14T09:20:05.000Z",
    });

    assert.equal(reverted.status, "REFUSED");
    assert.equal(reverted.reason, "HUMAN_GATE_PROVIDER_COMMAND_EXISTS");
    assert.equal(repository.humanGates.get(lineage.portfolio_order_intent_id).status, "CONFIRMED");
  });
});

async function runtime(overrides = {}) {
  const riskRepository = new InMemoryPortfolioRiskRuntimeRepository();
  const riskService = new PortfolioRiskRuntimeService({ repository: riskRepository, clock: clock() });
  const result = await riskService.runPipeline(commandFixture(overrides));
  const intent = result.intents.order_intents[0] || rejectedIntentFixture(result, overrides);
  const target = result.targets.target_positions[0] || {
    account_id: overrides.account_id || "ninjatrader_paper_local",
    instrument: "MNQ",
    candidate_allocation_ids: [],
    derived_from_risk_decision_ids: [],
  };
  const lineage = {
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
  const repository = new InMemoryPortfolioOrderIntentExecutionRepository({ lineages: [lineage] });
  return { lineage, repository, service: new PortfolioOrderIntentExecutionService({ repository, clock: clock() }) };
}

function rejectedIntentFixture(result, overrides = {}) {
  return {
    schema_version: "portfolio_order_intent_v1",
    order_intent_id: "portfolio_order_intent_rejected_fixture",
    target_position_id: result.targets.target_positions[0]?.target_position_id || "target_rejected_fixture",
    account_id: overrides.account_id || "ninjatrader_paper_local",
    broker_account_id: overrides.account_id || "ninjatrader_paper_local",
    instrument: "MNQ",
    provider_id: "ninjatrader",
    provider_contract_ref: { provider_id: "ninjatrader", provider_contract_id: "nt_mnq", provider_symbol: "MNQ SEP26", instrument: "MNQ" },
    action: "BUY",
    quantity: Math.max(1, Number(overrides.proposed_size || 1)),
    order_type: "MARKET",
    time_in_force: "DAY",
    lifecycle_action: "OPEN",
    broker_submission_allowed: false,
    protection: { required: true, ready: true, stop_price: 27900, target_price: 28100, max_slippage_ticks: 4, oco_required: true },
    idempotency_key: "rejected-fixture-key",
    order_intent_hash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    source: { kind: "TARGET_POSITION", target_position_id: result.targets.target_positions[0]?.target_position_id || "target_rejected_fixture" },
    audit: { direct_llm_order: false, derived_from_netting_engine: true },
    status: "READY",
  };
}

function commandFixture(overrides = {}) {
  return {
    as_of_utc: NOW,
    account_id: overrides.account_id || "ninjatrader_paper_local",
    portfolio_scope: overrides.account_id || "ninjatrader_paper_local",
    idempotency_key: `portfolio-risk-runtime-lot-005-${overrides.account_id || "paper"}-${overrides.proposed_size || 1}-${overrides.signal_expires_at_utc || "valid"}`,
    signals: [{
      signal_id: "signal-lot-005",
      strategy_instance_id: "strategy-instance-lot-005",
      strategy_version_id: "strategy-version-lot-005",
      instrument: "MNQ",
      direction: "LONG",
      proposed_size: overrides.proposed_size || 1,
      confidence: 0.72,
      execution_mode_origin: "PAPER",
      generated_at_utc: "2026-08-14T09:19:00.000Z",
      expires_at_utc: overrides.signal_expires_at_utc || "2026-08-14T09:30:00.000Z",
      status: "ACTIVE",
    }],
    risk_budget: overrides.risk_budget || {
      budget_id: "risk-budget-lot-005",
      max_portfolio_abs_size: 10,
      max_account_abs_size: { [overrides.account_id || "ninjatrader_paper_local"]: 10 },
      max_instrument_abs_size: { MNQ: 4 },
    },
    execution_policy: {
      provider_id: "ninjatrader",
      broker_account_id: overrides.account_id || "ninjatrader_paper_local",
      submission_enabled: true,
      order_type: "MARKET",
      time_in_force: "DAY",
      provider_contracts: { MNQ: { provider_contract_id: "nt_mnq", provider_symbol: "MNQ SEP26", instrument: "MNQ" } },
    },
    default_protection_plan: {
      stop_price: 27900,
      target_price: 28100,
      max_slippage_ticks: 4,
    },
  };
}

function confirmInput(lineage, overrides = {}) {
  return {
    portfolioOrderIntentId: lineage.portfolio_order_intent_id,
    idempotencyKey: `confirm-${lineage.portfolio_order_intent_id}`,
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

function providerEvent(command, overrides = {}) {
  return {
    provider_id: "ninjatrader",
    account_id: command.broker_account_id,
    execution_provider_command_id: command.execution_provider_command_id,
    portfolio_order_intent_id: command.portfolio_order_intent_id,
    provider_order_ref: "NT-ORDER-1",
    event_type: "ORDER_ACCEPTED",
    quantity: command.payload?.provider_command?.quantity || 1,
    occurred_at_utc: "2026-08-14T09:21:00.000Z",
    payload: { source: "lot-005-test" },
    ...overrides,
  };
}

function clock() {
  return { now: () => ({ utc: NOW }) };
}
