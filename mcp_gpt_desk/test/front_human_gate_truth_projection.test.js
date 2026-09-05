import assert from "node:assert/strict";
import test from "node:test";
import { orderHumanGateProjection, resourceAllowedActions } from "../src/front-control-plane-permissions.js";
import { portfolioOrderIntentSummaryRow } from "../src/front-control-plane-domain-completeness.js";
import { buildLiveFocusProjection } from "../src/front-live-focus-projection.js";
import { orderDetail } from "../src/front-control-plane-order-view.js";

const nowIso = "2026-09-05T15:00:00.000Z";
const actor = { kind: "operator_session", scopes: ["desk.read", "desk.write"] };
const intent = { portfolio_order_intent_id: "intent-truth", target_position_id: "target-truth", status: "READY", payload: { instrument: "ZC", action: "BUY" } };

test("joined gate status never inherits the independent READY order-intent status", () => {
  for (const status of ["CONFIRMED", "REJECTED", "EXPIRED", undefined]) {
    const gate = orderHumanGateProjection({ execution: {}, portfolioIntent: {
      ...intent, human_execution_gate_id: "gate-truth", human_gate_status: status,
    }, actor, nowIso });
    assert.equal(gate.status, status || "UNKNOWN");
    assert.equal(gate.actions.some((action) => action.action === "CONFIRM"), false);
  }
  const actions = resourceAllowedActions({ resourceType: "OrderIntent", status: "READY", actor });
  assert.equal(actions.allowedActions.includes("CONFIRM"), false);
});

test("an expired unswept gate publishes its deadline and cannot ask for confirmation", () => {
  const summary = summaryFor("AWAITING_MANUAL_CONFIRMATION", "2026-09-05T14:59:00.000Z");
  assert.equal(summary.humanGate.status, "EXPIRED");
  assert.equal(summary.humanGate.expiresAt, "2026-09-05T14:59:00.000Z");
  assert.equal(summary.allowedActions.expiresAt, summary.humanGate.expiresAt);
  assert.equal(summary.allowedActions.allowedActions.includes("CONFIRM"), false);
  const focus = focusFor(summary);
  assert.equal(focus.tradeCards[0].actionable, false);
  assert.equal(focus.tradeCards[0].operatorState, "EXPIRED");
  assert.equal(focus.selectedTrade, null);
});

test("a confirmed gate stays confirmed after its human deadline without inventing a fill", () => {
  const focus = focusFor(summaryFor("CONFIRMED", "2026-09-05T14:59:00.000Z"));
  assert.equal(focus.tradeCards[0].operatorState, "CONFIRMED");
  assert.equal(focus.tradeCards[0].actionable, false);
  assert.equal(focus.tradeCards[0].expiredByTime, false);
  assert.equal(focus.tradeCards[0].terminal, false);
  assert.equal(focus.tradeCards[0].entryFilledAt, null);
  assert.equal(focus.tradeCards[0].theoreticalState, "AWAITING_ENTRY");
});

test("an awaiting gate with published permission is the only actionable fixture dossier", () => {
  const focus = focusFor(summaryFor("AWAITING_MANUAL_CONFIRMATION", "2026-09-05T15:30:00.000Z"));
  assert.equal(focus.tradeCards[0].actionable, true);
  assert.equal(focus.tradeCards[0].expiresAt, "2026-09-05T15:30:00.000Z");
  assert.equal(focus.dashboard.current.actionable, 1);
});

test("order detail uses the same canonical gate authority and audit clock as its resource actions", () => {
  for (const [status, expiresAt, expectedStatus, actionable] of [
    ["AWAITING_MANUAL_CONFIRMATION", "2026-09-05T15:30:00.000Z", "AWAITING_MANUAL_CONFIRMATION", true],
    ["AWAITING_MANUAL_CONFIRMATION", "2026-09-05T14:59:00.000Z", "EXPIRED", false],
    ["CONFIRMED", "2026-09-05T14:59:00.000Z", "CONFIRMED", false],
    ["REJECTED", "2026-09-05T15:30:00.000Z", "REJECTED", false],
  ]) {
    const dossier = orderDetail({ execution: { portfolioOrderIntents: [intent], humanExecutionGates: [{
      human_execution_gate_id: "gate-truth", portfolio_order_intent_id: intent.portfolio_order_intent_id,
      status, revision: 2, expires_at_utc: expiresAt,
    }] }, query: { orderId: intent.portfolio_order_intent_id }, warnings: [], actor, nowIso });
    assert.equal(dossier.humanGate.status, expectedStatus);
    assert.equal(dossier.resourceActions.allowedActions.includes("CONFIRM"), actionable);
    assert.equal(dossier.resourceActions.expiresAt, expiresAt);
    assert.equal(dossier.summary.filledQuantity, 0);
  }
});

function summaryFor(status, expiresAt) {
  return portfolioOrderIntentSummaryRow({ item: intent, actor, nowIso, execution: {
    humanExecutionGates: [{ human_execution_gate_id: "gate-truth", portfolio_order_intent_id: intent.portfolio_order_intent_id,
      status, revision: 2, expires_at_utc: expiresAt }],
  } });
}

function focusFor(summary) {
  return buildLiveFocusProjection({ live: { portfolioOrderIntents: [summary] }, nowIso });
}
