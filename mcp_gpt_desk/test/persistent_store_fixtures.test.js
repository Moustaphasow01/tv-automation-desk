import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { createTestDeskStore } from "./support/test-desk-store.js";
import { liveScope } from "./fixtures/live_scope.js";

test("PersistentDeskStore reads fixture packs and writes through memory persistence", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpt-desk-mcp-"));
  const projectRoot = root;
  const csvPath = join(projectRoot, "MNQ_M5.csv");
  const h4CsvPath = join(projectRoot, "MNQ_H4.csv");
  const macroPath = join(projectRoot, "macro_calendar.json");
  await writeFile(
    csvPath,
    [
      "asset,timeframe,timestamp_paris,open,high,low,close,volume,rsi_14,atr_14",
      "MNQ,5,2026-06-25T00:00:00+02:00,100,105,99,102,10,,",
      "MNQ,5,2026-06-25T00:05:00+02:00,102,106,101,104,11,55.5,3.2",
      "MNQ,5,2026-06-25T00:10:00+02:00,30090,30150,30080,30140,11,55.5,3.2",
      "MNQ,5,2026-06-25T00:15:00+02:00,30140,30145,30040,30050,11,55.5,3.2",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    h4CsvPath,
    [
      "asset,timeframe,timestamp_paris,open,high,low,close,volume,rsi_14,atr_14",
      "MNQ,240,2026-06-20T00:00:00+02:00,95,106,94,104,20,58.5,12.2",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    macroPath,
    JSON.stringify({
      source: "forexfactory",
      events: [
        { date: "2026-06-24", time_paris: "14:30", timestamp_paris: "2026-06-24T14:30:00+02:00", event: "Low event", impact: "low" },
        { date: "2026-06-25", time_paris: "14:30", timestamp_paris: "2026-06-25T14:30:00+02:00", event: "CPI", impact: "high" },
        { date: "2026-06-26", time_paris: "10:00", timestamp_paris: "2026-06-26T10:00:00+02:00", event: "PMI", impact: "medium" },
      ],
    }),
    "utf8",
  );
  await mkdir(join(root, "desk_packs"), { recursive: true });
  await writeFile(
    join(root, "desk_packs", "2026-06-25_asia_open.json"),
    JSON.stringify({
      pack_id: "2026-06-25_asia_open",
      date: "2026-06-25",
      session: "asia_open",
      timezone: "Europe/Paris",
      status: "ready",
      created_at: "2026-06-25T00:00:00+02:00",
      datasets: {
        MNQ_M5: {
          storage_path: "local://MNQ_M5.csv",
          row_count: 2,
          columns: ["asset", "timeframe", "timestamp_paris", "open", "high", "low", "close", "volume", "rsi_14", "atr_14"],
          timezone: "Europe/Paris",
          format: "csv",
        },
        MNQ_H4: {
          storage_path: "local://MNQ_H4.csv",
          row_count: 1,
          columns: ["asset", "timeframe", "timestamp_paris", "open", "high", "low", "close", "volume", "rsi_14", "atr_14"],
          timezone: "Europe/Paris",
          format: "csv",
        },
        macro_calendar: {
          storage_path: "local://macro_calendar.json",
          row_count: 3,
          columns: ["date", "time_paris", "timestamp_paris", "event", "impact"],
          timezone: "Europe/Paris",
          format: "json",
        },
      },
      summary: {
        key_levels: {
          MNQ: { session_high: 106, session_low: 99, rsi_m5: 55.5, atr_m5: 3.2, rsi_h4: 58.5, atr_h4: 12.2 },
        },
      },
      quality: { status: "ready" },
    }),
    "utf8",
  );
  await writeFile(
    join(root, "desk_packs", "2026-06-24_asia_open.json"),
    JSON.stringify({
      pack_id: "2026-06-24_asia_open",
      date: "2026-06-24",
      session: "asia_open",
      timezone: "Europe/Paris",
      status: "ready",
      datasets: {},
      summary: {},
      quality: { status: "ready", row_count_total: 123, missing_datasets: [] },
    }),
    "utf8",
  );

  const { store, persistence } = createTestDeskStore({ root, projectRoot });
  const latest = await store.getLatestAsiaOpenPack({ date: "2026-06-25" });
  assert.equal(latest.pack_id, "2026-06-25_asia_open");

  const exportsList = await store.listDeskPacks({
    date_from: "2026-06-24",
    date_to: "2026-06-25",
    status: "ready",
  });
  assert.equal(exportsList.count, 2);
  assert.deepEqual(exportsList.packs.map((pack) => pack.pack_id), [
    "2026-06-25_asia_open",
    "2026-06-24_asia_open",
  ]);

  const dataset = await store.getDataset({
    pack_id: latest.pack_id,
    dataset: "MNQ_M5",
    format: "json",
    max_rows: 1,
  });
  assert.equal(dataset.rows.length, 1);
  assert.equal(dataset.rows[0].close, 102);

  const h4Dataset = await store.getDataset({
    pack_id: latest.pack_id,
    dataset: "MNQ_H4",
    format: "json",
    max_rows: 5,
  });
  assert.equal(h4Dataset.rows[0].timeframe, 240);

  const levels = await store.getMarketLevels({ pack_id: latest.pack_id, instrument: "MNQ" });
  assert.equal(levels.rsi_m5, 55.5);
  assert.equal(levels.rsi_h4, 58.5);

  const macro = await store.getMacroCalendar({ pack_id: latest.pack_id, importance_min: "medium" });
  assert.deepEqual(macro.events.map((event) => event.event), ["CPI", "PMI"]);

  const saved = await store.saveDeskDecision({
    ...liveScope({ date: "2026-06-25", cutoff_paris: "2026-06-25T00:10:00+02:00", run_id: "local_store_run" }),
    decision_id: "decision_test",
    session: "asia_open",
    date: "2026-06-25",
    timezone: "Europe/Paris",
    instrument: "MNQ",
    asset_class: "futures",
    decision: "wait",
    direction: "wait",
    setup_type: "wait",
    confidence_pct: 50,
    risk_pct: 0,
    rr_minimum: 0,
    invalidation: "No setup",
    management_rules: [],
    time_rules: {},
    macro_bias: "neutral",
    technical_bias: "neutral",
    cross_asset_bias: "neutral",
    reason_summary: "Test decision",
    status: "draft",
  });
  assert.equal(saved.ok, true);

  await store.updateDeskDecisionStatus({ decision_id: "decision_test", status: "archived", updated_by: "test" });
  const decision = await persistence.getDocument(DESK_COLLECTIONS.deskDecisions, "decision_test");
  assert.equal(decision.status, "archived");
  assert.equal(decision.environment, "prod");
  assert.equal(decision.intake_status, "pending");
  assert.equal(decision.schema_version, "decision_v2");
  assert.equal(decision.decision_model, "single_decision_chain_v1");
  assert.equal(decision.source_role, "proposer");
  assert.equal(decision.source_type, "gpt");
  assert.equal(decision.canonical_decision.schema_version, "decision_v2");
  assert.equal(decision.canonical_decision.source_type, "gpt");

  const savedAnalysis = await store.saveDeskAnalysis({
    ...liveScope({ date: "2026-06-25", cutoff_paris: "2026-06-25T00:10:00+02:00", run_id: "local_store_run" }),
    schema_version: "1.1.0",
    contract_name: "DeskFuturesAnalysisContract",
    analysis_id: "analysis_test",
    created_at_paris: "2026-06-25T00:10:00+02:00",
    mode: "live",
    analysis_type: "asia_open",
    pack_id: "2026-06-25_asia_open",
    session: "asia_open",
    date: "2026-06-25",
    timezone: "Europe/Paris",
    title: "Asia Open executable analysis",
    status: "ready",
    scope: {
      market: "futures",
      allowed_instruments: ["MNQ", "NQ", "MES", "ES"],
      workflow: "asia_to_london",
    },
    source_pack: {
      pack_id: "2026-06-25_asia_open",
      source: "Desk_Futures_Data.get_latest_asia_open_pack",
      data_quality: { status: "ready" },
    },
    executive_summary: {
      summary: "WAIT first, then short MNQ on pullback.",
      final_decision: "prendre",
      final_instrument: "MNQ",
      final_direction: "short",
      primary_setup_id: "A",
    },
    context: { relative_strength: { mnq_vs_mes: "MNQ weaker than MES" } },
    market_funnel: {
      calendar_macro: { status: "pass", evidence: ["calendar loaded"] },
      mega_caps_semis: { status: "pass", evidence: ["mega caps checked"] },
      final_funnel_conclusion: { decision_bias: "short_conditionnel_mnq" },
    },
    levels: { MNQ: { latest_close: 30080.25 } },
    strategic_brief: { desk_bias: "short_conditionnel_mnq" },
    decision_gates: {
      data_quality_gate: { status: "pass", hard_gate: true },
      market_funnel_gate: { status: "pass", hard_gate: true },
      final_gate: { status: "conditional_pass", fallback_decision: "wait" },
    },
    setups: [
      {
        setup_id: "A",
        label: "Short MNQ pullback",
        instrument: "MNQ",
        direction: "short",
        setup_type: "sell_limit_pullback",
        order_type: "sell_limit",
        status: "active",
        priority: 1,
        entry_zone: { from: 30140, to: 30170 },
        stop_loss: 30235,
        take_profits: [{ name: "TP1", target: { from: 30020, to: 30050 } }],
        invalidation: { type: "m15_close_above", level: 30235, text: "M15 close above 30235" },
        risk_pct: 0.5,
        confidence_pct: 67,
        reason: "Weak MNQ, sell only a rebound.",
        executable: true,
      },
      {
        setup_id: "B",
        label: "Short breakdown MNQ",
        instrument: "MNQ",
        direction: "short",
        setup_type: "sell_stop_breakdown_retest",
        order_type: "sell_stop_or_retest",
        entry_trigger: { type: "break_and_retest", level: 29935 },
        invalidation: { type: "m5_reclaim_above", level: 30040, text: "Reintegration above 30040" },
        risk_pct: 0.5,
        confidence_pct: 61,
        reason: "Alternative momentum continuation.",
      },
    ],
    executable_decision: {
      decision_id: "decision_from_analysis",
      pack_id: "2026-06-25_asia_open",
      session: "asia_open",
      date: "2026-06-25",
      instrument: "MNQ",
      decision: "prendre",
      direction: "short",
      setup_id: "A",
      setup_type: "sell_limit_pullback",
      order_type: "sell_limit",
      confidence_pct: 67,
      risk_pct: 0.5,
      rr_minimum: 2,
      entry_zone: { from: 30140, to: 30170 },
      stop_loss: 30235,
      take_profits: { tp1: { from: 30020, to: 30050 } },
      invalidation: "M15 close above 30235",
      reason_summary: "Primary setup from analysis.",
    },
    session_matrix: [
      { day: "Jeu. 25/06", start: "00:00", end: "00:45", status: "orange", new_entries_allowed: false },
    ],
    authorized_windows_summary: [
      { day: "Jeu. 25/06", windows: ["00:45 - 02:00"], rule: "Only clean setup." },
    ],
    update_agenda: [
      { day: "Jeu. 25/06", time: "00:45", update_type: "Validation de continuation" },
    ],
    risk_management: { max_risk_pct_session: 1.0 },
    monitoring_rules: { if_trade_triggered: ["Move BE"] },
    final_sections: {
      decision_executable: "WAIT then short MNQ on pullback.",
      regle_finale: "On vend le rebond MNQ.",
    },
  });
  assert.equal(savedAnalysis.ok, true);
  assert.equal(savedAnalysis.decision_id, "decision_from_analysis");
  assert.deepEqual(savedAnalysis.setup_ids, ["analysis_test_A", "analysis_test_B"]);

  const analysis = await persistence.getDocument(DESK_COLLECTIONS.deskAnalyses, "analysis_test");
  assert.equal(analysis.setup_count, 2);
  assert.equal(analysis.decision_id, "decision_from_analysis");
  assert.deepEqual(analysis.setup_ids, ["analysis_test_A", "analysis_test_B"]);

  const primarySetup = await persistence.getDocument(DESK_COLLECTIONS.deskSetups, "analysis_test_A");
  assert.equal(primarySetup.analysis_id, "analysis_test");
  assert.equal(primarySetup.decision_id, "decision_from_analysis");
  assert.equal(primarySetup.pack_id, "2026-06-25_asia_open");
  assert.equal(primarySetup.is_primary, true);
  assert.equal(primarySetup.replay_status, "pending");

  const secondarySetup = await persistence.getDocument(DESK_COLLECTIONS.deskSetups, "analysis_test_B");
  assert.equal(secondarySetup.is_primary, false);
  assert.equal(secondarySetup.lifecycle_status, "draft");

  const setupList = await store.getDeskSetups({ pack_id: "2026-06-25_asia_open", primary_only: true });
  assert.equal(setupList.ok, true);
  assert.equal(setupList.count, 1);
  assert.equal(setupList.setups[0].setup_record_id, "analysis_test_A");

  await assert.rejects(
    store.replayDeskSetups({ setup_record_id: "analysis_test_A" }),
    (error) => error.code === "READ_ONLY_REPLAY_FORBIDDEN",
  );

  const linkedDecision = await persistence.getDocument(DESK_COLLECTIONS.deskDecisions, "decision_from_analysis");
  assert.equal(linkedDecision.analysis_id, "analysis_test");
  assert.equal(linkedDecision.take_profits.tp1.from, 30020);
  assert.equal(linkedDecision.decision_model, "single_decision_chain_v1");
  assert.equal(linkedDecision.canonical_decision.source_ref, "analysis_test");
  assert.equal(linkedDecision.canonical_decision.source_type, "gpt");
});
