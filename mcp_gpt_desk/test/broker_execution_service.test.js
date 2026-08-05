import assert from "node:assert/strict";
import test from "node:test";
import { brokerExecutionEnvironment } from "@tv-automation/desk-domain";
import { BrokerExecutionService } from "../src/broker-execution-service.js";

const now = "2026-07-22T14:00:00.000Z";
const clock = { now: () => ({ utc: now, paris: "2026-07-22T16:00:00+02:00" }) };

test("execution service materializes only eligible LIVE paper positions", async () => {
  const repository = new FakeRepository();
  const persistence = { listDocuments: async () => [paperPosition(), { ...paperPosition(), position_id: "closed", status: "CLOSED" }] };
  const service = new BrokerExecutionService({ repository, persistence, clock, environment: brokerExecutionEnvironment({}) });
  const result = await service.materializeEligiblePositions({ trading_date: "2026-07-22", session: "ny_open" });
  assert.equal(result.count, 1);
  assert.equal(repository.decisions[0].source_document_id, "position_live_1");
  assert.equal(repository.decisions[0].raw.broker_execution, false);
});

test("execution service creates a failed risk audit and no intent with safe defaults", async () => {
  const repository = new FakeRepository();
  repository.context = blockedContext();
  const service = new BrokerExecutionService({ repository, persistence: {}, clock, environment: brokerExecutionEnvironment({}) });
  const result = await service.evaluateDecision({ decisionId: repository.context.decision.trade_decision_id, actor: "test" });
  assert.equal(result.riskCheck.status, "fail");
  assert.equal(result.intent, null);
  assert.ok(result.riskCheck.violations.some((rule) => rule.code === "ENV_EXECUTION_ENABLED"));
});

test("AUTO mode queues a passing Sim101 entry without operator approval", async () => {
  const repository = new FakeRepository();
  repository.context = passingAddonContext({
    bridge_id: "addon_auto", broker_account_id: "ninjatrader_paper_local", adapter_kind: "addon",
    mode: "sim101_addon_approved_only", status: "armed", command_enabled: true,
    ninja_connected: true, account_name: "Sim101", last_seen_at: now,
  });
  repository.context.policy.execution_authority_mode = "auto";
  repository.context.policy.require_operator_approval = false;
  const environment = brokerExecutionEnvironment({
    DESK_BROKER_EXECUTION_ENABLED: "true", DESK_NINJA_BRIDGE_MODE: "sim101_addon_approved_only",
    DESK_NINJA_KILL_SWITCH: "false", DESK_NINJA_MAX_CONTRACTS: "1",
    DESK_NINJA_ACCOUNT_ALLOWLIST: "ninjatrader_paper_local",
  });
  const result = await new BrokerExecutionService({ repository, persistence: {}, clock, environment })
    .evaluateDecision({ decisionId: repository.context.decision.trade_decision_id });
  assert.equal(result.executionAuthorityMode, "auto");
  assert.equal(repository.entryApprovalInput.automatic, true);
  assert.equal(repository.entryApprovalInput.actor, "desk:auto-entry");
});

test("SEMI_AUTO mode leaves a passing entry pending for the operator", async () => {
  const repository = new FakeRepository();
  repository.context = passingAddonContext({
    bridge_id: "addon_semi", broker_account_id: "ninjatrader_paper_local", adapter_kind: "addon",
    mode: "sim101_addon_approved_only", status: "armed", command_enabled: true,
    ninja_connected: true, account_name: "Sim101", last_seen_at: now,
  });
  repository.context.policy.execution_authority_mode = "semi_auto";
  const environment = brokerExecutionEnvironment({
    DESK_BROKER_EXECUTION_ENABLED: "true", DESK_NINJA_BRIDGE_MODE: "sim101_addon_approved_only",
    DESK_NINJA_KILL_SWITCH: "false", DESK_NINJA_MAX_CONTRACTS: "1",
    DESK_NINJA_ACCOUNT_ALLOWLIST: "ninjatrader_paper_local",
  });
  const result = await new BrokerExecutionService({ repository, persistence: {}, clock, environment })
    .evaluateDecision({ decisionId: repository.context.decision.trade_decision_id });
  assert.equal(result.executionAuthorityMode, "semi_auto");
  assert.equal(result.intent.status, "pending_approval");
  assert.equal(repository.entryApprovalInput, null);
});

test("bridge heartbeat remains read-only while local execution is disabled", async () => {
  const repository = new FakeRepository();
  const service = new BrokerExecutionService({ repository, persistence: {}, clock, environment: brokerExecutionEnvironment({}) });
  const result = await service.heartbeat({ bridgeId: "bridge_1", mode: "disabled", accountName: "Sim101", ninjaConnected: true, atiEnabled: true });
  assert.equal(result.heartbeat.status, "read_only");
  assert.equal(result.heartbeat.ninja_connected, true);
});

test("AddOn heartbeat defaults to signed shadow read-only mode", async () => {
  const repository = new FakeRepository();
  const service = new BrokerExecutionService({ repository, persistence: {}, clock, environment: brokerExecutionEnvironment({}) });
  const result = await service.heartbeatAddon({ bridgeId: "addon_1", mode: "sim101_addon_approved_only", accountName: "Sim101", ninjaConnected: true, commandEnabled: true, protocolVersion: "desk_ninja_addon_v1" });
  assert.equal(result.heartbeat.status, "read_only");
  assert.equal(result.heartbeat.adapter_kind, "addon");
  assert.equal(result.heartbeat.command_enabled, false);
});

test("ATI bridge cannot claim when the AddOn mode owns delivery", async () => {
  const environment = brokerExecutionEnvironment({ DESK_BROKER_EXECUTION_ENABLED: "true", DESK_NINJA_BRIDGE_MODE: "sim101_addon_approved_only", DESK_NINJA_KILL_SWITCH: "false", DESK_NINJA_MAX_CONTRACTS: "1" });
  const service = new BrokerExecutionService({ repository: new FakeRepository(), persistence: {}, clock, environment });
  const result = await service.claimBridgeWork({ bridgeId: "ati_1", accountName: "Sim101" });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, "ENVIRONMENT_NOT_ARMED");
});

test("armed AddOn leases only an approved outbox item and emits a canonical command", async () => {
  const repository = new FakeRepository();
  repository.addonBridge = { bridge_id: "addon_1", broker_account_id: "ninjatrader_paper_local", adapter_kind: "addon", mode: "sim101_addon_approved_only", status: "armed", command_enabled: true, ninja_connected: true, ati_enabled: false, account_name: "Sim101", last_seen_at: now };
  repository.context = passingAddonContext(repository.addonBridge);
  repository.addonSnapshot = {
    captured_at: now,
    received_at: now,
    connection: { status: "Connected" },
    positions: [],
  };
  repository.entryCandidate = {
    execution_outbox_id: "outbox_addon_1", order_intent_id: "order_intent_addon_12345678", trade_decision_id: repository.context.decision.trade_decision_id,
    broker_account_id: "ninjatrader_paper_local", expires_at: "2026-07-22T14:01:00.000Z",
    command_payload: { broker_symbol: "MNQ 09-26", action: "BUY", quantity: 1, order_type: "limit", limit_price: 30000, protective_stop: 29980, profit_target: 30040, time_in_force: "DAY", atm_strategy_id: "desk_atm_addon_1" },
  };
  const environment = brokerExecutionEnvironment({
    DESK_BROKER_EXECUTION_ENABLED: "true", DESK_NINJA_BRIDGE_MODE: "sim101_addon_approved_only",
    DESK_NINJA_KILL_SWITCH: "false", DESK_NINJA_MAX_CONTRACTS: "1", DESK_NINJA_ACCOUNT_ALLOWLIST: "ninjatrader_paper_local",
  });
  const service = new BrokerExecutionService({ repository, persistence: {}, clock, environment, addonAtmStrategyName: "TVA_SIM_SAFE_1X_320_400" });
  const result = await service.claimAddonWork({ bridgeId: "addon_1", accountName: "Sim101", leaseSeconds: 30 });
  assert.equal(result.status, "CLAIMED");
  assert.equal(result.work.command.action, "place_entry");
  assert.equal(result.work.command.quantity, 1);
  assert.equal(result.work.command.atm_strategy_name, "TVA_SIM_SAFE_1X_320_400");
  assert.equal(repository.leasedOutboxId, "outbox_addon_1");
});

test("armed AddOn blocks an entry when the canonical Ninja contract already has a position", async () => {
  const repository = new FakeRepository();
  repository.addonBridge = { bridge_id: "addon_1", broker_account_id: "ninjatrader_paper_local", adapter_kind: "addon", mode: "sim101_addon_approved_only", status: "armed", command_enabled: true, ninja_connected: true, account_name: "Sim101", last_seen_at: now };
  repository.context = passingAddonContext(repository.addonBridge);
  repository.entryCandidate = {
    execution_outbox_id: "outbox_addon_occupied", order_intent_id: "order_intent_addon_occupied", trade_decision_id: repository.context.decision.trade_decision_id,
    broker_account_id: "ninjatrader_paper_local", expires_at: "2026-07-22T14:01:00.000Z", command_payload: {},
  };
  repository.addonSnapshot = {
    captured_at: now,
    connection: { status: "Connected" },
    positions: [{ instrument: "MNQ SEP26", quantity: 1, market_position: "LONG" }],
  };
  const environment = brokerExecutionEnvironment({
    DESK_BROKER_EXECUTION_ENABLED: "true", DESK_NINJA_BRIDGE_MODE: "sim101_addon_approved_only",
    DESK_NINJA_KILL_SWITCH: "false", DESK_NINJA_MAX_CONTRACTS: "2", DESK_NINJA_ACCOUNT_ALLOWLIST: "ninjatrader_paper_local",
  });
  const service = new BrokerExecutionService({ repository, persistence: {}, clock, environment, addonAtmStrategyName: "TVA_SIM_SAFE_1X_320_400" });
  const result = await service.claimAddonWork({ bridgeId: "addon_1" });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, "ADDON_POSITION_MISMATCH");
  assert.equal(result.violations[0].instrument, "MNQ:2026-09");
  assert.equal(repository.leasedOutboxId, null);
});

test("armed AddOn blocks management when its fresh snapshot is already flat", async () => {
  const repository = new FakeRepository();
  repository.addonBridge = { bridge_id: "addon_1", broker_account_id: "ninjatrader_paper_local", adapter_kind: "addon", mode: "sim101_addon_approved_only", status: "armed", command_enabled: true, ninja_connected: true, account_name: "Sim101", last_seen_at: now };
  repository.management = managementContext({
    trade_id: "trade_stale", status: "protected", side: "long", quantity_open: 1, avg_entry_price: 30_000,
    current_stop_price: 30_000, revision: 2, broker_account_id: "ninjatrader_paper_local", broker_contract_id: "nt_mnq",
  });
  repository.management.bridge = repository.addonBridge;
  repository.managementCandidate = { management_outbox_id: "management_outbox_stale", management_intent_id: "management_intent_stale" };
  repository.addonSnapshot = { captured_at: now, connection: { status: "Connected" }, positions: [] };
  const environment = brokerExecutionEnvironment({
    DESK_BROKER_EXECUTION_ENABLED: "true", DESK_NINJA_BRIDGE_MODE: "sim101_addon_approved_only",
    DESK_NINJA_KILL_SWITCH: "false", DESK_NINJA_MAX_CONTRACTS: "2", DESK_NINJA_ACCOUNT_ALLOWLIST: "ninjatrader_paper_local",
  });
  const result = await new BrokerExecutionService({ repository, persistence: {}, clock, environment }).claimAddonWork({ bridgeId: "addon_1" });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, "ADDON_POSITION_MISMATCH");
  assert.equal(result.violations[0].desk_quantity, 1);
  assert.equal(result.violations[0].broker_quantity, 0);
});

test("AddOn snapshots settle protective exits before returning their projection", async () => {
  const repository = new FakeRepository();
  repository.addonBridge = { bridge_id: "addon_1", broker_account_id: "ninjatrader_paper_local", adapter_kind: "addon", mode: "sim101_addon_approved_only", status: "read_only", command_enabled: false, ninja_connected: true, account_name: "Sim101", protocol_version: "desk_ninja_addon_v1", last_seen_at: now };
  repository.protectiveSettlements = [{ trade_id: "trade_1", exit_reason: "protective_stop", quantity_open: 0, status: "closed" }];
  const service = new BrokerExecutionService({ repository, persistence: {}, clock, environment: brokerExecutionEnvironment({}) });
  const result = await service.recordAddonSnapshot({
    bridgeId: "addon_1",
    brokerAccountId: "ninjatrader_paper_local",
    snapshotId: "snapshot_1",
    snapshot: {
      captured_at: now,
      connection: { status: "Connected" },
      account: { net_liquidation_value: 25_000 },
      positions: [],
      orders: [{ broker_order_ref: "stop_1", status: "Filled", filled_quantity: 1, average_fill_price: 30_000 }],
    },
  });
  assert.deepEqual(result.protectiveSettlements, repository.protectiveSettlements);
  assert.equal(repository.protectiveSettlementInput.snapshotId, "snapshot_1");
  assert.equal(repository.protectiveSettlementInput.brokerSnapshot.connection.status, "Connected");
});

test("execution service applies a revisioned sizing policy only with explicit confirmation", async () => {
  const repository = new FakeRepository();
  const service = new BrokerExecutionService({ repository, persistence: {}, clock, environment: brokerExecutionEnvironment({}) });
  const result = await service.executeAction({
    action: "configure_sizing",
    policyProfileId: "ninjatrader_sim101_local",
    expectedRevision: 4,
    riskPercent: 0.25,
    maxRoundingExcessPercent: 0.25,
    maxDecisionAgeSeconds: 90,
    fallbackCapitalEnabled: true,
    fallbackCapital: 50_000,
    idempotencyKey: "sizing_test_123",
    confirmationPhrase: "CONFIRM_SIM101_SIZING_POLICY",
    reason: "validate operator sizing configuration",
  }, { email: "operator@example.test" });
  assert.equal(result.policy.revision, 5);
  assert.deepEqual(repository.sizingPolicyInput, {
    policyProfileId: "ninjatrader_sim101_local", expectedRevision: 4, riskPercent: 0.25, maxRoundingExcessPercent: 0.25,
    maxDecisionAgeSeconds: 90, fallbackCapitalEnabled: true, fallbackCapital: 50_000, idempotencyKey: "sizing_test_123",
    actor: "operator@example.test", reason: "validate operator sizing configuration", now,
  });
});

test("execution service applies a revisioned AUTO or SEMI_AUTO authority policy", async () => {
  const repository = new FakeRepository();
  const service = new BrokerExecutionService({ repository, persistence: {}, clock, environment: brokerExecutionEnvironment({}) });
  const result = await service.executeAction({
    action: "configure_execution_mode",
    policyProfileId: "ninjatrader_sim101_local",
    expectedRevision: 5,
    mode: "auto",
    idempotencyKey: "execution_mode_test_123",
    confirmationPhrase: "CONFIRM_SIM101_EXECUTION_MODE",
    reason: "enable autonomous Sim101 entries",
  }, { email: "operator@example.test" });
  assert.equal(result.policy.execution_authority_mode, "auto");
  assert.equal(repository.executionAuthorityInput.actor, "operator@example.test");
  assert.equal(repository.executionAuthorityInput.expectedRevision, 5);
});

test("execution service rejects sizing changes without the exact confirmation", async () => {
  const service = new BrokerExecutionService({ repository: new FakeRepository(), persistence: {}, clock, environment: brokerExecutionEnvironment({}) });
  await assert.rejects(
    () => service.executeAction({ action: "configure_sizing", confirmationPhrase: "CONFIRM", reason: "test" }),
    (error) => error.code === "CONFIRMATION_REQUIRED",
  );
});

test("execution service directly rejects V5 sizing risk above 0.25%", async () => {
  const repository = new FakeRepository();
  const service = new BrokerExecutionService({ repository, persistence: {}, clock, environment: brokerExecutionEnvironment({}) });
  await assert.rejects(
    () => service.executeAction({
      action: "configure_sizing",
      policyProfileId: "ninjatrader_sim101_local",
      expectedRevision: 4,
      riskPercent: 0.30,
      fallbackCapitalEnabled: false,
      fallbackCapital: 10_000,
      idempotencyKey: "sizing_v5_reject_030",
      confirmationPhrase: "CONFIRM_SIM101_SIZING_POLICY",
      reason: "verify V5 direct service risk cap",
    }),
    (error) => error.code === "INVALID_SIZING_RISK_PERCENT" && error.statusCode === 409,
  );
  assert.equal(repository.sizingPolicyInput, null);
});

test("execution service configures only the restart supervisor and never auto-arms execution", async () => {
  let configureInput = null;
  const startupControl = {
    status: async () => ({ available: true, enabled: false, revision: 2, state: "disabled" }),
    configure: async (input) => { configureInput = input; return { enabled: input.enabled, revision: 3, state: "waiting_restart" }; },
  };
  const environment = brokerExecutionEnvironment({
    DESK_BROKER_EXECUTION_ENABLED: "false",
    DESK_NINJA_KILL_SWITCH: "true",
    DESK_NINJA_MAX_CONTRACTS: "0",
  });
  const service = new BrokerExecutionService({ repository: new FakeRepository(), persistence: {}, clock, environment, startupControl });
  const result = await service.executeAction({
    action: "configure_ninjatrader_startup",
    enabled: true,
    expectedRevision: 2,
    idempotencyKey: "startup-service-idem",
    confirmationPhrase: "CONFIRM_NINJATRADER_AUTOSTART",
    reason: "enable Windows supervisor",
  }, { email: "operator@example.test" });
  assert.equal(result.enabled, true);
  assert.equal(configureInput.actor, "operator@example.test");
  assert.equal(service.environment.executionEnabled, false);
  assert.equal(service.environment.killSwitch, true);
  assert.equal(service.environment.maxContracts, 0);
});

test("execution service rejects NinjaTrader autostart changes without the exact confirmation", async () => {
  const service = new BrokerExecutionService({ repository: new FakeRepository(), persistence: {}, clock, startupControl: { configure: async () => ({}) } });
  await assert.rejects(
    () => service.executeAction({ action: "configure_ninjatrader_startup", enabled: true, confirmationPhrase: "CONFIRM" }),
    (error) => error.code === "CONFIRMATION_REQUIRED",
  );
});

test("execution overview never treats a stale AddOn heartbeat as a ready automatic connection", async () => {
  const repository = new FakeRepository();
  repository.overview = async () => ({
    providers: [], accounts: [], accountSnapshots: [], contracts: [], policies: [], policyAudits: [],
    bridges: [{ adapter_kind: "addon", ninja_connected: true, last_seen_at: "2026-07-22T13:00:00.000Z" }],
    locks: [], decisions: [], intents: [], orders: [], trades: [], reconciliations: [],
  });
  const startupControl = { status: async () => ({
    available: true, enabled: true, revision: 1, state: "login_required", processRunning: true,
    loginRequired: true, autoConnectConfigured: true,
  }) };
  const result = await new BrokerExecutionService({ repository, persistence: {}, clock, startupControl }).overview();
  assert.equal(result.ninjaTraderStartup.loginRequired, true);
  assert.equal(result.ninjaTraderStartup.addonHeartbeatFresh, false);
  assert.equal(result.ninjaTraderStartup.addonConnected, false);
  assert.equal(result.ninjaTraderStartup.connectionReady, false);
  assert.equal(result.ninjaTraderStartup.state, "login_required");
});

test("execution overview reports the current Sim101 connection independently from autostart", async () => {
  const repository = new FakeRepository();
  repository.overview = async () => ({
    providers: [], accounts: [], accountSnapshots: [], contracts: [], policies: [], policyAudits: [],
    bridges: [{ adapter_kind: "addon", ninja_connected: true, last_seen_at: now }],
    addonSnapshots: [{
      captured_at: now,
      account_name: "Sim101",
      connection: { status: "Connected", price_status: "Connected", name: "Simulation", provider: "NinjaTrader" },
    }],
    locks: [], decisions: [], intents: [], orders: [], trades: [], reconciliations: [],
  });
  const startupControl = { status: async () => ({
    available: true,
    enabled: false,
    revision: 0,
    state: "disabled",
    autoConnectConfigured: false,
    connectionName: "Simulated Data Feed",
    connectionProvider: "Simulator",
  }) };
  const result = await new BrokerExecutionService({ repository, persistence: {}, clock, startupControl }).overview();
  assert.equal(result.ninjaTraderStartup.addonConnected, true);
  assert.equal(result.ninjaTraderStartup.connectionReady, true);
  assert.equal(result.ninjaTraderStartup.connectionName, "Simulation");
  assert.equal(result.ninjaTraderStartup.connectionProvider, "NinjaTrader");
  assert.equal(result.ninjaTraderStartup.state, "disabled");
});

test("bridge cannot claim work while the environment is fail-closed", async () => {
  const service = new BrokerExecutionService({ repository: new FakeRepository(), persistence: {}, clock, environment: brokerExecutionEnvironment({}) });
  const result = await service.claimBridgeWork({ bridgeId: "bridge_1", accountName: "Sim101" });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, "ENVIRONMENT_NOT_ARMED");
});

test("a risk-reducing Monitor is automatically queued in SEMI_AUTO", async () => {
  const repository = new FakeRepository();
  repository.openTrade = {
    trade_id: "trade_1", status: "protected", side: "long", quantity_open: 2, avg_entry_price: 30_000,
    current_stop_price: 29_980, revision: 3, session: "ny_open", broker_account_id: "ninjatrader_paper_local",
    broker_contract_id: "nt_mnq", raw: { protective_stop_order_ref: "stop_order_1" },
  };
  repository.management = managementContext(repository.openTrade);
  repository.addonSnapshot = reconciledBrokerMarkSnapshot({ quantity: 2 });
  const environment = brokerExecutionEnvironment({
    DESK_BROKER_EXECUTION_ENABLED: "true", DESK_NINJA_BRIDGE_MODE: "sim101_ati_approved_only",
    DESK_NINJA_KILL_SWITCH: "false", DESK_NINJA_ACCOUNT_ALLOWLIST: "ninjatrader_paper_local",
  });
  const service = new BrokerExecutionService({ repository, persistence: {}, clock, environment });
  const result = await service.materializeManagementFromMonitor({
    monitor_id: "monitor_be_1", strategy_id: "ny_open_1530", trading_date: "2026-07-22", session: "ny_open",
    position_check: { instrument: "MNQ" }, monitor_decision: { decision: "MOVE_STOP_BE", reason_summary: "protect capital" },
  });
  assert.equal(result.status, "QUEUED_AUTOMATIC");
  assert.equal(repository.managementIntent.action, "move_stop");
  assert.equal(repository.managementIntent.expected_trade_revision, 3);
  assert.equal(repository.managementEvaluation.pass, true);
  assert.equal(repository.managementApprovalInput.automatic, true);
});

test("LIVE MOVE_STOP_BE stays skipped without a fresh reconciled broker mark", async () => {
  const repository = new FakeRepository();
  repository.openTrade = {
    trade_id: "trade_no_mark", status: "protected", side: "long", quantity_open: 2, avg_entry_price: 30_000,
    current_stop_price: 29_980, revision: 1, session: "ny_open", broker_account_id: "ninjatrader_paper_local",
    broker_contract_id: "nt_mnq", raw: { protective_stop_order_ref: "stop_no_mark" },
  };
  repository.management = managementContext(repository.openTrade);
  const environment = brokerExecutionEnvironment({
    DESK_BROKER_EXECUTION_ENABLED: "true", DESK_NINJA_BRIDGE_MODE: "sim101_ati_approved_only",
    DESK_NINJA_KILL_SWITCH: "false", DESK_NINJA_ACCOUNT_ALLOWLIST: "ninjatrader_paper_local",
  });
  const service = new BrokerExecutionService({ repository, persistence: {}, clock, environment });
  const missing = await service.materializeManagementFromMonitor({
    monitor_id: "monitor_no_mark", session: "ny_open",
    position_check: { instrument: "MNQ" }, monitor_decision: { decision: "MOVE_STOP_BE" },
  });
  assert.equal(missing.status, "SKIPPED");
  assert.equal(missing.reason, "MANAGEMENT_MARK_MISSING");
  assert.equal(repository.managementIntent, null);

  repository.addonSnapshot = reconciledBrokerMarkSnapshot({ quantity: 2, markPrice: 30_013.75 });
  const below = await service.materializeManagementFromMonitor({
    monitor_id: "monitor_below_threshold", session: "ny_open",
    position_check: { instrument: "MNQ" }, monitor_decision: { decision: "MOVE_STOP_BE" },
  });
  assert.equal(below.status, "SKIPPED");
  assert.equal(below.reason, "BREAK_EVEN_THRESHOLD_NOT_REACHED");
});
test("native Monitor V2 correlates its desk position without treating it as a broker trade id", async () => {
  const repository = new FakeRepository();
  repository.openTrade = {
    trade_id: "trade_native_monitor", position_id: "position_native_monitor", status: "protected",
    side: "long", quantity_open: 2, avg_entry_price: 30_000, current_stop_price: 29_980,
    revision: 3, session: "ny_open", broker_account_id: "ninjatrader_paper_local",
    broker_contract_id: "nt_mnq", raw: { protective_stop_order_ref: "stop_native_monitor" },
  };
  repository.management = managementContext(repository.openTrade);
  repository.addonSnapshot = reconciledBrokerMarkSnapshot({ quantity: 2 });
  const environment = brokerExecutionEnvironment({
    DESK_BROKER_EXECUTION_ENABLED: "true", DESK_NINJA_BRIDGE_MODE: "sim101_ati_approved_only",
    DESK_NINJA_KILL_SWITCH: "false", DESK_NINJA_ACCOUNT_ALLOWLIST: "ninjatrader_paper_local",
  });
  const result = await new BrokerExecutionService({ repository, persistence: {}, clock, environment })
    .materializeManagementFromMonitor({
      monitor_id: "monitor_native_position", strategy_id: "ny_open_1530",
      trading_date: "2026-07-22", session: "ny_open",
      deterministic_monitor_command: {
        position_request: {
          type: "MOVE_STOP_BE", position_id: "position_native_monitor",
          requested_stop: 30_000, authority: "GPT_REQUEST_ONLY",
        },
      },
      position_request: { type: "MOVE_STOP_BE", position_id: "position_projected_stale" },
      linked_position_id: "position_linked_stale",
      position_check: { instrument: "MNQ" },
    });
  assert.equal(result.status, "QUEUED_AUTOMATIC");
  assert.equal(repository.openTradeLookup.tradeId, null);
  assert.equal(repository.openTradeLookup.sourcePositionId, "position_native_monitor");
  assert.equal(repository.managementIntent.trade_id, "trade_native_monitor");
});

test("Monitor trade lookup falls back from projected position request to linked position", async () => {
  const environment = brokerExecutionEnvironment({
    DESK_BROKER_EXECUTION_ENABLED: "true", DESK_NINJA_KILL_SWITCH: "false",
  });
  const repository = new FakeRepository();
  const service = new BrokerExecutionService({ repository, persistence: {}, clock, environment });
  await service.materializeManagementFromMonitor({
    monitor_id: "monitor_projected_position",
    position_request: { type: "TAKE_PARTIAL", position_id: "position_projected" },
    linked_position_id: "position_linked_stale",
  });
  assert.equal(repository.openTradeLookup.sourcePositionId, "position_projected");
  await service.materializeManagementFromMonitor({
    monitor_id: "monitor_linked_position",
    linked_position_id: "position_linked",
  });
  assert.equal(repository.openTradeLookup.sourcePositionId, "position_linked");
});

test("targeted management materialization reads the requested Monitor directly", async () => {
  const repository = new FakeRepository();
  repository.openTrade = {
    trade_id: "trade_targeted", status: "protected", side: "long", quantity_open: 2, avg_entry_price: 30_000,
    current_stop_price: 29_980, revision: 1, session: "ny_open", broker_account_id: "ninjatrader_paper_local",
    broker_contract_id: "nt_mnq", raw: { protective_stop_order_ref: "stop_targeted" },
  };
  repository.management = managementContext(repository.openTrade);
  repository.management.bridge = { status: "armed", account_name: "Sim101", last_seen_at: now, ninja_connected: true, ati_enabled: false, adapter_kind: "addon", command_enabled: true };
  const monitor = {
    monitor_id: "monitor_targeted", trade_id: "trade_targeted", strategy_id: "ny_open_1530", trading_date: "2026-07-22", session: "ny_open",
    position_check: { trade_id: "trade_targeted", instrument: "MNQ", reduce_quantity: 1 },
    monitor_decision: { decision: "TAKE_PARTIAL", reason_summary: "targeted reduction" },
  };
  let listCalled = false;
  const persistence = {
    getDocument: async (collection, id) => { assert.equal(collection, "desk_manual_monitors"); assert.equal(id, monitor.monitor_id); return monitor; },
    listDocuments: async () => { listCalled = true; return []; },
  };
  const environment = brokerExecutionEnvironment({
    DESK_BROKER_EXECUTION_ENABLED: "true", DESK_NINJA_BRIDGE_MODE: "sim101_addon_approved_only",
    DESK_NINJA_KILL_SWITCH: "false", DESK_NINJA_ACCOUNT_ALLOWLIST: "ninjatrader_paper_local",
  });
  const result = await new BrokerExecutionService({ repository, persistence, clock, environment }).materializeRecentManagement({ monitorId: monitor.monitor_id, limit: 1 });
  assert.equal(result.status, "MATERIALIZED", JSON.stringify(result));
  assert.equal(result.count, 1);
  assert.equal(repository.managementIntent.source_document_id, monitor.monitor_id);
  assert.equal(repository.openTradeLookup.tradeId, "trade_targeted");
  assert.equal(repository.openTradeLookup.sourcePositionId, null);
  assert.equal(listCalled, false);
});

test("reconciliation divergence is sent to fail-closed storage", async () => {
  const repository = new FakeRepository();
  repository.deskSnapshot = { orders: [{ broker_order_ref: "NT-1" }], trades: [] };
  const service = new BrokerExecutionService({ repository, persistence: {}, clock, environment: brokerExecutionEnvironment({}) });
  const result = await service.reconcile({ bridgeId: "bridge_1", brokerSnapshot: { orders: [], positions: [] } });
  assert.equal(result.reconciliation.status, "diverged");
  assert.equal(result.reconciliation.mismatch_count, 1);
  assert.equal(repository.storedReconciliation.status, "diverged");
});

test("reconciliation detects a position side mismatch", async () => {
  const repository = new FakeRepository();
  repository.deskSnapshot = { orders: [], trades: [{ broker_symbol: "MNQ 09-26", quantity_open: 1, side: "long" }] };
  const service = new BrokerExecutionService({ repository, persistence: {}, clock, environment: brokerExecutionEnvironment({}) });
  const result = await service.reconcile({ brokerSnapshot: { orders: [], positions: [{ instrument: "MNQ 09-26", quantity: 1, market_position: "SHORT" }] } });
  assert.equal(result.reconciliation.status, "diverged");
  assert.equal(result.reconciliation.mismatches[0].type, "POSITION_SIDE_MISMATCH");
});

test("reconciliation persists a capital snapshot for deterministic sizing", async () => {
  const repository = new FakeRepository();
  const service = new BrokerExecutionService({ repository, persistence: {}, clock, environment: brokerExecutionEnvironment({}) });
  const result = await service.reconcile({
    brokerSnapshot: { orders: [], positions: [], account: { net_liquidation_value: 25_000, buying_power: 100_000 } },
  });
  assert.equal(repository.accountSnapshotInput.snapshot.net_liquidation_value, 25_000);
  assert.equal(result.accountSnapshot.cash_value, 25_000);
  assert.equal(result.reconciliation.metadata.account_snapshot_id, "snapshot_test");
});

class FakeRepository {
  available = true;
  decisions = [];
  context = null;
  deskSnapshot = { orders: [], trades: [] };
  storedReconciliation = null;
  accountSnapshotInput = null;
  sizingPolicyInput = null;
  executionAuthorityInput = null;
  entryApprovalInput = null;
  managementApprovalInput = null;
  openTradeLookup = null;
  openTrade = null;
  management = null;
  managementIntent = null;
  managementEvaluation = null;
  addonBridge = null;
  addonSnapshot = null;
  entryCandidate = null;
  managementCandidate = null;
  protectiveSettlements = [];
  protectiveSettlementInput = null;
  leasedOutboxId = null;
  async insertDecision(decision) { this.decisions.push(decision); return decision; }
  async decisionContext() { return this.context; }
  async insertRiskResult(value) { return value; }
  async approveIntent(input) { this.entryApprovalInput = input; return { approval: { status: "approved" }, idempotent: false }; }
  async upsertHeartbeat(value) { return value; }
  async bridgeHeartbeat() { return this.addonBridge; }
  async latestAddonSnapshot() { return this.addonSnapshot; }
  async storeAddonSnapshot({ snapshotId, bridgeId, accountId, accountName, capturedAt, snapshot, contentHash, metadata }) {
    return { addon_snapshot_id: snapshotId, bridge_id: bridgeId, broker_account_id: accountId, account_name: accountName, captured_at: capturedAt, ...snapshot, content_hash: contentHash, metadata };
  }
  async settleProtectiveExitsFromAddonSnapshot(input) { this.protectiveSettlementInput = input; return this.protectiveSettlements; }
  async latestAtiSnapshot() { return null; }
  async storeAdapterParity({ run }) { return run; }
  async peekManagementOutbox() { return this.managementCandidate; }
  async peekOutbox() { return this.entryCandidate; }
  async leaseOutbox({ outboxId, leaseToken }) { this.leasedOutboxId = outboxId; return { ...this.entryCandidate, lease_token: leaseToken }; }
  async reconciliationSnapshot() { return this.deskSnapshot; }
  async storeReconciliation({ run }) { this.storedReconciliation = run; return run; }
  async recordAccountSnapshot(input) {
    this.accountSnapshotInput = input;
    return { broker_account_snapshot_id: "snapshot_test", broker_account_id: input.accountId, cash_value: Number(input.snapshot.net_liquidation_value), captured_at: input.now };
  }
  async configureSizingPolicy(input) { this.sizingPolicyInput = input; return { policy: { revision: input.expectedRevision + 1 } }; }
  async configureExecutionAuthority(input) {
    this.executionAuthorityInput = input;
    return { policy: { revision: input.expectedRevision + 1, execution_authority_mode: input.mode } };
  }
  async findOpenTradeForMonitor(input) { this.openTradeLookup = input; return this.openTrade; }
  async managementContext() { return this.management; }
  async insertManagementIntent({ intent, evaluation }) { this.managementIntent = intent; this.managementEvaluation = evaluation; return { ...intent, status: evaluation.pass ? "pending_approval" : "blocked" }; }
  async approveManagementIntent(input) { this.managementApprovalInput = input; return { approval: { status: "approved" }, idempotent: false }; }
  async overview() { return { providers: [], accounts: [], accountSnapshots: [], contracts: [], policies: [], policyAudits: [], bridges: [], locks: [], decisions: [], intents: [], orders: [], trades: [], reconciliations: [] }; }
}

function reconciledBrokerMarkSnapshot({ quantity, markPrice = 30_014, capturedAt = now } = {}) {
  return {
    captured_at: capturedAt,
    positions: [{
      instrument: "MNQ 09-26",
      market_position: "LONG",
      side: "LONG",
      quantity,
      average_price: 30_000,
      mark_price: markPrice,
      mark_time: capturedAt,
    }],
  };
}
function managementContext(trade) {
  return {
    trade,
    provider: { broker_provider_code: "ninjatrader", enabled: true },
    account: { broker_account_id: "ninjatrader_paper_local", mode: "paper", read_only: false, order_submission_enabled: true },
    contract: { broker_contract_id: "nt_mnq", instrument_code: "MNQ", broker_symbol: "MNQ 09-26", active: true, tick_size: 0.25 },
    policy: { enabled: true, require_operator_approval: true, allowed_accounts: ["ninjatrader_paper_local"], allowed_instruments: ["MNQ"], allowed_sessions: ["ny_open"] },
    bridge: { status: "armed", account_name: "Sim101", last_seen_at: now, ninja_connected: true, ati_enabled: true },
    locks: [],
  };
}

function blockedContext() {
  const decision = {
    trade_decision_id: "trade_decision_test",
    instrument_code: "MNQ",
    side: "long",
    session: "ny_open",
    valid_until: "2026-07-22T15:00:00.000Z",
    entry_plan: { order_type: "limit", entry_price: 30000, limit_price: 30000, quantity: 1, time_in_force: "DAY" },
    risk_plan: { stop_price: 29980, target_price: 30040 },
  };
  return {
    decision,
    provider: { broker_provider_code: "ninjatrader", enabled: false },
    account: { broker_account_id: "ninjatrader_paper_local", environment: "preprod", mode: "paper", read_only: true, order_submission_enabled: false, max_contracts: 0 },
    contract: { broker_contract_id: "nt:mnq", instrument_code: "MNQ", broker_symbol: "MNQ 09-26", active: false, tick_size: 0.25, expiry_date: "2026-09-18" },
    policy: { policy_profile_id: "ninjatrader_sim101_local", enabled: false, allowed_accounts: ["ninjatrader_paper_local"], allowed_instruments: ["MNQ"], allowed_sessions: ["ny_open"], max_contracts: 0, max_daily_loss: 0, min_reward_risk: 2, require_operator_approval: true },
    bridge: null,
    locks: [{ execution_lock_id: "global", scope_type: "global", scope_value: "*", locked: true }],
    existingTrades: [],
    accountSnapshot: null,
  };
}

function passingAddonContext(bridge) {
  return {
    decision: {
      trade_decision_id: "trade_decision_addon_123", instrument_code: "MNQ", side: "long", session: "ny_open",
      decided_at: now, valid_until: "2026-07-22T15:00:00.000Z", entry_plan: { order_type: "limit", entry_price: 30000, limit_price: 30000, time_in_force: "DAY" },
      risk_plan: { stop_price: 29980, target_price: 30040 },
    },
    provider: { broker_provider_code: "ninjatrader", enabled: true },
    account: { broker_account_id: "ninjatrader_paper_local", environment: "preprod", mode: "paper", read_only: false, order_submission_enabled: true, max_contracts: 1 },
    contract: { broker_contract_id: "nt_mnq", instrument_code: "MNQ", broker_symbol: "MNQ 09-26", active: true, tick_size: 0.25, point_value: 2, expiry_date: "2026-09-18" },
    policy: { policy_profile_id: "ninjatrader_sim101_local", enabled: true, allowed_accounts: ["ninjatrader_paper_local"], allowed_instruments: ["MNQ"], allowed_sessions: ["ny_open"], max_contracts: 1, max_daily_loss: 1000, min_reward_risk: 2, require_operator_approval: true, risk_per_trade_pct: 0.25 },
    bridge, locks: [], existingTrades: [],
    accountSnapshot: { broker_account_id: "ninjatrader_paper_local", cash_value: 10_000, realized_pnl: 0, captured_at: now, payload: {} },
  };
}

function paperPosition() {
  return {
    position_id: "position_live_1", status: "OPEN", execution_mode: "paper", paper_simulated: true, broker_execution: false,
    instrument: "MNQ", direction: "long", quantity: 1, entry_price: 30000, stop_loss: 29980, take_profit_1: 30040,
    order_type: "LIMIT", entry_mode: "LIMIT_TOUCH", order_limit_price: 30000,
    triggered_at_utc: now,
    triggered_at_paris: "2026-07-22T16:00:00+02:00",
    strategy_id: "ny_open_1530", trading_date: "2026-07-22", session: "ny_open", run_id: "run_live_1", opened_at_utc: now,
  };
}
