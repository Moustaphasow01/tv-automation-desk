import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FixedClock } from "@tv-automation/desk-time";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { createTestDeskStore } from "./support/test-desk-store.js";
import { callDeskTool, createDeskToolRegistry, listDeskTools } from "../src/tools.js";
import { liveScope, nyLiveScope } from "./fixtures/live_scope.js";

const asiaScope = (overrides = {}) => liveScope({
  date: "2026-07-08",
  cutoff_paris: "2026-07-08T08:00:00+02:00",
  run_id: "front_asia_run",
  ...overrides,
});

const nyScope = (overrides = {}) => nyLiveScope({
  date: "2026-07-09",
  cutoff_paris: "2026-07-09T15:30:00+02:00",
  run_id: "front_ny_run",
  ...overrides,
});

async function seedMaster(store, analysis_id, scope = asiaScope()) {
  return store.saveMasterAnalysis({
    ...scope,
    analysis_id,
    contract_name: "DeskMasterAnalysisContract",
    schema_version: "4.0.0",
    contract_hash: "test-master-hash",
    full_analysis: {},
  });
}

async function makeStore() {
  const root = await mkdtemp(join(tmpdir(), "gpt-desk-front-ready-"));
  const clock = new FixedClock(Date.parse("2026-07-08T08:00:00.000Z"));
  return { root, ...createTestDeskStore({ root, projectRoot: root, clock }) };
}

test("front-ready MCP tools expose jobs and Live Desk state without a frontend", async () => {
  const { store, persistence } = await makeStore();
  const registry = createDeskToolRegistry(store);
  const tools = listDeskTools(registry).map((tool) => tool.name);

  for (const name of [
    "get_live_desk_state",
    "get_front_master_state",
    "get_front_monitor_state",
    "get_nyopen_strategy_state",
    "get_live_timeline_event_detail",
    "get_replay_state",
    "get_audit_state",
    "create_desk_job",
    "list_desk_jobs",
    "update_desk_job_status",
    "cancel_desk_job",
    "prepare_master_cutoff_bundle_job",
    "get_master_cutoff_bundle",
  ]) {
    assert.ok(tools.includes(name), `${name} should be exposed`);
  }

  const created = await callDeskTool(registry, "create_desk_job", {
    job_id: "job_master_test",
    job_type: "MASTER_ANALYSIS",
    date: "2026-07-08",
    session: "asia_open",
    status: "READY_FOR_GPT",
    pack_id: "2026-07-08_asia_open",
  });
  assert.equal(created.isError, false);
  assert.equal(created.structuredContent.job.status, "READY_FOR_GPT");

  const live = await callDeskTool(registry, "get_live_desk_state", {
    ...asiaScope(),
  });
  assert.equal(live.isError, false);
  assert.equal(live.structuredContent.desk_status, "NO_ACTIVE_THESIS");
  assert.equal(live.structuredContent.action_now.action_required, true);
  assert.equal(live.structuredContent.jobs[0].job_id, "job_master_test");

  const nyOpen = await callDeskTool(registry, "get_nyopen_strategy_state", {
    date: "2026-07-08",
    timezone: "Europe/Paris",
    pricing_mode: "conservative",
  });
  assert.equal(nyOpen.isError, false, JSON.stringify(nyOpen.structuredContent));
  assert.equal(nyOpen.structuredContent.strategy_id, "ny_open_1530");
  assert.equal(nyOpen.structuredContent.session, "ny_open");

  const cancelled = await callDeskTool(registry, "cancel_desk_job", {
    job_id: "job_master_test",
    reason: "operator_cancelled",
  });
  assert.equal(cancelled.isError, false);
  assert.equal(cancelled.structuredContent.status, "CANCELLED");
});

test("live cockpit read model exposes trailing M15 gaps, recovery and a readable checkpoint brief", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpt-desk-live-timeline-"));
  const clock = new FixedClock(Date.parse("2026-07-13T16:02:00.000Z"));
  const { store, persistence } = createTestDeskStore({ root, projectRoot: root, clock });
  await Promise.all([
    mkdir(join(root, "desk_master_analyses"), { recursive: true }),
    mkdir(join(root, "desk_manual_monitors"), { recursive: true }),
    mkdir(join(root, "desk_live_run_cursor"), { recursive: true }),
  ]);
  await writeFile(join(root, "desk_master_analyses", "master-1530.json"), JSON.stringify({
    analysis_id: "master-1530",
    strategy_id: "ny_open_1530",
    session: "ny_open",
    mode: "live",
    date: "2026-07-13",
    trading_date: "2026-07-13",
    run_id: "front_live_2026-07-13_ny_open",
    cutoff_paris: "2026-07-13T15:30:00+02:00",
    created_at_paris: "2026-07-13T15:35:00+02:00",
    status: "SAVED",
    full_analysis: { executive_summary: { summary: "Plan initial NY", final_decision: "wait" } },
  }), "utf8");
  await writeFile(join(root, "desk_manual_monitors", "monitor-1715.json"), JSON.stringify({
    monitor_id: "monitor-1715",
    strategy_id: "ny_open_1530",
    session: "ny_open",
    mode: "live",
    date: "2026-07-13",
    trading_date: "2026-07-13",
    run_id: "front_live_2026-07-13_ny_open",
    timestamp_paris: "2026-07-13T17:15:00+02:00",
    previous_monitor_summary: "La thèse restait valide avant 17h15.",
    rolling_1h_snapshot_summary: { price_action: "Rejet de la zone haute puis retour sous VWAP." },
    macro_update: { summary: "Aucune nouvelle publication majeure." },
    cross_asset_delta: { summary: "VIX ferme, Nasdaq toujours sous pression relative." },
    technical_delta: { summary: "Le rebond ne confirme pas le scénario haussier." },
    expected_vs_realized: [{ expected: "Reprise au-dessus de VWAP", realized: "Rejet sous VWAP" }],
    thesis_health_score: { previous_score: 62, current_score: 48, score_drivers_negative: ["Rejet VWAP"] },
    monitor_decision: {
      action: "MARK_AT_RISK",
      reason_summary: "La thèse s'affaiblit sans être encore invalidée.",
      next_monitoring_focus: ["Réaction sur le plus bas de 17h00"],
      next_revalidation_time: "2026-07-13T17:30:00+02:00",
    },
    active_thesis_update: { status: "AT_RISK", health_score: 48 },
    status: "SAVED",
  }), "utf8");
  await writeFile(join(root, "desk_live_run_cursor", "livecur__2026-07-13__ny_open.json"), JSON.stringify({
    cursor_id: "livecur__2026-07-13__ny_open",
    schema_version: "2.0.0",
    strategy_id: "ny_open_1530",
    session: "ny_open",
    trading_date: "2026-07-13",
    run_id: "front_live_2026-07-13_ny_open",
    cursor_status: "LEASED",
    target_checkpoint: "2026-07-13T18:00:00+02:00",
    last_completed_checkpoint: "2026-07-13T17:15:00+02:00",
    attempt: {
      workflow: "LIVE_MASTER",
      checkpoint: "2026-07-13T16:30:00+02:00",
      status: "LEASED",
      attempt_count: 5,
      last_error: null,
    },
    updated_at_utc: "2026-07-13T16:01:00.000Z",
  }), "utf8");

  const day = await store.getStrategyDayDetail({ strategy_id: "ny_open_1530", date: "2026-07-13" });
  assert.equal(day.continuity.status, "RECOVERING");
  assert.equal(day.continuity.cursor_id, "livecur__2026-07-13__ny_open");
  assert.equal(day.continuity.pending_work_item, null);
  assert.equal(day.continuity.missing_checkpoint_count, 3);
  assert.deepEqual(
    day.timeline_events.filter((event) => event.entity_type === "gap").map((event) => event.timestamp_paris),
    ["2026-07-13T17:30:00+02:00", "2026-07-13T17:45:00+02:00", "2026-07-13T18:00:00+02:00"],
  );

  const monitorEvent = day.timeline_events.find((event) => event.entity_id === "monitor-1715");
  const detail = await store.getLiveTimelineEventDetail({
    strategy_id: "ny_open_1530",
    date: "2026-07-13",
    event_id: monitorEvent.event_id,
  });
  assert.deepEqual(detail.sections.map((section) => section.key), ["before", "observed", "market", "deduction", "decision", "next"]);
  assert.match(detail.sections.find((section) => section.key === "decision").summary, /s'affaiblit/);
  assert.ok(detail.sections.flatMap((section) => section.items).every((item) => typeof item.value === "string" && !item.value.trim().startsWith("{")));

  const gapEvent = day.timeline_events.find((event) => event.timestamp_paris === "2026-07-13T17:45:00+02:00");
  const gap = await store.getLiveTimelineEventDetail({ strategy_id: "ny_open_1530", date: "2026-07-13", event_id: gapEvent.event_id });
  assert.equal(gap.sections[0].key, "gap");
});

test("expired theses are not returned as active and can be archived", async () => {
  const { store, persistence } = await makeStore();
  const registry = createDeskToolRegistry(store);
  await seedMaster(store, "master_expired", asiaScope({ cutoff_paris: "2026-07-08T06:00:00+02:00" }));
  await store.saveActiveThesis({
    ...asiaScope({ cutoff_paris: "2026-07-08T06:00:00+02:00" }),
    thesis_id: "thesis_expired",
    linked_master_analysis_id: "master_expired",
    status: "THESIS_ACTIVE",
    session: "asia_open",
    instrument: "MNQ",
    direction: "long",
    dominant_scenario: "Expired thesis",
    confidence_pct: 60,
    health_score: 55,
    valid_from: "2026-07-08T06:00:00+02:00",
    valid_until: "2026-07-08T07:00:00+02:00",
    key_levels: [],
    wait_to_go_conditions: [],
    invalidation_conditions: [],
    expected_path: {},
    failure_path: {},
    scenario_transformation_map: [],
    monitoring_playbook: [],
  });

  const active = await callDeskTool(registry, "get_active_thesis", {
    ...asiaScope(),
    master_id: "master_expired",
    status: "active",
  });
  assert.equal(active.isError, false);
  assert.equal(active.structuredContent.active_thesis, null);

  const live = await callDeskTool(registry, "get_live_desk_state", {
    ...asiaScope(),
  });
  assert.equal(live.isError, false);
  assert.equal(live.structuredContent.desk_status, "EXPIRED");
  assert.equal(live.structuredContent.action_now.decision, "REPLAN_FULL");

  const archived = await callDeskTool(registry, "archive_expired_theses", {
    session: "asia_open",
  });
  assert.equal(archived.isError, false);
  assert.deepEqual(archived.structuredContent.archived_thesis_ids, ["thesis_expired"]);

  const stored = await persistence.getDocument(DESK_COLLECTIONS.deskActiveTheses, "thesis_expired");
  assert.equal(stored.status, "EXPIRED");
});

test("save_master_analysis materializes Master v4 setups for replay/front states", async () => {
  const { root, store, persistence } = await makeStore();
  await mkdir(join(root, "desk_packs"), { recursive: true });
  await writeFile(
    join(root, "desk_packs", "2026-07-08_asia_open.json"),
    JSON.stringify({
      pack_id: "2026-07-08_asia_open",
      date: "2026-07-08",
      session: "asia_open",
      timezone: "Europe/Paris",
      status: "ready",
      datasets: {},
      data_cutoff: { cutoff_paris: "2026-07-08T08:00:00+02:00" },
    }),
    "utf8",
  );

  const saved = await store.saveMasterAnalysis({
    ...asiaScope(),
    analysis_id: "master_v4_test",
    contract_name: "DeskMasterAnalysisContract",
    schema_version: "4.0.0",
    contract_hash: "hash",
    pack_id: "2026-07-08_asia_open",
    date: "2026-07-08",
    session: "asia_open",
    created_at_paris: "2026-07-08T08:00:00+02:00",
    full_analysis: {
      executive_summary: {
        primary_setup_id: "A",
        final_decision: "wait",
        final_instrument: "WAIT",
        final_direction: "wait",
      },
      setups: [
        {
          setup_id: "A",
          label: "Wait setup",
          instrument: "WAIT",
          direction: "wait",
          setup_type: "wait_only",
          risk_pct: 0,
          confidence_pct: 70,
        },
        {
          setup_id: "B",
          label: "Replayable setup",
          instrument: "MNQ",
          direction: "long",
          setup_type: "buy_stop_breakout",
          entry_zone: { from: 30100, to: 30120 },
          stop_loss: 30040,
          take_profits: [{ name: "TP1", target: 30220 }],
          risk_pct: 0.5,
          confidence_pct: 65,
          executable: true,
        },
      ],
    },
  });

  assert.equal(saved.ok, true);
  assert.equal(saved.setup_count, 2);

  const setups = await store.getDeskSetups({ analysis_id: "master_v4_test", limit: 10 });
  assert.equal(setups.count, 2);
  assert.equal(setups.setups.find((setup) => setup.setup_id === "A").replay_status, "wait");
  assert.equal(setups.setups.find((setup) => setup.setup_id === "B").replayable, true);
  assert.equal(setups.setups.find((setup) => setup.setup_id === "B").source_contract, "DeskMasterAnalysisContract");
});

test("run_feature_engine feeds deterministic feature collections and audit state", async () => {
  const { root, store, persistence } = await makeStore();
  await mkdir(join(root, "desk_packs"), { recursive: true });
  const rows = [
    "asset,timeframe,timestamp_utc,timestamp_paris,open,high,low,close,volume",
    "MNQ,5,2026-07-08T05:00:00+00:00,2026-07-08T07:00:00+02:00,100,105,98,103,100",
    "MNQ,5,2026-07-08T05:05:00+00:00,2026-07-08T07:05:00+02:00,103,108,101,107,100",
    "MNQ,5,2026-07-08T05:10:00+00:00,2026-07-08T07:10:00+02:00,107,109,99,101,100",
    "MNQ,5,2026-07-08T05:15:00+00:00,2026-07-08T07:15:00+02:00,101,112,100,111,100",
    "MNQ,5,2026-07-08T05:20:00+00:00,2026-07-08T07:20:00+02:00,111,113,104,106,100",
    "MNQ,5,2026-07-08T05:25:00+00:00,2026-07-08T07:25:00+02:00,106,116,105,115,100",
    "",
  ].join("\n");
  await writeFile(join(root, "MNQ_M5.csv"), rows, "utf8");
  await writeFile(join(root, "desk_packs", "2026-07-08_asia_open.json"), JSON.stringify({
    pack_id: "2026-07-08_asia_open",
    date: "2026-07-08",
    session: "asia_open",
    timezone: "Europe/Paris",
    status: "ready",
    datasets: {
      MNQ_M5: {
        storage_path: "local://MNQ_M5.csv",
        row_count: 6,
        format: "csv",
      },
    },
    data_cutoff: { cutoff_paris: "2026-07-08T07:25:00+02:00" },
  }), "utf8");
  await seedMaster(store, "master_feature_test", asiaScope({ cutoff_paris: "2026-07-08T07:00:00+02:00" }));
  await store.saveActiveThesis({
    ...asiaScope({ cutoff_paris: "2026-07-08T07:00:00+02:00" }),
    thesis_id: "thesis_feature_test",
    linked_master_analysis_id: "master_feature_test",
    status: "WAIT_MONITORED",
    session: "asia_open",
    instrument: "MNQ",
    direction: "long",
    dominant_scenario: "Feature test thesis",
    confidence_pct: 65,
    health_score: 70,
    valid_from: "2026-07-08T07:00:00+02:00",
    valid_until: "2026-07-08T08:30:00+02:00",
    key_levels: [],
    wait_to_go_conditions: [{ condition_id: "go_1", label: "close above 110", price: 110, operator: ">" }],
    invalidation_conditions: [{ condition_id: "inv_1", label: "close below 95", price: 95, operator: "<" }],
    expected_path: {},
    failure_path: {},
    scenario_transformation_map: [],
    monitoring_playbook: [],
  });

  const registry = createDeskToolRegistry(store);
  const run = await callDeskTool(registry, "run_feature_engine", {
    date: "2026-07-08",
    session: "asia_open",
    cutoff_paris: "2026-07-08T07:25:00+02:00",
    instruments: ["MNQ"],
  });
  assert.equal(run.isError, false);
  assert.equal(run.structuredContent.ok, true);
  assert.ok(run.structuredContent.instruments.MNQ.level_count > 0);
  assert.equal(run.structuredContent.condition_status, null);

  const levelMap = await persistence.getDocument(DESK_COLLECTIONS.deskLevelMaps, "2026-07-08_asia_open_MNQ_levels");
  assert.equal(levelMap.anti_lookahead_compliant, true);
  assert.ok(levelMap.levels[0].evidence);
  assert.ok(levelMap.levels[0].raw_data_refs);

  const audit = await callDeskTool(registry, "get_audit_state", {
    date: "2026-07-08",
    session: "asia_open",
  });
  assert.equal(audit.isError, false);
  assert.equal(audit.structuredContent.feature_engine.level_map.level_map.level_map_id, "2026-07-08_asia_open_MNQ_levels");
  assert.equal(audit.structuredContent.feature_engine.condition_status.condition_status, null);
  assert.equal(audit.structuredContent.feature_engine.session_snapshot.session_snapshot.snapshot_id, "2026-07-08_asia_open_MNQ_snapshot");
});

test("get_raw_window reads local pack candles with UTC and Paris bounds", async () => {
  const { root, store } = await makeStore();
  await mkdir(join(root, "desk_packs"), { recursive: true });
  await writeFile(join(root, "MES_M5.csv"), [
    "asset,timeframe,timestamp_utc,timestamp_paris,open,high,low,close,volume",
    "MES,5,2026-07-08T05:00:00+00:00,2026-07-08T07:00:00+02:00,5000,5004,4998,5002,10",
    "MES,5,2026-07-08T05:05:00+00:00,2026-07-08T07:05:00+02:00,5002,5008,5001,5007,10",
    "MES,5,2026-07-08T05:10:00+00:00,2026-07-08T07:10:00+02:00,5007,5010,5003,5004,10",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(root, "desk_packs", "2026-07-08_asia_open.json"), JSON.stringify({
    pack_id: "2026-07-08_asia_open",
    date: "2026-07-08",
    session: "asia_open",
    timezone: "Europe/Paris",
    status: "ready",
    datasets: {
      MES_M5: {
        storage_path: "local://MES_M5.csv",
        row_count: 3,
        format: "csv",
      },
    },
  }), "utf8");

  const registry = createDeskToolRegistry(store);
  const utc = await callDeskTool(registry, "get_raw_window", {
    ...asiaScope(),
    pack_id: "2026-07-08_asia_open",
    instrument: "MES",
    timeframe: "M5",
    from: "2026-07-08T05:00:00+00:00",
    to: "2026-07-08T05:05:00+00:00",
  });
  assert.equal(utc.isError, true);

  const paris = await callDeskTool(registry, "get_raw_window", {
    ...asiaScope(),
    pack_id: "2026-07-08_asia_open",
    instrument: "MES",
    timeframe: "M5",
    from: "2026-07-08T07:05:00+02:00",
    to: "2026-07-08T07:10:00+02:00",
  });
  assert.equal(paris.isError, true);

  const derived = await callDeskTool(registry, "get_raw_window", {
    ...asiaScope(),
    pack_id: "2026-07-08_asia_open",
    instrument: "MES",
    timeframe: "M15",
    from: "2026-07-08T07:00:00+02:00",
    to: "2026-07-08T07:15:00+02:00",
  });
  assert.equal(derived.isError, true);

  const missing = await callDeskTool(registry, "get_raw_window", {
    ...asiaScope(),
    pack_id: "2026-07-08_asia_open",
    instrument: "MNQ",
    timeframe: "M5",
    from: "2026-07-08T07:00:00+02:00",
    to: "2026-07-08T07:15:00+02:00",
  });
  assert.equal(missing.isError, true);
});

test("Master cutoff bundle 15:30 is cutoff-scoped and never falls back silently to Asia Open", async () => {
  const { root, store } = await makeStore();
  await mkdir(join(root, "desk_packs"), { recursive: true });
  await writeFile(join(root, "MNQ_M5.csv"), [
    "asset,timeframe,timestamp_utc,timestamp_paris,open,high,low,close,volume",
    "MNQ,5,2026-07-09T13:20:00+00:00,2026-07-09T15:20:00+02:00,100,101,99,100,10",
    "MNQ,5,2026-07-09T13:25:00+00:00,2026-07-09T15:25:00+02:00,100,102,99,101,10",
    "MNQ,5,2026-07-09T13:30:00+00:00,2026-07-09T15:30:00+02:00,101,103,100,102,10",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(root, "MES_M5.csv"), [
    "asset,timeframe,timestamp_utc,timestamp_paris,open,high,low,close,volume",
    "MES,5,2026-07-09T13:20:00+00:00,2026-07-09T15:20:00+02:00,5000,5001,4999,5000,10",
    "MES,5,2026-07-09T13:30:00+00:00,2026-07-09T15:30:00+02:00,5000,5003,4999,5002,10",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(root, "desk_packs", "2026-07-09_asia_open.json"), JSON.stringify({
    pack_id: "2026-07-09_asia_open",
    date: "2026-07-09",
    session: "asia_open",
    timezone: "Europe/Paris",
    status: "ready",
    datasets: {
      MNQ_M5: { storage_path: "local://MNQ_M5.csv", row_count: 3, format: "csv" },
      MES_M5: { storage_path: "local://MES_M5.csv", row_count: 2, format: "csv" },
    },
    data_cutoff: { cutoff_paris: "2026-07-09T00:05:00+02:00" },
  }), "utf8");

  const registry = createDeskToolRegistry(store);
  const legacy = await callDeskTool(registry, "get_master_analysis_bundle", {
    ...nyScope(),
    cutoff_paris: "2026-07-09T15:30:00+02:00",
    mode: "live",
  });
  assert.equal(legacy.isError, false);
  assert.equal(legacy.structuredContent.bundle_type, "master_cutoff");
  assert.equal(legacy.structuredContent.cutoff_paris, "2026-07-09T15:30:00+02:00");
  assert.equal(legacy.structuredContent.pack_or_source_context.status, "missing");
  assert.equal(legacy.structuredContent.pack_or_source_context.fallback, false);

  const prepared = await callDeskTool(registry, "prepare_master_cutoff_bundle_job", {
    ...nyScope(),
    cutoff_paris: "2026-07-09T15:30:00+02:00",
    mode: "live",
    save: true,
  });
  assert.equal(prepared.isError, false);
  assert.equal(prepared.structuredContent.bundle.bundle_id, "master_cutoff_bundle_2026_07_09_ny_open_1530_live");
  assert.equal(prepared.structuredContent.bundle.futures_core.MNQ_M5.status, "missing");
  assert.equal(prepared.structuredContent.bundle.futures_core.MES_M5.status, "missing");
  assert.equal(prepared.structuredContent.bundle.anti_lookahead_policy.fallback_used, false);

  const stored = await callDeskTool(registry, "get_master_cutoff_bundle", {
    ...nyScope(),
    cutoff_paris: "2026-07-09T15:30:00+02:00",
    mode: "live",
  });
  assert.equal(stored.isError, false);
  assert.equal(stored.structuredContent.bundle_id, prepared.structuredContent.bundle_id);
  assert.equal(stored.structuredContent.cutoff_paris, "2026-07-09T15:30:00+02:00");
});

test("live Master work completes only after the analysis and linked thesis are saved", async () => {
  const { root, store, persistence } = await makeStore();
  await mkdir(join(root, "desk_packs"), { recursive: true });
  await writeFile(join(root, "desk_packs", "2026-07-08_asia_open.json"), JSON.stringify({
    pack_id: "2026-07-08_asia_open",
    date: "2026-07-08",
    session: "asia_open",
    timezone: "Europe/Paris",
    status: "ready",
    datasets: {},
    data_cutoff: { cutoff_paris: "2026-07-08T08:00:00+02:00" },
  }), "utf8");
  const registry = createDeskToolRegistry(store);
  const prepared = await callDeskTool(registry, "prepare_master_cutoff_bundle_job", {
    ...asiaScope(),
    pack_id: "2026-07-08_asia_open",
    mode: "live",
    save: true,
  });
  assert.equal(prepared.isError, false, prepared.structuredContent.error);
  assert.equal(prepared.structuredContent.work_item, null);
  assert.equal(prepared.structuredContent.cursor_id, "livecur__2026-07-08__asia_open");
  assert.equal(persistence.count(DESK_COLLECTIONS.deskAgentWorkItems), 0);
  const cursorState = await store.getLiveRunCursor({ trading_date: "2026-07-08", session: "asia_open" });
  assert.equal(cursorState.cursor.attempt.workflow, "LIVE_MASTER");
  assert.equal(cursorState.cursor.cursor_status, "DUE");
  return;
});

test("cross asset delta never returns stale documents as valid deltas", async () => {
  const { root, store } = await makeStore();
  await mkdir(join(root, "desk_cross_asset_deltas"), { recursive: true });
  await writeFile(join(root, "desk_cross_asset_deltas", "old_delta.json"), JSON.stringify({
    delta_id: "old_delta",
    timestamp_paris: "2026-07-02T15:30:00+02:00",
    window: "1h",
    assets: { DXY: { row_count: 10 } },
  }), "utf8");
  const registry = createDeskToolRegistry(store);
  const result = await callDeskTool(registry, "get_cross_asset_delta", {
    timestamp_paris: "2026-07-09T15:30:00+02:00",
    window: "1h",
  });
  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.delta, null);
  assert.equal(result.structuredContent.status, "stale");
  assert.equal(result.structuredContent.stale_check.execution_allowed, false);
  assert.equal(result.structuredContent.stale_check.returned_timestamp_paris, "2026-07-02T15:30:00+02:00");
});

test("cross asset delta returns partial executable deltas when secondary assets are missing", async () => {
  const { root, store } = await makeStore();
  await mkdir(join(root, "desk_cross_asset_deltas"), { recursive: true });
  await writeFile(join(root, "desk_cross_asset_deltas", "partial_delta.json"), JSON.stringify({
    delta_id: "partial_delta",
    timestamp_paris: "2026-07-09T15:30:00+02:00",
    window: "1h",
    assets: {
      DXY: { row_count: 12, first_close: 100, last_close: 101 },
      CL: { row_count: 12, first_close: 68, last_close: 69 },
      GC: { row_count: 12, first_close: 3300, last_close: 3310 },
    },
  }), "utf8");
  const registry = createDeskToolRegistry(store);
  const result = await callDeskTool(registry, "get_cross_asset_delta", {
    timestamp_paris: "2026-07-09T15:30:00+02:00",
    window: "1h",
  });
  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.status, "partial");
  assert.equal(result.structuredContent.delta.quality.status, "partial");
  assert.equal(result.structuredContent.stale_check.execution_allowed, true);
  assert.deepEqual(result.structuredContent.stale_check.missing_assets, ["VIX", "US10Y", "US02Y"]);
});

test("manual M15 monitor prep job builds idempotent bundle and saves manual result", async () => {
  const { root, store, persistence } = await makeStore();
  await mkdir(join(root, "desk_packs"), { recursive: true });
  const m5Rows = [
    "asset,timeframe,timestamp_utc,timestamp_paris,open,high,low,close,volume",
    "MNQ,5,2026-07-08T05:00:00+00:00,2026-07-08T07:00:00+02:00,100,105,98,103,100",
    "MNQ,5,2026-07-08T05:05:00+00:00,2026-07-08T07:05:00+02:00,103,108,101,107,100",
    "MNQ,5,2026-07-08T05:10:00+00:00,2026-07-08T07:10:00+02:00,107,109,99,101,100",
    "MNQ,5,2026-07-08T05:15:00+00:00,2026-07-08T07:15:00+02:00,101,112,100,111,100",
    "",
  ].join("\n");
  const m15Rows = [
    "asset,timeframe,timestamp_utc,timestamp_paris,open,high,low,close,volume",
    "MNQ,15,2026-07-08T04:45:00+00:00,2026-07-08T06:45:00+02:00,95,101,94,100,100",
    "MNQ,15,2026-07-08T05:00:00+00:00,2026-07-08T07:00:00+02:00,100,108,98,107,100",
    "MNQ,15,2026-07-08T05:15:00+00:00,2026-07-08T07:15:00+02:00,107,112,100,111,100",
    "",
  ].join("\n");
  await writeFile(join(root, "MNQ_M5.csv"), m5Rows, "utf8");
  await writeFile(join(root, "MNQ_M15.csv"), m15Rows, "utf8");
  await writeFile(join(root, "desk_packs", "2026-07-08_asia_open.json"), JSON.stringify({
    pack_id: "2026-07-08_asia_open",
    date: "2026-07-08",
    session: "asia_open",
    timezone: "Europe/Paris",
    status: "ready",
    datasets: {
      MNQ_M5: { storage_path: "local://MNQ_M5.csv", row_count: 4, format: "csv" },
      MNQ_M15: { storage_path: "local://MNQ_M15.csv", row_count: 3, format: "csv" },
    },
    data_cutoff: { cutoff_paris: "2026-07-08T07:15:00+02:00" },
  }), "utf8");
  await seedMaster(store, "master_manual_m15", asiaScope({ cutoff_paris: "2026-07-08T07:00:00+02:00" }));
  await store.saveActiveThesis({
    ...asiaScope({ cutoff_paris: "2026-07-08T07:00:00+02:00" }),
    thesis_id: "thesis_manual_m15",
    linked_master_analysis_id: "master_manual_m15",
    status: "WAIT_MONITORED",
    session: "asia_open",
    instrument: "MNQ",
    direction: "long",
    dominant_scenario: "Manual M15 thesis",
    confidence_pct: 65,
    health_score: 70,
    valid_from: "2026-07-08T07:00:00+02:00",
    valid_until: "2026-07-08T12:00:00+02:00",
    key_levels: [],
    wait_to_go_conditions: [],
    invalidation_conditions: [],
    expected_path: {},
    failure_path: {},
    scenario_transformation_map: [],
    monitoring_playbook: [],
  });

  const registry = createDeskToolRegistry(store);
  const prepared = await callDeskTool(registry, "prepare_m15_monitor_bundle_job", {
    ...asiaScope({ cutoff_paris: "2026-07-08T07:15:00+02:00" }),
    master_id: "master_manual_m15",
    timestamp_paris: "2026-07-08T07:15:00+02:00",
    thesis_id: "thesis_manual_m15",
    mode: "live",
  });
  assert.equal(prepared.isError, false);
  assert.equal(prepared.structuredContent.status, "STALE", JSON.stringify(prepared.structuredContent));
  assert.equal(prepared.structuredContent.feature_engine.status, "DONE");
  assert.equal(prepared.structuredContent.feature_engine.condition_status_id, "thesis_manual_m15_2026_07_08T07_15_00_02_00");
  assert.equal(prepared.structuredContent.bundle.policy.chatgpt_decides_on_go_monitor, true);
  assert.equal(prepared.structuredContent.bundle.policy.automatic_openai_api_decision, false);
  assert.equal(prepared.structuredContent.bundle.contract_context.contract_name, "DeskHourlyThesisMonitorContract");
  assert.equal(prepared.structuredContent.bundle.contract_context.schema_version, "1.0.0");
  assert.equal(prepared.structuredContent.bundle.contract_context.pinned_for_replay, false);
  assert.equal(prepared.structuredContent.bundle.contract_handshake.direct_mcp_save_required, true);
  assert.equal(prepared.structuredContent.bundle.contract_handshake.operator_json_handoff_allowed, false);
  assert.equal(prepared.structuredContent.bundle.contract_handshake.missing_mcp_action, "stop_with_mcp_required");
  assert.equal(prepared.structuredContent.bundle.save_target.suggested_payload.contract_hash, prepared.structuredContent.bundle.contract_context.contract_hash);
  assert.equal(prepared.structuredContent.bundle.save_target.suggested_payload.status, "SAVED");
  assert.equal(prepared.structuredContent.bundle.data_quality.execution_allowed, true);
  assert.equal(prepared.structuredContent.bundle.data_quality.blockers.includes("rolling_15m_critical_market_missing"), false);
  assert.equal(prepared.structuredContent.bundle.rolling_15m_snapshot.instruments.MNQ.row_count, 4);
  assert.equal(prepared.structuredContent.bundle.rolling_15m_snapshot.instruments.MNQ.open, 100);
  assert.equal(prepared.structuredContent.bundle.rolling_15m_snapshot.instruments.MNQ.close, 111);
  assert.equal(prepared.structuredContent.bundle.raw_refs.includes("local://MNQ_M5.csv"), false);
  assert.equal(prepared.structuredContent.work_item, null);
  assert.equal(prepared.structuredContent.cursor_id, "livecur__2026-07-08__asia_open");
  assert.equal(persistence.count(DESK_COLLECTIONS.deskAgentWorkItems), 0);
  const cursorState = await store.getLiveRunCursor({ trading_date: "2026-07-08", session: "asia_open" });
  assert.equal(cursorState.cursor.attempt.workflow, "LIVE_M15_MONITOR");
  assert.equal(cursorState.cursor.cursor_status, "DUE");
  return;
});

test("backtest runner creates steps, simulated trades, results, and replay state", async () => {
  const { root, store, persistence } = await makeStore();
  await mkdir(join(root, "desk_packs"), { recursive: true });
  await writeFile(join(root, "MES_M5.csv"), [
    "asset,timeframe,timestamp_utc,timestamp_paris,open,high,low,close,volume",
    "MES,5,2026-07-08T05:00:00+00:00,2026-07-08T07:00:00+02:00,5000,5001,4999,5000,10",
    "MES,5,2026-07-08T05:05:00+00:00,2026-07-08T07:05:00+02:00,5000,5003,4999,5002,10",
    "MES,5,2026-07-08T05:10:00+00:00,2026-07-08T07:10:00+02:00,5002,5012,5001,5011,10",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(root, "desk_packs", "2026-07-08_asia_open.json"), JSON.stringify({
    pack_id: "2026-07-08_asia_open",
    date: "2026-07-08",
    session: "asia_open",
    timezone: "Europe/Paris",
    status: "ready",
    datasets: {
      MES_M5: {
        storage_path: "local://MES_M5.csv",
        row_count: 3,
        format: "csv",
      },
    },
    data_cutoff: { cutoff_paris: "2026-07-08T07:00:00+02:00" },
  }), "utf8");
  const feedCollection = `${DESK_COLLECTIONS.marketFeeds}/prod__tradingview__MES1!__5/${DESK_COLLECTIONS.marketFeedCandles}`;
  for (const [index, candle] of [
    { timestamp_utc: "2026-07-08T05:00:00.000Z", timestamp_paris: "2026-07-08T07:00:00+02:00", open: 5000, high: 5001, low: 4999, close: 5000, volume: 10 },
    { timestamp_utc: "2026-07-08T05:05:00.000Z", timestamp_paris: "2026-07-08T07:05:00+02:00", open: 5000, high: 5003, low: 4999, close: 5002, volume: 10 },
    { timestamp_utc: "2026-07-08T05:10:00.000Z", timestamp_paris: "2026-07-08T07:10:00+02:00", open: 5002, high: 5012, low: 5001, close: 5011, volume: 10 },
  ].entries()) {
    persistence.seed(feedCollection, `mes-m5-${index}`, { asset: "MES", timeframe: "5", ...candle });
  }
  await store.saveMasterAnalysis({
    ...asiaScope({ cutoff_paris: "2026-07-08T07:00:00+02:00" }),
    analysis_id: "master_backtest_test",
    contract_name: "DeskMasterAnalysisContract",
    schema_version: "4.0.0",
    contract_hash: "hash",
    pack_id: "2026-07-08_asia_open",
    date: "2026-07-08",
    session: "asia_open",
    created_at_paris: "2026-07-08T07:00:00+02:00",
    full_analysis: {
      executive_summary: {
        primary_setup_id: "MES_LONG",
        final_decision: "prendre",
        final_instrument: "MES",
        final_direction: "long",
      },
      setups: [
        {
          setup_id: "MES_LONG",
          label: "MES long replay",
          instrument: "MES",
          direction: "long",
          setup_type: "buy_stop_breakout",
          entry_zone: { from: 5002, to: 5003 },
          stop_loss: 4996,
          take_profits: [{ name: "TP1", target: 5010 }],
          risk_pct: 0.5,
          confidence_pct: 68,
          executable: true,
        },
      ],
    },
  });

  const registry = createDeskToolRegistry(store);
  const created = await callDeskTool(registry, "create_backtest_run", {
    backtest_id: "bt_mes_local",
    date_from: "2026-07-08",
    date_to: "2026-07-08",
    session: "asia_open",
    instrument_mode: "MES",
  });
  assert.equal(created.isError, false);
  assert.equal(created.structuredContent.steps_created, 1);
  assert.equal(created.structuredContent.backtest.status, "QUEUED");

  const run = await callDeskTool(registry, "run_backtest_until_done", {
    backtest_id: "bt_mes_local",
  });
  assert.equal(run.isError, false);
  assert.equal(run.structuredContent.status, "DONE");
  assert.equal(run.structuredContent.steps_run, 1);
  assert.equal(run.structuredContent.result.trades, 1);
  assert.equal(run.structuredContent.result.total_r, 1);
  assert.equal(run.structuredContent.simulated_trades[0].status, "WIN");

  const timeline = await callDeskTool(registry, "get_backtest_timeline", {
    backtest_id: "bt_mes_local",
  });
  assert.equal(timeline.isError, false);
  assert.equal(timeline.structuredContent.timeline[0].status, "DONE");
  assert.equal(timeline.structuredContent.timeline[0].replay_status, "win");

  const results = await callDeskTool(registry, "get_backtest_results", {
    backtest_id: "bt_mes_local",
  });
  assert.equal(results.isError, false);
  assert.equal(results.structuredContent.result.backtest_id, "bt_mes_local");
  assert.equal(results.structuredContent.simulated_trades.length, 1);

  const replayState = await callDeskTool(registry, "get_replay_state", {
    backtest_id: "bt_mes_local",
  });
  assert.equal(replayState.isError, false);
  assert.equal(replayState.structuredContent.selected_backtest.backtest_id, "bt_mes_local");
  assert.equal(replayState.structuredContent.timeline.length, 1);
  assert.equal(replayState.structuredContent.simulated_trades.length, 1);
  assert.equal(replayState.structuredContent.summary_stats.total_r, 1);
});

test("orchestrated GPT replay stays run-scoped from Master bundle to monitor replan", async () => {
  const { root, store, persistence } = await makeStore();
  await mkdir(join(root, "desk_packs"), { recursive: true });
  await mkdir(join(root, "desk_setups"), { recursive: true });
  await mkdir(join(root, "desk_active_theses"), { recursive: true });
  await mkdir(join(root, "desk_manual_monitors"), { recursive: true });
  await writeFile(join(root, "desk_setups", "live_setup_should_not_load.json"), JSON.stringify({
    setup_record_id: "live_setup_should_not_load",
    setup_id: "LIVE",
    instrument: "MES",
    mode: "live",
  }), "utf8");
  await writeFile(join(root, "desk_active_theses", "live_thesis_should_not_load.json"), JSON.stringify({
    thesis_id: "live_thesis_should_not_load",
    status: "WAIT_MONITORED",
    session: "asia_open",
    instrument: "MES",
    direction: "short",
  }), "utf8");
  await writeFile(join(root, "desk_manual_monitors", "live_monitor_should_not_load.json"), JSON.stringify({
    monitor_id: "live_monitor_should_not_load",
    monitor_decision: { action: "WAIT_MORE" },
  }), "utf8");
  await writeFile(join(root, "MNQ_M5.csv"), [
    "asset,timeframe,timestamp_utc,timestamp_paris,open,high,low,close,volume",
    "MNQ,5,2026-07-08T05:00:00+00:00,2026-07-08T07:00:00+02:00,100,105,98,103,100",
    "MNQ,5,2026-07-08T05:05:00+00:00,2026-07-08T07:05:00+02:00,103,108,101,107,100",
    "MNQ,5,2026-07-08T05:10:00+00:00,2026-07-08T07:10:00+02:00,107,109,99,101,100",
    "MNQ,5,2026-07-08T05:15:00+00:00,2026-07-08T07:15:00+02:00,101,112,100,111,100",
    "MNQ,5,2026-07-08T05:20:00+00:00,2026-07-08T07:20:00+02:00,111,113,104,106,100",
    "MNQ,5,2026-07-08T05:25:00+00:00,2026-07-08T07:25:00+02:00,106,116,105,115,100",
    "MNQ,5,2026-07-08T05:40:00+00:00,2026-07-08T07:40:00+02:00,115,118,110,112,100",
    "MNQ,5,2026-07-08T06:00:00+00:00,2026-07-08T08:00:00+02:00,112,130,111,128,100",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(root, "MNQ_M15.csv"), [
    "asset,timeframe,timestamp_utc,timestamp_paris,open,high,low,close,volume",
    "MNQ,15,2026-07-08T04:45:00+00:00,2026-07-08T06:45:00+02:00,95,101,94,100,100",
    "MNQ,15,2026-07-08T05:00:00+00:00,2026-07-08T07:00:00+02:00,100,108,98,107,100",
    "MNQ,15,2026-07-08T05:15:00+00:00,2026-07-08T07:15:00+02:00,107,116,100,115,100",
    "MNQ,15,2026-07-08T05:30:00+00:00,2026-07-08T07:30:00+02:00,115,118,110,112,100",
    "MNQ,15,2026-07-08T06:00:00+00:00,2026-07-08T08:00:00+02:00,112,130,111,128,100",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(root, "desk_packs", "2026-07-08_asia_open.json"), JSON.stringify({
    pack_id: "2026-07-08_asia_open",
    date: "2026-07-08",
    session: "asia_open",
    timezone: "Europe/Paris",
    status: "ready",
    datasets: {
      MNQ_M5: { storage_path: "local://MNQ_M5.csv", row_count: 8, format: "csv" },
      MNQ_M15: { storage_path: "local://MNQ_M15.csv", row_count: 5, format: "csv" },
    },
    data_cutoff: { cutoff_paris: "2026-07-08T08:00:00+02:00" },
  }), "utf8");

  const registry = createDeskToolRegistry(store);
  const created = await callDeskTool(registry, "create_orchestrated_replay_day", {
    backtest_id: "replay_gpt_loop",
    date: "2026-07-08",
    session: "asia_open",
    initial_cutoff: "2026-07-08T07:10:00+02:00",
    end_time: "2026-07-08T07:45:00+02:00",
    cadence: "15m",
    instruments: ["MNQ"],
  });
  assert.equal(created.isError, true);
  assert.match(created.structuredContent.error, /pack_id|Required|SCOPE_REQUIRED/);
  assert.equal(persistence.count(DESK_COLLECTIONS.deskReplaySetups), 0);
  return;
});
