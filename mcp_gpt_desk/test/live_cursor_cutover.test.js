import assert from "node:assert/strict";
import test from "node:test";
import { buildLiveCursorWork, DESK_LIVE_PROMPT_VERSION } from "../src/live-cursor-work.js";
import { callDeskTool, createDeskToolRegistry, listDeskTools } from "../src/tools.js";

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
      contract_context: {
        contract_name: "DeskHourlyThesisMonitorContract",
        schema_version: "1.0.0",
        contract_hash: "monitor-contract-hash",
      },
      save_target: {
        tool: "save_manual_monitor",
        suggested_payload: {
          pack_build_id: "packbuild-1730",
          pack_id: "2026-07-14_ny_open",
          linked_master_analysis_id: "master-1",
          linked_active_thesis_id: "thesis-1",
        },
      },
    },
  });

  assert.equal(DESK_LIVE_PROMPT_VERSION, "1.2.0");
  assert.equal(work.prompt_version, "1.2.0");
  assert.match(work.execution_prompt, /Ne rappelle pas get_active_contracts ni get_contract/);
  assert.match(work.execution_prompt, /1\. Appelle get_manual_monitor_bundle/);
  assert.match(work.execution_prompt, /monitor-contract-hash/);
  assert.match(work.execution_prompt, /suggested_payload sans retirer de champ/);
  assert.match(work.execution_prompt, /timezone/);
  assert.match(work.execution_prompt, /cadence operationnelle du worker est horaire/);
  assert.match(work.execution_prompt, /structure H4\/H1 porte le biais/);
  assert.match(work.execution_prompt, /plusieurs bougies M15/);
  assert.match(work.execution_prompt, /micro-mouvement de scalp/);
  assert.match(work.execution_prompt, /depuis le dernier monitor materialise/);
});

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
