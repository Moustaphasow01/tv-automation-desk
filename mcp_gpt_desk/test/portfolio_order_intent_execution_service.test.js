import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildExecutionProviderCommandV1 } from "@tv-automation/desk-domain";
import { PortfolioRiskRuntimeService } from "../src/portfolio-risk-runtime-service.js";
import { InMemoryPortfolioRiskRuntimeRepository } from "../src/portfolio-risk-runtime-repository.js";
import {
  InMemoryPortfolioOrderIntentExecutionRepository,
  PostgresPortfolioOrderIntentExecutionRepository,
} from "../src/portfolio-order-intent-execution-repository.js";
import { PortfolioOrderIntentExecutionService } from "../src/portfolio-order-intent-execution-service.js";

const NOW = "2026-08-13T09:20:00.000Z";

describe("Portfolio OrderIntent -> Execution Gateway service", () => {
  test("materializes a provider command only from persisted Portfolio/Risk lineage", async () => {
    const { lineage } = await persistedLineage();
    const repository = new InMemoryPortfolioOrderIntentExecutionRepository({ lineages: [lineage] });
    const service = serviceFor(repository);
    await service.confirmHumanGate(confirmInput(lineage));

    const result = await service.materializeReadyCommands({ provider_profile: providerProfile() });
    const [item] = result.items;
    const [command] = [...repository.providerCommands.values()];

    assert.equal(result.status, "PROVIDER_COMMANDS_READY");
    assert.equal(result.count, 1);
    assert.equal(item.status, "COMMAND_PERSISTED");
    assert.equal(command.portfolio_order_intent_id, lineage.portfolio_order_intent_id);
    assert.equal(command.order_intent_id, null);
    assert.equal(command.broker_provider_code, "ninjatrader");
    assert.equal(command.status, "pending");
    assert.equal(command.payload.source.kind, "PORTFOLIO_ORDER_INTENT_LINEAGE");
    assert.equal(command.payload.provider_command.source.kind, "ORDER_INTENT");
  });

  test("deduplicates active provider commands for the same portfolio intent", async () => {
    const { lineage } = await persistedLineage();
    const repository = new InMemoryPortfolioOrderIntentExecutionRepository({ lineages: [lineage] });
    const service = serviceFor(repository);
    await service.confirmHumanGate(confirmInput(lineage));

    await service.materializeReadyCommands({ provider_profile: providerProfile() });
    const replay = await service.materializeReadyCommands({ provider_profile: providerProfile() });

    assert.equal(replay.status, "DUPLICATE_PROTECTED");
    assert.equal(replay.duplicates, 1);
    assert.equal(repository.providerCommands.size, 1);
  });

  test("fails closed when lineage is spoofed or incomplete", async () => {
    const repository = new InMemoryPortfolioOrderIntentExecutionRepository({
      lineages: [{
        portfolio_order_intent_id: "portfolio_order_intent_spoof",
        target_position_id: "target_position_spoof",
        status: "READY",
        broker_submission_allowed: true,
        payload: {
          schema_version: "portfolio_order_intent_v1",
          order_intent_id: "portfolio_order_intent_spoof",
          target_position_id: "target_position_spoof",
          account_id: "ninjatrader_paper_local",
          broker_account_id: "ninjatrader_paper_local",
          instrument: "MNQ",
          provider_id: "ninjatrader",
          provider_contract_ref: { provider_id: "ninjatrader", provider_contract_id: "nt_mnq", provider_symbol: "MNQ SEP26", instrument: "MNQ" },
          action: "BUY",
          quantity: 1,
          order_type: "MARKET",
          time_in_force: "DAY",
          lifecycle_action: "OPEN",
          broker_submission_allowed: true,
          protection: { required: true, ready: true, stop_price: 27900, target_price: 28100, max_slippage_ticks: 4, oco_required: true },
          idempotency_key: "spoof-intent-key",
          order_intent_hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          source: { kind: "TARGET_POSITION", target_position_id: "target_position_spoof" },
          audit: { direct_llm_order: false, derived_from_netting_engine: true },
        },
      }],
    });
    const service = serviceFor(repository);
    await service.confirmHumanGate({
      portfolioOrderIntentId: "portfolio_order_intent_spoof",
      idempotencyKey: "confirm-spoof",
      operatorId: "operator@example.test",
      approvedTerms: { account_id: "ninjatrader_paper_local", instrument: "MNQ", action: "BUY", quantity: 1 },
    });

    const result = await service.materializeReadyCommands({ provider_profile: providerProfile() });

    assert.equal(result.status, "BLOCKED");
    assert.equal(result.items[0].reason, "PORTFOLIO_RISK_LINEAGE_INCOMPLETE");
    assert.deepEqual(result.items[0].issues.map((issue) => issue.code), [
      "PORTFOLIO_ARBITRATION_LINEAGE_REQUIRED",
      "GLOBAL_RISK_DECISION_REQUIRED",
    ]);
    assert.equal(repository.providerCommands.size, 0);
  });

  test("fails closed when execution halt is active before any provider command is persisted", async () => {
    const { lineage } = await persistedLineage();
    const repository = new InMemoryPortfolioOrderIntentExecutionRepository({ lineages: [lineage] });
    const service = serviceFor(repository);
    await service.confirmHumanGate(confirmInput(lineage));

    const result = await service.materializeReadyCommands({ provider_profile: providerProfile(), execution_halt: true });

    assert.equal(result.status, "BLOCKED");
    assert.equal(result.items[0].issues[0].code, "PROVIDER_EXECUTION_HALTED");
    assert.equal(repository.providerCommands.size, 0);
  });

  test("PostgreSQL adapter writes broker_provider_commands from portfolio lineage, never broker_execution_outbox", async () => {
    const { lineage } = await persistedLineage();
    const calls = [];
    const client = {
      async query(sql, params = []) {
        calls.push({ sql, params });
        if (/SELECT \*\s+FROM portfolio_order_intent_lineage/.test(sql)) return { rows: [lineage] };
        if (/SELECT \*\s+FROM human_execution_gates/.test(sql)) return { rows: [confirmedGate(lineage)] };
        if (/SELECT \* FROM broker_provider_commands WHERE idempotency_key/.test(sql)) return { rows: [] };
        if (/INSERT INTO broker_provider_commands/.test(sql)) {
          return { rows: [{ execution_provider_command_id: params[0], portfolio_order_intent_id: params[1], idempotency_key: params[8] }] };
        }
        return { rows: [] };
      },
      release() {},
    };
    const repository = new PostgresPortfolioOrderIntentExecutionRepository({
      initialized: Promise.resolve(),
      pool: { async connect() { return client; } },
    });
    const plan = buildExecutionProviderCommandV1({
      as_of_utc: NOW,
      provider_profile: providerProfile(),
      order_intent: lineage.payload,
      active_provider_commands: [],
    });
    const stored = await repository.persistProviderCommand({
      lineage,
      plan,
      nowUtc: NOW,
    });

    assert.equal(stored.status, "PERSISTED");
    assert.equal(stored.provider_command.portfolio_order_intent_id, lineage.portfolio_order_intent_id);
    assert.equal(calls[0].sql, "BEGIN");
    assert.equal(calls.at(-1).sql, "COMMIT");
    assert.equal(calls.some((call) => /INSERT INTO broker_provider_commands/.test(call.sql)), true);
    assert.equal(calls.some((call) => /broker_execution_outbox/.test(call.sql)), false);
  });
});

async function persistedLineage() {
  const repository = new InMemoryPortfolioRiskRuntimeRepository();
  const service = new PortfolioRiskRuntimeService({ repository, clock: clock() });
  const result = await service.runPipeline(commandFixture());
  const intent = result.intents.order_intents[0];
  const target = result.targets.target_positions[0];
  return {
    result,
    lineage: {
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
    },
  };
}

function serviceFor(repository) {
  return new PortfolioOrderIntentExecutionService({ repository, clock: clock() });
}

function clock() {
  return { now: () => ({ utc: NOW }) };
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

function confirmedGate(lineage) {
  return {
    human_execution_gate_id: `human_gate_${lineage.portfolio_order_intent_id}`,
    portfolio_order_intent_id: lineage.portfolio_order_intent_id,
    status: "CONFIRMED",
    revision: 2,
    operator_id: "operator@example.test",
    idempotency_key: `confirm-${lineage.portfolio_order_intent_id}`,
    confirmed_at_utc: NOW,
    rejected_at_utc: null,
    expires_at_utc: null,
    terms_hash: null,
    payload: {},
  };
}

function commandFixture(overrides = {}) {
  return {
    as_of_utc: NOW,
    account_id: "ninjatrader_paper_local",
    portfolio_scope: "ninjatrader_paper_local",
    idempotency_key: "portfolio-risk-runtime-lot-004",
    signals: [{
      signal_id: "signal-lot-004",
      strategy_instance_id: "strategy-instance-lot-004",
      strategy_version_id: "strategy-version-lot-004",
      instrument: "MNQ",
      direction: "LONG",
      proposed_size: 1,
      confidence: 0.72,
      execution_mode_origin: "PAPER",
      generated_at_utc: "2026-08-13T09:19:00.000Z",
      expires_at_utc: "2026-08-13T09:30:00.000Z",
      status: "ACTIVE",
    }],
    risk_budget: {
      budget_id: "risk-budget-lot-004",
      max_portfolio_abs_size: 10,
      max_account_abs_size: { ninjatrader_paper_local: 10 },
      max_instrument_abs_size: { MNQ: 4 },
    },
    execution_policy: {
      provider_id: "ninjatrader",
      broker_account_id: "ninjatrader_paper_local",
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
    ...overrides,
  };
}
