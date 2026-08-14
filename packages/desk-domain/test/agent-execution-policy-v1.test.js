import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AGENT_ROUTING_PROFILES_V1, buildAgentExecutionPolicySnapshotV1, resolveAgentExecutionPolicyV1 } from "../index.js";

describe("agent execution policy v1", () => {
  it("resolves a pinned default policy with monitor routing", () => {
    const resolved = resolveAgentExecutionPolicyV1({
      task: taskFixture({ task_type: "LIVE_M15_MONITOR" }),
    });

    assert.equal(resolved.ok, true);
    assert.equal(resolved.policy.model, "codex");
    assert.equal(resolved.policy.reasoning_effort, "xhigh");
    assert.equal(resolved.policy.routing_profile, "ANALYSIS_MONITOR");
    assert.equal(resolved.policy.prompt_source, "UNBOUND");
    assert.match(resolved.snapshot.policy_hash, /^sha256:[a-f0-9]{64}$/);
  });

  it("lets the task payload override default agent mission and task policy layers", () => {
    const resolved = resolveAgentExecutionPolicyV1({
      defaults: { model: "codex-default", reasoning_effort: "medium", timeout_ms: 120_000 },
      agent: { model_policy: { model: "codex-agent", reasoning_effort: "high" } },
      mission: { model_policy: { model: "codex-mission", timeout_ms: 300_000 } },
      task: taskFixture({
        task_type: "RESEARCH_STRATEGY",
        model_policy: { model: "codex-task", token_budget: 1000 },
        payload: { execution_policy: { model: "codex-payload", reasoning_effort: "ultra", timeout_ms: 600_000 } },
      }),
    });

    assert.equal(resolved.ok, true);
    assert.equal(resolved.policy.model, "codex-payload");
    assert.equal(resolved.policy.reasoning_effort, "ultra");
    assert.equal(resolved.policy.timeout_ms, 600_000);
    assert.equal(resolved.policy.token_budget, 1000);
    assert.equal(resolved.policy.routing_profile, "RESEARCH");
    assert.deepEqual(resolved.policy.source_layers, ["defaults", "agent", "mission", "task", "task_payload"]);
  });

  it("binds task render snapshots before mission prompt compositions", () => {
    const resolved = resolveAgentExecutionPolicyV1({
      mission: {
        prompt_composition_id: "11111111-1111-4111-8111-111111111111",
      },
      task: taskFixture({
        prompt_render_snapshot_id: "22222222-2222-4222-8222-222222222222",
      }),
    });

    assert.equal(resolved.ok, true);
    assert.equal(resolved.policy.prompt_source, "TASK_RENDER_SNAPSHOT");
    assert.equal(resolved.policy.prompt_render_snapshot_id, "22222222-2222-4222-8222-222222222222");
    assert.equal(resolved.policy.prompt_composition_id, "11111111-1111-4111-8111-111111111111");
  });

  it("routes AI context work to CONTEXT_DECISION even when the task name also mentions monitor", () => {
    const resolved = resolveAgentExecutionPolicyV1({
      mission: {
        mission_key: "LIVE_CONTEXT_DECISION",
        model_policy: { model: "codex", reasoning_effort: "xhigh", inference_profile: "CONTEXT_DECISION" },
      },
      task: taskFixture({ task_type: "LIVE_CONTEXT_DECISION_MONITOR" }),
    });

    assert.equal(resolved.ok, true);
    assert.equal(resolved.policy.routing_profile, "CONTEXT_DECISION");
    assert.ok(AGENT_ROUTING_PROFILES_V1.includes("CONTEXT_DECISION"));
  });

  it("honors an explicit CONTEXT_DECISION routing profile from the resolved execution policy", () => {
    const resolved = resolveAgentExecutionPolicyV1({
      task: taskFixture({
        task_type: "GENERIC_AGENT_TASK",
        payload: { execution_policy: { routing_profile: "CONTEXT_DECISION" } },
      }),
    });

    assert.equal(resolved.ok, true);
    assert.equal(resolved.policy.routing_profile, "CONTEXT_DECISION");
  });

  it("rejects an unbound prompt when the policy requires one", () => {
    const resolved = resolveAgentExecutionPolicyV1({
      defaults: { prompt_required: true },
      task: taskFixture(),
    });

    assert.equal(resolved.ok, false);
    assert.deepEqual(resolved.reasons, ["AGENT_EXECUTION_PROMPT_BINDING_REQUIRED"]);
  });

  it("rejects latest model aliases unless explicitly allowed", () => {
    const rejected = resolveAgentExecutionPolicyV1({
      defaults: { model: "gpt-latest" },
      task: taskFixture(),
    });
    const accepted = resolveAgentExecutionPolicyV1({
      defaults: { model: "gpt-latest", allow_unpinned_model: true },
      task: taskFixture(),
    });

    assert.equal(rejected.ok, false);
    assert.deepEqual(rejected.reasons, ["AGENT_EXECUTION_MODEL_MUST_BE_PINNED"]);
    assert.equal(accepted.ok, true);
  });

  it("creates a stable snapshot hash for equivalent policy content", () => {
    const input = {
      policy: resolveAgentExecutionPolicyV1({
        defaults: { model: "codex", reasoning_effort: "max" },
        task: taskFixture({ task_type: "LIVE_MASTER" }),
      }).policy,
      created_at_utc: "2026-08-09T10:00:00.000Z",
    };

    const first = buildAgentExecutionPolicySnapshotV1(input);
    const second = buildAgentExecutionPolicySnapshotV1(JSON.parse(JSON.stringify(input)));

    assert.equal(first.policy_hash, second.policy_hash);
  });
});

function taskFixture(overrides = {}) {
  return {
    task_id: "44444444-4444-4444-8444-444444444444",
    mission_id: "22222222-2222-4222-8222-222222222222",
    task_type: "LIVE_MASTER",
    lane: "live",
    payload: {},
    metadata: {},
    ...overrides,
  };
}
