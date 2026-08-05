import assert from "node:assert/strict";
import test from "node:test";
import { FixedClock } from "@tv-automation/desk-time";
import { buildLiveCursorWork, DESK_LIVE_PROMPT_VERSION } from "../src/live-cursor-work.js";
import { DeskLiveService } from "../src/desk-live-service.js";
import {
  claimLiveCursor,
  completeLiveCursor,
  initLiveRunCursor,
} from "../src/live-cursor.js";
import { callDeskTool, createDeskToolRegistry, listDeskTools } from "../src/tools.js";
import { ACTIVE_STRATEGY_RUNTIME_VERSIONS } from "../src/strategy-runtime-versioning.js";

const LIVE_SCOPE = {
  worker_id: "scheduled-live-worker",
  session: "ny_open",
  trading_date: "2026-07-14",
};

test("phase 3 LIVE worker claims the cursor directly", async () => {
  const calls = [];
  const tools = createDeskToolRegistry(spyStore(calls));
  const result = await callDeskTool(tools, "claim_next_live", LIVE_SCOPE);

  assert.equal(result.isError, false, result.structuredContent.error);
  assert.equal(result.structuredContent.scope, "live");
  assert.deepEqual(calls, [{ method: "claimNextLive", args: { ...LIVE_SCOPE, lease_seconds: 660 } }]);
});

test("the unified worker façade is exposed alongside the specialized tools", () => {
  const calls = [];
  const tools = createDeskToolRegistry(spyStore(calls));
  const names = listDeskTools(tools).map(({ name }) => name);
  assert.equal(names.includes("claim_next_desk_work"), true);
  assert.equal(names.includes("claim_next_live"), true);
  assert.equal(names.includes("claim_next_replay"), true);
});

test("phase 4 REPLAY callers use the dedicated replay claim", async () => {
  const calls = [];
  const tools = createDeskToolRegistry(spyStore(calls));
  await callDeskTool(tools, "claim_next_replay", {
    worker_id: "replay-worker",
    workflows: ["REPLAY_MASTER", "REPLAY_MONITOR"],
    backtest_id: "replay-run-1",
    lease_seconds: 720,
  });

  assert.deepEqual(calls.map(({ method }) => method), ["claimNextReplay"]);
});

test("LIVE cursor prompt reuses the contract pinned by claim preparation", () => {
  const work = buildLiveCursorWork({
    plan: { workflow: "LIVE_M15_MONITOR", checkpoint: "2026-07-14T17:30:00+02:00" },
    bundle: {
      bundle_id: "monitor-bundle-1730",
      strategy_id: "ny_open_1530",
      session: "ny_open",
      mode: "live",
      trading_date: "2026-07-14",
      run_id: "front_live_2026-07-14_ny_open",
      as_of_utc: "2026-07-14T15:30:00.000Z",
      timestamp_paris: "2026-07-14T17:30:00+02:00",
      contract_context: activeContractContext("LIVE_M15_MONITOR"),
      save_target: {
        tool: "save_manual_monitor",
        suggested_payload: {
          ...activeSaveTarget("LIVE_M15_MONITOR"),
          pack_build_id: "packbuild-1730",
          pack_id: "2026-07-14_ny_open",
          linked_master_analysis_id: "master-1",
          linked_active_thesis_id: "thesis-1",
        },
      },
    },
  });

  assert.equal(DESK_LIVE_PROMPT_VERSION, "2.4.0");
  assert.equal(work.prompt_version, "2.4.0");
  assert.equal(work.bundle_args.include_raw_refs, false);
  assert.equal(work.bundle_args.view, undefined);
  assert.equal(work.bundle_args.max_response_bytes, undefined);
  assert.match(work.execution_prompt, /Ne rappelle pas get_active_contracts ni get_contract/);
  assert.match(work.execution_prompt, /1\. Appelle get_manual_monitor_bundle/);
  assert.match(work.execution_prompt, /contract-hash-LIVE_M15_MONITOR/);
  assert.match(work.execution_prompt, /suggested_payload sans retirer de champ/);
  assert.match(work.execution_prompt, /timezone/);
  assert.match(work.execution_prompt, /cadence analytique GPT planifiee est M15/);
  assert.match(work.execution_prompt, /structure H4\/H1 porte le biais/);
  assert.match(work.execution_prompt, /plusieurs bougies M15/);
  assert.match(work.execution_prompt, /micro-mouvement de scalp/);
  assert.match(work.execution_prompt, /Monitor V2\.4 planifie en GPT M15/);
  assert.match(work.execution_prompt, /zero a cinq candidats distincts/);
  assert.match(work.execution_prompt, /max_rounding_excess_pct/);
  assert.match(work.execution_prompt, /EVENT_BLACKOUT requis sans donnee decidable reste UNKNOWN/);
  assert.match(work.execution_prompt, /expected_revision est un compare-and-swap/);
  assert.match(work.execution_prompt, /La prose n'est jamais executable/);
  assert.match(work.execution_prompt, /REQUIRE_CONFIRMATION exige une condition Catalog V1\.2 explicite/);
  assert.match(work.execution_prompt, /REDUCE_RISK exige un nouveau plan/);
  assert.match(work.execution_prompt, /memory_policy=LATEST_ONLY/);
  assert.match(work.execution_prompt, /INVALIDATE_TERMINAL/);
  assert.match(work.execution_prompt, /LATCH_UNTIL_TRIGGER est interdit/);
  assert.match(work.execution_prompt, /absence isolee produit DEGRADED, jamais fail/);
  assert.match(work.execution_prompt, /backend decide de la severite, jamais le worker/);
});

test("LIVE claim returns DATA_NOT_READY without taking a lease when trigger candles are stale", async () => {
  let persistentClaimCalled = false;
  const sourceError = new Error("Required LIVE SQL dataset is stale: MNQ_M5.");
  sourceError.code = "LOCAL_PACK_CORE_DATASET_STALE";
  sourceError.details = {
    dataset: "MNQ_M5",
    latest_closed_timestamp_utc: "2026-07-17T19:55:00.000Z",
    cutoff_utc: "2026-07-19T22:15:00.000Z",
  };
  const service = new DeskLiveService({
    clock: new FixedClock(Date.parse("2026-07-19T22:15:00.000Z")),
    persistence: {
      async getDocument() { return null; },
      async claimLiveCursor() {
        persistentClaimCalled = true;
        assert.fail("a stale LIVE source must never acquire a cursor lease");
      },
    },
    host: {
      async getDeskPack() { return null; },
      async buildAndPublishLiveRollingPack() { throw sourceError; },
    },
  });

  const result = await service.claimNext({
    worker_id: "live-worker",
    trading_date: "2026-07-20",
    session: "asia_open",
    lease_seconds: 660,
  });

  assert.equal(result.status, "DATA_NOT_READY");
  assert.equal(result.reason, "live_source_not_fresh");
  assert.equal(result.data_quality.execution_allowed, false);
  assert.equal(result.error.code, "LOCAL_PACK_CORE_DATASET_STALE");
  assert.equal(result.error.details.dataset, "MNQ_M5");
  assert.equal(persistentClaimCalled, false);
});

test("the LIVE scheduler idempotently prepares one continuous daily cursor", async () => {
  const documents = new Map();
  const persistence = {
    async getDocument(_collection, id) {
      return documents.get(id) || null;
    },
    async transitionLiveCursor(input) {
      const current = documents.get(input.cursorId) || input.initialCursor;
      const outcome = input.transition(current);
      documents.set(input.cursorId, outcome.cursor);
      return outcome;
    },
  };
  const service = new DeskLiveService({
    clock: new FixedClock(Date.parse("2026-07-27T00:01:00.000Z")),
    persistence,
    host: {},
  });

  const first = await service.ensureDailyCursors({ trading_date: "2026-07-27" });
  const second = await service.ensureDailyCursors({ trading_date: "2026-07-27" });

  assert.equal(first.status, "LIVE_DAY_READY");
  assert.equal(first.created, 1);
  assert.deepEqual(first.cursors.map((cursor) => cursor.cursor_id), [
    "livecur__2026-07-27",
  ]);
  assert.equal(second.created, 0);
  assert.deepEqual(second.cursors.map((cursor) => cursor.status), ["EXISTING"]);
  assert.equal(documents.size, 1);
});

test("LIVE service rearms a persisted pre-fix Monitor replan before the next claim", async () => {
  const checkpoint = "2026-07-27T14:15:00+02:00";
  const initial = {
    ...initLiveRunCursor(
      { trading_date: "2026-07-27" },
      liveTick("2026-07-26T22:30:00.000Z"),
    ),
    master_state: "READY",
    master_id: "master-before-replan",
    thesis_state: "ACTIVE",
    thesis_id: "thesis-before-replan",
    phase_master_ids: { asia_open: "master-before-replan" },
    phase_thesis_ids: { asia_open: "thesis-before-replan" },
  };
  const claimed = claimLiveCursor(initial, {
    worker_id: "worker-before-fix",
    lease_token: "lease-before-fix",
    work: {
      workflow: "LIVE_M15_MONITOR",
      checkpoint,
      master_id: "master-before-replan",
      thesis_id: "thesis-before-replan",
      data_quality: "ready",
      bundle: {
        bundle_id: "monitor-bundle-before-fix",
        bundle_tool: "get_manual_monitor_bundle",
        bundle_args: { bundle_id: "monitor-bundle-before-fix" },
      },
      execution_prompt: "Execute persisted Monitor",
      prompt_hash: "persisted-monitor-hash",
      contract_context: activeContractContext("LIVE_M15_MONITOR"),
      runtime_versions: ACTIVE_STRATEGY_RUNTIME_VERSIONS,
      save_target: {
        tool: "save_manual_monitor",
        ...activeSaveTarget("LIVE_M15_MONITOR"),
      },
    },
  }, liveTick("2026-07-27T12:15:00.000Z"));
  const completedBeforeFix = completeLiveCursor(
    claimed.cursor,
    {
      worker_id: claimed.cursor.attempt.worker_id,
      cursor_id: claimed.cursor.cursor_id,
      checkpoint,
      lease_token: claimed.cursor.attempt.lease_token,
    },
    liveTick("2026-07-27T12:16:00.000Z"),
    { outputMaterialized: true },
  ).cursor;
  assert.equal(completedBeforeFix.replan_checkpoint, null);

  const documents = new Map([[completedBeforeFix.cursor_id, completedBeforeFix]]);
  const persistence = {
    async getDocument(_collection, id) {
      return documents.get(id) || null;
    },
    async transitionLiveCursor(input) {
      const current = documents.get(input.cursorId) || input.initialCursor;
      const outcome = input.transition(current);
      documents.set(input.cursorId, outcome.cursor);
      return outcome;
    },
  };
  const service = new DeskLiveService({
    clock: new FixedClock(Date.parse("2026-07-27T12:26:00.000Z")),
    persistence,
    host: {
      async getLatestManualMonitor({ bundle_id }) {
        assert.equal(bundle_id, "monitor-bundle-before-fix");
        return {
          latest_monitor: {
            monitor_id: "monitor-before-fix",
            monitor_decision: { action: "REPLAN_FULL" },
          },
        };
      },
    },
  });

  const rearmed = await service.armPersistedReplan(completedBeforeFix);
  assert.equal(rearmed.replan_checkpoint, checkpoint);
  assert.equal(rearmed.replan_action, "REPLAN_FULL");
  assert.equal(rearmed.cursor_status, "DUE");

  const preview = claimLiveCursor(
    rearmed,
    { worker_id: "worker-after-fix" },
    liveTick("2026-07-27T12:26:00.000Z"),
  );
  assert.equal(preview.result.status, "WORK_DUE");
  assert.equal(preview.result.workflow, "LIVE_MASTER");
  assert.equal(preview.result.checkpoint, checkpoint);
});

function activeContractContext(workflow) {
  const master = workflow === "LIVE_MASTER";
  return {
    contract_name: master
      ? "DeskMasterAnalysisContract"
      : "DeskHourlyThesisMonitorContract",
    schema_version: master
      ? ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract
      : ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract,
    contract_hash: `contract-hash-${workflow}`,
    execution_policy: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy },
    execution_plan: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan },
    monitor_command: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command },
    condition_catalog: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog },
  };
}

function activeSaveTarget(workflow) {
  const master = workflow === "LIVE_MASTER";
  return {
    contract_name: master
      ? "DeskMasterAnalysisContract"
      : "DeskHourlyThesisMonitorContract",
    schema_version: master
      ? ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract
      : ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract,
    execution_policy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy,
    execution_plan_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan,
    monitor_command_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command,
    condition_catalog_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog,
    deterministic_compiler_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
    condition_engine_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_engine,
  };
}

function spyStore(calls) {
  return new Proxy({
    async logToolCall() {},
    async claimNextLive(args) {
      calls.push({ method: "claimNextLive", args });
      return { ok: true, status: "NO_WORK", scope: "live", reason: "up_to_date" };
    },
    async claimNextReplay(args) {
      calls.push({ method: "claimNextReplay", args });
      return { ok: true, status: "NO_WORK", scope: "replay", reason: "no_ready_step" };
    },
  }, {
    get(target, property) {
      if (property in target) return target[property];
      return async () => ({ ok: true });
    },
  });
}

function liveTick(utc) {
  const epochMs = Date.parse(utc);
  return {
    epochMs,
    utc: new Date(epochMs).toISOString(),
  };
}
