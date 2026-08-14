import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AI_CONTEXT_GATE_EXECUTION_SCHEMA_VERSION_V1,
  AI_CONTEXT_GATE_FALLBACK_REASONS_V1,
  AI_CONTEXT_GATE_MODES_V1,
  AI_CONTEXT_GATE_POLICY_VERSION_V1,
  evaluateAiContextGateV1,
} from "../index.js";

describe("AI Context Gate V1", () => {
  it("records a valid TAKE recommendation in SHADOW without execution side effects", () => {
    const result = evaluateAiContextGateV1({
      policy: { mode: "SHADOW", timeout_ms: 120000 },
      candidate_allocation_id: "candalloc:mnq:1",
      advisory: advisory({ recommendation: "TAKE" }),
      started_at_utc: "2026-08-10T07:00:00.000Z",
      completed_at_utc: "2026-08-10T07:00:12.000Z",
    });

    assert.equal(result.schema_version, AI_CONTEXT_GATE_EXECUTION_SCHEMA_VERSION_V1);
    assert.equal(result.policy_version, AI_CONTEXT_GATE_POLICY_VERSION_V1);
    assert.equal(result.status, "SHADOW_RECORDED");
    assert.equal(result.advisory.recommendation, "TAKE");
    assert.equal(result.decision.risk_multiplier, 1);
    assert.equal(result.recommendation_effect, "OBSERVED_ONLY");
    assert.deepEqual(result.execution_side_effects.order_intents_created, []);
    assert.deepEqual(result.execution_side_effects.human_confirmations_created, []);
    assert.deepEqual(result.execution_side_effects.provider_commands_created, []);
    assert.deepEqual(result.execution_side_effects.post_risk_mutations, []);
    assert.deepEqual(result.execution_side_effects.broker_writes, []);
    assert.ok(result.forbidden_direct_capabilities.includes("AI_TO_ORDER_INTENT"));
    assert.match(result.execution_hash, /^sha256:[a-f0-9]{64}$/);
  });

  it("falls back to WAIT when the context worker exceeds the live budget", () => {
    const result = evaluateAiContextGateV1({
      policy: { mode: "SHADOW", timeout_ms: 10_000 },
      candidate_allocation_id: "candalloc:mnq:1",
      advisory: advisory({ recommendation: "TAKE" }),
      latency_ms: 10_001,
    });

    assert.equal(result.status, "FALLBACK_WAIT");
    assert.equal(result.fallback_applied, true);
    assert.equal(result.fallback_reason, "AI_CONTEXT_TIMEOUT");
    assert.equal(result.advisory.recommendation, "WAIT");
    assert.equal(result.advisory.risk_multiplier, 0);
    assert.equal(result.retry.retry_allowed, true);
    assert.equal(result.execution_side_effects.target_positions_created.length, 0);
  });

  it("fails safe when the model or provider is unavailable and exposes bounded retry guidance", () => {
    const result = evaluateAiContextGateV1({
      policy: { mode: "SHADOW", max_retry_attempts: 2, retry_delay_ms: 30000 },
      candidate_allocation_id: "candalloc:mnq:1",
      provider_available: false,
      retry: { attempt: 1 },
      advisory: advisory({ recommendation: "TAKE" }),
    });

    assert.equal(result.status, "FALLBACK_WAIT");
    assert.equal(result.fallback_reason, "AI_CONTEXT_MODEL_UNAVAILABLE");
    assert.equal(result.advisory.recommendation, "WAIT");
    assert.equal(result.decision.risk_multiplier, 0);
    assert.equal(result.retry.retry_allowed, true);
    assert.equal(result.retry.next_retry_after_ms, 30000);
    assert.ok(AI_CONTEXT_GATE_FALLBACK_REASONS_V1.includes("AI_CONTEXT_MODEL_UNAVAILABLE"));
  });

  it("stops retrying once the controlled retry budget is exhausted", () => {
    const result = evaluateAiContextGateV1({
      policy: { mode: "SHADOW", max_retry_attempts: 2, retry_delay_ms: 30000 },
      candidate_allocation_id: "candalloc:mnq:1",
      model_status: "circuit_open",
      retry: { attempt: 2 },
      advisory: advisory({ recommendation: "TAKE" }),
    });

    assert.equal(result.status, "FALLBACK_WAIT");
    assert.equal(result.fallback_reason, "AI_CONTEXT_MODEL_UNAVAILABLE");
    assert.equal(result.retry.retry_allowed, false);
    assert.equal(result.retry.next_retry_after_ms, null);
  });

  it("rejects malformed or executable-looking advisory output and stores a safe fallback", () => {
    const result = evaluateAiContextGateV1({
      policy: { mode: "ADVISORY" },
      candidate_allocation_id: "candalloc:mnq:1",
      advisory: {
        recommendation: "BUY_NOW",
        risk_multiplier: 9,
        rationale: "submit immediately",
        model_ref: "codex/context-decision",
        order_intent_id: "forbidden",
        quantity: 1,
      },
    });

    assert.equal(result.status, "FALLBACK_WAIT");
    assert.equal(result.fallback_reason, "AI_CONTEXT_INVALID_ADVISORY");
    assert.ok(result.rejected_reasons.includes("AI_CONTEXT_ADVISORY_ENUM_INVALID"));
    assert.ok(result.rejected_reasons.includes("AI_CONTEXT_ADVISORY_RISK_MULTIPLIER_INVALID"));
    assert.ok(result.rejected_reasons.includes("NO_ORDER_OR_BROKER_FIELDS"));
    assert.equal(result.advisory.recommendation, "WAIT");
    assert.equal(result.isolation.ok, true);
  });

  it("blocks ENFORCED mode until a validated operator policy explicitly promotes it", () => {
    const result = evaluateAiContextGateV1({
      policy: { mode: "ENFORCED", enforcement_validated: false },
      candidate_allocation_id: "candalloc:mnq:1",
      advisory: advisory({ recommendation: "REJECT", risk_multiplier: 0 }),
    });

    assert.equal(result.status, "ENFORCED_BLOCKED");
    assert.equal(result.fallback_reason, "AI_CONTEXT_ENFORCEMENT_NOT_VALIDATED");
    assert.equal(result.observed_advisory.recommendation, "REJECT");
    assert.equal(result.enforcement, "NONE");
    assert.deepEqual([...AI_CONTEXT_GATE_MODES_V1], ["SHADOW", "ADVISORY", "ENFORCED"]);
  });

  it("turns a validated enforced REJECT into a portfolio-only binding constraint", () => {
    const result = evaluateAiContextGateV1({
      policy: { mode: "ENFORCED", enforcement_validated: true },
      candidate_allocation_id: "candalloc:mnq:1",
      advisory: advisory({ recommendation: "REJECT" }),
    });

    assert.equal(result.status, "ENFORCED_DECISION_READY");
    assert.equal(result.enforcement, "PORTFOLIO_POLICY_INPUT_ONLY");
    assert.equal(result.binding_decision.active, true);
    assert.equal(result.binding_decision.portfolio_action, "BLOCK_CANDIDATE");
    assert.equal(result.binding_decision.order_intent_allowed, false);
    assert.deepEqual(result.execution_side_effects.order_intents_created, []);
  });
});

function advisory(overrides = {}) {
  return {
    recommendation: "WAIT",
    confidence: 0.7,
    rationale: "Avis contexte sur allocation déjà déterministe.",
    model_ref: "codex/context-decision/xhigh",
    evidence_refs: [{ ref: "dataset:macro_digest:2026-08-10T07:00Z" }],
    issued_at_utc: "2026-08-10T07:00:12.000Z",
    ...overrides,
  };
}
