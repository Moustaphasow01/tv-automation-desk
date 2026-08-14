import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FixedClock } from "@tv-automation/desk-time";
import { AgentRuntimeAdminService } from "../src/agent-runtime-admin-service.js";

const clock = new FixedClock(Date.parse("2026-08-09T12:00:00.000Z"));

describe("AgentRuntimeAdminService", () => {
  it("lists tasks without leaking lease tokens and keeps payload opt-in", async () => {
    const service = new AgentRuntimeAdminService({
      pool: new FakePool(),
      repository: new FakeRuntimeRepository(),
      clock,
    });

    const result = await service.listTasks({ lane: "live" });

    assert.equal(result.count, 1);
    assert.equal(result.items[0].lease_active, true);
    assert.equal("lease_token" in result.items[0], false);
    assert.equal("payload" in result.items[0], false);
    assert.deepEqual(result.items[0].payload_keys, ["execution_policy", "scope_key"]);
  });

  it("can read a single task payload only when explicitly requested", async () => {
    const service = new AgentRuntimeAdminService({
      pool: new FakePool(),
      repository: new FakeRuntimeRepository(),
      clock,
    });

    const result = await service.getTask({
      task_id: "44444444-4444-4444-8444-444444444444",
      include_payload: true,
    });

    assert.equal(result.task.task_id, "44444444-4444-4444-8444-444444444444");
    assert.deepEqual(result.task.payload.execution_policy, { model: "codex" });
  });

  it("rejects mutating actions without operator controls", async () => {
    const service = new AgentRuntimeAdminService({
      pool: new FakePool(),
      repository: new FakeRuntimeRepository(),
      clock,
    });

    await assert.rejects(
      () => service.requeueDeadLetter({ dead_letter_id: "66666666-6666-4666-8666-666666666666" }),
      /AGENT_ADMIN_OPERATOR_REQUIRED/,
    );
  });

  it("passes controlled requeue and cancel through the durable repository", async () => {
    const repository = new FakeRuntimeRepository();
    const service = new AgentRuntimeAdminService({ pool: new FakePool(), repository, clock });

    await service.requeueDeadLetter({
      dead_letter_id: "66666666-6666-4666-8666-666666666666",
      operator_id: "operator-01",
      reason: "operator requeues verified DLQ",
      idempotency_key: "requeue-66666666",
    });
    await service.cancelTask({
      task_id: "44444444-4444-4444-8444-444444444444",
      operator_id: "operator-01",
      reason: "operator cancels stale task",
      idempotency_key: "cancel-44444444",
    });

    assert.equal(repository.requeues[0].idempotencyKey, "requeue-66666666");
    assert.equal(repository.cancels[0].idempotencyKey, "cancel-44444444");
  });

  it("summarizes isolated worker pools from task and metric aggregates", async () => {
    const service = new AgentRuntimeAdminService({
      pool: new FakePool(),
      repository: new FakeRuntimeRepository(),
      clock,
    });

    const result = await service.getPoolOverview({ metrics_window_minutes: 60 });
    const live = result.pools.find((pool) => pool.pool_id === "live");
    const replay = result.pools.find((pool) => pool.pool_id === "replay");

    assert.equal(result.ok, true);
    assert.equal(live.task_status.READY, 2);
    assert.equal(live.metrics.completed_count, 1);
    assert.equal(replay.active_count, 1);
    assert.match(result.overview_hash, /^sha256:[a-f0-9]{64}$/);
  });
});

class FakePool {
  async query(sql) {
    if (sql.includes("GROUP BY lane, task_type, status")) {
      return {
        rows: [
          { lane: "live", task_type: "LIVE_M15_MONITOR", status: "READY", count: 2 },
          { lane: "replay", task_type: "REPLAY_MONITOR", status: "RUNNING", count: 1 },
        ],
      };
    }
    if (sql.includes("GROUP BY lane, task_type, outcome")) {
      return {
        rows: [
          { lane: "live", task_type: "LIVE_M15_MONITOR", outcome: "COMPLETED", count: 1, total_tokens: 1500, cost_micros_usd: 4200 },
        ],
      };
    }
    if (sql.includes("agent_task_dead_letters")) return { rows: [deadLetterRow()] };
    if (sql.includes("FROM agent_task_run_metrics")) return { rows: [metricRow()] };
    if (sql.includes("count(*)")) return { rows: [{ lane: "live", status: "READY", count: 1 }] };
    return { rows: [taskRow()] };
  }
}

class FakeRuntimeRepository {
  constructor() {
    this.requeues = [];
    this.cancels = [];
  }
  async requeueDeadLetter(input) {
    this.requeues.push(input);
    return { ok: true, status: "REQUEUED", task: { task_id: "77777777-7777-4777-8777-777777777777" } };
  }
  async cancelTask(input) {
    this.cancels.push(input);
    return { ok: true, status: "CANCELLED", task: { task_id: input.taskId } };
  }
}

function taskRow() {
  return {
    agent_task_id: "44444444-4444-4444-8444-444444444444",
    agent_mission_id: "22222222-2222-4222-8222-222222222222",
    mission_key: "mission.live",
    mission_type: "live_monitor",
    task_key: "task.live.001",
    task_type: "LIVE_M15_MONITOR",
    lane: "live",
    status: "READY",
    priority: 10,
    assigned_worker_id: "worker-01",
    lease_token: "secret-lease-token",
    lease_expires_at_utc: "2026-08-09T12:15:00.000Z",
    attempt_count: 1,
    max_attempts: 3,
    payload: { scope_key: "live:today", execution_policy: { model: "codex" } },
    created_at_utc: "2026-08-09T11:00:00.000Z",
    updated_at_utc: "2026-08-09T11:01:00.000Z",
  };
}

function deadLetterRow() {
  return {
    agent_task_dead_letter_id: "66666666-6666-4666-8666-666666666666",
    agent_task_id: "44444444-4444-4444-8444-444444444444",
    agent_mission_id: "22222222-2222-4222-8222-222222222222",
    task_key: "task.live.001",
    task_type: "LIVE_M15_MONITOR",
    lane: "live",
    task_status: "ERROR",
    status: "OPEN",
    error_code: "MODEL_TIMEOUT",
    error_message: "timeout",
    retryable: true,
    attempt_count: 3,
    metadata: {},
    created_at_utc: "2026-08-09T11:10:00.000Z",
  };
}

function metricRow() {
  return {
    agent_task_run_metric_id: "88888888-8888-4888-8888-888888888888",
    agent_task_id: "44444444-4444-4444-8444-444444444444",
    agent_mission_id: "22222222-2222-4222-8222-222222222222",
    worker_id: "worker-01",
    lane: "live",
    task_type: "LIVE_M15_MONITOR",
    model: "codex",
    reasoning_effort: "ultra",
    outcome: "COMPLETED",
    queue_latency_ms: 1000,
    run_duration_ms: 2000,
    total_latency_ms: 3000,
    total_tokens: 1500,
    cost_micros_usd: 4200,
    metric_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    finished_at_utc: "2026-08-09T11:05:00.000Z",
  };
}
