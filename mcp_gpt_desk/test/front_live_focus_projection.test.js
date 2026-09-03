import assert from "node:assert/strict";
import test from "node:test";
import { buildLiveFocusProjection } from "../src/front-live-focus-projection.js";

const NOW = "2026-09-01T14:35:00.000Z";

test("Live Focus keeps a raw signal diagnostic and never promotes it to a trade card", () => {
  const projection = buildLiveFocusProjection({
    live: liveFixture(),
    marketContext: null,
    health: healthFixture(),
    nowIso: NOW,
  });

  assert.equal(projection.tradeCards.length, 0);
  assert.equal(projection.observedOpportunities.length, 1);
  assert.equal(projection.observedOpportunities[0].diagnosticOnly, true);
  assert.equal(projection.operatorJourneyState.stage, "C");
  assert.deepEqual(projection.safety, {
    autoExecutionEnabled: false,
    physicalLiveEnabled: false,
    humanGateRequired: true,
    authority: "BACKEND",
  });
});

test("Live Focus creates a qualified trade card only with TargetPosition, OrderIntent and Human Gate lineage", () => {
  const live = liveFixture();
  live.portfolioOrderIntents = [{
    portfolioOrderIntentId: "intent-1",
    targetPositionId: "target-1",
    signalId: "signal-1",
    instrument: "ZW",
    side: "LONG",
    quantity: 1,
    executionTerms: { entry: { price: 544 }, stop: { price: 540 }, targets: [{ price: 552 }] },
    allowedActions: { allowedActions: ["CONFIRM", "REJECT"], revision: 3 },
    humanGate: { gateId: "gate-1", status: "AWAITING_CONFIRMATION" },
    createdAt: NOW,
  }];

  const projection = buildLiveFocusProjection({ live, marketContext: null, health: healthFixture(), nowIso: NOW });

  assert.equal(projection.tradeCards.length, 1);
  assert.equal(projection.tradeCards[0].signalId, "signal-1");
  assert.equal(projection.tradeCards[0].targetPositionId, "target-1");
  assert.equal(projection.tradeCards[0].humanGateId, "gate-1");
  assert.equal(projection.operatorJourneyState.stage, "F");
  assert.equal(projection.operatorJourneyState.sourceObjectType, "OrderIntent");
});

test("Live Focus session comes only from canonical grain readiness and never invents an equity session", () => {
  const projection = buildLiveFocusProjection({
    live: liveFixture(),
    marketContext: null,
    health: healthFixture(),
    nowIso: NOW,
  });

  assert.equal(projection.session.marketSession, "CBOT_GRAINS_RTH");
  assert.equal(projection.session.exchangeTimezone, "America/Chicago");
  assert.notEqual(projection.session.marketSession, "asia_open");
});

test("Live Focus publishes backend arbitration stage before a qualified trade card exists", () => {
  const live = liveFixture();
  live.arbitrations = [{ status: "SELECTED" }];
  const projection = buildLiveFocusProjection({ live, marketContext: null, health: healthFixture(), nowIso: NOW });
  assert.equal(projection.operatorJourneyState.stage, "D");
  assert.equal(projection.operatorJourneyState.rawStatus, "UNDER_ARBITRATION");
});

test("Live Focus pins actionable cards above active and terminal cards", () => {
  const live = liveFixture();
  live.portfolioOrderIntents = [
    intentFixture("terminal", { humanGate: { gateId: "gate-terminal", status: "EXPIRED" }, allowedActions: { allowedActions: [], revision: 1 } }),
    intentFixture("actionable", { humanGate: { gateId: "gate-actionable", status: "AWAITING_CONFIRMATION" }, allowedActions: { allowedActions: ["CONFIRM"], revision: 2 } }),
    intentFixture("pending", { humanGate: { gateId: "gate-pending", status: "CONFIRMED_PENDING_PROVIDER" }, allowedActions: { allowedActions: [], revision: 2 } }),
  ];
  const projection = buildLiveFocusProjection({ live, marketContext: null, health: healthFixture(), nowIso: NOW });
  assert.deepEqual(projection.tradeCards.map((item) => item.orderIntentId), ["intent-actionable", "intent-pending", "intent-terminal"]);
});

test("Live Focus does not keep cancelled or expired observed signals in an active opportunity stage", () => {
  const live = liveFixture();
  live.signals[0] = {
    ...live.signals[0],
    state: "CANCELLED",
    effectiveState: "CANCELLED",
    expiresAt: "2026-09-01T14:00:00.000Z",
  };
  const health = healthFixture();
  health.data_readiness.market_session.state = "CLOSED";

  const projection = buildLiveFocusProjection({ live, marketContext: null, health, nowIso: NOW });

  assert.equal(projection.observedOpportunities[0].status, "CANCELLED");
  assert.equal(projection.observedOpportunities[0].terminal, true);
  assert.equal(projection.operatorJourneyState.stage, "A");
  assert.equal(projection.operatorJourneyState.rawStatus, "CLOSED");
});

test("Live Focus keeps terminal qualified dossiers in history without selecting them as the current trade", () => {
  const live = liveFixture();
  live.portfolioOrderIntents = [
    intentFixture("expired", {
      signalId: "signal-1",
      expiresAt: "2026-09-01T14:00:00.000Z",
      humanGate: { gateId: "gate-expired", status: "AWAITING_CONFIRMATION" },
      allowedActions: { allowedActions: ["CONFIRM"], expiresAt: "2026-09-01T14:00:00.000Z", revision: 4 },
    }),
  ];

  const projection = buildLiveFocusProjection({ live, marketContext: null, health: healthFixture(), nowIso: NOW });

  assert.equal(projection.tradeCards.length, 1);
  assert.equal(projection.tradeCards[0].operatorState, "EXPIRED");
  assert.equal(projection.tradeCards[0].terminal, true);
  assert.equal(projection.tradeCards[0].actionable, false);
  assert.equal(projection.selectedTrade, null);
  assert.notEqual(projection.operatorJourneyState.stage, "F");
});

function liveFixture() {
  return {
    signals: [{
      signalId: "signal-1",
      instrument: "ZW",
      direction: "LONG",
      strategyName: "ZW pullback",
      createdAt: NOW,
      reasonCodes: ["SETUP_MATCHED"],
    }],
    portfolioOrderIntents: [],
    riskChecks: [],
    marketSeries: { asOf: NOW, instruments: [] },
    watchlist: [],
  };
}

function healthFixture() {
  return {
    data_readiness: {
      state: "OPEN",
      market_session: {
        state: "OPEN",
        active_session: "CBOT_GRAINS_RTH",
        timezone: "America/Chicago",
        as_of_utc: NOW,
      },
    },
  };
}

function intentFixture(id, overrides = {}) {
  return {
    portfolioOrderIntentId: `intent-${id}`,
    targetPositionId: `target-${id}`,
    instrument: "ZW",
    side: "LONG",
    quantity: 1,
    executionTerms: { entry: { price: 544 }, stop: { price: 540 }, targets: [{ price: 552 }] },
    createdAt: NOW,
    ...overrides,
  };
}
