import assert from "node:assert/strict";
import test from "node:test";
import { FixedClock } from "@tv-automation/desk-time";
import {
  claimNextDeskWorkSchema,
  failDeskWorkSchema,
} from "../src/schemas.js";
import { createTestDeskStore } from "./support/test-desk-store.js";
import { callDeskTool, createDeskToolRegistry } from "../src/tools.js";

test("unified claim infers the Paris LIVE session then falls back to REPLAY", async () => {
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
  assert.equal(calls[0][1].session, "ny_open");
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
});
