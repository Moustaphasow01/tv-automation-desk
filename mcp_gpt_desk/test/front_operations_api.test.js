import assert from "node:assert/strict";
import test from "node:test";
import {
  handleFrontOperations,
  isFrontOperationsMethodAllowed,
  isFrontOperationsPath,
  isFrontOperationsWriteRequest,
} from "../src/front-operations-api.js";

test("operations router recognizes deep read and protected write routes", () => {
  assert.equal(isFrontOperationsPath("/api/v1/operations/summary"), true);
  assert.equal(isFrontOperationsPath("/api/v1/workflows/replay%3Arun-1/events"), true);
  assert.equal(isFrontOperationsPath("/api/v1/replays/run-1/days/2026-07-16"), true);
  assert.equal(isFrontOperationsPath("/api/v1/replays/run-1/sessions/run-2"), true);
  assert.equal(isFrontOperationsPath("/api/v1/history/sessions/2026-07-16%3Aasia_open"), true);
  assert.equal(isFrontOperationsPath("/api/v1/observability/overview"), true);
  assert.equal(isFrontOperationsPath("/api/v1/observability/policy"), true);
  assert.equal(isFrontOperationsPath("/api/v1/ai/runtime-settings"), true);
  assert.equal(isFrontOperationsPath("/api/v1/observability/incidents/evaluate"), true);
  assert.equal(isFrontOperationsPath("/api/v1/notifications"), true);
  assert.equal(isFrontOperationsPath("/api/v1/notifications/sync"), true);
  assert.equal(isFrontOperationsPath("/api/v1/notifications/notification%3Aabc/actions"), true);
  assert.equal(isFrontOperationsPath("/api/v1/telegram"), true);
  assert.equal(isFrontOperationsPath("/api/v1/telegram/actions"), true);
  assert.equal(isFrontOperationsPath("/api/v1/runbooks"), true);
  assert.equal(isFrontOperationsPath("/api/v1/runbooks/runbook%3Aabc"), true);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/observability/policy", "POST"), true);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/ai/runtime-settings", "POST"), true);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/observability/incidents/evaluate", "POST"), true);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/notifications/sync", "POST"), true);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/notifications/notification%3Aabc/actions", "POST"), true);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/telegram/actions", "POST"), true);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/telegram", "POST"), false);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/telegram/actions", "GET"), false);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/observability/policy", "POST"), true);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/ai/runtime-settings", "GET"), true);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/ai/runtime-settings", "POST"), true);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/observability/incidents/evaluate", "GET"), false);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/notifications/sync", "GET"), false);
  assert.equal(isFrontOperationsWriteRequest("/api/v1/workflows/run-1/actions", "POST"), true);
  assert.equal(isFrontOperationsMethodAllowed("/api/v1/workflows/run-1/actions", "GET"), false);
});

test("operations router validates and delegates Codex runtime settings", async () => {
  const calls = [];
  const store = {
    async getOperationsAiRuntimeSettings() {
      return { contract: "DeskAiRuntimeSettings", settings: { reasoningEffort: "xhigh" } };
    },
    async executeOperationsAiRuntimeSettingsAction(input) {
      calls.push(input);
      return { contract: "DeskOperationsCommandResult" };
    },
  };

  const current = await handleFrontOperations(store, {
    pathname: "/api/v1/ai/runtime-settings",
    method: "GET",
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/ai/runtime-settings",
    method: "POST",
    actor: { kind: "operator" },
    body: {
      action: "update_reasoning_effort",
      expectedRevision: 0,
      reasoningEffort: "xhigh",
      idempotencyKey: "codex-effort-1",
      confirmationPhrase: "CONFIRM_UPDATE_REASONING_EFFORT",
      reason: "Renforcer les analyses",
    },
  });

  assert.equal(current.settings.reasoningEffort, "xhigh");
  assert.equal(calls[0].input.reasoningEffort, "xhigh");
  assert.equal(calls[0].actor.kind, "operator");
});

test("operations router validates and delegates Telegram controls", async () => {
  const calls = [];
  const store = {
    async getTelegramStatus() { return { contract: "DeskTelegramStatus" }; },
    async executeTelegramAction(input) { calls.push(input); return { ok: true }; },
  };
  const status = await handleFrontOperations(store, {
    pathname: "/api/v1/telegram",
    method: "GET",
  });
  await handleFrontOperations(store, {
    pathname: "/api/v1/telegram/actions",
    method: "POST",
    actor: { kind: "operator" },
    body: {
      action: "configure",
      expectedRevision: 0,
      enabled: true,
      adminEnabled: true,
      tradingEnabled: true,
      commandsEnabled: true,
      idempotencyKey: "telegram-config-1",
      confirmationPhrase: "CONFIRM_TELEGRAM_CONFIGURATION",
      reason: "Activer les deux canaux",
    },
  });
  assert.equal(status.contract, "DeskTelegramStatus");
  assert.equal(calls[0].input.enabled, true);
  assert.equal(calls[0].actor.kind, "operator");
  await assert.rejects(
    handleFrontOperations(store, {
      pathname: "/api/v1/telegram/actions",
      method: "POST",
      body: {
        action: "test",
        profile: "admin",
        idempotencyKey: "telegram-test-1",
        confirmationPhrase: "WRONG",
        reason: "Tester",
      },
    }),
    (error) => error.code === "INVALID_TELEGRAM_ACTION",
  );
});

test("operations router delegates normalized workflow IDs and filters", async () => {
  const calls = [];
  const store = {
    async listOperationsWorkflows(input) { calls.push(input); return { ok: true }; },
    async getOperationsWorkflow({ workflow_id }) { return { workflow: { id: workflow_id }, steps: [], events: [] }; },
  };
  await handleFrontOperations(store, { pathname: "/api/v1/workflows", method: "GET", query: { status: "running", strategy_id: "asia_open", limit: "25" } });
  const detail = await handleFrontOperations(store, { pathname: "/api/v1/workflows/replay%3Arun-1", method: "GET" });
  assert.deepEqual(calls[0], {
    kind: null,
    scope: null,
    workflow: null,
    worker: null,
    model: null,
    provider: null,
    status: "running",
    level: null,
    session: null,
    strategyId: "asia_open",
    versionScope: null,
    instrument: null,
    direction: null,
    date: null,
    from: null,
    to: null,
    runId: null,
    process: null,
    incident: null,
    runbook: null,
    target: null,
    q: null,
    limit: 25,
  });
  assert.equal(detail.workflow.id, "replay:run-1");
});

test("operations router delegates notification listing, sync and actions", async () => {
  const calls = [];
  const store = {
    async listOperationsNotifications(input) { calls.push(["list", input]); return { contract: "DeskNotificationList" }; },
    async syncOperationsNotifications(input) { calls.push(["sync", input]); return { contract: "DeskNotificationSync" }; },
    async executeOperationsNotificationAction(input) { calls.push(["action", input]); return { contract: "DeskOperationsCommandResult" }; },
  };
  const list = await handleFrontOperations(store, {
    pathname: "/api/v1/notifications",
    method: "GET",
    query: { status: "active", level: "page", q: "lease" },
  });
  const sync = await handleFrontOperations(store, {
    pathname: "/api/v1/notifications/sync",
    method: "POST",
    body: { autoClear: false, reason: "sync ciblée" },
    actor: { kind: "test" },
  });
  const action = await handleFrontOperations(store, {
    pathname: "/api/v1/notifications/notification%3An1/actions",
    method: "POST",
    body: { action: "mark_read", expectedRevision: 1, idempotencyKey: "notif-read-1", confirmationPhrase: "CONFIRM_MARK_READ", reason: "vu" },
    actor: { kind: "operator" },
  });
  assert.equal(list.contract, "DeskNotificationList");
  assert.equal(sync.contract, "DeskNotificationSync");
  assert.equal(action.contract, "DeskOperationsCommandResult");
  assert.equal(calls[0][1].level, "page");
  assert.equal(calls[1][1].input.autoClear, false);
  assert.deepEqual(calls[2][1].notification_id, "notification:n1");
  assert.equal(calls[2][1].actor.kind, "operator");

  await assert.rejects(
    handleFrontOperations(store, { pathname: "/api/v1/notifications/sync", method: "POST", body: { reason: "no" } }),
    (error) => error.code === "INVALID_NOTIFICATION_SYNC",
  );
});

test("operations router delegates runbooks list and detail", async () => {
  const calls = [];
  const store = {
    async listOperationsRunbooks(input) { calls.push(["list", input]); return { contract: "DeskRunbookList" }; },
    async getOperationsRunbook(input) { calls.push(["detail", input]); return { contract: "DeskRunbookDetail" }; },
  };
  const list = await handleFrontOperations(store, {
    pathname: "/api/v1/runbooks",
    method: "GET",
    query: { kind: "lease_expired", status: "action_required", q: "lease" },
  });
  const detail = await handleFrontOperations(store, {
    pathname: "/api/v1/runbooks/runbook%3Aabc",
    method: "GET",
  });
  assert.equal(list.contract, "DeskRunbookList");
  assert.equal(detail.contract, "DeskRunbookDetail");
  assert.equal(calls[0][1].kind, "lease_expired");
  assert.equal(calls[0][1].status, "action_required");
  assert.deepEqual(calls[1][1], { runbook_id: "runbook:abc" });
});

test("operations router delegates observability dimensions", async () => {
  const calls = [];
  const store = {
    async getOperationsObservability(input) { calls.push(input); return { contract: "DeskObservabilityOverview" }; },
  };
  const result = await handleFrontOperations(store, {
    pathname: "/api/v1/observability/overview",
    method: "GET",
    query: { scope: "replay", worker: "worker-a", model: "gpt-5", provider: "openai" },
  });
  assert.equal(result.contract, "DeskObservabilityOverview");
  assert.equal(calls[0].scope, "replay");
  assert.equal(calls[0].worker, "worker-a");
  assert.equal(calls[0].model, "gpt-5");
  assert.equal(calls[0].provider, "openai");
});

test("operations router validates and delegates observability policy updates", async () => {
  const calls = [];
  const store = {
    async executeOperationsObservabilityPolicyAction(input) { calls.push(input); return { contract: "DeskOperationsCommandResult" }; },
  };
  const body = {
    action: "update",
    expectedRevision: 0,
    idempotencyKey: "guardrail-policy-v1",
    confirmationPhrase: "CONFIRM_UPDATE",
    reason: "Configurer les garde-fous",
    policy: { dailyCostBudgetUsd: 1.5 },
  };
  const result = await handleFrontOperations(store, {
    pathname: "/api/v1/observability/policy",
    method: "POST",
    body,
    actor: { kind: "test" },
  });
  assert.equal(result.contract, "DeskOperationsCommandResult");
  assert.equal(calls[0].input.policy.dailyCostBudgetUsd, 1.5);
  await assert.rejects(
    handleFrontOperations(store, {
      pathname: "/api/v1/observability/policy",
      method: "POST",
      body: { ...body, confirmationPhrase: "WRONG" },
    }),
    (error) => error.code === "INVALID_OBSERVABILITY_POLICY",
  );
});

test("operations router delegates observability incident evaluation", async () => {
  const calls = [];
  const store = {
    async evaluateOperationsObservabilityIncidents(input) { calls.push(input); return { contract: "DeskObservabilityIncidentSync" }; },
  };
  const result = await handleFrontOperations(store, {
    pathname: "/api/v1/observability/incidents/evaluate",
    method: "POST",
    body: { autoResolve: false, reason: "Matérialiser les incidents" },
    actor: { kind: "test" },
  });
  assert.equal(result.contract, "DeskObservabilityIncidentSync");
  assert.equal(calls[0].input.autoResolve, false);
  assert.equal(calls[0].actor.kind, "test");
  await assert.rejects(
    handleFrontOperations(store, {
      pathname: "/api/v1/observability/incidents/evaluate",
      method: "POST",
      body: { reason: "no" },
    }),
    (error) => error.code === "INVALID_OBSERVABILITY_INCIDENT_EVALUATION",
  );
});

test("operations router delegates a decoded history session ID", async () => {
  const calls = [];
  const store = {
    async getOperationsHistorySession(input) { calls.push(input); return { contract: "DeskHistorySessionDetail" }; },
  };
  const result = await handleFrontOperations(store, {
    pathname: "/api/v1/history/sessions/2026-07-16%3Aasia_open",
    method: "GET",
  });
  assert.equal(result.contract, "DeskHistorySessionDetail");
  assert.deepEqual(calls, [{ session_id: "2026-07-16:asia_open" }]);
});

test("replay creation rejects incomplete input before reaching the store", async () => {
  const store = { async createOrchestratedReplayDay() { throw new Error("must_not_be_called"); } };
  await assert.rejects(
    handleFrontOperations(store, { pathname: "/api/v1/replays", method: "POST", body: { backtest_id: "run-1" } }),
    (error) => error.code === "INVALID_REPLAY_CREATE_INPUT" && error.statusCode === 400,
  );
});

test("replay creation delegates a Paris timezone by default", async () => {
  const calls = [];
  const store = {
    async createOrchestratedReplayDay(input) {
      calls.push(input);
      return { ok: true, backtest_id: input.backtest_id };
    },
  };
  const result = await handleFrontOperations(store, {
    pathname: "/api/v1/replays",
    method: "POST",
    body: {
      backtest_id: "run-1",
      strategy_id: "asia_open",
      trading_date: "2026-07-06",
      session: "asia_open",
      pack_id: "pack-1",
      pack_build_id: "pack-build-1",
      start_time: "2026-07-06T02:00:00+02:00",
      end_time: "2026-07-06T03:00:00+02:00",
      cadence: "15m",
      automation_enabled: false,
      idempotency_key: "replay-create-v1",
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls[0].timezone, "Europe/Paris");
  assert.equal(calls[0].cutoff_paris, "2026-07-06T02:00:00+02:00");
});
