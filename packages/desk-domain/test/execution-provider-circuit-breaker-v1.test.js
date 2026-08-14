import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXECUTION_PROVIDER_CIRCUIT_BREAKER_SCHEMA_VERSION_V1,
  planExecutionProviderCircuitBreakerV1,
} from "../index.js";

const now = "2026-08-10T08:00:00.000Z";

describe("execution provider circuit breaker v1", () => {
  it("routes to the primary provider when its circuit is closed and no order may exist", () => {
    const route = planExecutionProviderCircuitBreakerV1(baseInput());

    assert.equal(route.schema_version, EXECUTION_PROVIDER_CIRCUIT_BREAKER_SCHEMA_VERSION_V1);
    assert.equal(route.status, "PRIMARY_READY");
    assert.equal(route.selected_provider.provider_id, "ninjatrader");
    assert.equal(route.fallback_from_provider, null);
    assert.equal(route.evidence_summary.double_send_risk_count, 0);
  });

  it("routes to fallback automatically only when the primary circuit is open and policy allows it", () => {
    const route = planExecutionProviderCircuitBreakerV1(baseInput({
      policy: { fallback_mode: "AUTOMATIC_SAFE" },
      provider_candidates: providerCandidates({ ninjaCircuit: "OPEN" }),
    }));

    assert.equal(route.status, "FALLBACK_READY");
    assert.equal(route.selected_provider.provider_id, "pickmytrade");
    assert.equal(route.fallback_from_provider.provider_id, "ninjatrader");
    assert.equal(route.fallback_reason, "PRIMARY_CIRCUIT_OPEN");
  });

  it("blocks cross-provider fallback while any command is in flight for the same intent", () => {
    const route = planExecutionProviderCircuitBreakerV1(baseInput({
      policy: { fallback_mode: "AUTOMATIC_SAFE" },
      provider_candidates: providerCandidates({ ninjaCircuit: "OPEN" }),
      active_provider_commands: [command({ status: "delivered", provider_id: "ninjatrader" })],
    }));

    assert.equal(route.status, "BLOCKED_DOUBLE_SEND_RISK");
    assert.equal(route.selected_provider, null);
    assert.equal(route.issues[0].code, "PROVIDER_COMMAND_IN_FLIGHT");
  });

  it("requires reconciliation when provider state is uncertain instead of guessing fallback safety", () => {
    const route = planExecutionProviderCircuitBreakerV1(baseInput({
      policy: { fallback_mode: "AUTOMATIC_SAFE" },
      provider_candidates: providerCandidates({ ninjaCircuit: "OPEN" }),
      broker_provider_events: [event({ event_type: "PROVIDER_ERROR", provider_id: "ninjatrader" })],
    }));

    assert.equal(route.status, "BLOCKED_RECONCILIATION_REQUIRED");
    assert.equal(route.issues[0].code, "PROVIDER_EVENT_UNCERTAIN");
  });

  it("allows terminal rejected primary fallback only after explicit operator approval in approval mode", () => {
    const blocked = planExecutionProviderCircuitBreakerV1(baseInput({
      broker_provider_events: [event({ event_type: "ORDER_REJECTED", provider_id: "ninjatrader" })],
    }));
    const approved = planExecutionProviderCircuitBreakerV1(baseInput({
      policy: { fallback_mode: "OPERATOR_APPROVAL" },
      operator_approval: { approved: true },
      broker_provider_events: [event({ event_type: "ORDER_REJECTED", provider_id: "ninjatrader" })],
    }));

    assert.equal(blocked.status, "BLOCKED_OPERATOR_APPROVAL_REQUIRED");
    assert.equal(approved.status, "FALLBACK_READY");
    assert.equal(approved.fallback_reason, "PRIMARY_TERMINAL_REJECTED");
  });

  it("recovers to primary when the primary circuit closes before any safe rejection exists", () => {
    const route = planExecutionProviderCircuitBreakerV1(baseInput({
      policy: { fallback_mode: "AUTOMATIC_SAFE" },
      provider_candidates: providerCandidates({ ninjaCircuit: "CLOSED" }),
    }));

    assert.equal(route.status, "PRIMARY_READY");
    assert.equal(route.selected_provider.provider_id, "ninjatrader");
  });
});

function baseInput(overrides = {}) {
  return {
    now,
    order_intent: orderIntent(),
    provider_candidates: providerCandidates(),
    policy: { fallback_mode: "OPERATOR_APPROVAL" },
    active_provider_commands: [],
    broker_provider_events: [],
    ...overrides,
  };
}

function orderIntent() {
  return { order_intent_id: "intent-circuit-1", idempotency_key: "intent-circuit-key-1" };
}

function providerCandidates(overrides = {}) {
  return [
    { provider_id: "ninjatrader", adapter_id: "ninjatrader-addon", role: "PRIMARY", priority: 0, circuit_state: overrides.ninjaCircuit || "CLOSED" },
    { provider_id: "pickmytrade", adapter_id: "pickmytrade-webhook", role: "FALLBACK", priority: 1, circuit_state: overrides.pickCircuit || "CLOSED", fallback_allowed: true },
  ];
}

function command(overrides = {}) {
  return {
    execution_provider_command_id: "execution_provider_command_circuit_1",
    order_intent_id: "intent-circuit-1",
    provider_id: "ninjatrader",
    status: "pending",
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    broker_provider_event_id: "broker_provider_event_circuit_1",
    order_intent_id: "intent-circuit-1",
    provider_id: "ninjatrader",
    event_type: "ORDER_REJECTED",
    ...overrides,
  };
}
