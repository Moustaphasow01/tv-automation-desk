import { describe, expect, it } from "vitest";
import type { LiveFocusView } from "@/domains/front-api/viewModels";
import { buildFocusDashboard, normalizeFocusDashboardPeriod } from "./focusDashboardModel";

describe("buildFocusDashboard", () => {
  it("filters the cockpit numbers by period without turning unpublished R into zero", () => {
    const focus = focusFixture({
      tradeCards: [
        tradeCard({
          tradeCardId: "today-actionable",
          createdAt: "2026-09-04T12:00:00.000Z",
          allowedActions: ["CONFIRM"],
          actionable: true,
          expectedR: 1.5,
        }),
        tradeCard({
          tradeCardId: "older-target",
          createdAt: "2026-08-25T12:00:00.000Z",
          allowedActions: [],
          theoreticalState: "TARGET_HIT",
          terminalReason: "TARGET_HIT",
          realizedR: 1.25,
          terminal: true,
        }),
      ],
      observedOpportunities: [
        observedOpportunity({ opportunityId: "today-filtered", createdAt: "2026-09-04T11:55:00.000Z" }),
      ],
    });

    const today = buildFocusDashboard(focus, "TODAY");
    expect(today.counts).toMatchObject({ rawSignals: 2, tradableTickets: 1, actionableTickets: 1, targetHits: 0 });
    expect(today.metrics.find((metric) => metric.id === "realized-r")?.value).toBe("Non publié");

    const total = buildFocusDashboard(focus, "TOTAL");
    expect(total.counts).toMatchObject({ rawSignals: 3, tradableTickets: 2, actionableTickets: 1, targetHits: 1 });
    expect(total.metrics.find((metric) => metric.id === "realized-r")?.value).toBe("+1,25 R");
  });

  it("explains when strategies publish signals but no ticket has reached the Human Gate", () => {
    const focus = focusFixture({
      tradeCards: [],
      observedOpportunities: [
        observedOpportunity({ opportunityId: "blocked-context", reasonCodes: ["CONTEXT_REJECTED"] }),
      ],
    });

    const dashboard = buildFocusDashboard(focus, "TODAY");

    expect(dashboard.counts).toMatchObject({ rawSignals: 1, tradableTickets: 0, actionableTickets: 0 });
    expect(dashboard.suggestions[0]).toMatchObject({
      id: "filtered-signals",
      title: "Signaux présents, aucun ordre prêt",
    });
  });

  it("keeps week and month filters inside the BFF exposed history", () => {
    const focus = focusFixture({
      tradeCards: [
        tradeCard({ tradeCardId: "today", createdAt: "2026-09-04T12:00:00.000Z" }),
        tradeCard({ tradeCardId: "six-days", createdAt: "2026-08-29T12:00:00.000Z" }),
        tradeCard({ tradeCardId: "twenty-days", createdAt: "2026-08-15T12:00:00.000Z" }),
        tradeCard({ tradeCardId: "older", createdAt: "2026-07-01T12:00:00.000Z" }),
      ],
    });

    expect(buildFocusDashboard(focus, "WEEK").counts.tradableTickets).toBe(2);
    expect(buildFocusDashboard(focus, "MONTH").counts.tradableTickets).toBe(3);
    expect(buildFocusDashboard(focus, "TOTAL").counts.tradableTickets).toBe(4);
  });

  it("normalizes unknown URL periods to the current day", () => {
    expect(normalizeFocusDashboardPeriod("week")).toBe("WEEK");
    expect(normalizeFocusDashboardPeriod("TOTAL")).toBe("TOTAL");
    expect(normalizeFocusDashboardPeriod("tomorrow")).toBe("TODAY");
    expect(normalizeFocusDashboardPeriod(null)).toBe("TODAY");
  });
});

function focusFixture(overrides: Partial<LiveFocusView> = {}): LiveFocusView {
  return {
    schemaVersion: "live_focus_view_v1",
    universe: "US_GRAINS_CBOT",
    asOf: "2026-09-04T14:00:00.000Z",
    safety: { autoExecutionEnabled: false, physicalLiveEnabled: false, humanGateRequired: true, authority: "BACKEND" },
    session: {
      marketState: "OPEN",
      marketSession: "CBOT_GRAINS_RTH",
      exchangeTimezone: "America/Chicago",
      marketDate: "2026-09-04",
      sessionStart: null,
      sessionEnd: null,
      nextEligibleAt: null,
      asOf: "2026-09-04T14:00:00.000Z",
      source: "test",
    },
    marketContext: { status: "AVAILABLE", marketRegime: "TRENDING", volatilityRegime: "NORMAL", globalBias: "NEUTRAL" },
    marketDeskBrief: { status: "AVAILABLE", headline: "Brief test", operatorSummary: "Surveillance test" },
    briefHistory: [],
    whyNoTrade: {
      whyNoTradeSummaryId: "why-test",
      status: "EXPLAINED",
      topReasons: [],
      stageCounts: {},
      blockingConditions: [],
      nextExpectedEvaluationAt: null,
      nextContextRefreshAt: null,
      nextRelevantEventAt: null,
      reasonCodes: [],
    },
    operatorJourneyState: {
      stage: "B",
      rawStatus: "OPEN",
      sourceObjectType: "MarketSession",
      sourceObjectId: null,
      asOf: "2026-09-04T14:00:00.000Z",
      reasonCodes: [],
    },
    tradeCards: [],
    observedOpportunities: [],
    selectedTrade: null,
    catalysts: [],
    marketSeries: { availability: "AVAILABLE", source: "test", instrument: "ZC", timeframe: "5", supportedTimeframes: ["1", "5", "15"], asOf: "2026-09-04T14:00:00.000Z", points: [] },
    watchlist: [],
    sourceStates: [],
    contextWorker: {
      taskType: "LIVE_US_GRAINS_MARKET_CONTEXT_REFRESH",
      lane: "live",
      cadenceMinutes: { marketOpen: 30, marketClosed: 60 },
      timeoutMs: 780000,
      modelPolicy: {},
      taskCount: 0,
      successCount: 0,
      failureCount: 0,
      activeCount: 0,
      lastCompletedAt: null,
      lastSuccessfulBriefAt: null,
      briefAgeSeconds: null,
      retryCount: 0,
      averageLatencyMs: null,
      totalTokens: 0,
      costMicrosUsd: 0,
    },
    nextActions: [],
    technical: { source: "front-api/live-focus", sourceDataCutoff: "2026-09-04T14:00:00.000Z", revision: 1 },
    ...overrides,
  };
}

function tradeCard(overrides: Partial<LiveFocusView["tradeCards"][number]> = {}): LiveFocusView["tradeCards"][number] {
  return {
    tradeCardId: "trade-card",
    targetPositionId: "target-position",
    orderIntentId: "order-intent",
    humanGateId: "human-gate",
    signalId: "signal",
    instrument: "ZC",
    side: "LONG",
    strategyName: "Grain trend pullback",
    setup: "PULLBACK",
    createdAt: "2026-09-04T12:00:00.000Z",
    expiresAt: "2026-09-04T12:30:00.000Z",
    operatorState: "AWAITING_MANUAL_CONFIRMATION",
    theoreticalState: "AWAITING_ENTRY",
    authorizedQuantity: 1,
    riskAmount: 100,
    expectedR: null,
    priority: "ACTIVE",
    attentionReason: null,
    allowedActions: [],
    denialReasons: [],
    actionable: false,
    actionPolicy: {},
    route: "/live/order-intents/order-intent",
    reasonCodes: [],
    whyThisTrade: {},
    source: "front-api/live-focus",
    asOf: "2026-09-04T14:00:00.000Z",
    availability: "AVAILABLE",
    terminal: false,
    ...overrides,
  };
}

function observedOpportunity(overrides: Partial<LiveFocusView["observedOpportunities"][number]> = {}): LiveFocusView["observedOpportunities"][number] {
  return {
    opportunityId: "observed",
    signalId: "signal-observed",
    instrument: "ZW",
    side: "SHORT",
    strategyName: "Grain reversal",
    status: "REJECTED",
    reasonCodes: [],
    createdAt: "2026-09-04T12:05:00.000Z",
    expiresAt: "2026-09-04T12:35:00.000Z",
    diagnosticOnly: true,
    route: "/live/signals/signal-observed",
    source: "strategy-signal",
    asOf: "2026-09-04T12:05:00.000Z",
    availability: "AVAILABLE",
    ...overrides,
  };
}
