import assert from "node:assert/strict";
import test from "node:test";
import {
  FRONT_CONTROL_PLANE_COMMANDS_PATH,
  FRONT_CONTROL_PLANE_CAPABILITIES_PATH,
  FRONT_CONTROL_PLANE_EVENTS_PATH,
  handleFrontControlPlane,
  isFrontControlPlaneMethodAllowed,
  isFrontControlPlanePath,
  isFrontControlPlaneWriteRequest,
  frontControlPlaneSseFrame,
  loadFrontControlPlaneRealtimeEvents,
} from "../src/front-control-plane-api.js";
import { DomainAssistantRuntimeService } from "../src/domain-assistant-runtime-service.js";
import { InMemoryDomainAssistantRuntimeRepository } from "../src/domain-assistant-runtime-repository.js";

const viewNames = [
  "auth-session", "operator-settings", "admin-access", "command-center", "demo-paper-readiness", "events-audit",
  "operations-queue", "research-agent-fleet", "research-compute-scheduler", "research-data-catalog",
  "research-experiment-detail", "research-run-detail", "research-lab", "strategy-center",
  "strategy-detail", "strategy-compare", "live-trading", "live-signal-detail", "orders", "risk",
  "order-detail", "position-detail", "incident-detail",
  "execution-providers", "execution-incidents", "portfolio", "jarvis-workspace",
  "sessions", "live-plan", "live-news", "live-timeline", "execution-reconciliation", "operations-observability",
  "research-experiments", "research-candidates", "research-dataset-detail", "strategy-deployments",
  "replay-overview", "replay-runs", "replay-run-detail", "replay-compare",
  "performance-overview", "performance-calendar", "performance-day-detail", "performance-strategies", "performance-trades",
  "workflow-detail", "event-detail", "operations-runbooks", "governance-prompts", "governance-policies",
];

test("front control plane router exposes views, commands and realtime events only on intended methods", () => {
  assert.equal(isFrontControlPlanePath("/front-api/v1/views/command-center"), true);
  assert.equal(isFrontControlPlanePath(FRONT_CONTROL_PLANE_COMMANDS_PATH), true);
  assert.equal(isFrontControlPlanePath(FRONT_CONTROL_PLANE_EVENTS_PATH), true);
  assert.equal(isFrontControlPlanePath(FRONT_CONTROL_PLANE_CAPABILITIES_PATH), true);
  assert.equal(isFrontControlPlanePath("/api/v1/operations/summary"), false);

  assert.equal(isFrontControlPlaneMethodAllowed("/front-api/v1/views/command-center", "GET"), true);
  assert.equal(isFrontControlPlaneMethodAllowed("/front-api/v1/views/command-center", "POST"), false);
  assert.equal(isFrontControlPlaneMethodAllowed(FRONT_CONTROL_PLANE_COMMANDS_PATH, "POST"), true);
  assert.equal(isFrontControlPlaneMethodAllowed(FRONT_CONTROL_PLANE_COMMANDS_PATH, "GET"), false);
  assert.equal(isFrontControlPlaneMethodAllowed(FRONT_CONTROL_PLANE_EVENTS_PATH, "GET"), true);
  assert.equal(isFrontControlPlaneMethodAllowed(FRONT_CONTROL_PLANE_CAPABILITIES_PATH, "GET"), true);
  assert.equal(isFrontControlPlaneWriteRequest(FRONT_CONTROL_PLANE_COMMANDS_PATH, "POST"), true);
});

test("front control plane publishes only executable catalogued actions", async () => {
  const readOnly = await handleFrontControlPlane({}, { pathname: FRONT_CONTROL_PLANE_CAPABILITIES_PATH, actor: { kind: "rest_read", scopes: ["desk.read"] } });
  const operator = await handleFrontControlPlane({}, { pathname: FRONT_CONTROL_PLANE_CAPABILITIES_PATH, actor: { kind: "operator_session", scopes: ["desk.read", "desk.write"] } });
  assert.deepEqual(readOnly.actions.map((item) => item.commandType).sort(), [
    "assistant.question.submit",
    "control_plane.verify",
    "desk.doctor",
    "desk.restart",
    "desk.start",
    "desk.status",
    "desk.stop",
    "execution.order_intent.confirm",
    "execution.order_intent.reject",
    "research.bootstrap_demo_paper",
    "strategy.version.fork",
  ]);
  assert.equal(readOnly.actions.every((item) => item.allowed === false), true);
  assert.equal(operator.actions.every((item) => item.allowed === true), true);
  assert.equal(operator.actions.every((item) => item.brokerExecution === false), true);
});

test("front control plane returns stable envelopes for every VNext view", async () => {
  const store = frontControlPlaneStore();

  for (const viewName of viewNames) {
    const detailQuery = {
      "research-experiment-detail": { experimentId: "exp-1" },
      "research-run-detail": { runId: "sim-1" },
      "strategy-detail": { strategyId: "strdef-1" },
      "strategy-compare": { strategyId: "strdef-compare" },
      "live-signal-detail": { signalId: "signal-1" },
      "order-detail": { orderId: "nt-1" },
      "position-detail": { positionId: "trade-1" },
      "incident-detail": { incidentId: "incident-1" },
      "research-dataset-detail": { datasetId: "dataset-1" },
      "replay-run-detail": { runId: "replay-1" },
      "performance-day-detail": { dayId: "2026-08-11" },
      "workflow-detail": { workflowId: "workflow-1" },
      "event-detail": { eventId: "event-1", strategyId: "asia_open" },
    }[viewName] || {};
    const envelope = await handleFrontControlPlane(store, {
      pathname: `/front-api/v1/views/${viewName}`,
      method: "GET",
      query: { trading_date: "2026-08-11", session: "ny_open", mode: "paper", ...detailQuery },
    });

    assert.equal(envelope.meta.schemaVersion, "1.0.0");
    assert.equal(typeof envelope.meta.correlationId, "string");
    assert.equal(Array.isArray(envelope.permissions), true);
    assert.equal(typeof envelope.data, "object", viewName);
  }
});

test("front control plane Jarvis workspace is a grounded read-only supervisor", async () => {
  const envelope = await handleFrontControlPlane(frontControlPlaneStore(), {
    pathname: "/front-api/v1/views/jarvis-workspace",
    method: "GET",
    query: { trading_date: "2026-08-11", session: "ny_open", mode: "paper" },
    actor: { kind: "operator_session", scopes: ["desk.read", "desk.write"] },
  });

  assert.equal(envelope.meta.warnings.some((warning) => warning.includes("jarvis-workspace:NOT_IMPLEMENTED")), false);
  assert.deepEqual(envelope.meta.sources, [
      { source: "ai-context", state: "AVAILABLE" },
      { source: "incidents", state: "AVAILABLE" },
      { source: "agent-runtime", state: "AVAILABLE" },
      { source: "assistant-runtime", state: "AVAILABLE" },
      { source: "research", state: "AVAILABLE" },
      { source: "data-foundation", state: "AVAILABLE" },
      { source: "execution", state: "AVAILABLE" },
    { source: "strategy", state: "AVAILABLE" },
    { source: "portfolio-risk", state: "AVAILABLE" },
    { source: "health", state: "AVAILABLE" },
  ]);
  assert.equal(envelope.data.summary.activeAgents, 6);
  assert.deepEqual(envelope.data.missions.map((mission) => mission.missionId), [
    "assistant_research",
    "assistant_live_runtime",
    "assistant_portfolio_risk",
    "assistant_execution",
    "assistant_data",
    "assistant_platform_ops",
  ]);
  assert.equal(envelope.data.deskSnapshot.liveSignals, 1);
  assert.equal(envelope.data.deskSnapshot.researchExperiments, 1);
  assert.equal(envelope.data.deskSnapshot.providersTotal, 1);
  assert.equal(envelope.data.deskSnapshot.openIncidents, 1);
  assert.equal(envelope.data.pendingActions.length, 0);
  assert.equal(envelope.data.commands.length, 0);
  assert.equal(envelope.data.voice.serviceStatus, "OFF");
  assert.equal(envelope.data.morningBrief.some((section) => section.domain === "Risk" && section.detail.includes("Jarvis ne publie ni Target Position ni OrderIntent")), true);
  assert.equal(envelope.data.conversation[0]?.role, "system");
  assert.equal(envelope.data.conversation[0]?.text.includes("ne contourne jamais Risk, Portfolio, Human Gate ou Execution"), true);
});

test("front control plane Jarvis view restores persisted assistant conversation messages", async () => {
  const envelope = await handleFrontControlPlane(frontControlPlaneStore({
    assistantRuntime: {
      messages: [
        { messageId: "asst_msg_operator", role: "operator", at: "2026-08-11T08:01:00.000Z", text: "Explique le risque.", citationIds: ["src_portfolio_risk"] },
        { messageId: "asst_msg_answer", role: "assistant", at: "2026-08-11T08:01:05.000Z", text: "Risque lu en lecture seule, aucun ordre créé.", citationIds: ["src_portfolio_risk"] },
      ],
    },
  }), {
    pathname: "/front-api/v1/views/jarvis-workspace",
    method: "GET",
    query: { trading_date: "2026-08-11", session: "ny_open", mode: "paper" },
    actor: { kind: "operator_session", scopes: ["desk.read", "desk.write"] },
  });

  assert.equal(envelope.data.conversation.at(-2).role, "operator");
  assert.equal(envelope.data.conversation.at(-1).role, "jarvis");
  assert.equal(envelope.data.conversation.at(-1).text, "Risque lu en lecture seule, aucun ordre créé.");
});

test("front control plane realtime maps assistant FRONT_REALTIME outbox to Jarvis message events with cursor recovery", async () => {
  const store = {
    async listFrontRealtimeEvents({ cursor }) {
      const events = [
        {
          eventId: "asst_evt_1",
          aggregateId: "asst_conv_1",
          aggregateType: "assistant_conversation",
          eventType: "jarvis.message.created",
          occurredAt: "2026-08-11T08:01:05.000Z",
          source: "domain-assistant-runtime",
          correlationId: "asst_task_1",
          causationId: "asst_task_1",
          schemaVersion: "1.0.0",
          sequence: 1,
          payload: { brokerExecution: false, orderSubmissionEnabled: false },
        },
        {
          eventId: "asst_evt_2",
          aggregateId: "asst_conv_1",
          aggregateType: "assistant_conversation",
          eventType: "jarvis.message.created",
          occurredAt: "2026-08-11T08:02:05.000Z",
          source: "domain-assistant-runtime",
          correlationId: "asst_task_2",
          causationId: "asst_task_2",
          schemaVersion: "1.0.0",
          sequence: 2,
          payload: { brokerExecution: false, orderSubmissionEnabled: false },
        },
      ];
      const index = events.findIndex((event) => event.eventId === cursor);
      return index >= 0 ? events.slice(index + 1) : events;
    },
  };

  const first = await loadFrontControlPlaneRealtimeEvents(store, { cursor: "", limit: 10 });
  const resumed = await loadFrontControlPlaneRealtimeEvents(store, { cursor: "asst_evt_1", limit: 10 });
  const frame = frontControlPlaneSseFrame(first[0]);

  assert.equal(first.length, 2);
  assert.equal(resumed.length, 1);
  assert.equal(resumed[0].eventId, "asst_evt_2");
  assert.match(frame, /^id: asst_evt_1\nevent: message\ndata: /);
  assert.equal(first[0].payload.brokerExecution, false);
});

test("front control plane realtime preserves durable journal order across aggregate-local sequences", async () => {
  const store = {
    async listFrontRealtimeEvents() {
      return {
        events: [
          { eventId: "evt_intent_8", aggregateId: "intent-1", aggregateType: "OrderIntent", eventType: "order_intent.created", occurredAt: "2026-08-11T08:01:00.000Z", correlationId: "corr_1", schemaVersion: "1.0.0", sequence: 8, payload: {} },
          { eventId: "evt_signal_1", aggregateId: "signal-2", aggregateType: "StrategySignal", eventType: "strategy.signal.created", occurredAt: "2026-08-11T08:02:00.000Z", correlationId: "corr_2", schemaVersion: "1.0.0", sequence: 1, payload: {} },
        ],
        resyncRequired: false,
      };
    },
  };

  const events = await loadFrontControlPlaneRealtimeEvents(store, { cursor: "", limit: 10 });

  assert.deepEqual(events.map((event) => event.eventId), ["evt_intent_8", "evt_signal_1"]);
});

test("front control plane realtime requires snapshot resync when persisted cursor is unknown", async () => {
  const queries = [];
  const store = {
    persistence: {
      pool: {
        async query(sql, params) {
          queries.push({ sql, params });
          return { rows: [] };
        },
      },
    },
  };

  const events = await loadFrontControlPlaneRealtimeEvents(store, { cursor: "expired-cursor", limit: 10 });

  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "desk.resync_required");
  assert.equal(events[0].payload.reason, "CURSOR_NOT_FOUND_OR_EXPIRED");
  assert.equal(events[0].payload.brokerExecution, false);
  assert.equal(events[0].payload.orderSubmissionEnabled, false);
  assert.equal(queries.length, 1);
});

test("front control plane live trading exposes canonical semi-manual pipeline without provider side effect", async () => {
  const store = frontControlPlaneStore({
    execution: {
      safety: { executionEnabled: false, submissionPossible: false, liveAccountAllowed: false, executionAuthorityMode: "semi_auto", entryOperatorApprovalRequired: true },
      providerCommands: [],
      providerEvents: [],
      portfolioOrderIntents: [{
        portfolio_order_intent_id: "portfolio_order_intent_live_1",
        target_position_id: "target_position_live_1",
        target_account_id: "Sim101",
        target_instrument: "MNQ",
        risk_approved_net_size: 1,
        quantity: 1,
        status: "READY",
        broker_submission_allowed: false,
        order_intent_hash: "sha256:live111111111111111111111111111111111111111111111111111111111111",
        immutable_terms_hash: "sha256:live222222222222222222222222222222222222222222222222222222222222",
        execution_terms: { instrument: "MNQ", side: "BUY", quantity: 1, order_type: "LIMIT", entry: { availability: "KNOWN", price: 21450.25 }, stop: { availability: "KNOWN", price: 21410.25 }, targets: [{ label: "T1", price: 21490.25 }], time_in_force: "DAY" },
        risk_snapshot: { authorizedQty: 1, riskAmount: 40, riskPerContract: 40, stopDistance: { points: 20, ticks: 80 } },
        immutability: { policy: "REJECT_AND_REPLAN", mutable_after_risk: false },
        risk_decisions: [{ risk_decision_id: "risk-live-1", decision: "APPROVED", status: "PASS", authorized: { risk_amount: 40, risk_pct: 0.04 }, trade_risk: { risk_per_contract: 40 } }],
        order_intent_payload: {
          order_intent_id: "portfolio_order_intent_live_1",
          target_position_id: "target_position_live_1",
          strategy_instance_id: "strinst-1",
          signal_id: "signal-live-1",
          account_id: "Sim101",
          broker_account_id: "Sim101",
          instrument: "MNQ",
          action: "BUY",
          quantity: 1,
          order_type: "LIMIT",
          time_in_force: "DAY",
          status: "READY",
          broker_submission_allowed: false,
        },
      }],
      humanExecutionGates: [{
        human_execution_gate_id: "human_gate_live_1",
        portfolio_order_intent_id: "portfolio_order_intent_live_1",
        status: "AWAITING_MANUAL_CONFIRMATION",
        revision: 3,
      }],
    },
  });
  store.getStrategyV2Overview = async () => ({
    definitions: [{ strategy_definition_id: "strdef-1", name: "Breakout Retest", family: "index" }],
    versions: [{ strategy_version_id: "strver-1", strategy_definition_id: "strdef-1", version_label: "v1", status: "VALIDATED" }],
    instances: [{ strategy_instance_id: "strinst-1", strategy_definition_id: "strdef-1", strategy_version_id: "strver-1", execution_mode: "PAPER", runtime_state: "RUNNING", next_evaluation_at_utc: "2026-08-11T08:05:00.000Z" }],
    signals: [{
      signal_id: "signal-live-1",
      strategy_definition_id: "strdef-1",
      strategy_version_id: "strver-1",
      strategy_instance_id: "strinst-1",
      instrument_code: "MNQ",
      side: "long",
      confidence: 72,
      created_at_utc: "2026-08-11T08:00:00.000Z",
      source_data_cutoff_utc: "2026-08-11T07:59:00.000Z",
      proposed_trade_plan: { order_type: "LIMIT", entry: { price: 21450.25 }, stop: { price: 21410.25 }, targets: [{ price: 21490.25 }] },
      trade_plan_economics: { risk_per_contract: 40 },
    }],
  });
  store.listAiContextGateDecisions = async () => ({
    items: [{
      ai_context_gate_decision_id: "ctx-live-1",
      signal_id: "signal-live-1",
      status: "COMPLETED",
      mode: "SHADOW",
      recommendation: "TAKE",
      confidence: 0.67,
      risk_multiplier: 0.5,
      decided_at_utc: "2026-08-11T08:00:20.000Z",
      reason_codes: ["CONTEXT_OK"],
    }],
  });
  store.health = async () => coldStartReadyHealth();

  const envelope = await handleFrontControlPlane(store, {
    pathname: "/front-api/v1/views/live-trading",
    query: { trading_date: "2026-08-11", session: "ny_open", mode: "paper" },
    actor: { kind: "operator_session", scopes: ["desk.read", "desk.write"] },
  });

  assert.equal(envelope.data.canonicalRuntime.schemaVersion, "live_canonical_runtime_v1");
  assert.equal(envelope.data.canonicalRuntime.mode.executionMode, "SEMI_MANUAL");
  assert.equal(envelope.data.canonicalRuntime.mode.autoExecutionEnabled, false);
  assert.equal(envelope.data.canonicalRuntime.mode.ackIsFill, false);
  assert.equal(envelope.data.canonicalRuntime.pipeline.find((step) => step.stepId === "ORDER_INTENT")?.status, "OK");
  assert.equal(envelope.data.canonicalRuntime.pipeline.find((step) => step.stepId === "EXECUTION_GATEWAY")?.status, "BLOCKED");
  assert.equal(envelope.data.summary.providerCommandsCreated, 0);
  assert.equal(envelope.data.portfolioOrderIntents[0].providerCommandCount, 0);
  assert.equal(envelope.data.portfolioOrderIntents[0].ackIsFill, false);
  assert.equal(envelope.data.signals[0].proposedTradePlan.entry.price, 21450.25);
  assert.equal(envelope.data.timeSeriesContracts.schemaVersion, "front_time_series_contracts_v1");
  assert.equal(envelope.data.timeSeriesContracts.series.find((series) => series.seriesId === "trading.order_intent_overlays")?.availability, "KNOWN");
  assert.equal(envelope.data.timeSeriesContracts.series.find((series) => series.seriesId === "market.ohlcv")?.availability, "UNAVAILABLE");
  assert.equal(envelope.data.telegramDrilldown.schemaVersion, "telegram_drilldown_front_v1");
  assert.equal(envelope.data.telegramDrilldown.availability, "KNOWN");
  assert.equal(envelope.data.telegramDrilldown.secretsExposed, false);

  const commandCenter = await handleFrontControlPlane(store, {
    pathname: "/front-api/v1/views/command-center",
    query: { trading_date: "2026-08-11", session: "ny_open", mode: "paper" },
  });
  assert.equal(commandCenter.data.signals.rows[0].gate, "TAKE");
  assert.equal(commandCenter.data.signals.rows[0].portfolioDecision, "READY");
  assert.equal(commandCenter.data.signals.rows[0].riskDecision, "PASS");
});

test("live trading reports healthy strategy instances as intentionally idle while the market is closed", async () => {
  const store = frontControlPlaneStore();
  store.getStrategyV2Overview = async () => ({
    definitions: [{ strategy_definition_id: "strdef-closed" }],
    versions: [{ strategy_version_id: "strver-closed", strategy_definition_id: "strdef-closed" }],
    instances: [{ strategy_instance_id: "strinst-closed", strategy_version_id: "strver-closed", execution_mode: "PAPER", runtime_state: "RUNNING", scheduler_health: "NOT_OBSERVED" }],
    signals: [],
  });
  store.health = async () => ({
    ...coldStartReadyHealth(),
    data_readiness: { ...coldStartReadyHealth().data_readiness, ok: true, state: "market_closed", market_closed: true },
    operations: { services: [{ service_id: "live_runtime_scheduler", service_kind: "live_runtime_scheduler", status: "healthy", healthy: true }] },
  });

  const envelope = await handleFrontControlPlane(store, {
    pathname: "/front-api/v1/views/live-trading",
    query: { trading_date: "2026-08-16", session: "asia_open", mode: "paper" },
  });

  assert.equal(envelope.data.canonicalRuntime.activeStrategyInstances[0].runtimeState, "MARKET_CLOSED");
  assert.equal(envelope.data.canonicalRuntime.activeStrategyInstances[0].schedulerHealth, "IDLE_MARKET_CLOSED");
  assert.equal(envelope.meta.warnings.includes("live-next-monitor:UNAVAILABLE"), false);
});

test("an OrderIntent without a persisted Human Gate is not exposed as operator-actionable", async () => {
  const portfolioOrderIntent = {
    portfolio_order_intent_id: "portfolio_order_intent_without_gate",
    target_position_id: "target_position_without_gate",
    target_account_id: "Sim101",
    target_instrument: "MNQ",
    risk_approved_net_size: 1,
    status: "READY",
    order_intent_hash: "sha256:no-gate",
    order_intent_payload: {
      order_intent_id: "portfolio_order_intent_without_gate",
      strategy_instance_id: "strategy-instance-without-gate",
      signal_id: "signal-without-gate",
      instrument: "MNQ",
      action: "BUY",
      quantity: 1,
      status: "READY",
    },
  };
  const store = frontControlPlaneStore({
    execution: {
      safety: { executionEnabled: false, submissionPossible: false, liveAccountAllowed: false, executionAuthorityMode: "semi_auto", entryOperatorApprovalRequired: true },
      portfolioOrderIntents: [portfolioOrderIntent],
      humanExecutionGates: [],
      providerCommands: [],
      providerEvents: [],
    },
  });
  const actor = { kind: "operator_session", scopes: ["desk.read", "desk.write"] };
  const commandCenter = await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/command-center", query: {}, actor });
  const live = await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/live-trading", query: {}, actor });

  assert.equal(commandCenter.data.humanGate.availability, "CONNECTED_EMPTY");
  assert.equal(commandCenter.data.humanGate.rows.length, 0);
  assert.equal(live.data.portfolioOrderIntents[0].humanGate.status, "NOT_CREATED");
  assert.deepEqual(live.data.portfolioOrderIntents[0].allowedActions.allowedActions, ["VIEW"]);
  assert.deepEqual(live.data.portfolioOrderIntents[0].allowedActions.denialReasons, ["HUMAN_GATE_NOT_CREATED"]);
  assert.equal(live.data.canonicalRuntime.pipeline.find((step) => step.stepId === "HUMAN_GATE")?.status, "BLOCKED");
});

test("live reconciliation ignores historical broker snapshots while physical execution is disabled", async () => {
  const store = frontControlPlaneStore({
    execution: {
      safety: {
        executionEnabled: false,
        physicalExecutionEnabled: false,
        submissionPossible: false,
        liveAccountAllowed: false,
        executionAuthorityMode: "semi_auto",
        entryOperatorApprovalRequired: true,
      },
      reconciliations: [{
        reconciliation_id: "legacy-reconciliation",
        status: "MATCHED",
        mismatch_count: 0,
        broker_snapshot: { account: "Sim101", positions: [] },
        completed_at: "2026-07-26T17:09:22.000Z",
      }],
    },
  });

  const live = await handleFrontControlPlane(store, {
    pathname: "/front-api/v1/views/live-trading",
    query: {},
  });

  assert.equal(live.data.reconciliation.availability, "NOT_APPLICABLE_CURRENT_MODE");
  assert.equal(live.data.reconciliation.status, "PHYSICAL_EXECUTION_DISABLED");
  assert.equal(live.data.reconciliation.mismatchCount, null);
  assert.equal(live.data.reconciliation.expected, null);
  assert.deepEqual(live.data.reconciliation.broker, { availability: "NOT_APPLICABLE_CURRENT_MODE" });

  const commandCenter = await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/command-center", query: {} });
  assert.equal(commandCenter.data.provider.availability, "NOT_APPLICABLE_CURRENT_MODE");
  assert.equal(commandCenter.data.provider.mismatchCount, null);
});

test("certification replay lineage is excluded from nominal Command Center and Live Trading projections", async () => {
  const certificationIntentId = "portfolio_order_intent_certification_only";
  const store = frontControlPlaneStore({
    execution: {
      portfolioOrderIntents: [{
        portfolio_order_intent_id: certificationIntentId,
        target_position_id: "target_position_certification_only",
        target_account_id: "certification:isolated-run",
        target_instrument: "MNQ",
        quantity: 1,
        status: "READY",
        broker_submission_allowed: false,
        execution_terms: { account_id: "certification:isolated-run", instrument: "MNQ", side: "BUY", quantity: 1 },
      }],
      humanExecutionGates: [{
        human_execution_gate_id: "human_gate_certification_only",
        portfolio_order_intent_id: certificationIntentId,
        status: "AWAITING_MANUAL_CONFIRMATION",
        revision: 1,
      }],
      providerCommands: [],
      providerEvents: [],
    },
  });
  store.getStrategyV2Overview = async () => ({
    definitions: [],
    versions: [],
    instances: [],
    signals: [{
      signal_id: "signal-certification-only",
      instrument: "MNQ",
      direction: "LONG",
      source_class: "CERTIFICATION_REPLAY",
      certification_run_id: "isolated-run",
      created_at_utc: "2026-08-16T01:00:00.000Z",
    }],
  });

  const [live, commandCenter] = await Promise.all([
    handleFrontControlPlane(store, { pathname: "/front-api/v1/views/live-trading", query: { mode: "paper" } }),
    handleFrontControlPlane(store, { pathname: "/front-api/v1/views/command-center", query: { mode: "paper" } }),
  ]);

  assert.equal(live.data.signals.length, 0);
  assert.equal(live.data.portfolioOrderIntents.length, 0);
  assert.equal(live.data.canonicalRuntime.latestSignals.length, 0);
  assert.equal(live.data.canonicalRuntime.pendingOrderIntents.length, 0);
  assert.equal(commandCenter.data.signals.rows.length, 0);
  assert.equal(commandCenter.data.humanGate.rows.length, 0);
  assert.equal(commandCenter.data.summary.pendingCommands, 0);
});

test("front control plane audit and incidents use unified backend sources instead of NOT_IMPLEMENTED placeholders", async () => {
  const store = frontControlPlaneStore({
    execution: {
      portfolioOrderIntents: [{
        portfolio_order_intent_id: "portfolio_order_intent_audit_1",
        target_position_id: "target_position_audit_1",
        target_instrument: "MNQ",
        quantity: 1,
        status: "READY",
        correlation_id: "corr-audit-1",
        order_intent_payload: { order_intent_id: "portfolio_order_intent_audit_1", signal_id: "signal-1", instrument: "MNQ", action: "BUY", quantity: 1 },
      }],
      providerCommands: [],
      providerEvents: [{
        broker_provider_event_id: "provider-event-audit-1",
        portfolio_order_intent_id: "portfolio_order_intent_audit_1",
        event_type: "ACK",
        provider_status: "ACKNOWLEDGED",
        occurred_at_utc: "2026-08-11T08:01:00.000Z",
        correlation_id: "corr-audit-1",
      }],
    },
  });
  store.listOperationsIncidents = async () => ({
    items: [
      { incident_id: "incident-stale-1", title: "Provider heartbeat stale", severity: "high", status: "OPEN", domain: "provider", order_id: "portfolio_order_intent_audit_1", created_at_utc: "2026-08-11T08:00:00.000Z" },
      { incident_id: "incident-policy-1", title: "Execution policy disabled by operator", severity: "low", status: "DISABLED", domain: "execution", created_at_utc: "2026-08-11T08:00:00.000Z" },
    ],
  });

  const audit = await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/events-audit", query: {} });
  const incidents = await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/execution-incidents", query: {} });

  assert.equal(audit.meta.warnings.some((warning) => warning.includes("NOT_IMPLEMENTED")), false);
  assert.equal(audit.data.summary.totalEvents > 0, true);
  assert.equal(audit.data.events.some((event) => event.domain === "OrderIntent"), true);
  assert.equal(audit.data.events.some((event) => event.domain === "Provider" && event.detail.includes("fill")), true);
  assert.equal(incidents.meta.warnings.some((warning) => warning.includes("NOT_IMPLEMENTED")), false);
  assert.deepEqual(incidents.data.filters.categories.sort(), ["POLICY_DISABLED", "STALE_HEARTBEAT"]);
  assert.equal(incidents.data.summary.retryableIncidents, 1);
  assert.equal(incidents.data.summary.impactedOrders, 1);
});

test("front control plane P0 operational views preserve empty-state and reconciliation truth", async () => {
  const store = frontControlPlaneStore({
    execution: {
      reconciliations: [],
      adapterParityRuns: [{ adapter_parity_run_id: "parity-1", broker_account_id: "Sim101", left_adapter: "ati", right_adapter: "addon", status: "incomplete", mismatch_count: 2 }],
    },
  });
  const plan = await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/live-plan", query: { trading_date: "2026-08-11", session: "asia_open", mode: "paper" } });
  const timeline = await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/live-timeline", query: { trading_date: "2026-08-11", session: "asia_open", mode: "paper" } });
  const reconciliation = await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/execution-reconciliation", query: {} });
  const observability = await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/operations-observability", query: {} });

  assert.equal(plan.data.master.available, false);
  assert.equal(plan.data.setup.available, false);
  assert.equal(Array.isArray(timeline.data.events), true);
  assert.equal(reconciliation.data.summary.status, "MISMATCH");
  assert.equal(reconciliation.data.summary.mismatches, 2);
  assert.equal(observability.data.queue.depth, 1);
});

test("front control plane live trading projects demo PAPER launch blockers from health and execution state", async () => {
  const store = frontControlPlaneStore({
    health: {
      ready: true,
      mode: "postgres",
      data_readiness: {
        ok: false,
        state: "stale",
        core_age_seconds: 1_200,
        effective_market_date: "2026-08-11",
        source_health: {
          durable: false,
          non_durable_feeds: [
            { instrument: "MNQ", timeframe: "1", classification: "rescue" },
            { instrument: "MNQ", timeframe: "5", classification: "rescue" },
          ],
        },
        core_feeds: [
          { instrument: "MNQ", timeframe: "1", provenance: { durable: false, classification: "rescue" } },
          { instrument: "MNQ", timeframe: "5", provenance: { durable: false, classification: "rescue" } },
          { instrument: "MES", timeframe: "1", provenance: { durable: false, classification: "rescue" } },
          { instrument: "MES", timeframe: "5", provenance: { durable: false, classification: "rescue" } },
        ],
      },
      operations: {
        services: [
          { service_id: "live_runtime_scheduler", service_kind: "live_runtime_scheduler", status: "healthy", healthy: true, details: { data_state: "stale" } },
          { service_id: "broker_management", service_kind: "broker_management", status: "healthy", healthy: true, details: { result: { paper_safety: { execution_enabled: true, bridge_mode: "sim101_addon_approved_only", kill_switch_released: true, max_contracts: 2, execution_authority_mode: "auto", entry_operator_approval_required: false, submission_possible: true, live_account_allowed: false, addon_heartbeat_fresh: false, addon_connected: false, connection_ready: false, command_enabled: false, account_name: "Sim101", sim101_account: true } } } },
        ],
      },
    },
    execution: {
      ninjaTraderStartup: {
        state: "login_required",
        addonHeartbeatFresh: false,
        addonConnected: false,
        connectionReady: false,
      },
      bridges: [
        { adapter_kind: "addon", account_name: "Sim101", command_enabled: false, status: "read_only", last_seen_at: "2026-08-11T07:00:00.000Z" },
      ],
    },
  });
  const envelope = await handleFrontControlPlane(store, {
    pathname: "/front-api/v1/views/live-trading",
    method: "GET",
    query: { trading_date: "2026-08-11", session: "ny_open", mode: "paper" },
  });

  assert.equal(envelope.data.session.marketDataStatus, "STALE");
  assert.equal(envelope.data.launchGate.status, "BLOCKED");
  assert.equal(envelope.data.launchGate.finalDecision, "KEEP_AGENTS_CLOSED_OR_SHADOW");
  assert.equal(envelope.data.launchGate.finalCheckCommand, "npm run --silent gate:demo-paper -- --json");
  assert.equal(envelope.data.launchGate.releaseCheckCommand, "DESK_OPERATOR_ADMIN_PIN=... npm run --silent gate:demo-paper-release -- --json");
  assert.deepEqual(
    envelope.data.launchGate.components.map((component) => [component.componentId, component.status]),
    [
      ["demo-paper", "BLOCKED"],
      ["vnext-operator", "VERIFY_WITH_RELEASE_GATE"],
    ],
  );
  assert.deepEqual(
    envelope.data.launchGate.blockers.map((blocker) => blocker.id),
    [
      "data.live_fresh",
      "data.source_durable",
      "broker.sim101_addon_ready",
    ],
  );
  assert.equal(envelope.data.pipeline.find((step) => step.stepId === "MARKET_DATA")?.status, "BLOCKED");
  assert.equal(envelope.data.pipeline.find((step) => step.stepId === "PROVIDER")?.status, "BLOCKED");

  const readiness = await handleFrontControlPlane(store, {
    pathname: "/front-api/v1/views/demo-paper-readiness",
    method: "GET",
    query: { trading_date: "2026-08-11", session: "ny_open", mode: "paper" },
  });
  assert.equal(readiness.data.summary.finalDecision, "KEEP_AGENTS_CLOSED_OR_SHADOW");
  assert.equal(readiness.data.summary.canOpenAgents, false);
  assert.deepEqual(readiness.data.actionItems.map((item) => item.blockerId), [
    "data.live_fresh",
    "data.source_durable",
    "broker.sim101_addon_ready",
    "broker.sim101_addon_ready",
    "broker.sim101_addon_ready",
    "broker.sim101_addon_ready",
  ]);
  assert.deepEqual(readiness.data.actionItems.map((item) => item.actionId), [
    "readiness_tradingview_live_freshness",
    "readiness_tradingview_source_durable",
    "readiness_ninjatrader_login",
    "readiness_ninjatrader_simulation_connection",
    "readiness_addon_fresh_heartbeat",
    "readiness_addon_command_enabled",
  ]);
  assert.equal(readiness.data.actionItems[0]?.command, "python3 scripts/tradingview/migrate_local_alert_webhooks.py");
  assert.equal(readiness.data.actionItems.at(-1)?.route, "/execution/providers");
  assert.equal(readiness.data.commands.releaseGate, "DESK_OPERATOR_ADMIN_PIN=... npm run --silent gate:demo-paper-release -- --json");
  assert.equal(readiness.data.marketData.sourceDurable, false);
  assert.equal(readiness.data.broker.accountName, "Sim101");
});

test("front control plane portfolio preserves unavailable, stale and open-position truth", async () => {
  const store = frontControlPlaneStore({
    execution: {
      safety: {
        riskPercent: 0.25,
        accountSnapshotMaxAgeSeconds: 60,
      },
      accountSnapshots: [{
        broker_account_id: "Sim101",
        captured_at: "2026-08-11T07:00:00.000Z",
        unrealized_pnl: 125,
        payload: { net_liquidation_value: 50_000 },
      }],
      trades: [
        { trade_id: "trade-open", status: "OPEN", instrument_code: "MNQ", side: "long", quantity_open: 1, entry_price: 22_100 },
        { trade_id: "trade-closed", status: "CLOSED", instrument_code: "MES", side: "short", quantity_open: 0, entry_price: 6_100 },
      ],
    },
  });

  const envelope = await handleFrontControlPlane(store, {
    pathname: "/front-api/v1/views/portfolio",
    method: "GET",
    query: {},
  });

  assert.equal(envelope.data.summaryTruth.equity.state, "STALE");
  assert.equal(envelope.data.summaryTruth.equity.value, 50_000);
  assert.equal(envelope.data.summaryTruth.grossExposureUsd.state, "NOT_IMPLEMENTED");
  assert.equal(envelope.data.summaryTruth.unrealizedPnl.state, "STALE");
  assert.deepEqual(envelope.data.positions.map((item) => item.positionId), ["trade-open"]);
  assert.deepEqual(envelope.data.brokerPositions.map((item) => item.positionId), ["trade-open"]);
  assert.deepEqual(envelope.data.exposureTree, []);
  assert.equal(envelope.data.reconciliation.status, "PENDING");
  assert.equal(envelope.meta.warnings.includes("portfolio-account-snapshot:STALE"), true);
  assert.equal(envelope.meta.warnings.includes("portfolio-attribution:NOT_IMPLEMENTED"), true);
});

test("front control plane auth-session reflects read-only versus operator write session", async () => {
  const readOnly = await handleFrontControlPlane(frontControlPlaneStore(), {
    pathname: "/front-api/v1/views/auth-session",
    method: "GET",
    actor: { kind: "rest_read", scopes: ["desk.read"] },
  });
  assert.equal(readOnly.data.summary.authenticated, false);
  assert.equal(readOnly.data.summary.readOnly, true);
  assert.equal(readOnly.data.principal.userId, "anonymous-read-only");
  assert.equal(readOnly.data.principal.maskedEmail, "");
  assert.deepEqual(readOnly.data.principal.roles, []);
  assert.deepEqual(readOnly.data.principal.accountScopes, []);
  assert.equal(readOnly.data.session.sessionId, "");
  assert.equal(readOnly.data.session.httpOnlySession, true);
  assert.equal(readOnly.data.session.browserMaterialExposure, "NONE");
  assert.equal(readOnly.data.session.legacyStoreImported, false);
  assert.equal(readOnly.data.permissions.find((item) => item.capability === "front.command")?.decision, "READ_ONLY");
  assert.equal(readOnly.data.environments.find((item) => item.environment === "PAPER")?.writeEnabled, false);
  assert.equal(readOnly.data.environments.find((item) => item.environment === "PAPER")?.tradingEnabled, false);
  assert.equal(readOnly.data.environments.find((item) => item.environment === "LIVE")?.status, "LOCKED");

  const operator = await handleFrontControlPlane(frontControlPlaneStore(), {
    pathname: "/front-api/v1/views/auth-session",
    method: "GET",
    actor: { kind: "operator_session", email: "operator@example.com", uid: "desk-operator", scopes: ["desk.read", "desk.write"] },
  });
  assert.equal(operator.data.summary.authenticated, true);
  assert.equal(operator.data.summary.readOnly, false);
  assert.equal(operator.data.principal.userId, "desk-operator");
  assert.equal(operator.data.principal.maskedEmail, "op***@example.com");
  assert.deepEqual(operator.data.principal.roles, ["operator"]);
  assert.deepEqual(operator.data.principal.accountScopes, ["paper"]);
  assert.equal(operator.data.session.sessionId, "operator_session_http_only");
  assert.equal(operator.data.permissions.find((item) => item.capability === "front.command")?.decision, "ALLOW");
  assert.equal(operator.data.environments.find((item) => item.environment === "PAPER")?.writeEnabled, true);
});

test("front control plane command catalog rejects unsupported actions and fails closed for LIVE", async () => {
  await assert.rejects(
    handleFrontControlPlane(frontControlPlaneStore(), {
      pathname: FRONT_CONTROL_PLANE_COMMANDS_PATH,
      method: "POST",
      body: { commandType: "risk.kill_switch.request", environment: "PAPER", reason: "operator test" },
      headers: { "idempotency-key": "idem-risk-unsupported", "x-correlation-id": "corr-risk-unsupported" },
      actor: { kind: "test-operator", authorized: true },
    }),
    (error) => error.code === "FRONT_CONTROL_PLANE_COMMAND_NOT_IMPLEMENTED" && error.statusCode === 422,
  );

  const accepted = await handleFrontControlPlane(frontControlPlaneStore(), {
    pathname: FRONT_CONTROL_PLANE_COMMANDS_PATH,
    method: "POST",
    body: {
      commandType: "research.bootstrap_demo_paper",
      environment: "PAPER",
      reason: "operator test",
    },
    headers: {
      "idempotency-key": "idem-risk-001",
      "x-correlation-id": "corr-risk-001",
    },
    actor: { kind: "test-operator", authorized: true },
  });

  assert.equal(accepted.status, "ACCEPTED");
  assert.equal(accepted.idempotencyKey, "idem-risk-001");
  assert.equal(accepted.correlationId, "corr-risk-001");

  await assert.rejects(
    handleFrontControlPlane(frontControlPlaneStore(), {
      pathname: FRONT_CONTROL_PLANE_COMMANDS_PATH,
      method: "POST",
      body: { commandType: "execution.provider.switch_primary", environment: "LIVE" },
      headers: { "idempotency-key": "idem-live-001" },
    }),
    (error) => error.code === "FRONT_CONTROL_PLANE_LIVE_COMMAND_DISABLED" && error.statusCode === 403,
  );
});

test("front control plane persists catalogued commands as audited idempotent records", async () => {
  const commands = new Map();
  const commits = [];
  const store = {
    ...frontControlPlaneStore(),
    async commitFrontOperatorCommandMutation(plan) {
      const existing = commands.get(plan.commandId);
      if (existing) {
        if (existing.request_hash !== plan.requestHash) {
          throw Object.assign(new Error("idempotency conflict"), { code: "IDEMPOTENCY_CONFLICT" });
        }
        return { replayed: true, command: existing, result: existing.result };
      }
      commits.push(plan);
      commands.set(plan.commandId, plan.commandDoc);
      return { replayed: false, command: plan.commandDoc, result: plan.result };
    },
    async executeResearchLabAction() {
      return { status: "READY", dataset: { dataset_key: "test" }, simulation: { simulation_run_id: "sim-test" } };
    },
  };
  const input = {
    pathname: FRONT_CONTROL_PLANE_COMMANDS_PATH,
    method: "POST",
    body: {
      commandType: "research.bootstrap_demo_paper",
      environment: "PAPER",
      payload: { missionId: "mission-1" },
      reason: "operator pause during acceptance test",
    },
    headers: {
      "idempotency-key": "idem-research-pause-001",
      "x-correlation-id": "corr-research-pause-001",
    },
    actor: { kind: "test-operator", authorized: true, email: "operator@example.com" },
  };

  const accepted = await handleFrontControlPlane(store, input);
  const replayed = await handleFrontControlPlane(store, input);

  assert.equal(accepted.status, "ACCEPTED");
  assert.equal(accepted.persisted, true);
  assert.equal(accepted.idempotent, false);
  assert.equal(replayed.idempotent, true);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].commandDoc.schema_version, "front_control_plane_command_v1");
  assert.equal(commits[0].commandDoc.correlation_id, "corr-research-pause-001");
  assert.equal(commits[0].commandDoc.causation_id, "corr-research-pause-001");
  assert.equal(commits[0].commandDoc.aggregate_id, "mission-1");
  assert.equal(commits[0].eventDoc.correlation_id, "corr-research-pause-001");
  assert.equal(commits[0].auditDoc.aggregate_id, "mission-1");
  assert.equal(commits[0].commandDoc.broker_execution, false);
  assert.equal(commits[0].commandDoc.order_submission_enabled, false);
  assert.equal(commits[0].auditDoc.performed_by, "operator@example.com");
});

test("front control plane executes desk status and start through audited fail-closed operational control", async () => {
  const commands = new Map();
  const completed = [];
  const store = {
    ...frontControlPlaneStore({
      health: coldStartReadyHealth(),
    }),
    async commitFrontOperatorCommandMutation(plan) {
      const existing = commands.get(plan.commandId);
      if (existing) return { replayed: true, command: existing.commandDoc, result: existing.result };
      commands.set(plan.commandId, plan);
      return { replayed: false, command: plan.commandDoc, result: plan.result };
    },
    async completeFrontOperatorCommand(result) {
      completed.push(result);
      return { ok: true };
    },
  };

  const status = await handleFrontControlPlane(store, {
    pathname: FRONT_CONTROL_PLANE_COMMANDS_PATH,
    method: "POST",
    body: {
      commandType: "desk.status",
      environment: "PAPER",
      reason: "operator checks cold-start state before demo-paper run",
    },
    headers: {
      "idempotency-key": "idem-desk-status-001",
      "x-correlation-id": "corr-desk-status-001",
    },
    actor: { kind: "test-operator", authorized: true, email: "operator@example.com" },
  });

  assert.equal(status.runtimeMutation, "EXECUTED");
  assert.equal(status.aggregateId, "desk:operational-control");
  assert.equal(status.mutationResult.status, "SUCCEEDED");
  assert.equal(status.mutationResult.state.state, "PAPER_READY");
  assert.equal(status.mutationResult.broker_execution, false);
  assert.equal(status.mutationResult.live_execution, false);
  assert.equal(status.mutationResult.auto_execution, false);

  const start = await handleFrontControlPlane(store, {
    pathname: FRONT_CONTROL_PLANE_COMMANDS_PATH,
    method: "POST",
    body: {
      commandType: "desk.start",
      environment: "PAPER",
      reason: "operator requests audited start plan",
    },
    headers: {
      "idempotency-key": "idem-desk-start-001",
      "x-correlation-id": "corr-desk-start-001",
    },
    actor: { kind: "test-operator", authorized: true, email: "operator@example.com" },
  });

  assert.equal(start.runtimeMutation, "EXECUTED");
  assert.equal(start.aggregateId, "desk:operational-control");
  assert.equal(start.mutationResult.status, "PLAN_ONLY");
  assert.equal(start.mutationResult.plan.outcome, "PLAN_ONLY_FAIL_CLOSED");
  assert.equal(start.mutationResult.plan.sideEffectsEnabled, false);
  assert.equal(start.mutationResult.plan.broker_execution, false);
  assert.equal(start.mutationResult.state.allowed_actions.includes("desk.restart"), true);
  assert.equal(completed.length, 2);
  assert.equal([...commands.values()].every((item) => item.commandDoc.broker_execution === false), true);
  assert.equal([...commands.values()].every((item) => item.commandDoc.order_submission_enabled === false), true);
});

test("front control plane research bootstrap command executes the audited runtime mutation", async () => {
  const commands = new Map();
  const mutations = [];
  const store = {
    ...frontControlPlaneStore(),
    async commitFrontOperatorCommandMutation(plan) {
      const existing = commands.get(plan.commandId);
      if (existing) return { replayed: true, command: existing.commandDoc, result: existing.result };
      commands.set(plan.commandId, plan);
      return { replayed: false, command: plan.commandDoc, result: plan.result };
    },
    async executeResearchLabAction({ input, actor }) {
      mutations.push({ input, actor });
      return {
        contract: "DeskResearchLabActionResultV1",
        schemaVersion: "research_lab_front_v1",
        status: "READY",
        dataset: { dataset_key: input.dataset_key },
        simulation: { simulation_run_id: "sim-demo-paper", trade_count: 3, total_r: 1.25 },
      };
    },
  };

  const accepted = await handleFrontControlPlane(store, {
    pathname: FRONT_CONTROL_PLANE_COMMANDS_PATH,
    method: "POST",
    body: {
      commandType: "research.bootstrap_demo_paper",
      environment: "PAPER",
      payload: {
        symbol_code: "MNQ1!",
        timeframe: "5",
        start_utc: "2026-06-01T00:00:00.000Z",
        end_utc: "2026-07-01T00:00:00.000Z",
        dataset_key: "demo-paper.mnq.m5.2026-06-01_2026-07-01",
      },
      reason: "bootstrap e2e test",
    },
    headers: {
      "idempotency-key": "idem-research-bootstrap-001",
      "x-correlation-id": "corr-research-bootstrap-001",
    },
    actor: { kind: "test-operator", authorized: true, email: "operator@example.com" },
  });

  assert.equal(accepted.status, "ACCEPTED");
  assert.equal(accepted.runtimeMutation, "EXECUTED");
  assert.equal(accepted.mutationResult.status, "READY");
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].input.action, "bootstrap_demo_paper_research");
  assert.equal(mutations[0].input.idempotency_key, "idem-research-bootstrap-001");
  assert.equal(commands.values().next().value.commandDoc.runtime_mutation, true);
  assert.equal(commands.values().next().value.commandDoc.broker_execution, false);
});

test("front control plane assistant question command persists a read-only assistant task", async () => {
  const commands = new Map();
  const completed = [];
  const repository = new InMemoryDomainAssistantRuntimeRepository();
  const domainAssistantRuntimeService = new DomainAssistantRuntimeService({ repository });
  await domainAssistantRuntimeService.bootstrapProfiles();
  const store = {
    ...frontControlPlaneStore(),
    domainAssistantRuntimeService,
    async commitFrontOperatorCommandMutation(plan) {
      const existing = commands.get(plan.commandId);
      if (existing) return { replayed: true, command: existing.commandDoc, result: existing.result };
      commands.set(plan.commandId, plan);
      return { replayed: false, command: plan.commandDoc, result: plan.result };
    },
    async completeFrontOperatorCommand(result) {
      completed.push(result);
      return { ok: true };
    },
  };

  const accepted = await handleFrontControlPlane(store, {
    pathname: FRONT_CONTROL_PLANE_COMMANDS_PATH,
    method: "POST",
    body: {
      commandType: "assistant.question.submit",
      environment: "PAPER",
      payload: {
        assistantId: "assistant_execution",
        question: "Pourquoi OI-812 est bloqué ?",
        sourceRefs: ["execution.order_intents"],
        domainSnapshot: { orderIntentId: "OI-812", providerCommands: 0 },
      },
      reason: "operator asks domain assistant",
    },
    headers: {
      "idempotency-key": "idem-assistant-question-001",
      "x-correlation-id": "corr-assistant-question-001",
    },
    actor: { kind: "test-operator", authorized: true, uid: "operator-1", email: "operator@example.com" },
  });

  assert.equal(accepted.status, "ACCEPTED");
  assert.equal(accepted.runtimeMutation, "EXECUTED");
  assert.equal(accepted.aggregateId, "assistant_execution");
  assert.equal(accepted.mutationResult.status, "RECORDED");
  assert.equal(accepted.mutationResult.assistant_profile_id, "assistant_execution");
  assert.equal(repository.tasks.size, 1);
  assert.equal(repository.messages.size, 1);
  assert.equal(repository.outbox[0].channel, "ASSISTANT_RUNTIME");
  assert.equal([...repository.tasks.values()][0].payload.authority, "READ_ONLY");
  assert.equal([...commands.values()][0].commandDoc.broker_execution, false);
  assert.equal([...commands.values()][0].commandDoc.order_submission_enabled, false);
  assert.equal(completed[0].result.mutation_result.broker_execution, false);
  assert.equal(completed[0].result.mutation_result.order_submission_enabled, false);
});

test("front control plane strategy version fork creates an audited draft without publish or activation", async () => {
  const commands = new Map();
  const createdVersions = [];
  const store = {
    ...frontControlPlaneStore(),
    async commitFrontOperatorCommandMutation(plan) {
      const existing = commands.get(plan.commandId);
      if (existing) return { replayed: true, command: existing.commandDoc, result: existing.result };
      commands.set(plan.commandId, plan);
      return { replayed: false, command: plan.commandDoc, result: plan.result };
    },
    async getStrategyV2Version({ strategy_version_id }) {
      assert.equal(strategy_version_id, "strver-1");
      return {
        version: {
          strategy_version_id,
          strategy_definition_id: "strdef-1",
          version_label: "v1",
          status: "PUBLISHED",
          strategy_spec: { dsl_version: "strategy_dsl_v1", entry: { kind: "breakout_retest" } },
          parameters: { risk_pct: 0.25 },
          provider_command_id: "must-not-copy-provider",
          credentials: { token: "must-not-copy" },
        },
      };
    },
    async createStrategyV2Version({ input, actor }) {
      createdVersions.push({ input, actor });
      return { contract: "DeskStrategyVersionCommandResultV2", version: input };
    },
  };

  const accepted = await handleFrontControlPlane(store, {
    pathname: FRONT_CONTROL_PLANE_COMMANDS_PATH,
    method: "POST",
    body: {
      commandType: "strategy.version.fork",
      environment: "PAPER",
      payload: {
        sourceStrategyVersionId: "strver-1",
        newStrategyVersionId: "strver-1-fork-test",
        versionLabel: "operator-fork",
      },
      reason: "operator wants a draft branch for research",
    },
    headers: {
      "idempotency-key": "idem-strategy-fork-001",
      "x-correlation-id": "corr-strategy-fork-001",
    },
    actor: { kind: "operator_session", scopes: ["desk.read", "desk.write"], email: "operator@example.com" },
  });

  assert.equal(accepted.runtimeMutation, "EXECUTED");
  assert.equal(accepted.mutationResult.status, "DRAFT_CREATED");
  assert.equal(accepted.mutationResult.autoPublish, false);
  assert.equal(accepted.mutationResult.autoActivateInstance, false);
  assert.equal(accepted.mutationResult.broker_execution, false);
  assert.equal(createdVersions.length, 1);
  assert.equal(createdVersions[0].input.strategy_version_id, "strver-1-fork-test");
  assert.equal(createdVersions[0].input.status, "DRAFT");
  assert.equal(createdVersions[0].input.lineage.source_strategy_version_id, "strver-1");
  assert.equal(createdVersions[0].input.audit.auto_publish, false);
  assert.equal(createdVersions[0].input.audit.order_submission_enabled, false);
  assert.equal(createdVersions[0].input.provider_command_id, undefined);
  assert.equal(createdVersions[0].input.credentials, undefined);
  assert.equal(commands.values().next().value.commandDoc.broker_execution, false);
  assert.equal(commands.values().next().value.commandDoc.order_submission_enabled, false);
});

test("front control plane Human Gate confirm routes through broker service without direct provider execution", async () => {
  const commands = new Map();
  const brokerActions = [];
  const store = {
    ...frontControlPlaneStore(),
    async commitFrontOperatorCommandMutation(plan) {
      const existing = commands.get(plan.commandId);
      if (existing) return { replayed: true, command: existing.commandDoc, result: existing.result };
      commands.set(plan.commandId, plan);
      return { replayed: false, command: plan.commandDoc, result: plan.result };
    },
    async executeBrokerAction({ input, actor }) {
      brokerActions.push({ input, actor });
      return {
        status: "CONFIRMED",
        idempotent: false,
        gate: {
          human_execution_gate_id: "human_gate_test",
          portfolio_order_intent_id: input.portfolioOrderIntentId,
          status: "CONFIRMED",
        },
      };
    },
  };

  const accepted = await handleFrontControlPlane(store, {
    pathname: FRONT_CONTROL_PLANE_COMMANDS_PATH,
    method: "POST",
    body: {
      commandType: "execution.order_intent.confirm",
      environment: "PAPER",
      expectedVersion: 2,
      payload: {
        portfolioOrderIntentId: "portfolio_order_intent_test",
        approvedTerms: { quantity: 2, account_id: "Sim101", instrument: "MNQ", action: "BUY" },
      },
      reason: "operator confirms semi-manual paper OrderIntent",
    },
    headers: {
      "idempotency-key": "idem-human-gate-confirm-001",
      "x-correlation-id": "corr-human-gate-confirm-001",
    },
    actor: { kind: "test-operator", authorized: true, email: "operator@example.com" },
  });

  assert.equal(accepted.runtimeMutation, "EXECUTED");
  assert.equal(accepted.mutationResult.status, "CONFIRMED");
  assert.equal(brokerActions.length, 1);
  assert.equal(brokerActions[0].input.action, "confirm_human_execution_gate");
  assert.equal(brokerActions[0].input.portfolioOrderIntentId, "portfolio_order_intent_test");
  assert.equal(brokerActions[0].input.expectedRevision, 2);
  assert.equal(brokerActions[0].input.confirmationPhrase, "CONFIRM_PORTFOLIO_ORDER_INTENT");
  assert.equal(brokerActions[0].input.idempotencyKey, "idem-human-gate-confirm-001");
  assert.deepEqual(brokerActions[0].input.approvedTerms, { quantity: 2, account_id: "Sim101", instrument: "MNQ", action: "BUY" });
  const commandRecord = commands.values().next().value.commandDoc;
  assert.equal(commandRecord.aggregate_id, "portfolio_order_intent_test");
  assert.equal(commandRecord.result.aggregate_id, "portfolio_order_intent_test");
  assert.equal(commandRecord.broker_execution, false);
  assert.equal(commandRecord.order_submission_enabled, false);
});

test("front control plane composes Command Center research truth and resolves detail views by route identifier", async () => {
  const store = frontControlPlaneStore();
  const forbiddenCalls = [];
  store.getResearchLabOverview = async () => { forbiddenCalls.push("research"); return {}; };
  store.listDataFoundationDatasets = async () => { forbiddenCalls.push("data"); return { items: [] }; };
  store.getStrategyV2Overview = async () => ({
    definitions: [], instances: [],
    signals: [
      { signal_id: "signal-a", strategy_id: "strategy-a", instrument_code: "MNQ", side: "long", confidence: 61 },
      { signal_id: "signal-b", strategy_id: "strategy-b", instrument_code: "MES", side: "short", confidence: 73 },
    ],
  });

  await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/command-center", query: {} });
  assert.deepEqual(forbiddenCalls.sort(), ["data", "research"]);

  const first = await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/live-signal-detail", query: { signalId: "signal-a" } });
  const second = await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/live-signal-detail", query: { signalId: "signal-b" } });
  assert.equal(first.data.identity.signalId, "signal-a");
  assert.equal(second.data.identity.signalId, "signal-b");
  assert.notEqual(first.data.signal.symbol, second.data.signal.symbol);
  await assert.rejects(
    () => handleFrontControlPlane(store, { pathname: "/front-api/v1/views/live-signal-detail", query: { signalId: "missing" } }),
    (error) => error.code === "LIVE_SIGNAL_NOT_FOUND" && error.statusCode === 404,
  );
});

test("Command Center maps canonical incident fields and operational counters without generic placeholders", async () => {
  const store = frontControlPlaneStore({
    incidents: {
      items: [{
        id: "guardrail:queue-test",
        kind: "guardrail",
        title: "Attente en queue hors SLA",
        severity: "warning",
        createdAt: "2026-08-11T07:55:00.000Z",
        source: "observability_guardrail",
        triage: { nextAction: "assign" },
        recommendedActions: [{ action: "assign", label: "Assigner owner" }],
        links: [{ kind: "runbook", label: "Queue SLA" }],
      }],
    },
  });
  const envelope = await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/command-center", query: {} });

  assert.deepEqual(envelope.data.incidents[0], {
    id: "guardrail:queue-test",
    severity: "WARNING",
    detectedAt: "2026-08-11T07:55:00.000Z",
    resource: "observability_guardrail",
    title: "Attente en queue hors SLA",
    runbook: "Queue SLA",
    action: "assign",
  });
  assert.deepEqual(envelope.data.operations, {
    availability: "KNOWN",
    queuedTasks: 1,
    dlqItems: 0,
    staleFeeds: 0,
  });
  assert.equal(envelope.data.research.rows[0].dataset, "NOT_LINKED");
  assert.equal(envelope.data.research.rows[0].run, "NO_ACTIVE_RUN");
  assert.equal(envelope.data.summary.criticalIncidents, 0, "warning incidents must not inflate the critical KPI");
});

test("front control plane resolves execution drill-downs strictly by requested id", async () => {
  const store = frontControlPlaneStore();
  const order = await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/order-detail", query: { orderId: "nt-1" } });
  const position = await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/position-detail", query: { positionId: "trade-1" } });
  const incident = await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/incident-detail", query: { incidentId: "incident-1" } });
  assert.equal(order.data.identity.orderId, "nt-1");
  assert.equal(position.data.identity.positionId, "trade-1");
  assert.equal(incident.data.incident.incidentId, "incident-1");
  for (const [view, key, value, code] of [
    ["order-detail", "orderId", "missing", "ORDER_NOT_FOUND"],
    ["position-detail", "positionId", "missing", "POSITION_NOT_FOUND"],
    ["incident-detail", "incidentId", "missing", "INCIDENT_NOT_FOUND"],
  ]) {
    await assert.rejects(
      () => handleFrontControlPlane(store, { pathname: `/front-api/v1/views/${view}`, query: { [key]: value } }),
      (error) => error.code === code && error.statusCode === 404,
    );
  }
});

test("front control plane order-detail publishes post-risk portfolio OrderIntent before broker order exists", async () => {
  const store = frontControlPlaneStore({
    execution: {
      safety: { executionEnabled: false, submissionPossible: false, liveAccountAllowed: false, executionAuthorityMode: "semi_auto", entryOperatorApprovalRequired: true },
      orders: [],
      fills: [],
      portfolioOrderIntents: [{
        portfolio_order_intent_id: "portfolio_order_intent_1",
        target_position_id: "target_position_1",
        target_account_id: "Sim101",
        target_instrument: "MNQ",
        risk_approved_net_size: 2,
        quantity: 2,
        status: "READY",
        broker_submission_allowed: true,
        idempotency_key: "idem-portfolio-1",
        order_intent_hash: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
        immutable_terms_hash: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
        candidate_allocation_ids: ["allocation-1"],
        risk_decision_ids: ["risk-1"],
        execution_terms: { instrument: "MNQ", side: "BUY", quantity: 2, order_type: "LIMIT", entry: { availability: "KNOWN", price: 21450.25 }, stop: { availability: "KNOWN", price: 21410.25 }, targets: [{ label: "T1", price: 21490.25 }], time_in_force: "DAY" },
        risk_snapshot: { authorizedQty: 2, riskAmount: 80, riskPerContract: 40, stopDistance: { points: 20, ticks: 80 }, reasonCodes: ["MAX_RISK_OK"] },
        immutability: { policy: "REJECT_AND_REPLAN", mutable_after_risk: false, immutable_terms_hash: "sha256:2222222222222222222222222222222222222222222222222222222222222222" },
        risk_decisions: [{ risk_decision_id: "risk-1", decision: "APPROVED", status: "PASS", reason_codes: ["MAX_RISK_OK"], risk_rule_set_version: "risk-v1", approved_size: 2, authorized: { risk_amount: 80, risk_pct: 0.08 }, trade_risk: { risk_per_contract: 40, stop_distance_points: 20, stop_distance_ticks: 80 }, nearest_limit: { type: "INSTRUMENT_ABS_SIZE", utilization: 0.5 } }],
        order_intent_payload: {
          schema_version: "portfolio_order_intent_v1",
          order_intent_id: "portfolio_order_intent_1",
          target_position_id: "target_position_1",
          strategy_id: "strategy-1",
          strategy_instance_id: "strategy-instance-1",
          strategy_version_id: "strategy-v1",
          signal_id: "signal-1",
          account_id: "Sim101",
          broker_account_id: "Sim101",
          instrument: "MNQ",
          provider_id: "ninjatrader",
          action: "BUY",
          quantity: 2,
          order_type: "LIMIT",
          time_in_force: "DAY",
          status: "READY",
          broker_submission_allowed: true,
          protection: { ready: true, stop_price: 21410.25, target_price: 21490.25 },
          idempotency_key: "idem-portfolio-1",
          order_intent_hash: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
          source: { kind: "TARGET_POSITION", target_position_id: "target_position_1", candidate_allocation_ids: ["allocation-1"], risk_decision_ids: ["risk-1"] },
          audit: { direct_llm_order: false, derived_from_netting_engine: true },
        },
      }],
      humanExecutionGates: [{
        human_execution_gate_id: "human_gate_1",
        portfolio_order_intent_id: "portfolio_order_intent_1",
        status: "AWAITING_MANUAL_CONFIRMATION",
        revision: 1,
      }],
      portfolioExecutionStates: [{
        portfolio_order_intent_id: "portfolio_order_intent_1",
        lifecycle_status: "AWAITING_MANUAL_CONFIRMATION",
        filled_quantity: 0,
        updated_at_utc: "2026-08-11T08:00:00.000Z",
      }],
      providerEvents: [{
        broker_provider_event_id: "provider-event-1",
        portfolio_order_intent_id: "portfolio_order_intent_1",
        event_type: "PROVIDER_NOT_SENT",
        occurred_at_utc: "2026-08-11T08:00:00.000Z",
        message: "Human Gate pending.",
      }],
    },
  });

  const envelope = await handleFrontControlPlane(store, {
    pathname: "/front-api/v1/views/order-detail",
    query: { orderId: "portfolio_order_intent_1" },
    actor: { kind: "operator_session", scopes: ["desk.read", "desk.write"] },
  });

  assert.equal(envelope.data.identity.orderId, "portfolio_order_intent_1");
  assert.equal(envelope.data.identity.orderIntentId, "portfolio_order_intent_1");
  assert.equal(envelope.data.authority.globalRisk.decision, "APPROVED");
  assert.equal(envelope.data.authority.targetPosition.authorizedQuantity, 2);
  assert.equal(envelope.data.canonicalDossier.schemaVersion, "canonical_order_intent_dossier_v1");
  assert.equal(envelope.data.canonicalDossier.lineage.riskDecision.id, "risk-1");
  assert.equal(envelope.data.canonicalDossier.executionTerms.entry.price, 21450.25);
  assert.equal(envelope.data.canonicalDossier.riskSnapshot.riskPerContract, 40);
  assert.equal(envelope.data.canonicalDossier.policy.autoExecutionEnabled, false);
  assert.equal(envelope.data.canonicalDossier.policy.ackIsFill, false);
  assert.deepEqual(envelope.data.canonicalDossier.allowedActions.humanGate.allowedActions, ["VIEW", "CONFIRM", "REJECT"]);
  assert.equal(envelope.data.resourceActions.allowedActions.includes("CONFIRM"), true);
  assert.equal(envelope.data.executionMode, "SEMI_MANUAL");
  assert.equal(envelope.data.humanGate.status, "AWAITING_MANUAL_CONFIRMATION");
  assert.equal(envelope.data.humanGate.actions[0].permission, "ALLOWED");
  assert.equal(envelope.data.reconciliation.status, "AWAITING_MANUAL_CONFIRMATION");
  assert.equal(envelope.data.summary.filledQuantity, 0);
  assert.equal(envelope.data.lifecycle.at(-1).state, "PROVIDER_NOT_SENT");
});

test("front control plane degrades a view when one source times out", async () => {
  const store = frontControlPlaneStore();
  store.frontControlPlaneSourceTimeoutMs = 5;
  store.listOperationsIncidents = async () => new Promise(() => {});
  const envelope = await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/command-center", query: { scope: "timeout-test" } });
  assert.equal(envelope.meta.availability, "PARTIAL");
  assert.equal(envelope.meta.warnings.includes("incidents:FRONT_SOURCE_TIMEOUT"), true);
  assert.equal(typeof envelope.data.summary, "object");
  assert.equal(envelope.data.summary.criticalIncidents, null);
  assert.equal(envelope.data.risk.activeAlerts, null);
});

test("front control plane command center publishes canonical truth and isolates legacy execution history", async () => {
  const envelope = await handleFrontControlPlane(frontControlPlaneStore(), {
    pathname: "/front-api/v1/views/command-center",
    query: {},
  });

  assert.equal(envelope.data.mode.environment, "UNKNOWN");
  assert.equal(envelope.data.mode.executionMode, "AUTO");
  assert.equal(envelope.data.mode.autoExecution, "ON");
  assert.equal(envelope.data.mode.liveBroker, "OFF");
  assert.equal(envelope.data.summary.providerSafety, "POLICY_NOT_PUBLISHED");
  assert.equal(envelope.data.market.status, "FRESH");
  assert.equal(envelope.data.market.rows.length, 0, "feeds without a canonical feed_id must not receive synthetic frontend identifiers");
  assert.equal(envelope.data.research.available, true);
  assert.equal(envelope.data.research.hypothesisCount, 0);
  assert.equal(envelope.data.research.runCount, 1);
  assert.equal(envelope.data.signals.rows[0].id, "signal-1");
  assert.equal(envelope.data.humanGate.availability, "CONNECTED_EMPTY");
  assert.equal(envelope.data.humanGate.rows.length, 0, "legacy trade_order_intents must not populate canonical Human Gate");
  assert.equal(envelope.data.provider.health, "STATE_NOT_PUBLISHED");
  assert.equal(envelope.data.provider.events.length, 0, "legacy broker orders/fills must not populate canonical provider lifecycle");
  assert.equal(Array.isArray(envelope.data.audit), true);
});

test("front control plane exposes the persisted command lifecycle by command id", async () => {
  const store = {
    async getFrontOperatorCommand({ command_id }) {
      return command_id === "cmd-front-1" ? {
        command_id,
        status: "SUCCEEDED",
        correlation_id: "corr-front-1",
        audit_id: "audit-front-1",
        updated_at_utc: "2026-08-13T10:00:00.000Z",
        result: { verified: true },
      } : null;
    },
  };
  const status = await handleFrontControlPlane(store, { pathname: "/front-api/v1/commands/cmd-front-1" });
  assert.deepEqual(status, {
    commandId: "cmd-front-1",
    status: "SUCCEEDED",
    correlationId: "corr-front-1",
    updatedAt: "2026-08-13T10:00:00.000Z",
    message: "",
    auditId: "audit-front-1",
    result: { verified: true },
  });
  await assert.rejects(
    () => handleFrontControlPlane(store, { pathname: "/front-api/v1/commands/unknown" }),
    (error) => error.code === "FRONT_COMMAND_NOT_FOUND" && error.statusCode === 404,
  );
});

function frontControlPlaneStore(overrides = {}) {
  const execution = {
    safety: { executionEnabled: true, bridgeMode: "sim101_addon_approved_only", killSwitchEnv: false, submissionPossible: true, riskPercent: 0.25, maxContracts: 2, liveAccountAllowed: false, executionAuthorityMode: "auto", entryOperatorApprovalRequired: false, databaseLocked: false },
    ninjaTraderStartup: { state: "running", addonHeartbeatFresh: true, addonConnected: true, connectionReady: true },
    accounts: [{ broker_account_id: "Sim101", provider_id: "ninjatrader", account_label: "Sim101", mode: "paper" }],
    providers: [{ provider_id: "ninjatrader", label: "NinjaTrader Sim101", mode: "paper", enabled: true, latency_ms: 12 }],
    trades: [{ trade_id: "trade-1", strategy_instance_id: "strinst-1", instrument_code: "MNQ", side: "long", quantity_open: 1, entry_price: 22100 }],
    intents: [{ intent_id: "intent-1", strategy_instance_id: "strinst-1", instrument_code: "MNQ", side: "buy", quantity: 1, status: "queued" }],
    orders: [{ order_id: "order-1", broker_order_id: "nt-1", instrument_code: "MNQ", side: "buy", quantity: 1 }],
    fills: [{ fill_id: "fill-1", order_id: "order-1", quantity: 1, price: 22100 }],
    policies: [],
    accountSnapshots: [],
    contracts: [],
    locks: [],
    reconciliations: [],
    adapterParityRuns: [],
    bridges: [{ adapter_kind: "addon", account_name: "Sim101", command_enabled: true, status: "armed", last_seen_at: "2026-08-11T08:00:00.000Z" }],
    ...overrides.execution,
  };
  const strategy = {
    definitions: [
      { strategy_definition_id: "strdef-1", name: "Breakout Retest", family: "index" },
      { strategy_definition_id: "strdef-compare", name: "Compare Retest", family: "momentum" },
    ],
    versions: [
      { strategy_version_id: "strver-1", strategy_definition_id: "strdef-1", version_label: "v1", status: "VALIDATED" },
      { strategy_version_id: "strver-c1", strategy_definition_id: "strdef-compare", version_label: "base", status: "VALIDATED" },
      { strategy_version_id: "strver-c2", strategy_definition_id: "strdef-compare", version_label: "candidate", status: "DRAFT" },
    ],
    instances: [{ strategy_instance_id: "strinst-1", strategy_definition_id: "strdef-1", execution_mode: "PAPER" }],
    signals: [{ signal_id: "signal-1", strategy_instance_id: "strinst-1", instrument_code: "MNQ", side: "long", confidence: 72 }],
  };
  const incidents = overrides.incidents || {
    items: [{ incident_id: "incident-1", title: "Provider warning", severity: "medium", detail: "Heartbeat delayed" }],
  };
  const runtimeTasks = {
    items: [{ task_id: "task-1", mission_id: "mission-1", task_type: "RESEARCH_REVIEW", worker_id: "codex-research-01", status: "READY" }],
  };
  const research = {
    experiments: [{
      research_experiment_id: "exp-1",
      name: "Demo Research",
      objective: "Validate a seed strategy",
      status: "ACTIVE",
      comparison_metric: "total_r",
      metadata: {},
      counts: { evaluation_reports: 1 },
    }],
    candidates: [{
      research_candidate_id: "cand-1",
      research_experiment_id: "exp-1",
      status: "UNDER_REVIEW",
      primary_change_summary: "Seed candidate",
      last_evaluation_verdict: "NEEDS_REVIEW",
    }],
    evaluation_reports: [{
      research_evaluation_report_id: "report-1",
      research_experiment_id: "exp-1",
      research_candidate_id: "cand-1",
      verdict: "NEEDS_REVIEW",
      report_kind: "VALIDATION",
      score: 0.55,
      metrics: { total_r: 1.25, trade_count: 3, sharpe_r: 0.4 },
      created_at_utc: "2026-08-11T08:00:00.000Z",
    }],
    knowledge_graph: { summary: { nodes: 2 }, graph_hash: "kg-test" },
  };
  const datasets = {
    items: [{
      dataset_id: "dataset-1",
      dataset_key: "demo-paper.mnq.m5",
      name: "Demo Paper MNQ",
      status: "READY",
      cutoff_utc: "2026-07-01T00:00:00.000Z",
      time_range_start_utc: "2026-06-01T00:00:00.000Z",
      time_range_end_utc: "2026-07-01T00:00:00.000Z",
      provenance_hash: "sha256:test",
      metadata: { instrument: "MNQ", timeframe: "M5" },
    }],
  };
  const simulations = {
    items: [{
      simulation_run_id: "sim-1",
      status: "COMPLETED",
      metadata: { mission_id: "mission-1", research_experiment_id: "exp-1" },
    }],
  };
  const health = overrides.health || {
    ready: true,
    mode: "postgres",
    data_readiness: {
      ok: true,
      state: "fresh",
      core_age_seconds: 30,
      effective_market_date: "2026-08-11",
      source_health: { durable: true, non_durable_feeds: [] },
      core_feeds: [
        { instrument: "MNQ", timeframe: "1", provenance: { durable: true, classification: "durable_alert" } },
        { instrument: "MNQ", timeframe: "5", provenance: { durable: true, classification: "durable_alert" } },
        { instrument: "MES", timeframe: "1", provenance: { durable: true, classification: "durable_alert" } },
        { instrument: "MES", timeframe: "5", provenance: { durable: true, classification: "durable_alert" } },
      ],
    },
    operations: {
      services: [
        { service_id: "live_runtime_scheduler", service_kind: "live_runtime_scheduler", status: "healthy", healthy: true, details: { data_state: "fresh" } },
        { service_id: "broker_management", service_kind: "broker_management", status: "healthy", healthy: true, details: { result: { paper_safety: { execution_enabled: true, bridge_mode: "sim101_addon_approved_only", kill_switch_released: true, max_contracts: 2, execution_authority_mode: "auto", entry_operator_approval_required: false, submission_possible: true, live_account_allowed: false, addon_heartbeat_fresh: true, addon_connected: true, connection_ready: true, command_enabled: true, account_name: "Sim101", sim101_account: true } } } },
      ],
    },
  };

  return {
    clock: { now: () => ({ utc: "2026-08-11T08:00:00.000Z" }) },
    async getExecutionOverview() { return execution; },
    async getLiveDeskState(args = {}) { return { resolved_scope: { trading_date: args.trading_date || "2026-08-11", session: args.session || "asia_open", mode: args.mode || "paper" } }; },
    async getOperationsObservability() { return { summary: { processes: 1, queued: 1, running: 0, failed: 0, completed: 0, retries: 0, slaBreaches: 1 }, queue: { depth: 1 }, leases: { active: 0, expiring: 0, expired: 0 }, aiWorkers: { expected: 1, registered: 0, healthy: 0, active: 0, degraded: 0, items: [] }, aiRuntimeSettings: { reasoningEffort: "xhigh", revision: 1, source: "test", appliesTo: "next_analysis", supportedReasoningEfforts: ["high", "xhigh"] }, breakdowns: { workflows: [] }, items: [] }; },
    async health() { return health; },
    async getStrategyV2Overview() { return strategy; },
    async getOperationsPerformance() { return { items: [], summary: { max_drawdown_R: 0 }, totals: { totalR: 1, trades: 1 }, dayDrilldowns: [{ date: "2026-08-11", totalR: 1, trades: 1, tradeItems: [] }], breakdowns: [] }; },
    async listOperationsReplays() { return { summary: { executions: 1, active: 0, totalR: 1 }, days: [], items: [{ id: "replay-1", sourceId: "replay-1", name: "Replay test", status: "COMPLETED", progress: 100, metrics: { totalR: 1 } }] }; },
    async getOperationsReplay() { return { run: { id: "replay-1", sourceId: "replay-1", name: "Replay test", status: "COMPLETED", progress: 100, metrics: { totalR: 1 } }, timeline: [], gptProcesses: [] }; },
    async getOperationsReplayTimeline() { return { items: [] }; },
    async compareOperationsReplays() { return { items: [] }; },
    async getOperationsWorkflow() { return { workflow: { id: "workflow-1", status: "COMPLETED", progress: 100 }, steps: [], events: [] }; },
    async getLiveTimelineEventDetail() { return { event: { id: "event-1", eventType: "monitor.completed", status: "RECORDED" } }; },
    async listOperationsRunbooks() { return { summary: {}, items: [] }; },
    async getPromptRegistryOverview() { return { summary: {}, items: [] }; },
    async getOperationsObservabilityPolicy() { return { policy: { id: "policy-observability", status: "ACTIVE", revision: 1 } }; },
    async listOperationsIncidents() { return incidents; },
    async listAgentRuntimeTasks() { return runtimeTasks; },
    async listAgentRuntimeMetrics() { return { items: [] }; },
    async listAgentRuntimeDeadLetters() { return { items: [] }; },
    async getFrontAssistantRuntime() { return overrides.assistantRuntime || { conversations: [], messages: [] }; },
    async getResearchLabOverview() { return research; },
    async listDataFoundationDatasets() { return datasets; },
    operations: {
      async listSimulationRuns() { return simulations; },
    },
  };
}

function coldStartReadyHealth() {
  return {
    ready: true,
    ok: true,
    mode: "postgres",
    data_readiness: {
      ok: true,
      state: "fresh",
      core_age_seconds: 20,
      effective_market_date: "2026-08-11",
      source_health: { durable: true, non_durable_feeds: [] },
      core_feeds: [
        { instrument: "MNQ", timeframe: "1", provenance: { durable: true, classification: "durable_alert" } },
        { instrument: "MNQ", timeframe: "5", provenance: { durable: true, classification: "durable_alert" } },
        { instrument: "MES", timeframe: "1", provenance: { durable: true, classification: "durable_alert" } },
        { instrument: "MES", timeframe: "5", provenance: { durable: true, classification: "durable_alert" } },
      ],
    },
    operations: {
      services: [
        {
          service_id: "live_runtime_scheduler",
          service_kind: "live_runtime_scheduler",
          status: "healthy",
          healthy: true,
          heartbeat_at_utc: "2026-08-11T08:00:00.000Z",
          details: { data_state: "fresh" },
        },
        {
          service_id: "broker_management",
          service_kind: "broker_management",
          status: "healthy",
          healthy: true,
          heartbeat_at_utc: "2026-08-11T08:00:00.000Z",
          details: {
            result: {
              paper_safety: {
                execution_enabled: false,
                bridge_mode: "telegram_manual_theoretical",
                kill_switch_released: true,
                max_contracts: 2,
                execution_authority_mode: "semi_auto",
                entry_operator_approval_required: true,
                manual_telegram_execution_enabled: true,
                submission_possible: false,
                live_account_allowed: false,
                addon_heartbeat_fresh: false,
                addon_connected: false,
                connection_ready: false,
                command_enabled: false,
                account_name: "Sim101",
                sim101_account: true,
              },
            },
          },
        },
        {
          service_id: "telegram_alerting",
          service_kind: "telegram_alerting",
          status: "healthy",
          healthy: true,
          heartbeat_at_utc: "2026-08-11T08:00:00.000Z",
          details: { environment: { workerEnabled: true, tradingConfigured: true } },
        },
      ],
    },
  };
}
