import { describe, expect, it } from "vitest";
import { isLiveFocusView } from "@/domains/front-api/viewModels";

describe("Live Focus deep contract", () => {
  it("accepts the canonical safe empty snapshot", () => {
    expect(isLiveFocusView(fixture())).toBe(true);
  });

  it("rejects unsafe policy, shallow cards and false trade promotion", () => {
    expect(isLiveFocusView({ ...fixture(), safety: { ...fixture().safety, autoExecutionEnabled: true } })).toBe(false);
    expect(isLiveFocusView({ ...fixture(), tradeCards: [{ signalId: "signal-only" }] })).toBe(false);
    expect(isLiveFocusView({ ...fixture(), observedOpportunities: [{ signalId: "signal-1", diagnosticOnly: false }] })).toBe(false);
  });
});

function fixture() {
  return {
    schemaVersion: "live_focus_view_v1",
    universe: "US_GRAINS_CBOT",
    asOf: "2026-09-01T14:30:00.000Z",
    safety: { autoExecutionEnabled: false, physicalLiveEnabled: false, humanGateRequired: true, authority: "BACKEND" },
    session: { marketState: "OPEN", marketSession: "CBOT_GRAINS_RTH", exchangeTimezone: "America/Chicago", marketDate: "2026-09-01", sessionStart: null, sessionEnd: null, nextEligibleAt: null, asOf: "2026-09-01T14:30:00.000Z", source: "data_readiness.market_session" },
    marketContext: { status: "UNAVAILABLE", sourceStates: [], reasonCodes: ["MARKET_CONTEXT_NOT_PUBLISHED"] },
    marketDeskBrief: { status: "UNAVAILABLE", headline: "Non publié", operatorSummary: "Le Desk déterministe continue." },
    briefHistory: [],
    whyNoTrade: { whyNoTradeSummaryId: "why-1", status: "EXPLAINED", topReasons: ["NO_SETUP"], stageCounts: {}, blockingConditions: [], nextExpectedEvaluationAt: null, nextContextRefreshAt: null, nextRelevantEventAt: null, reasonCodes: ["NO_SETUP"] },
    operatorJourneyState: { stage: "B", rawStatus: "UNAVAILABLE", sourceObjectType: "MarketContextSnapshot", sourceObjectId: null, asOf: "2026-09-01T14:30:00.000Z", reasonCodes: ["MARKET_CONTEXT_UNAVAILABLE"] },
    tradeCards: [],
    selectedTrade: null,
    observedOpportunities: [],
    catalysts: [],
    marketSeries: undefined,
    watchlist: undefined,
    sourceStates: [],
    contextWorker: { taskType: "LIVE_US_GRAINS_MARKET_CONTEXT_REFRESH", lane: "live", cadenceMinutes: { marketOpen: 30, marketClosed: 60 }, timeoutMs: 780000, modelPolicy: {}, taskCount: 0, successCount: 0, failureCount: 0, activeCount: 0, lastCompletedAt: null, lastSuccessfulBriefAt: null, briefAgeSeconds: null, retryCount: 0, averageLatencyMs: null, totalTokens: 0, costMicrosUsd: 0 },
    nextActions: [],
    technical: { source: "front-api/live-focus", sourceDataCutoff: null, revision: 0 },
  };
}
