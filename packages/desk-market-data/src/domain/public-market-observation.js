export function validMarketTime(value, now) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= now + 30000;
}

export function validateObservedQuote(value, now) {
  const prices = [value.last, value.bid, value.ask];
  if (!prices.every((price) => typeof price === "number" && Number.isFinite(price) && price > 0)) return null;
  if (value.bid > value.ask || !validMarketTime(value.asOf, now)) return null;
  return { ...value, changePct: Number.isFinite(value.changePct) ? value.changePct : null, receivedAt: new Date(now).toISOString() };
}

export function validateObservedCandle(value, now) {
  if (!validMarketTime(value.timestamp, now)) return null;
  if (![value.open, value.high, value.low, value.close, value.volume].every((item) => typeof item === "number" && Number.isFinite(item))) return null;
  if (value.low <= 0 || value.volume < 0 || value.high < Math.max(value.open, value.close, value.low) || value.low > Math.min(value.open, value.close)) return null;
  return { ...value, vwap: null };
}

export function mergeObservedCandles(previous, incoming, limit = 720) {
  const rows = new Map(previous.map((row) => [row.timestamp, row]));
  for (const row of incoming) rows.set(row.timestamp, row);
  return [...rows.values()].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp)).slice(-limit);
}

export function observedQuoteState({ connected, asOf, now }) {
  if (!asOf) return "UNAVAILABLE";
  return connected && validMarketTime(asOf, now) && now - Date.parse(asOf) <= 30000 ? "LIVE" : "STALE";
}
