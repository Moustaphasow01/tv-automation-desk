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
        pendingTargetPositions: [{ targetPositionId: "target_1", targetNetSize: 1, deltaSize: 1 }],
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
    expect(model.timeline).toEqual([]);
    expect(model.signalFunnel.totalClosedR).toBeNull();
  });

  it("uses only the backend audit timeline and never derives events from runtime objects", () => {
    const envelope = liveEnvelope({
      portfolioOrderIntents: [orderIntent()],
      canonicalRuntime: { pendingOrderIntents: [orderIntent()] },
      timeline: [],
    });

    expect(toLiveTradingModel(envelope).timeline).toEqual([]);
  });

  it("does not present signal confidence or expiry as market-context evidence", () => {
    const signal = {
      signalId: "sig_context_truth",
      strategyId: "strategy_1",
      strategyInstanceId: "instance_1",
      symbol: "MNQ",
      direction: "LONG",
      state: "NEW",
      confidence: 91,
      reasonCodes: ["SIGNAL_ONLY_REASON"],
      createdAt: "2026-08-16T12:00:00.000Z",
      expiresAt: "2026-08-16T12:15:00.000Z",
    };
    const envelope = liveEnvelope({
      signals: [signal],
      canonicalRuntime: { latestSignals: [signal], aiContextGate: [] },
    });

    const context = toLiveTradingModel(envelope).marketIntelligence;

    expect(context.confidence).toBeNull();
    expect(context.validUntil).toBeNull();
    expect(context.reasonCodes).not.toContain("SIGNAL_ONLY_REASON");
  });

  it("preserves unpublished nullable context metrics instead of converting them to zero", () => {
    const signal = strategySignal("sig_nullable", "MNQ", "2026-08-16T12:00:00.000Z");
    const envelope = liveEnvelope({
      signals: [signal],
      canonicalRuntime: {
        latestSignals: [signal],
        aiContextGate: [{
          decisionId: "ctx_nullable",
          signalId: "sig_nullable",
          status: "RECORDED",
          mode: "SHADOW",
          recommendation: "WAIT",
          confidence: null,
          riskMultiplier: null,
          reasonCodes: [],
          anomalies: [],
          decidedAt: "2026-08-16T12:01:00.000Z",
        }],
      },
    });

    const model = toLiveTradingModel(envelope);

    expect(model.latestContextDecision?.decisionId).toBe("ctx_nullable");
    expect(model.marketIntelligence.confidence).toBeNull();
    expect(model.marketIntelligence.riskMultiplier).toBeNull();
  });

  it("preserves an unpublished Risk utilization percentage as null", () => {
    const signal = strategySignal("sig_risk_nullable", "ZC", "2026-08-16T12:00:00.000Z");
    const envelope = liveEnvelope({
      signals: [signal],
      riskChecks: [{
        riskCheckId: "risk_nullable",
        signalId: signal.signalId,
        status: "PASS",
        limitLabel: "Per-trade risk",
        usedPct: null,
        reasonCode: "RISK_VALUE_NOT_PUBLISHED",
      }],
      canonicalRuntime: { latestSignals: [signal] },
    });

    expect(toLiveTradingModel(envelope).riskCheck?.usedPct).toBeNull();
  });

  it("selects the StrategySignal linked by the OrderIntent instead of a newer unrelated signal", () => {
    const linked = strategySignal("sig_linked", "MNQ", "2026-08-16T12:00:00.000Z");
    const unrelated = strategySignal("sig_unrelated", "ZW", "2026-08-16T12:05:00.000Z");
    const intent = { ...orderIntent(), signalId: linked.signalId };
    const envelope = liveEnvelope({
      signals: [unrelated, linked],
      portfolioOrderIntents: [intent],
      marketSeries: { instrument: "ZW", supportedTimeframes: [], points: [] },
      canonicalRuntime: { latestSignals: [unrelated, linked], pendingOrderIntents: [intent] },
    });

    const model = toLiveTradingModel(envelope);

    expect(model.orderIntent?.signalId).toBe("sig_linked");
    expect(model.latestSignal?.signalId).toBe("sig_linked");
  });

  it("keeps a pinned signal's confirmed OrderIntent ahead of an unrelated pending intent", () => {
    const selected = strategySignal("sig_confirmed", "ZC", "2026-08-16T12:00:00.000Z");
    const unrelated = strategySignal("sig_pending", "ZW", "2026-08-16T12:05:00.000Z");
    const confirmedIntent = {
      ...orderIntent(),
      portfolioOrderIntentId: "poi_confirmed",
      orderIntentId: "poi_confirmed",
      signalId: selected.signalId,
      symbol: "ZC",
      humanGate: { status: "CONFIRMED", allowedActions: [], gateId: "gate_confirmed" },
    };
    const pendingIntent = {
      ...orderIntent(),
      portfolioOrderIntentId: "poi_pending",
      orderIntentId: "poi_pending",
      signalId: unrelated.signalId,
      symbol: "ZW",
      humanGate: { status: "AWAITING_MANUAL_CONFIRMATION", allowedActions: [], gateId: "gate_pending" },
    };
    const envelope = liveEnvelope({
      signals: [unrelated, selected],
      portfolioOrderIntents: [pendingIntent, confirmedIntent],
      canonicalRuntime: {
        latestSignals: [unrelated, selected],
        pendingOrderIntents: [pendingIntent, confirmedIntent],
      },
    });

    const model = toLiveTradingModel(envelope, { signalId: selected.signalId });

    expect(model.latestSignal?.signalId).toBe(selected.signalId);
    expect(model.orderIntent?.portfolioOrderIntentId).toBe("poi_confirmed");
    expect(model.orderIntent?.humanGate.status).toBe("CONFIRMED");
  });

  it("fails closed when an OrderIntent has no matching StrategySignal", () => {
    const unrelated = strategySignal("sig_unrelated", "ZW", "2026-08-16T12:05:00.000Z");
    const intent = { ...orderIntent(), signalId: "sig_missing" };
    const envelope = liveEnvelope({
      signals: [unrelated],
      portfolioOrderIntents: [intent],
      canonicalRuntime: { latestSignals: [unrelated], pendingOrderIntents: [intent] },
    });

    expect(toLiveTradingModel(envelope).latestSignal).toBeNull();
  });

  it("does not borrow same-instrument lineage when a different signal dossier is pinned", () => {
    const selected = strategySignal("sig_selected", "ZC", "2026-08-16T12:05:00.000Z");
    const unrelated = strategySignal("sig_unrelated", "ZC", "2026-08-16T12:00:00.000Z");
    const intent = { ...orderIntent(), signalId: unrelated.signalId, symbol: "ZC" };
    const envelope = liveEnvelope({
      signals: [selected, unrelated],
      portfolioOrderIntents: [intent],
      canonicalRuntime: {
        latestSignals: [selected, unrelated],
        pendingOrderIntents: [intent],
        pendingTargetPositions: [{ targetPositionId: "target_1", signalId: unrelated.signalId, instrument: "ZC" }],
      },
      theoreticalExecution: {
        schemaVersion: "live_theoretical_execution_v1",
        availability: "KNOWN",
        status: "TRACKING_OPEN",
        source: "test",
        asOf: "2026-08-16T12:06:00.000Z",
        rows: [{
          portfolioOrderIntentId: intent.portfolioOrderIntentId,
          strategySignalId: unrelated.signalId,
          instrument: "ZC",
          side: "BUY",
          status: "ENTRY_FILLED",
          tradeId: "trade_unrelated",
        }],
      },
    });

    const model = toLiveTradingModel(envelope, { signalId: selected.signalId });

    expect(model.latestSignal?.signalId).toBe(selected.signalId);
    expect(model.orderIntent).toBeNull();
    expect(model.targetPosition).toBeNull();
    expect(model.selectedTheoreticalExecution).toBeNull();
    expect(model.gateActions).toEqual([]);
  });

  it("distinguishes an expired Human Gate dossier from one awaiting confirmation", () => {
    const expiredIntent = {
      ...orderIntent(),
      humanGate: { status: "EXPIRED", allowedActions: [], gateId: "gate_1" },
    };
    const envelope = liveEnvelope({
      portfolioOrderIntents: [expiredIntent],
      canonicalRuntime: { pendingOrderIntents: [expiredIntent] },
    });

    const operator = toLiveTradingModel(envelope).operator;

    expect(operator.status).toBe("ORDER_INTENT_RECORDED");
    expect(operator.label).toBe("Dossier expiré");
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
    signalId: "sig_1",
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

function strategySignal(signalId: string, symbol: string, createdAt: string) {
  return {
    signalId,
    strategyId: "strategy_1",
    strategyInstanceId: "instance_1",
    symbol,
    direction: "LONG",
    state: "NEW",
    confidence: 70,
    reasonCodes: [],
    createdAt,
    expiresAt: "2026-08-16T12:15:00.000Z",
  };
}
