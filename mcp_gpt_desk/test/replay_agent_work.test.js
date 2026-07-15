import assert from "node:assert/strict";
import test from "node:test";
import { FixedClock } from "@tv-automation/desk-time";
import {
  assertReplayWorkForSave,
  buildReplayAgentWorkItem,
  claimReplayWorkItem,
  completeReplayWorkItem,
  failReplayWorkItem,
  heartbeatReplayWorkItem,
  isClaimableWorkItem,
  replayWorkMatchesRun,
  selectClaimableReplayWork,
  selectVisibleDeskWork,
} from "../src/replay-agent-work.js";

const clock = new FixedClock(Date.parse("2026-07-13T00:07:00Z"));
const tick = clock.now();

function workFixture(type = "master") {
  const run = {
    backtest_id: "bt_agent_work",
    replay_run_id: "bt_agent_work",
    run_id: "bt_agent_work",
    strategy_id: "asia_open",
    trading_date: "2026-07-09",
    session: "asia_open",
    pack_id: "pack-logical",
    pack_build_id: "pack-build-pinned",
    automation_enabled: true,
    current_step_id: `step_${type}`,
    status: type === "master" ? "WAITING_GPT_MASTER" : "WAITING_GPT_MONITOR",
  };
  const step = {
    step_id: `step_${type}`,
    sequence: type === "master" ? 1 : 2,
    cutoff_paris: "2026-07-09T00:15:00+02:00",
    as_of_utc: "2026-07-08T22:15:00.000Z",
  };
  const bundle = {
    bundle_id: `bundle_${type}`,
    bundle_type: type,
    contract_context: {
      contract_name: type === "master" ? "DeskMasterAnalysisContract" : "DeskHourlyThesisMonitorContract",
      schema_version: type === "master" ? "4.0.0" : "1.0.0",
      contract_hash: `${type}-hash`,
    },
    save_target: {
      tool: type === "master" ? "save_replay_master_analysis" : "save_replay_monitor",
      suggested_payload: {
        backtest_id: run.backtest_id,
        step_id: step.step_id,
        expected_revision: 4,
        idempotency_key: `save-${type}-4`,
      },
    },
  };
  return { run, step, bundle, item: buildReplayAgentWorkItem({ run, step, bundle, tick }) };
}

test("replay work prompt is backend-owned and carries the exact MCP scope", () => {
  const { item } = workFixture("master");
  assert.equal(item.workflow, "REPLAY_MASTER");
  assert.equal(item.expected_revision, 4);
  assert.equal(item.bundle_args.view, "compact");
  assert.equal(item.bundle_args.include_raw_refs, false);
  assert.match(item.prompt_text, /get_active_contracts/);
  assert.match(item.prompt_text, /save_replay_master_analysis/);
  assert.match(item.prompt_text, /Aucun JSON ne doit etre rendu/);
  assert.equal(item.prompt_hash.length, 64);
});

test("one lease owns a replay work item and heartbeat extends it", () => {
  const { item } = workFixture("monitor");
  const claimed = claimReplayWorkItem(item, { worker_id: "scheduled-task-00", lease_seconds: 720 }, tick);
  assert.equal(claimed.status, "CLAIMED");
  assert.equal(claimed.attempt_count, 1);
  assert.match(claimed.execution_prompt, new RegExp(claimed.lease_token));
  assert.equal(isClaimableWorkItem(claimed, tick), false);
  assert.throws(() => claimReplayWorkItem(claimed, { worker_id: "scheduled-task-15" }, tick), /not claimable/i);

  const laterTick = new FixedClock(tick.epochMs + 60_000).now();
  const heartbeat = heartbeatReplayWorkItem(claimed, {
    worker_id: claimed.claimed_by,
    lease_token: claimed.lease_token,
    lease_seconds: 900,
  }, laterTick);
  assert.ok(Date.parse(heartbeat.lease_expires_at_utc) > Date.parse(claimed.lease_expires_at_utc));
});

test("save lease validation, retry and completion are deterministic", () => {
  const { item, run } = workFixture("master");
  const claimed = claimReplayWorkItem(item, { worker_id: "scheduled-task-30", lease_seconds: 720 }, tick);
  const saveArgs = {
    backtest_id: run.backtest_id,
    step_id: item.step_id,
    work_item_id: item.work_item_id,
    worker_id: claimed.claimed_by,
    lease_token: claimed.lease_token,
  };
  assert.equal(assertReplayWorkForSave(claimed, saveArgs, "REPLAY_MASTER", tick), true);
  assert.throws(() => assertReplayWorkForSave(claimed, { ...saveArgs, lease_token: "wrong-token" }, "REPLAY_MASTER", tick), /invalid/i);

  const failed = failReplayWorkItem(claimed, { ...saveArgs, error_code: "MCP_TIMEOUT", error_message: "timeout", retryable: true }, tick);
  assert.equal(failed.status, "READY");
  const reclaimed = claimReplayWorkItem(failed, { worker_id: "scheduled-task-45", lease_seconds: 720 }, tick);
  const completed = completeReplayWorkItem(reclaimed, {
    worker_id: reclaimed.claimed_by,
    lease_token: reclaimed.lease_token,
    output_ref: { collection: "desk_replay_master_analyses", document_id: "master-1" },
  }, tick);
  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.completed_output_ref.document_id, "master-1");
});

test("queue selection is replay-only and rejects stale replay scope", () => {
  const master = workFixture("master");
  const monitor = workFixture("monitor");
  assert.equal(replayWorkMatchesRun(master.item, master.run), true);
  assert.equal(replayWorkMatchesRun(master.item, { ...master.run, current_step_id: "other" }), false);
  const liveMaster = { ...master.item, automation_scope: "live", workflow: "LIVE_MASTER", priority: 10 };
  const liveMonitor = { ...monitor.item, automation_scope: "live", workflow: "LIVE_M15_MONITOR", priority: 20 };
  const selected = selectClaimableReplayWork([monitor.item, liveMonitor, master.item, liveMaster], {}, tick);
  assert.deepEqual(selected.map((item) => item.workflow), ["REPLAY_MASTER", "REPLAY_MONITOR"]);
  assert.equal(isClaimableWorkItem(liveMaster, tick), false);
  assert.deepEqual(selectVisibleDeskWork([liveMaster, master.item]), [master.item]);
});
