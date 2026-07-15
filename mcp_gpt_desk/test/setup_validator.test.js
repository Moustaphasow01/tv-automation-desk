import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { evaluateAnalysisSetup } from "../src/domain_setup.js";
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
    analysis_id: "analysis_setup_eval",
    created_at_paris: "2026-07-02T10:15:00+02:00",
    mode: "live",
    analysis_type: "asia_open",
    pack_id: "2026-07-02_asia_open",
    session: "asia_open",
    date: "2026-07-02",
    timezone: "Europe/Paris",
    title: "Setup evaluated analysis",
    scope: {},
    source_pack: {},
    executive_summary: {
      summary: "Setup-controlled long setup.",
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
        reason: "Valid setup geometry.",
        executable: true,
      },
    ],
    executable_decision: {
      decision_id: "decision_setup_eval",
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
      reason_summary: "Primary long setup with setup validation.",
      decision_audit: validDecisionAudit({
        decision_id: "decision_setup_eval",
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
      regle_finale: "Respect setup geometry.",
    },
    ...overrides,
  };
}

function waitAnalysisPayload(overrides = {}) {
  return analysisPayload({
    executive_summary: {
      summary: "WAIT, no valid setup.",
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
      decision_id: "decision_setup_wait",
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
        decision_id: "decision_setup_wait",
        source_pack_id: "2026-07-02_asia_open",
      }),
    },
    ...overrides,
  });
}

async function registry() {
  const root = await mkdtemp(join(tmpdir(), "gpt-desk-mcp-setup-eval-"));
  const store = createTestDeskStore({ root, projectRoot: root }).store;
  return createDeskToolRegistry(store);
}

test("MCP save_desk_analysis accepts valid setup geometry", async () => {
  const tools = await registry();
  const result = await callDeskTool(tools, "save_desk_analysis", analysisPayload());

  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.ok, true);
});

test("MCP save_desk_analysis rejects missing stop before risk evaluation", async () => {
  const tools = await registry();
  const setupWithoutStop = { ...analysisPayload().setups[0] };
  const decisionWithoutStop = { ...analysisPayload().executable_decision };
  delete setupWithoutStop.stop_loss;
  delete decisionWithoutStop.stop_loss;
  const result = await callDeskTool(tools, "save_desk_analysis", analysisPayload({
    setups: [setupWithoutStop],
    executable_decision: decisionWithoutStop,
  }));

  assert.equal(result.isError, true);
  assert.match(result.structuredContent.error, /setup_validator_rejected:setup_incomplete/);
});

test("MCP save_desk_analysis rejects invalid long geometry", async () => {
  const tools = await registry();
  const result = await callDeskTool(tools, "save_desk_analysis", analysisPayload({
    executable_decision: {
      ...analysisPayload().executable_decision,
      stop_loss: 101,
    },
  }));

  assert.equal(result.isError, true);
  assert.match(result.structuredContent.error, /setup_validator_rejected:invalid_long_prices/);
});

test("MCP save_desk_analysis rejects WAIT carrying positive risk", async () => {
  const tools = await registry();
  const result = await callDeskTool(tools, "save_desk_analysis", waitAnalysisPayload({
    executable_decision: {
      ...waitAnalysisPayload().executable_decision,
      risk_pct: 0.25,
    },
  }));

  assert.equal(result.isError, true);
  assert.match(result.structuredContent.error, /setup_validator_rejected:wait_has_risk/);
});

test("MCP save_desk_analysis accepts WAIT with zero risk", async () => {
  const tools = await registry();
  const result = await callDeskTool(tools, "save_desk_analysis", waitAnalysisPayload());

  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.ok, true);
});

test("MCP setup helper exposes normalized geometry evidence", () => {
  const result = evaluateAnalysisSetup(analysisPayload());

  assert.equal(result.status, "accepted");
  assert.equal(result.evidence.normalized_price_geometry.rr, 2);
});
