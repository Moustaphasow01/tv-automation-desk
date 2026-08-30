import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { LiveTradingView } from "@/domains/front-api/viewModels";
import { LiveSignalInbox } from "@/features/live-trading/LiveSignalInbox";
import { chartMarkers } from "@/features/live-trading/chart/LiveMarketChart";
import { toLiveTradingModel } from "@/features/live-trading/mapper";
import { liveTradingView } from "@/mocks/canonicalDataset";
import type { ViewEnvelope } from "@/shared/contracts";

describe("Live Trading continuity", () => {
  it("keeps the selected decision dossier independent from the chart instrument", () => {
    const envelope = multiInstrumentEnvelope();
    envelope.data.marketSeries = {
      ...envelope.data.marketSeries!,
      instrument: "ZW",
    };

    const model = toLiveTradingModel(envelope, { signalId: "signal-zc" });

    expect(model.marketSeries.instrument).toBe("ZW");
    expect(model.latestSignal?.signalId).toBe("signal-zc");
    expect(model.latestSignal?.symbol).toBe("ZC");
  });

  it("renders the global signal inbox without the legacy six-row truncation", () => {
    const envelope = multiInstrumentEnvelope(9);
    const model = toLiveTradingModel(envelope);
    const markup = renderToStaticMarkup(createElement(
      MemoryRouter,
      null,
      createElement(LiveSignalInbox, { model }),
    ));

    expect(markup).toContain("Flux global · tous instruments");
    expect(markup).toContain("9 signaux publiés");
    expect(markup.match(/<tbody>/g)).toHaveLength(1);
    expect(markup).toContain("signal-zc-8");
  });

  it("does not infer a Human Gate or Risk stage for a raw signal", () => {
    const model = toLiveTradingModel(multiInstrumentEnvelope(1));
    const markup = renderToStaticMarkup(createElement(
      MemoryRouter,
      null,
      createElement(LiveSignalInbox, { model }),
    ));

    expect(markup).toContain("Signal publié");
    expect(markup).not.toContain("Human Gate ·");
    expect(markup).not.toContain("Risk ·");
  });

  it("exposes three explicit signal destinations and presents elapsed NEW signals as expired", () => {
    const envelope = multiInstrumentEnvelope(1);
    envelope.meta.asOf = "2026-08-28T08:00:00.000Z";
    envelope.data.signals = envelope.data.signals.map((signal) => ({
      ...signal,
      state: "NEW",
      expiresAt: "2026-08-27T22:05:00.000Z",
    }));
    envelope.data.canonicalRuntime.latestSignals = envelope.data.signals;
    const markup = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ["/?signalLane=ALL"] }, createElement(LiveSignalInbox, { model: toLiveTradingModel(envelope) })));

    expect(markup).toContain("Décision");
    expect(markup).toContain("Graphique");
    expect(markup).toContain("Dossier complet");
    expect(markup).toContain("Expiré");
    expect(markup).toContain("état brut NEW");
  });

  it("does not draw a pinned signal context marker on another instrument", () => {
    const envelope = multiInstrumentEnvelope(2);
    envelope.data.canonicalRuntime.aiContextGate = [{
      decisionId: "context-zc",
      signalId: "signal-zc",
      status: "RECORDED",
      mode: "SHADOW",
      recommendation: "TAKE",
      confidence: 80,
      riskMultiplier: 1,
      reasonCodes: [],
      anomalies: [],
      decidedAt: "2026-08-27T14:01:00.000Z",
    }];
    const model = toLiveTradingModel(envelope, { signalId: "signal-zc" });

    expect(chartMarkers(model, "ZW").some((marker) => marker.id === "context:context-zc")).toBe(false);
    expect(chartMarkers(model, "ZC").some((marker) => marker.id === "context:context-zc")).toBe(true);
  });

  it("does not claim that an OrderIntent without a persisted gate reached Human Gate", () => {
    const envelope = multiInstrumentEnvelope(1);
    const intent = portfolioIntent("signal-zc");
    envelope.data.canonicalRuntime.pendingOrderIntents = [intent];
    envelope.data.portfolioOrderIntents = [intent];
    const model = toLiveTradingModel(envelope);
    const markup = renderToStaticMarkup(createElement(
      MemoryRouter,
      null,
      createElement(LiveSignalInbox, { model }),
    ));

    expect(markup).toContain("Ordre proposé ·");
    expect(markup).not.toContain("Votre validation ·");
  });

});

function multiInstrumentEnvelope(count = 2): ViewEnvelope<LiveTradingView> {
  const envelope = structuredClone(liveTradingView) as ViewEnvelope<LiveTradingView>;
  const template = envelope.data.signals[0];
  const signals = Array.from({ length: count }, (_, index) => ({
    ...template,
    signalId: index === 0 ? "signal-zc" : `signal-zc-${index}`,
    symbol: index % 2 ? "ZW" : "ZC",
    strategyId: `grain-strategy-${index}`,
    strategyInstanceId: `grain-instance-${index}`,
    createdAt: new Date(Date.parse("2026-08-27T14:00:00.000Z") + index * 60_000).toISOString(),
  }));
  envelope.data.signals = signals;
  envelope.data.canonicalRuntime.latestSignals = signals;
  envelope.data.canonicalRuntime.pendingOrderIntents = [];
  envelope.data.portfolioOrderIntents = [];
  envelope.data.canonicalRuntime.aiContextGate = [];
  envelope.data.arbitrations = [];
  envelope.data.riskChecks = [];
  envelope.data.theoreticalExecution = undefined;
  envelope.data.marketSeries = {
    schemaVersion: "front_market_series_v1",
    availability: "KNOWN",
    source: "market_candles",
    instrument: "ZC",
    timeframe: "5",
    supportedInstruments: ["ZC", "ZW"],
    supportedTimeframes: ["1", "5", "15", "60", "240"],
    asOf: "2026-08-27T14:30:00.000Z",
    points: [],
  };
  return envelope;
}

function portfolioIntent(signalId: string): LiveTradingView["portfolioOrderIntents"][number] {
  return {
    orderIntentId: "intent-zc",
    portfolioOrderIntentId: "intent-zc",
    signalId,
    strategyInstanceId: "grain-instance-0",
    symbol: "ZC",
    side: "BUY",
    type: "LIMIT",
    quantity: 1,
    state: "CREATED",
    targetPositionId: "target-zc",
    executionTerms: null,
    riskSnapshot: null,
    immutability: null,
    humanGate: { gateId: null, status: "NOT_CREATED", allowedActions: [] },
    allowedActions: {
      resourceType: "OrderIntent",
      allowedActions: [],
      denialReasons: ["HUMAN_GATE_NOT_CREATED"],
      revision: "1",
      requiresStepUp: false,
      reasonRequired: false,
      expiresAt: null,
    },
    providerCommandCount: 0,
    providerEventCount: 0,
    brokerSubmissionAllowed: false,
    physicalExecutionState: "DISABLED_BY_POLICY",
    ackIsFill: false,
    route: "/order-intents/intent-zc",
  };
}
