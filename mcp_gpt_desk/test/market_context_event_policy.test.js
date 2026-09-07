import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMarketContextEventFacts,
  detectMarketContextEventReasons,
  previousMarketContextEventFactsFromDispatch,
} from "../src/market-context-event-policy.js";

const FIRST_CUTOFF = "2026-09-04T18:20:00.000Z";
const NEXT_CUTOFF = "2026-09-08T13:31:00.000Z";

test("unchanged holiday bars do not repeat volatility or structure events", () => {
  const first = eventBundle({ marketState: "HOLIDAY", cutoff: FIRST_CUTOFF, shock: true, structure: "UP" });
  const previousEventFacts = buildMarketContextEventFacts(first);
  assert.deepEqual(detectMarketContextEventReasons({ ...first, previousEventFacts }), []);
});

test("a new bar does not repeat an event while the same condition remains active", () => {
  const previous = buildMarketContextEventFacts(eventBundle({ cutoff: FIRST_CUTOFF, shock: true, structure: "UP" }));
  const next = eventBundle({ cutoff: NEXT_CUTOFF, shock: true, structure: "UP" });
  assert.deepEqual(detectMarketContextEventReasons({ ...next, previousEventFacts: previous }), []);
});

test("a new threshold crossing and a changed structure direction wake once", () => {
  const previous = buildMarketContextEventFacts(eventBundle({ cutoff: FIRST_CUTOFF, shock: false, structure: null }));
  const next = eventBundle({ cutoff: NEXT_CUTOFF, shock: true, structure: "DOWN" });
  assert.deepEqual(detectMarketContextEventReasons({ ...next, previousEventFacts: previous }), [
    "STRUCTURE_BREAK_ZW_5",
    "VOLATILITY_SHOCK_ZW_5",
  ]);
});

test("calendar events support canonical camelCase fields and trigger only for a new identity", () => {
  const event = { marketAgriEventId: "wasde-2026-09-11", eventTimestampUtc: "2026-09-11T16:00:00.000Z", importance: "CRITICAL" };
  const current = eventBundle({ analysisAsOfUtc: "2026-09-11T15:50:00.000Z", coveredAgriEvents: [event] });
  assert.deepEqual(detectMarketContextEventReasons(current), ["HIGH_AGRI_EVENT_NEARBY"]);
  const previousEventFacts = buildMarketContextEventFacts(current);
  assert.deepEqual(detectMarketContextEventReasons({ ...current, previousEventFacts }), []);
  const changed = { ...current, coveredAgriEvents: [...current.coveredAgriEvents,
    { marketAgriEventId: "stocks-2026-09-11", eventTimestampUtc: "2026-09-11T15:55:00.000Z", importance: "HIGH" }] };
  assert.deepEqual(detectMarketContextEventReasons({ ...changed, previousEventFacts }), ["HIGH_AGRI_EVENT_NEARBY"]);
});

test("session and source transitions remain event driven", () => {
  const current = eventBundle({ marketState: "OPEN", sourceStatus: "AVAILABLE" });
  const previousEventFacts = {
    ...buildMarketContextEventFacts(current),
    marketSession: "CBOT_GRAINS_PREOPEN",
    sourceStates: { ZW_5: "STALE" },
  };
  assert.deepEqual(detectMarketContextEventReasons({ ...current, previousEventFacts }), [
    "SESSION_TRANSITION",
    "SOURCE_ZW_5_STALE_TO_AVAILABLE",
  ]);
});

test("legacy dispatch metadata prevents one more event on the same cutoff", () => {
  const previousEventFacts = previousMarketContextEventFactsFromDispatch({ metadata: {
    market_data_cutoff_utc: FIRST_CUTOFF,
    market_session: "CBOT_GRAINS_HOLIDAY",
    trigger_reasons: ["VOLATILITY_SHOCK_ZW_5"],
  } });
  const current = eventBundle({ marketState: "HOLIDAY", cutoff: FIRST_CUTOFF, shock: true });
  assert.deepEqual(detectMarketContextEventReasons({ ...current, previousEventFacts }), []);
});

function eventBundle({ analysisAsOfUtc = "2026-09-07T17:00:00.000Z", cutoff = FIRST_CUTOFF,
  marketState = "OPEN", shock = false, structure = null, sourceStatus = "AVAILABLE", coveredAgriEvents = [] } = {}) {
  return {
    analysisAsOfUtc,
    marketDataCutoffUtc: cutoff,
    canonicalMarketSession: { marketState, marketSession: `CBOT_GRAINS_${marketState}` },
    sourceStates: [{ sourceId: "ZW_5", status: sourceStatus }],
    series: { "ZW:5": series({ cutoff, shock, structure }) },
    coveredAgriEvents,
  };
}

function series({ cutoff, shock, structure }) {
  const highs = [100, 101, 102];
  const lows = [98, 99, 100];
  const last = structure === "UP" ? 104 : structure === "DOWN" ? 96 : 101;
  return {
    return: shock ? 0.009 : 0.002,
    asOf: cutoff,
    lastBarClosedAt: cutoff,
    bars: highs.map((high, index) => ({ high, low: lows[index], close: 100 + index }))
      .concat({ high: last + 1, low: last - 1, close: last, closedAt: cutoff }),
  };
}
