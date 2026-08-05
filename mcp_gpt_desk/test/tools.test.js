import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createTestDeskStore } from "./support/test-desk-store.js";
import { callDeskTool, createDeskToolRegistry, listDeskTools } from "../src/tools.js";
import { validDecisionAudit } from "./fixtures/decision_audit_payloads.js";
import { liveScope } from "./fixtures/live_scope.js";
import {
  makeActiveLiveMasterSave,
  makeActiveLiveMonitorSave,
} from "./support/active-strategy-save-fixtures.js";

test("desk_ping is exposed and returns the ChatGPT connection contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpt-desk-mcp-tools-"));
  const store = createTestDeskStore({ root, projectRoot: root }).store;
  const registry = createDeskToolRegistry(store);

  const tools = listDeskTools(registry);
  const pingTool = tools.find((tool) => tool.name === "desk_ping");

  assert.ok(pingTool);
  assert.deepEqual(pingTool.inputSchema, {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  });

  const result = await callDeskTool(registry, "desk_ping", {});

  assert.deepEqual(result.structuredContent, {
    ok: true,
    message: "OK",
    server: "tv-automation-desk-mcp",
    version: "0.1.1",
  });
  assert.equal(result.content[0].text, "OK");
  assert.equal(result.isError, false);
});

test("vNext contract tools expose bundled active contracts", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpt-desk-mcp-tools-"));
  const store = createTestDeskStore({ root, projectRoot: root }).store;
  const registry = createDeskToolRegistry(store);

  const active = await callDeskTool(registry, "get_active_contracts", {});
  assert.equal(active.isError, false);
  assert.equal(active.structuredContent.master_contract.contract_name, "DeskMasterAnalysisContract");
  assert.equal(active.structuredContent.master_contract.schema_version, "5.4.0");
  assert.match(active.structuredContent.master_contract.content_markdown, /DeskMasterAnalysisContract.*v5\.4\.0/);
  assert.equal(active.structuredContent.monitor_contract.contract_name, "DeskHourlyThesisMonitorContract");
  assert.equal(active.structuredContent.monitor_contract.schema_version, "2.4.0");
  assert.equal(active.structuredContent.execution_plan_contract.schema_version, "1.4.0");
  assert.equal(active.structuredContent.monitor_command_contract.schema_version, "1.4.0");
  assert.equal(active.structuredContent.condition_catalog_contract.schema_version, "1.2.0");
  assert.equal(active.structuredContent.execution_policy_contract.schema_version, "4.3.0");
  assert.equal(active.structuredContent.front_projection_contract.contract_name, "DeskFrontProjectionContract");
  assert.equal(active.structuredContent.front_projection_contract.schema_version, "1.0.0");

  const summary = await callDeskTool(registry, "get_active_contracts", { view: "summary" });
  assert.equal(summary.isError, false);
  assert.equal(summary.structuredContent.view, "summary");
  assert.equal(summary.structuredContent.master_contract.content_markdown, undefined);
  assert.equal(summary.structuredContent.master_contract.contract_hash.length, 64);
  assert.equal(summary.structuredContent.master_contract.full_read.tool, "get_contract");
  assert.equal(summary.structuredContent.front_projection_contract.full_read.tool, "get_contract");
  assert.ok(summary._meta["desk/transport"].structured_bytes < active._meta["desk/transport"].structured_bytes);

  const versions = await callDeskTool(registry, "list_contract_versions", {
    contract_name: "DeskMasterAnalysisContract",
  });
  assert.equal(versions.isError, false);
  assert.equal(versions.structuredContent.versions[0].contract_id, "DeskMasterAnalysisContract_v5_4_0");
  assert.ok(versions.structuredContent.versions.some((item) => item.contract_id === "DeskMasterAnalysisContract_v5_1_0"));
  assert.ok(versions.structuredContent.versions.some((item) => item.contract_id === "DeskMasterAnalysisContract_v5_0_0"));
  assert.ok(versions.structuredContent.versions.some((item) => item.contract_id === "DeskMasterAnalysisContract_v4_0_0"));
});

test("vNext write tools persist thesis and monitor", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpt-desk-mcp-tools-"));
  const store = createTestDeskStore({ root, projectRoot: root }).store;
  const registry = createDeskToolRegistry(store);
  const scope = liveScope({ date: "2026-07-02", cutoff_paris: "2026-07-02T01:00:00+02:00" });
  await store.saveMasterAnalysis(makeActiveLiveMasterSave({
    scope,
    analysisId: "master_test",
    thesisId: "thesis_master_test_seed",
    planId: "plan_master_test",
  }));

  const thesis = await callDeskTool(registry, "save_active_thesis", {
    ...scope,
    thesis_id: "thesis_test",
    linked_master_analysis_id: "master_test",
    status: "THESIS_ACTIVE",
    instrument: "MNQ",
    direction: "short",
    dominant_scenario: "MNQ weak pullback rejection",
    confidence_pct: 67,
    health_score: 75,
    valid_from: "2026-07-02T00:05:00+02:00",
    key_levels: [],
    wait_to_go_conditions: [],
    invalidation_conditions: [],
    expected_path: {},
    failure_path: {},
    scenario_transformation_map: [],
    monitoring_playbook: [],
    decision_audit: validDecisionAudit({
      decision_id: "decision_thesis_test",
      source_pack_id: "2026-07-02_asia_open",
    }),
  });
  assert.equal(thesis.isError, false);
  assert.equal(thesis.structuredContent.thesis_id, "thesis_test");

  const monitor = await callDeskTool(registry, "save_manual_monitor", makeActiveLiveMonitorSave({
    scope,
    monitorId: "monitor_test",
    masterId: "master_test",
    thesisId: "thesis_test",
    planId: "plan_master_test",
    expectedRevision: 0,
  }));
  assert.equal(monitor.isError, false);
  assert.equal(monitor.structuredContent.monitor_id, "monitor_test");

  const active = await callDeskTool(registry, "get_active_thesis", {
    ...scope,
    master_id: "master_test",
    session: "asia_open",
    status: "any",
  });
  assert.equal(active.isError, false);
  assert.equal(active.structuredContent.active_thesis.thesis_id, "thesis_test");
});

test("get_desk_setups exposes materialized analysis setups", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpt-desk-mcp-tools-"));
  await writeFile(
    join(root, "MNQ_M5.csv"),
    [
      "asset,timeframe,timestamp_paris,open,high,low,close,volume",
      "MNQ,5,2026-07-02T00:05:00+02:00,30090,30150,30080,30145,10",
      "MNQ,5,2026-07-02T00:10:00+02:00,30145,30155,30040,30050,10",
      "",
    ].join("\n"),
    "utf8",
  );
  await mkdir(join(root, "desk_packs"), { recursive: true });
  await writeFile(
    join(root, "desk_packs", "2026-07-02_asia_open.json"),
    JSON.stringify({
      pack_id: "2026-07-02_asia_open",
      date: "2026-07-02",
      session: "asia_open",
      timezone: "Europe/Paris",
      status: "ready",
      datasets: {
        MNQ_M5: {
          storage_path: "local://MNQ_M5.csv",
          row_count: 2,
          format: "csv",
        },
      },
      data_cutoff: { cutoff_paris: "2026-07-02T00:05:00+02:00" },
    }),
    "utf8",
  );
  const store = createTestDeskStore({ root, projectRoot: root }).store;
  const registry = createDeskToolRegistry(store);

  await store.saveDeskAnalysis({
    ...liveScope({ date: "2026-07-02", cutoff_paris: "2026-07-02T00:10:00+02:00" }),
    schema_version: "1.1.0",
    contract_name: "DeskFuturesAnalysisContract",
    analysis_id: "analysis_tool_test",
    created_at_paris: "2026-07-02T00:10:00+02:00",
    mode: "live",
    analysis_type: "asia_open",
    pack_id: "2026-07-02_asia_open",
    session: "asia_open",
    date: "2026-07-02",
    timezone: "Europe/Paris",
    title: "Tool setup listing",
    scope: {},
    source_pack: {},
    executive_summary: {
      summary: "WAIT then conditional short.",
      final_decision: "prendre",
      final_instrument: "MNQ",
      final_direction: "short",
      primary_setup_id: "A",
    },
    context: {},
    market_funnel: {},
    levels: {},
    strategic_brief: {},
    decision_gates: {},
    setups: [
      {
        setup_id: "A",
        label: "Primary",
        instrument: "MNQ",
        direction: "short",
        setup_type: "sell_limit_pullback",
        entry_zone: { from: 30140, to: 30170 },
        stop_loss: 30235,
        take_profits: [{ name: "TP1", target: { from: 30020, to: 30050 } }],
        invalidation: "M15 close above invalidation",
        risk_pct: 0.5,
        confidence_pct: 67,
        reason: "Primary setup.",
        executable: true,
      },
      {
        setup_id: "B",
        label: "Secondary",
        instrument: "MNQ",
        direction: "short",
        setup_type: "breakdown",
        invalidation: "Reclaim invalidation",
        risk_pct: 0.5,
        confidence_pct: 61,
        reason: "Secondary setup.",
      },
    ],
    executable_decision: {
      decision_id: "decision_tool_test",
      session: "asia_open",
      date: "2026-07-02",
      instrument: "MNQ",
      decision: "prendre",
      direction: "short",
      setup_type: "sell_limit_pullback",
      confidence_pct: 67,
      risk_pct: 0.5,
      rr_minimum: 2,
      invalidation: "M15 close above invalidation",
      reason_summary: "Primary setup.",
      decision_audit: validDecisionAudit({
        decision_id: "decision_tool_test",
        source_pack_id: "2026-07-02_asia_open",
      }),
    },
    session_matrix: [{}],
    authorized_windows_summary: [{}],
    update_agenda: [{}],
    risk_management: {},
    monitoring_rules: {},
    final_sections: {
      decision_executable: "Conditional short.",
      regle_finale: "Respect hard gates.",
    },
  });

  const result = await callDeskTool(registry, "get_desk_setups", {
    pack_id: "2026-07-02_asia_open",
    primary_only: true,
  });

  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.count, 1);
  assert.equal(result.structuredContent.setups[0].setup_record_id, "analysis_tool_test_A");
  assert.equal(result.structuredContent.setups[0].is_primary, true);

  const replay = await callDeskTool(registry, "replay_desk_setups", {
    setup_record_id: "analysis_tool_test_A",
  });
  assert.equal(replay.isError, true);
  assert.match(replay.structuredContent.error, /READ_ONLY_REPLAY_FORBIDDEN/);
});
