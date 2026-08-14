import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AI_CONTEXT_ADVISORY_EFFECTS_V1,
  AI_CONTEXT_ADVISORY_RECOMMENDATIONS_V1,
  AI_CONTEXT_ADVISORY_SCHEMA_VERSION_V1,
  buildAiContextAdvisoryV1,
  proveAiContextAdvisoryIsolationV1,
} from "../index.js";

describe("AI Context Advisory V1", () => {
  it("normalizes an advisory on a deterministic candidate without creating an executable object", () => {
    const result = buildAiContextAdvisoryV1(advisoryFixture({
      subject_type: "candidate_allocation",
      candidate_allocation_id: "candalloc:abc",
      recommendation: "take_reduced",
    }));

    assert.equal(result.ok, true);
    assert.equal(result.advisory.schema_version, AI_CONTEXT_ADVISORY_SCHEMA_VERSION_V1);
    assert.equal(result.advisory.subject.subject_type, "CANDIDATE_ALLOCATION");
    assert.equal(result.advisory.recommendation, "TAKE_REDUCED");
    assert.equal(result.advisory.risk_multiplier, 0.5);
    assert.deepEqual(result.advisory.effect, "READ_ONLY_ADVISORY");
    assert.match(result.advisory.advisory_hash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(result.isolation.ok, true);
  });

  it("normalizes bounded risk multiplier, reason codes, anomalies and invalidation metadata", () => {
    const result = buildAiContextAdvisoryV1(advisoryFixture({
      recommendation: "TAKE_REDUCED",
      riskMultiplier: 0.35,
      reasonCodes: ["MACRO_HEADLINE_RISK", "VOL_REGIME_HIGH"],
      anomalies: ["VIX_SPIKE"],
      invalidation: { condition: "VIX closes back below threshold", reasonCode: "REGIME_NORMALIZED" },
    }));

    assert.equal(result.ok, true);
    assert.equal(result.advisory.risk_multiplier, 0.35);
    assert.deepEqual(result.advisory.reason_codes, ["MACRO_HEADLINE_RISK", "VOL_REGIME_HIGH"]);
    assert.deepEqual(result.advisory.anomalies, ["VIX_SPIKE"]);
    assert.equal(result.advisory.invalidation.reason_code, "REGIME_NORMALIZED");
  });

  it("keeps the recommendation enum closed", () => {
    const result = buildAiContextAdvisoryV1(advisoryFixture({ recommendation: "BUY_NOW" }));

    assert.equal(result.ok, false);
    assert.ok(result.reasons.includes("AI_CONTEXT_ADVISORY_ENUM_INVALID"));
    assert.deepEqual([...AI_CONTEXT_ADVISORY_RECOMMENDATIONS_V1], ["TAKE", "TAKE_REDUCED", "WAIT", "REJECT"]);
  });

  it("rejects any raw broker, order intent or quantity field even when nested", () => {
    const result = buildAiContextAdvisoryV1(advisoryFixture({
      order_intent_id: "portfolio_order_intent_forbidden",
      broker_account_id: "SIM101",
      payload: {
        quantity: 1,
        submit_order: true,
      },
    }));

    assert.equal(result.ok, false);
    assert.ok(result.reasons.includes("NO_ORDER_OR_BROKER_FIELDS"));
    assert.equal(result.issues.filter((issue) => issue.code === "AI_CONTEXT_ADVISORY_PROHIBITED_FIELD").length, 4);
  });

  it("rejects human-confirm, provider-command and post-risk mutation attempts", () => {
    const result = buildAiContextAdvisoryV1(advisoryFixture({
      human_execution_gate_id: "gate-forbidden",
      confirm_human_execution: true,
      provider_command_id: "provider-command-forbidden",
      risk_decision_id: "risk-forbidden",
      post_risk_mutation: { approved_size: 2 },
    }));

    assert.equal(result.ok, false);
    assert.ok(result.reasons.includes("NO_ORDER_OR_BROKER_FIELDS"));
    assert.equal(
      result.issues.filter((issue) => issue.code === "AI_CONTEXT_ADVISORY_PROHIBITED_FIELD").length,
      5,
    );
  });

  it("rejects out-of-range risk multipliers instead of silently increasing risk", () => {
    const result = buildAiContextAdvisoryV1(advisoryFixture({
      recommendation: "TAKE",
      risk_multiplier: 1.25,
    }));

    assert.equal(result.ok, false);
    assert.ok(result.reasons.includes("AI_CONTEXT_ADVISORY_RISK_MULTIPLIER_INVALID"));
  });

  it("proves that all allowed recommendations remain read-only advisory effects", () => {
    const advisories = AI_CONTEXT_ADVISORY_RECOMMENDATIONS_V1.map((recommendation) => buildAiContextAdvisoryV1(advisoryFixture({ recommendation })).advisory);
    const proof = proveAiContextAdvisoryIsolationV1({ advisories });

    assert.equal(proof.ok, true);
    assert.deepEqual([...AI_CONTEXT_ADVISORY_EFFECTS_V1], ["READ_ONLY_ADVISORY"]);
    assert.equal(proof.advisory_count, 4);
    assert.match(proof.proof_hash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(proof.checks.find((item) => item.code === "NO_TARGET_ENTITY_CREATION").ok, true);
  });

  it("detects attempts to smuggle target or order creation semantics", () => {
    const proof = proveAiContextAdvisoryIsolationV1({
      raw_inputs: [
        advisoryFixture({
          recommendation: "TAKE",
          generated_order_intent: { order_intent_id: "forbidden" },
          output_candidate_allocation: { candidate_allocation_id: "new-candidate" },
        }),
      ],
    });

    assert.equal(proof.ok, false);
    assert.ok(proof.reasons.includes("NO_ORDER_OR_BROKER_FIELDS"));
    assert.ok(proof.reasons.includes("NO_TARGET_ENTITY_CREATION"));
  });
});

function advisoryFixture(overrides = {}) {
  return {
    advisory_id: "aictx_fixture_1",
    signal_id: "sig-20260809-0815-mnq",
    subject_type: "SIGNAL",
    subject_id: "sig-20260809-0815-mnq",
    recommendation: "WAIT",
    confidence: 0.64,
    rationale: "Contexte macro encore ambigu, attendre confirmation du signal déterministe.",
    model_ref: "codex/context-decision/xhigh",
    evidence_refs: [{ ref: "dataset:news_digest:2026-08-09T08:15Z" }],
    issued_at_utc: "2026-08-09T08:16:00.000Z",
    expires_at_utc: "2026-08-09T08:31:00.000Z",
    ...overrides,
  };
}
