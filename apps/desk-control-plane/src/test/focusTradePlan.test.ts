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
});
