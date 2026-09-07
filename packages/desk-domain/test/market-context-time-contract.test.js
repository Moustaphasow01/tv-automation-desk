import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMarketContextSnapshotV1, normalizeMarketDeskBriefV1, evaluateMarketContextPrefilterV1 } from "../index.js";

const analysis = "2026-09-07T15:00:00.534Z";
const market = "2026-09-04T18:20:00.000Z";
const published = "2026-09-07T15:01:00.000Z";
function context(overrides = {}) {
  return {
    marketContextSnapshotId: "context-dual-clock", universe: "US_GRAINS_CBOT",
    sourceDataCutoff: analysis, analysisAsOfUtc: analysis, marketDataCutoffUtc: market,
    createdAt: published, validFrom: published, validUntil: "2026-09-07T16:00:00.534Z",
    marketState: "HOLIDAY", marketSession: "CBOT_GRAINS_CLOSED", marketRegime: "UNKNOWN",
    volatilityRegime: "UNKNOWN", globalBias: "NEUTRAL", status: "AVAILABLE",
    instrumentViews: [{ instrument: "ZC", bias: "NEUTRAL", allowedSides: [], confidence: 0 }],
    sourceStates: [
      { sourceId: "ZC_1", sourceType: "OHLCV", status: "AVAILABLE", asOf: analysis,
        requiredFor: ["MARKET_CONTEXT_SNAPSHOT"], coverageStart: "2026-09-04T13:30:00Z", coverageEnd: market,
        lastSuccessfulAt: market, reasonCodes: ["CLOSED_BARS_LAST_KNOWN_MARKET_NOT_OPEN"] },
      { sourceId: "market_agri_events", sourceType: "AGRI_EVENT_CALENDAR", status: "AVAILABLE", asOf: analysis,
        requiredFor: ["MARKET_CONTEXT_SNAPSHOT"], coverageStart: "2026-09-07T00:00:00Z", coverageEnd: "2026-09-09T00:00:00Z" },
      { sourceId: "canonical_grains_session", sourceType: "MARKET_SESSION", status: "AVAILABLE", asOf: analysis,
        requiredFor: ["MARKET_CONTEXT_SNAPSHOT"], coverageStart: "2026-09-07T00:00:00Z", coverageEnd: analysis },
    ],
    ...overrides,
  };
}

test("context and brief keep knowledge and last-known prices on separate clocks", () => {
  const snapshot = normalizeMarketContextSnapshotV1(context());
  const brief = normalizeMarketDeskBriefV1({ ...context(), marketDeskBriefId: "brief-dual-clock",
    headline: "Marché fermé", operatorSummary: "Dernières bougies de vendredi, calendrier connu lundi." });
  for (const value of [snapshot, brief]) {
    assert.equal(value.status, "AVAILABLE");
    assert.equal(value.sourceDataCutoff, analysis);
    assert.equal(value.marketDataCutoffUtc, market);
    assert.equal(value.sourceStates[0].dataCutoff, market);
    assert.equal(value.sourceStates[0].coverageEnd, market);
    assert.equal(value.sourceStates[0].lastSuccessfulAt, market);
    assert.equal(value.sourceStates[1].dataCutoff, analysis);
    assert.ok(value.sourceStates.every(source => source.covered));
  }
  assert.deepEqual(normalizeMarketContextSnapshotV1(snapshot), snapshot);
  assert.deepEqual(normalizeMarketDeskBriefV1(brief), brief);
});

test("old single-clock context does not implicitly obtain new coverage semantics", () => {
  const input = context();
  delete input.analysisAsOfUtc;
  delete input.marketDataCutoffUtc;
  const normalized = normalizeMarketContextSnapshotV1(input);
  assert.equal(normalized.status, "PARTIAL");
  assert.equal(normalized.sourceStates[0].covered, false);
  assert.equal(Object.hasOwn(normalized, "analysisAsOfUtc"), false);
});

test("separate clocks never turn missing calendar or stale prices into available sources", () => {
  for (const [index, status, expected] of [[1, "UNKNOWN_COVERAGE", "UNAVAILABLE"], [0, "STALE", "PARTIAL"]]) {
    const input = context();
    input.sourceStates[index].status = status;
    assert.equal(normalizeMarketContextSnapshotV1(input).status, expected);
  }
});

test("separate clocks require explicit aliases, causality and publication validity", () => {
  const cases = [
    [{ analysisAsOfUtc: undefined }, "MARKET_CONTEXT_ANALYSIS_AS_OF_REQUIRED"],
    [{ marketDataCutoffUtc: undefined }, "MARKET_CONTEXT_MARKET_DATA_CUTOFF_REQUIRED"],
    [{ sourceDataCutoff: market }, "MARKET_CONTEXT_KNOWLEDGE_CUTOFF_MISMATCH"],
    [{ marketDataCutoffUtc: published }, "MARKET_CONTEXT_MARKET_DATA_LOOKAHEAD"],
    [{ createdAt: "2026-09-07T14:59:59Z" }, "MARKET_CONTEXT_PUBLICATION_TIME_INVALID"],
    [{ validFrom: analysis }, "MARKET_CONTEXT_PUBLICATION_TIME_INVALID"],
    [{ validUntil: published }, "MARKET_CONTEXT_PUBLICATION_TIME_INVALID"],
  ];
  for (const [overrides, code] of cases) {
    assert.throws(() => normalizeMarketContextSnapshotV1(context(overrides)), error => error.code === code, code);
  }
});

test("source knowledge preserves milliseconds and cannot arrive after analysis", () => {
  const input = context();
  input.sourceStates[1].asOf = new Date(analysis);
  assert.equal(normalizeMarketContextSnapshotV1(input).sourceStates[1].asOf, analysis);
  input.sourceStates[1].asOf = new Date("2026-09-07T15:00:00.535Z");
  assert.throws(() => normalizeMarketContextSnapshotV1(input), error => error.code === "MARKET_CONTEXT_SOURCE_KNOWLEDGE_LOOKAHEAD");
});

test("an advisory snapshot cannot authorize a signal before publication or after expiration", () => {
  const snapshot = normalizeMarketContextSnapshotV1(context({ instrumentViews: [
    { instrument: "ZC", bias: "BULLISH", allowedSides: ["LONG"], confidence: 0.5 },
  ] }));
  const signal = { instrument: "ZC", side: "LONG" };
  for (const at of [analysis, "2026-09-07T16:00:00.535Z"]) {
    assert.equal(evaluateMarketContextPrefilterV1({ signal, snapshot, at }).decision, "WAIT");
  }
});
