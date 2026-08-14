import { describe, expect, it } from "vitest";
import { canonicalViewDataset } from "@/mocks/canonicalDataset";

describe("canonicalViewDataset", () => {
  it("keeps portfolio, live and strategy ids coherent across views", () => {
    const portfolioStrategyIds = new Set(
      canonicalViewDataset.portfolio.data.positions.map((position) => position.strategyInstanceId)
    );
    const liveSignal = canonicalViewDataset["live-trading"].data.signals[0];

    expect(portfolioStrategyIds.has(liveSignal.strategyInstanceId)).toBe(true);
    expect(canonicalViewDataset["strategy-center"].data.strategies[0].strategyId).toBe("str_breakout_retest");
  });

  it("shares correlation metadata across VNext views", () => {
    const correlationIds = Object.values(canonicalViewDataset).map((view) => view.meta.correlationId);

    expect(new Set(correlationIds)).toEqual(new Set(["corr_vnext_demo_20260810_0940"]));
  });
});
