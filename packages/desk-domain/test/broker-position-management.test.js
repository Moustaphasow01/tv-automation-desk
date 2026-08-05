import assert from "node:assert/strict";
import test from "node:test";
import {
  brokerExecutionEnvironment,
  createBrokerManagementIntent,
  deriveBrokerManagementRequest,
  evaluateBrokerManagementPolicy,
  evaluatePositionRequestEligibility,
  renderBrokerManagementCommand,
} from "../index.js";

const now = "2026-07-22T14:15:00.000Z";

test("Monitor MOVE_STOP_BE becomes a stable break-even management intent", () => {
  const monitor = monitorWith("MOVE_STOP_BE");
  const request = deriveBrokerManagementRequest({ monitor, trade: openTrade(), mark: liveMark(), now });
  assert.equal(request.actionable, true);
  assert.equal(request.source_action, "MOVE_STOP_BE");
  assert.equal(request.action, "move_stop");
  assert.equal(request.requested_stop_price, 30_000);
  assert.equal(request.requested_quantity, null);
  assert.equal(request.threshold_price, 30_014);
  assert.equal(request.mark_price, 30_014);
  const left = createBrokerManagementIntent({ monitor, trade: openTrade(), request, now });
  const right = createBrokerManagementIntent({ monitor: structuredClone(monitor), trade: structuredClone(openTrade()), request, now });
  assert.deepEqual(left, right);
  assert.equal(left.expected_trade_revision, 3);
  assert.equal(left.status, "draft");
});

test("MOVE_STOP_BE is fail-closed without a fresh reconciled mark and before 0.7R", () => {
  const monitor = monitorWith("MOVE_STOP_BE");
  const trade = openTrade();
  assert.equal(deriveBrokerManagementRequest({ monitor, trade, now }).reason, "MANAGEMENT_MARK_MISSING");
  assert.equal(deriveBrokerManagementRequest({ monitor, trade, mark: liveMark(30_014, now, { reconciled: false }), now }).reason, "BROKER_MARK_NOT_RECONCILED");
  assert.equal(deriveBrokerManagementRequest({ monitor, trade, mark: liveMark(30_014, "2026-07-22T14:14:00.000Z"), now, maxMarkAgeSeconds: 30 }).reason, "BROKER_MARK_STALE");
  const below = deriveBrokerManagementRequest({ monitor, trade, mark: liveMark(30_013.75), now });
  assert.equal(below.reason, "BREAK_EVEN_THRESHOLD_NOT_REACHED");
  assert.equal(below.threshold_price, 30_014);
});

test("the shared evaluator gives immutable Replay and fresh LIVE marks identical MOVE_STOP_BE eligibility", () => {
  const request = { type: "MOVE_STOP_BE", position_id: "position_1", authority: "GPT_REQUEST_ONLY" };
  const position = { ...openTrade(), position_id: "position_1", initial_stop_loss: 29_980, management_policy: { break_even_at_r: 0.7 } };
  const live = evaluatePositionRequestEligibility({ request, position, mark: liveMark(), now });
  const replay = evaluatePositionRequestEligibility({ request, position, mark: { price: 30_014, timestamp: "2026-06-11T13:45:00.000Z", immutable: true, reconciled: true, source: "MES_M5" }, now });
  assert.equal(live.actionable, true);
  assert.equal(replay.actionable, true);
  assert.equal(live.requested_stop_price, replay.requested_stop_price);
  assert.equal(live.threshold_price, replay.threshold_price);
});
test("partial management rounds contracts upward without closing the whole position", () => {
  const request = deriveBrokerManagementRequest({ monitor: monitorWith("TAKE_PARTIAL"), trade: openTrade({ quantity_open: 3 }) });
  assert.equal(request.actionable, true);
  assert.equal(request.requested_quantity, 2);
  const minimum = deriveBrokerManagementRequest({ monitor: monitorWith("REDUCE_RISK"), trade: openTrade({ quantity_open: 1 }) });
  assert.equal(minimum.actionable, false);
  assert.equal(minimum.reason, "MINIMUM_CONTRACT_NO_PARTIAL");
});

test("Monitor V2 native position requests are authoritative and scoped", () => {
  const close = deriveBrokerManagementRequest({
    monitor: {
      monitor_id: "monitor_native_exit",
      monitor_decision: { decision: "MAINTAIN_THESIS" },
      deterministic_monitor_command: {
        position_request: {
          type: "EXIT_POSITION",
          position_id: "trade_1",
          reduce_fraction: null,
          requested_stop: null,
          reason: "Hard invalidation confirmed",
          authority: "GPT_REQUEST_ONLY",
        },
      },
    },
    trade: openTrade({ quantity_open: 2 }),
  });
  assert.deepEqual(close, {
    actionable: true,
    source_action: "EXIT_POSITION",
    action: "close_position",
    requested_quantity: 2,
    requested_stop_price: null,
    reason: "Hard invalidation confirmed",
  });

  const mismatch = deriveBrokerManagementRequest({
    monitor: {
      deterministic_monitor_command: {
        position_request: { type: "TAKE_PARTIAL", position_id: "trade_other", reduce_fraction: 0.5 },
      },
    },
    trade: openTrade({ quantity_open: 4 }),
  });
  assert.equal(mismatch.actionable, false);
  assert.equal(mismatch.reason, "POSITION_REQUEST_SCOPE_MISMATCH");
});

test("Monitor V2 NONE prevents implicit close from a legacy invalidation alias", () => {
  const request = deriveBrokerManagementRequest({
    monitor: {
      monitor_decision: { decision: "INVALIDATE_THESIS" },
      deterministic_monitor_command: {
        position_request: { type: "NONE", position_id: null, reduce_fraction: null, requested_stop: null, reason: null, authority: "GPT_REQUEST_ONLY" },
      },
    },
    trade: openTrade(),
  });
  assert.equal(request.actionable, false);
  assert.equal(request.reason, "MONITOR_ACTION_NOT_MANAGEMENT");
  assert.equal(request.source_action, "NONE");
});

test("Monitor V2 reduction uses its typed fraction and rounds contracts upward", () => {
  const request = deriveBrokerManagementRequest({
    monitor: {
      deterministic_monitor_command: {
        position_request: { type: "REDUCE_RISK", position_id: "trade_1", reduce_fraction: 0.25, requested_stop: null, reason: "Reduce exposure", authority: "GPT_REQUEST_ONLY" },
      },
    },
    trade: openTrade({ quantity_open: 5 }),
  });
  assert.equal(request.actionable, true);
  assert.equal(request.requested_quantity, 2);
});

test("management policy accepts only a risk-reducing Sim101 action", () => {
  const monitor = monitorWith("MOVE_STOP_BE");
  const trade = openTrade();
  const intent = createBrokerManagementIntent({ monitor, trade, request: deriveBrokerManagementRequest({ monitor, trade, mark: liveMark(), now }), now });
  const evaluated = evaluateBrokerManagementPolicy({ intent, ...context(trade), now });
  assert.equal(evaluated.pass, true, JSON.stringify(evaluated.violations));
  assert.equal(renderBrokerManagementCommand({ intent, trade, contract: context(trade).contract }), "CHANGE;;;;1;;0;30000;;;stop_order_1;;\r\n");
});

test("management policy rejects a missing stop reference and a risk-increasing stop", () => {
  const monitor = monitorWith("MOVE_STOP_BE");
  const trade = openTrade({ raw: {}, current_stop_price: 30_010 });
  const intent = {
    ...createBrokerManagementIntent({ monitor, trade: openTrade(), request: deriveBrokerManagementRequest({ monitor, trade: openTrade(), mark: liveMark(), now }), now }),
    requested_stop_price: 29_990,
  };
  const evaluated = evaluateBrokerManagementPolicy({ intent, ...context(trade), now });
  assert.equal(evaluated.pass, false);
  assert.ok(evaluated.violations.some((rule) => rule.code === "STOP_REFERENCE_PRESENT"));
  assert.ok(evaluated.violations.some((rule) => rule.code === "STOP_ONLY_TIGHTENS"));
});

test("close management prefers the deterministic ATM strategy and reduction uses an opposite market order", () => {
  const closeMonitor = monitorWith("EXIT_POSITION");
  const trade = openTrade({ atm_strategy_id: "desk_atm_trade_1" });
  const closeIntent = createBrokerManagementIntent({ monitor: closeMonitor, trade, request: deriveBrokerManagementRequest({ monitor: closeMonitor, trade }), now });
  assert.equal(renderBrokerManagementCommand({ intent: closeIntent, trade, contract: context(trade).contract }), "CLOSESTRATEGY;;;;;;;;;;;;desk_atm_trade_1\r\n");

  const reduceMonitor = monitorWith("REDUCE_RISK", { position_check: { reduce_quantity: 1 } });
  const largerTrade = openTrade({ quantity_open: 2 });
  const reduceIntent = createBrokerManagementIntent({ monitor: reduceMonitor, trade: largerTrade, request: deriveBrokerManagementRequest({ monitor: reduceMonitor, trade: largerTrade }), now });
  assert.match(renderBrokerManagementCommand({ intent: reduceIntent, trade: largerTrade, contract: context(largerTrade).contract }), /^PLACE;Sim101;MNQ 09-26;SELL;1;MARKET;;;DAY;;management_intent_/);
});

function liveMark(price = 30_014, timestamp = now, extra = {}) {
  return { price, timestamp, reconciled: true, immutable: false, source: "ninja_addon_reconciled", ...extra };
}
function monitorWith(action, extra = {}) {
  return {
    monitor_id: `monitor_${action.toLowerCase()}`,
    monitor_decision: { decision: action, reason_summary: `Monitor requests ${action}` },
    ...extra,
  };
}

function openTrade(extra = {}) {
  return {
    trade_id: "trade_1",
    status: "protected",
    side: "long",
    quantity_open: 1,
    avg_entry_price: 30_000,
    current_stop_price: 29_980,
    revision: 3,
    session: "ny_open",
    raw: { protective_stop_order_ref: "stop_order_1" },
    ...extra,
  };
}

function context(trade) {
  return {
    trade,
    provider: { broker_provider_code: "ninjatrader", enabled: true },
    account: { broker_account_id: "ninjatrader_paper_local", mode: "paper", read_only: false, order_submission_enabled: true },
    contract: { broker_contract_id: "ninjatrader:MNQ:2026-09", instrument_code: "MNQ", broker_symbol: "MNQ 09-26", active: true, tick_size: 0.25 },
    policy: { enabled: true, require_operator_approval: true, allowed_accounts: ["ninjatrader_paper_local"], allowed_instruments: ["MNQ"], allowed_sessions: ["ny_open"] },
    bridge: { status: "armed", account_name: "Sim101", last_seen_at: now, ninja_connected: true, ati_enabled: true },
    locks: [],
    environment: brokerExecutionEnvironment({
      DESK_BROKER_EXECUTION_ENABLED: "true",
      DESK_NINJA_BRIDGE_MODE: "sim101_ati_approved_only",
      DESK_NINJA_KILL_SWITCH: "false",
      DESK_NINJA_ACCOUNT_ALLOWLIST: "ninjatrader_paper_local",
    }),
  };
}
