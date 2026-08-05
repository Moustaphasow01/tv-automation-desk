import assert from "node:assert/strict";
import test from "node:test";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { FixedClock } from "@tv-automation/desk-time";
import {
  assertReplayWorkForSave,
  buildReplayAgentWorkItem,
  claimReplayWorkItem,
  completeReplayWorkItem,
  DESK_REPLAY_PROMPT_VERSION,
  failReplayWorkItem,
  heartbeatReplayWorkItem,
  isClaimableWorkItem,
  preserveExistingWorkItem,
  replayWorkMatchesRun,
  selectClaimableReplayWork,
  selectVisibleDeskWork,
} from "../src/replay-agent-work.js";
import { ACTIVE_STRATEGY_RUNTIME_VERSIONS } from "../src/strategy-runtime-versioning.js";
import { PersistentDeskStore } from "../src/store.js";
import { InMemoryDeskPersistence } from "./support/in-memory-desk-persistence.js";

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
    strategy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.strategy_version,
    autopilot_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.autopilot_version,
    replay_execution_policy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy,
    execution_plan_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan,
    monitor_command_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command,
    condition_catalog_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog,
    deterministic_compiler_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
    condition_engine_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_engine,
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
      schema_version: type === "master"
        ? ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract
        : ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract,
      contract_hash: `${type}-hash`,
      execution_policy: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy },
      execution_plan: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan },
      monitor_command: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command },
      condition_catalog: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog },
    },
    save_target: {
      tool: type === "master" ? "save_replay_master_analysis" : "save_replay_monitor",
      suggested_payload: {
        backtest_id: run.backtest_id,
        step_id: step.step_id,
        expected_revision: 4,
        idempotency_key: `save-${type}-4`,
        contract_name: type === "master"
          ? "DeskMasterAnalysisContract"
          : "DeskHourlyThesisMonitorContract",
        schema_version: type === "master"
          ? ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract
          : ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract,
        replay_execution_policy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy,
        execution_plan_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan,
        monitor_command_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command,
        condition_catalog_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog,
        deterministic_compiler_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
        condition_engine_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_engine,
      },
    },
  };
  return { run, step, bundle, item: buildReplayAgentWorkItem({ run, step, bundle, tick }) };
}

test("replay work prompt is backend-owned and carries the exact MCP scope", () => {
  const { item } = workFixture("master");
  assert.equal(item.workflow, "REPLAY_MASTER");
  assert.equal(item.prompt_version, DESK_REPLAY_PROMPT_VERSION);
  assert.equal(item.expected_revision, 4);
  assert.equal(item.bundle_args.view, "compact");
  assert.equal(item.bundle_args.include_raw_refs, false);
  assert.match(item.prompt_text, /get_active_contracts/);
  assert.match(item.prompt_text, /save_replay_master_analysis/);
  assert.match(item.prompt_text, /Aucun JSON ne doit etre rendu/);
  assert.match(item.prompt_text, /absence isolee produit DEGRADED, jamais fail/);
  assert.match(item.prompt_text, /backend decide de la severite, jamais le worker/);
  assert.equal(item.prompt_hash.length, 64);
  assert.equal(item.source_hash.length, 64);

  const monitor = workFixture("monitor").item;
  assert.match(monitor.prompt_text, /unique Command V1\.4/);
  assert.match(monitor.prompt_text, /zero a cinq candidats distincts/);
  assert.match(monitor.prompt_text, /max_rounding_excess_pct/);
  assert.match(monitor.prompt_text, /EVENT_BLACKOUT requis indeterminable reste UNKNOWN/);
  assert.match(monitor.prompt_text, /expected_revision est un compare-and-swap/);
  assert.match(monitor.prompt_text, /phrase libre n'est jamais executable/);
  assert.match(monitor.prompt_text, /REQUIRE_CONFIRMATION exige une condition Catalog V1\.2 explicite/);
  assert.match(monitor.prompt_text, /REDUCE_RISK exige un nouveau plan/);
  assert.match(monitor.prompt_text, /memory_policy=LATEST_ONLY/);
  assert.match(monitor.prompt_text, /INVALIDATE_TERMINAL/);
  assert.match(monitor.prompt_text, /LATCH_UNTIL_TRIGGER est interdit/);
  assert.equal(monitor.source_hash.length, 64);
  const legacy = { ...monitor };
  delete legacy.source_hash;
  const preserved = preserveExistingWorkItem(legacy, monitor);
  assert.equal(preserved.source_hash, monitor.source_hash);
});

test("one lease owns a replay work item and heartbeat extends it", () => {
  const { item } = workFixture("monitor");
  const claimed = claimReplayWorkItem(item, { worker_id: "scheduled-task-00", lease_seconds: 720 }, tick);
  assert.equal(claimed.status, "CLAIMED");
  assert.equal(claimed.attempt_count, 1);
  assert.match(claimed.execution_prompt, new RegExp(claimed.lease_token));
  assert.equal(claimed.prompt_version, DESK_REPLAY_PROMPT_VERSION);
  assert.match(claimed.execution_prompt, /N'utilise jamais un code STORAGE_TEMPORARILY_UNAVAILABLE/);
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
  assert.ok(Date.parse(failed.retry_after_utc) > tick.epochMs);
  assert.equal(isClaimableWorkItem(failed, tick), false);
  const retryTick = new FixedClock(Date.parse(failed.retry_after_utc) + 1).now();
  const reclaimed = claimReplayWorkItem(failed, { worker_id: "scheduled-task-45", lease_seconds: 720 }, retryTick);
  const completed = completeReplayWorkItem(reclaimed, {
    worker_id: reclaimed.claimed_by,
    lease_token: reclaimed.lease_token,
    output_ref: { collection: "desk_replay_master_analyses", document_id: "master-1" },
    telemetry: {
      provider: "openai",
      model: "gpt-5",
      request_id: "req-replay-master-1",
      input_tokens: 1200,
      output_tokens: 300,
      total_tokens: 1500,
      cost_usd: 0.0425,
      api_latency_ms: 4200,
    },
  }, retryTick);
  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.completed_output_ref.document_id, "master-1");
  assert.equal(completed.gpt_telemetry.model, "gpt-5");
  assert.equal(completed.gpt_telemetry.total_tokens, 1500);
  assert.equal(completed.gpt_telemetry.cost_usd, 0.0425);
});

test("a terminal analytical failure atomically blocks the replay run", async () => {
  const persistence = new InMemoryDeskPersistence();
  const store = new PersistentDeskStore(clock, persistence);
  const { run, item } = workFixture("monitor");
  const claimed = claimReplayWorkItem(item, {
    worker_id: "codex-replay-01",
    lease_seconds: 720,
  }, tick);
  await persistence.setDocument(DESK_COLLECTIONS.deskReplayRuns, run.backtest_id, {
    ...run,
    current_work_item_id: claimed.work_item_id,
    revision: 4,
  });
  await persistence.setDocument(DESK_COLLECTIONS.deskAgentWorkItems, claimed.work_item_id, claimed);

  const result = await store.failReplay({
    work_item_id: claimed.work_item_id,
    worker_id: claimed.claimed_by,
    lease_token: claimed.lease_token,
    error_code: "SETUP_ID_IMMUTABLE",
    error_message: "Replacement attempted to reuse a canonical setup record.",
    retryable: false,
  });

  const failedWork = await persistence.getDocument(
    DESK_COLLECTIONS.deskAgentWorkItems,
    claimed.work_item_id,
  );
  const blockedRun = await persistence.getDocument(
    DESK_COLLECTIONS.deskReplayRuns,
    run.backtest_id,
  );
  assert.equal(result.status, "FAILED");
  assert.equal(result.run_status, "WORK_FAILED_REQUIRES_OPERATOR");
  assert.equal(failedWork.status, "FAILED");
  assert.equal(failedWork.failed_at_utc, tick.utc);
  assert.equal(blockedRun.status, "WORK_FAILED_REQUIRES_OPERATOR");
  assert.equal(blockedRun.automation_status, "blocked");
  assert.equal(blockedRun.last_automation_error.code, "SETUP_ID_IMMUTABLE");
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
