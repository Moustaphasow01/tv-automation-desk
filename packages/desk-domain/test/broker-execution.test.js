import assert from "node:assert/strict";
import test from "node:test";
import {
  BROKER_RISK_PERCENT,
  brokerExecutionEnvironment,
  calculateContractQuantity,
  createOrderIntent,
  evaluateBrokerPolicy,
  materializeTradeDecision,
  normalizeNinjaUpdate,
  renderNinjaOifCommand,
  renderNinjaOifManagementCommand,
  resolveBrokerAccountCapital,
} from "../index.js";

const now = "2026-07-22T14:00:00.000Z";

test("broker execution environment is fail-closed by default", () => {
  const env = brokerExecutionEnvironment({});
  assert.equal(env.executionEnabled, false);
  assert.equal(env.killSwitch, true);
  assert.equal(env.bridgeMode, "disabled");
  assert.equal(env.maxContracts, 0);
  assert.equal(env.accountSnapshotStaleSeconds, 60);
  assert.equal(env.allowLiveAccount, false);
  assert.equal(env.legacyPositionExecutionEnabled, false);
  assert.equal(
    brokerExecutionEnvironment({ DESK_LEGACY_POSITION_EXECUTION_ENABLED: "true" }).legacyPositionExecutionEnabled,
    true,
  );
});

test("contract sizing risks 0.25 percent and rounds contracts upward", () => {
  const sizing = calculateContractQuantity({ capital: 100_000, entryPrice: 30_000, stopPrice: 29_980, pointValue: 2 });
  assert.equal(sizing.risk_percent, BROKER_RISK_PERCENT);
  assert.equal(sizing.risk_budget, 250);
  assert.equal(sizing.risk_per_contract, 40);
  assert.equal(sizing.raw_contracts, 6.25);
  assert.equal(sizing.contracts, 7);
  assert.equal(sizing.actual_risk, 280);
  assert.equal(sizing.actual_risk_percent, 0.28);
  assert.equal(sizing.rounding_excess, 30);
  assert.equal(sizing.exceeds_risk_target, true);
});

test("contract sizing does not add a contract when the raw result is already an integer", () => {
  const sizing = calculateContractQuantity({ capital: 80_000, entryPrice: 30_000, stopPrice: 29_980, pointValue: 2 });
  assert.equal(sizing.raw_contracts, 5);
  assert.equal(sizing.contracts, 5);
  assert.equal(sizing.actual_risk_percent, 0.25);
  assert.equal(sizing.exceeds_risk_target, false);
});

test("account capital prefers net liquidation and never uses buying power", () => {
  assert.deepEqual(resolveBrokerAccountCapital({ cash_value: 20_000, buying_power: 100_000, payload: { net_liquidation_value: 22_500 } }), {
    value: 22_500,
    source: "payload.net_liquidation_value",
    fallback: false,
  });
  assert.deepEqual(resolveBrokerAccountCapital({ buying_power: 100_000 }), { value: null, source: null, fallback: false });
  assert.deepEqual(resolveBrokerAccountCapital({ cash_value: 20_000 }, { snapshotFresh: false, fallbackEnabled: true, fallbackCapital: 15_000 }), {
    value: 15_000,
    source: "policy.fallback_capital",
    fallback: true,
  });
});

test("materializer creates a stable decision without mutating the paper strategy", () => {
  const position = paperPosition();
  const left = materializeTradeDecision({ position, now });
  const right = materializeTradeDecision({ position: structuredClone(position), now });
  assert.deepEqual(left, right);
  assert.equal(left.source_collection, "desk_positions");
  assert.equal(left.instrument_code, "MNQ");
  assert.equal(left.side, "long");
  assert.equal(left.entry_plan.quantity, null);
  assert.equal(left.entry_plan.requested_quantity, 1);
  assert.equal(left.risk_plan.risk_percent, 0.25);
  assert.equal(left.raw.broker_execution, false);
  assert.equal(left.thesis_ref.master_id, "master_1");
});

test("materializer requires a canonical fill or trigger timestamp", () => {
  const missing = paperPosition();
  delete missing.opened_at_utc;
  missing.created_at = now;
  assert.throws(
    () => materializeTradeDecision({ position: missing, now }),
    (error) => error?.code === "DECISION_TRIGGER_TIMESTAMP_REQUIRED",
  );
  const invalid = { ...paperPosition(), opened_at_utc: "not-a-timestamp" };
  assert.throws(
    () => materializeTradeDecision({ position: invalid, now }),
    (error) => error?.code === "DECISION_TRIGGER_TIMESTAMP_REQUIRED",

  );
});
test("risk policy blocks the seeded configuration on every safety layer", () => {
  const decision = materializeTradeDecision({ position: paperPosition(), now });
  const risk = evaluateBrokerPolicy({
    decision,
    provider: { broker_provider_code: "ninjatrader", enabled: false },
    account: { broker_account_id: "ninjatrader_paper_local", environment: "preprod", mode: "paper", read_only: true, order_submission_enabled: false, max_contracts: 0 },
    contract: { instrument_code: "MNQ", active: false, tick_size: 0.25, point_value: 2, expiry_date: "2026-09-18" },
    policy: { enabled: false, allowed_accounts: ["ninjatrader_paper_local"], allowed_instruments: ["MNQ"], allowed_sessions: ["ny_open"], max_contracts: 0, max_daily_loss: 0, min_reward_risk: 1.5, require_operator_approval: true },
    bridge: { status: "offline", last_seen_at: now, account_name: "Sim101", ninja_connected: false, ati_enabled: false },
    locks: [{ execution_lock_id: "global", scope_type: "global", scope_value: "*", locked: true, reason: "kill" }],
    accountSnapshot: { cash_value: 16_000, realized_pnl: 0, captured_at: now },
    environment: brokerExecutionEnvironment({}),
    now,
  });
  assert.equal(risk.pass, false);
  assert.ok(risk.violations.some((rule) => rule.code === "ENV_EXECUTION_ENABLED"));
  assert.ok(risk.violations.some((rule) => rule.code === "NO_EXECUTION_LOCK"));
  assert.ok(risk.violations.some((rule) => rule.code === "ACCOUNT_WRITABLE"));
});

test("manual Telegram execution can create an intent while broker transport stays unavailable", () => {
  const decision = materializeTradeDecision({ position: paperPosition(), now });
  const environment = brokerExecutionEnvironment({
    DESK_MANUAL_TELEGRAM_EXECUTION_ENABLED: "true",
    DESK_BROKER_EXECUTION_ENABLED: "false",
    DESK_NINJA_BRIDGE_MODE: "disabled",
    DESK_NINJA_KILL_SWITCH: "true",
    DESK_NINJA_MAX_CONTRACTS: "2",
    DESK_NINJA_ACCOUNT_ALLOWLIST: "ninjatrader_paper_local",
    DESK_NINJA_ALLOWED_INSTRUMENTS: "MNQ,MES",
  });
  const risk = evaluateBrokerPolicy({
    decision,
    provider: { broker_provider_code: "ninjatrader", enabled: true },
    account: { broker_account_id: "ninjatrader_paper_local", environment: "preprod", mode: "paper", read_only: true, order_submission_enabled: false, max_contracts: 2 },
    contract: { broker_contract_id: "nt:mnq", instrument_code: "MNQ", active: true, tick_size: 0.25, point_value: 2, expiry_date: "2026-09-18" },
    policy: { enabled: true, allowed_accounts: ["ninjatrader_paper_local"], allowed_instruments: ["MNQ", "MES"], allowed_sessions: ["ny_open"], max_contracts: 2, max_daily_loss: 500, min_reward_risk: 2, require_operator_approval: false, execution_authority_mode: "auto", risk_per_trade_pct: 0.25 },
    bridge: { status: "read_only", last_seen_at: "2026-07-22T13:00:00.000Z", account_name: "Sim101", ninja_connected: false, ati_enabled: false },
    locks: [{ execution_lock_id: "global_default_kill_switch", scope_type: "global", scope_value: "*", locked: true, reason: "ENGINE_V5_VALIDATION_HOLD" }],
    existingTrades: [],
    accountSnapshot: { cash_value: 16_000, realized_pnl: -10, captured_at: now },
    environment,
    now,
  });
  assert.equal(risk.pass, true, JSON.stringify(risk.violations));
  assert.equal(risk.metrics.manual_telegram_execution, true);
  assert.equal(risk.rules.find((rule) => rule.code === "NO_EXECUTION_LOCK")?.details.manual_telegram_execution, true);
  assert.equal(risk.rules.find((rule) => rule.code === "BRIDGE_CONNECTED")?.details.manual_telegram_execution, true);
  const intent = createOrderIntent({
    decision,
    riskCheck: { ...risk, risk_check_id: "risk_manual_telegram" },
    account: { broker_account_id: "ninjatrader_paper_local" },
    contract: { broker_contract_id: "nt:mnq", broker_symbol: "MNQ 09-26" },
    now,
  });
  assert.equal(intent.payload.action, "BUY");
  assert.equal(intent.payload.protective_stop, 29980);
  assert.equal(intent.payload.profit_target, 30040);
});

test("approved-only Sim101 configuration can pass all deterministic gates", () => {
  const decision = materializeTradeDecision({ position: paperPosition(), now });
  const environment = brokerExecutionEnvironment({
    DESK_BROKER_EXECUTION_ENABLED: "true",
    DESK_NINJA_BRIDGE_MODE: "sim101_ati_approved_only",
    DESK_NINJA_KILL_SWITCH: "false",
    DESK_NINJA_MAX_CONTRACTS: "2",
    DESK_NINJA_ACCOUNT_ALLOWLIST: "ninjatrader_paper_local",
    DESK_NINJA_ALLOWED_INSTRUMENTS: "MNQ,MES",
  });
  const risk = evaluateBrokerPolicy({
    decision,
    provider: { broker_provider_code: "ninjatrader", enabled: true },
    account: { broker_account_id: "ninjatrader_paper_local", environment: "preprod", mode: "paper", read_only: false, order_submission_enabled: true, max_contracts: 2 },
    contract: { broker_contract_id: "nt:mnq", instrument_code: "MNQ", active: true, tick_size: 0.25, point_value: 2, expiry_date: new Date("2026-09-18T00:00:00.000Z") },
    policy: { enabled: true, allowed_accounts: ["ninjatrader_paper_local"], allowed_instruments: ["MNQ", "MES"], allowed_sessions: ["ny_open"], max_contracts: 2, max_daily_loss: 500, min_reward_risk: 2, require_operator_approval: true, risk_per_trade_pct: 0.25 },
    bridge: { status: "armed", last_seen_at: now, account_name: "Sim101", ninja_connected: true, ati_enabled: true },
    locks: [],
    existingTrades: [],
    accountSnapshot: { cash_value: 16_000, realized_pnl: -10, captured_at: now },
    environment,
    now,
  });
  assert.equal(risk.pass, true, JSON.stringify(risk.violations));
  assert.equal(risk.metrics.quantity, 1);
  assert.equal(risk.metrics.position_sizing.actual_risk_percent, 0.25);
  const riskCheck = { ...risk, risk_check_id: "risk_1" };
  const intent = createOrderIntent({ decision, riskCheck, account: { broker_account_id: "ninjatrader_paper_local" }, contract: { broker_contract_id: "nt:mnq", broker_symbol: "MNQ 09-26" }, now });
  assert.equal(intent.status, "pending_approval");
  assert.equal(intent.approval_status, "required");
  assert.match(renderNinjaOifCommand(intent, { accountName: "Sim101" }), /^PLACE;Sim101;MNQ 09-26;BUY;1;LIMIT;30000;;DAY;;order_intent_/);
});

test("broker reward-risk floor remains 2 when policy is absent, malformed or configured lower", () => {
  const position = { ...paperPosition(), take_profit_1: 30030 };
  const decision = materializeTradeDecision({ position, now });
  const environment = brokerExecutionEnvironment({
    DESK_BROKER_EXECUTION_ENABLED: "true",
    DESK_NINJA_BRIDGE_MODE: "sim101_ati_approved_only",
    DESK_NINJA_KILL_SWITCH: "false",
    DESK_NINJA_MAX_CONTRACTS: "2",
    DESK_NINJA_ACCOUNT_ALLOWLIST: "ninjatrader_paper_local",
    DESK_NINJA_ALLOWED_INSTRUMENTS: "MNQ",
  });
  const basePolicy = {
    enabled: true,
    allowed_accounts: ["ninjatrader_paper_local"],
    allowed_instruments: ["MNQ"],
    allowed_sessions: ["ny_open"],
    max_contracts: 2,
    max_daily_loss: 500,
    require_operator_approval: true,
    risk_per_trade_pct: 0.25,
  };
  const context = {
    decision,
    provider: { broker_provider_code: "ninjatrader", enabled: true },
    account: { broker_account_id: "ninjatrader_paper_local", environment: "preprod", mode: "paper", read_only: false, order_submission_enabled: true, max_contracts: 2 },
    contract: { broker_contract_id: "nt:mnq", instrument_code: "MNQ", active: true, tick_size: 0.25, point_value: 2, expiry_date: "2026-09-18" },
    bridge: { status: "armed", last_seen_at: now, account_name: "Sim101", ninja_connected: true, ati_enabled: true },
    locks: [],
    existingTrades: [],
    accountSnapshot: { cash_value: 16_000, realized_pnl: 0, captured_at: now },
    environment,
    now,
  };

  for (const policy of [
    basePolicy,
    { ...basePolicy, min_reward_risk: 1.5 },
    { ...basePolicy, min_reward_risk: "invalid" },
  ]) {
    const result = evaluateBrokerPolicy({ ...context, policy });
    const rule = result.rules.find((candidate) => candidate.code === "REWARD_RISK_MIN");
    assert.equal(result.pass, false);
    assert.equal(rule?.status, "fail");
    assert.equal(rule?.details.minimum, 2);
    assert.equal(result.metrics.reward_risk, 1.5);
  }
});

test("broker submit freshness blocks a 60-minute catch-up and accepts at most 120 seconds", () => {
  const baseDecision = materializeTradeDecision({ position: paperPosition(), now });
  const environment = brokerExecutionEnvironment({
    DESK_BROKER_EXECUTION_ENABLED: "true",
    DESK_NINJA_BRIDGE_MODE: "sim101_ati_approved_only",
    DESK_NINJA_KILL_SWITCH: "false",
    DESK_NINJA_MAX_CONTRACTS: "2",
    DESK_NINJA_ACCOUNT_ALLOWLIST: "ninjatrader_paper_local",
    DESK_NINJA_ALLOWED_INSTRUMENTS: "MNQ,MES",
  });
  const context = {
    provider: { broker_provider_code: "ninjatrader", enabled: true },
    account: { broker_account_id: "ninjatrader_paper_local", environment: "preprod", mode: "paper", read_only: false, order_submission_enabled: true, max_contracts: 2 },
    contract: { broker_contract_id: "nt:mnq", instrument_code: "MNQ", active: true, tick_size: 0.25, point_value: 2, expiry_date: "2026-09-18" },
    policy: { enabled: true, allowed_accounts: ["ninjatrader_paper_local"], allowed_instruments: ["MNQ", "MES"], allowed_sessions: ["ny_open"], max_contracts: 2, max_daily_loss: 500, min_reward_risk: 2, require_operator_approval: true, risk_per_trade_pct: 0.25, max_decision_age_seconds: 120 },
    bridge: { status: "armed", last_seen_at: now, account_name: "Sim101", ninja_connected: true, ati_enabled: true },
    locks: [],
    existingTrades: [],
    accountSnapshot: { cash_value: 16_000, realized_pnl: -10, captured_at: now },
    environment,
    now,
  };

  const boundary = evaluateBrokerPolicy({
    ...context,
    decision: { ...baseDecision, decided_at: "2026-07-22T13:58:00.000Z" },
  });
  assert.equal(boundary.pass, true, JSON.stringify(boundary.violations));
  assert.equal(boundary.metrics.decision_age_seconds, 120);

  const stale = evaluateBrokerPolicy({
    ...context,
    decision: { ...baseDecision, decided_at: "2026-07-22T13:00:00.000Z" },
  });
  assert.equal(stale.pass, false);
  assert.equal(stale.metrics.decision_age_seconds, 3_600);
  assert.ok(stale.violations.some((rule) => rule.code === "DECISION_FRESH"));

  const missing = { ...baseDecision };
  delete missing.decided_at;
  const missingTimestamp = evaluateBrokerPolicy({ ...context, decision: missing });
  assert.equal(missingTimestamp.pass, false);
  assert.ok(missingTimestamp.violations.some((rule) => rule.code === "DECISION_TIMESTAMP_VALID"));
  assert.ok(missingTimestamp.violations.some((rule) => rule.code === "DECISION_FRESH"));

  const future = evaluateBrokerPolicy({
    ...context,
    decision: { ...baseDecision, decided_at: "2026-07-22T14:00:00.001Z" },
  });
  assert.equal(future.pass, false);
  assert.ok(future.violations.some((rule) => rule.code === "DECISION_NOT_FUTURE"));
  assert.ok(future.violations.some((rule) => rule.code === "DECISION_FRESH"));
});

test("rounding excess is explicit, bounded and independently configurable", () => {
  const decision = materializeTradeDecision({ position: paperPosition(), now });
  const environment = brokerExecutionEnvironment({
    DESK_BROKER_EXECUTION_ENABLED: "true",
    DESK_NINJA_BRIDGE_MODE: "sim101_ati_approved_only",
    DESK_NINJA_KILL_SWITCH: "false",
    DESK_NINJA_MAX_CONTRACTS: "1",
    DESK_NINJA_ACCOUNT_ALLOWLIST: "ninjatrader_paper_local",
    DESK_NINJA_ALLOWED_INSTRUMENTS: "MNQ",
  });
  const context = {
    decision,
    provider: { broker_provider_code: "ninjatrader", enabled: true },
    account: { broker_account_id: "ninjatrader_paper_local", environment: "preprod", mode: "paper", read_only: false, order_submission_enabled: true, max_contracts: 1 },
    contract: { broker_contract_id: "nt:mnq", instrument_code: "MNQ", active: true, tick_size: 0.25, point_value: 2, expiry_date: "2026-09-18" },
    policy: { enabled: true, allowed_accounts: ["ninjatrader_paper_local"], allowed_instruments: ["MNQ"], allowed_sessions: ["ny_open"], max_contracts: 1, max_daily_loss: 500, min_reward_risk: 2, require_operator_approval: true, risk_per_trade_pct: 0.25, max_rounding_excess_pct: 0.149 },
    bridge: { status: "armed", last_seen_at: now, account_name: "Sim101", ninja_connected: true, ati_enabled: true },
    locks: [],
    existingTrades: [],
    accountSnapshot: { cash_value: 10_000, realized_pnl: 0, captured_at: now },
    environment,
    now,
  };
  const blocked = evaluateBrokerPolicy(context);
  assert.equal(blocked.pass, false);
  assert.ok(blocked.violations.some((rule) => rule.code === "ROUNDING_EXCESS_POLICY"));
  const allowed = evaluateBrokerPolicy({ ...context, policy: { ...context.policy, max_rounding_excess_pct: 0.151 } });
  assert.equal(allowed.pass, true, JSON.stringify(allowed.violations));
  assert.equal(allowed.metrics.position_sizing.actual_risk_percent, 0.4);
  assert.equal(allowed.metrics.position_sizing.rounding_excess_percent, 0.15);
});

test("Ninja update normalization is deterministic", () => {
  const update = normalizeNinjaUpdate({ order_id: "NT-42", order_state: "PartFilled", filled: "1", avg_fill_price: "30000.25" }, now);
  assert.equal(update.status, "partially_filled");
  assert.equal(update.filled_quantity, 1);
  assert.equal(update.average_fill_price, 30000.25);
});

test("ATI rendering can pin an operator-validated protective ATM template", () => {
  const command = renderNinjaOifCommand({
    order_intent_id: "order_intent_atm_test",
    payload: { broker_symbol: "MNQ 09-26", action: "BUY", quantity: 1, order_type: "limit", limit_price: 22000, time_in_force: "DAY" },
  }, { accountName: "Sim101", strategyName: "DeskSimProtected", strategyId: "desk_sim_001" });
  assert.equal(command, "PLACE;Sim101;MNQ 09-26;BUY;1;LIMIT;22000;;DAY;;order_intent_atm_test;DeskSimProtected;desk_sim_001\r\n");
});

test("renders every supported ATI management command with exact field positions", () => {
  assert.equal(renderNinjaOifManagementCommand({ command: "CHANGE", order_id: "desk-entry", quantity: 0, limit_price: 21990, stop_price: 0 }), "CHANGE;;;;0;;21990;0;;;desk-entry;;\r\n");
  assert.equal(renderNinjaOifManagementCommand({ command: "CANCEL", order_id: "desk-entry" }), "CANCEL;;;;;;;;;;desk-entry;;\r\n");
  assert.equal(renderNinjaOifManagementCommand({ command: "CLOSEPOSITION", instrument: "MNQ 09-26" }), "CLOSEPOSITION;Sim101;MNQ 09-26;;;;;;;;;;\r\n");
  assert.equal(renderNinjaOifManagementCommand({ command: "CLOSESTRATEGY", strategy_id: "desk-atm-1" }), "CLOSESTRATEGY;;;;;;;;;;;;desk-atm-1\r\n");
  assert.equal(renderNinjaOifManagementCommand({ command: "CANCELALLORDERS" }, { allowGlobalCommand: true }), "CANCELALLORDERS;;;;;;;;;;;;\r\n");
  assert.equal(renderNinjaOifManagementCommand({ command: "FLATTENEVERYTHING" }, { allowGlobalCommand: true }), "FLATTENEVERYTHING;;;;;;;;;;;;\r\n");
  assert.equal(renderNinjaOifManagementCommand({ command: "REVERSEPOSITION", instrument: "MNQ 09-26", action: "SELL", quantity: 1, order_type: "market", order_id: "desk-reverse" }), "REVERSEPOSITION;Sim101;MNQ 09-26;SELL;1;MARKET;;;DAY;;desk-reverse;;\r\n");
});

test("global ATI commands and non-Sim accounts are rejected without explicit safety gates", () => {
  assert.throws(() => renderNinjaOifManagementCommand({ command: "FLATTENEVERYTHING" }), /explicit global-simulation confirmation/);
  assert.throws(() => renderNinjaOifManagementCommand({ command: "CLOSEPOSITION", instrument: "MNQ 09-26" }, { accountName: "Live1" }), /simulation account/);
});

function paperPosition() {
  return {
    position_id: "position_live_1",
    status: "OPEN",
    instrument: "MNQ",
    direction: "long",
    quantity: 1,
    entry_price: 30000,
    order_type: "LIMIT",
    entry_mode: "LIMIT_TOUCH",
    order_limit_price: 30000,
    stop_loss: 29980,
    take_profit_1: 30040,
    strategy_id: "ny_open_1530",
    trading_date: "2026-07-22",
    session: "ny_open",
    opened_at_utc: now,
    linked_master_analysis_id: "master_1",
    linked_active_thesis_id: "thesis_1",
    setup_record_id: "setup_1",
  };
}
