import assert from "node:assert/strict";
import test from "node:test";
import { AiContextGateService } from "../src/ai-context-gate-service.js";
import { InMemoryAiContextGateRepository } from "../src/ai-context-gate-repository.js";

test("LOT-006 AI Context Gate service evaluates and persists SHADOW decisions without execution side effects", async () => {
  const repository = new InMemoryAiContextGateRepository();
  const service = new AiContextGateService({ repository });

  const first = await service.evaluateAndPersist({
    idempotency_key: "lot-006:shadow:1",
    policy: { mode: "SHADOW", policy_version: "test-policy-v1", model_policy_version: "agent-policy-v1" },
    signal_id: "signal-ai-context-1",
    advisory: advisory({ recommendation: "TAKE_REDUCED", risk_multiplier: 0.25 }),
    as_of_utc: "2026-08-14T08:00:00.000Z",
  });
  const second = await service.evaluateAndPersist({
    idempotency_key: "lot-006:shadow:1",
    policy: { mode: "SHADOW", policy_version: "test-policy-v1", model_policy_version: "agent-policy-v1" },
    signal_id: "signal-ai-context-1",
    advisory: advisory({ recommendation: "TAKE_REDUCED", risk_multiplier: 0.25 }),
    as_of_utc: "2026-08-14T08:00:00.000Z",
  });

  assert.equal(first.status, "SHADOW_RECORDED");
  assert.equal(first.persistence.status, "RECORDED");
  assert.equal(second.persistence.status, "IDEMPOTENT");
  assert.equal(repository.decisions.size, 1);
  assert.equal(repository.events.length, 1);
  assert.equal(first.persistence.decision.recommendation, "TAKE_REDUCED");
  assert.equal(first.persistence.decision.risk_multiplier, 0.25);
  assert.deepEqual(first.result.execution_side_effects.provider_commands_created, []);
});

test("LOT-006 AI Context Gate service persists fail-safe fallback and retry audit", async () => {
  const repository = new InMemoryAiContextGateRepository();
  const service = new AiContextGateService({ repository });

  const result = await service.evaluateAndPersist({
    idempotency_key: "lot-006:model-down:1",
    policy: { mode: "ADVISORY", max_retry_attempts: 2, retry_delay_ms: 45000 },
    signal_id: "signal-ai-context-2",
    provider_status: "CIRCUIT_OPEN",
    retry: { attempt: 1 },
    advisory: advisory({ recommendation: "TAKE" }),
    as_of_utc: "2026-08-14T08:05:00.000Z",
  });

  assert.equal(result.status, "FALLBACK_WAIT");
  assert.equal(result.persistence.status, "RECORDED");
  assert.equal(result.persistence.decision.fallback_reason, "AI_CONTEXT_MODEL_UNAVAILABLE");
  assert.equal(result.persistence.decision.retry_allowed, true);
  assert.equal(result.persistence.decision.risk_multiplier, 0);
  assert.deepEqual(repository.events.map((item) => item.event_type), [
    "DECISION_RECORDED",
    "FALLBACK_APPLIED",
    "RETRY_PLANNED",
  ]);
});

function advisory(overrides = {}) {
  return {
    recommendation: "WAIT",
    confidence: 0.72,
    risk_multiplier: 0,
    reason_codes: ["CONTEXT_TEST"],
    anomalies: [],
    rationale: "Avis contextuel consultatif sur un signal déjà déterministe.",
    model_ref: "codex/context-decision/xhigh",
    evidence_refs: [{ ref: "dataset:context:2026-08-14T08:00Z" }],
    issued_at_utc: "2026-08-14T08:00:10.000Z",
    ...overrides,
  };
}
