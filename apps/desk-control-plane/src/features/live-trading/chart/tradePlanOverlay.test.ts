import { describe, expect, it } from "vitest";
import { visibleTradeOverlay, type TradeOverlay } from "./tradePlanOverlay";

const plan: TradeOverlay = {
  source: "SIGNAL",
  label: "Plan",
  instrument: "ZC",
  side: "LONG",
  entry: 500,
  stop: 490,
  targets: [{ label: "T1", price: 510 }, { label: "T2", price: 900 }],
};

describe("trade plan scale safety", () => {
  it("preserves valid levels when one target is aberrant", () => {
    const result = visibleTradeOverlay(plan, 480, 520);
    expect(result.hiddenLevelCount).toBe(1);
    expect(result.overlay?.entry).toBe(500);
    expect(result.overlay?.stop).toBe(490);
    expect(result.overlay?.targets).toEqual([{ label: "T1", price: 510 }]);
  });

  it("hides the entire plan when its entry cannot belong to the visible market", () => {
    const result = visibleTradeOverlay({ ...plan, entry: 900 }, 480, 520);
    expect(result.overlay).toBeNull();
    expect(result.hiddenLevelCount).toBe(4);
  });
});
