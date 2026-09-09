import { validateObservedCandle, validateObservedQuote } from "../domain/public-market-observation.js";

export const KRAKEN_MARKETS = Object.freeze([
  { instrument: "BTCUSD", label: "Bitcoin", base: "BTC", quote: "USD", symbol: "BTC/USD", restPair: "XBTUSD", pricePrecision: 1 },
  { instrument: "SOLUSD", label: "Solana", base: "SOL", quote: "USD", symbol: "SOL/USD", restPair: "SOLUSD", pricePrecision: 2 },
  { instrument: "DOGEUSD", label: "Dogecoin", base: "DOGE", quote: "USD", symbol: "DOGE/USD", restPair: "XDGUSD", pricePrecision: 7 },
].map(Object.freeze));
export const CRYPTO_INTERVALS = Object.freeze({ "1": 1, "5": 5, "15": 15, "30": 30, "1H": 60, "4H": 240, "1D": 1440 });

export function cryptoScope(input) {
  const mode = input.mode || "quotes";
  if (!["catalog", "quotes", "history", "live"].includes(mode)) throw invalidScope();
  const instrument = String(input.instrument || "BTCUSD").toUpperCase();
  const market = KRAKEN_MARKETS.find((item) => item.instrument === instrument);
  const timeframe = String(input.timeframe || "5").toUpperCase();
  if (!market || !Object.hasOwn(CRYPTO_INTERVALS, timeframe)) throw invalidScope();
  return { mode, market, timeframe, interval: CRYPTO_INTERVALS[timeframe], key: `${instrument}:${timeframe}` };
}

export function krakenQuote(raw, now) {
  const market = KRAKEN_MARKETS.find((item) => item.symbol === raw.symbol);
  return market ? validateObservedQuote({ instrument: market.instrument, last: raw.last, bid: raw.bid, ask: raw.ask, changePct: raw.change_pct, asOf: raw.timestamp, pricePrecision: market.pricePrecision }, now) : null;
}

export function krakenCandle(raw, now) {
  return validateObservedCandle({ timestamp: raw.interval_begin, open: raw.open, high: raw.high, low: raw.low, close: raw.close, volume: raw.volume, source: "KRAKEN_SPOT" }, now);
}

export function krakenRestCandles(body, now) {
  if (!body || !Array.isArray(body.error) || body.error.length || !body.result) throw new Error("CRYPTO_HISTORY_INVALID");
  const values = Object.entries(body.result).filter(([key]) => key !== "last");
  if (values.length !== 1 || !Array.isArray(values[0][1])) throw new Error("CRYPTO_HISTORY_INVALID");
  return values[0][1].slice(-720).flatMap((row) => {
    if (!Array.isArray(row) || row.length < 8 || ![0, 1, 2, 3, 4, 6].every((index) => typeof row[index] === "number" || (typeof row[index] === "string" && row[index].trim() !== ""))) return [];
    if (!Number.isFinite(Number(row[0])) || Number(row[0]) < 0 || Number(row[0]) * 1000 > now + 30_000) return [];
    const candle = validateObservedCandle({ timestamp: new Date(Number(row[0]) * 1000).toISOString(), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[6]), source: "KRAKEN_SPOT" }, now);
    return candle ? [candle] : [];
  });
}

function invalidScope() { return Object.assign(new Error("Unsupported public crypto market scope"), { code: "FRONT_CRYPTO_SCOPE_INVALID", statusCode: 400 }); }
