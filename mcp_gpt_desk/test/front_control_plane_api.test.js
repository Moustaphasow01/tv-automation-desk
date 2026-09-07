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
  "strategy-detail", "strategy-compare", "live-trading", "live-focus", "live-signal-detail", "orders", "risk",
  "order-detail", "position-detail", "incident-detail",
  "execution-providers", "execution-incidents", "portfolio", "jarvis-workspace",
  "sessions", "live-plan", "live-news", "live-timeline", "execution-reconciliation", "operations-observability",
  "research-experiments", "research-candidates", "research-dataset-detail", "strategy-deployments",
  "replay-overview", "replay-runs", "replay-run-detail", "replay-compare",
  "performance-overview", "performance-calendar", "performance-day-detail", "performance-strategies", "performance-trades",
  "workflow-detail", "event-detail", "operations-runbooks", "governance-prompts", "governance-policies",
];

function sourcePendingBeyondBffTimeout() {
  let guardTimer;
  const promise = new Promise((_, reject) => {
    guardTimer = setTimeout(
      () => reject(new Error("test_source_outlived_expected_bff_timeout")),
      1_000,
    );
  });
  return { promise, dispose: () => clearTimeout(guardTimer) };
}

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
    "execution.order_intent.manual_closed",
    "execution.order_intent.manual_filled",
    "execution.order_intent.manual_modified",
    "execution.order_intent.manual_note",
    "execution.order_intent.manual_placed",
    "execution.order_intent.manual_skipped",
    "execution.order_intent.reject",
    "execution.order_intent.undo",
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

test("strategy center resolves running shadow instances through Definition Version Instance lineage", async () => {
  const definition = {
    strategy_definition_id: "strdef-shadow",
    name: "Data-driven MNQ — VWAP proxy reject short",
    family: "vwap_proxy_reject_short",
    default_instruments: ["MNQ"],
  };
  const version = {
    strategy_version_id: "strver-shadow",
    strategy_definition_id: "strdef-shadow",
    version_label: "1.14.15+runtime",
    status: "VALIDATED",
    runtime_contract_bundle_version: "strategy-runtime-v4",
    metadata: { timeframe: "5", metrics: { total_r: 4.25, profit_factor: 1.42, win_rate_pct: 61, max_drawdown_r: -1.2 } },
  };
  const instance = {
    strategy_instance_id: "strinst-shadow",
    strategy_version_id: "strver-shadow",
    runtime_state: "RUNNING",
    execution_mode: "SHADOW",
    instrument_scope: ["MNQ"],
  };

  const envelope = await handleFrontControlPlane(frontControlPlaneStore({
    strategy: {
      summary: { definitions: 1, versions: 1, instances: 1 },
      definitions: [definition],
      versions: [version],
      instances: [instance],
      strategies: [{ ...definition, latest_version: version, versions: [version], instances: [instance] }],
      audit: [],
    },
  }), {
    pathname: "/front-api/v1/views/strategy-center",
    method: "GET",
  });

  const [row] = envelope.data.strategies;
  assert.equal(row.name, "Data-driven MNQ — VWAP proxy reject short · 1.14.15+runtime");
  assert.equal(row.strategyDefinitionId, "strdef-shadow");
  assert.equal(row.strategyVersionId, "strver-shadow");
  assert.equal(row.strategyInstanceId, "strinst-shadow");
  assert.equal(row.runtimeBundleId, "strategy-runtime-v4");
  assert.equal(row.executionMode, "SHADOW");
  assert.equal(row.runtimeStatus, "RUNNING");
  assert.deepEqual(row.instruments, ["MNQ"]);
  assert.deepEqual(envelope.data.lifecycleDistribution, [{ label: "SHADOW", count: 1, pct: 100 }]);
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
        risk_decisions: [{
          risk_decision_id: "risk-live-1",
          decision: "APPROVED",
          status: "PASS",
          authorized: { risk_amount: 40, risk_pct: 0.04 },
          trade_risk: { risk_per_contract: 40 },
          nearest_limit: { type: "PORTFOLIO_RISK", utilization: 0.4 },
        }],
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
  store.getFrontLiveMarketSnapshot = async () => ({
    source: "postgres_market_feeds",
    instruments: {
      MNQ: {
        symbol: "MNQ",
        latest_close: 21470.25,
        latest_timestamp_paris: "2026-08-11T10:00:00+02:00",
        availability: "live_postgres",
        source: "market_feeds/MNQ_1/candles",
      },
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
      proposed_trade_plan: {
        availability: "KNOWN",
        order_type: "LIMIT",
        entry: { price: 21450.25 },
        stop: { price: 21410.25 },
        targets: [{ price: 21490.25 }],
        source: { kind: "[object Object]", source_data_cutoff_utc: "2026-08-11T07:59:00.000Z" },
      },
      trade_plan_economics: { availability: "KNOWN", risk_per_contract: 40 },
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
  assert.equal(envelope.data.signals[0].proposedTradePlan.source.kind, "strategy_signal_outbox");
  assert.equal(envelope.data.signals[0].proposedTradePlan.source.source_data_cutoff_utc, "2026-08-11T07:59:00.000Z");
  assert.equal(envelope.data.timeSeriesContracts.schemaVersion, "front_time_series_contracts_v1");
  assert.equal(envelope.data.timeSeriesContracts.series.find((series) => series.seriesId === "trading.order_intent_overlays")?.availability, "KNOWN");
  assert.equal(envelope.data.timeSeriesContracts.series.find((series) => series.seriesId === "market.ohlcv")?.availability, "UNAVAILABLE");
  assert.equal(envelope.data.telegramDrilldown.schemaVersion, "telegram_drilldown_front_v1");
  assert.equal(envelope.data.telegramDrilldown.availability, "KNOWN");
  assert.equal(envelope.data.telegramDrilldown.secretsExposed, false);
  assert.equal(envelope.meta.warnings.includes("live-risk-checks:UNAVAILABLE"), false);
  assert.equal(envelope.meta.warnings.includes("live-correlated-exposure:UNAVAILABLE"), false);
  assert.equal(envelope.data.riskChecks[0].source, "portfolio_risk_decisions");
  assert.equal(envelope.data.riskChecks[0].riskCheckId, "risk-live-1");
  assert.equal(envelope.data.riskChecks[0].status, "PASS");
  assert.equal(envelope.data.riskChecks[0].usedPct, 40);

  const commandCenter = await handleFrontControlPlane(store, {
    pathname: "/front-api/v1/views/command-center",
    query: { trading_date: "2026-08-11", session: "ny_open", mode: "paper" },
  });
  assert.equal(commandCenter.data.signals.rows[0].gate, "TAKE");
  assert.equal(commandCenter.data.signals.rows[0].portfolioDecision, "READY");
  assert.equal(commandCenter.data.signals.rows[0].riskDecision, "PASS");
});

test("live trading keeps signal, portfolio and risk stages on the same current lineage cohort", async () => {
  const currentIntent = portfolioIntentFixture({
    intentId: "portfolio_order_intent_current",
    signalId: "signal-current",
    riskDecisionId: "risk-current",
    limitId: "limit-current",
    utilization: 0.25,
  });
  const historicalIntent = portfolioIntentFixture({
    intentId: "portfolio_order_intent_historical",
    signalId: "signal-historical",
    riskDecisionId: "risk-historical",
    limitId: "limit-historical",
    utilization: 0.9,
  });
  const store = frontControlPlaneStore({
    execution: {
      portfolioOrderIntents: [currentIntent, historicalIntent],
      humanExecutionGates: [],
      arbitrations: [
        { arbitration_id: "arb-current", signal_id: "signal-current", decision: "ACCEPTED", target_quantity: 1 },
        { arbitration_id: "arb-historical", signal_id: "signal-historical", decision: "ACCEPTED", target_quantity: 1 },
      ],
      risk_checks: [
        { risk_check_id: "risk-current", signal_id: "signal-current", status: "PASS", limit_label: "Raw limit without utilization", used_pct: null },
        { risk_check_id: "risk-raw-historical", signal_id: "signal-historical", status: "PASS", used_pct: 90 },
      ],
    },
    strategy: {
      definitions: [],
      versions: [],
      instances: [],
      signals: [
        { signal_id: "signal-current", strategy_instance_id: "instance-current", instrument_code: "MNQ", side: "long", status: "NEW", expires_at_utc: "2026-08-11T09:00:00.000Z" },
        { signal_id: "signal-historical", strategy_instance_id: "instance-historical", instrument_code: "MNQ", side: "short", status: "EXPIRED", expires_at_utc: "2026-08-11T07:00:00.000Z" },
        { signal_id: "signal-rejected", strategy_instance_id: "instance-rejected", instrument_code: "MES", side: "long", status: "REJECTED" },
        { signal_id: "signal-closed", strategy_instance_id: "instance-closed", instrument_code: "ZW", side: "short", status: "CLOSED" },
        { signal_id: "signal-consumed", strategy_instance_id: "instance-consumed", instrument_code: "ZC", side: "long", status: "consumed", expires_at_utc: "2026-08-11T09:00:00.000Z" },
        { signal_id: "signal-cancelled", strategy_instance_id: "instance-cancelled", instrument_code: "ZW", side: "long", status: "cancelled", expires_at_utc: "2026-08-11T09:00:00.000Z" },
      ],
    },
  });
  store.listAiContextGateDecisions = async () => ({
    items: [
      { ai_context_gate_decision_id: "ctx-current", signal_id: "signal-current", recommendation: "TAKE" },
      { ai_context_gate_decision_id: "ctx-historical", signal_id: "signal-historical", recommendation: "TAKE" },
    ],
  });

  const envelope = await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/live-trading", query: {} });

  assert.deepEqual(envelope.data.signals.map((item) => item.signalId), ["signal-current", "signal-historical", "signal-rejected", "signal-closed", "signal-consumed", "signal-cancelled"]);
  assert.deepEqual(envelope.data.signals.map((item) => item.state), ["NEW", "EXPIRED", "REJECTED", "CLOSED", "CONSUMED", "CANCELLED"]);
  assert.deepEqual(envelope.data.canonicalRuntime.latestSignals.map((item) => item.signalId), ["signal-current"]);
  assert.deepEqual(envelope.data.portfolioOrderIntents.map((item) => item.portfolioOrderIntentId), ["portfolio_order_intent_current"]);
  assert.deepEqual(envelope.data.arbitrations.map((item) => item.arbitrationId), ["arb-current"]);
  assert.deepEqual(envelope.data.riskChecks.map((item) => item.riskCheckId), ["risk-current"]);
  assert.equal(envelope.data.riskChecks[0].usedPct, 25);
  assert.equal(envelope.data.riskChecks[0].source, "portfolio_risk_decisions");
  assert.equal(envelope.data.riskChecks.every((item) => Number.isFinite(item.usedPct)), true);
  assert.deepEqual(envelope.data.canonicalRuntime.aiContextGate.map((item) => item.decisionId), ["ctx-current"]);
  assert.deepEqual(envelope.data.canonicalRuntime.riskCenter.limits.map((item) => item.limit_id), ["limit-current"]);
  assert.equal(envelope.data.canonicalRuntime.riskCenter.openRisk.value, 40);
});

test("live trading keeps Human Gate actionable when Risk utilization is unavailable", async () => {
  const intent = portfolioIntentFixture({
    intentId: "portfolio_order_intent_without_utilization",
    signalId: "signal-without-utilization",
    riskDecisionId: "risk-without-utilization",
    limitId: null,
    utilization: null,
  });
  const store = frontControlPlaneStore({
    execution: {
      session_id: "live-session-without-utilization",
      next_monitor_at: "2026-08-11T08:05:00.000Z",
      pipeline: [{ step: "GLOBAL_RISK", status: "COMPLETED" }],
      timeline: [{ event_id: "event-risk-without-utilization", event_type: "risk.completed", occurred_at_utc: "2026-08-11T08:00:00.000Z" }],
      portfolioOrderIntents: [intent],
      humanExecutionGates: [{
        human_execution_gate_id: "gate-without-utilization",
        portfolio_order_intent_id: "portfolio_order_intent_without_utilization",
        status: "AWAITING_MANUAL_CONFIRMATION",
        revision: 1,
      }],
    },
    strategy: {
      definitions: [], versions: [], instances: [],
      signals: [{ signal_id: "signal-without-utilization", strategy_instance_id: "instance-1", instrument_code: "MNQ", side: "long", status: "NEW", expires_at_utc: "2026-08-11T09:00:00.000Z" }],
    },
  });
  store.getFrontMarketSeries = async () => ({ availability: "AVAILABLE", points: [], supportedTimeframes: ["5"], asOf: "2026-08-11T08:00:00.000Z", source: "market_candles" });
  store.getFrontLiveMarketSnapshot = async () => ({ instruments: [], asOf: "2026-08-11T08:00:00.000Z", source: "market_candles" });
  store.getLiveDeskState = async (args = {}) => ({
    resolved_scope: {
      strategy_id: args.strategy_id || "asia_open",
      trading_date: args.trading_date || "2026-08-11",
      session: args.session || "asia_open",
      mode: args.mode || "paper",
    },
  });

  const envelope = await handleFrontControlPlane(store, {
    pathname: "/front-api/v1/views/live-trading",
    query: {},
    actor: { kind: "operator_session", scopes: ["desk.write"] },
  });

  assert.deepEqual(envelope.meta.warnings, []);
  assert.equal(envelope.meta.availability, "AVAILABLE");
  assert.equal(envelope.data.riskChecks.length, 1);
  assert.equal(envelope.data.riskChecks[0].riskCheckId, "risk-without-utilization");
  assert.equal(envelope.data.riskChecks[0].status, "PASS");
  assert.equal(envelope.data.riskChecks[0].limitLabel, "Global Risk");
  assert.equal(envelope.data.riskChecks[0].reasonCode, "RISK_DECISION_PUBLISHED");
  assert.equal(envelope.data.riskChecks[0].usedPct, null);
  assert.deepEqual(envelope.data.portfolioOrderIntents[0].allowedActions.allowedActions, ["VIEW", "CONFIRM", "REJECT"]);
  assert.deepEqual(envelope.data.portfolioOrderIntents[0].humanGate.allowedActions.map((item) => item.action), ["CONFIRM", "REJECT"]);
  assert.equal(envelope.data.portfolioOrderIntents[0].humanGate.allowedActions.every((item) => item.permission === "ALLOWED"), true);
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

test("front control plane preserves stale market feeds as stale, not unavailable or unknown", async () => {
  const store = frontControlPlaneStore({
    health: {
      ...coldStartReadyHealth(),
      data_readiness: {
        ok: false,
        state: "stale",
        market_closed: false,
        market_session: { state: "trading_day" },
        freshness_policy: { max_age_seconds: 900 },
        core_age_seconds: 1800,
        effective_market_date: "2026-08-11",
        source_health: { durable: true, non_durable_feeds: [] },
        core_feeds: [{
          feed_id: "prod__tradingview__MNQ1!__5",
          instrument: "MNQ",
          timeframe: "5",
          latest_timestamp_utc: "2026-08-11T07:30:00.000Z",
          age_seconds: 1800,
          provenance: { durable: true, classification: "durable_alert" },
        }],
      },
    },
  });

  const commandCenter = await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/command-center", query: {} });
  const live = await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/live-trading", query: {} });

  assert.equal(commandCenter.data.market.status, "STALE");
  assert.equal(commandCenter.data.market.rows[0].status, "STALE");
  assert.equal(live.data.session.marketDataStatus, "STALE");
  assert.equal(live.data.session.marketState, "TRADING_DAY");
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

test("events audit publishes causal edges and display-ready logs without undefined placeholders", async () => {
  const store = frontControlPlaneStore({
    execution: {
      timeline: [
        { event_id: "evt-signal", correlation_id: "corr-audit", event_type: "signal.created", status: "OK", occurred_at_utc: "2026-08-11T08:00:00.000Z", title: "Signal créé" },
        { event_id: "evt-risk", correlation_id: "corr-audit", causation_id: "evt-signal", event_type: "risk.approved", status: "WATCH", occurred_at_utc: "2026-08-11T08:00:01.000Z", title: "Risque approuvé" },
      ],
    },
  });

  const envelope = await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/events-audit", query: {} });
  assert.deepEqual(envelope.data.relations.find((item) => item.toEventId === "evt-risk"), {
    fromEventId: "evt-signal",
    toEventId: "evt-risk",
    relation: "CAUSES",
  });
  assert.equal(envelope.data.selectedCorrelation.logs.every((item) => item.logId && item.level && item.message && !item.message.includes("undefined")), true);
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
  assert.equal(envelope.data.summaryTruth.grossExposureUsd.state, "UNAVAILABLE");
  assert.equal(envelope.data.summaryTruth.unrealizedPnl.state, "STALE");
  assert.deepEqual(envelope.data.positions.map((item) => item.positionId), ["trade-open"]);
  assert.deepEqual(envelope.data.brokerPositions.map((item) => item.positionId), ["trade-open"]);
  assert.deepEqual(envelope.data.exposureTree, []);
  assert.equal(envelope.data.reconciliation.status, "PENDING");
  assert.equal(envelope.meta.warnings.includes("portfolio-account-snapshot:STALE"), true);
  assert.equal(envelope.meta.warnings.includes("portfolio-attribution:NOT_IMPLEMENTED"), true);
});

test("front control plane portfolio reads risk_center's real openRisk aggregate and derived counts instead of hardcoded zeros", async () => {
  const store = frontControlPlaneStore({
    execution: {
      accounts: [
        { broker_account_id: "Sim101", provider_id: "ninjatrader", account_label: "SIM-MAIN", mode: "paper" },
        { broker_account_id: "Sim102", provider_id: "ninjatrader", account_label: "SIM-SECONDARY", mode: "paper" },
      ],
      accountSnapshots: [
        { broker_account_id: "Sim101", captured_at: "2026-08-11T08:00:00.000Z", unrealized_pnl: 250, payload: { net_liquidation_value: 725_450 } },
        { broker_account_id: "Sim102", captured_at: "2026-08-11T08:00:00.000Z", unrealized_pnl: -40, payload: { net_liquidation_value: 312_250 } },
      ],
      trades: [
        { trade_id: "trade-long", status: "OPEN", instrument_code: "MNQ", side: "long", quantity_open: 2, entry_price: 22_100, strategy_instance_id: "strinst-1", broker_account_id: "Sim101" },
        { trade_id: "trade-short", status: "OPEN", instrument_code: "MES", side: "short", quantity_open: 1, entry_price: 6_100, strategy_instance_id: "strinst-2", broker_account_id: "Sim102" },
      ],
      portfolioOrderIntents: [{
        portfolio_order_intent_id: "poi-1",
        status: "READY",
        risk_decisions: [{ authorized: { risk_amount: 735 } }],
      }],
      humanExecutionGates: [{ human_execution_gate_id: "hg-1", portfolio_order_intent_id: "poi-1", status: "AWAITING_MANUAL_CONFIRMATION" }],
    },
    strategy: { definitions: [], versions: [], instances: [], signals: [] },
  });

  const envelope = await handleFrontControlPlane(store, {
    pathname: "/front-api/v1/views/portfolio",
    method: "GET",
    query: {},
  });

  // grossExposure/netExposure/dailyLoss/trailingDrawdown are still hardcoded
  // UNAVAILABLE in front-portfolio-risk-projection.js's riskCenterState() - that
  // computation doesn't exist yet, so these correctly stay unavailable/zero here too.
  assert.equal(envelope.data.summaryTruth.grossExposureUsd.state, "UNAVAILABLE");
  assert.equal(envelope.data.summary.maxDrawdownR, 0);
  // openRisk *is* really computed (aggregateMoney over risk_decisions[].authorized.risk_amount).
  assert.equal(envelope.data.summary.exposureUsd, 735);
  assert.equal(envelope.data.summary.positionsLong, 1);
  assert.equal(envelope.data.summary.positionsShort, 1);
  assert.equal(envelope.data.summary.strategiesWithPositions, 2);
  assert.equal(envelope.data.summary.humanGatePending, 1);
  assert.equal(envelope.data.summary.pendingOrders, 1);
  assert.equal(envelope.data.accountsSummary.length, 2);
  const main = envelope.data.accountsSummary.find((item) => item.accountId === "Sim101");
  assert.equal(main.label, "SIM-MAIN");
  assert.equal(main.equity, 725_450);
  assert.equal(main.openPnl, 250);
  assert.equal(main.openPositions, 1);
});

test("front control plane orders humanGateReview lists real portfolio order intents with their human gate status", async () => {
  const store = frontControlPlaneStore({
    execution: {
      portfolioOrderIntents: [
        {
          portfolio_order_intent_id: "poi-pending",
          target_instrument: "MNQ",
          created_at_utc: "2026-08-11T07:58:00.000Z",
          payload: { action: "BUY", quantity: 3 },
          risk_decisions: [{ authorized: { quantity: 2, risk_pct: 0.62 } }],
        },
        {
          portfolio_order_intent_id: "poi-confirmed",
          target_instrument: "MES",
          created_at_utc: "2026-08-11T07:50:00.000Z",
          payload: { action: "SELL", quantity: 1, strategy_instance_id: "strategy-confirmed" },
        },
        {
          portfolio_order_intent_id: "poi-rejected",
          target_instrument: "ZW",
          created_at_utc: "2026-08-11T07:45:00.000Z",
          payload: { action: "BUY", quantity: 1, strategy_instance_id: "strategy-rejected" },
        },
        {
          portfolio_order_intent_id: "poi-expired",
          target_instrument: "ZC",
          created_at_utc: "2026-08-11T07:40:00.000Z",
          payload: { action: "BUY", quantity: 1, strategy_instance_id: "strategy-expired" },
        },
      ],
      humanExecutionGates: [
        { human_execution_gate_id: "hg-pending", portfolio_order_intent_id: "poi-pending", status: "AWAITING_MANUAL_CONFIRMATION" },
        { human_execution_gate_id: "hg-confirmed", portfolio_order_intent_id: "poi-confirmed", status: "CONFIRMED", confirmed_at_utc: "2026-08-11T07:51:42.000Z" },
        { human_execution_gate_id: "hg-rejected", portfolio_order_intent_id: "poi-rejected", status: "REJECTED", rejected_at_utc: "2026-08-11T07:46:00.000Z" },
        { human_execution_gate_id: "hg-expired", portfolio_order_intent_id: "poi-expired", status: "EXPIRED" },
      ],
      humanExecutionGateEvents: [
        { human_execution_gate_event_id: "hge-rejected", portfolio_order_intent_id: "poi-rejected", event_type: "REJECTED", operator_id: "operator-1", occurred_at_utc: "2026-08-11T07:46:00.000Z", payload: { reason: "Prix sorti de la zone" } },
      ],
    },
  });

  const envelope = await handleFrontControlPlane(store, {
    pathname: "/front-api/v1/views/orders",
    method: "GET",
    query: {},
  });

  const review = envelope.data.humanGateReview;
  assert.equal(review.items.length, 4);
  assert.equal(review.summary.pendingCount, 1);
  assert.equal(review.summary.approvedToday, 1);
  assert.equal(review.summary.rejectedToday, 1);
  assert.equal(review.summary.avgDecisionSeconds, 81);
  const pendingItem = review.items.find((item) => item.orderIntentId === "poi-pending");
  assert.equal(pendingItem.instrument, "MNQ");
  assert.equal(pendingItem.side, "BUY");
  assert.equal(pendingItem.authorizedQuantity, 2);
  assert.equal(pendingItem.status, "AWAITING_MANUAL_CONFIRMATION");
  assert.equal(pendingItem.route, "/execution/orders/poi-pending");
  assert.equal(review.refusalJournal[0].reason, "Prix sorti de la zone");
  assert.deepEqual(review.refusalReasons, [{ reason: "Prix sorti de la zone", count: 1 }]);
  assert.deepEqual(review.expirationByStrategy.find((item) => item.strategyInstanceId === "strategy-expired"), {
    strategyInstanceId: "strategy-expired",
    expired: 1,
    total: 1,
    expirationPct: 100,
  });
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

test("front control plane Human Gate undo routes through the audited backend transition", async () => {
  const calls = [];
  const store = {
    ...frontControlPlaneStore(),
    async commitFrontOperatorCommandMutation(plan) { return { replayed: false, command: plan.commandDoc, result: plan.result }; },
    async executeBrokerAction({ input, actor }) {
      calls.push({ input, actor });
      return { status: "REVERTED", idempotent: false, gate: { portfolio_order_intent_id: input.portfolioOrderIntentId, status: "AWAITING_MANUAL_CONFIRMATION" } };
    },
  };
  const accepted = await handleFrontControlPlane(store, {
    pathname: FRONT_CONTROL_PLANE_COMMANDS_PATH,
    method: "POST",
    body: {
      commandType: "execution.order_intent.undo",
      environment: "PAPER",
      expectedVersion: 4,
      payload: { portfolioOrderIntentId: "portfolio_order_intent_undo_test" },
      reason: "Correction immédiate de la décision opérateur.",
    },
    headers: { "idempotency-key": "idem-human-gate-undo-001", "x-correlation-id": "corr-human-gate-undo-001" },
    actor: { kind: "test-operator", authorized: true, scopes: ["desk.read", "desk.write"] },
  });
  assert.equal(accepted.runtimeMutation, "EXECUTED");
  assert.equal(accepted.mutationResult.status, "REVERTED");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].input, {
    action: "undo_human_execution_gate",
    portfolioOrderIntentId: "portfolio_order_intent_undo_test",
    expectedRevision: 4,
    idempotencyKey: "idem-human-gate-undo-001",
    reason: "Correction immédiate de la décision opérateur.",
    confirmationPhrase: "CONFIRM_UNDO_HUMAN_GATE",
    approvedTerms: undefined,
  });
});

test("front control plane records a manual placed declaration only after backend Human Gate confirmation", async () => {
  const calls = [];
  const store = {
    ...frontControlPlaneStore(),
    async commitFrontOperatorCommandMutation(plan) { return { replayed: false, command: plan.commandDoc, result: plan.result }; },
    async getExecutionOverview() {
      return {
        portfolioOrderIntents: [{
          portfolio_order_intent_id: "portfolio_order_intent_manual_1",
          revision: 7,
          quantity: 2,
          order_intent_payload: {
            order_intent_id: "order_intent_manual_1",
            instrument: "ZC",
            action: "BUY",
            quantity: 2,
            entry_price: 471.25,
            protection: { stop_price: 468.75, target_price: 476.25 },
          },
        }],
        humanExecutionGates: [{ portfolio_order_intent_id: "portfolio_order_intent_manual_1", status: "CONFIRMED", revision: 3 }],
        manualExecutionEvents: [],
        theoreticalEvents: [],
        trades: [],
      };
    },
    async executeBrokerAction({ input, actor }) {
      calls.push({ input, actor });
      return { ok: true, status: "RECORDED", event: { event_type: input.eventType } };
    },
  };
  const accepted = await handleFrontControlPlane(store, {
    pathname: FRONT_CONTROL_PLANE_COMMANDS_PATH,
    method: "POST",
    body: {
      commandType: "execution.order_intent.manual_placed",
      environment: "PAPER",
      expectedVersion: "7",
      payload: { portfolioOrderIntentId: "portfolio_order_intent_manual_1", price: 471.25, quantity: 2 },
      reason: "Ordre limite saisi chez le broker par l’opérateur.",
    },
    headers: { "idempotency-key": "idem-manual-placed-001", "x-correlation-id": "corr-manual-placed-001" },
    actor: { kind: "operator_session", scopes: ["desk.read", "desk.write"], uid: "operator-1" },
  });
  assert.equal(accepted.runtimeMutation, "EXECUTED");
  assert.equal(accepted.mutationResult.status, "RECORDED");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.action, "record_manual_execution_event");
  assert.equal(calls[0].input.eventType, "placed");
  assert.equal(calls[0].input.price, 471.25);
  assert.equal(calls[0].input.quantity, 2);
  assert.equal(calls[0].input.source, "front-focus");
});

test("front control plane refuses a manual placed declaration before Human Gate confirmation", async () => {
  const store = {
    ...frontControlPlaneStore(),
    async commitFrontOperatorCommandMutation(plan) { return { replayed: false, command: plan.commandDoc, result: plan.result }; },
    async getExecutionOverview() {
      return {
        portfolioOrderIntents: [{ portfolio_order_intent_id: "portfolio_order_intent_manual_blocked", quantity: 1, order_intent_payload: { instrument: "ZW", action: "SELL", entry_price: 522, protection: { stop_price: 525, target_price: 516 } } }],
        humanExecutionGates: [{ portfolio_order_intent_id: "portfolio_order_intent_manual_blocked", status: "AWAITING_MANUAL_CONFIRMATION" }],
        manualExecutionEvents: [], theoreticalEvents: [], trades: [],
      };
    },
    async executeBrokerAction() { throw new Error("must not execute"); },
  };
  await assert.rejects(() => handleFrontControlPlane(store, {
    pathname: FRONT_CONTROL_PLANE_COMMANDS_PATH,
    method: "POST",
    body: { commandType: "execution.order_intent.manual_placed", environment: "PAPER", payload: { portfolioOrderIntentId: "portfolio_order_intent_manual_blocked", price: 522, quantity: 1 } },
    headers: { "idempotency-key": "idem-manual-blocked-001" },
    actor: { kind: "operator_session", scopes: ["desk.read", "desk.write"] },
  }), (error) => error.code === "MANUAL_EXECUTION_TRANSITION_DENIED" && error.statusCode === 409);
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
      { signal_id: "signal-expired", strategy_id: "strategy-c", instrument_code: "ZW", side: "long", confidence: 55, status: "EXPIRED", expires_at_utc: "2026-08-10T08:00:00.000Z" },
      { signal_id: "signal-clock-expired", strategy_id: "strategy-d", instrument_code: "ZC", side: "long", confidence: 57, status: "NEW", expires_at_utc: "2026-08-10T08:00:00.000Z" },
    ],
  });

  await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/command-center", query: {} });
  assert.deepEqual(forbiddenCalls.sort(), ["data", "research"]);

  const first = await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/live-signal-detail", query: { signalId: "signal-a" } });
  const second = await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/live-signal-detail", query: { signalId: "signal-b" } });
  const expired = await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/live-signal-detail", query: { signalId: "signal-expired" } });
  const clockExpired = await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/live-signal-detail", query: { signalId: "signal-clock-expired" } });
  assert.equal(first.data.identity.signalId, "signal-a");
  assert.equal(second.data.identity.signalId, "signal-b");
  assert.equal(expired.data.identity.signalId, "signal-expired");
  assert.equal(expired.data.signal.state, "EXPIRED");
  assert.equal(clockExpired.data.signal.state, "NEW");
  assert.equal(clockExpired.data.signal.effectiveState, "EXPIRED");
  assert.equal(clockExpired.data.signal.temporalReason, "EXPIRY_TIMESTAMP_ELAPSED");
  assert.notEqual(first.data.signal.symbol, second.data.signal.symbol);
  await assert.rejects(
    () => handleFrontControlPlane(store, { pathname: "/front-api/v1/views/live-signal-detail", query: { signalId: "missing" } }),
    (error) => error.code === "LIVE_SIGNAL_NOT_FOUND" && error.statusCode === 404,
  );
});

test("live signal detail preserves canonical lineage and exposes its post-risk OrderIntent", async () => {
  const store = frontControlPlaneStore({
    strategy: {
      definitions: [],
      versions: [],
      instances: [],
      signals: [{
        signal_id: "signal-lineage-1",
        instrument_code: "ZW1!",
        side: "long",
        confidence: 0.81,
        created_at_utc: "2026-08-11T07:45:00.000Z",
        expires_at_utc: "2026-08-11T09:00:00.000Z",
        rule_hits: ["SESSION_US", "BREAKOUT_CONFIRMED"],
        lineage: {
          strategy_definition_ids: ["strdef-grain-breakout"],
          strategy_version_ids: ["strver-grain-breakout-v3"],
          strategy_instance_ids: ["strinst-grain-breakout-shadow"],
          strategy_signal_ids: ["signal-lineage-1"],
        },
      }],
    },
    execution: {
      portfolioOrderIntents: [{
        portfolio_order_intent_id: "portfolio-intent-lineage-1",
        target_position_id: "target-lineage-1",
        target_account_id: "Sim101",
        target_instrument: "ZW",
        risk_approved_net_size: 1,
        status: "READY",
        execution_terms: {
          instrument: "ZW",
          side: "BUY",
          quantity: 1,
          order_type: "LIMIT",
          entry: { availability: "KNOWN", price: 528.25 },
          stop: { availability: "KNOWN", price: 525.75 },
          targets: [{ label: "T1", price: 533.25 }],
          time_in_force: "DAY",
        },
        lineage: {
          strategy_definition_ids: ["strdef-grain-breakout"],
          strategy_version_ids: ["strver-grain-breakout-v3"],
          strategy_instance_ids: ["strinst-grain-breakout-shadow"],
          strategy_signal_ids: ["signal-lineage-1"],
          risk_decision_ids: ["risk-lineage-1"],
        },
        risk_decisions: [{
          risk_decision_id: "risk-lineage-1",
          decision: "APPROVED",
          status: "PASS",
          approved_size: 1,
          reason_codes: ["GRAIN_RISK_OK"],
        }],
      }],
      humanExecutionGates: [{
        human_execution_gate_id: "gate-lineage-1",
        portfolio_order_intent_id: "portfolio-intent-lineage-1",
        status: "AWAITING_MANUAL_CONFIRMATION",
        revision: 1,
      }],
    },
  });

  const envelope = await handleFrontControlPlane(store, {
    pathname: "/front-api/v1/views/live-signal-detail",
    query: { signalId: "signal-lineage-1" },
    actor: { kind: "operator_session", scopes: ["desk.read", "desk.write"] },
  });

  assert.equal(envelope.data.identity.strategyDefinitionId, "strdef-grain-breakout");
  assert.equal(envelope.data.identity.strategyVersionId, "strver-grain-breakout-v3");
  assert.equal(envelope.data.identity.strategyInstanceId, "strinst-grain-breakout-shadow");
  assert.deepEqual(envelope.data.predicates.map((item) => item.label), ["SESSION_US", "BREAKOUT_CONFIRMED"]);
  assert.equal(envelope.data.riskCheck.riskCheckId, "risk-lineage-1");
  assert.equal(envelope.data.summary.targetQuantity, 1);
  assert.equal(envelope.data.linkedOrderIntents.length, 1);
  assert.equal(envelope.data.linkedOrderIntents[0].orderIntentId, "portfolio-intent-lineage-1");
  assert.equal(envelope.data.linkedOrderIntents[0].instrument, "ZW");
  assert.equal(envelope.data.linkedOrderIntents[0].route, "/execution/orders/portfolio-intent-lineage-1");
  assert.equal(envelope.data.navigation.some((item) => item.route === "/execution/orders/portfolio-intent-lineage-1"), true);
});

test("live signal detail reads grain prices and R from the canonical proposed trade plan", async () => {
  const store = frontControlPlaneStore({
    strategy: {
      definitions: [],
      versions: [],
      instances: [],
      signals: [{
        signal_id: "signal-grain-plan-1",
        instrument_code: "ZW",
        side: "long",
        confidence: 0.73,
        created_at_utc: "2026-08-27T17:25:00.000Z",
        expires_at_utc: "2026-08-27T18:05:00.000Z",
        proposed_trade_plan: {
          availability: "KNOWN",
          entry: { availability: "KNOWN", type: "ZONE", price: 754, low: 753.75, high: 754.25 },
          stop: { availability: "KNOWN", price: 752.25 },
          targets: [{ availability: "KNOWN", label: "TP1", price: 756.75 }],
        },
        trade_plan_economics: {
          availability: "KNOWN",
          targets: [{ label: "TP1", price: 756.75, reward_risk: 1.5714, expected_r: 1.5714 }],
        },
      }],
    },
  });

  const envelope = await handleFrontControlPlane(store, {
    pathname: "/front-api/v1/views/live-signal-detail",
    query: { signalId: "signal-grain-plan-1" },
  });

  assert.deepEqual({
    entryZoneLow: envelope.data.signal.entryZoneLow,
    entryZoneHigh: envelope.data.signal.entryZoneHigh,
    stopPrice: envelope.data.signal.stopPrice,
    targetPrice: envelope.data.signal.targetPrice,
    rewardRisk: envelope.data.signal.rewardRisk,
    expectancyR: envelope.data.signal.expectancyR,
  }, {
    entryZoneLow: 753.75,
    entryZoneHigh: 754.25,
    stopPrice: 752.25,
    targetPrice: 756.75,
    rewardRisk: 1.5714,
    expectancyR: 1.5714,
  });
});

test("live signal detail resolves both canonical signal and transport outbox identifiers", async () => {
  const store = frontControlPlaneStore({
    strategy: {
      definitions: [],
      versions: [],
      instances: [],
      signals: [{
        signal_outbox_id: "outbox-grain-alias-1",
        signal_id: "signal-grain-alias-1",
        instrument_code: "ZC",
        side: "long",
        created_at_utc: "2026-08-27T17:25:00.000Z",
        expires_at_utc: "2026-08-27T18:05:00.000Z",
      }],
    },
  });

  const canonical = await handleFrontControlPlane(store, {
    pathname: "/front-api/v1/views/live-signal-detail",
    query: { signalId: "signal-grain-alias-1" },
  });
  const legacyBookmark = await handleFrontControlPlane(store, {
    pathname: "/front-api/v1/views/live-signal-detail",
    query: { signalId: "outbox-grain-alias-1" },
  });

  assert.equal(canonical.data.identity.signalId, "signal-grain-alias-1");
  assert.equal(legacyBookmark.data.identity.signalId, "signal-grain-alias-1");
});

test("live signal detail publishes null instead of a false zero when no trade-plan metric exists", async () => {
  const store = frontControlPlaneStore({
    strategy: {
      definitions: [],
      versions: [],
      instances: [],
      signals: [{
        signal_id: "signal-without-plan",
        instrument_code: "ZC",
        side: "short",
        confidence: 0.61,
        created_at_utc: "2026-08-27T17:25:00.000Z",
        expires_at_utc: "2026-08-27T18:05:00.000Z",
      }],
    },
  });

  const envelope = await handleFrontControlPlane(store, {
    pathname: "/front-api/v1/views/live-signal-detail",
    query: { signalId: "signal-without-plan" },
  });

  assert.equal(envelope.data.signal.entryZoneLow, null);
  assert.equal(envelope.data.signal.entryZoneHigh, null);
  assert.equal(envelope.data.signal.stopPrice, null);
  assert.equal(envelope.data.signal.targetPrice, null);
  assert.equal(envelope.data.signal.rewardRisk, null);
  assert.equal(envelope.data.signal.expectancyR, null);
  assert.equal(envelope.data.summary.targetQuantity, 0);
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

test("command center, incidents view and Jarvis share one canonical open-incident population", async () => {
  const store = frontControlPlaneStore({
    incidents: {
      items: [
        { incident_id: "inc-open", status: "OPEN", severity: "CRITICAL", title: "Provider failed", created_at_utc: "2026-08-11T08:00:00.000Z" },
        { incident_id: "inc-resolved", status: "RESOLVED", severity: "CRITICAL", title: "Resolved failure", created_at_utc: "2026-08-11T07:00:00.000Z" },
        { incident_id: "inc-expected", status: "STOPPED", severity: "HIGH", title: "Expected operator stop", created_at_utc: "2026-08-11T06:00:00.000Z" },
      ],
    },
  });

  const [commandCenter, executionIncidents, jarvis] = await Promise.all([
    handleFrontControlPlane(store, { pathname: "/front-api/v1/views/command-center", query: {} }),
    handleFrontControlPlane(store, { pathname: "/front-api/v1/views/execution-incidents", query: {} }),
    handleFrontControlPlane(store, { pathname: "/front-api/v1/views/jarvis-workspace", query: {} }),
  ]);

  assert.equal(commandCenter.data.summary.criticalIncidents, 1);
  assert.equal(commandCenter.data.risk.activeAlerts, 1);
  assert.equal(commandCenter.data.incidents.length, 1);
  assert.equal(executionIncidents.data.summary.openIncidents, 1);
  assert.equal(executionIncidents.data.summary.criticalIncidents, 1);
  assert.equal(jarvis.data.deskSnapshot.openIncidents, 1);
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
  store.getFrontLiveMarketSnapshot = async () => ({
    source: "postgres_market_feeds",
    instruments: {
      MNQ: {
        symbol: "MNQ",
        latest_close: 21470.25,
        latest_timestamp_paris: "2026-08-11T10:00:00+02:00",
        availability: "live_postgres",
        source: "market_feeds/MNQ_1/candles",
      },
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
  assert.equal(envelope.data.order.limitPrice, 21450.25);
  assert.equal(envelope.data.marketContext.lastPrice, 21470.25);
  assert.equal(envelope.data.marketContext.distanceToEntryPoints, 20);
  assert.equal(envelope.data.marketContext.distanceToEntryR, 0.5);
  assert.equal(envelope.data.marketContext.expectedR, 1);
  assert.equal(envelope.data.intent.limitPrice, 21450.25);
  assert.equal(envelope.data.intent.stopPrice, 21410.25);
  assert.equal(envelope.data.intent.targetPrice, 21490.25);
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
  const pendingSource = sourcePendingBeyondBffTimeout();
  store.listOperationsIncidents = async () => pendingSource.promise;
  try {
    const envelope = await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/command-center", query: { scope: "timeout-test" } });
    assert.equal(envelope.meta.availability, "PARTIAL");
    assert.equal(envelope.meta.warnings.includes("incidents:FRONT_SOURCE_TIMEOUT"), true);
    assert.equal(typeof envelope.data.summary, "object");
    assert.equal(envelope.data.summary.criticalIncidents, null);
    assert.equal(envelope.data.risk.activeAlerts, null);
  } finally {
    pendingSource.dispose();
  }
});

test("Live Focus fails closed when its authoritative execution source times out", async () => {
  const store = frontControlPlaneStore();
  store.frontControlPlaneSourceTimeoutMs = 5;
  const pendingSource = sourcePendingBeyondBffTimeout();
  store.getExecutionOverview = async () => pendingSource.promise;

  try {
    await assert.rejects(() => handleFrontControlPlane(store, {
      pathname: "/front-api/v1/views/live-focus",
      query: { diagnostic: "execution-timeout" },
    }), (error) => (
      error.code === "LIVE_FOCUS_EXECUTION_UNAVAILABLE"
      && error.statusCode === 503
    ));
  } finally {
    pendingSource.dispose();
  }
});

test("Live Focus rejects an execution adapter returning no projection", async () => {
  const store = frontControlPlaneStore();
  store.getExecutionOverview = async () => undefined;
  await assert.rejects(() => handleFrontControlPlane(store, {
    pathname: "/front-api/v1/views/live-focus",
    query: { diagnostic: "missing-execution" },
  }), { code: "LIVE_FOCUS_EXECUTION_UNAVAILABLE", statusCode: 503 });
});

test("Live Focus keeps an authoritative empty execution projection as a legitimate empty view", async () => {
  const store = frontControlPlaneStore({
    execution: {
      portfolioOrderIntents: [],
      humanExecutionGates: [],
      theoreticalEvents: [],
      manualExecutionEvents: [],
      trades: [],
    },
  });

  const envelope = await handleFrontControlPlane(store, {
    pathname: "/front-api/v1/views/live-focus",
    query: { diagnostic: "empty-execution" },
  });

  assert.equal(envelope.meta.warnings.some((warning) => warning.startsWith("execution:")), false);
  assert.equal(envelope.data.tradeCards.length, 0);
  assert.equal(envelope.data.whyNoTrade.stageCounts.orderIntents, 0);
});

test("Live Focus reports an unavailable context read without inventing an empty publication", async () => {
  const store = frontControlPlaneStore();
  store.getCurrentMarketContext = async () => {
    throw Object.assign(new Error("sanitized"), { code: "MARKET_CONTEXT_POOL_CHECKOUT_TIMEOUT" });
  };

  const envelope = await handleFrontControlPlane(store, {
    pathname: "/front-api/v1/views/live-focus",
    query: { diagnostic: "context-pool-timeout" },
  });

  assert.equal(envelope.meta.availability, "PARTIAL");
  assert.equal(envelope.meta.warnings.includes("market-context:MARKET_CONTEXT_POOL_CHECKOUT_TIMEOUT"), true);
  assert.equal(envelope.meta.sources.find((item) => item.source === "market-context")?.state, "UNAVAILABLE");
  assert.equal(envelope.data.marketDeskBrief.headline, "Analyse de contexte momentanément indisponible");
  assert.equal(envelope.data.whyNoTrade.stageCounts.contextAccepted, null);
  assert.equal(envelope.data.contextWorker.successCount, null);
});

test("Live Focus keeps its canonical brief when only a context enrichment is degraded", async () => {
  const store = frontControlPlaneStore();
  store.getCurrentMarketContext = async () => ({
    universe: "US_GRAINS_CBOT",
    snapshot: { status: "AVAILABLE", marketContextSnapshotId: "context-kept", sourceDataCutoff: "2026-08-11T08:00:00.000Z" },
    brief: { status: "AVAILABLE", marketDeskBriefId: "brief-kept", headline: "Brief canonique conservé" },
    briefHistory: [], sourceStates: [], agriEvents: [], prefilterDecisions: null, workerRuntime: null,
    readStatus: "PARTIAL",
    readDiagnostics: [{ component: "worker-runtime", status: "UNAVAILABLE", code: "MARKET_CONTEXT_ENRICHMENT_TIMEOUT" }],
    asOf: "2026-08-11T08:00:00.000Z",
  });

  const envelope = await handleFrontControlPlane(store, {
    pathname: "/front-api/v1/views/live-focus",
    query: { diagnostic: "context-enrichment-timeout" },
  });

  assert.equal(envelope.meta.availability, "PARTIAL");
  assert.equal(envelope.meta.sources.find((item) => item.source === "market-context")?.state, "DEGRADED");
  assert.equal(envelope.data.marketContext.marketContextSnapshotId, "context-kept");
  assert.equal(envelope.data.marketDeskBrief.marketDeskBriefId, "brief-kept");
  assert.equal(envelope.data.contextWorker.failureCount, null);
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

test("front control plane risk view maps authoritative risk-engine limits into the RiskView contract", async () => {
  const store = frontControlPlaneStore({
    execution: {
      portfolioOrderIntents: [{
        portfolio_order_intent_id: "portfolio_order_intent_risk_1",
        target_account_id: "Sim101",
        target_instrument: "MNQ",
        quantity: 1,
        status: "READY",
        risk_decisions: [{
          risk_decision_id: "risk-decision-1",
          decision: "APPROVED",
          status: "PASS",
          limits: [
            { type: "PORTFOLIO_ABS_SIZE", unit: "CONTRACTS", scope: "portfolio", value: 20, breached: false, limit_id: "PORTFOLIO_ABS_SIZE:portfolio", severity: "INFO", remaining: 20, current_utilization: 0, resulting_utilization: 0.05 },
            { type: "INSTRUMENT_ABS_SIZE", unit: "CONTRACTS", scope: "MNQ", value: 10, breached: true, limit_id: "INSTRUMENT_ABS_SIZE:MNQ", severity: "INFO", remaining: 0, current_utilization: 1, resulting_utilization: 1 },
          ],
        }],
      }],
    },
  });

  const envelope = await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/risk", method: "GET", query: {} });
  const { limits } = envelope.data;
  assert.equal(limits.length, 2);

  const portfolioLimit = limits.find((item) => item.limitId === "PORTFOLIO_ABS_SIZE:portfolio");
  assert.equal(portfolioLimit.scope, "GLOBAL");
  assert.equal(portfolioLimit.unit, "CONTRACTS");
  assert.equal(portfolioLimit.limitValue, 20);
  assert.equal(portfolioLimit.usedValue, 0);
  assert.equal(portfolioLimit.usedPct, 0);
  assert.equal(portfolioLimit.headroomValue, 20);
  assert.equal(portfolioLimit.status, "PASS");
  assert.equal(typeof portfolioLimit.label, "string");
  assert.equal(portfolioLimit.label.length > 0, true);

  const instrumentLimit = limits.find((item) => item.limitId === "INSTRUMENT_ABS_SIZE:MNQ");
  assert.equal(instrumentLimit.scope, "INSTRUMENT");
  assert.equal(instrumentLimit.status, "BREACH");
  assert.equal(instrumentLimit.usedValue, 10);
  assert.equal(instrumentLimit.headroomValue, 0);
});

test("live trading isolates chart scope from global strategy and execution sources", async () => {
  const store = frontControlPlaneStore();
  const strategyCalls = [];
  const executionCalls = [];
  const marketCalls = [];
  const originalStrategy = store.getStrategyV2Overview.bind(store);
  const originalExecution = store.getExecutionOverview.bind(store);
  store.getStrategyV2Overview = async (args) => { strategyCalls.push(args); return originalStrategy(args); };
  store.getExecutionOverview = async (args) => { executionCalls.push(args); return originalExecution(args); };
  store.getFrontMarketSeries = async (args) => {
    marketCalls.push(args);
    return {
      schemaVersion: "front_market_series_v1",
      availability: "KNOWN",
      source: "market_candles",
      instrument: args.instrument,
      timeframe: args.timeframe,
      supportedInstruments: ["ZC", "ZW"],
      supportedTimeframes: ["5", "15"],
      points: [],
    };
  };

  const base = { trading_date: "2026-08-27", session: "ny_open", mode: "paper" };
  const first = await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/live-trading", query: { ...base, instrument: "ZC", timeframe: "5" } });
  const strategyCallsAfterFirstView = strategyCalls.length;
  const executionCallsAfterFirstView = executionCalls.length;
  const second = await handleFrontControlPlane(store, { pathname: "/front-api/v1/views/live-trading", query: { ...base, instrument: "ZW", timeframe: "15" } });

  assert.equal(first.data.marketSeries.instrument, "ZC");
  assert.equal(second.data.marketSeries.instrument, "ZW");
  assert.equal(strategyCallsAfterFirstView > 0, true);
  assert.equal(executionCallsAfterFirstView > 0, true);
  assert.equal(strategyCalls.length, strategyCallsAfterFirstView);
  assert.equal(executionCalls.length, executionCallsAfterFirstView);
  assert.equal(marketCalls.length, 2);
  assert.equal("instrument" in strategyCalls[0], false);
  assert.equal("timeframe" in strategyCalls[0], false);
  assert.equal("instrument" in executionCalls[0], false);
  assert.deepEqual(marketCalls.map((item) => [item.instrument, item.timeframe]), [["ZC", "5"], ["ZW", "15"]]);
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
  const strategy = overrides.strategy || {
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

function portfolioIntentFixture({ intentId, signalId, riskDecisionId, limitId, utilization }) {
  const nearestLimit = utilization === null ? null : { type: "PORTFOLIO_RISK", utilization };
  const limits = limitId ? [{ limit_id: limitId, type: "PORTFOLIO_ABS_SIZE", current_utilization: utilization }] : [];
  return {
    portfolio_order_intent_id: intentId,
    target_position_id: `target_${intentId}`,
    target_account_id: "Sim101",
    target_instrument: "MNQ",
    quantity: 1,
    status: "READY",
    risk_snapshot: { riskAmount: 40 },
    risk_decisions: [{
      risk_decision_id: riskDecisionId,
      decision: "APPROVED",
      status: "PASS",
      authorized: { risk_amount: 40 },
      nearest_limit: nearestLimit,
      limits,
    }],
    order_intent_payload: {
      order_intent_id: intentId,
      signal_id: signalId,
      strategy_instance_id: `instance_${signalId}`,
      account_id: "Sim101",
      instrument: "MNQ",
      action: "BUY",
      quantity: 1,
      status: "READY",
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
