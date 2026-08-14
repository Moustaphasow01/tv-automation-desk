import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AGENT_CONVERSATION_ASSIGNMENT_SCHEMA_VERSION_V1,
  applyAgentConversationUseV1,
  buildAgentConversationAffinityKeyV1,
  planAgentConversationAssignmentV1,
} from "../index.js";

describe("agent conversation affinity V1", () => {
  it("builds a stable mission scoped affinity key", () => {
    const key = buildAgentConversationAffinityKeyV1({
      provider: "Codex",
      lane: "Live",
      mission_id: "22222222-2222-4222-8222-222222222222",
      task_type: "LIVE_M15_MONITOR",
    });

    assert.equal(key, "codex:live:22222222-2222-4222-8222-222222222222:live_m15_monitor");
  });

  it("resumes the preferred open conversation while below the turn limit", () => {
    const plan = planAgentConversationAssignmentV1({
      task: taskFixture(),
      mission: missionFixture(),
      conversations: [conversationFixture({ turn_count: 4 })],
      policy: { provider: "codex", affinity_key: "live:2026-08-09", max_turns: 12 },
      now_utc: "2026-08-09T10:15:00.000Z",
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.schema_version, AGENT_CONVERSATION_ASSIGNMENT_SCHEMA_VERSION_V1);
    assert.equal(plan.mode, "RESUMED");
    assert.equal(plan.conversation_id, "33333333-3333-4333-8333-333333333333");
    assert.equal(plan.next_turn_count, 5);
    assert.deepEqual(plan.reasons, ["AFFINITY_MATCH"]);
  });

  it("rotates an open conversation when the bounded turn limit is reached", () => {
    const plan = planAgentConversationAssignmentV1({
      task: taskFixture(),
      mission: missionFixture(),
      conversations: [conversationFixture({ turn_count: 12 })],
      policy: { provider: "codex", affinity_key: "live:2026-08-09", max_turns: 12 },
      now_utc: "2026-08-09T10:15:00.000Z",
    });

    assert.equal(plan.mode, "ROTATED");
    assert.equal(plan.previous_conversation_id, "33333333-3333-4333-8333-333333333333");
    assert.equal(plan.should_create_conversation, true);
    assert.equal(plan.conversation_seed.turn_count, 1);
    assert.equal(plan.conversation_seed.metadata.rotation_reason, "TURN_LIMIT_REACHED");
  });

  it("rotates when immutable runtime metadata no longer matches the policy", () => {
    const plan = planAgentConversationAssignmentV1({
      task: taskFixture(),
      mission: missionFixture(),
      conversations: [conversationFixture({ metadata: { runtime_hash: "sha256:old" } })],
      policy: { provider: "codex", affinity_key: "live:2026-08-09", runtime_hash: "sha256:new" },
      now_utc: "2026-08-09T10:15:00.000Z",
    });

    assert.equal(plan.mode, "ROTATED");
    assert.deepEqual(plan.reasons, ["RUNTIME_HASH_CHANGED"]);
  });

  it("records external conversation refs without making them authoritative", () => {
    const used = applyAgentConversationUseV1(conversationFixture({ turn_count: 1 }), {
      turn_count: 2,
      thread_id: "codex-thread-live-2",
      now_utc: "2026-08-09T10:20:00.000Z",
      metadata: { last_task_id: "44444444-4444-4444-8444-444444444444" },
    });

    assert.equal(used.external_conversation_ref, "codex-thread-live-2");
    assert.equal(used.turn_count, 2);
    assert.equal(used.metadata.last_task_id, "44444444-4444-4444-8444-444444444444");
  });
});

function missionFixture(overrides = {}) {
  return {
    mission_id: "22222222-2222-4222-8222-222222222222",
    lane: "live",
    ...overrides,
  };
}

function taskFixture(overrides = {}) {
  return {
    task_id: "44444444-4444-4444-8444-444444444444",
    mission_id: "22222222-2222-4222-8222-222222222222",
    conversation_id: "33333333-3333-4333-8333-333333333333",
    task_type: "LIVE_M15_MONITOR",
    lane: "live",
    payload: { scope_key: "live:2026-08-09" },
    ...overrides,
  };
}

function conversationFixture(overrides = {}) {
  return {
    conversation_id: "33333333-3333-4333-8333-333333333333",
    mission_id: "22222222-2222-4222-8222-222222222222",
    provider: "codex",
    external_conversation_ref: "codex-thread-live-1",
    status: "OPEN",
    affinity_key: "live:2026-08-09",
    turn_count: 3,
    last_used_at_utc: "2026-08-09T10:00:00.000Z",
    metadata: {},
    created_at_utc: "2026-08-09T09:00:00.000Z",
    ...overrides,
  };
}
