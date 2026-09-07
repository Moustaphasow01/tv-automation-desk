import assert from "node:assert/strict";
import test from "node:test";

import { brokerExecutionEnvironment } from "@tv-automation/desk-domain";
import { BrokerExecutionService } from "../src/broker-execution-service.js";
import { portfolioLineageToTheoreticalEntryCandidate } from "../src/broker-theoretical-execution-repository.js";

const now = "2026-08-12T10:00:00.000Z";
const clock = { now: () => ({ utc: now, paris: "2026-08-12T12:00:00+02:00" }) };
const manualEnvironment = brokerExecutionEnvironment({
  DESK_MANUAL_TELEGRAM_EXECUTION_ENABLED: "true",
  DESK_BROKER_EXECUTION_ENABLED: "false",
  DESK_NINJA_BRIDGE_MODE: "disabled",
  DESK_NINJA_KILL_SWITCH: "true",
});

test("nullable canonical prices and units do not become a false zero", () => {
  const result = portfolioLineageToTheoreticalEntryCandidate({ portfolio_order_intent_id: "nullable",
    quantity: 1, tick_size: 0.25, point_value: 50,
    payload: { instrument: "ZC", action: "BUY", entry: { price: null, calculation_price: 100 } },
    approved_trade_plan: { units: { point_value: null, tick_size: null }, stop: { price: 95 }, targets: [{ price: 110 }] },
  });
  assert.equal(result.limit_price, 100);
  assert.equal(result.point_value, 50);
  assert.equal(result.tick_size, 0.25);
});

test("service does not fill a theoretical LIMIT entry before the price touches", async () => {
  const repository = new TheoreticalFakeRepository({
    entryCandle: candle({ low: 100.25 }),
  });
  const service = new BrokerExecutionService({ repository, persistence: {}, clock, environment: manualEnvironment });

  const result = await service.processTheoreticalExecution();

  assert.equal(result.status, "NO_THEORETICAL_FILL");
  assert.equal(result.materialized, 0);
  assert.equal(result.entries[0].reason, "LIMIT_NOT_TOUCHED");
  assert.equal(repository.entryFill, null);
});

test("service fills a theoretical LIMIT entry only after the closed OHLC touches the limit", async () => {
  const repository = new TheoreticalFakeRepository({
    entryCandle: candle({ low: 99.75 }),
  });
  const service = new BrokerExecutionService({ repository, persistence: {}, clock, environment: manualEnvironment });

  const result = await service.processTheoreticalExecution();

  assert.equal(result.status, "MATERIALIZED");
  assert.equal(result.entries[0].action, "fill_entry");
  assert.equal(repository.entryFill.result.price, 100);
  assert.equal(repository.entryFill.result.order_intent_id, "order_intent_1");
  assert.equal(repository.entryFill.result.portfolio_order_intent_id, null);
});

test("operator manual filled event is recorded separately and does not create a theoretical fill", async () => {
  const repository = new TheoreticalFakeRepository({
    entryCandle: candle({ low: 100.25 }),
  });
  const service = new BrokerExecutionService({ repository, persistence: {}, clock, environment: manualEnvironment });

  const manual = await service.recordManualExecutionEvent({
    eventType: "filled",
    orderIntentId: "order_intent_1",
    price: 100,
    quantity: 1,
    source: "telegram",
    idempotencyKey: "manual_filled_1",
  }, { kind: "telegram-operator" });
  const theoretical = await service.processTheoreticalExecution();

  assert.equal(manual.status, "RECORDED");
  assert.equal(repository.manualEvents.length, 1);
  assert.equal(theoretical.entries[0].reason, "LIMIT_NOT_TOUCHED");
  assert.equal(repository.entryFill, null);
});

test("service expires stale portfolio Human Gates during the theoretical tracking cycle", async () => {
  const repository = new TheoreticalFakeRepository({
    entryCandle: null,
    expiredHumanGates: 2,
  });
  const service = new BrokerExecutionService({ repository, persistence: {}, clock, environment: manualEnvironment });

  const result = await service.processTheoreticalExecution();

  assert.equal(result.status, "MATERIALIZED");
  assert.equal(result.expiredHumanGates.expired, 2);
  assert.equal(result.materialized, 2);
  assert.equal(repository.expireSweep.now, now);
});

test("service can process theoretical tracking at an injected replay cutoff", async () => {
  const replayNow = "2026-08-12T10:05:00.000Z";
  const repository = new TheoreticalFakeRepository({
    entryCandle: candle({ low: 99.75, timestamp_utc: replayNow }),
  });
  const service = new BrokerExecutionService({ repository, persistence: {}, clock, environment: manualEnvironment });

  const result = await service.processTheoreticalExecution({ nowUtc: replayNow });

  assert.equal(result.status, "MATERIALIZED");
  assert.equal(repository.expireSweep.now, replayNow);
  assert.equal(repository.candleLookup.candidate.order_intent_id, "order_intent_1");
  assert.equal(repository.candleLookup.options.now, replayNow);
  assert.equal(repository.entryFill.now, replayNow);
  assert.equal(repository.entryScope.now, replayNow);
});

test("service can scope theoretical replay tracking to explicit Portfolio OrderIntent IDs", async () => {
  const repository = new TheoreticalFakeRepository({
    candidate: {
      ...entryCandidate(),
      order_intent_id: "portfolio_order_intent_scoped",
      portfolio_order_intent_id: "portfolio_order_intent_scoped",
      trade_order_intent_id: null,
      theoretical_source_kind: "PORTFOLIO_ORDER_INTENT_LINEAGE",
    },
    entryCandle: candle({ low: 99.75 }),
  });
  const service = new BrokerExecutionService({ repository, persistence: {}, clock, environment: manualEnvironment });

  const result = await service.processTheoreticalExecution({
    nowUtc: "2026-08-12T10:05:00.000Z",
    portfolioOrderIntentIds: ["portfolio_order_intent_scoped"],
  });

  assert.equal(result.status, "MATERIALIZED");
  assert.deepEqual(repository.entryScope.portfolioOrderIntentIds, ["portfolio_order_intent_scoped"]);
  assert.deepEqual(repository.exitScope.portfolioOrderIntentIds, ["portfolio_order_intent_scoped"]);
  assert.deepEqual(repository.expireSweep.portfolioOrderIntentIds, ["portfolio_order_intent_scoped"]);
});

test("canonical Portfolio OrderIntent lineage maps to a theoretical LIMIT candidate with gate TTL", () => {
  const candidate = portfolioLineageToTheoreticalEntryCandidate({
    portfolio_order_intent_id: "portfolio_order_intent_1",
    target_position_id: "target_position_1",
    quantity: 2,
    created_at_utc: "2026-08-12T09:55:00.000Z",
    target_account_id: "paper_account",
    target_instrument: "MNQ",
    human_gate_expires_at_utc: "2026-08-12T10:25:00.000Z",
    broker_contract_id: "nt_mnq",
    broker_symbol: "MNQ SEP26",
    contract_instrument_code: "MNQ",
    point_value: 2,
    payload: {
      order_intent_id: "portfolio_order_intent_1",
      broker_account_id: "paper_account",
      instrument: "MNQ",
      action: "BUY",
      order_type: "LIMIT",
      quantity: 2,
      requested_at_utc: "2026-08-12T09:55:00.000Z",
      entry: { availability: "KNOWN", price: 100 },
      protection: { ready: true, stop_price: 95, target_price: 110 },
      approved_trade_plan: { source_signal_id: "signal_1" },
    },
  });

  assert.equal(candidate.order_intent_id, "portfolio_order_intent_1");
  assert.equal(candidate.portfolio_order_intent_id, "portfolio_order_intent_1");
  assert.equal(candidate.side, "buy");
  assert.equal(candidate.order_type, "limit");
  assert.equal(candidate.limit_price, 100);
  assert.equal(candidate.stop_price, null);
  assert.deepEqual(candidate.bracket, { stop_price: 95, target_price: 110 });
  assert.equal(candidate.expires_at, "2026-08-12T10:25:00.000Z");
});

test("canonical Portfolio OrderIntent theoretical validity follows the source StrategySignal expiry before Human Gate expiry", () => {
  const candidate = portfolioLineageToTheoreticalEntryCandidate({
    portfolio_order_intent_id: "portfolio_order_intent_signal_ttl",
    target_position_id: "target_position_signal_ttl",
    quantity: 1,
    created_at_utc: "2026-08-16T09:00:00.000Z",
    target_account_id: "paper_account",
    target_instrument: "MNQ",
    human_gate_expires_at_utc: "2026-08-17T09:00:00.000Z",
    source_signal_expires_at_utc: "2026-06-01T04:00:00.000Z",
    broker_contract_id: "nt_mnq",
    contract_instrument_code: "MNQ",
    payload: {
      order_intent_id: "portfolio_order_intent_signal_ttl",
      instrument: "MNQ",
      action: "BUY",
      order_type: "LIMIT",
      quantity: 1,
      requested_at_utc: "2026-06-01T03:30:00.000Z",
      entry: { availability: "KNOWN", price: 100 },
      protection: { ready: true, stop_price: 95, target_price: 110 },
      approved_trade_plan: { source_signal_id: "signal_1" },
    },
  });

  assert.equal(candidate.requested_at, "2026-06-01T03:30:00.000Z");
  assert.equal(candidate.expires_at, "2026-06-01T04:00:00.000Z");
});

test("service records canonical Portfolio OrderIntent IDs in theoretical entry results", async () => {
  const repository = new TheoreticalFakeRepository({
    candidate: {
      ...entryCandidate(),
      order_intent_id: "portfolio_order_intent_1",
      portfolio_order_intent_id: "portfolio_order_intent_1",
      trade_order_intent_id: null,
      theoretical_source_kind: "PORTFOLIO_ORDER_INTENT_LINEAGE",
    },
    entryCandle: candle({ low: 99.75 }),
  });
  const service = new BrokerExecutionService({ repository, persistence: {}, clock, environment: manualEnvironment });

  const result = await service.processTheoreticalExecution();

  assert.equal(result.status, "MATERIALIZED");
  assert.equal(repository.entryFill.result.order_intent_id, "portfolio_order_intent_1");
  assert.equal(repository.entryFill.result.portfolio_order_intent_id, "portfolio_order_intent_1");
});

test("service durably advances an open trade cursor when no exit is touched", async () => {
  const exitCandle = candle({ low: 99, high: 101, timestamp_utc: "2026-08-12T10:03:00.000Z" });
  const repository = new TheoreticalFakeRepository({
    entryCandle: null,
    openTrades: [openTrade()],
    exitCandle,
    backlog: { eligible_open_trades: 1, due_open_trades: 0, oldest_cursor_at_utc: exitCandle.timestamp_utc, newest_cursor_at_utc: exitCandle.timestamp_utc },
  });
  const service = new BrokerExecutionService({ repository, persistence: {}, clock, environment: manualEnvironment });

  const result = await service.processTheoreticalExecution();

  assert.equal(result.status, "BACKLOG_PROGRESSING");
  assert.equal(result.materialized, 0);
  assert.equal(result.cursorAdvanced, 1);
  assert.equal(result.selectedOpenTrades, 1);
  assert.deepEqual(repository.cursorAdvances, [{
    tradeId: "trade_open_1",
    candleTimestampUtc: "2026-08-12T10:03:00.000Z",
  }]);
  assert.equal(result.exits[0].reason, "NO_EXIT_TOUCHED");
  assert.deepEqual(result.backlog, repository.backlog);
});

test("service does not invent cursor progress when no closed candle exists", async () => {
  const repository = new TheoreticalFakeRepository({
    entryCandle: null,
    openTrades: [openTrade()],
    exitCandle: null,
  });
  const service = new BrokerExecutionService({ repository, persistence: {}, clock, environment: manualEnvironment });

  const result = await service.processTheoreticalExecution();

  assert.equal(result.status, "NO_THEORETICAL_FILL");
  assert.equal(result.cursorAdvanced, 0);
  assert.deepEqual(repository.cursorAdvances, []);
  assert.equal(result.exits[0].reason, "CANDLE_MISSING");
});

class TheoreticalFakeRepository {
  constructor({ entryCandle = null, candidate = entryCandidate(), expiredHumanGates = 0, openTrades = [], exitCandle = null, backlog = null } = {}) {
    this.available = true;
    this.entryCandle = entryCandle;
    this.candidate = candidate;
    this.expiredHumanGates = expiredHumanGates;
    this.openTrades = openTrades;
    this.exitCandle = exitCandle;
    this.backlog = backlog || { eligible_open_trades: openTrades.length, due_open_trades: openTrades.length, oldest_cursor_at_utc: null, newest_cursor_at_utc: null };
    this.expireSweep = null;
    this.candleLookup = null;
    this.entryFill = null;
    this.entryExpired = null;
    this.exitFill = null;
    this.review = null;
    this.manualEvents = [];
    this.entryScope = null;
    this.exitScope = null;
    this.cursorAdvances = [];
  }

  async listTheoreticalEntryCandidates(input = {}) {
    this.entryScope = input;
    return [this.candidate];
  }

  async expireStalePortfolioHumanGates(input) {
    this.expireSweep = input;
    return { expired: this.expiredHumanGates, items: [] };
  }

  async latestClosedCandleForIntent(candidate, options = {}) {
    this.candleLookup = { candidate, options };
    return this.entryCandle;
  }

  async recordTheoreticalEntryFill(input) {
    this.entryFill = input;
    return { event: { theoretical_execution_event_id: "theoretical_event_1" } };
  }

  async recordTheoreticalEntryExpired(input) {
    this.entryExpired = input;
    return { event: { theoretical_execution_event_id: "theoretical_event_expired" } };
  }

  async listTheoreticalOpenTrades(input = {}) {
    this.exitScope = input;
    return this.openTrades;
  }

  async latestClosedCandleForTrade() { return this.exitCandle; }

  async advanceTheoreticalTradeCursor(input) {
    this.cursorAdvances.push(input);
    return { advanced: true, trade_id: input.tradeId, theoretical_cursor_at_utc: input.candleTimestampUtc };
  }

  async theoreticalExecutionBacklog() { return this.backlog; }

  async recordTheoreticalExitFill(input) {
    this.exitFill = input;
    return { event: { theoretical_execution_event_id: "theoretical_event_exit" } };
  }

  async recordTheoreticalReviewRequired(input) {
    this.review = input;
    return { event: { theoretical_execution_event_id: "theoretical_event_review" } };
  }

  async recordManualExecutionEvent({ event }) {
    this.manualEvents.push(event);
    return { manual_execution_event_id: "manual_event_1", ...event };
  }
}

function entryCandidate() {
  return {
    order_intent_id: "order_intent_1",
    trade_decision_id: "trade_decision_1",
    broker_account_id: "paper_account",
    broker_contract_id: "nt_mnq",
    side: "buy",
    order_type: "limit",
    quantity: 1,
    limit_price: 100,
    stop_price: null,
    requested_at: "2026-08-12T09:55:00.000Z",
    expires_at: "2026-08-12T11:00:00.000Z",
    bracket: { stop_price: 95, target_price: 110 },
    payload: { instrument: "MNQ", atm_strategy_id: "desk_test" },
    instrument_code: "MNQ",
    contract_instrument_code: "MNQ",
    decision_side: "long",
    trading_date: "2026-08-12",
    session: "ny_open",
    strategy_id: "ny_open_1530",
    entry_plan: { order_type: "limit", entry_price: 100, limit_price: 100 },
    risk_plan: { stop_price: 95, target_price: 110 },
  };
}

function candle({ low = 99.75, high = 101, open = 100, close = 100, timestamp_utc = "2026-08-12T10:00:00.000Z" } = {}) {
  return {
    feed_id: "feed_mnq_1",
    symbol_code: "MNQ",
    timeframe: "1",
    timestamp_utc,
    open,
    high,
    low,
    close,
  };
}

function openTrade() {
  return {
    trade_id: "trade_open_1",
    side: "long",
    quantity_open: 1,
    avg_entry_price: 100,
    current_stop_price: 95,
    current_target_price: 110,
    opened_at: "2026-08-12T10:00:00.000Z",
    theoretical_cursor_at_utc: "2026-08-12T10:00:00.000Z",
    instrument_code: "MNQ",
    raw: {},
  };
}
