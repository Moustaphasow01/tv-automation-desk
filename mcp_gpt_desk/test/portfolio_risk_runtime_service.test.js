import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  InMemoryPortfolioRiskRuntimeRepository,
  PostgresPortfolioRiskRuntimeRepository,
} from "../src/portfolio-risk-runtime-repository.js";
import { PortfolioRiskRuntimeService } from "../src/portfolio-risk-runtime-service.js";

const NOW = "2026-08-13T09:15:00.000Z";

describe("Portfolio Risk Runtime service", () => {
  test("persists ACCEPT lineage from StrategySignal to OrderIntent", async () => {
    const repository = new InMemoryPortfolioRiskRuntimeRepository();
    const service = serviceFor(repository);

    const result = await service.runPipeline(commandFixture());
    const intent = result.intents.order_intents[0];
    const lineage = await repository.loadOrderIntentLineage({ portfolioOrderIntentId: intent.order_intent_id });

    assert.equal(result.status, "ORDER_INTENTS_READY");
    assert.equal(result.persistence.counts.allocations, 1);
    assert.equal(result.persistence.counts.risk_decisions, 1);
    assert.equal(result.persistence.counts.target_positions, 1);
    assert.equal(result.persistence.counts.order_intents, 1);
    assert.equal(lineage.target_position_id, result.targets.target_positions[0].id);
    assert.deepEqual(lineage.candidate_allocation_ids, result.targets.target_positions[0].candidate_allocation_ids);
    assert.deepEqual(lineage.risk_decision_ids, result.targets.target_positions[0].derived_from_risk_decision_ids);
  });

  test("fails closed and persists no TargetPosition or OrderIntent when Global Risk is unavailable", async () => {
    const repository = new InMemoryPortfolioRiskRuntimeRepository();
    const service = serviceFor(repository);

    const result = await service.runPipeline(commandFixture({ risk_budget: {} }));

    assert.equal(result.risk.status, "CONFIG_MISSING");
    assert.equal(result.targets.target_positions.length, 0);
    assert.equal(result.intents.order_intents.length, 0);
    assert.equal(result.persistence.counts.allocations, 1);
    assert.equal(result.persistence.counts.risk_decisions, 0);
    assert.equal(result.persistence.counts.target_positions, 0);
    assert.equal(result.persistence.counts.order_intents, 0);
  });

  test("does not certify daily loss usage as zero when the theoretical projection lacks final outcomes", async () => {
    const repository = new InMemoryPortfolioRiskRuntimeRepository();
    const result = await serviceFor(repository).runPipeline(commandFixture({
      risk_budget: { max_daily_loss_r: 2, max_portfolio_abs_size: 5 },
    }));

    assert.equal(result.status, "EXPOSURE_UNAVAILABLE");
    assert.equal(result.targets.target_positions.length, 0);
    assert.equal(result.intents.order_intents.length, 0);
    assert.ok(result.risk.reason_codes.includes("LOSS_USAGE_UNAVAILABLE"));
  });

  test("reserves an existing theoretical position instead of treating a same-side signal as a reduction instruction", async () => {
    const repository = new InMemoryPortfolioRiskRuntimeRepository();
    const result = await serviceFor(repository).runPipeline(commandFixture({
      positions: [{ position_id: "theory-open", account_id: "paper-sim101", instrument: "MNQ", direction: "LONG", size: 2 }],
    }));

    assert.equal(result.allocations.candidate_allocations.length, 0);
    assert.equal(result.intents.order_intents.length, 0);
    assert.ok(result.allocations.rejected_signals[0].issues.some((item) => item.code === "PORTFOLIO_THEORETICAL_POSITION_RESERVED"));
  });

  test("is idempotent for the same runtime command key", async () => {
    const repository = new InMemoryPortfolioRiskRuntimeRepository();
    const service = serviceFor(repository);

    const first = await service.runPipeline(commandFixture({ idempotency_key: "portfolio-risk-command-1" }));
    const replay = await service.runPipeline(commandFixture({ idempotency_key: "portfolio-risk-command-1" }));

    assert.equal(first.persistence.status, "PERSISTED");
    assert.equal(replay.persistence.status, "IDEMPOTENT");
    assert.equal(repository.runs.size, 1);
    assert.equal(repository.orderIntents.size, 1);
  });

  test("preserves account-scoped multi-strategy allocations before TargetPosition netting", async () => {
    const repository = new InMemoryPortfolioRiskRuntimeRepository();
    const service = serviceFor(repository);

    const result = await service.runPipeline(commandFixture({
      idempotency_key: "portfolio-risk-multi-account",
      signals: [
        signal({ signal_id: "sig-sim101", account_id: "paper-sim101", strategy_instance_id: "inst-a", proposed_size: 1 }),
        signal({ signal_id: "sig-sim102", account_id: "paper-sim102", strategy_instance_id: "inst-b", proposed_size: 1 }),
      ],
      risk_budget: {
        budget_id: "risk-budget-multi-account",
        max_portfolio_abs_size: 10,
        max_account_abs_size: { "paper-sim101": 2, "paper-sim102": 2 },
        max_instrument_abs_size: { MNQ: 4 },
      },
    }));

    assert.equal(result.status, "ORDER_INTENTS_READY");
    assert.equal(result.allocations.candidate_allocations.length, 2);
    assert.deepEqual(result.allocations.candidate_allocations.map((item) => item.account_id).sort(), ["paper-sim101", "paper-sim102"]);
    assert.equal(result.targets.target_positions.length, 2);
    assert.deepEqual(result.targets.target_positions.map((item) => item.account_id).sort(), ["paper-sim101", "paper-sim102"]);
    assert.equal(result.persistence.counts.allocations, 2);
  });

  test("consumes pending Strategy Signal Bus rows only after persistence", async () => {
    const repository = new InMemoryPortfolioRiskRuntimeRepository();
    const signalBus = new FakeSignalBusRepository([signalOutbox()]);
    const service = serviceFor(repository, signalBus);

    const result = await service.processPendingSignals(commandFixture({ idempotency_key: "portfolio-risk-signal-bus-1" }));

    assert.equal(result.status, "ORDER_INTENTS_READY");
    assert.deepEqual(result.consumed_signal_outbox_ids, ["signal-outbox-1"]);
    assert.equal(signalBus.consumed[0].consumer_id, "portfolio-risk-runtime");
    assert.equal(repository.runs.size, 1);
  });

  test("PostgreSQL adapter writes the canonical transaction in pipeline order", async () => {
    const calls = [];
    const client = {
      async query(sql, params = []) {
        calls.push({ sql, params });
        if (/SELECT \* FROM portfolio_arbitration_runs/.test(sql)) return { rows: [] };
        if (/WITH open_positions AS/.test(sql)) {
          return { rows: [{ positions: [], intents: [], qualified: [], loss_usage: {
            daily_realized_r: 0, weekly_realized_r: 0, final_outcome_count: 0, unproven_final_outcome_count: 0, missing_closed_final_outcome_count: 0,
            period_timezone: "UTC", provenance: "THEORETICAL_FINAL_OUTCOMES",
          } }] };
        }
        return { rows: [] };
      },
      release() {},
    };
    const repository = new PostgresPortfolioRiskRuntimeRepository({
      initialized: Promise.resolve(),
      pool: { async connect() { return client; } },
    });
    const service = serviceFor(repository);

    await service.runPipeline(commandFixture({ idempotency_key: "portfolio-risk-postgres-1" }));

    assert.equal(calls[0].sql, "BEGIN");
    assert.equal(calls.some((call) => /pg_advisory_xact_lock/.test(call.sql)), true);
    assert.equal(calls.at(-1).sql, "COMMIT");
    assert.equal(calls.some((call) => /INSERT INTO portfolio_arbitration_runs/.test(call.sql)), true);
    assert.equal(calls.some((call) => /INSERT INTO portfolio_candidate_allocations/.test(call.sql)), true);
    assert.equal(calls.find((call) => /INSERT INTO portfolio_candidate_allocations/.test(call.sql)).sql.includes("account_id"), true);
    assert.equal(calls.some((call) => /INSERT INTO portfolio_risk_decisions/.test(call.sql)), true);
    assert.equal(calls.some((call) => /INSERT INTO portfolio_target_positions/.test(call.sql)), true);
    assert.equal(calls.some((call) => /INSERT INTO portfolio_order_intent_lineage/.test(call.sql)), true);
  });
});

class FakeSignalBusRepository {
  constructor(items) {
    this.items = items;
    this.consumed = [];
  }

  async pollPending() {
    return this.items;
  }

  async markConsumed(input) {
    this.consumed.push(input);
    return { signal_outbox_id: input.signal_outbox_id, status: "CONSUMED", consumer_id: input.consumer_id };
  }
}

function serviceFor(repository, signalBusRepository = null) {
  return new PortfolioRiskRuntimeService({
    repository,
    signalBusRepository,
    clock: { now: () => ({ utc: NOW }) },
  });
}

function commandFixture(overrides = {}) {
  return {
    as_of_utc: NOW,
    account_id: "paper-sim101",
    portfolio_scope: "paper-sim101",
    idempotency_key: "portfolio-risk-runtime-command",
    correlation_id: "corr-lot-003",
    signals: [signal()],
    risk_budget: {
      budget_id: "risk-budget-lot-003",
      max_portfolio_abs_size: 10,
      max_account_abs_size: { "paper-sim101": 10 },
      max_instrument_abs_size: { MNQ: 4 },
    },
    execution_policy: {
      provider_id: "provider-neutral-test",
      broker_account_id: "paper-sim101",
      submission_enabled: true,
      order_type: "LIMIT",
      time_in_force: "DAY",
    },
    default_protection_plan: {
      stop_price: 27900,
      target_price: 28100,
      max_slippage_ticks: 4,
    },
    ...overrides,
  };
}

function signal(overrides = {}) {
  return {
    signal_id: "sig-lot-003",
    strategy_instance_id: "strategy-instance-lot-003",
    strategy_version_id: "strategy-version-lot-003",
    instrument: "MNQ",
    direction: "LONG",
    proposed_size: 2,
    confidence: 0.72,
    execution_mode_origin: "SHADOW",
    generated_at_utc: "2026-08-13T09:14:00.000Z",
    expires_at_utc: "2026-08-13T09:30:00.000Z",
    correlation_id: "corr-lot-003",
    status: "ACTIVE",
    ...overrides,
  };
}

function signalOutbox() {
  const item = signal({ status: "PENDING" });
  return {
    signal_outbox_id: "signal-outbox-1",
    ...item,
    payload: {
      schema_version: "desk_event_envelope_v1",
      payload: item,
    },
  };
}
