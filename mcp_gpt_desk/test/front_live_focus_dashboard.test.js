import assert from "node:assert/strict";
import test from "node:test";
import { buildLiveFocusDashboard } from "../src/front-live-focus-dashboard.js";

const NOW = "2026-09-05T00:00:00Z";
const card = (id, overrides = {}) => ({
  orderIntentId: id, signalId: `signal-${id}`, instrument: "ZW", route: `/execution/orders/${id}`,
  createdAt: "2026-09-04T14:00:00Z", closedAt: "2026-09-04T16:00:00Z", theoreticalState: "CLOSED",
  theoreticalTradeStatus: "CLOSED", realizedR: -1, actionable: false, allowedActions: [], ...overrides,
});
const dashboard = (tradeCards, nowIso = NOW, observedOpportunities = []) => buildLiveFocusDashboard({ tradeCards, observedOpportunities, nowIso });

test("all closed results reconcile, including exits with an unpublished reason", () => {
  const cards = [card("tp", { theoreticalState: "TARGET_HIT", realizedR: 1.6 }), card("sl", { theoreticalState: "STOP_HIT" }), card("other")];
  const result = dashboard(cards).periods.WEEK.results;
  assert.equal(result.realizedR, -.4);
  assert.equal(result.count, 3);
  assert.deepEqual(result.breakdown, [
    { kind: "TARGET_HIT", count: 1, realizedR: 1.6 },
    { kind: "STOP_HIT", count: 1, realizedR: -1 },
    { kind: "OTHER_CLOSED", count: 1, realizedR: -1 },
  ]);
  assert.equal(result.contributors.length, 3);
});

test("week starts Monday, month starts on the first, and exits use closure date", () => {
  const cards = [card("august", { createdAt: "2026-08-24T10:00:00Z", closedAt: "2026-08-24T12:00:00Z" }),
    card("monday", { closedAt: "2026-08-31T12:00:00Z" }),
    card("carried", { createdAt: "2026-08-31T12:00:00Z", closedAt: "2026-09-01T12:00:00Z", realizedR: 2 })];
  const result = dashboard(cards);
  assert.equal(result.periods.WEEK.startDate, "2026-08-31");
  assert.equal(result.periods.MONTH.startDate, "2026-09-01");
  assert.equal(result.periods.WEEK.results.realizedR, 1);
  assert.equal(result.periods.MONTH.results.realizedR, 2);
  assert.equal(result.periods.TOTAL.results.realizedR, 0);
});

test("Paris date boundary is independent of host timezone and handles DST", () => {
  const result = dashboard([card("paris", { createdAt: "2026-10-25T22:30:00Z", closedAt: "2026-10-25T23:30:00Z" })], "2026-10-26T00:00:00Z");
  assert.equal(result.periods.TODAY.startDate, "2026-10-26");
  assert.equal(result.periods.TODAY.qualifiedTickets, 0);
  assert.equal(result.periods.TODAY.results.realizedR, -1);
});

test("missing or nonfinite R never becomes zero and missing exit dates are explicit", () => {
  const result = dashboard([card("null", { realizedR: null }), card("nan", { realizedR: NaN }), card("undated", { closedAt: null })]);
  assert.equal(result.periods.WEEK.results.realizedR, null);
  assert.equal(result.periods.WEEK.results.missingR, 2);
  assert.equal(result.periods.WEEK.results.undated, 1);
  assert.equal(result.periods.TOTAL.results.realizedR, -1);
});

test("expired human gate does not turn an open position into a closed R or an entry expiry", () => {
  const result = dashboard([
    card("open", { theoreticalState: "ENTRY_FILLED", theoreticalTradeStatus: "OPEN", realizedR: 8, closedAt: null, terminal: true }),
    card("waiting", { theoreticalState: "AWAITING_ENTRY", theoreticalTradeStatus: null, realizedR: null }),
    card("expiry", { theoreticalState: "EXPIRED", theoreticalTradeStatus: null, realizedR: null }),
    card("entry-expiry", { theoreticalState: "ENTRY_EXPIRED", theoreticalTradeStatus: null, realizedR: null }),
  ]);
  assert.equal(result.current.open, 1);
  assert.equal(result.current.awaitingEntry, 1);
  assert.equal(result.periods.WEEK.results.count, 0);
  assert.equal(result.periods.WEEK.expiredWithoutFill, 1);
  assert.equal(result.periods.WEEK.unclassifiedExpiry, 1);
});

test("duplicate intents and shared signal IDs are counted once and future exits are excluded", () => {
  const item = card("same");
  const result = dashboard([item, item, card("future", { closedAt: "2026-09-06T16:00:00Z", signalId: item.signalId })], NOW,
    [{ signalId: item.signalId, instrument: "ZW", createdAt: item.createdAt }]);
  assert.equal(result.periods.WEEK.qualifiedTickets, 2);
  assert.equal(result.periods.WEEK.rawSignals, 1);
  assert.equal(result.periods.WEEK.results.count, 1);
  assert.equal(result.periods.WEEK.results.realizedR, -1);
});

test("live actionable count is independent of selected historical period", () => {
  const result = dashboard([card("pending", { createdAt: "2026-08-31T20:00:00Z", theoreticalState: "AWAITING_ENTRY", theoreticalTradeStatus: null, realizedR: null, actionable: true, allowedActions: ["CONFIRM"] })]);
  assert.equal(result.current.actionable, 1);
  assert.equal(result.periods.MONTH.qualifiedTickets, 0);
  assert.equal(result.coverage, "EXPOSED_HISTORY_ONLY");
});

test("grain dashboard never mixes historical index results or signals into grain performance", () => {
  const result = dashboard([card("grain"), card("index", { instrument: "MNQ", realizedR: -4, actionable: true, allowedActions: ["CONFIRM"] })], NOW,
    [{ signalId: "index-signal", instrument: "MES", createdAt: "2026-09-04T10:00:00Z" }]);
  assert.equal(result.periods.TOTAL.results.realizedR, -1);
  assert.equal(result.periods.TOTAL.qualifiedTickets, 1);
  assert.equal(result.periods.TOTAL.rawSignals, 1);
  assert.equal(result.current.actionable, 0);
  assert.equal(result.scope.excludedTickets, 1);
  assert.deepEqual(result.scope.excludedInstruments, ["MNQ"]);
});
