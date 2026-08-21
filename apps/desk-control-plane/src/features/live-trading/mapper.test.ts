import { describe, expect, it } from "vitest";
import { toLiveTradingModel } from "./mapper";
import type { LiveTradingEnvelope } from "./model";

describe("toLiveTradingModel reconciliation", () => {
  it("presents a policy-disabled broker state without rendering its technical sentinel as broker data", () => {
    const envelope = {
      meta: {
        availability: "AVAILABLE",
        stale: false,
        asOf: "2026-08-16T12:00:00.000Z",
        warnings: [],
      },
      data: {
        canonicalRuntime: {
          latestSignals: [],
          pendingOrderIntents: [],
          activeStrategyInstances: [],
          aiContextGate: [],
          mode: {
            environment: "PREPROD",
            executionMode: "SEMI_MANUAL",
            autoExecutionEnabled: false,
            physicalExecutionEnabled: false,
            humanGateRequired: true,
          },
          freshness: {},
        },
        signals: [],
        portfolioOrderIntents: [],
        providers: [],
        timeSeriesContracts: { asOf: "2026-08-16T12:00:00.000Z", series: [] },
        reconciliation: {
          availability: "NOT_APPLICABLE_CURRENT_MODE",
          status: "PHYSICAL_EXECUTION_DISABLED",
          broker: { availability: "NOT_APPLICABLE_CURRENT_MODE" },
          expected: null,
          mismatchCount: null,
          asOf: null,
        },
      },
    } as unknown as LiveTradingEnvelope;

    const model = toLiveTradingModel(envelope);

    expect(model.reconciliation.status).toBe("EXÉCUTION PHYSIQUE DÉSACTIVÉE");
    expect(model.reconciliation.broker).toBeNull();
    expect(model.reconciliation.detail).toContain("Aucun snapshot broker");
  });

  it("does not invent a theoretical position from an OrderIntent when backend tracking is absent", () => {
    const envelope = liveEnvelope({
      portfolioOrderIntents: [orderIntent()],
      canonicalRuntime: {
        pendingOrderIntents: [orderIntent()],
        pendingTargetPositions: [{ targetPositionId: "target_1", deltaSize: 1 }],
      },
    });

    const model = toLiveTradingModel(envelope);

    expect(model.orderIntent?.portfolioOrderIntentId).toBe("poi_1");
    expect(model.reconciliation.expected).toBeNull();
    expect(model.selectedTheoreticalExecution).toBeNull();
  });

  it("uses backend theoretical execution as the expected shadow lifecycle when available", () => {
    const row = {
      portfolioOrderIntentId: "poi_1",
      targetPositionId: "target_1",
      strategySignalId: "sig_1",
      strategyId: "strategy_1",
      strategyInstanceId: "instance_1",
      instrument: "MNQ",
      side: "BUY",
      orderType: "LIMIT",
      quantity: 1,
      entry: 100,
      stop: 95,
      targets: [{ label: "T1", price: 110, ratioR: 2 }],
      expectedR: 2,
      status: "ENTRY_FILLED",
      latestEventType: "ENTRY_FILLED",
      latestEventAt: "2026-08-16T12:01:00.000Z",
      entryFilledAt: "2026-08-16T12:01:00.000Z",
      entryFillPrice: 100,
      exitAt: "",
      exitPrice: null,
      resultR: null,
      tradeId: "trade_poi_1",
      tradeStatus: "OPEN",
      sourceCandleAt: "2026-08-16T12:01:00.000Z",
      sourceTimeframe: "1",
      physicalExecutionCreated: false,
      brokerEvidence: "NONE",
    };
    const envelope = liveEnvelope({
      portfolioOrderIntents: [orderIntent()],
      canonicalRuntime: { pendingOrderIntents: [orderIntent()] },
      theoreticalExecution: {
        schemaVersion: "live_theoretical_execution_v1",
        availability: "KNOWN",
        status: "TRACKING_OPEN",
        source: "portfolio_order_intent_lineage+trade_theoretical_execution_events+trades",
        asOf: "2026-08-16T12:01:00.000Z",
        summary: { trackedIntents: 1, working: 0, entryFilled: 1, targetHit: 0, stopHit: 0, expired: 0, reviewRequired: 0, openTrades: 1, closedTrades: 0, totalClosedR: 0 },
        rows: [row],
      },
    });

    const model = toLiveTradingModel(envelope);

    expect(model.selectedTheoreticalExecution?.status).toBe("ENTRY_FILLED");
    expect(model.reconciliation.expected).toEqual(row);
    expect(model.timeline.some((event) => event.step === "THEORETICAL_EXECUTION")).toBe(true);
  });
});

function liveEnvelope(overrides: Record<string, unknown> = {}): LiveTradingEnvelope {
  const canonicalRuntime = (overrides.canonicalRuntime ?? {}) as Record<string, unknown>;
  const dataOverrides = { ...overrides };
  delete dataOverrides.canonicalRuntime;
  return {
    meta: {
      availability: "AVAILABLE",
      stale: false,
      asOf: "2026-08-16T12:00:00.000Z",
      warnings: [],
    },
    data: {
      canonicalRuntime: {
        latestSignals: [],
        pendingOrderIntents: [],
        pendingTargetPositions: [],
        activeStrategyInstances: [],
        aiContextGate: [],
        riskCenter: { availability: "KNOWN" },
        mode: {
          environment: "PAPER",
          executionMode: "SEMI_MANUAL",
          autoExecutionEnabled: false,
          physicalExecutionEnabled: false,
          humanGateRequired: true,
          ackIsFill: false,
        },
        freshness: { asOf: "2026-08-16T12:00:00.000Z" },
        ...canonicalRuntime,
      },
      signals: [],
      portfolioOrderIntents: [],
      providers: [],
      timeline: [],
      timeSeriesContracts: { asOf: "2026-08-16T12:00:00.000Z", series: [] },
      reconciliation: {
        availability: "NOT_APPLICABLE_CURRENT_MODE",
        status: "PHYSICAL_EXECUTION_DISABLED",
        broker: { availability: "NOT_APPLICABLE_CURRENT_MODE" },
        expected: null,
        mismatchCount: null,
        asOf: null,
      },
      ...dataOverrides,
    },
  } as unknown as LiveTradingEnvelope;
}

function orderIntent() {
  return {
    portfolioOrderIntentId: "poi_1",
    orderIntentId: "poi_1",
    targetPositionId: "target_1",
    symbol: "MNQ",
    side: "BUY",
    quantity: 1,
    type: "LIMIT",
    executionTerms: { entry: { price: 100 }, stop: { price: 95 }, targets: [{ price: 110 }], account_id: "paper" },
    riskSnapshot: { authorizedQty: 1 },
    humanGate: { status: "AWAITING_MANUAL_CONFIRMATION", allowedActions: [], gateId: "gate_1" },
    allowedActions: { allowedActions: [], denialReasons: [], expiresAt: null },
    route: "/order-intents/poi_1",
  };
}
