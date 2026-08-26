import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeStrategySignalV1,
  strategySignalEnvelopeV1,
} from "../index.js";

describe("strategy signal bus V1", () => {
  it("normalizes a signal and produces stable outbox evidence", () => {
    const first = normalizeStrategySignalV1(signalFixture({ instrument: "mnq", direction: "long" }));
    const second = normalizeStrategySignalV1(signalFixture({ instrument: "MNQ", direction: "LONG" }));

    assert.equal(first.ok, true);
    assert.equal(first.signal.instrument, "MNQ");
    assert.equal(first.signal.direction, "LONG");
    assert.equal(first.signal.proposed_size, 3);
    assert.equal(first.outbox.dedupe_key, second.outbox.dedupe_key);
    assert.match(first.outbox.payload_hash, /^sha256:[a-f0-9]{64}$/);
  });

  it("rejects expired or incomplete signals before outbox publication", () => {
    const result = normalizeStrategySignalV1(signalFixture({
      signal_id: "",
      expires_at_utc: "2026-08-09T08:00:00.000Z",
    }));

    assert.equal(result.ok, false);
    assert.ok(result.reasons.includes("STRATEGY_SIGNAL_REQUIRED"));
    assert.ok(result.reasons.includes("STRATEGY_SIGNAL_EXPIRY_NOT_AFTER_GENERATION"));
  });

  it("wraps normalized signals into the canonical event envelope", () => {
    const normalized = normalizeStrategySignalV1(signalFixture()).signal;
    const envelope = strategySignalEnvelopeV1(normalized);

    assert.equal(envelope.type, "signal.emitted");
    assert.equal(envelope.aggregate_type, "strategy_signal");
    assert.equal(envelope.payload.strategy_instance_id, normalized.strategy_instance_id);
    assert.equal(envelope.payload.proposed_size, normalized.proposed_size);
  });

  it("reconstructs grain trade-plan economics from setup entry zone when the plan omits entry price", () => {
    const result = normalizeStrategySignalV1(signalFixture({
      instrument: "CBOT:ZC1!",
      direction: "LONG",
      proposed_trade_plan: {
        stop_price: 506.25,
        targets: [{ label: "T1", price: 510 }],
      },
      setup: {
        entry_zone: { low: 507.25, high: 507.75 },
      },
    }));

    assert.equal(result.ok, true);
    assert.equal(result.signal.instrument, "ZC");
    assert.equal(result.signal.availability, "KNOWN");
    assert.equal(result.signal.proposed_trade_plan.entry.availability, "KNOWN");
    assert.equal(result.signal.proposed_trade_plan.entry.type, "ZONE");
    assert.equal(result.signal.trade_plan_economics.entry_price, 507.5);
    assert.equal(result.signal.trade_plan_economics.tick_size, 0.25);
    assert.equal(result.signal.trade_plan_economics.tick_value, 12.5);
    assert.equal(result.signal.trade_plan_economics.risk_per_contract, 62.5);
  });
});

function signalFixture(overrides = {}) {
  return {
    signal_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    strategy_instance_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    strategy_version_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    instrument: "MNQ",
    direction: "LONG",
    proposed_size: 3,
    confidence: 0.72,
    execution_mode_origin: "PAPER",
    generated_at_utc: "2026-08-09T08:00:00.000Z",
    expires_at_utc: "2026-08-09T08:15:00.000Z",
    correlation_id: "corr-20260809-0800-mnq",
    payload: { source: "scheduler" },
    ...overrides,
  };
}
