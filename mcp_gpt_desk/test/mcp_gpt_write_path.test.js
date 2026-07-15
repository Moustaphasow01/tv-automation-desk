import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDeskExecutionScope } from "@tv-automation/desk-domain";
import { FixedClock } from "@tv-automation/desk-time";
import { buildDatasetManifestEntry, buildSourceManifest } from "../src/pack-integrity.js";
import { createTestDeskStore } from "./support/test-desk-store.js";
import {
  callDeskTool,
  createDeskToolRegistry,
  getToolRequiredScopes,
  listDeskTools,
} from "../src/tools.js";

const liveScope = {
  strategy_id: "asia_open",
  session: "asia_open",
  mode: "live",
  trading_date: "2026-07-11",
  run_id: "chatgpt_mcp_write_test",
  as_of_utc: "2026-07-11T06:15:00+00:00",
  timezone: "Europe/Paris",
};

function makeWriterStore() {
  const calls = [];
  const capture = (tool) => async (args) => {
    calls.push({ tool, args });
    return { ok: true, tool };
  };
  return {
    calls,
    logTool: async () => {},
    saveMasterAnalysis: capture("save_master_analysis"),
    saveManualMonitor: capture("save_manual_monitor"),
    saveReplayMasterAnalysis: capture("save_replay_master_analysis"),
    saveReplayMonitor: capture("save_replay_monitor"),
  };
}

test("ChatGPT MCP writers stay exposed as desk.write tools", () => {
  const registry = createDeskToolRegistry(makeWriterStore());
  const listed = listDeskTools(registry);
  for (const name of [
    "save_master_analysis",
    "save_manual_monitor",
    "save_replay_master_analysis",
    "save_replay_monitor",
  ]) {
    const tool = listed.find((candidate) => candidate.name === name);
    assert.ok(tool, `${name} must remain visible through MCP tools/list`);
    assert.equal(tool.annotations.readOnlyHint, false);
    assert.deepEqual(getToolRequiredScopes(registry, name), ["desk.write"]);
    assert.deepEqual(tool.securitySchemes, [{ type: "oauth2", scopes: ["desk.write"] }]);
  }
});

test("ChatGPT MCP writer calls validate and dispatch without a dashboard handoff", async () => {
  const store = makeWriterStore();
  const registry = createDeskToolRegistry(store);

  const master = await callDeskTool(registry, "save_master_analysis", {
    ...liveScope,
    analysis_id: "master_chatgpt_mcp",
    contract_name: "DeskMasterAnalysisContract",
    schema_version: "4.0.0",
    contract_hash: "master-contract-hash",
    pack_id: "2026-07-11_asia_open",
    date: "2026-07-11",
    created_at_paris: "2026-07-11T08:15:00+02:00",
    full_analysis: { executive_summary: { final_decision: "wait" }, setups: [] },
  });
  assert.equal(master.isError, false);

  const manualMonitor = await callDeskTool(registry, "save_manual_monitor", {
    ...liveScope,
    monitor_id: "monitor_chatgpt_mcp",
    contract_name: "DeskHourlyThesisMonitorContract",
    schema_version: "1.0.0",
    contract_hash: "monitor-contract-hash",
    timestamp_paris: "2026-07-11T08:15:00+02:00",
    monitor_decision: { action: "WAIT_MORE" },
  });
  assert.equal(manualMonitor.isError, false);

  const replayMaster = await callDeskTool(registry, "save_replay_master_analysis", {
    backtest_id: "backtest_chatgpt_mcp",
    step_id: "step_master_chatgpt_mcp",
    expected_revision: 2,
    idempotency_key: "save-master-chatgpt-mcp",
    contract_name: "DeskMasterAnalysisContract",
    schema_version: "4.0.0",
    contract_hash: "master-contract-hash",
    analysis_id: "backtest_chatgpt_mcp__master",
    pack_build_id: "pack-build-chatgpt-mcp",
    full_analysis: { executive_summary: { final_decision: "wait" }, setups: [] },
    setups: [],
  });
  assert.equal(replayMaster.isError, false);

  const replayMonitor = await callDeskTool(registry, "save_replay_monitor", {
    backtest_id: "backtest_chatgpt_mcp",
    step_id: "step_monitor_chatgpt_mcp",
    expected_revision: 4,
    idempotency_key: "save-monitor-chatgpt-mcp",
    monitor_id: "backtest_chatgpt_mcp__monitor",
    master_id: "backtest_chatgpt_mcp__master",
    thesis_id: "backtest_chatgpt_mcp__thesis",
    sequence: 2,
    scheduled_for_utc: "2026-07-11T06:30:00+00:00",
    as_of_utc: "2026-07-11T06:30:00+00:00",
    pack_build_id: "pack-build-chatgpt-mcp",
    contract_name: "DeskHourlyThesisMonitorContract",
    schema_version: "1.0.0",
    contract_hash: "monitor-contract-hash",
    monitor_decision: { action: "WAIT_MORE" },
  });
  assert.equal(replayMonitor.isError, false);

  assert.deepEqual(store.calls.map((entry) => entry.tool), [
    "save_master_analysis",
    "save_manual_monitor",
    "save_replay_master_analysis",
    "save_replay_monitor",
  ]);
  assert.equal(store.calls[0].args.contract_hash, "master-contract-hash");
  assert.equal(store.calls[1].args.contract_hash, "monitor-contract-hash");
  assert.equal(store.calls[2].args.backtest_id, "backtest_chatgpt_mcp");
  assert.equal(store.calls[3].args.backtest_id, "backtest_chatgpt_mcp");
});

test("ChatGPT MCP replay writers persist through a real pinned replay run", async () => {
  const fixture = await makePinnedReplayFixture();
  const registry = createDeskToolRegistry(fixture.store);
  const backtestId = "bt_chatgpt_mcp_e2e";

  const cutoffRead = await callDeskTool(registry, "get_dataset", {
    pack_id: fixture.packId,
    pack_build_id: fixture.packBuildId,
    dataset: "MNQ_M5",
    as_of_utc: fixture.cutoffUtc,
    mode: "replay",
    format: "json",
    max_rows: 5000,
  });
  assert.equal(cutoffRead.isError, false, cutoffRead.structuredContent.error);
  assert.ok(cutoffRead.structuredContent.source_row_count > cutoffRead.structuredContent.row_count);
  assert.equal(cutoffRead.structuredContent.rows.at(-1).timestamp_paris, fixture.cutoffParis.replace("+02:00", ".000+02:00"));
  const h4CutoffRead = await callDeskTool(registry, "get_dataset", {
    pack_id: fixture.packId,
    pack_build_id: fixture.packBuildId,
    dataset: "MNQ_H4",
    as_of_utc: fixture.cutoffUtc,
    mode: "replay",
    format: "json",
    max_rows: 5000,
  });
  assert.equal(h4CutoffRead.isError, false, h4CutoffRead.structuredContent.error);
  assert.equal(h4CutoffRead.structuredContent.rows.length, 1);
  assert.equal(h4CutoffRead.structuredContent.rows[0].timestamp_paris, "2026-07-08T20:00:00.000+02:00");

  const created = await callDeskTool(registry, "create_orchestrated_replay_day", {
    backtest_id: backtestId,
    replay_run_id: backtestId,
    strategy_id: "asia_open",
    date: "2026-07-09",
    trading_date: "2026-07-09",
    session: "asia_open",
    pack_id: fixture.packId,
    pack_build_id: fixture.packBuildId,
    cutoff_paris: fixture.cutoffParis,
    cutoff_utc: fixture.cutoffUtc,
    start_time: fixture.cutoffParis,
    end_time: "2026-07-09T01:00:00+02:00",
    cadence: "15m",
    timezone: "Europe/Paris",
    idempotency_key: "create-chatgpt-mcp-e2e",
    instruments: ["MNQ"],
    risk_model: "0.5pct_fixed",
    automation_enabled: false,
  });
  assert.equal(created.isError, false, created.structuredContent.error);

  const preparedMaster = await callDeskTool(registry, "prepare_replay_master_bundle", {
    backtest_id: backtestId,
    step_id: created.structuredContent.current_step_id,
    expected_revision: created.structuredContent.revision,
    idempotency_key: "prepare-master-chatgpt-mcp-e2e",
  });
  assert.equal(preparedMaster.isError, false, preparedMaster.structuredContent.error);
  assert.equal(preparedMaster.structuredContent.bundle.pack.date, "2026-07-09");
  assert.equal(preparedMaster.structuredContent.bundle.pack.pack_purpose, "replay_source");
  assert.equal(preparedMaster.structuredContent.bundle.data_quality.source_coverage.end_utc, "2026-07-08T23:05:00.000Z");
  assert.equal(preparedMaster.structuredContent.bundle.data.pack, undefined);
  assert.equal(preparedMaster.structuredContent.bundle.section_manifest.pack.sha256.length, 64);
  assert.equal(preparedMaster.structuredContent.bundle.contract_handshake.direct_mcp_save_required, true);
  assert.equal(preparedMaster.structuredContent.bundle.contract_handshake.operator_json_handoff_allowed, false);
  assert.equal(preparedMaster.structuredContent.bundle.data.rolling_snapshots["15m"].instruments.MNQ.last_timestamp_paris, "2026-07-09T00:05:00.000+02:00");
  assert.equal(preparedMaster.structuredContent.bundle.data.rolling_snapshots["15m"].instruments.VIX.availability, "stale_market_closed");
  assert.equal(preparedMaster.structuredContent.bundle.data.rolling_snapshots["15m"].instruments.VIX.last_known.close, 16.15);
  assert.equal(preparedMaster.structuredContent.bundle.data.market_availability.tech_gap_context.NVDA.status, "not_yet_open");
  assert.equal(preparedMaster.structuredContent.bundle.data.market_availability.tech_gap_context.NVDA.previous_close, 194.51);
  assert.equal(preparedMaster.structuredContent.bundle.data_quality.missing.some((item) => String(item).includes("VIX")), false);

  const compactMasterRead = await callDeskTool(registry, "get_replay_master_bundle", {
    backtest_id: backtestId,
    step_id: preparedMaster.structuredContent.step_id,
    view: "compact",
    include_raw_refs: false,
  });
  assert.equal(compactMasterRead.isError, false, compactMasterRead.structuredContent.error);
  assert.equal(compactMasterRead.structuredContent.view, "compact");
  assert.equal(compactMasterRead.structuredContent.transport.budget_exceeded, false);
  assert.deepEqual(compactMasterRead.content, []);

  const masterManifest = await callDeskTool(registry, "get_replay_bundle_manifest", {
    backtest_id: backtestId,
    step_id: preparedMaster.structuredContent.step_id,
    bundle_type: "master",
  });
  assert.equal(masterManifest.isError, false, masterManifest.structuredContent.error);
  assert.equal(masterManifest.structuredContent.section_manifest.rolling_snapshots.sha256.length, 64);

  const masterSnapshot = await callDeskTool(registry, "get_replay_snapshot", {
    backtest_id: backtestId,
    step_id: preparedMaster.structuredContent.step_id,
    bundle_type: "master",
    window: "15m",
    instruments: ["MNQ"],
  });
  assert.equal(masterSnapshot.isError, false, masterSnapshot.structuredContent.error);
  assert.deepEqual(Object.keys(masterSnapshot.structuredContent.data), ["15m"]);

  const stateAfterReads = await callDeskTool(registry, "get_replay_state", { backtest_id: backtestId });
  assert.equal(stateAfterReads.structuredContent.selected_backtest.revision, preparedMaster.structuredContent.revision);
  assert.equal(stateAfterReads.structuredContent.status, "WAITING_GPT_MASTER");

  const masterSuggested = preparedMaster.structuredContent.bundle.save_target.suggested_payload;
  const masterSavePayload = {
    ...masterSuggested,
    full_analysis: {
      executive_summary: { final_decision: "wait", summary: "MCP replay Master saved." },
      setups: [],
    },
    active_thesis: {
      thesis_id: "main",
      status: "WAIT_MONITORED",
      instrument: "MNQ",
      direction: "long",
      dominant_scenario: "MCP replay thesis",
      health_score: 70,
    },
    setups: [],
  };
  const savedMaster = await callDeskTool(registry, "save_replay_master_analysis", masterSavePayload);
  assert.equal(savedMaster.isError, false, savedMaster.structuredContent.error);
  assert.equal(savedMaster.structuredContent.status, "READY_FOR_NEXT_MONITOR");

  const duplicateMasterSave = await callDeskTool(registry, "save_replay_master_analysis", masterSavePayload);
  assert.equal(duplicateMasterSave.isError, false, duplicateMasterSave.structuredContent.error);
  assert.equal(duplicateMasterSave.structuredContent.idempotent_replay, true);
  assert.equal(duplicateMasterSave.structuredContent.revision, savedMaster.structuredContent.revision);

  const advanced = await callDeskTool(registry, "advance_replay_clock", {
    backtest_id: backtestId,
    expected_revision: savedMaster.structuredContent.revision,
    idempotency_key: "advance-chatgpt-mcp-e2e",
    minutes: 15,
  });
  assert.equal(advanced.isError, false, advanced.structuredContent.error);

  const preparedMonitor = await callDeskTool(registry, "prepare_replay_monitor_bundle", {
    backtest_id: backtestId,
    step_id: advanced.structuredContent.step_id,
    expected_revision: advanced.structuredContent.revision,
    idempotency_key: "prepare-monitor-chatgpt-mcp-e2e",
  });
  assert.equal(preparedMonitor.isError, false, preparedMonitor.structuredContent.error);
  assert.equal(preparedMonitor.structuredContent.bundle.contract_handshake.direct_mcp_save_required, true);
  assert.equal(preparedMonitor.structuredContent.bundle.data.rolling_snapshots["15m"].instruments.MNQ.last_timestamp_paris, "2026-07-09T00:20:00.000+02:00");

  const compactMonitorRead = await callDeskTool(registry, "get_replay_monitor_bundle", {
    backtest_id: backtestId,
    step_id: preparedMonitor.structuredContent.step_id,
    view: "compact",
  });
  assert.equal(compactMonitorRead.isError, false, compactMonitorRead.structuredContent.error);
  assert.equal(compactMonitorRead.structuredContent.replay_master_analysis.analysis_id, masterSuggested.analysis_id);
  assert.equal(compactMonitorRead.structuredContent.save_target.suggested_payload.expected_revision, preparedMonitor.structuredContent.revision);

  const monitorSuggested = preparedMonitor.structuredContent.bundle.save_target.suggested_payload;
  const monitorSavePayload = {
    ...monitorSuggested,
    monitor_decision: { action: "REPLAN_FULL", summary: "MCP replay Monitor requests a new Master." },
  };
  const savedMonitor = await callDeskTool(registry, "save_replay_monitor", monitorSavePayload);
  assert.equal(savedMonitor.isError, false, savedMonitor.structuredContent.error);
  assert.equal(savedMonitor.structuredContent.status, "MONITOR_SAVED");

  const duplicateMonitorSave = await callDeskTool(registry, "save_replay_monitor", monitorSavePayload);
  assert.equal(duplicateMonitorSave.isError, false, duplicateMonitorSave.structuredContent.error);
  assert.equal(duplicateMonitorSave.structuredContent.idempotent_replay, true);
  assert.equal(duplicateMonitorSave.structuredContent.revision, savedMonitor.structuredContent.revision);

  const appliedMonitor = await callDeskTool(registry, "apply_replay_monitor_result", {
    backtest_id: backtestId,
    step_id: preparedMonitor.structuredContent.step_id,
    expected_revision: savedMonitor.structuredContent.revision,
    idempotency_key: "apply-replan-monitor-chatgpt-mcp-e2e",
  });
  assert.equal(appliedMonitor.isError, false, appliedMonitor.structuredContent.error);
  assert.equal(appliedMonitor.structuredContent.status, "REPLAN_REQUIRED");

  const preparedReplan = await callDeskTool(registry, "prepare_replay_master_bundle", {
    backtest_id: backtestId,
    step_id: preparedMonitor.structuredContent.step_id,
    expected_revision: appliedMonitor.structuredContent.revision,
    idempotency_key: "prepare-replan-master-chatgpt-mcp-e2e",
  });
  assert.equal(preparedReplan.isError, false, preparedReplan.structuredContent.error);
  assert.equal(preparedReplan.structuredContent.status, "WAITING_GPT_MASTER");
  assert.notEqual(preparedReplan.structuredContent.step_id, preparedMonitor.structuredContent.step_id);
  assert.equal(preparedReplan.structuredContent.bundle.is_replan, true);
  assert.equal(preparedReplan.structuredContent.bundle.replan_context.source_step_id, preparedMonitor.structuredContent.step_id);
  assert.equal(preparedReplan.structuredContent.bundle.replan_context.previous_master_analysis.analysis_id, masterSuggested.analysis_id);
  assert.equal(
    preparedReplan.structuredContent.bundle.replan_context.previous_active_thesis.thesis_id,
    savedMaster.structuredContent.active_replay_thesis_id,
  );
  assert.equal(preparedReplan.structuredContent.bundle.replan_context.triggering_monitor.monitor_id, monitorSuggested.monitor_id);
  assert.equal(preparedReplan.structuredContent.bundle.chatgpt_replay_instructions.required_mode, "manual_gpt_master_replan_replay");
  assert.equal(preparedReplan.structuredContent.bundle.save_target.suggested_payload.step_id, preparedReplan.structuredContent.step_id);

  const state = await callDeskTool(registry, "get_replay_state", { backtest_id: backtestId });
  assert.equal(state.isError, false);
  assert.equal(state.structuredContent.status, "WAITING_GPT_MASTER");
  assert.equal(state.structuredContent.current_step.step_type, "MASTER");
  assert.equal(state.structuredContent.current_step.is_replan, true);
  assert.equal(state.structuredContent.latest_monitor.monitor_id, monitorSuggested.monitor_id);
  assert.equal(state.structuredContent.latest_monitor.backtest_id, backtestId);
  assert.equal(state.structuredContent.selected_backtest.linked_master_analysis_id, masterSuggested.analysis_id);
});

test("Replay creation rejects an immutable source pack that cannot cover the requested range", async () => {
  const fixture = await makePinnedReplayFixture();
  const registry = createDeskToolRegistry(fixture.store);
  const result = await callDeskTool(registry, "create_orchestrated_replay_day", {
    backtest_id: "bt_source_too_short",
    replay_run_id: "bt_source_too_short",
    strategy_id: "asia_open",
    date: "2026-07-09",
    trading_date: "2026-07-09",
    session: "asia_open",
    pack_id: fixture.packId,
    pack_build_id: fixture.packBuildId,
    cutoff_paris: fixture.cutoffParis,
    cutoff_utc: fixture.cutoffUtc,
    start_time: fixture.cutoffParis,
    end_time: "2026-07-09T02:00:00+02:00",
    cadence: "15m",
    timezone: "Europe/Paris",
    idempotency_key: "create-source-too-short",
    instruments: ["MNQ"],
  });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.code, "REPLAY_SOURCE_COVERAGE_INSUFFICIENT");
});

test("scheduled GPT work claims one automated Replay Master then prepares the next Monitor", async () => {
  const fixture = await makePinnedReplayFixture();
  const registry = createDeskToolRegistry(fixture.store);
  const backtestId = "bt_scheduled_agent_e2e";
  const created = await callDeskTool(registry, "create_orchestrated_replay_day", {
    backtest_id: backtestId,
    replay_run_id: backtestId,
    strategy_id: "asia_open",
    date: "2026-07-09",
    trading_date: "2026-07-09",
    session: "asia_open",
    pack_id: fixture.packId,
    pack_build_id: fixture.packBuildId,
    cutoff_paris: fixture.cutoffParis,
    cutoff_utc: fixture.cutoffUtc,
    start_time: fixture.cutoffParis,
    end_time: "2026-07-09T01:05:00+02:00",
    cadence: "15m",
    timezone: "Europe/Paris",
    idempotency_key: "create-scheduled-agent-e2e",
    instruments: ["MNQ"],
    automation_enabled: true,
  });
  assert.equal(created.isError, false, created.structuredContent.error);
  assert.equal(created.structuredContent.automation.status, "WAITING_GPT");

  const state = await callDeskTool(registry, "get_replay_state", { backtest_id: backtestId });
  assert.equal(state.structuredContent.status, "WAITING_GPT_MASTER");
  assert.equal(state.structuredContent.automation.enabled, true);
  assert.equal(state.structuredContent.current_work_item.workflow, "REPLAY_MASTER");

  const claimed = await callDeskTool(registry, "claim_next_replay", {
    worker_id: "scheduled-task-00",
    workflows: ["REPLAY_MASTER", "REPLAY_MONITOR"],
    backtest_id: backtestId,
    lease_seconds: 720,
  });
  assert.equal(claimed.isError, false, claimed.structuredContent.error);
  assert.equal(claimed.structuredContent.status, "WORK_CLAIMED");
  assert.match(claimed.structuredContent.execution_prompt, /save_replay_master_analysis/);

  const duplicateClaim = await callDeskTool(registry, "claim_next_replay", {
    worker_id: "scheduled-task-15",
    workflows: ["REPLAY_MASTER", "REPLAY_MONITOR"],
    backtest_id: backtestId,
    lease_seconds: 720,
  });
  assert.equal(duplicateClaim.structuredContent.status, "NO_WORK");

  const work = {
    work_item_id: claimed.structuredContent.claim_handle.work_item_id,
    claimed_by: "scheduled-task-00",
    lease_token: claimed.structuredContent.claim_handle.lease_token,
  };
  const saved = await callDeskTool(registry, "save_replay_master_analysis", {
    ...claimed.structuredContent.save_target,
    work_item_id: work.work_item_id,
    worker_id: work.claimed_by,
    lease_token: work.lease_token,
    full_analysis: { executive_summary: { final_decision: "wait", summary: "Scheduled Master." }, setups: [] },
    active_thesis: {
      thesis_id: "main",
      status: "WAIT_MONITORED",
      instrument: "MNQ",
      direction: "long",
      dominant_scenario: "Scheduled replay thesis",
      health_score: 65,
    },
    setups: [],
  });
  assert.equal(saved.isError, false, saved.structuredContent.error);
  assert.equal(saved.structuredContent.automation.status, "WAITING_GPT");

  const monitorState = await callDeskTool(registry, "get_replay_state", { backtest_id: backtestId });
  assert.equal(monitorState.structuredContent.status, "WAITING_GPT_MONITOR");
  assert.equal(monitorState.structuredContent.current_work_item.workflow, "REPLAY_MONITOR");
  assert.equal(monitorState.structuredContent.work_queue.find((item) => item.work_item_id === work.work_item_id).status, "COMPLETED");
});

async function makePinnedReplayFixture() {
  const root = await mkdtemp(join(tmpdir(), "desk-mcp-write-e2e-"));
  const packId = "2026-07-09_asia_open";
  const packBuildId = "packbuild__2026-07-09_asia_open__mcp_e2e";
  const cutoffParis = "2026-07-09T00:05:00+02:00";
  const cutoffUtc = "2026-07-08T22:05:00+00:00";
  const sourceCutoffParis = "2026-07-09T01:05:00+02:00";
  const sourceCutoffUtc = "2026-07-08T23:05:00.000Z";
  const datasets = {
    MNQ_M5: [
      "asset,timeframe,timestamp_utc,timestamp_paris,open,high,low,close,volume",
      "MNQ,5,2026-07-08T21:45:00.000Z,2026-07-08T23:45:00.000+02:00,100,102,99,101,10",
      "MNQ,5,2026-07-08T21:50:00.000Z,2026-07-08T23:50:00.000+02:00,101,103,100,102,10",
      "MNQ,5,2026-07-08T21:55:00.000Z,2026-07-08T23:55:00.000+02:00,102,104,101,103,10",
      "MNQ,5,2026-07-08T22:00:00.000Z,2026-07-09T00:00:00.000+02:00,103,105,102,104,10",
      "MNQ,5,2026-07-08T22:05:00.000Z,2026-07-09T00:05:00.000+02:00,104,106,103,105,10",
      "MNQ,5,2026-07-08T22:20:00.000Z,2026-07-09T00:20:00.000+02:00,105,108,104,107,10",
      "MNQ,5,2026-07-08T22:35:00.000Z,2026-07-09T00:35:00.000+02:00,107,110,106,109,10",
      "MNQ,5,2026-07-08T22:50:00.000Z,2026-07-09T00:50:00.000+02:00,109,111,108,110,10",
      "MNQ,5,2026-07-08T23:00:00.000Z,2026-07-09T01:00:00.000+02:00,110,112,109,111,10",
      "MNQ,5,2026-07-08T23:05:00.000Z,2026-07-09T01:05:00.000+02:00,111,113,110,112,10",
      "",
    ].join("\n"),
    NQ_M15: [
      "asset,timeframe,timestamp_utc,timestamp_paris,open,high,low,close,volume",
      "NQ,15,2026-07-08T21:30:00.000Z,2026-07-08T23:30:00.000+02:00,98,101,97,100,20",
      "NQ,15,2026-07-08T21:45:00.000Z,2026-07-08T23:45:00.000+02:00,100,103,99,102,20",
      "NQ,15,2026-07-08T22:00:00.000Z,2026-07-09T00:00:00.000+02:00,102,105,101,104,20",
      "NQ,15,2026-07-08T22:15:00.000Z,2026-07-09T00:15:00.000+02:00,104,108,103,107,20",
      "NQ,15,2026-07-08T22:30:00.000Z,2026-07-09T00:30:00.000+02:00,107,110,106,109,20",
      "NQ,15,2026-07-08T22:45:00.000Z,2026-07-09T00:45:00.000+02:00,109,112,108,111,20",
      "NQ,15,2026-07-08T23:00:00.000Z,2026-07-09T01:00:00.000+02:00,111,113,110,112,20",
      "",
    ].join("\n"),
    MNQ_H4: [
      "asset,timeframe,timestamp_utc,timestamp_paris,open,high,low,close,volume",
      "MNQ,4H,2026-07-08T18:00:00.000Z,2026-07-08T20:00:00.000+02:00,95,105,94,103,100",
      "MNQ,4H,2026-07-08T22:00:00.000Z,2026-07-09T00:00:00.000+02:00,103,120,102,118,100",
      "",
    ].join("\n"),
    DXY_CL_GC_VIX: [
      "asset,timeframe,timestamp_utc,timestamp_paris,open,high,low,close,volume",
      "VIX,5,2026-07-08T19:55:00.000Z,2026-07-08T21:55:00.000+02:00,16.2,16.3,16.1,16.15,0",
      "",
    ].join("\n"),
    DXY_CL_GC_VIX_H4: [
      "asset,timeframe,timestamp_utc,timestamp_paris,open,high,low,close,volume",
      "VIX,4H,2026-07-08T17:30:00.000Z,2026-07-08T19:30:00.000+02:00,16.8,17.2,16.0,16.15,0",
      "",
    ].join("\n"),
    mega_caps_premarket: [
      "asset,timeframe,timestamp_utc,timestamp_paris,open,high,low,close,volume",
      "NVDA,5,2026-07-08T19:55:00.000Z,2026-07-08T21:55:00.000+02:00,193,195,192,194.51,100",
      "SMH,5,2026-07-08T19:55:00.000Z,2026-07-08T21:55:00.000+02:00,590,593,588,591.99,100",
      "",
    ].join("\n"),
    mega_caps_premarket_H4: [
      "asset,timeframe,timestamp_utc,timestamp_paris,open,high,low,close,volume",
      "NVDA,4H,2026-07-08T17:30:00.000Z,2026-07-08T19:30:00.000+02:00,193,195,192,194.51,100",
      "SMH,4H,2026-07-08T17:30:00.000Z,2026-07-08T19:30:00.000+02:00,590,593,588,591.99,100",
      "",
    ].join("\n"),
  };
  await mkdir(join(root, "desk_packs"), { recursive: true });
  await mkdir(join(root, "desk_pack_builds"), { recursive: true });
  await mkdir(join(root, "datasets", packBuildId), { recursive: true });

  const scope = createDeskExecutionScope({
    strategy_id: "asia_open",
    session: "asia_open",
    mode: "replay",
    trading_date: "2026-07-09",
    timezone: "Europe/Paris",
    cutoff_paris: sourceCutoffParis,
    cutoff_utc: sourceCutoffUtc,
    backtest_id: "bt_chatgpt_mcp_e2e",
    pack_id: packId,
    pack_build_id: packBuildId,
  });
  const refs = {};
  for (const [dataset, csv] of Object.entries(datasets)) {
    const localPath = join(root, "datasets", packBuildId, `${dataset}.csv`);
    await writeFile(localPath, csv);
    refs[dataset] = {
      ...buildDatasetManifestEntry({
        packId,
        packBuildId,
        strategyId: "asia_open",
        session: "asia_open",
        dataset,
        cutoffUtc: sourceCutoffUtc,
        objectPath: `gs://fixture/desk-data/packs/${packId}/builds/${packBuildId}/raw/${dataset}.csv`,
        generation: `fixture-${dataset}`,
        source: "fixture",
        buffer: csv,
        format: "csv",
      }),
      local_path: localPath,
    };
  }
  const manifest = buildSourceManifest({
    packId,
    packBuildId,
    scope,
    datasets: refs,
    createdAtUtc: "2026-07-11T08:00:00+00:00",
  });
  await writeFile(join(root, "desk_packs", `${packId}.json`), JSON.stringify({
    pack_id: packId,
    date: "2026-07-09",
    trading_date: "2026-07-09",
    strategy_id: "asia_open",
    session: "asia_open",
    status: "ready",
    active_build_id: packBuildId,
    source_manifest_hash: manifest.source_manifest_hash,
  }));
  await writeFile(join(root, "desk_pack_builds", `${packBuildId}.json`), JSON.stringify({
    pack_id: packId,
    pack_build_id: packBuildId,
    trading_date: "2026-07-09",
    strategy_id: "asia_open",
    session: "asia_open",
    status: "ready",
    execution_allowed: true,
    pack_purpose: "replay_source",
    source_coverage: { mode: "full_replay_range", end_paris: sourceCutoffParis, end_utc: sourceCutoffUtc },
    cutoff_paris: sourceCutoffParis,
    cutoff_utc: sourceCutoffUtc,
    resolved_scope: scope,
    scope_hash: scope.scope_hash,
    source_manifest_hash: manifest.source_manifest_hash,
    manifest,
    datasets: refs,
  }));

  return {
    root,
    packId,
    packBuildId,
    cutoffParis,
    cutoffUtc,
    ...createTestDeskStore({ root, projectRoot: root, clock: new FixedClock(Date.parse("2026-07-11T08:00:00+00:00")) }),
  };
}
