import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateExecutionProviderShadowCutoverV1,
  planNinjaTraderRetirementV1,
} from "../src/execution-provider-shadow-cutover-v1.js";

describe("execution provider shadow cutover V1", () => {
  it("keeps observing until the minimum shadow window is satisfied", () => {
    const report = evaluateExecutionProviderShadowCutoverV1({
      ...baseInput(),
      observed_minutes: 15,
    });

    assert.equal(report.status, "SHADOW_OBSERVING");
    assert.ok(report.controls.some((item) => item.code === "CONTINUE_SHADOW_OBSERVATION"));
  });

  it("allows cutover readiness only after provider parity and circuit safety", () => {
    const report = evaluateExecutionProviderShadowCutoverV1(baseInput());

    assert.equal(report.schema_version, "execution_provider_shadow_cutover_v1");
    assert.equal(report.status, "CUTOVER_READY");
    assert.equal(report.parity.mismatch_count, 0);
    assert.equal(report.circuit_breaker_route.status, "PRIMARY_READY");
    assert.match(report.cutover_hash, /^sha256:[a-f0-9]{64}$/);
  });

  it("blocks cutover when shadow provider events diverge from the primary", () => {
    const report = evaluateExecutionProviderShadowCutoverV1({
      ...baseInput(),
      shadow_events: [providerEvent({ event_type: "ORDER_REJECTED" })],
    });

    assert.equal(report.status, "CUTOVER_BLOCKED");
    assert.equal(report.parity.mismatch_count, 2);
    assert.ok(report.controls.some((item) => item.code === "INVESTIGATE_SHADOW_MISMATCH"));
  });

  it("requires rollback when a live cutover sees an unsafe circuit breaker state", () => {
    const report = evaluateExecutionProviderShadowCutoverV1({
      ...baseInput(),
      runtime_mode: "CUTOVER",
      circuit_breaker_route: { status: "BLOCKED_RECONCILIATION_REQUIRED" },
    });

    assert.equal(report.status, "ROLLBACK_REQUIRED");
    assert.ok(report.controls.some((item) => item.code === "ROLLBACK_TO_PRIMARY"));
  });

  it("does not authorize NinjaTrader retirement without certification approval and rollback proof", () => {
    const blocked = planNinjaTraderRetirementV1({
      replacement_provider_id: "pickmytrade",
      provider_certification: { status: "OBSERVING", provider_id: "pickmytrade" },
      direct_ninjatrader_reference_count: 0,
    });
    const ready = planNinjaTraderRetirementV1({
      replacement_provider_id: "pickmytrade",
      provider_certification: { status: "CERTIFIED", provider_id: "pickmytrade" },
      operator_approval: { approved: true, decision: "APPROVE_NINJATRADER_RETIREMENT" },
      direct_ninjatrader_reference_count: 0,
      rollback_plan: { proven: true },
    });

    assert.equal(blocked.status, "RETIREMENT_OBSERVING");
    assert.equal(ready.status, "RETIREMENT_READY");
    assert.equal(ready.can_remove_runtime_dependency, true);
  });

  it("keeps NinjaTrader retirement fail-closed when direct references or rollback proof remain unresolved", () => {
    const blocked = planNinjaTraderRetirementV1({
      replacement_provider_id: "tradovate",
      provider_certification: { status: "CERTIFIED", provider_id: "tradovate" },
      operator_approval: { approved: true, decision: "APPROVE_NINJATRADER_RETIREMENT" },
      direct_ninjatrader_reference_count: 2,
      rollback_plan: { proven: false },
    });

    assert.equal(blocked.status, "RETIREMENT_BLOCKED");
    assert.equal(blocked.can_remove_runtime_dependency, false);
    assert.deepEqual(
      blocked.issues.map((item) => item.code).sort(),
      ["DIRECT_NINJATRADER_REFERENCES_REMAIN", "ROLLBACK_PLAN_PROOF_REQUIRED"],
    );
  });
});

function baseInput() {
  return {
    now: "2026-08-10T08:00:00.000Z",
    order_intent: { order_intent_id: "intent-shadow-1" },
    primary_provider_id: "ninjatrader",
    shadow_provider_id: "pickmytrade",
    provider_candidates: [
      { provider_id: "ninjatrader", role: "PRIMARY", priority: 0, circuit_state: "CLOSED" },
      { provider_id: "pickmytrade", role: "FALLBACK", priority: 1, circuit_state: "CLOSED" },
    ],
    observed_order_count: 3,
    observed_minutes: 120,
    primary_events: [providerEvent()],
    shadow_events: [providerEvent()],
  };
}

function providerEvent(overrides = {}) {
  return {
    order_intent_id: "intent-shadow-1",
    event_type: "ORDER_FILLED",
    fill_quantity: 1,
    fill_price: 28000,
    position_size: 1,
    ...overrides,
  };
}
