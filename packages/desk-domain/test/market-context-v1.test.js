import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateAgriEventCoverageV1,
  evaluateMarketContextPrefilterV1,
  normalizeMarketContextSnapshotV1,
  normalizeMarketDeskBriefV1,
  validateContextAdjustmentProposalV1,
} from "../index.js";

const cutoff = "2026-08-26T15:00:00.000Z";
const source = { sourceId: "market_agri_events", sourceType: "AGRI_EVENT_CALENDAR", status: "AVAILABLE", coverageStart: "2026-08-01T00:00:00Z", coverageEnd: "2026-09-01T00:00:00Z", asOf: cutoff };
const snapshot = normalizeMarketContextSnapshotV1({
  marketContextSnapshotId: "ctx-1", universe: "US_GRAINS_CBOT", createdAt: cutoff,
  validFrom: "2026-08-26T14:30:00Z", validUntil: "2026-08-26T15:30:00Z", sourceDataCutoff: cutoff,
  marketState: "OPEN", marketSession: "CBOT_GRAINS_RTH", marketRegime: "TRENDING",
  volatilityRegime: "NORMAL", globalBias: "BULLISH", status: "AVAILABLE", sourceStates: [source],
  instrumentViews: [{ instrument: "ZC", bias: "BULLISH", allowedSides: ["LONG"], confidence: 0.8 }],
});

test("agri event empty can only mean no event when coverage is proven", () => {
  assert.equal(evaluateAgriEventCoverageV1({ sourceState: source, cutoff }).decision, "ADMISSIBLE");
  assert.equal(evaluateAgriEventCoverageV1({ sourceState: { ...source, status: "UNKNOWN_COVERAGE" }, cutoff }).decision, "WAIT");
});

test("required stale sources cannot publish an AVAILABLE context or brief", () => {
  const stale = {
    ...source,
    sourceId: "ZC_5",
    sourceType: "OHLCV",
    status: "STALE",
    requiredFor: ["MARKET_CONTEXT_SNAPSHOT"],
  };
  const partialSnapshot = normalizeMarketContextSnapshotV1({ ...snapshot, sourceStates: [source, stale] });
  assert.equal(partialSnapshot.status, "PARTIAL");
  const partialBrief = normalizeMarketDeskBriefV1({
    marketDeskBriefId: "brief-partial",
    marketContextSnapshotId: partialSnapshot.marketContextSnapshotId,
    universe: "US_GRAINS_CBOT",
    createdAt: cutoff,
    validFrom: cutoff,
    validUntil: "2026-08-26T16:00:00.000Z",
    sourceDataCutoff: cutoff,
    status: "AVAILABLE",
    headline: "Contexte partiel",
    operatorSummary: "Une source requise est périmée.",
    sourceStates: [source, stale],
  });
  assert.equal(partialBrief.status, "PARTIAL");
});

test("context prefilter is deterministic and fail closed", () => {
  assert.equal(evaluateMarketContextPrefilterV1({ signal: { instrument: "ZC", side: "LONG", createdAt: cutoff }, snapshot }).decision, "ADMISSIBLE");
  assert.equal(evaluateMarketContextPrefilterV1({ signal: { instrument: "ZC", side: "SHORT", createdAt: cutoff }, snapshot }).decision, "REJECT");
  assert.equal(evaluateMarketContextPrefilterV1({ signal: { instrument: "ZC", side: "LONG", createdAt: cutoff }, snapshot: null }).decision, "WAIT");
});

test("context prefilter enforces opportunity, no-trade and invalidation framing", () => {
  const framed = {
    ...snapshot,
    opportunityZones: [{ zoneId: "zc-long", instrument: "ZC", minPrice: 440, maxPrice: 455, direction: "LONG", confidence: 0.8 }],
    noTradeZones: [{ zoneId: "zc-no-trade", instrument: "ZC", minPrice: 448, maxPrice: 449, direction: "LONG", confidence: 0.8 }],
  };
  assert.equal(evaluateMarketContextPrefilterV1({ signal: { instrument: "ZC", side: "LONG", entry: 450, createdAt: cutoff }, snapshot: framed }).decision, "ADMISSIBLE");
  assert.equal(evaluateMarketContextPrefilterV1({ signal: { instrument: "ZC", side: "LONG", entry: 448.5, createdAt: cutoff }, snapshot: framed }).decision, "REJECT");
  assert.equal(evaluateMarketContextPrefilterV1({ signal: { instrument: "ZC", side: "LONG", entry: 460, createdAt: cutoff }, snapshot: framed }).decision, "WAIT");
  assert.equal(evaluateMarketContextPrefilterV1({ signal: { instrument: "ZC", side: "LONG", entry: 450, createdAt: cutoff }, snapshot: { ...framed, invalidationConditions: [{ active: true }] } }).decision, "REJECT");
});

test("context adjustment cannot change authority fields", () => {
  const signal = { instrument: "ZC", side: "LONG", entry: 450, stop: 446, targets: [458], quantity: 2, confidence: 0.8, sourceDataCutoff: cutoff };
  const valid = validateContextAdjustmentProposalV1({ signal, proposal: { instrument: "ZC", side: "LONG", entry: 450, stop: 447, targets: [456], quantity: 1, confidence: 0.7, riskMultiplier: 0.8, sourceDataCutoff: cutoff, reasonCodes: ["RESISTANCE"], evidenceRefs: ["ctx-1"] }, policy: { maxEntryDelta: 2 }, snapshot });
  assert.equal(valid.valid, true);
  const invalid = validateContextAdjustmentProposalV1({ signal, proposal: { instrument: "ZW", side: "SHORT", entry: 460, stop: 440, targets: [470], quantity: 3 }, policy: { maxEntryDelta: 2 }, snapshot });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.reasonCodes.includes("INSTRUMENT_CHANGE_FORBIDDEN"));
  assert.ok(invalid.reasonCodes.includes("QUANTITY_INCREASE_FORBIDDEN"));
  assert.ok(invalid.reasonCodes.includes("STOP_RISK_INCREASE_FORBIDDEN"));
  assert.ok(invalid.reasonCodes.includes("TARGET_EXTENSION_FORBIDDEN"));
});
