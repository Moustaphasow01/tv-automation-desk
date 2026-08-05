import assert from "node:assert/strict";
import test from "node:test";
import { handleFrontOperations, isFrontOperationsMethodAllowed, isFrontOperationsPath, isFrontOperationsWriteRequest } from "../src/front-operations-api.js";

test("execution API routes are explicit and protected", () => {
  assert.equal(isFrontOperationsPath("/api/v1/execution/overview"), true);
  assert.equal(isFrontOperationsPath("/api/v1/execution/intents/intent_123"), true);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/execution/actions", "POST"), true);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/execution/bridge/heartbeat", "POST"), true);
  assert.equal(isFrontOperationsPath("/api/v1/execution/addon/snapshot"), true);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/execution/addon/events", "POST"), true);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/execution/overview", "POST"), false);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/execution/bridge/claim", "GET"), false);
});

test("signed AddOn routes validate shadow heartbeat and snapshots", async () => {
  const calls = [];
  const store = {
    recordNinjaAddonHeartbeat: async (input) => { calls.push(["heartbeat", input]); return { ok: true }; },
    recordNinjaAddonSnapshot: async (input) => { calls.push(["snapshot", input]); return { ok: true }; },
  };
  await handleFrontOperations(store, {
    pathname: "/api/v1/execution/addon/heartbeat", method: "POST", actor: { kind: "ninja_addon" },
    body: { bridgeId: "addon_123", brokerAccountId: "ninjatrader_paper_local", mode: "sim101_addon_approved_only", ninjaConnected: true, commandEnabled: false, accountName: "Sim101", protocolVersion: "desk_ninja_addon_v1", capabilities: { snapshots: true } },
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/execution/addon/snapshot", method: "POST", actor: { kind: "ninja_addon" },
    body: { bridgeId: "addon_123", reconcile: false, lockOnDivergence: false, snapshot: { captured_at: "2026-07-22T14:00:00.000Z", connection: {}, account: {}, orders: [], positions: [] } },
  });
  assert.equal(calls[0][1].commandEnabled, false);
  assert.equal(calls[1][1].reconcile, false);
});

test("execution API validates and delegates safe actions", async () => {
  const calls = [];
  const store = {
    executeBrokerAction: async (input) => { calls.push(input); return { ok: true }; },
  };
  const result = await handleFrontOperations(store, {
    pathname: "/api/v1/execution/actions",
    method: "POST",
    body: { action: "kill_switch", locked: true, confirmationPhrase: "ENGAGE_KILL_SWITCH", reason: "test operator safety" },
    actor: { kind: "test" },
  });
  assert.equal(result.ok, true);
  assert.equal(calls[0].input.action, "kill_switch");
});

test("execution API rejects an approval without the exact Sim101 phrase", async () => {
  await assert.rejects(
    () => handleFrontOperations({ executeBrokerAction: async () => ({}) }, {
      pathname: "/api/v1/execution/actions",
      method: "POST",
      body: { action: "approve", intentId: "intent_123456", idempotencyKey: "idem_123456", confirmationPhrase: "CONFIRM", reason: "test" },
      actor: {},
    }),
    (error) => error.code === "INVALID_EXECUTION_ACTION" && error.statusCode === 400,
  );
});

test("execution API validates a position management approval", async () => {
  const calls = [];
  const result = await handleFrontOperations({ executeBrokerAction: async (input) => { calls.push(input); return { ok: true }; } }, {
    pathname: "/api/v1/execution/actions", method: "POST",
    body: { action: "approve_management", managementIntentId: "management_intent_123", idempotencyKey: "management_idem_123", confirmationPhrase: "CONFIRM_SIM101_MANAGEMENT", reason: "operator validates break-even" },
    actor: { kind: "test" },
  });
  assert.equal(result.ok, true);
  assert.equal(calls[0].input.action, "approve_management");
});

test("bridge events require exactly one entry or management intent", async () => {
  await assert.rejects(
    () => handleFrontOperations({ recordBrokerExecutionEvent: async () => ({}) }, {
      pathname: "/api/v1/execution/bridge/events", method: "POST",
      body: { intentId: "order_intent_123", managementIntentId: "management_intent_123", update: { order_id: "order_intent_123", status: "Working" } }, actor: {},
    }),
    (error) => error.code === "INVALID_BRIDGE_EVENT" && error.statusCode === 400,
  );
});

test("execution API validates and delegates the complete sizing policy", async () => {
  const calls = [];
  const result = await handleFrontOperations({ executeBrokerAction: async (input) => { calls.push(input); return { ok: true }; } }, {
    pathname: "/api/v1/execution/actions",
    method: "POST",
    body: {
      action: "configure_sizing", policyProfileId: "ninjatrader_sim101_local", expectedRevision: 2,
      riskPercent: 0.25, maxDecisionAgeSeconds: 90, fallbackCapitalEnabled: true, fallbackCapital: 25_000,
      idempotencyKey: "sizing_idem_123", confirmationPhrase: "CONFIRM_SIM101_SIZING_POLICY", reason: "operator sizing update",
    },
    actor: { kind: "test" },
  });
  assert.equal(result.ok, true);
  assert.equal(calls[0].input.riskPercent, 0.25);
  assert.equal(calls[0].input.maxRoundingExcessPercent, 0.25);
  assert.equal(calls[0].input.maxDecisionAgeSeconds, 90);
  assert.equal(calls[0].input.fallbackCapital, 25_000);
});

test("execution API validates AUTO and SEMI_AUTO policy changes", async () => {
  const calls = [];
  const result = await handleFrontOperations({ executeBrokerAction: async (input) => { calls.push(input); return { ok: true }; } }, {
    pathname: "/api/v1/execution/actions",
    method: "POST",
    body: {
      action: "configure_execution_mode", policyProfileId: "ninjatrader_sim101_local", expectedRevision: 4,
      mode: "auto", idempotencyKey: "execution_mode_idem_123",
      confirmationPhrase: "CONFIRM_SIM101_EXECUTION_MODE", reason: "activate autonomous Sim101 entries",
    },
    actor: { kind: "test" },
  });
  assert.equal(result.ok, true);
  assert.equal(calls[0].input.mode, "auto");
});

test("execution API validates the NinjaTrader autostart operator action", async () => {
  const calls = [];
  const result = await handleFrontOperations({ executeBrokerAction: async (input) => { calls.push(input); return { ok: true }; } }, {
    pathname: "/api/v1/execution/actions",
    method: "POST",
    body: {
      action: "configure_ninjatrader_startup",
      enabled: true,
      expectedRevision: 3,
      idempotencyKey: "startup_idem_123",
      confirmationPhrase: "CONFIRM_NINJATRADER_AUTOSTART",
      reason: "operator enables unattended NinjaTrader restart",
    },
    actor: { kind: "test" },
  });
  assert.equal(result.ok, true);
  assert.equal(calls[0].input.enabled, true);
  assert.equal(calls[0].input.expectedRevision, 3);
});

test("execution API rejects unsafe sizing ranges", async () => {
  await assert.rejects(
    () => handleFrontOperations({ executeBrokerAction: async () => ({}) }, {
      pathname: "/api/v1/execution/actions", method: "POST",
      body: {
        action: "configure_sizing", policyProfileId: "ninjatrader_sim101_local", expectedRevision: 0,
        riskPercent: 1.5, fallbackCapitalEnabled: true, fallbackCapital: 50,
        idempotencyKey: "sizing_idem_456", confirmationPhrase: "CONFIRM_SIM101_SIZING_POLICY", reason: "invalid sizing test",
      }, actor: {},
    }),
    (error) => error.code === "INVALID_EXECUTION_ACTION" && error.statusCode === 400,
  );
});

test("execution API rejects V5 sizing risk of 0.30%", async () => {
  await assert.rejects(
    () => handleFrontOperations({ executeBrokerAction: async () => ({}) }, {
      pathname: "/api/v1/execution/actions", method: "POST",
      body: {
        action: "configure_sizing", policyProfileId: "ninjatrader_sim101_local", expectedRevision: 0,
        riskPercent: 0.30, fallbackCapitalEnabled: false, fallbackCapital: 10_000,
        idempotencyKey: "sizing_v5_reject_030", confirmationPhrase: "CONFIRM_SIM101_SIZING_POLICY", reason: "verify V5 API risk cap",
      }, actor: {},
    }),
    (error) => error.code === "INVALID_EXECUTION_ACTION" && error.statusCode === 400,
  );
});
