import { describe, expect, it } from "vitest";
import { portfolioView } from "@/mocks/canonicalDataset";

describe("portfolio golden slice contract", () => {
  it("contains every section required by the Portfolio View BFF contract", () => {
    expect(portfolioView.data.summary).toMatchObject({
      equity: expect.any(Number),
      grossExposureUsd: expect.any(Number),
      netExposureUsd: expect.any(Number),
      unrealizedPnl: expect.any(Number),
      riskUsedPct: expect.any(Number),
      correlatedExposurePct: expect.any(Number)
    });
    expect(portfolioView.data.summaryTruth.equity).toMatchObject({ state: "KNOWN", value: expect.any(Number) });
    expect(portfolioView.data.exposureTree.length).toBeGreaterThan(0);
    expect(portfolioView.data.brokerPositions.length).toBeGreaterThan(0);
    expect(portfolioView.data.virtualAllocations.length).toBeGreaterThan(0);
    expect(portfolioView.data.correlationMatrix.cells.length).toBeGreaterThan(0);
    expect(portfolioView.data.reconciliation.status).toBe("SYNCHRO");
    expect(portfolioView.data.attribution.items.length).toBeGreaterThan(0);
  });

  it("keeps broker positions and virtual allocations separate", () => {
    const brokerKeys = portfolioView.data.brokerPositions.map((position) => position.account);
    const allocationKeys = portfolioView.data.virtualAllocations.map((allocation) => allocation.strategyInstanceId);

    expect(brokerKeys).toContain("Sim101");
    expect(allocationKeys.every((key) => key.startsWith("strinst_"))).toBe(true);
  });
});
