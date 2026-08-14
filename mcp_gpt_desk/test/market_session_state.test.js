import assert from "node:assert/strict";
import test from "node:test";
import {
  marketDataFreshnessPolicyForSession,
  parisMarketSessionState,
} from "../src/market-session-state.js";

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
  assert.equal(result.reason, "inside_cme_globex_session");
});

test("Paris market session state marks CME daily maintenance as closed", () => {
  const result = parisMarketSessionState(new Date("2026-08-11T21:30:00.000Z"));
  assert.equal(result.trading_date, "2026-08-11");
  assert.equal(result.new_york_weekday, "Tue");
  assert.equal(result.market_closed, true);
  assert.equal(result.state, "maintenance_break");
  assert.equal(result.reason, "cme_daily_maintenance_break");
  assert.equal(result.next_transition_hint, "reopens_at_18_00_new_york");
});

test("Market data freshness policy is relaxed only for expected CME closures", () => {
  const open = parisMarketSessionState(new Date("2026-08-11T20:30:00.000Z"));
  const maintenance = parisMarketSessionState(new Date("2026-08-11T21:30:00.000Z"));
  const weekend = parisMarketSessionState(new Date("2026-08-08T12:00:00.000Z"));

  assert.equal(marketDataFreshnessPolicyForSession(open).max_age_seconds, 15 * 60);
  assert.equal(marketDataFreshnessPolicyForSession(maintenance).max_age_seconds, 2 * 60 * 60);
  assert.equal(marketDataFreshnessPolicyForSession(weekend).max_age_seconds, 74 * 60 * 60);
});
