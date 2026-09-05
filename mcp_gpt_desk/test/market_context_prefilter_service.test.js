import assert from "node:assert/strict";
import test from "node:test";
import { MarketContextPrefilterService } from "../src/market-context-prefilter-service.js";

test("grain context prefilter evaluates live signals at decision time without lookahead", async () => {
  const service = prefilterService(snapshot({
    sourceDataCutoff: "2026-09-02T17:30:00.000Z",
    validFrom: "2026-09-02T17:45:00.000Z",
    validUntil: "2026-09-02T18:15:00.000Z",
  }));

  const [decision] = await service.evaluate([signal({
    generated_at_utc: "2026-09-02T17:35:00.000Z",
    source_data_cutoff_utc: "2026-09-02T17:35:00.000Z",
  })], "2026-09-02T17:50:00.000Z");

  assert.equal(decision.decision, "ADMISSIBLE");
  assert.equal(decision.marketContextSnapshotId, "ctx-live");
});

test("grain context prefilter waits when the snapshot cutoff is after the decision time", async () => {
  const service = prefilterService(snapshot({
    sourceDataCutoff: "2026-09-02T17:55:00.000Z",
    validFrom: "2026-09-02T17:45:00.000Z",
    validUntil: "2026-09-02T18:15:00.000Z",
  }));

  const [decision] = await service.evaluate([signal({
    generated_at_utc: "2026-09-02T17:35:00.000Z",
    source_data_cutoff_utc: "2026-09-02T17:35:00.000Z",
  })], "2026-09-02T17:50:00.000Z");

  assert.equal(decision.decision, "WAIT");
  assert.deepEqual(decision.reasonCodes, ["MARKET_CONTEXT_CUTOFF_AFTER_DECISION_TIME"]);
});

test("grain context prefilter can honor the embedded deterministic context gate as live truth", async () => {
  const service = prefilterService(snapshot({
    sourceDataCutoff: "2026-09-02T17:55:00.000Z",
  }));

  const [decision] = await service.evaluate([signal({
    signal_quality: {
      context_gate: {
        recommendation: "TAKE_REDUCED",
        reason_codes: ["US_GRAINS_RTH_ONLY", "VWAP_PULLBACK"],
      },
    },
  })], "2026-09-02T17:50:00.000Z", { preferEmbeddedContextGateDecision: true });

  assert.equal(decision.decision, "ADMISSIBLE");
  assert.equal(decision.admissible, true);
  assert.equal(decision.marketContextSnapshotId, null);
  assert.equal(decision.contextSource, "LEGACY_SIGNAL_EMBEDDED");
  assert.deepEqual(decision.reasonCodes, [
    "US_GRAINS_EMBEDDED_CONTEXT_GATE_TRUTH",
    "US_GRAINS_RTH_ONLY",
    "VWAP_PULLBACK",
  ]);
});

function prefilterService(currentSnapshot) {
  return new MarketContextPrefilterService({
    repository: { async current() { return { snapshot: currentSnapshot }; } },
  });
}

function signal(overrides = {}) {
  return {
    signal_id: "signal-live",
    signal_outbox_id: "outbox-live",
    instrument: "ZC",
    direction: "LONG",
    generated_at_utc: "2026-09-02T17:35:00.000Z",
    source_data_cutoff_utc: "2026-09-02T17:35:00.000Z",
    setup: { setup_kind: "VWAP_PULLBACK" },
    payload: {},
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  const sourceDataCutoff = overrides.sourceDataCutoff || "2026-09-02T17:30:00.000Z";
  return {
    marketContextSnapshotId: "ctx-live",
    universe: "US_GRAINS_CBOT",
    createdAt: "2026-09-02T17:45:00.000Z",
    validFrom: "2026-09-02T17:45:00.000Z",
    validUntil: "2026-09-02T18:15:00.000Z",
    sourceDataCutoff,
    marketState: "OPEN",
    marketSession: "CBOT_GRAINS_RTH",
    marketRegime: "TRENDING",
    volatilityRegime: "NORMAL",
    globalBias: "BULLISH",
    status: "AVAILABLE",
    sourceStates: [{
      sourceId: "market_agri_events",
      sourceType: "AGRI_EVENT_CALENDAR",
      status: "AVAILABLE",
      requiredFor: ["MARKET_CONTEXT_SNAPSHOT", "CONTEXT_PREFILTER"],
      coverageStart: "2026-03-01T00:00:00.000Z",
      coverageEnd: "2026-12-31T23:59:59.000Z",
      dataCutoff: sourceDataCutoff,
    }],
    instrumentViews: [{
      instrument: "ZC",
      bias: "LONG_BIASED",
      allowedSides: ["LONG"],
      confidence: 0.8,
      preferredFamilies: ["VWAP_PULLBACK"],
      discouragedFamilies: [],
    }],
    preferredStrategyFamilies: ["VWAP_PULLBACK"],
    discouragedStrategyFamilies: [],
    opportunityZones: [],
    noTradeZones: [],
    invalidationConditions: [],
    riskMultiplier: 0.85,
    reasonCodes: ["CONTEXT_READY"],
    ...overrides,
  };
}
