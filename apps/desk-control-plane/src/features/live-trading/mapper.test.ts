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
});
