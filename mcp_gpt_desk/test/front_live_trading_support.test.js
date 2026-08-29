import assert from "node:assert/strict";
import test from "node:test";
import { marketFeedSymbol } from "../src/desk-market-feature-algorithms.js";
import { liveWatchlist } from "../src/front-live-trading-support.js";

test("grain market aliases resolve to the TradingView continuous contracts", () => {
  assert.equal(marketFeedSymbol("ZC"), "ZC1!");
  assert.equal(marketFeedSymbol("ZW"), "ZW1!");
});

test("live watchlist follows active strategy instruments without keeping unrelated historical symbols", () => {
  const snapshot = {
    instruments: {
      corn: { symbol: "ZC1!", latest_close: 512.5, change_pct: 0.4, intraday_series: [{ close: 512 }], latest_timestamp_paris: "2026-08-28T20:15:00+02:00", availability: "LAST_CLOSED_SESSION" },
      wheat: { symbol: "ZW1!", latest_close: 754, change_pct: -0.2, intraday_series: [{ close: 754 }], latest_timestamp_paris: "2026-08-28T20:15:00+02:00", availability: "LAST_CLOSED_SESSION" },
      nasdaq: { symbol: "MNQ", latest_close: 29494.25, change_pct: -0.3, intraday_series: [{ close: 29494.25 }], latest_timestamp_paris: "2026-08-28T20:19:00+02:00", availability: "LAST_CLOSED_SESSION" },
    },
  };

  const result = liveWatchlist(snapshot, { preferredSymbols: ["ZW", "ZC"] });

  assert.deepEqual(result.map((item) => item.symbol), ["ZC", "ZW"]);
  assert.equal(result.some((item) => item.symbol === "MNQ"), false);
});
