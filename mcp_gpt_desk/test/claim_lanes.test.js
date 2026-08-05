import assert from "node:assert/strict";
import test from "node:test";
import { FixedClock } from "@tv-automation/desk-time";
import { handleFrontOperations, isFrontOperationsPath, isFrontOperationsWriteRequest } from "../src/front-operations-api.js";
import { createTestDeskStore } from "./support/test-desk-store.js";

test("LIVE and REPLAY lanes can be paused independently at the claim boundary", async () => {
  const { store } = createTestDeskStore({
    clock: new FixedClock(Date.parse("2026-07-27T08:00:00.000Z")),
  });
  let liveCalls = 0;
  let replayCalls = 0;
  store.live.claimNext = async () => {
    liveCalls += 1;
    return { ok: true, status: "NO_WORK", scope: "live" };
  };
  store.replay.claimNext = async () => {
    replayCalls += 1;
    return { ok: true, status: "NO_WORK", scope: "replay" };
  };

  const initial = await store.getClaimLanesOverview();
  assert.equal(initial.lanes.live.enabled, true);
  assert.equal(initial.lanes.replay.enabled, true);

  const paused = await store.executeClaimLaneAction({
    lane: "live",
    action: "pause",
    expected_revision: 0,
    reason: "unit test pause",
    actor: { kind: "test" },
  });
  assert.equal(paused.status, "PAUSED");

  const live = await store.claimNextLiveWork({ worker_id: "live-worker" });
  const replay = await store.claimNextReplayWork({ worker_id: "replay-worker" });
  assert.equal(live.status, "LANE_PAUSED");
  assert.equal(live.lane, "live");
  assert.equal(replay.status, "NO_WORK");
  assert.equal(liveCalls, 0);
  assert.equal(replayCalls, 1);

  const resumed = await store.executeClaimLaneAction({
    lane: "live",
    action: "resume",
    expected_revision: 1,
    reason: "unit test resume",
    actor: { kind: "test" },
  });
  assert.equal(resumed.status, "RUNNING");
  await store.claimNextLiveWork({ worker_id: "live-worker" });
  assert.equal(liveCalls, 1);
});

test("claim lane routes expose read supervision and protected actions", async () => {
  assert.equal(isFrontOperationsPath("/api/v1/claim-lanes"), true);
  assert.equal(isFrontOperationsPath("/api/v1/claim-lanes/replay/actions"), true);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/claim-lanes/replay/actions", "POST"), true);
  const calls = [];
  const store = {
    async getClaimLanesOverview() {
      calls.push(["overview"]);
      return { ok: true, lanes: {} };
    },
    async executeClaimLaneAction(args) {
      calls.push(["action", args]);
      return { ok: true, status: "PAUSED" };
    },
  };
  await handleFrontOperations(store, { pathname: "/api/v1/claim-lanes", method: "GET" });
  await handleFrontOperations(store, {
    pathname: "/api/v1/claim-lanes/replay/actions",
    method: "POST",
    body: { action: "pause", expected_revision: 0, reason: "operator pause" },
    actor: { kind: "operator" },
  });
  assert.deepEqual(calls[0], ["overview"]);
  assert.equal(calls[1][1].lane, "replay");
  assert.equal(calls[1][1].action, "pause");
});
