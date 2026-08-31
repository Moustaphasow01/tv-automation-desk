import assert from "node:assert/strict";
import test from "node:test";
import { marketFeedSymbol } from "../src/desk-market-feature-algorithms.js";
import { liveSession, liveSummary, liveWatchlist } from "../src/front-live-trading-support.js";

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

test("live summary distinguishes configured risk from actually consumed risk", () => {
  const result = liveSummary({
    signals: [], intents: [], commands: [], events: [],
    safety: { riskPercent: 0.25 },
    risk: { summary: { risk_percent: 0.25 } },
  });

  assert.equal(result.riskConfiguredPct, 0.25);
  assert.equal(result.riskUsedPct, null);
});

test("live session translates the authoritative CBOT readiness projection without a local Asia fallback", () => {
  const result = liveSession({
    execution: {},
    liveSession: null,
    scope: { session: "asia_open", trading_date: "2026-08-31" },
    launchGate: {},
    health: { data_readiness: { active_session: "CBOT_GRAINS_PREOPEN", exchange_timezone: "America/Chicago", next_eligible_at_utc: "2026-08-31T13:30:00.000Z" } },
    marketSeries: null,
    marketDataStatus: () => "LAST_KNOWN",
  });

  assert.equal(result.phase, "CBOT_GRAINS_PREOPEN");
  assert.equal(result.activeSession, "CBOT_GRAINS_PREOPEN");
  assert.equal(result.exchangeTimezone, "America/Chicago");
  assert.equal(result.nextMonitorAt, "2026-08-31T13:30:00.000Z");
});
