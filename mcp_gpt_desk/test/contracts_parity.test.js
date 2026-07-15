import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  analysisSchema,
  decisionSchema,
  setupSchema,
} from "../src/schemas.js";
import { callDeskTool, createDeskToolRegistry, listDeskTools } from "../src/tools.js";
import { createTestDeskStore } from "./support/test-desk-store.js";
import {
  legacyAnalysisSchema,
  legacyDecisionSchema,
  legacySetupSchema,
} from "./fixtures/legacy_behavioral_schemas.js";
import { validDecisionAudit } from "./fixtures/decision_audit_payloads.js";

function parseOutcome(schema, payload) {
  try {
    return { ok: true, value: schema.parse(payload) };
  } catch (error) {
    return { ok: false, issues: error.issues?.map((issue) => issue.message) || [String(error)] };
  }
}

function assertSameBehavior(name, legacySchema, currentSchema, payload) {
  const legacy = parseOutcome(legacySchema, payload);
  const current = parseOutcome(currentSchema, payload);
  assert.equal(current.ok, legacy.ok, `${name} accept/reject changed`);
  if (legacy.ok) {
    assert.deepEqual(current.value, legacy.value, `${name} parsed output changed`);
  }
}

const waitDecisionPayload = {
  session: "asia_open",
  date: "2026-07-03",
  instrument: "WAIT",
  decision: "wait",
  direction: "wait",
  setup_type: "wait",
  confidence_pct: 78,
  risk_pct: 0,
  rr_minimum: 0,
  invalidation: "No valid setup",
  reason_summary: "WAIT proof accepted.",
  decision_audit: validDecisionAudit({
    decision_timestamp_paris: "2026-07-03T00:10:00+02:00",
    data_cutoff_paris: "2026-07-03T00:10:00+02:00",
    available_data_until: "2026-07-03T00:10:00+02:00",
    source_pack_id: "2026-07-03_asia_open",
  }),
  extra_runtime_field: "kept_by_passthrough",
};

function analysisPayload() {
  return {
    schema_version: "1.1.0",
    contract_name: "DeskFuturesAnalysisContract",
    analysis_id: "analysis_parity_test",
    created_at_paris: "2026-07-03T00:10:00+02:00",
    analysis_type: "asia_open",
    pack_id: "2026-07-03_asia_open",
    session: "asia_open",
    date: "2026-07-03",
    timezone: "Europe/Paris",
    title: "Parity analysis",
    scope: {},
    source_pack: {},
    executive_summary: {
      summary: "Derived summary must be copied by transform.",
      final_decision: "wait",
      final_instrument: "WAIT",
      final_direction: "wait",
      primary_setup_id: "WAIT_A",
    },
    context: {},
    market_funnel: {},
    levels: {},
    strategic_brief: {},
    decision_gates: {},
    setups: [
      {
        setup_id: "WAIT_A",
        label: "Wait only",
        instrument: "WAIT",
        direction: "wait",
        setup_type: "wait_only",
        invalidation: "No trigger",
        risk_pct: 0,
        confidence_pct: 78,
        reason: "No executable setup.",
        custom_passthrough: { kept: true },
      },
    ],
    executable_decision: waitDecisionPayload,
    session_matrix: [{ status: "orange" }],
    authorized_windows_summary: [{ windows: [] }],
    update_agenda: [{ time: "none" }],
    risk_management: {},
    monitoring_rules: {},
    final_sections: {
      decision_executable: "WAIT.",
      regle_finale: "No trade without full gates.",
    },
  };
}

test("contract validators keep legacy behavior for defaults, passthrough and rejects", () => {
  assertSameBehavior("decision wait payload", legacyDecisionSchema, decisionSchema, waitDecisionPayload);
  assertSameBehavior("setup passthrough payload", legacySetupSchema, setupSchema, analysisPayload().setups[0]);

  assert.equal(parseOutcome(decisionSchema, { ...waitDecisionPayload, decision_audit: undefined }).ok, false);

  const invalidInstrument = { ...waitDecisionPayload, instrument: "BTC" };
  assertSameBehavior("decision invalid instrument", legacyDecisionSchema, decisionSchema, invalidInstrument);
});

test("analysis validator keeps legacy transform behavior", () => {
  const payload = analysisPayload();
  const legacy = legacyAnalysisSchema.parse(payload);
  const current = analysisSchema.parse(payload);

  assert.deepEqual(current, legacy);
  assert.equal(current.summary, payload.executive_summary.summary);
  assert.equal(current.primary_setup_id, "WAIT_A");
  assert.equal(current.final_decision, "wait");
  assert.equal(current.final_instrument, "WAIT");
  assert.equal(current.final_direction, "wait");
  assert.deepEqual(current.setups[0].custom_passthrough, { kept: true });
});

test("tool input schemas stay byte-for-byte compatible except intentional M7.3 audit gate", async () => {
  const legacy = JSON.parse(await readFile(new URL("./fixtures/tool_input_schemas.legacy.json", import.meta.url), "utf8"));
  const store = createTestDeskStore({ root: "/tmp/mcp-tool-parity", projectRoot: "/tmp/mcp-tool-parity" }).store;
  const current = Object.fromEntries(
    listDeskTools(createDeskToolRegistry(store)).map((tool) => [tool.name, tool.inputSchema]),
  );

  const changedByAuditGate = new Set(["save_desk_analysis", "save_desk_decision"]);
  const changedByStorageSplit = new Set(["save_active_thesis", "update_active_thesis"]);
  const changedByM15ManualMonitor = new Set(["get_cross_asset_delta", "get_master_analysis_bundle", "save_contract"]);
  const changedByMcpTransportV2 = new Set(["get_active_contracts"]);
  const changedByFrontProjectionContract = new Set([
    "activate_contract_version",
    "archive_contract_version",
    "get_contract",
    "list_contract_versions",
  ]);
  const changedByStrictScopeV2 = new Set([
    "get_active_thesis",
    "get_dataset",
    "get_desk_pack",
    "get_latest_hourly_monitor",
    "get_latest_master_analysis",
    "get_macro_calendar",
    "get_monitor_context_bundle",
    "get_news_digest",
    "get_raw_window",
    "save_hourly_monitor",
    "save_master_analysis",
    "save_monitor_alert",
    "save_context_transmission",
    "save_monitor_context_transmission",
    "update_position_management",
  ]);
  const addedFrontReadyTools = new Set([
    "archive_expired_theses",
    "advance_replay_clock",
    "apply_replay_monitor_result",
    "claim_next_desk_work",
    "claim_next_live",
    "claim_next_replay",
    "complete_live",
    "complete_replay",
    "complete_desk_work",
    "cancel_backtest_run",
    "cancel_desk_job",
    "create_orchestrated_replay_day",
    "create_backtest_run",
    "create_desk_job",
    "get_audit_state",
    "get_backtest_results",
    "get_backtest_run",
    "get_backtest_timeline",
    "get_desk_job",
    "get_desk_work_item",
    "get_front_master_state",
    "get_front_monitor_state",
    "get_live_desk_state",
    "get_live_timeline_event_detail",
    "get_manual_monitor_bundle",
    "get_master_cutoff_bundle",
    "get_nyopen_strategy_state",
    "get_replay_master_bundle",
    "get_replay_monitor_bundle",
    "get_replay_bundle_manifest",
    "get_replay_bundle_section",
    "get_replay_snapshot",
    "get_replay_state",
    "get_replay_timeline",
    "get_strategy_calendar",
    "get_strategy_day_detail",
    "get_strategy_performance",
    "heartbeat_live",
    "heartbeat_replay",
    "heartbeat_desk_work",
    "list_backtest_runs",
    "list_desk_jobs",
    "mark_nyopen_strategy_event",
    "peek_next_desk_work",
    "prepare_m15_monitor_bundle_job",
    "prepare_due_live_m15_bundle_job",
    "prepare_due_live_master_bundle_job",
    "prepare_master_cutoff_bundle_job",
    "prepare_nyopen_master_bundle",
    "prepare_replay_master_bundle",
    "prepare_replay_monitor_bundle",
    "prepare_replay_monitor_bundles",
    "recompute_strategy_performance",
    "run_backtest_until_done",
    "run_feature_engine",
    "run_next_backtest_step",
    "drive_replay_automation",
    "fail_live",
    "fail_replay",
    "fail_desk_work",
    "save_manual_monitor",
    "save_replay_master_analysis",
    "save_replay_monitor",
    "simulate_replay_interval",
    "start_or_resume_replay_autopilot",
    "set_replay_automation",
    "update_desk_job_status",
    "upsert_replay_autopilot_config",
  ]);
  for (const [name, schema] of Object.entries(current)) {
    if (addedFrontReadyTools.has(name)) {
      assert.ok(schema, `${name} must expose a schema`);
      continue;
    }
    if (changedByAuditGate.has(name) || changedByStorageSplit.has(name) || changedByM15ManualMonitor.has(name) || changedByMcpTransportV2.has(name) || changedByFrontProjectionContract.has(name) || changedByStrictScopeV2.has(name)) continue;
    assert.deepEqual(schema, legacy[name], `${name} schema drifted unexpectedly`);
  }

  assert.equal(current.save_desk_decision.properties.decision_audit.type, "object");
  assert.ok(current.save_desk_decision.required.includes("decision_audit"));
  assert.equal(current.save_desk_decision.properties.decision_audit.properties.future_data_used.const, false);
  assert.equal(current.save_desk_decision.properties.decision_audit.properties.entry_sl_tp_frozen.const, true);

  const executableDecision = current.save_desk_analysis.properties.executable_decision;
  assert.equal(executableDecision.properties.decision_audit.type, "object");
  assert.ok(executableDecision.required.includes("decision_audit"));

  for (const name of changedByStorageSplit) {
    const statuses = current[name].properties.status.enum;
    assert.equal(statuses.includes("POSITION_ACTIVE"), false, `${name} must not accept thesis-owned position status`);
    assert.equal(statuses.includes("POSITION_PROTECTED"), false, `${name} must not accept thesis-owned position status`);
  }
  assert.ok(current.get_cross_asset_delta.properties.window.enum.includes("15m"));
  assert.equal(current.save_contract.properties.force.type, "boolean");
});

test("tool validators keep cross-field refine requirements", async () => {
  const store = createTestDeskStore({ root: "/tmp/mcp-tool-refine", projectRoot: "/tmp/mcp-tool-refine" }).store;
  const registry = createDeskToolRegistry(store);

  const setups = await callDeskTool(registry, "get_desk_setups", {});
  assert.equal(setups.isError, true);
  assert.match(setups.structuredContent.error, /pack_id, analysis_id or decision_id is required/);

  const replay = await callDeskTool(registry, "replay_desk_setups", {});
  assert.equal(replay.isError, true);
  assert.match(replay.structuredContent.error, /setup_record_id, pack_id, analysis_id or decision_id is required/);
});
