import { describe, expect, it } from "vitest";
import { focusTradePlan } from "@/features/live-trading/focusTradePlan";
import { toLiveTradingModel } from "@/features/live-trading/mapper";
import type { LiveTradingModel } from "@/features/live-trading/model";
import { liveTradingView } from "@/mocks/canonicalDataset";

function model(): LiveTradingModel {
  return toLiveTradingModel(structuredClone(liveTradingView));
}

describe("focus trade plan authority", () => {
  it("shows signal levels as a proposal without enabling execution", () => {
    const base = model();
    const view: LiveTradingModel = {
      ...base,
      selectedTheoreticalExecution: null,
      orderIntent: null,
      selectedSignalPlan: {
        orderType: "LIMIT",
        entry: "753,75 – 754,25",
        stop: "752,25",
        targets: ["TP1 756,75", "TP2 758,00"],
        expectedR: "+1,57 R",
        rewardRisk: "1,57 : 1",
        expiresAt: "2026-08-30T20:05:00Z",
        sourceCutoffAt: "2026-08-30T19:20:00Z",
        source: "Signal",
      },
    };

    expect(focusTradePlan(view)).toMatchObject({
      authority: "PROPOSED",
      authorityLabel: "Niveaux proposés — en attente d’autorisation",
      actionable: false,
      quantity: "Non publiée",
      entry: "753,75 – 754,25",
      stop: "752,25",
      targets: ["756,75", "758,00"],
    });
  });

  it("only makes the risk-authorized complete plan actionable", () => {
    const base = model();
    const view: LiveTradingModel = {
      ...base,
      gateActions: [{
        action: "CONFIRM",
        actionId: "confirm-intent-risk-authorized",
        label: "Confirmer",
        commandType: "CONFIRM_ORDER_INTENT",
        environment: "PAPER",
        permission: "ALLOWED",
        requiresConfirmation: true,
        requiresReason: false,
        expectedRevision: "1",
        impactPreview: "Valider le dossier en semi-manuel.",
        payload: {},
      }],
      selectedTheoreticalExecution: {
        portfolioOrderIntentId: "intent-risk-authorized",
        targetPositionId: "target-risk-authorized",
        strategySignalId: "signal-risk-authorized",
        strategyId: "strategy-grains",
        strategyInstanceId: "instance-grains",
        instrument: "ZW",
        side: "LONG",
        orderType: "LIMIT",
        quantity: 2,
        entry: 754,
        stop: 752.25,
        targets: [{ label: "T1", price: 756.75, ratioR: 1 }, { label: "T2", price: 758, ratioR: 1.57 }],
        expectedR: 1.57,
        status: "READY",
        latestEventType: "RISK_AUTHORIZED",
        latestEventAt: "2026-08-30T19:20:00Z",
        entryFilledAt: "",
        entryFillPrice: null,
        exitAt: "",
        exitPrice: null,
        resultR: null,
        tradeId: "trade-risk-authorized",
        tradeStatus: "PENDING_ENTRY",
        sourceCandleAt: "2026-08-30T19:15:00Z",
        sourceTimeframe: "5",
        physicalExecutionCreated: false,
        brokerEvidence: "NONE",
      },
    };

    expect(focusTradePlan(view)).toMatchObject({ authority: "AUTHORIZED", actionable: true, quantity: "2" });
  });

  it("keeps a complete but expired authorized plan non-actionable", () => {
    const base = model();
    const view: LiveTradingModel = {
      ...base,
      meta: { ...base.meta, asOf: "2026-08-30T20:10:00Z" },
      orderIntent: {
        portfolioOrderIntentId: "intent-expired",
        orderIntentId: "intent-expired",
        signalId: "signal-expired",
        strategyInstanceId: "instance-grains",
        symbol: "ZW",
        side: "BUY",
        type: "LIMIT",
        quantity: 2,
        state: "AWAITING_MANUAL_CONFIRMATION",
        limitPrice: 754,
        stopPrice: 752.25,
        targetPrice: 756.75,
        targetPositionId: "target-expired",
        createdAt: "2026-08-30T19:20:00Z",
        executionTerms: {},
        riskSnapshot: {},
        immutability: {},
        humanGate: { gateId: "gate-expired", status: "AWAITING_MANUAL_CONFIRMATION", allowedActions: [] },
        allowedActions: {
          resourceType: "OrderIntent",
          allowedActions: ["CONFIRM"],
          denialReasons: [],
          revision: "1",
          requiresStepUp: false,
          reasonRequired: false,
          expiresAt: "2026-08-30T20:05:00Z",
        },
        providerCommandCount: 0,
        providerEventCount: 0,
        brokerSubmissionAllowed: false,
        physicalExecutionState: "NOT_SENT",
        ackIsFill: false,
        route: "/execution/orders/intent-expired",
      } as unknown as NonNullable<LiveTradingModel["orderIntent"]>,
      gateActions: [{
        action: "CONFIRM",
        actionId: "confirm-expired",
        label: "Confirmer",
        commandType: "CONFIRM_ORDER_INTENT",
        environment: "PAPER",
        permission: "ALLOWED",
        requiresConfirmation: true,
        requiresReason: false,
        expectedRevision: "1",
        impactPreview: "Valider le dossier en semi-manuel.",
        payload: {},
      }],
      selectedTheoreticalExecution: {
        portfolioOrderIntentId: "intent-expired",
        targetPositionId: "target-expired",
        strategySignalId: "signal-expired",
        strategyId: "strategy-grains",
        strategyInstanceId: "instance-grains",
        instrument: "ZW",
        side: "LONG",
        orderType: "LIMIT",
        quantity: 2,
        entry: 754,
        stop: 752.25,
        targets: [{ label: "T1", price: 756.75, ratioR: 1 }],
        expectedR: 1,
        status: "READY",
        latestEventType: "RISK_AUTHORIZED",
        latestEventAt: "2026-08-30T19:20:00Z",
        entryFilledAt: "",
        entryFillPrice: null,
        exitAt: "",
        exitPrice: null,
        resultR: null,
        tradeId: "trade-expired",
        tradeStatus: "PENDING_ENTRY",
        sourceCandleAt: "2026-08-30T19:15:00Z",
        sourceTimeframe: "5",
        physicalExecutionCreated: false,
        brokerEvidence: "NONE",
      },
    };

    expect(focusTradePlan(view)).toMatchObject({ authority: "AUTHORIZED", actionable: false, quantity: "2" });
  });
});
