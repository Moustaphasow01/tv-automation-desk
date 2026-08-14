import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authorizeAgentRuntimeAdminActionV1 } from "../index.js";

describe("agent runtime admin policy V1", () => {
  it("accepts safe read actions without operator mutation controls", () => {
    const result = authorizeAgentRuntimeAdminActionV1({ action: "list_tasks" });

    assert.equal(result.ok, true);
    assert.equal(result.command.action, "LIST_TASKS");
  });

  it("requires operator reason and idempotency for requeue", () => {
    const result = authorizeAgentRuntimeAdminActionV1({
      action: "REQUEUE_DEAD_LETTER",
      dead_letter_id: "66666666-6666-4666-8666-666666666666",
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.reasons, [
      "AGENT_ADMIN_OPERATOR_REQUIRED",
      "AGENT_ADMIN_REASON_REQUIRED",
      "AGENT_ADMIN_IDEMPOTENCY_KEY_REQUIRED",
    ]);
  });

  it("accepts a controlled cancel command with a valid task id", () => {
    const result = authorizeAgentRuntimeAdminActionV1({
      action: "cancel_task",
      task_id: "44444444-4444-4444-8444-444444444444",
      operator_id: "operator-01",
      reason: "operator cancels stale work item",
      idempotency_key: "cancel-44444444",
    });

    assert.equal(result.ok, true);
    assert.equal(result.command.action, "CANCEL_TASK");
  });
});
