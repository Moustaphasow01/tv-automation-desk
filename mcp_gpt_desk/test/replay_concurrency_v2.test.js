import assert from "node:assert/strict";
import test from "node:test";
import {
  assertMonotonicReplayClock,
  assertReplayTransition,
  prepareReplayMutation,
  replayRequestHash,
  resolveIdempotentReplayResult,
} from "../src/replay-concurrency.js";

const run = {
  backtest_id: "bt__asia_open__2026-07-09__fixture",
  status: "WAITING_GPT_MASTER",
  revision: 3,
};

test("only the worker holding the expected revision may mutate a run", () => {
  const first = prepareReplayMutation(run, {
    expected_revision: 3,
    idempotency_key: "save-master-1",
    analysis_id: "analysis-1",
  }, {
    operation: "save_replay_master_analysis",
    nextStatus: "READY_FOR_NEXT_MONITOR",
    allowedStatuses: ["WAITING_GPT_MASTER"],
  });
  assert.equal(first.next_revision, 4);
  assert.throws(
    () => prepareReplayMutation({ ...run, revision: 4 }, {
      expected_revision: 3,
      idempotency_key: "save-master-2",
    }, { operation: "save_replay_master_analysis", nextStatus: "READY_FOR_NEXT_MONITOR" }),
    (error) => error.code === "REVISION_CONFLICT",
  );
});

test("same idempotency key and payload returns the existing result", () => {
  const mutation = prepareReplayMutation(run, {
    expected_revision: 3,
    idempotency_key: "save-master-1",
    analysis_id: "analysis-1",
  }, { operation: "save_replay_master_analysis", nextStatus: "READY_FOR_NEXT_MONITOR" });
  const result = { ok: true, analysis_id: "analysis-1", revision: 4 };
  assert.deepEqual(resolveIdempotentReplayResult({ request_hash: mutation.request_hash, result }, mutation), result);
});

test("same idempotency key with a different payload conflicts", () => {
  const mutation = prepareReplayMutation(run, {
    expected_revision: 3,
    idempotency_key: "save-master-1",
    analysis_id: "analysis-2",
  }, { operation: "save_replay_master_analysis", nextStatus: "READY_FOR_NEXT_MONITOR" });
  assert.throws(
    () => resolveIdempotentReplayResult({ request_hash: replayRequestHash("save_replay_master_analysis", { analysis_id: "analysis-1" }) }, mutation),
    (error) => error.code === "IDEMPOTENCY_CONFLICT",
  );
});

test("state machine and replay clock reject invalid transitions and regressions", () => {
  assert.equal(assertReplayTransition("WAITING_GPT_MONITOR", "MONITOR_SAVED"), true);
  assert.throws(() => assertReplayTransition("WAITING_GPT_MONITOR", "COMPLETED"));
  assert.equal(assertMonotonicReplayClock("2026-07-09T15:30:00+02:00", "2026-07-09T15:45:00+02:00"), true);
  assert.throws(
    () => assertMonotonicReplayClock("2026-07-09T15:45:00+02:00", "2026-07-09T15:30:00+02:00"),
    (error) => error.code === "CLOCK_REGRESSION_FORBIDDEN",
  );
});

test("force flags are forbidden in normal replay operation", () => {
  assert.throws(
    () => prepareReplayMutation(run, {
      expected_revision: 3,
      idempotency_key: "forced",
      force: true,
    }, { operation: "advance_replay_clock", nextStatus: "READY_FOR_NEXT_MONITOR" }),
    (error) => error.code === "CLOCK_REGRESSION_FORBIDDEN",
  );
});
