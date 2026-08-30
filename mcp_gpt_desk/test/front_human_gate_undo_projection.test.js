import assert from "node:assert/strict";
import test from "node:test";
import { orderHumanGateProjection } from "../src/front-control-plane-permissions.js";

const intent = { portfolio_order_intent_id: "poi-undo", payload: { order_intent_id: "poi-undo" } };
const actor = { kind: "operator_session", scopes: ["desk.read", "desk.write"] };

test("frontend publishes Undo only from the backend window and before provider dispatch", () => {
  const gate = {
    human_execution_gate_id: "gate-undo",
    portfolio_order_intent_id: "poi-undo",
    status: "CONFIRMED",
    revision: 4,
    undo_expires_at_utc: "2026-08-30T10:00:10.000Z",
  };
  const available = orderHumanGateProjection({ execution: { humanExecutionGates: [gate], providerCommands: [] }, portfolioIntent: intent, actor, nowIso: "2026-08-30T10:00:05.000Z" });
  assert.equal(available.actions.length, 1);
  assert.equal(available.actions[0].action, "UNDO");
  assert.equal(available.actions[0].expectedRevision, "4");

  const expired = orderHumanGateProjection({ execution: { humanExecutionGates: [gate], providerCommands: [] }, portfolioIntent: intent, actor, nowIso: "2026-08-30T10:00:11.000Z" });
  assert.deepEqual(expired.actions, []);
  assert.match(expired.unavailableReason, /terminée/);

  const dispatched = orderHumanGateProjection({ execution: { humanExecutionGates: [gate], providerCommands: [{ portfolio_order_intent_id: "poi-undo" }] }, portfolioIntent: intent, actor, nowIso: "2026-08-30T10:00:05.000Z" });
  assert.deepEqual(dispatched.actions, []);
});
