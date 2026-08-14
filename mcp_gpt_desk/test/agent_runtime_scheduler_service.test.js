import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FixedClock } from "@tv-automation/desk-time";
import {
  AgentRuntimeSchedulerService,
  DisabledAgentRuntimeSchedulerService,
} from "../src/agent-runtime-scheduler-service.js";

const clock = new FixedClock(Date.parse("2026-08-09T12:00:00.000Z"));

describe("AgentRuntimeSchedulerService", () => {
  it("builds a deterministic cross-lane plan from PostgreSQL task and metric rows", async () => {
    const service = new AgentRuntimeSchedulerService({ pool: new FakePool(), clock });

    const result = await service.previewSchedule({ limit: 50 });

    assert.equal(result.status, "PLANNED");
    assert.equal(result.plan.selected_tasks[0].lane, "live");
    assert.equal(result.plan.deferred_tasks[0].lane, "replay");
    assert.equal(result.plan.quota_state.replay.total_tokens, 900);
    assert.equal("lease_token" in result.plan.selected_tasks[0], false);
  });

  it("defers a replay supervisor when a live task is selected", async () => {
    const service = new AgentRuntimeSchedulerService({ pool: new FakePool(), clock });

    const gate = await service.evaluateLaneClaimGate({ lane: "replay" });

    assert.equal(gate.status, "DEFERRED");
    assert.equal(gate.allowed, false);
    assert.deepEqual(gate.blocking_lanes, ["live"]);
  });

  it("fails closed when PostgreSQL is unavailable", async () => {
    const service = new DisabledAgentRuntimeSchedulerService();

    await assert.rejects(
      () => service.previewSchedule(),
      /Agent runtime scheduler is unavailable without PostgreSQL/,
    );
  });
});

class FakePool {
  async query(sql) {
    if (sql.includes("agent_task_run_metrics")) {
      return { rows: [{ lane: "replay", total_tokens: 900, cost_micros_usd: 0 }] };
    }
    return { rows: [liveTaskRow(), replayTaskRow()] };
  }
}

function liveTaskRow() {
  return {
    agent_task_id: "11111111-1111-4111-8111-111111111111",
    task_key: "task.live.001",
    task_type: "LIVE_M15_MONITOR",
    lane: "live",
    status: "READY",
    priority: 100,
    payload: {},
    metadata: {},
    created_at_utc: "2026-08-09T11:50:00.000Z",
  };
}

function replayTaskRow() {
  return {
    agent_task_id: "22222222-2222-4222-8222-222222222222",
    task_key: "task.replay.001",
    task_type: "REPLAY_MONITOR",
    lane: "replay",
    status: "READY",
    priority: 1,
    payload: {},
    metadata: {},
    created_at_utc: "2026-08-09T11:45:00.000Z",
  };
}
