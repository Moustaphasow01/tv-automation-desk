import { describe, expect, it } from "vitest";
import { buildSignalDecisionSupport } from "./signalDecisionSupport";

describe("signal decision support", () => {
  it("uses only published market, signal and theoretical outcome facts", () => {
    const model = {
      latestSignal: { signalId: "sig-1", strategyId: "strat-1", direction: "LONG", symbol: "ZW", rewardRisk: 2, createdAt: "2026-08-29T14:00:00Z", expiresAt: "2026-08-29T14:30:00Z", proposedTradePlan: { entry: { price: 520 } } },
      marketSeries: { points: [{ close: 522 }] },
      source: {
        signals: [
          { signalId: "sig-1", strategyId: "strat-1", createdAt: "2026-08-29T14:00:00Z", expiresAt: "2026-08-29T14:30:00Z" },
          { signalId: "sig-2", strategyId: "strat-1", createdAt: "2026-08-28T14:00:00Z", expiresAt: "2026-08-28T14:40:00Z" },
        ],
        canonicalRuntime: { latestSignals: [] },
        arbitrations: [{ signalId: "sig-1", conflictStatus: "CLEAR" }],
        positions: [],
      },
      theoreticalExecution: { rows: [{ strategySignalId: "sig-2", resultR: 1.5 }] },
    } as never;

    const support = buildSignalDecisionSupport(model);
    expect(support.distanceToEntryPoints).toBe(2);
    expect(support.averageWindowMinutes).toBe(35);
    expect(support.setupHistory).toMatchObject({ occurrences: 2, wins: 1, hitRatePct: 100, averageResultR: 1.5 });
    expect(support.conflict.status).toBe("CLEAR");
  });

  it("preserves unpublished values instead of inventing zero", () => {
    const model = {
      latestSignal: null,
      marketSeries: { points: [] },
      source: { signals: [], canonicalRuntime: { latestSignals: [] }, arbitrations: [], positions: [] },
      theoreticalExecution: null,
    } as never;
    const support = buildSignalDecisionSupport(model);
    expect(support.currentPrice).toBeNull();
    expect(support.distanceToEntryPoints).toBeNull();
    expect(support.averageWindowMinutes).toBeNull();
    expect(support.conflict.status).toBe("NOT_PUBLISHED");
  });
});
