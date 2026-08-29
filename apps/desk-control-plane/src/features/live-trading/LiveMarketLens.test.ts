import { describe, expect, it } from "vitest";
import { prioritizedWatchlist } from "./LiveMarketLens";

describe("Live market watchlist", () => {
  it("prioritizes the chart and signal instruments without hardcoding an asset family", () => {
    const model = {
      marketSeries: { instrument: "ZW" },
      latestSignal: { symbol: "ZC" },
      source: { signals: [{ symbol: "ZC" }], canonicalRuntime: { latestSignals: [] } },
      watchlist: [
        { symbol: "AAPL" },
        { symbol: "MES" },
        { symbol: "ZC" },
        { symbol: "ZW" },
      ],
    } as never;
    expect(prioritizedWatchlist(model).map((item) => item.symbol)).toEqual(["ZW", "ZC", "AAPL", "MES"]);
  });
});
