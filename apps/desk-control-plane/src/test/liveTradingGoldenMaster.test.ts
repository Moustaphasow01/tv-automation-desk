import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { liveTone, toLiveTradingModel } from "@/features/live-trading/mapper";
import { liveHumanGateStatus } from "@/features/live-trading/LiveHumanGate";
import { InstrumentChartPanel, StrategyInstancesPanel } from "@/features/live-trading/LiveTradingPanels";
import type { LiveTradingView } from "@/domains/front-api/viewModels";
import { liveTradingView } from "@/mocks/canonicalDataset";
import type { ViewEnvelope } from "@/shared/contracts";

describe("Live Trading golden master", () => {
  it("keeps unavailable time series honest instead of projecting zero prices", () => {
    const model = toLiveTradingModel(liveTradingView);

    expect(model.marketSeries.availability).toBe("UNAVAILABLE");
    expect(model.marketSeries.reason).toContain("Fixture");
    expect(model.performance.totalR).toBeNull();
  });

  it("fails closed when the projection is stale even if actions are published", () => {
    const envelope = withOrderIntent(true);
    const model = toLiveTradingModel(envelope);

    expect(model.orderIntent?.humanGate.status).toBe("AWAITING_MANUAL_CONFIRMATION");
    expect(model.orderIntent?.allowedActions.allowedActions).toContain("CONFIRM");
    expect(model.gateActions).toEqual([]);
    expect(model.gateBlockedReason).toContain("stale");
  });

  it("exposes a Human Gate action only when resource and action capabilities intersect", () => {
    const envelope = withOrderIntent(false);
    const model = toLiveTradingModel(envelope);

    expect(model.gateActions.map((action) => action.action)).toEqual(["CONFIRM", "REJECT"]);
    expect(model.mode.executionMode).toBe("SEMI_MANUAL");
    expect(model.mode.ackIsFill).toBe(false);
  });

  it("renders market closure and policy disablement as truthful neutral states", () => {
    expect(liveTone("MARKET_CLOSED")).toBe("info");
    expect(liveTone("DISABLED_BY_POLICY")).toBe("info");
    expect(liveTone("CONNECTED_EMPTY")).toBe("info");
    expect(liveTone("UNAVAILABLE")).toBe("danger");
    expect(liveTone("STALE")).toBe("warning");
  });

  it("renders an empty Human Gate as connected-empty rather than unavailable", () => {
    const model = toLiveTradingModel(liveTradingView);

    expect(model.orderIntent).toBeNull();
    expect(liveHumanGateStatus(model)).toBe("CONNECTED_EMPTY");
  });

  it("keeps the active strategy panel compact while linking to the full deployment list", () => {
    const envelope = withStrategyInstances(6);
    const model = toLiveTradingModel(envelope);
    const markup = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(StrategyInstancesPanel, { model }))
    );

    expect(markup).toContain("Voir toutes");
    expect(markup).toContain("/strategies/deployments");
    expect(markup).toContain("6 publiées");
    expect(markup).toContain("4 instances affichées sur 6 instances publiées par le backend");
    expect(markup).toContain("strategy-preview-04");
    expect(markup).not.toContain("strategy-preview-05");
    expect(markup).not.toContain("strategy-preview-06");
  });

  it("renders backend-published chart scope controls for MNQ/MES and timeframes", () => {
    const envelope = structuredClone(liveTradingView) as ViewEnvelope<LiveTradingView>;
    envelope.data.marketSeries = {
      schemaVersion: "front_market_series_v1",
      availability: "KNOWN",
      source: "market_candles",
      instrument: "MES",
      timeframe: "5",
      supportedInstruments: ["MNQ", "MES"],
      supportedTimeframes: ["1", "5", "15"],
      asOf: "2026-08-10T09:35:00.000Z",
      points: [],
    };
    const model = toLiveTradingModel(envelope);
    const markup = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(InstrumentChartPanel, { model }))
    );

    expect(markup).toContain("MNQ · MQ");
    expect(markup).toContain("MES · MS");
    expect(markup).toContain("M1");
    expect(markup).toContain("M5");
    expect(markup).toContain("aria-pressed=\"true\"");
  });
});

function withOrderIntent(stale: boolean): ViewEnvelope<LiveTradingView> {
  const envelope = structuredClone(liveTradingView) as ViewEnvelope<LiveTradingView>;
  const actions = (["CONFIRM", "REJECT"] as const).map((action) => ({
    action,
    actionId: `human-gate.${action.toLowerCase()}.intent-1`,
    label: `${action} OrderIntent`,
    commandType: `execution.order_intent.${action.toLowerCase()}`,
    environment: "PAPER" as const,
    permission: "ALLOWED" as const,
    requiresConfirmation: true,
    requiresReason: true,
    expectedRevision: "revision-1",
    impactPreview: "Human Gate only; no ACK or fill is created.",
    payload: { portfolioOrderIntentId: "intent-1" },
  }));
  const intent: LiveTradingView["portfolioOrderIntents"][number] = {
    orderIntentId: "intent-1",
    portfolioOrderIntentId: "intent-1",
    signalId: "signal-1",
    strategyInstanceId: "strategy-1",
    symbol: "MNQ",
    side: "BUY",
    type: "LIMIT",
    quantity: 2,
    state: "AWAITING_MANUAL_CONFIRMATION",
    limitPrice: 20_000,
    stopPrice: 19_950,
    targetPrice: 20_100,
    targetPositionId: "target-1",
    executionTerms: { instrument: "MNQ", quantity: 2, order_type: "LIMIT", entry: { price: 20_000 }, stop: { price: 19_950 } },
    riskSnapshot: { requestedQty: 3, authorizedQty: 2 },
    immutability: { policy: "REJECT_AND_REPLAN" },
    humanGate: { gateId: "gate-1", status: "AWAITING_MANUAL_CONFIRMATION", allowedActions: actions },
    allowedActions: { resourceType: "OrderIntent", allowedActions: ["VIEW", "CONFIRM", "REJECT"], denialReasons: [], revision: "revision-1", requiresStepUp: false, reasonRequired: true, expiresAt: null },
    providerCommandCount: 0,
    providerEventCount: 0,
    brokerSubmissionAllowed: false,
    physicalExecutionState: "NOT_SENT",
    ackIsFill: false,
    route: "/execution/orders/intent-1",
  };
  envelope.meta = { ...envelope.meta, stale, availability: stale ? "STALE" : "AVAILABLE" };
  envelope.data.portfolioOrderIntents = [intent];
  envelope.data.canonicalRuntime.pendingOrderIntents = [intent];
  return envelope;
}

function withStrategyInstances(count: number): ViewEnvelope<LiveTradingView> {
  const envelope = structuredClone(liveTradingView) as ViewEnvelope<LiveTradingView>;
  envelope.data.canonicalRuntime.activeStrategyInstances = Array.from({ length: count }, (_, index) => {
    const position = index + 1;
    const id = `strategy-preview-${String(position).padStart(2, "0")}`;
    return {
      strategyInstanceId: id,
      strategyDefinitionId: `strategy-definition-${String(position).padStart(2, "0")}`,
      strategyVersionId: `strategy-version-${String(position).padStart(2, "0")}`,
      name: id,
      executionMode: "SHADOW",
      runtimeState: "RUNNING",
      lastEvaluationAt: "2026-08-10T09:30:00.000Z",
      nextEvaluationAt: "2026-08-10T09:45:00.000Z",
      scheduler: { cadence: "M15" },
      confidence: null,
      confidenceSourceSignalId: null,
    };
  });
  return envelope;
}
