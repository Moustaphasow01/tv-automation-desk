import assert from "node:assert/strict";
import test from "node:test";
import { FixedClock } from "@tv-automation/desk-time";
import {
  claimNextDeskWorkSchema,
  completeDeskWorkSchema,
  failDeskWorkSchema,
} from "../src/schemas.js";
import { createTestDeskStore } from "./support/test-desk-store.js";
import { callDeskTool, createDeskToolRegistry } from "../src/tools.js";

test("unified claim targets the continuous Paris LIVE day then falls back to REPLAY", async () => {
  const clock = new FixedClock(Date.parse("2026-07-14T14:00:00.000Z"));
  const store = createTestDeskStore({ clock }).store;
  const calls = [];
  store.claimNextLive = async (args) => {
    calls.push(["live", args]);
    return { ok: true, status: "NO_WORK", scope: "live", reason: "up_to_date" };
  };
  store.claimNextReplay = async (args) => {
    calls.push(["replay", args]);
    return {
      ok: true,
      status: "WORK_CLAIMED",
      scope: "replay",
      claim_handle: { work_item_id: "work-1", lease_token: "lease-token-1" },
      workflow: "REPLAY_MASTER",
      execution_prompt: "Execute replay then call complete_desk_work.",
      prompt_hash: "old-hash",
    };
  };

  const result = await store.claimNextDeskWork({ worker_id: "generic-worker" });

  assert.equal(result.status, "WORK_CLAIMED");
  assert.equal(result.scope, "replay");
  assert.equal(result.claim_handle.worker_id, "generic-worker");
  assert.equal(calls[0][0], "live");
  assert.equal(calls[0][1].session, undefined);
  assert.equal(calls[0][1].trading_date, "2026-07-14");
  assert.equal(calls[1][0], "replay");
});

test("unified LIVE claim keeps cursor freshness and rewrites lifecycle instructions", async () => {
  const clock = new FixedClock(Date.parse("2026-07-14T08:00:00.000Z"));
  const store = createTestDeskStore({ clock }).store;
  store.claimNextLive = async () => ({
    ok: true,
    status: "WORK_CLAIMED",
    scope: "live",
    claim_handle: {
      cursor_id: "2026-07-14_asia_open",
      checkpoint: "2026-07-14T10:00:00+02:00",
      workflow: "LIVE_M15_MONITOR",
      lease_token: "lease-token-live",
    },
    execution_prompt: "Use heartbeat_live, complete_live, or fail_live.",
    prompt_hash: "old-hash",
  });
  store.claimNextReplay = async () => assert.fail("REPLAY must not be claimed after LIVE work was acquired");

  const result = await store.claimNextDeskWork({ worker_id: "generic-worker" });

  assert.match(result.execution_prompt, /heartbeat_desk_work/);
  assert.match(result.execution_prompt, /complete_desk_work/);
  assert.match(result.execution_prompt, /fail_desk_work/);
  assert.doesNotMatch(result.execution_prompt, /heartbeat_live|complete_live|fail_live/);
  assert.equal(result.worker_api.claim, "claim_next_desk_work");
  assert.equal(result.claim_handle.worker_id, "generic-worker");
});

test("dedicated LIVE claim cannot inspect or consume REPLAY work", async () => {
  const clock = new FixedClock(Date.parse("2026-07-14T08:00:00.000Z"));
  const store = createTestDeskStore({ clock }).store;
  let replayCalled = false;
  store.claimNextLive = async (args) => ({
    ok: true,
    status: "WORK_CLAIMED",
    scope: "live",
    claim_handle: {
      cursor_id: `livecur__${args.trading_date}`,
      checkpoint: "2026-07-14T10:00:00+02:00",
      workflow: "LIVE_M15_MONITOR",
      worker_id: args.worker_id,
      lease_token: "lease-token-live",
    },
    execution_prompt: "Use heartbeat_live, complete_live, or fail_live.",
  });
  store.claimNextReplay = async () => {
    replayCalled = true;
    return { ok: true, status: "WORK_CLAIMED", scope: "replay" };
  };

  const result = await store.claimNextLiveWork({ worker_id: "live-worker" });

  assert.equal(result.lane, "live");
  assert.equal(result.claim_handle.cursor_id, "livecur__2026-07-14");
  assert.equal(result.worker_api.claim, "claim_next_live_work");
  assert.match(result.execution_prompt, /complete_live/);
  assert.doesNotMatch(result.execution_prompt, /complete_desk_work|complete_replay/);
  assert.equal(replayCalled, false);
});

test("dedicated LIVE claim retries transient readiness twice before claiming work", async () => {
  const clock = new FixedClock(Date.parse("2026-07-14T08:00:00.000Z"));
  const store = createTestDeskStore({ clock }).store;
  const waits = [];
  let callCount = 0;
  store.liveClaimRetryWait = async (milliseconds) => {
    waits.push(milliseconds);
  };
  store.claimNextLive = async (args) => {
    callCount += 1;
    if (callCount < 3) {
      return {
        ok: true,
        status: "DATA_NOT_READY",
        scope: "live",
        reason: "live_source_not_fresh",
        retryable: true,
      };
    }
    return {
      ok: true,
      status: "WORK_CLAIMED",
      scope: "live",
      claim_handle: {
        cursor_id: `livecur__${args.trading_date}`,
        checkpoint: "2026-07-14T10:00:00+02:00",
        workflow: "LIVE_M15_MONITOR",
        lease_token: "lease-token-after-retry",
      },
    };
  };

  const result = await store.claimNextLiveWork({
    worker_id: "live-worker-retry",
    retry_attempts: 3,
    retry_delay_seconds: 60,
  });

  assert.equal(result.status, "WORK_CLAIMED");
  assert.equal(callCount, 3);
  assert.deepEqual(waits, [60_000, 60_000]);
  assert.equal(result.claim_retry.attempts_made, 3);
  assert.equal(result.claim_retry.exhausted, false);
  assert.deepEqual(result.claim_retry.attempts.map((attempt) => attempt.status), [
    "DATA_NOT_READY",
    "DATA_NOT_READY",
    "WORK_CLAIMED",
  ]);
});

test("dedicated LIVE claim returns a genuine up-to-date NO_WORK without waiting", async () => {
  const clock = new FixedClock(Date.parse("2026-07-14T08:00:00.000Z"));
  const store = createTestDeskStore({ clock }).store;
  let waitCount = 0;
  store.liveClaimRetryWait = async () => {
    waitCount += 1;
  };
  store.claimNextLive = async () => ({
    ok: true,
    status: "NO_WORK",
    scope: "live",
    reason: "up_to_date",
  });

  const result = await store.claimNextLiveWork({ worker_id: "live-worker-idle" });

  assert.equal(result.status, "NO_WORK");
  assert.equal(result.claim_retry.attempts_made, 1);
  assert.equal(waitCount, 0);
});

test("dedicated REPLAY claim cannot inspect or consume LIVE work", async () => {
  const clock = new FixedClock(Date.parse("2026-07-14T08:00:00.000Z"));
  const store = createTestDeskStore({ clock }).store;
  let liveCalled = false;
  store.claimNextLive = async () => {
    liveCalled = true;
    return { ok: true, status: "WORK_CLAIMED", scope: "live" };
  };
  store.claimNextReplay = async (args) => ({
    ok: true,
    status: "WORK_CLAIMED",
    scope: "replay",
    workflow: "REPLAY_MASTER",
    claim_handle: {
      work_item_id: "work-replay",
      worker_id: args.worker_id,
      lease_token: "lease-token-replay",
    },
    execution_prompt: "Use heartbeat_replay, complete_replay, or fail_replay.",
  });

  const result = await store.claimNextReplayWork({ worker_id: "replay-worker" });

  assert.equal(result.lane, "replay");
  assert.equal(result.claim_handle.work_item_id, "work-replay");
  assert.equal(result.worker_api.claim, "claim_next_replay_work");
  assert.deepEqual(result.worker_api, {
    claim: "claim_next_replay_work",
    heartbeat: "heartbeat_replay",
    complete: "complete_replay",
    fail: "fail_replay",
  });
  assert.equal(liveCalled, false);
});

test("unified claim does not hide a LIVE DATA_NOT_READY status behind replay fallback", async () => {
  const clock = new FixedClock(Date.parse("2026-07-20T08:00:00.000Z"));
  const store = createTestDeskStore({ clock }).store;
  let replayCalled = false;
  store.claimNextLive = async () => ({
    ok: true,
    status: "DATA_NOT_READY",
    scope: "live",
    reason: "live_source_not_fresh",
    error: { code: "LOCAL_PACK_CORE_DATASET_STALE" },
  });
  store.claimNextReplay = async () => {
    replayCalled = true;
    return { ok: true, status: "WORK_CLAIMED", scope: "replay" };
  };

  const result = await store.claimNextDeskWork({ worker_id: "generic-worker" });

  assert.equal(result.status, "DATA_NOT_READY");
  assert.equal(result.scope, "live");
  assert.equal(result.attempts[0].status, "DATA_NOT_READY");
  assert.equal(replayCalled, false);
});

test("unified lifecycle tools dispatch from the handle shape", async () => {
  const calls = [];
  const store = new Proxy({
    async logToolCall() {},
    async heartbeatLive(args) { calls.push(["heartbeatLive", args]); return { ok: true }; },
    async completeReplay(args) { calls.push(["completeReplay", args]); return { ok: true }; },
    async failLive(args) { calls.push(["failLive", args]); return { ok: true }; },
  }, {
    get(target, property) {
      if (property in target) return target[property];
      return async () => ({ ok: true });
    },
  });
  const tools = createDeskToolRegistry(store);

  await callDeskTool(tools, "heartbeat_desk_work", {
    worker_id: "generic-worker",
    cursor_id: "cursor-live",
    checkpoint: "2026-07-14T10:00:00+02:00",
    lease_token: "lease-token-live",
  });
  await callDeskTool(tools, "complete_desk_work", {
    worker_id: "generic-worker",
    work_item_id: "work-replay",
    lease_token: "lease-token-replay",
    telemetry: {
      provider: "openai",
      model: "gpt-5",
      input_tokens: 500,
      output_tokens: 100,
      cost_usd: 0.018,
    },
  });
  await callDeskTool(tools, "fail_desk_work", {
    worker_id: "generic-worker",
    cursor_id: "cursor-live",
    checkpoint: "2026-07-14T10:00:00+02:00",
    lease_token: "lease-token-live",
    error_code: "TOOL_TIMEOUT",
    error_message: "temporary timeout",
    retryable: true,
  });

  assert.deepEqual(calls.map(([method]) => method), ["heartbeatLive", "completeReplay", "failLive"]);
  assert.equal(calls[1][1].telemetry.model, "gpt-5");
  assert.equal(calls[1][1].telemetry.cost_usd, 0.018);
  assert.equal(calls[2][1].error_class, "transient");
});

test("unified schemas keep LIVE cursor workflows paired", () => {
  assert.throws(() => claimNextDeskWorkSchema.parse({
    worker_id: "generic-worker",
    workflows: ["LIVE_MASTER"],
  }));
  assert.equal(claimNextDeskWorkSchema.parse({ worker_id: "generic-worker" }).lease_seconds, 660);
  assert.equal(failDeskWorkSchema.parse({
    worker_id: "generic-worker",
    work_item_id: "work-replay",
    lease_token: "lease-token-replay",
    error_code: "RETRYABLE_FAILURE",
    error_message: "temporary",
  }).retryable, true);
  const completion = completeDeskWorkSchema.parse({
    worker_id: "generic-worker",
    work_item_id: "work-replay",
    lease_token: "lease-token-replay",
    telemetry: {
      provider: "openai",
      model: "gpt-5",
      input_tokens: 10,
      output_tokens: 5,
    },
  });
  assert.equal(completion.telemetry.input_tokens, 10);
});
