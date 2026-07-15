import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { evaluateActiveThesisUpdate } from "../src/domain_thesis_state.js";
import { createTestDeskStore } from "./support/test-desk-store.js";
import { callDeskTool, createDeskToolRegistry } from "../src/tools.js";
import { validDecisionAudit } from "./fixtures/decision_audit_payloads.js";
import { liveScope } from "./fixtures/live_scope.js";

const scope = () => liveScope({ date: "2026-07-02", cutoff_paris: "2026-07-02T10:15:00+02:00" });

function activeThesisPayload(overrides = {}) {
  return {
    ...scope(),
    thesis_id: "thesis_state_eval",
    linked_master_analysis_id: "master_state_eval",
    status: "THESIS_ACTIVE",
    instrument: "MNQ",
    direction: "long",
    dominant_scenario: "MNQ continuation thesis.",
    confidence_pct: 68,
    health_score: 74,
    valid_from: "2026-07-02T10:15:00+02:00",
    key_levels: [],
    wait_to_go_conditions: [],
    invalidation_conditions: [],
    expected_path: {},
    failure_path: {},
    scenario_transformation_map: [],
    monitoring_playbook: [],
    decision_audit: validDecisionAudit({
      decision_id: "decision_thesis_state_eval",
      source_pack_id: "2026-07-02_asia_open",
    }),
    ...overrides,
  };
}

async function registry() {
  const root = await mkdtemp(join(tmpdir(), "gpt-desk-mcp-thesis-state-"));
  const store = createTestDeskStore({ root, projectRoot: root }).store;
  await store.saveMasterAnalysis({
    ...scope(),
    analysis_id: "master_state_eval",
    contract_name: "DeskMasterAnalysisContract",
    schema_version: "4.0.0",
    contract_hash: "test-master-hash",
    full_analysis: {},
  });
  return { store, tools: createDeskToolRegistry(store) };
}

test("MCP save_active_thesis accepts initial active thesis with audit evidence", async () => {
  const { tools } = await registry();
  const result = await callDeskTool(tools, "save_active_thesis", activeThesisPayload());

  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.thesis_id, "thesis_state_eval");
  assert.equal(result.structuredContent.status, "THESIS_ACTIVE");
});

test("MCP save_active_thesis accepts initial active thesis without audit evidence", async () => {
  const { tools } = await registry();
  const { decision_audit, ...withoutAudit } = activeThesisPayload();
  const result = await callDeskTool(tools, "save_active_thesis", withoutAudit);

  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.status, "THESIS_ACTIVE");
});

test("MCP save_active_thesis accepts initial WAIT_MONITORED thesis from zero", async () => {
  const { tools } = await registry();
  const { decision_audit, ...withoutAudit } = activeThesisPayload({ status: "WAIT_MONITORED" });
  const result = await callDeskTool(tools, "save_active_thesis", withoutAudit);

  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.status, "WAIT_MONITORED");
});

test("MCP update_active_thesis accepts an allowed active to armed transition", async () => {
  const { tools } = await registry();
  await callDeskTool(tools, "save_active_thesis", activeThesisPayload());

  const result = await callDeskTool(tools, "update_active_thesis", {
    ...scope(),
    master_id: "master_state_eval",
    thesis_id: "thesis_state_eval",
    status: "SETUP_ARMED",
    notes: "Setup is armed after monitor confirmation.",
  });

  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.status, "SETUP_ARMED");
});

test("MCP update_active_thesis rejects legacy position states for active thesis storage", async () => {
  const { store, tools } = await registry();
  await store.saveActiveThesis(activeThesisPayload({ status: "SETUP_TRIGGERED" }));

  const result = await callDeskTool(tools, "update_active_thesis", {
    ...scope(),
    master_id: "master_state_eval",
    thesis_id: "thesis_state_eval",
    status: "POSITION_ACTIVE",
  });

  assert.equal(result.isError, true);
  assert.match(result.structuredContent.error, /POSITION_ACTIVE|Invalid enum value/);
});

test("Persistent store splits legacy active thesis position state into desk_positions", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpt-desk-mcp-thesis-position-split-"));
  const { store, persistence } = createTestDeskStore({ root, projectRoot: root });
  await store.saveActiveThesis(activeThesisPayload({
    status: "SETUP_TRIGGERED",
    linked_setup_id: "setup_state_eval",
    entry_price: 100,
    stop_loss: 95,
    take_profits: [{ name: "TP1", target: 110 }],
    risk_pct: 0.5,
  }));

  const result = await store.updateActiveThesis({
    ...scope(),
    master_id: "master_state_eval",
    thesis_id: "thesis_state_eval",
    status: "POSITION_PROTECTED",
    fill_proof: { filled_at_paris: "2026-07-02T10:45:00+02:00" },
    decision_audit: validDecisionAudit({
      decision_id: "decision_position_activation",
      source_pack_id: "2026-07-02_asia_open",
    }),
  });

  assert.equal(result.status, "SETUP_TRIGGERED");
  assert.equal(result.split_storage, true);
  assert.equal(result.position_id, "position_thesis_state_eval_setup_state_eval");

  const thesisDoc = await persistence.getDocument(DESK_COLLECTIONS.deskActiveTheses, "thesis_state_eval");
  const positionDoc = await persistence.getDocument(DESK_COLLECTIONS.deskPositions, "position_thesis_state_eval_setup_state_eval");
  assert.equal(thesisDoc.status, "SETUP_TRIGGERED");
  assert.equal(thesisDoc.legacy_position_status, "POSITION_PROTECTED");
  assert.equal(thesisDoc.linked_position_id, "position_thesis_state_eval_setup_state_eval");
  assert.equal(positionDoc.status, "protected");
  assert.equal(positionDoc.linked_thesis_id, "thesis_state_eval");
  assert.equal(positionDoc.linked_setup_id, "setup_state_eval");
  assert.equal(positionDoc.source_collection, "desk_active_theses");
});

test("MCP update_active_thesis rejects direct invalidated to active reactivation", async () => {
  const { store, tools } = await registry();
  await store.saveActiveThesis(activeThesisPayload({ status: "THESIS_INVALIDATED" }));

  const result = await callDeskTool(tools, "update_active_thesis", {
    ...scope(),
    master_id: "master_state_eval",
    thesis_id: "thesis_state_eval",
    status: "THESIS_ACTIVE",
    decision_audit: validDecisionAudit({
      decision_id: "decision_reactivate_invalidated",
      source_pack_id: "2026-07-02_asia_open",
    }),
  });

  assert.equal(result.isError, true);
  assert.match(result.structuredContent.error, /thesis_state_machine_rejected:replan_required/);
});

test("MCP thesis helper maps health statuses to unchanged active domain state", () => {
  const result = evaluateActiveThesisUpdate(
    { thesis_id: "thesis_state_eval", status: "THESIS_WEAKENED" },
    activeThesisPayload({ status: "THESIS_ACTIVE" }),
  );

  assert.equal(result.status, "accepted");
  assert.equal(result.evidence.next_domain_state, "THESIS_ACTIVE");
  assert.equal(result.evidence.state_unchanged, true);
});
