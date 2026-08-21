import assert from "node:assert/strict";
import test from "node:test";

import { brokerExecutionEnvironment } from "@tv-automation/desk-domain";
import { BrokerExecutionService } from "../src/broker-execution-service.js";

const now = "2026-08-12T10:00:00.000Z";
const clock = { now: () => ({ utc: now, paris: "2026-08-12T12:00:00+02:00" }) };
const manualEnvironment = brokerExecutionEnvironment({
  DESK_MANUAL_TELEGRAM_EXECUTION_ENABLED: "true",
  DESK_BROKER_EXECUTION_ENABLED: "false",
  DESK_NINJA_BRIDGE_MODE: "disabled",
  DESK_NINJA_KILL_SWITCH: "true",
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

test("service tracks a VNext portfolio OrderIntent theoretically before human confirmation", async () => {
  const repository = new TheoreticalFakeRepository({
    entryCandle: candle({ low: 100.25 }),
    portfolioEntryCandle: candle({ low: 99.75 }),
    portfolioCandidates: [portfolioEntryCandidate()],
  });
  const service = new BrokerExecutionService({ repository, persistence: {}, clock, environment: manualEnvironment });

  const result = await service.processTheoreticalExecution();

  assert.equal(result.status, "MATERIALIZED");
  assert.equal(result.portfolioEntries[0].action, "fill_entry");
  assert.equal(result.portfolioEntries[0].portfolio_order_intent_id, "portfolio_order_intent_1");
  assert.equal(repository.portfolioEntryFill.result.price, 100);
  assert.equal(repository.providerCommandsCreated, 0);
});

class TheoreticalFakeRepository {
  constructor({ entryCandle = null, portfolioEntryCandle = null, portfolioCandidates = [] } = {}) {
    this.available = true;
    this.entryCandle = entryCandle;
    this.portfolioEntryCandle = portfolioEntryCandle;
    this.portfolioCandidates = portfolioCandidates;
    this.entryFill = null;
    this.entryExpired = null;
    this.portfolioEntryFill = null;
    this.portfolioEntryExpired = null;
    this.exitFill = null;
    this.review = null;
    this.manualEvents = [];
    this.providerCommandsCreated = 0;
  }

  async listTheoreticalEntryCandidates() {
    return [entryCandidate()];
  }

  async latestClosedCandleForIntent() {
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

  async listPortfolioTheoreticalEntryCandidates() {
    return this.portfolioCandidates;
  }

  async latestClosedCandleForPortfolioIntent() {
    return this.portfolioEntryCandle;
  }

  async recordPortfolioTheoreticalEntryFill(input) {
    this.portfolioEntryFill = input;
    return { trade: { trade_id: "trade_portfolio_order_intent_1" }, event: { theoretical_execution_event_id: "theoretical_event_portfolio_1" } };
  }

  async recordPortfolioTheoreticalEntryExpired(input) {
    this.portfolioEntryExpired = input;
    return { event: { theoretical_execution_event_id: "theoretical_event_portfolio_expired" } };
  }

  async listTheoreticalOpenTrades() {
    return [];
  }

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

function portfolioEntryCandidate() {
  return {
    ...entryCandidate(),
    portfolio_order_intent_id: "portfolio_order_intent_1",
    order_intent_id: "portfolio_order_intent_1",
    trade_decision_id: null,
    strategy_signal_id: "strategy_signal_1",
    strategy_instance_id: "strategy_instance_1",
    payload: {
      instrument: "MNQ",
      action: "BUY",
      quantity: 1,
      order_type: "LIMIT",
      entry: { price: 100 },
      protection: { stop_price: 95, target_price: 110 },
      targets: [{ label: "T1", price: 110 }],
      strategy_id: "research_breakout",
      strategy_instance_id: "strategy_instance_1",
      signal_id: "strategy_signal_1",
    },
  };
}

function candle({ low = 99.75, high = 101, open = 100, close = 100 } = {}) {
  return {
    feed_id: "feed_mnq_1",
    symbol_code: "MNQ",
    timeframe: "1",
    timestamp_utc: "2026-08-12T10:00:00.000Z",
    open,
    high,
    low,
    close,
  };
}
