import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AGENT_EVENT_SCHEMA_VERSION_V1,
  AGENT_RUNTIME_SCHEMA_VERSION_V1,
  AGENT_TASK_SCHEMA_VERSION_V1,
  agentRuntimeHashV1,
  claimAgentTaskV1,
  completeAgentTaskV1,
  expireAgentTaskLeaseV1,
  extendAgentLeaseV1,
  failAgentTaskV1,
  validateAgentConversationV1,
  validateAgentMissionV1,
  validateAgentTaskV1,
  validateAgentV1,
} from "../index.js";

describe("agent runtime V1 durable core", () => {
  it("validates Agent Mission Conversation and Task contracts", () => {
    const agent = validateAgentV1(agentFixture());
    const mission = validateAgentMissionV1(missionFixture());
    const conversation = validateAgentConversationV1(conversationFixture());
    const task = validateAgentTaskV1(taskFixture());

    assert.equal(agent.ok, true);
    assert.equal(mission.ok, true);
    assert.equal(conversation.ok, true);
    assert.equal(task.ok, true);
    assert.equal(agent.schema_version, AGENT_RUNTIME_SCHEMA_VERSION_V1);
    assert.equal(task.normalized.schema_version, AGENT_TASK_SCHEMA_VERSION_V1);
  });

  it("claims a ready task with a durable lease and auditable event", () => {
    const result = claimAgentTaskV1(taskFixture(), claimCommand());

    assert.equal(result.ok, true);
    assert.equal(result.task.status, "CLAIMED");
    assert.equal(result.task.assigned_worker_id, "codex-live-worker-01");
    assert.equal(result.task.lease_token, "lease-token-001");
    assert.equal(result.task.attempt_count, 1);
    assert.equal(result.task.revision, 1);
    assert.equal(result.task.lease_expires_at_utc, "2026-08-09T10:15:00.000Z");
    assert.match(result.task.task_hash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(result.lease.status, "ACTIVE");
    assert.equal(result.event.schema_version, AGENT_EVENT_SCHEMA_VERSION_V1);
    assert.equal(result.event.event_type, "TASK_CLAIMED");
    assert.match(result.event.event_hash, /^sha256:[a-f0-9]{64}$/);
  });

  it("blocks a second claim while the lease is still active", () => {
    const first = claimAgentTaskV1(taskFixture(), claimCommand());
    const second = claimAgentTaskV1(first.task, {
      ...claimCommand(),
      worker_id: "codex-live-worker-02",
      lease_token: "lease-token-002",
      now_utc: "2026-08-09T10:01:00.000Z",
    });

    assert.equal(second.ok, false);
    assert.deepEqual(second.reasons, ["AGENT_TASK_ALREADY_LEASED"]);
  });

  it("allows reclaim after lease expiration without conversation being the source of truth", () => {
    const first = claimAgentTaskV1(taskFixture({ conversation_id: null }), claimCommand());
    const second = claimAgentTaskV1(first.task, {
      ...claimCommand(),
      worker_id: "codex-live-worker-02",
      lease_token: "lease-token-002",
      now_utc: "2026-08-09T10:16:00.000Z",
    });

    assert.equal(second.ok, true);
    assert.equal(second.task.conversation_id, null);
    assert.equal(second.task.assigned_worker_id, "codex-live-worker-02");
    assert.equal(second.task.lease_token, "lease-token-002");
    assert.equal(second.task.attempt_count, 2);
    assert.equal(second.event.event_type, "TASK_CLAIMED");
  });

  it("requires matching worker and lease token to complete a task", () => {
    const claimed = claimAgentTaskV1(taskFixture(), claimCommand());
    const mismatch = completeAgentTaskV1(claimed.task, {
      worker_id: "codex-live-worker-02",
      lease_token: "lease-token-001",
      output_ref: "artifact/live/master.json",
      now_utc: "2026-08-09T10:05:00.000Z",
    });
    const completed = completeAgentTaskV1(claimed.task, {
      ...claimCommand(),
      output_ref: "artifact/live/master.json",
      now_utc: "2026-08-09T10:05:00.000Z",
    });

    assert.equal(mismatch.ok, false);
    assert.deepEqual(mismatch.reasons, ["AGENT_TASK_LEASE_MISMATCH"]);
    assert.equal(completed.ok, true);
    assert.equal(completed.task.status, "DONE");
    assert.equal(completed.task.output_ref, "artifact/live/master.json");
    assert.equal(completed.task.lease_token, null);
    assert.equal(completed.lease.status, "RELEASED");
    assert.equal(completed.event.event_type, "TASK_COMPLETED");
  });

  it("requeues retryable failures until max attempts then becomes terminal", () => {
    const firstClaim = claimAgentTaskV1(taskFixture({ max_attempts: 2 }), claimCommand());
    const firstFailure = failAgentTaskV1(firstClaim.task, {
      ...claimCommand(),
      now_utc: "2026-08-09T10:05:00.000Z",
      error_code: "MODEL_TIMEOUT",
      error_message: "Codex timed out",
      retryable: true,
    });
    const secondClaim = claimAgentTaskV1(firstFailure.task, {
      ...claimCommand(),
      lease_token: "lease-token-002",
      now_utc: "2026-08-09T10:06:00.000Z",
    });
    const secondFailure = failAgentTaskV1(secondClaim.task, {
      ...claimCommand(),
      lease_token: "lease-token-002",
      now_utc: "2026-08-09T10:07:00.000Z",
      error_code: "MODEL_TIMEOUT",
      retryable: true,
    });

    assert.equal(firstFailure.ok, true);
    assert.equal(firstFailure.task.status, "READY");
    assert.equal(firstFailure.task.not_before_utc, "2026-08-09T10:06:00.000Z");
    assert.equal(secondClaim.task.attempt_count, 2);
    assert.equal(secondFailure.ok, true);
    assert.equal(secondFailure.task.status, "ERROR");
    assert.equal(secondFailure.task.last_error.error_code, "MODEL_TIMEOUT");
  });

  it("blocks retry claims before deterministic not_before_utc", () => {
    const firstClaim = claimAgentTaskV1(taskFixture({ max_attempts: 3 }), claimCommand());
    const firstFailure = failAgentTaskV1(firstClaim.task, {
      ...claimCommand(),
      now_utc: "2026-08-09T10:05:00.000Z",
      error_code: "MODEL_TIMEOUT",
      error_message: "Codex timed out",
      retryable: true,
      retry_policy: { base_delay_seconds: 120, max_delay_seconds: 900, multiplier: 2, jitter_seconds: 0 },
    });
    const tooEarly = claimAgentTaskV1(firstFailure.task, {
      ...claimCommand(),
      lease_token: "lease-token-002",
      now_utc: "2026-08-09T10:06:00.000Z",
    });
    const ready = claimAgentTaskV1(firstFailure.task, {
      ...claimCommand(),
      lease_token: "lease-token-003",
      now_utc: "2026-08-09T10:07:00.000Z",
    });

    assert.equal(firstFailure.task.not_before_utc, "2026-08-09T10:07:00.000Z");
    assert.equal(firstFailure.task.last_error.retry_after_seconds, 120);
    assert.equal(tooEarly.ok, false);
    assert.deepEqual(tooEarly.reasons, ["AGENT_TASK_NOT_READY_BEFORE"]);
    assert.equal(ready.ok, true);
    assert.equal(ready.task.not_before_utc, null);
  });

  it("expires a stale lease and makes the task claimable again when attempts remain", () => {
    const claimed = claimAgentTaskV1(taskFixture({ max_attempts: 2 }), claimCommand());
    const expired = expireAgentTaskLeaseV1(claimed.task, {
      now_utc: "2026-08-09T10:16:00.000Z",
      actor: "agent-runtime-sweeper",
    });

    assert.equal(expired.ok, true);
    assert.equal(expired.task.status, "READY");
    assert.equal(expired.task.lease_token, null);
    assert.equal(expired.lease.status, "EXPIRED");
    assert.equal(expired.event.event_type, "TASK_EXPIRED");
  });

  it("extends a lease deterministically and exposes a canonical runtime hash", () => {
    const claimed = claimAgentTaskV1(taskFixture(), claimCommand());
    const extended = extendAgentLeaseV1(claimed.task, {
      ...claimCommand(),
      now_utc: "2026-08-09T10:05:00.000Z",
      lease_seconds: 600,
    });

    assert.equal(extended.ok, true);
    assert.equal(extended.task.lease_expires_at_utc, "2026-08-09T10:15:00.000Z");
    assert.match(agentRuntimeHashV1({ task_id: extended.task.task_id }), /^sha256:[a-f0-9]{64}$/);
  });
});

function agentFixture(overrides = {}) {
  return {
    agent_id: "11111111-1111-4111-8111-111111111111",
    agent_key: "agent.live.monitor",
    agent_type: "thesis-monitor",
    status: "IDLE",
    worker_group: "live-pool",
    capabilities: ["read-market-context", "write-analysis"],
    model_policy: { model: "codex", reasoning: "high" },
    metadata: {},
    created_at_utc: "2026-08-09T09:00:00.000Z",
    ...overrides,
  };
}

function missionFixture(overrides = {}) {
  return {
    mission_id: "22222222-2222-4222-8222-222222222222",
    mission_key: "mission.live.2026-08-09.monitor",
    agent_id: "11111111-1111-4111-8111-111111111111",
    mission_type: "LIVE_CONTEXT_DECISION",
    lane: "live",
    objective: "Monitor live thesis",
    context_ref: "pack/live/2026-08-09/1015.json",
    correlation_id: "corr-live-20260809-1015",
    status: "ASSIGNED",
    priority: 10,
    model_policy: { model: "codex" },
    metadata: {},
    created_at_utc: "2026-08-09T09:00:00.000Z",
    ...overrides,
  };
}

function conversationFixture(overrides = {}) {
  return {
    conversation_id: "33333333-3333-4333-8333-333333333333",
    mission_id: "22222222-2222-4222-8222-222222222222",
    provider: "codex",
    external_conversation_ref: "codex-thread-abc",
    status: "OPEN",
    affinity_key: "live:2026-08-09",
    turn_count: 3,
    metadata: {},
    created_at_utc: "2026-08-09T09:00:00.000Z",
    ...overrides,
  };
}

function taskFixture(overrides = {}) {
  return {
    task_id: "44444444-4444-4444-8444-444444444444",
    mission_id: "22222222-2222-4222-8222-222222222222",
    conversation_id: "33333333-3333-4333-8333-333333333333",
    task_key: "task.live.2026-08-09.1015.monitor",
    task_type: "LIVE_M15_MONITOR",
    lane: "live",
    input_ref: "pack/live/2026-08-09/1015.json",
    status: "READY",
    priority: 10,
    payload: { checkpoint: "2026-08-09T10:15:00+02:00" },
    idempotency_key: "idem-live-20260809-1015",
    attempt_count: 0,
    max_attempts: 2,
    revision: 0,
    correlation_id: "corr-live-20260809-1015",
    metadata: {},
    created_at_utc: "2026-08-09T09:59:00.000Z",
    ...overrides,
  };
}

function claimCommand(overrides = {}) {
  return {
    worker_id: "codex-live-worker-01",
    lease_token: "lease-token-001",
    now_utc: "2026-08-09T10:00:00.000Z",
    lease_seconds: 900,
    ...overrides,
  };
}
