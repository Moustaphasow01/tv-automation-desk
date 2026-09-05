import assert from "node:assert/strict";
import test from "node:test";
import { nextReplayAction } from "../src/desk-replay-orchestration-algorithms.js";
import { nextReplayAction as nextServiceReplayAction } from "../src/desk-replay-service.js";
import {
  REPLAY_NEXT_ACTION_BY_STATUS,
  replayNextAction,
} from "../src/desk-replay-transition-map.js";

test("shared replay transition map preserves every common state/action pair", () => {
  for (const [status, action] of Object.entries(REPLAY_NEXT_ACTION_BY_STATUS)) {
    assert.equal(replayNextAction(status), action, status);
    assert.equal(nextReplayAction(status), action, status);
    assert.equal(nextServiceReplayAction(status), action, status);
  }
});

test("replay transition map preserves unknown and orchestration-only outcomes", () => {
  assert.equal(replayNextAction("UNKNOWN_STATE"), "refresh_replay_state");
  assert.equal(replayNextAction("WORK_FAILED_REQUIRES_OPERATOR"), "refresh_replay_state");
  assert.equal(nextReplayAction("WORK_FAILED_REQUIRES_OPERATOR"), "inspect_failed_work_item_then_retry_or_cancel");
  assert.equal(nextServiceReplayAction("WORK_FAILED_REQUIRES_OPERATOR"), "refresh_replay_state");
  assert.equal(nextReplayAction("UNKNOWN_STATE"), "refresh_replay_state");
  assert.equal(nextServiceReplayAction("UNKNOWN_STATE"), "refresh_replay_state");
});
