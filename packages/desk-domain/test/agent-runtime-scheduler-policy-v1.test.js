import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateAgentRuntimeLaneGateV1,
  planAgentRuntimeScheduleV1,
} from "../index.js";

const now = "2026-08-09T12:00:00.000Z";

describe("agent runtime scheduler policy V1", () => {
  it("selects LIVE before replay even when replay has a better numeric task priority", () => {
    const plan = planAgentRuntimeScheduleV1({
      now_utc: now,
      tasks: [
        task({ task_id: "11111111-1111-4111-8111-111111111111", lane: "replay", priority: 1 }),
        task({ task_id: "22222222-2222-4222-8222-222222222222", lane: "live", priority: 100 }),
      ],
    });

    assert.equal(plan.selected_tasks[0].lane, "live");
    assert.equal(plan.deferred_tasks[0].reason, "GLOBAL_SELECTED_QUOTA_EXCEEDED");
    assert.match(plan.plan_hash, /^sha256:[a-f0-9]{64}$/);
  });

  it("blocks non-live work when its compute quota is already consumed", () => {
    const plan = planAgentRuntimeScheduleV1({
      now_utc: now,
      policy: {
        max_selected_tasks: 2,
        lane_quotas: { replay: { rank: 20, max_selected_per_window: 2, max_running: 2, max_tokens_per_window: 1000 } },
      },
      usage: { lanes: [{ lane: "replay", total_tokens: 900 }] },
      tasks: [task({ lane: "replay", compute_budget: { estimated_tokens: 200 } })],
    });

    assert.equal(plan.selected_tasks.length, 0);
    assert.equal(plan.deferred_tasks[0].reason, "LANE_TOKEN_QUOTA_EXCEEDED");
  });

  it("blocks work whose own estimate exceeds an empty lane quota", () => {
    const plan = planAgentRuntimeScheduleV1({
      now_utc: now,
      policy: {
        lane_quotas: { replay: { max_tokens_per_window: 100 } },
      },
      tasks: [task({ lane: "replay", compute_budget: { estimated_tokens: 200 } })],
    });

    assert.equal(plan.selected_tasks.length, 0);
    assert.equal(plan.deferred_tasks[0].reason, "LANE_TOKEN_QUOTA_EXCEEDED");
  });

  it("promotes stale work only when no live work is ready", () => {
    const plan = planAgentRuntimeScheduleV1({
      now_utc: now,
      tasks: [
        task({ lane: "research", priority: 5, created_at_utc: "2026-08-09T11:59:00.000Z" }),
        task({ lane: "replay", priority: 100, created_at_utc: "2026-08-09T10:00:00.000Z" }),
      ],
    });

    assert.equal(plan.selected_tasks[0].lane, "replay");
  });

  it("rejects future and active leased tasks without consuming quota", () => {
    const plan = planAgentRuntimeScheduleV1({
      now_utc: now,
      policy: { max_selected_tasks: 3 },
      tasks: [
        task({ lane: "live", status: "READY", not_before_utc: "2026-08-09T12:05:00.000Z" }),
        task({ lane: "live", status: "CLAIMED", lease_expires_at_utc: "2026-08-09T12:05:00.000Z" }),
      ],
    });

    assert.deepEqual(plan.rejected_tasks.map((item) => item.reason).sort(), [
      "TASK_ALREADY_LEASED",
      "TASK_NOT_BEFORE_IN_FUTURE",
    ]);
    assert.equal(plan.summary.selected_count, 0);
  });

  it("opens the lane gate only for the selected lane or an idle plan", () => {
    const plan = planAgentRuntimeScheduleV1({
      now_utc: now,
      tasks: [task({ lane: "live" }), task({ lane: "replay" })],
    });

    assert.equal(evaluateAgentRuntimeLaneGateV1({ lane: "live", plan }).allowed, true);
    assert.equal(evaluateAgentRuntimeLaneGateV1({ lane: "replay", plan }).allowed, false);
    assert.deepEqual(evaluateAgentRuntimeLaneGateV1({ lane: "replay", plan }).blocking_lanes, ["live"]);
  });
});

function task(overrides = {}) {
  return {
    task_id: "33333333-3333-4333-8333-333333333333",
    task_key: "task.fixture",
    task_type: "LIVE_M15_MONITOR",
    lane: "live",
    status: "READY",
    priority: 50,
    payload: {},
    metadata: {},
    created_at_utc: "2026-08-09T11:50:00.000Z",
    ...overrides,
  };
}
