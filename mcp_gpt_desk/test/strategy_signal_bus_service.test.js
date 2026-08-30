import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { StrategySignalBusService } from "../src/strategy-signal-bus-service.js";
import { InMemoryStrategySignalBusRepository } from "../src/strategy-signal-bus-repository.js";

const NOW = "2026-08-09T08:00:00.000Z";
const LATER = "2026-08-09T08:05:00.000Z";
const AFTER_EXPIRY = "2026-08-09T08:20:00.000Z";

describe("Strategy Signal Bus service", () => {
  test("publishes signals idempotently by deterministic outbox dedupe key", async () => {
    const repository = new InMemoryStrategySignalBusRepository();
    const service = serviceFor(repository);

    const first = await service.publishSignal(signalFixture(), commandFixture());
    const replayed = await service.publishSignal(signalFixture(), commandFixture());

    assert.equal(first.status, "PUBLISHED");
    assert.equal(replayed.status, "PUBLISHED");
    assert.equal(first.outbox.signal_outbox_id, replayed.outbox.signal_outbox_id);
    assert.equal(first.outbox.dedupe_key, replayed.outbox.dedupe_key);
    assert.equal(repository.outbox.size, 1);
  });

  test("polling returns pending signals when the PostgreSQL notify was missed", async () => {
    const service = serviceFor(new InMemoryStrategySignalBusRepository());
    const published = await service.publishSignal(signalFixture({
      signal_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02",
      correlation_id: "corr-20260809-0805-mnq",
      generated_at_utc: LATER,
      expires_at_utc: "2026-08-09T08:25:00.000Z",
    }), commandFixture());

    const pending = await service.pollPendingSignals({ now_utc: "2026-08-09T08:06:00.000Z" });

    assert.equal(pending.status, "OK");
    assert.equal(pending.count, 1);
    assert.equal(pending.items[0].signal_outbox_id, published.outbox.signal_outbox_id);
  });

  test("consumed signals disappear from the pending fallback poll", async () => {
    const service = serviceFor(new InMemoryStrategySignalBusRepository());
    const published = await service.publishSignal(signalFixture(), commandFixture());

    const consumed = await service.markConsumed({
      signal_outbox_id: published.outbox.signal_outbox_id,
      consumer_id: "portfolio-arbitration-shadow",
      now_utc: LATER,
    });
    const pending = await service.pollPendingSignals({ now_utc: LATER });

    assert.equal(consumed.status, "CONSUMED");
    assert.equal(consumed.outbox.status, "CONSUMED");
    assert.equal(consumed.outbox.consumer_id, "portfolio-arbitration-shadow");
    assert.equal(pending.count, 0);
  });

  test("expired signals are not returned by the fallback poll", async () => {
    const service = serviceFor(new InMemoryStrategySignalBusRepository());

    await service.publishSignal(signalFixture(), commandFixture());
    const pending = await service.pollPendingSignals({ now_utc: AFTER_EXPIRY });

    assert.equal(pending.status, "OK");
    assert.equal(pending.count, 0);
  });

  test("invalid signals are rejected before outbox publication", async () => {
    const repository = new InMemoryStrategySignalBusRepository();
    const service = serviceFor(repository);

    await assert.rejects(
      () => service.publishSignal(signalFixture({
        direction: "BUY",
        expires_at_utc: NOW,
      }), commandFixture()),
      (error) => error.code === "STRATEGY_SIGNAL_INVALID"
        && error.details.reasons.includes("STRATEGY_SIGNAL_ENUM_INVALID")
        && error.details.reasons.includes("STRATEGY_SIGNAL_EXPIRY_NOT_AFTER_GENERATION"),
    );
    assert.equal(repository.outbox.size, 0);
  });

  test("publishes additive proposed trade plan and economics in the signal payload", async () => {
    const repository = new InMemoryStrategySignalBusRepository();
    const service = serviceFor(repository);

    const published = await service.publishSignal(signalFixture({
      proposed_trade_plan: {
        order_type: "LIMIT",
        entry_price: 28000,
        stop_price: 27980,
        targets: [{ label: "T1", price: 28060 }],
        time_in_force: "DAY",
      },
      source_data_cutoff_utc: NOW,
    }), commandFixture());

    assert.equal(published.signal.proposed_trade_plan.instrument, "MNQ");
    assert.equal(published.signal.trade_plan_economics.risk_per_contract, 40);
    assert.equal(published.signal.proposed_trade_plan.source.source_data_cutoff_utc, NOW);
    assert.equal(published.outbox.payload.payload.proposed_trade_plan.economics.targets[0].reward_risk, 3);
  });

  test("publishes an already-normalized grain signal without losing its entry", async () => {
    const repository = new InMemoryStrategySignalBusRepository();
    const service = serviceFor(repository);
    const once = await service.publishSignal(signalFixture({
      instrument: "ZW",
      proposed_trade_plan: {
        order_type: "LIMIT",
        entry_price: 754,
        stop_price: 750.5,
        targets: [{ label: "TP1", price: 759.25 }],
      },
    }), commandFixture());
    const twice = await service.publishSignal({
      ...once.signal,
      signal_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03",
      correlation_id: "corr-20260809-0800-zw-normalized",
    }, commandFixture());

    assert.equal(twice.signal.availability, "KNOWN");
    assert.equal(twice.signal.proposed_trade_plan.entry.price, 754);
    assert.equal(twice.signal.trade_plan_economics.entry_price, 754);
    assert.equal(twice.signal.trade_plan_economics.risk_per_contract, 175);
    assert.ok(!twice.signal.reason_codes.includes("ENTRY_UNAVAILABLE"));
  });
});

function serviceFor(repository) {
  return new StrategySignalBusService({
    repository,
    clock: { now: () => ({ utc: NOW }) },
  });
}

function commandFixture(overrides = {}) {
  return {
    idempotency_key: "emit-signal-1",
    actor: "strategy-instance-scheduler",
    reason: "TD2-601 signal bus test",
    ...overrides,
  };
}

function signalFixture(overrides = {}) {
  return {
    signal_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01",
    strategy_instance_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    strategy_version_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    instrument: "MNQ",
    direction: "LONG",
    confidence: 0.68,
    execution_mode_origin: "SHADOW",
    generated_at_utc: NOW,
    expires_at_utc: "2026-08-09T08:15:00.000Z",
    correlation_id: "corr-20260809-0800-mnq",
    payload: {
      scheduler_run_key: "strategy-scheduler:bbbb:2026-08-09T08:00",
      deterministic_execution_plan_hash: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
    ...overrides,
  };
}
