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

  it("fails closed on a partial projection even when Human Gate actions are published", () => {
    const envelope = withOrderIntent(false);
    envelope.meta = { ...envelope.meta, availability: "PARTIAL", stale: false, warnings: ["live-risk-checks:UNAVAILABLE"] };
    const model = toLiveTradingModel(envelope);

    expect(model.truth.label).toBe("PARTIAL");
    expect(model.gateActions).toEqual([]);
    expect(model.gateBlockedReason).toContain("PARTIAL");
  });

  it("keeps TargetPosition visible without inventing theoretical execution or audit events", () => {
    const envelope = withOrderIntent(false);
    envelope.data.canonicalRuntime.pendingTargetPositions = [{
      targetPositionId: "target-1",
      instrument: "MNQ",
      targetNetSize: 2,
      deltaSize: 2,
    }];
    envelope.data.timeline = [];
    const model = toLiveTradingModel(envelope);

    expect(model.targetPosition?.targetPositionId).toBe("target-1");
    expect(model.reconciliation.expected).toBeNull();
    expect(model.timeline).toEqual([]);
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

  it("does not draw zero or cross-instrument trade levels over the active market chart", () => {
    const envelope = withOrderIntent(false);
    const intent = envelope.data.canonicalRuntime.pendingOrderIntents[0];
    envelope.data.canonicalRuntime.pendingOrderIntents = [{
      ...intent,
      symbol: "MES",
      limitPrice: 0,
      stopPrice: 7654.25,
      targetPrice: 7710,
      executionTerms: { instrument: "MES", order_type: "LIMIT", entry: { price: 7672.25 }, stop: { price: 7654.25 }, targets: [{ price: 7710 }] },
    }];
    envelope.data.portfolioOrderIntents = envelope.data.canonicalRuntime.pendingOrderIntents;
    envelope.data.marketSeries = {
      schemaVersion: "front_market_series_v1",
      availability: "KNOWN",
      source: "market_candles",
      instrument: "MNQ",
      timeframe: "5",
      supportedInstruments: ["MNQ", "MES"],
      supportedTimeframes: ["1", "5", "15"],
      asOf: "2026-08-10T09:40:00.000Z",
      points: [
        { timestamp: "2026-08-10T09:30:00.000Z", open: 29320, high: 29340, low: 29310, close: 29334, volume: 100, vwap: 29325 },
        { timestamp: "2026-08-10T09:35:00.000Z", open: 29334, high: 29348, low: 29318, close: 29322, volume: 120, vwap: 29330 },
        { timestamp: "2026-08-10T09:40:00.000Z", open: 29322, high: 29355, low: 29320, close: 29350, volume: 130, vwap: 29338 },
      ],
    };
    const model = toLiveTradingModel(envelope);
    const markup = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(InstrumentChartPanel, { model }))
    );

    expect(markup).toContain("Prix de 29310.00 à 29355.00");
    expect(markup).toContain("Niveaux MES masqués sur le graphique MNQ");
    expect(markup).not.toContain("ENTRÉE 0.00");
    expect(markup).not.toContain("7710.00");
  });

  it("draws the same-instrument tradable signal plan when no OrderIntent exists yet", () => {
    const envelope = structuredClone(liveTradingView) as ViewEnvelope<LiveTradingView>;
    envelope.data.canonicalRuntime.pendingOrderIntents = [];
    envelope.data.portfolioOrderIntents = [];
    envelope.data.marketSeries = {
      schemaVersion: "front_market_series_v1",
      availability: "KNOWN",
      source: "market_candles",
      instrument: "ZC",
      timeframe: "5",
      supportedInstruments: ["MNQ", "MES", "ZC", "ZW"],
      supportedTimeframes: ["1", "5", "15", "60", "240"],
      asOf: "2026-08-26T16:40:00.000Z",
      points: [
        { timestamp: "2026-08-26T16:30:00.000Z", open: 507, high: 508, low: 506.5, close: 507.5, volume: 120, vwap: 507.2 },
        { timestamp: "2026-08-26T16:35:00.000Z", open: 507.5, high: 508.25, low: 506.75, close: 507.75, volume: 150, vwap: 507.45 },
        { timestamp: "2026-08-26T16:40:00.000Z", open: 507.75, high: 509.25, low: 507.25, close: 508.75, volume: 180, vwap: 508.1 },
      ],
    };
    envelope.data.signals = [{
      signalId: "grain-signal-zc",
      strategyId: "grain-strategy",
      strategyVersionId: "grain-strategy-v1",
      strategyInstanceId: "grain-instance-zc",
      symbol: "ZC",
      direction: "LONG",
      state: "NEW",
      confidence: 74,
      createdAt: "2026-08-26T16:35:00.000Z",
      expiresAt: "2026-08-26T16:55:00.000Z",
      sourceDataCutoffAt: "2026-08-26T16:35:00.000Z",
      featureSnapshotId: "features-zc",
      ruleHits: ["US_OPEN_TREND"],
      expectancyR: 1.8,
      rewardRisk: 2,
      regime: "TREND",
      proposedTradePlan: {
        entry: { availability: "KNOWN", type: "ZONE", price: 507.5, low: 507.25, high: 507.75 },
        stop: { availability: "KNOWN", price: 506.25 },
        targets: [{ label: "T1", price: 510, expected_r: 2 }],
      },
      tradePlanEconomics: { entry_price: 507.5, stop_price: 506.25, targets: [{ label: "T1", price: 510, reward_risk: 2 }] },
      availability: "KNOWN",
    }];
    envelope.data.canonicalRuntime.latestSignals = envelope.data.signals;
    const model = toLiveTradingModel(envelope);
    const markup = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(InstrumentChartPanel, { model }))
    );

    expect(markup).toContain("Dernier signal détecté");
    expect(markup).toContain("class=\"lt-chart-header-stack\"");
    expect(markup).toMatch(/class="lt-chart-header-stack">[\s\S]*class="lt-chart-toolbar"[\s\S]*class="lt-chart-signal-context"[\s\S]*<\/div><div class="lt-chart-frame"/);
    expect(markup).toContain("ENTRÉE 507.50");
    expect(markup).toContain("STOP 506.25");
    expect(markup).toContain("T1 510.00");
    expect(markup).toContain("Navigation du graphique");
    expect(markup).toContain("Dernière bougie");
    expect(markup).toContain("<dt>Ouv.</dt><dd>507,75</dd>");
    expect(markup).toContain("<dt>Volume</dt><dd>180</dd>");
    expect(markup).toContain("ZC");
    expect(markup).toContain("H1");
    expect(markup).toContain("H4");
  });

  it("does not turn an entry zone into an invented point price", () => {
    const envelope = signalChartEnvelope({
      direction: "LONG",
      proposedTradePlan: {
        entry_zone: { low: 507.25, high: 507.75 },
        stop: { price: 506.25 },
        targets: [{ label: "T1", price: 510 }],
      },
      tradePlanEconomics: {},
    });
    const markup = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(InstrumentChartPanel, { model: toLiveTradingModel(envelope) }))
    );

    expect(markup).not.toContain("Dernier signal détecté");
    expect(markup).not.toContain("ENTRÉE 507.50");
  });

  it("keeps routine chart refresh feedback compact and outside the plotting area", () => {
    const envelope = signalChartEnvelope({
      direction: "LONG",
      proposedTradePlan: { entry: { price: 507.5 }, stop: { price: 506.25 }, targets: [{ label: "T1", price: 510 }] },
      tradePlanEconomics: { entry_price: 507.5 },
    });
    const markup = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(InstrumentChartPanel, {
        model: toLiveTradingModel(envelope),
        loading: true,
      }))
    );

    expect(markup).toContain("class=\"lt-chart-sync\"");
    expect(markup).toContain("data-active=\"true\"");
    expect(markup).toContain("Synchronisation");
    expect(markup).not.toContain("Actualisation du graphique");
    expect(markup).not.toContain("lt-chart-transition");
    expect(markup).not.toContain("lt-chart-tooltip");
  });

  it("does not render a trade overlay when the backend side is unknown", () => {
    const envelope = signalChartEnvelope({
      direction: "UNKNOWN",
      proposedTradePlan: {
        entry: { price: 507.5 },
        stop: { price: 506.25 },
        targets: [{ label: "T1", price: 510 }],
      },
      tradePlanEconomics: { entry_price: 507.5 },
    });
    const markup = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(InstrumentChartPanel, { model: toLiveTradingModel(envelope) }))
    );

    expect(markup).not.toContain("Dernier signal détecté");
    expect(markup).not.toContain("ENTRÉE 507.50");
  });
});

function signalChartEnvelope(signalOverrides: Record<string, unknown>): ViewEnvelope<LiveTradingView> {
  const envelope = structuredClone(liveTradingView) as ViewEnvelope<LiveTradingView>;
  envelope.data.canonicalRuntime.pendingOrderIntents = [];
  envelope.data.portfolioOrderIntents = [];
  envelope.data.marketSeries = {
    schemaVersion: "front_market_series_v1",
    availability: "KNOWN",
    source: "market_candles",
    instrument: "ZC",
    timeframe: "5",
    supportedInstruments: ["ZC"],
    supportedTimeframes: ["5"],
    asOf: "2026-08-26T16:40:00.000Z",
    points: [
      { timestamp: "2026-08-26T16:35:00.000Z", open: 507.5, high: 508.25, low: 506.75, close: 507.75, volume: 150, vwap: 507.45 },
      { timestamp: "2026-08-26T16:40:00.000Z", open: 507.75, high: 509.25, low: 507.25, close: 508.75, volume: 180, vwap: 508.1 },
    ],
  };
  envelope.data.signals = [{
    signalId: "grain-signal-zc-truth-test",
    strategyId: "grain-strategy",
    strategyVersionId: "grain-strategy-v1",
    strategyInstanceId: "grain-instance-zc",
    symbol: "ZC",
    direction: "LONG",
    state: "NEW",
    confidence: 74,
    createdAt: "2026-08-26T16:35:00.000Z",
    expiresAt: "2026-08-26T16:55:00.000Z",
    sourceDataCutoffAt: "2026-08-26T16:35:00.000Z",
    featureSnapshotId: "features-zc",
    ruleHits: ["US_OPEN_TREND"],
    expectancyR: 1.8,
    rewardRisk: 2,
    regime: "TREND",
    proposedTradePlan: {},
    tradePlanEconomics: {},
    availability: "KNOWN",
    ...signalOverrides,
  }] as LiveTradingView["signals"];
  envelope.data.canonicalRuntime.latestSignals = envelope.data.signals;
  return envelope;
}

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
