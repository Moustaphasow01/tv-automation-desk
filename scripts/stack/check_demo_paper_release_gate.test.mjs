import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { combineReleaseGate, parseDemoPaperReleaseGateArgs } from "./check_demo_paper_release_gate.mjs";

describe("demo PAPER release gate", () => {
  it("is ready only when demo-paper and VNext operator gates are both ready", () => {
    const gate = combineReleaseGate({
      checkedAt: "2026-08-12T01:00:00.000Z",
      statusUrl: "http://desk/status",
      vnextBaseUrl: "http://desk",
      demoPaper: { ok: true, blockers: [], warnings: [] },
      demoPaperDiagnosis: { actions: [] },
      vnextOperator: { ok: true, status: "READY", blockers: [], checks: [{ id: "operator.login", ok: true }] },
    });

    assert.equal(gate.ok, true);
    assert.equal(gate.status, "READY");
    assert.equal(gate.final_decision, "OPEN_DEMO_PAPER_AGENTS_ALLOWED");
    assert.deepEqual(gate.blockers, []);
  });

  it("keeps agents closed when the trading gate is blocked even if VNext operator is ready", () => {
    const gate = combineReleaseGate({
      checkedAt: "2026-08-12T01:00:00.000Z",
      statusUrl: "http://desk/status",
      vnextBaseUrl: "http://desk",
      demoPaper: { ok: false, blockers: [{ id: "data.source_durable", detail: { durable: false } }], warnings: [] },
      demoPaperDiagnosis: {
        actions: [{
          id: "tradingview_source_durable",
          title: "Remplacer le secours TradingView par des alertes durables",
          severity: "blocker",
          evidence: "durable=false",
          action: "Créer ou corriger les alertes TradingView MNQ/MES M1/M5.",
        }],
      },
      vnextOperator: { ok: true, status: "READY", blockers: [], checks: [{ id: "operator.login", ok: true }] },
    });

    assert.equal(gate.ok, false);
    assert.equal(gate.status, "BLOCKED");
    assert.equal(gate.final_decision, "KEEP_AGENTS_CLOSED_OR_SHADOW");
    assert.deepEqual(gate.components.vnext_operator.blockers, []);
    assert.deepEqual(gate.blockers.map((blocker) => `${blocker.component}.${blocker.id}`), ["demo-paper.data.source_durable"]);
    assert.deepEqual(gate.actions.map((action) => `${action.component}.${action.id}`), ["demo-paper.tradingview_source_durable"]);
    assert.deepEqual(gate.components.demo_paper.actions, ["tradingview_source_durable"]);
  });

  it("keeps agents closed when VNext operator cannot authenticate", () => {
    const gate = combineReleaseGate({
      checkedAt: "2026-08-12T01:00:00.000Z",
      statusUrl: "http://desk/status",
      vnextBaseUrl: "http://desk",
      demoPaper: { ok: true, blockers: [], warnings: [] },
      demoPaperDiagnosis: { actions: [] },
      vnextOperator: { ok: false, status: "BLOCKED", blockers: [{ id: "operator.login", detail: "401" }], checks: [] },
    });

    assert.equal(gate.ok, false);
    assert.deepEqual(gate.blockers.map((blocker) => `${blocker.component}.${blocker.id}`), ["vnext-operator.operator.login"]);
  });

  it("parses release endpoints and output flags", () => {
    const options = parseDemoPaperReleaseGateArgs([
      "--status-url=http://desk/status",
      "--vnext-base-url=http://desk",
      "--json",
      "--exit-zero",
    ], { DESK_OPERATOR_ADMIN_PIN: "pin" });

    assert.deepEqual(options, {
      statusUrl: "http://desk/status",
      vnextBaseUrl: "http://desk",
      executionOverviewUrl: "",
      operatorPin: "pin",
      output: "json",
      exitZero: true,
    });
  });
});
