import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateStrategyInstanceScheduleV1,
  planStrategyInstanceSchedulerCycleV1,
} from "../index.js";

const now = "2026-08-09T08:03:00.000Z";
const liveId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const paperId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("strategy instance scheduler V1", () => {
  it("marks running instances due on their deterministic cadence", () => {
    const result = evaluateStrategyInstanceScheduleV1({
      instance: instance({ metadata: { scheduler: { cadence_seconds: 60 } } }),
      now_utc: "2026-08-09T08:01:00.000Z",
      last_scheduled_at_utc: "2026-08-09T08:00:00.000Z",
    });

    assert.equal(result.status, "DUE");
    assert.equal(result.should_schedule, true);
    assert.equal(result.scheduled_for_utc, "2026-08-09T08:01:00.000Z");
    assert.match(result.scheduler_run_key, /^strategy_scheduler:/);
  });

  it("does not duplicate a tick already scheduled before a restart", () => {
    const result = evaluateStrategyInstanceScheduleV1({
      instance: instance({ started_at: "2026-08-09T08:00:00.000Z" }),
      now_utc: "2026-08-09T08:00:30.000Z",
      last_scheduled_at_utc: "2026-08-09T08:00:00.000Z",
    });

    assert.equal(result.status, "WAITING");
    assert.equal(result.should_schedule, false);
    assert.equal(result.scheduled_for_utc, "2026-08-09T08:01:00.000Z");
  });

  it("suppresses paused and stopped instances without changing execution mode semantics", () => {
    const paused = evaluateStrategyInstanceScheduleV1({ instance: instance({ runtime_state: "PAUSED" }), now_utc: now });
    const stopped = evaluateStrategyInstanceScheduleV1({ instance: instance({ runtime_state: "STOPPED" }), now_utc: now });

    assert.equal(paused.status, "PAUSED");
    assert.equal(paused.execution_mode, "PAPER");
    assert.equal(stopped.status, "NOT_RUNNABLE");
  });

  it("flags late ticks and prioritizes LIVE before PAPER and SHADOW", () => {
    const plan = planStrategyInstanceSchedulerCycleV1({
      now_utc: "2026-08-09T08:10:00.000Z",
      instances: [
        instance({ strategy_instance_id: paperId, execution_mode: "PAPER" }),
        instance({ strategy_instance_id: liveId, execution_mode: "LIVE", account_scope: "sim101" }),
        instance({ strategy_instance_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", execution_mode: "SHADOW" }),
      ],
      last_scheduled_at_by_instance: {
        [liveId]: "2026-08-09T08:00:00.000Z",
        [paperId]: "2026-08-09T08:00:00.000Z",
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc": "2026-08-09T08:00:00.000Z",
      },
      default_max_lag_seconds: 120,
    });

    assert.equal(plan.summary.late, 3);
    assert.equal(plan.due[0].execution_mode, "LIVE");
    assert.equal(plan.due[1].execution_mode, "PAPER");
    assert.equal(plan.due[2].execution_mode, "SHADOW");
    assert.match(plan.scheduler_plan_hash, /^sha256:[a-f0-9]{64}$/);
  });
});

function instance(overrides = {}) {
  return {
    strategy_instance_id: paperId,
    strategy_version_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    runtime_state: "RUNNING",
    execution_mode: "PAPER",
    account_scope: "sim101",
    started_at: "2026-08-09T08:00:00.000Z",
    last_heartbeat_at: "2026-08-09T08:00:00.000Z",
    created_at: "2026-08-09T07:55:00.000Z",
    metadata: { scheduler: { cadence_seconds: 60 } },
    ...overrides,
  };
}
