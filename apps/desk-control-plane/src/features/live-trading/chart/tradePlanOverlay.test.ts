import { describe, expect, it } from "vitest";
import { instrumentCode, tradePlanOverlayFromIntent, visibleTradeOverlay, type TradeOverlay } from "./tradePlanOverlay";

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

  it("treats a continuous TradingView symbol and its desk root as the same instrument identity", () => {
    const intent = {
      symbol: "ZW1!",
      side: "BUY",
      limitPrice: 612.25,
      stopPrice: 607.25,
      targetPrice: 622.25,
      executionTerms: { instrument: "ZW1!" },
      allowedActions: { expiresAt: null },
      humanGate: { status: "AWAITING_MANUAL_CONFIRMATION" },
      createdAt: "2026-08-29T12:00:00.000Z",
    } as never;

    expect(instrumentCode(intent)).toBe("ZW");
    expect(tradePlanOverlayFromIntent(intent)?.instrument).toBe("ZW");
  });
});
