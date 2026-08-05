import assert from "node:assert/strict";
import test from "node:test";
import {
  createNinjaAddonCommand,
  brokerExecutionEnvironment,
  createOrderIntent,
  evaluateBrokerPolicy,
  materializeTradeDecision,
  renderNinjaOifCommand,
} from "@tv-automation/desk-domain";
import { buildPositionFromTriggeredSetup } from "../src/position-continuity-engine.js";

const now = "2026-07-22T14:05:00.000Z";
const tick = { utc: now, paris: "2026-07-22T16:05:00+02:00" };

for (const scenario of [
  { direction: "long", side: "buy", action: "BUY", entry: 30000, stop: 29980, target: 30040 },
  { direction: "short", side: "sell", action: "SELL", entry: 30000, stop: 30020, target: 29960 },
]) {
  test(`Replay/LIVE/Ninja parity preserves ${scenario.direction} geometry`, () => {
    const position = buildPositionFromTriggeredSetup({
      setup: { setup_record_id: `setup_${scenario.direction}`, setup_id: `setup_${scenario.direction}`, instrument: "MNQ", direction: scenario.direction, order_type: "LIMIT", entry_mode: "LIMIT_TOUCH", entry_price: scenario.entry, stop_loss: scenario.stop, take_profit_1: scenario.target },
      run: { backtest_id: "live_run_1", replay_run_id: "live_run_1", strategy_id: "ny_open_1530", trading_date: "2026-07-22" },
      step: { step_id: "monitor_1600" },
      monitor: { monitor_id: "monitor_1600" },
      trigger: { trigger_price: scenario.entry, trigger_row: { timestamp_utc: now, timestamp_paris: tick.paris } },
      tick,
      makePositionId: () => `position_${scenario.direction}`,
    });
    const livePaperPosition = {
      ...position,
      backtest_id: undefined,
      replay_run_id: undefined,
      run_id: "live_run_1",
      mode: "live",
      execution_mode: "paper",
      paper_simulated: true,
      broker_execution: false,
      session: "ny_open",
    };
    const decision = materializeTradeDecision({ position: livePaperPosition, now });
    assert.equal(decision.side, scenario.direction);
    assert.equal(decision.entry_plan.entry_price, scenario.entry);
    assert.equal(decision.entry_plan.quantity, null);
    assert.equal(decision.risk_plan.stop_price, scenario.stop);
    assert.equal(decision.risk_plan.target_price, scenario.target);
    const risk = evaluateBrokerPolicy({ ...passingContext(decision), now });
    assert.equal(risk.pass, true, JSON.stringify(risk.violations));
    const intent = createOrderIntent({ decision, riskCheck: { ...risk, risk_check_id: "risk_parity" }, account: { broker_account_id: "ninjatrader_paper_local" }, contract: { broker_contract_id: "ninjatrader:MNQ:2026-09", broker_symbol: "MNQ 09-26" }, now });
    assert.equal(intent.side, scenario.side);
    assert.equal(intent.limit_price, scenario.entry);
    assert.equal(intent.bracket.stop_price, scenario.stop);
    assert.equal(intent.bracket.target_price, scenario.target);
    const oif = renderNinjaOifCommand(intent, { accountName: "Sim101" });
    assert.match(oif, new RegExp(`^PLACE;Sim101;MNQ 09-26;${scenario.action};1;LIMIT;${scenario.entry};;DAY;`));
  });
}

const transportScenarios = [
  { name: "next-bar market", entryMode: "NEXT_BAR_MARKET_AFTER_CONFIRMATION", orderType: "MARKET", brokerType: "market", ninjaType: "MARKET", limitPrice: null, stopOrderPrice: null },
  { name: "limit touch", entryMode: "LIMIT_TOUCH", orderType: "LIMIT", brokerType: "limit", ninjaType: "LIMIT", limitPrice: 30000, stopOrderPrice: null },
  { name: "stop cross", entryMode: "STOP_CROSS", orderType: "STOP", brokerType: "stop_market", ninjaType: "STOPMARKET", limitPrice: null, stopOrderPrice: 30000 },
  { name: "stop-limit cross", entryMode: "STOP_CROSS", orderType: "STOP_LIMIT", brokerType: "stop_limit", ninjaType: "STOPLIMIT", limitPrice: 30000.25, stopOrderPrice: 30000 },
  { name: "retest market", entryMode: "RETEST_ZONE_AFTER_CONFIRMATION", orderType: "MARKET", brokerType: "market", ninjaType: "MARKET", limitPrice: null, stopOrderPrice: null },
  { name: "retest limit", entryMode: "RETEST_ZONE_AFTER_CONFIRMATION", orderType: "LIMIT", brokerType: "limit", ninjaType: "LIMIT", limitPrice: 30000, stopOrderPrice: null },
];

for (const scenario of transportScenarios) {
  test(`entry/order parity reaches ATI and AddOn for ${scenario.name}`, () => {
    const position = transportPosition(scenario);
    const decision = materializeTradeDecision({ position, now });
    assert.equal(decision.entry_plan.contract_order_type, scenario.orderType);
    assert.equal(decision.entry_plan.order_type, scenario.brokerType);
    const risk = evaluateBrokerPolicy({ ...passingContext(decision), now });
    assert.equal(risk.pass, true, JSON.stringify(risk.violations));
    const intent = createOrderIntent({ decision, riskCheck: { ...risk, risk_check_id: `risk_${scenario.brokerType}` }, account: { broker_account_id: "ninjatrader_paper_local" }, contract: { broker_contract_id: "ninjatrader:MNQ:2026-09", broker_symbol: "MNQ 09-26" }, now });
    assert.equal(intent.order_type, scenario.brokerType);
    assert.equal(intent.limit_price, scenario.limitPrice);
    assert.equal(intent.stop_price, scenario.stopOrderPrice);
    const fields = renderNinjaOifCommand(intent, { accountName: "Sim101" }).trim().split(";");
    assert.equal(fields[5], scenario.ninjaType);
    assert.equal(fields[6], scenario.limitPrice === null ? "" : String(scenario.limitPrice));
    assert.equal(fields[7], scenario.stopOrderPrice === null ? "" : String(scenario.stopOrderPrice));
    const addon = createNinjaAddonCommand({
      workType: "entry",
      leased: { order_intent_id: intent.order_intent_id, expires_at: intent.expires_at, command_payload: intent.payload },
      context: { intent, contract: { broker_symbol: "MNQ 09-26" } },
      accountName: "Sim101", atmStrategyName: "TVA_SIM_SAFE_1X_320_400", now,
    });
    assert.equal(addon.order_type, scenario.ninjaType === "STOPMARKET" ? "STOP_MARKET" : scenario.ninjaType === "STOPLIMIT" ? "STOP_LIMIT" : scenario.ninjaType);
    assert.equal(addon.limit_price, scenario.limitPrice);
    assert.equal(addon.stop_price, scenario.stopOrderPrice);
  });
}

test("entry/order parity fails closed for missing, incompatible and incomplete semantics", () => {
  assert.throws(() => transportPosition({ ...transportScenarios[0], orderType: null }), (error) => error?.code === "POSITION_ENTRY_ORDER_INVALID");
  assert.throws(() => transportPosition({ ...transportScenarios[0], orderType: "LIMIT" }), (error) => error?.code === "POSITION_ENTRY_ORDER_INVALID");
  assert.throws(() => transportPosition({ ...transportScenarios[3], limitPrice: null }), (error) => error?.code === "POSITION_ENTRY_ORDER_INVALID");
});

function transportPosition(scenario) {
  const setup = { setup_record_id: `setup_${scenario.name}`, setup_id: `setup_${scenario.name}`, instrument: "MNQ", direction: "long", order_type: scenario.orderType, entry_mode: scenario.entryMode, entry_price: 30000, order_limit_price: scenario.limitPrice, order_stop_price: scenario.stopOrderPrice, stop_loss: 29980, take_profit_1: 30040 };
  const position = buildPositionFromTriggeredSetup({
    setup,
    run: { backtest_id: "transport_run", replay_run_id: "transport_run", strategy_id: "v5", trading_date: "2026-07-22" },
    step: { step_id: "transport_step" },
    monitor: { monitor_id: "transport_monitor" },
    trigger: { trigger_price: 30000, trigger_row: { timestamp_utc: now, timestamp_paris: tick.paris } },
    tick,
    makePositionId: () => `position_${scenario.name}`,
  });
  return { ...position, session: "ny_open" };
}


function passingContext(decision) {
  return {
    decision,
    provider: { broker_provider_code: "ninjatrader", enabled: true },
    account: { broker_account_id: "ninjatrader_paper_local", environment: "preprod", mode: "paper", read_only: false, order_submission_enabled: true, max_contracts: 1 },
    contract: { broker_contract_id: "ninjatrader:MNQ:2026-09", instrument_code: "MNQ", broker_symbol: "MNQ 09-26", active: true, tick_size: 0.25, point_value: 2, expiry_date: "2026-09-18" },
    policy: { enabled: true, allowed_accounts: ["ninjatrader_paper_local"], allowed_instruments: ["MNQ"], allowed_sessions: ["ny_open"], max_contracts: 1, max_daily_loss: 500, min_reward_risk: 1.5, require_operator_approval: true, risk_per_trade_pct: 0.25, fallback_capital_enabled: true, fallback_capital: 16_000 },
    bridge: { status: "armed", last_seen_at: now, account_name: "Sim101", ninja_connected: true, ati_enabled: true },
    locks: [], existingTrades: [], accountSnapshot: null,
    environment: brokerExecutionEnvironment({
      DESK_BROKER_EXECUTION_ENABLED: "true", DESK_NINJA_BRIDGE_MODE: "sim101_ati_approved_only", DESK_NINJA_KILL_SWITCH: "false",
      DESK_NINJA_MAX_CONTRACTS: "1", DESK_NINJA_ACCOUNT_ALLOWLIST: "ninjatrader_paper_local", DESK_NINJA_ALLOWED_INSTRUMENTS: "MNQ",
    }),
  };
}
