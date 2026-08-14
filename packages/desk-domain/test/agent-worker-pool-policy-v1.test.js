import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAgentWorkerPoolPolicyV1,
  evaluateAgentWorkerPoolTaskAccessV1,
  listAgentWorkerPoolsV1,
  resolveAgentWorkerPoolV1,
  summarizeAgentWorkerPoolsV1,
  taskTypePatternsForAgentWorkerPoolV1,
} from "../index.js";

describe("agent worker pool policy V1", () => {
  it("resolves a worker pool from explicit pool id, worker prefix or lane", () => {
    const explicit = resolveAgentWorkerPoolV1({
      pool_id: "live",
      worker_id: "agent-runtime-live-01",
      lane: "live",
    });
    const inferredByWorker = resolveAgentWorkerPoolV1({
      worker_id: "gpt-replay-pool-02",
      lane: "replay",
    });
    const inferredByLane = resolveAgentWorkerPoolV1({ lane: "safety" });

    assert.equal(explicit.ok, true);
    assert.equal(explicit.pool_id, "live");
    assert.equal(inferredByWorker.pool_id, "replay");
    assert.equal(inferredByWorker.inferred_from, "worker_id");
    assert.equal(inferredByLane.pool_id, "safety");
    assert.match(explicit.policy_hash, /^sha256:[a-f0-9]{64}$/);
  });

  it("rejects a worker configured on the wrong lane", () => {
    const resolution = resolveAgentWorkerPoolV1({
      pool_id: "live",
      worker_id: "agent-runtime-live-01",
      lane: "replay",
    });

    assert.equal(resolution.ok, false);
    assert.equal(resolution.reason, "POOL_LANE_MISMATCH");
    assert.equal(resolution.expected_lane, "live");
    assert.equal(resolution.actual_lane, "replay");
  });

  it("allows only task types that belong to the worker pool responsibility", () => {
    const liveAccess = evaluateAgentWorkerPoolTaskAccessV1({
      pool_id: "live",
      worker_id: "agent-runtime-live-01",
      task: task({ lane: "live", task_type: "LIVE_M15_MONITOR" }),
    });
    const replayBlocked = evaluateAgentWorkerPoolTaskAccessV1({
      pool_id: "live",
      worker_id: "agent-runtime-live-01",
      task: task({ lane: "live", task_type: "REPLAY_MONITOR" }),
    });

    assert.equal(liveAccess.allowed, true);
    assert.equal(replayBlocked.allowed, false);
    assert.equal(replayBlocked.reason, "TASK_TYPE_NOT_ALLOWED");
    assert.deepEqual(taskTypePatternsForAgentWorkerPoolV1({ pool_id: "replay" }), ["REPLAY_*", "BACKTEST_*"]);
  });

  it("keeps bound tasks inside their declared pool", () => {
    const access = evaluateAgentWorkerPoolTaskAccessV1({
      pool_id: "replay",
      worker_id: "agent-runtime-replay-01",
      task: task({
        lane: "replay",
        task_type: "REPLAY_MONITOR",
        metadata: { pool_id: "validation" },
      }),
    });

    assert.equal(access.allowed, false);
    assert.equal(access.reason, "TASK_BOUND_TO_OTHER_POOL");
  });

  it("summarizes task and metric health by pool without needing SQL state", () => {
    const overview = summarizeAgentWorkerPoolsV1({
      tasks: [
        { lane: "live", task_type: "LIVE_M15_MONITOR", status: "READY", count: 2 },
        { lane: "replay", task_type: "REPLAY_MONITOR", status: "RUNNING", count: 1 },
        { lane: "research", task_type: "EXPERIMENT_HYPOTHESIS", status: "ERROR", count: 1 },
      ],
      metrics: [
        { lane: "live", task_type: "LIVE_M15_MONITOR", outcome: "COMPLETED", total_tokens: 1000, count: 2 },
        { lane: "research", task_type: "EXPERIMENT_HYPOTHESIS", outcome: "FAILED_TERMINAL", total_tokens: 2000, count: 1 },
      ],
    });

    const live = overview.pools.find((pool) => pool.pool_id === "live");
    const replay = overview.pools.find((pool) => pool.pool_id === "replay");
    const research = overview.pools.find((pool) => pool.pool_id === "research");

    assert.equal(live.task_status.READY, 2);
    assert.equal(live.metrics.completed_count, 2);
    assert.equal(replay.active_count, 1);
    assert.equal(research.failed_count, 1);
    assert.equal(research.metrics.failed_count, 1);
    assert.match(overview.overview_hash, /^sha256:[a-f0-9]{64}$/);
  });

  it("lists deterministic default pools in priority order", () => {
    const policy = buildAgentWorkerPoolPolicyV1();
    const overview = listAgentWorkerPoolsV1({ policy });

    assert.deepEqual(overview.pools.slice(0, 3).map((pool) => pool.pool_id), ["live", "safety", "operations"]);
    assert.equal(overview.pools.some((pool) => pool.pool_id === "validation"), true);
  });
});

function task(overrides = {}) {
  return {
    lane: "live",
    task_type: "LIVE_M15_MONITOR",
    status: "READY",
    payload: {},
    metadata: {},
    ...overrides,
  };
}
