import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { evaluateAntiLookahead } from "@tv-automation/desk-domain";
import { analysisSchema, decisionSchema } from "../src/schemas.js";
import { createTestDeskStore } from "./support/test-desk-store.js";
import { callDeskTool, createDeskToolRegistry } from "../src/tools.js";
import { validDecisionAudit } from "./fixtures/decision_audit_payloads.js";

function decisionPayload(overrides = {}) {
  return {
    session: "asia_open",
    date: "2026-07-02",
    instrument: "MNQ",
    decision: "prendre",
    direction: "short",
    setup_type: "sell_limit_pullback",
    confidence_pct: 67,
    risk_pct: 0.5,
    rr_minimum: 2,
    invalidation: "M15 close above 30235",
    reason_summary: "Primary short setup with audit proof.",
    decision_audit: validDecisionAudit({
      decision_id: "decision_audit_gate",
      source_pack_id: "2026-07-02_asia_open",
    }),
    ...overrides,
  };
}

function analysisPayload(overrides = {}) {
  return {
    schema_version: "1.1.0",
    contract_name: "DeskFuturesAnalysisContract",
    analysis_id: "analysis_audit_gate",
    created_at_paris: "2026-07-02T10:15:00+02:00",
    mode: "live",
    analysis_type: "asia_open",
    pack_id: "2026-07-02_asia_open",
    session: "asia_open",
    date: "2026-07-02",
    timezone: "Europe/Paris",
    title: "Audit gated analysis",
    scope: {},
    source_pack: {},
    executive_summary: {
      summary: "Conditional short only with audit proof.",
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
        label: "Short MNQ pullback",
        instrument: "MNQ",
        direction: "short",
        setup_type: "sell_limit_pullback",
        invalidation: "M15 close above 30235",
        risk_pct: 0.5,
        confidence_pct: 67,
        reason: "Weak MNQ, sell only a rebound.",
      },
    ],
    executable_decision: decisionPayload(),
    session_matrix: [{}],
    authorized_windows_summary: [{}],
    update_agenda: [{}],
    risk_management: {},
    monitoring_rules: {},
    final_sections: {
      decision_executable: "Conditional short.",
      regle_finale: "No decision without DecisionAudit.",
    },
    ...overrides,
  };
}

test("decision gate accepts a valid DecisionAudit envelope", () => {
  const parsed = decisionSchema.parse(decisionPayload());

  assert.equal(parsed.decision_audit.future_data_used, false);
  assert.equal(parsed.decision_audit.entry_sl_tp_frozen, true);
  assert.equal(parsed.decision_audit.contract_name, "DeskDecisionAuditContract");
});

test("decision gate rejects a missing DecisionAudit envelope", () => {
  assert.throws(
    () => decisionSchema.parse({ ...decisionPayload(), decision_audit: undefined }),
    /decision_audit/,
  );
});

test("decision gate rejects audits that record future data usage", () => {
  assert.throws(
    () => decisionSchema.parse(decisionPayload({
      decision_audit: validDecisionAudit({ future_data_used: true }),
    })),
    /decision_audit_future_data_used/,
  );
});

test("decision gate rejects audits whose entry, stop and targets are not frozen", () => {
  const decisionAudit = validDecisionAudit({ entry_sl_tp_frozen: false });
  const domainResult = evaluateAntiLookahead({ decisionAudit });

  assert.equal(domainResult.status, "rejected");
  assert.ok(domainResult.reasons.includes("entry_sl_tp_not_frozen"));
  assert.throws(
    () => decisionSchema.parse(decisionPayload({ decision_audit: decisionAudit })),
    /decision_audit_entry_sl_tp_not_frozen/,
  );
});

test("decision gate rejects invalid audit decision timestamps through the domain guard", () => {
  const decisionAudit = validDecisionAudit({ decision_timestamp_paris: "not-a-date" });
  const domainResult = evaluateAntiLookahead({ decisionAudit });

  assert.equal(domainResult.status, "rejected");
  assert.ok(domainResult.reasons.includes("missing_or_invalid_decision_timestamp"));
  assert.throws(
    () => decisionSchema.parse(decisionPayload({ decision_audit: decisionAudit })),
    /decision_audit_invalid_timestamp/,
  );
});

test("decision gate rejects available data after the cutoff", () => {
  assert.throws(
    () => decisionSchema.parse(decisionPayload({
      decision_audit: validDecisionAudit({
        available_data_until: "2026-07-02T10:20:00+02:00",
      }),
    })),
    /decision_audit_available_data_after_cutoff/,
  );
});

test("decision gate rejects visible macro actuals published after the cutoff", () => {
  assert.throws(
    () => decisionSchema.parse(decisionPayload({
      decision_audit: validDecisionAudit({
        macro_actuals_visible: [
          {
            event: "US ISM Services PMI",
            importance: "high",
            scheduled_at_paris: "2026-07-02T16:00:00+02:00",
            published_at_paris: "2026-07-02T16:00:01+02:00",
          },
        ],
      }),
    })),
    /decision_audit_visible_macro_after_cutoff/,
  );
});

test("analysis gate rejects executable decisions without DecisionAudit", () => {
  assert.throws(
    () => analysisSchema.parse(analysisPayload({
      executable_decision: decisionPayload({ decision_audit: undefined }),
    })),
    /decision_audit/,
  );
});

test("MCP save_desk_decision refuses unaudited decisions before persistence", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpt-desk-mcp-audit-gate-"));
  const store = createTestDeskStore({ root, projectRoot: root }).store;
  const registry = createDeskToolRegistry(store);

  const result = await callDeskTool(registry, "save_desk_decision", {
    ...decisionPayload(),
    decision_audit: undefined,
  });

  assert.equal(result.isError, true);
  assert.match(result.structuredContent.error, /decision_audit/);
});

test("MCP save_desk_analysis refuses unaudited executable decisions before persistence", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpt-desk-mcp-audit-gate-"));
  const store = createTestDeskStore({ root, projectRoot: root }).store;
  const registry = createDeskToolRegistry(store);

  const result = await callDeskTool(registry, "save_desk_analysis", analysisPayload({
    executable_decision: decisionPayload({ decision_audit: undefined }),
  }));

  assert.equal(result.isError, true);
  assert.match(result.structuredContent.error, /decision_audit/);
});
