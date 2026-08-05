import { toParisIso } from "@tv-automation/desk-time";

export function parisMarketSessionState(now = new Date()) {
  const epochMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  if (!Number.isFinite(epochMs)) throw new Error("invalid_market_session_timestamp");
  const timestampParis = toParisIso(epochMs);
  const tradingDate = timestampParis.slice(0, 10);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    weekday: "short",
  }).format(new Date(epochMs));
  const marketClosed = weekday === "Sat" || weekday === "Sun";
  return {
    timestamp_paris: timestampParis,
    trading_date: tradingDate,
    weekday,
    market_closed: marketClosed,
    state: marketClosed ? "market_closed" : "trading_day",
  };
}

