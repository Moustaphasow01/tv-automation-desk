import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateAgentBatchJoinPolicyV1 } from "../index.js";

const now = "2026-08-09T12:00:00.000Z";

describe("agent batch join policy V1", () => {
  it("ALL waits for all tasks and fails when one task is terminal error", () => {
    const waiting = evaluateAgentBatchJoinPolicyV1({
      now_utc: now,
      policy: "ALL",
      tasks: [task("1", "DONE"), task("2", "RUNNING")],
    });
    const failed = evaluateAgentBatchJoinPolicyV1({
      now_utc: now,
      policy: "ALL",
      tasks: [task("1", "DONE"), task("2", "ERROR")],
    });

    assert.equal(waiting.status, "WAITING");
    assert.equal(failed.status, "FAILED");
    assert.deepEqual(failed.failed_task_ids, ["2"]);
  });

  it("ANY accepts the first successful result and otherwise waits", () => {
    const result = evaluateAgentBatchJoinPolicyV1({
      now_utc: now,
      policy: "ANY",
      tasks: [task("1", "RUNNING"), task("2", "DONE", { completed_at_utc: "2026-08-09T11:59:00.000Z" })],
    });

    assert.equal(result.status, "COMPLETED");
    assert.deepEqual(result.accepted_task_ids, ["2"]);
  });

  it("FIRST_SOCK accepts the earliest done task and marks open siblings superseded", () => {
    const result = evaluateAgentBatchJoinPolicyV1({
      now_utc: now,
      policy: "FIRST_SOCK",
      tasks: [
        task("1", "DONE", { completed_at_utc: "2026-08-09T11:59:30.000Z" }),
        task("2", "DONE", { completed_at_utc: "2026-08-09T11:59:10.000Z" }),
        task("3", "RUNNING"),
      ],
    });

    assert.equal(result.status, "COMPLETED");
    assert.deepEqual(result.accepted_task_ids, ["2"]);
    assert.deepEqual(result.remaining_task_actions, [
      { task_id: "3", action: "MARK_SUPERSEDED", reason: "FIRST_SOCK_ACCEPTED_ANOTHER_TASK" },
    ]);
  });

  it("QUORUM completes partially only when the threshold is reached", () => {
    const waiting = evaluateAgentBatchJoinPolicyV1({
      now_utc: now,
      policy: "QUORUM",
      quorum_size: 2,
      tasks: [task("1", "DONE"), task("2", "RUNNING"), task("3", "ERROR")],
    });
    const accepted = evaluateAgentBatchJoinPolicyV1({
      now_utc: now,
      policy: "QUORUM",
      quorum_size: 2,
      tasks: [task("1", "DONE"), task("2", "DONE"), task("3", "RUNNING")],
    });

    assert.equal(waiting.status, "WAITING");
    assert.equal(accepted.status, "COMPLETED_PARTIAL");
    assert.deepEqual(accepted.accepted_task_ids, ["1", "2"]);
  });

  it("TIMEOUT_WITH_PARTIAL_RESULTS returns available output and lists unfinished tasks", () => {
    const result = evaluateAgentBatchJoinPolicyV1({
      now_utc: now,
      policy: "TIMEOUT_WITH_PARTIAL_RESULTS",
      deadline_at_utc: "2026-08-09T11:59:00.000Z",
      tasks: [task("1", "DONE"), task("2", "RUNNING"), task("3", "READY")],
    });

    assert.equal(result.status, "COMPLETED_PARTIAL");
    assert.equal(result.timed_out, true);
    assert.deepEqual(result.open_task_ids, ["2", "3"]);
    assert.deepEqual(result.remaining_task_actions.map((item) => item.action), ["KEEP_UNFINISHED", "KEEP_UNFINISHED"]);
    assert.match(result.join_hash, /^sha256:[a-f0-9]{64}$/);
  });
});

function task(task_id, status, overrides = {}) {
  return {
    task_id,
    status,
    created_at_utc: "2026-08-09T11:50:00.000Z",
    ...overrides,
  };
}
