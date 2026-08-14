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
  });
});

function signalFixture(overrides = {}) {
  return {
    signal_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    strategy_instance_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    strategy_version_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    instrument: "MNQ",
    direction: "LONG",
    confidence: 0.72,
    execution_mode_origin: "PAPER",
    generated_at_utc: "2026-08-09T08:00:00.000Z",
    expires_at_utc: "2026-08-09T08:15:00.000Z",
    correlation_id: "corr-20260809-0800-mnq",
    payload: { source: "scheduler" },
    ...overrides,
  };
}
