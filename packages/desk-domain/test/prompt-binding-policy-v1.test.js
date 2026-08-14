import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PROMPT_BINDING_RESOLUTION_SCHEMA_VERSION_V1,
  buildPromptRollbackDecisionV1,
  resolveAgentPromptBindingV1,
  validateAgentPromptBindingV1,
} from "../index.js";

describe("prompt binding policy V1", () => {
  it("resolves one active published binding and pins exact hashes", () => {
    const result = resolveAgentPromptBindingV1(resolutionInput());

    assert.equal(result.ok, true);
    assert.equal(result.resolution.schema_version, PROMPT_BINDING_RESOLUTION_SCHEMA_VERSION_V1);
    assert.equal(result.resolution.prompt_composition_id, "composition-live-active-v1");
    assert.equal(result.resolution.rendered_sha256, sha("1"));
    assert.equal(result.resolution.exact_version_pinned, true);
    assert.equal(result.resolution.selection_mode, "PRIMARY");
    assert.match(result.resolution.resolution_hash, /^sha256:[a-f0-9]{64}$/);
  });

  it("fails closed when the selected composition is not published", () => {
    const result = resolveAgentPromptBindingV1(resolutionInput({
      compositions: [composition({ status: "DRAFT" })],
    }));

    assert.equal(result.ok, false);
    assert.deepEqual(result.reasons, ["PROMPT_COMPOSITION_NOT_PUBLISHED"]);
  });

  it("routes canary traffic to the candidate when the bucket is inside the weight", () => {
    const result = resolveAgentPromptBindingV1(resolutionInput({
      bindings: [binding({
        deployment_stage: "CANARY",
        prompt_composition_id: "composition-live-canary-v1",
        last_known_good_composition_id: "composition-live-active-v1",
        canary_weight_pct: 100,
      })],
      compositions: [
        composition(),
        composition({ prompt_composition_id: "composition-live-canary-v1", rendered_sha256: sha("2") }),
      ],
    }));

    assert.equal(result.ok, true);
    assert.equal(result.resolution.prompt_composition_id, "composition-live-canary-v1");
    assert.equal(result.resolution.selection_mode, "CANARY");
  });

  it("routes canary traffic to last-known-good outside the weight", () => {
    const result = resolveAgentPromptBindingV1(resolutionInput({
      bindings: [binding({
        deployment_stage: "CANARY",
        prompt_composition_id: "composition-live-canary-v1",
        last_known_good_composition_id: "composition-live-active-v1",
        canary_weight_pct: 0,
      })],
      compositions: [
        composition(),
        composition({ prompt_composition_id: "composition-live-canary-v1", rendered_sha256: sha("2") }),
      ],
    }));

    assert.equal(result.ok, true);
    assert.equal(result.resolution.prompt_composition_id, "composition-live-active-v1");
    assert.equal(result.resolution.selection_mode, "LAST_KNOWN_GOOD");
  });

  it("builds an auditable rollback to the last-known-good composition", () => {
    const result = buildPromptRollbackDecisionV1({
      binding: binding({
        deployment_stage: "CANARY",
        prompt_composition_id: "composition-live-canary-v1",
        last_known_good_composition_id: "composition-live-active-v1",
        canary_weight_pct: 25,
      }),
      actor: "operator",
      reason: "canary_regression",
      created_at_utc: "2026-08-09T11:00:00.000Z",
    });

    assert.equal(result.ok, true);
    assert.equal(result.next_binding.prompt_composition_id, "composition-live-active-v1");
    assert.equal(result.next_binding.deployment_stage, "ROLLED_BACK");
    assert.equal(result.next_binding.canary_weight_pct, 0);
    assert.equal(result.audit_event.event_type, "PROMPT_ROLLBACK");
    assert.equal(result.audit_event.actor, "operator");
    assert.match(result.audit_event.previous_hash, /^sha256:[a-f0-9]{64}$/);
    assert.match(result.audit_event.next_hash, /^sha256:[a-f0-9]{64}$/);
  });

  it("detects missing and ambiguous bindings before rendering", () => {
    const missing = resolveAgentPromptBindingV1(resolutionInput({ bindings: [] }));
    const ambiguous = resolveAgentPromptBindingV1(resolutionInput({ bindings: [binding(), binding({ agent_prompt_binding_id: "binding-2" })] }));

    assert.deepEqual(missing.reasons, ["PROMPT_BINDING_NOT_FOUND"]);
    assert.deepEqual(ambiguous.reasons, ["PROMPT_BINDING_AMBIGUOUS"]);
  });

  it("requires last-known-good for canary bindings", () => {
    const validation = validateAgentPromptBindingV1(binding({
      deployment_stage: "CANARY",
      last_known_good_composition_id: null,
    }));

    assert.equal(validation.ok, false);
    assert.ok(validation.reasons.includes("CANARY_LAST_KNOWN_GOOD_REQUIRED"));
  });
});

function resolutionInput(overrides = {}) {
  return {
    bindings: overrides.bindings || [binding()],
    compositions: overrides.compositions || [composition()],
    agent_role: "LIVE_ANALYST",
    mission_key: "LIVE_CONTEXT_DECISION",
    lane: "live",
    environment: "preprod",
    resolved_at_utc: "2026-08-09T10:00:00.000Z",
    worker_id: "gpt-live-pool-01",
    canary_seed: "worker:gpt-live-pool-01",
  };
}

function binding(overrides = {}) {
  return {
    agent_prompt_binding_id: "binding-live-default",
    binding_key: "live-default",
    agent_role: "LIVE_ANALYST",
    mission_key: "LIVE_CONTEXT_DECISION",
    lane: "live",
    environment: "preprod",
    prompt_composition_id: "composition-live-active-v1",
    last_known_good_composition_id: "composition-live-active-v1",
    deployment_stage: "ACTIVE",
    canary_weight_pct: 0,
    active: true,
    valid_from_utc: "2026-08-09T00:00:00.000Z",
    ...overrides,
  };
}

function composition(overrides = {}) {
  return {
    prompt_composition_id: "composition-live-active-v1",
    composition_key: "live-worker-2.4.0",
    prompt_version_id: "prompt-version-live-2.4.0",
    rendered_sha256: sha("1"),
    status: "PUBLISHED",
    ...overrides,
  };
}

function sha(seed) {
  return `sha256:${seed.repeat(64).slice(0, 64)}`;
}
