import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { evaluateAnalysisRisk } from "../src/domain_risk.js";
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
    analysis_id: "analysis_risk_eval",
    created_at_paris: "2026-07-02T10:15:00+02:00",
    mode: "live",
    analysis_type: "asia_open",
    pack_id: "2026-07-02_asia_open",
    session: "asia_open",
    date: "2026-07-02",
    timezone: "Europe/Paris",
    title: "Risk evaluated analysis",
    scope: {},
    source_pack: {},
    executive_summary: {
      summary: "Risk-controlled long setup.",
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
        invalidation: "M15 close below 95",
        risk_pct: 0.5,
        confidence_pct: 67,
        reason: "Valid risk setup.",
        executable: true,
      },
    ],
    executable_decision: {
      decision_id: "decision_risk_eval",
      session: "asia_open",
      date: "2026-07-02",
      instrument: "MNQ",
      decision: "prendre",
      direction: "long",
      setup_id: "A",
      setup_type: "buy_limit_pullback",
      confidence_pct: 67,
      risk_pct: 0.5,
      rr_minimum: 2,
      entry_zone: { from: 100, to: 100 },
      stop_loss: 95,
      take_profits: { tp1: 110 },
      invalidation: "M15 close below 95",
      reason_summary: "Primary long setup with risk controls.",
      decision_audit: validDecisionAudit({
        decision_id: "decision_risk_eval",
        source_pack_id: "2026-07-02_asia_open",
      }),
    },
    session_matrix: [{}],
    authorized_windows_summary: [{}],
    update_agenda: [{}],
    risk_management: {
      max_risk_pct_primary_setup: 0.5,
      max_risk_pct_session: 1,
      min_rr: 1.5,
    },
    monitoring_rules: {},
    final_sections: {
      decision_executable: "Conditional long.",
      regle_finale: "Respect risk.",
    },
    ...overrides,
  };
}

function waitAnalysisPayload() {
  return analysisPayload({
    executive_summary: {
      summary: "WAIT, no valid risk setup.",
      final_decision: "wait",
      final_instrument: "WAIT",
      final_direction: "wait",
      primary_setup_id: "WAIT_A",
    },
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
      },
    ],
    executable_decision: {
      decision_id: "decision_risk_wait",
      session: "asia_open",
      date: "2026-07-02",
      instrument: "WAIT",
      decision: "wait",
      direction: "wait",
      setup_type: "wait",
      confidence_pct: 78,
      risk_pct: 0,
      rr_minimum: 0,
      invalidation: "No valid setup",
      reason_summary: "WAIT with zero risk.",
      decision_audit: validDecisionAudit({
        decision_id: "decision_risk_wait",
        source_pack_id: "2026-07-02_asia_open",
      }),
    },
  });
}

async function registry() {
  const root = await mkdtemp(join(tmpdir(), "gpt-desk-mcp-risk-eval-"));
  const store = createTestDeskStore({ root, projectRoot: root }).store;
  return createDeskToolRegistry(store);
}

test("MCP save_desk_analysis accepts passing domain risk", async () => {
  const tools = await registry();
  const result = await callDeskTool(tools, "save_desk_analysis", analysisPayload());

  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.ok, true);
});

test("MCP save_desk_analysis rejects risk above max before persistence", async () => {
  const tools = await registry();
  const result = await callDeskTool(tools, "save_desk_analysis", analysisPayload({
    executable_decision: {
      ...analysisPayload().executable_decision,
      risk_pct: 0.75,
    },
  }));

  assert.equal(result.isError, true);
  assert.match(result.structuredContent.error, /risk_engine_rejected:risk_pct_above_limit/);
});

test("MCP save_desk_analysis rejects RR below minimum before persistence", async () => {
  const tools = await registry();
  const lowRR = {
    ...analysisPayload().executable_decision,
    take_profits: { tp1: 104 },
  };
  const result = await callDeskTool(tools, "save_desk_analysis", analysisPayload({
    executable_decision: lowRR,
  }));

  assert.equal(result.isError, true);
  assert.match(result.structuredContent.error, /risk_engine_rejected:rr_below_minimum/);
});

test("MCP save_desk_analysis accepts WAIT with zero risk and no geometry", async () => {
  const tools = await registry();
  const result = await callDeskTool(tools, "save_desk_analysis", waitAnalysisPayload());

  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.ok, true);
});

test("MCP risk helper exposes pure RiskEngine evidence", () => {
  const result = evaluateAnalysisRisk(analysisPayload());

  assert.equal(result.status, "accepted");
  assert.equal(result.evidence.computed_rr, 2);
});
