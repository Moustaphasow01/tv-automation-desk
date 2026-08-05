import assert from "node:assert/strict";
import test from "node:test";
import { PostgresBrokerExecutionRepository } from "../src/broker-execution-repository.js";

test("findOpenTradeForMonitor joins the originating desk position and filters it independently", async () => {
  const calls = [];
  const expected = {
    trade_id: "trade_broker_1",
    position_id: "position_desk_1",
    instrument_code: "MNQ",
    broker_symbol: "MNQ 09-26",
  };
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [expected] };
    },
  };
  const repository = new PostgresBrokerExecutionRepository({
    pool,
    initialized: Promise.resolve(),
  });

  const result = await repository.findOpenTradeForMonitor({
    tradeId: null,
    sourcePositionId: "position_desk_1",
    instrument: "MNQ",
    strategyId: "strategy_1",
    tradingDate: "2026-07-22",
    session: "ny_open",
  });

  assert.equal(result, expected);
  assert.match(calls[0].sql, /LEFT JOIN trade_decisions d ON d\.trade_decision_id = t\.trade_decision_id/);
  assert.match(calls[0].sql, /d\.source_document_id AS position_id/);
  assert.match(calls[0].sql, /d\.source_document_id = \$2/);
  assert.deepEqual(calls[0].params, [null, "position_desk_1", "MNQ", "strategy_1", "2026-07-22", "ny_open"]);
});

test("findOpenTradeForMonitor preserves the legacy trade-id lookup when no desk position is supplied", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ trade_id: "trade_legacy", position_id: null }] };
    },
  };
  const repository = new PostgresBrokerExecutionRepository({
    pool,
    initialized: Promise.resolve(),
  });

  const result = await repository.findOpenTradeForMonitor({ tradeId: "trade_legacy" });

  assert.equal(result.trade_id, "trade_legacy");
  assert.deepEqual(calls[0].params, ["trade_legacy", null, null, null, null, null]);
});
