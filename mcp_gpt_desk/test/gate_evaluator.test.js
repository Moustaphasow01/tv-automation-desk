import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { evaluateAnalysisGates } from "../src/domain_gates.js";
import { createTestDeskStore } from "./support/test-desk-store.js";
import { callDeskTool, createDeskToolRegistry } from "../src/tools.js";
import { validDecisionAudit } from "./fixtures/decision_audit_payloads.js";
import { liveScope } from "./fixtures/live_scope.js";

function passingGates() {
  return {
    data_quality_gate: { status: "pass", hard_gate: true },
    market_funnel_gate: { status: "pass", hard_gate: true },
    final_gate: { status: "pass" },
  };
}

function analysisPayload(overrides = {}) {
  return {
    ...liveScope({ date: "2026-07-02", cutoff_paris: "2026-07-02T10:15:00+02:00" }),
    schema_version: "1.1.0",
    contract_name: "DeskFuturesAnalysisContract",
    analysis_id: "analysis_gate_eval",
    created_at_paris: "2026-07-02T10:15:00+02:00",
    mode: "live",
    analysis_type: "asia_open",
    pack_id: "2026-07-02_asia_open",
    session: "asia_open",
    date: "2026-07-02",
    timezone: "Europe/Paris",
    title: "Gate evaluated analysis",
    scope: {},
    source_pack: {},
    executive_summary: {
      summary: "Conditional long with valid gates.",
      final_decision: "prendre",
      final_instrument: "MNQ",
      final_direction: "long",
      primary_setup_id: "A",
    },
    context: {},
    market_funnel: {},
    levels: {},
    strategic_brief: {},
    decision_gates: passingGates(),
    setups: [
      {
        setup_id: "A",
        label: "Long pullback",
        instrument: "MNQ",
        direction: "long",
        setup_type: "buy_limit_pullback",
        entry_zone: { from: 100, to: 100 },
        stop_loss: 95,
        take_profits: [{ name: "TP1", target: 110 }],
        invalidation: "M15 close below invalidation",
        risk_pct: 0.5,
        confidence_pct: 67,
        reason: "Valid gated setup.",
      },
    ],
    executable_decision: {
      decision_id: "decision_gate_eval",
      session: "asia_open",
      date: "2026-07-02",
      instrument: "MNQ",
      decision: "prendre",
      direction: "long",
      setup_type: "buy_limit_pullback",
      confidence_pct: 67,
      risk_pct: 0.5,
      rr_minimum: 2,
      entry_zone: { from: 100, to: 100 },
      stop_loss: 95,
      take_profits: { tp1: 110 },
      invalidation: "M15 close below invalidation",
      reason_summary: "Primary long setup with gates.",
      decision_audit: validDecisionAudit({
        decision_id: "decision_gate_eval",
        source_pack_id: "2026-07-02_asia_open",
      }),
    },
    session_matrix: [{}],
    authorized_windows_summary: [{}],
    update_agenda: [{}],
    risk_management: {},
    monitoring_rules: {},
    final_sections: {
      decision_executable: "Conditional long.",
      regle_finale: "Respect hard gates.",
    },
    ...overrides,
  };
}

async function registry() {
  const root = await mkdtemp(join(tmpdir(), "gpt-desk-mcp-gate-eval-"));
  const store = createTestDeskStore({ root, projectRoot: root }).store;
  return createDeskToolRegistry(store);
}

test("MCP save_desk_analysis accepts passing domain gates", async () => {
  const tools = await registry();
  const result = await callDeskTool(tools, "save_desk_analysis", analysisPayload());

  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.ok, true);
});

test("MCP save_desk_analysis rejects missing data quality gate before persistence", async () => {
  const tools = await registry();
  const result = await callDeskTool(tools, "save_desk_analysis", analysisPayload({
    decision_gates: {
      market_funnel_gate: { status: "pass", hard_gate: true },
      final_gate: { status: "pass" },
    },
  }));

  assert.equal(result.isError, true);
  assert.match(result.structuredContent.error, /decision_gate_rejected:data_quality_gate_failed/);
});

test("MCP save_desk_analysis refuses final gate conflicts as review-required", async () => {
  const tools = await registry();
  const result = await callDeskTool(tools, "save_desk_analysis", analysisPayload({
    decision_gates: {
      ...passingGates(),
      final_gate: { status: "conditional_pass", fallback_decision: "wait" },
    },
  }));

  assert.equal(result.isError, true);
  assert.match(result.structuredContent.error, /decision_gate_review_required:final_gate_conflict/);
});

test("MCP save_desk_analysis rejects new entries during red windows", async () => {
  const tools = await registry();
  const result = await callDeskTool(tools, "save_desk_analysis", analysisPayload({
    session_matrix: [{
      id: "macro_blackout",
      status: "red",
      start: "2026-07-02T10:00:00+02:00",
      end: "2026-07-02T10:30:00+02:00",
      new_entries_allowed: false,
    }],
  }));

  assert.equal(result.isError, true);
  assert.match(result.structuredContent.error, /decision_gate_rejected:red_window_no_new_entry/);
});

test("MCP gate helper exposes the pure domain review status", () => {
  const result = evaluateAnalysisGates(analysisPayload({
    decision_gates: {
      ...passingGates(),
      final_gate: { status: "conditional_pass", fallback_decision: "wait" },
    },
  }));

  assert.equal(result.status, "review_required");
  assert.ok(result.reasons.includes("final_gate_conflict"));
});
