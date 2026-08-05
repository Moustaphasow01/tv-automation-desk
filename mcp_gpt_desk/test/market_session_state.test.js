import assert from "node:assert/strict";
import test from "node:test";
import { parisMarketSessionState } from "../src/market-session-state.js";

test("Paris market session state marks Saturday as a closed market", () => {
  const result = parisMarketSessionState(new Date("2026-07-25T10:00:00.000Z"));
  assert.equal(result.trading_date, "2026-07-25");
  assert.equal(result.weekday, "Sat");
  assert.equal(result.market_closed, true);
  assert.equal(result.state, "market_closed");
});

test("Paris market session state marks Monday as a trading day", () => {
  const result = parisMarketSessionState(new Date("2026-07-27T10:00:00.000Z"));
  assert.equal(result.trading_date, "2026-07-27");
  assert.equal(result.weekday, "Mon");
  assert.equal(result.market_closed, false);
  assert.equal(result.state, "trading_day");
});
