export type CryptoMarket = { instrument: string; label: string; base: string; quote: "USD"; pricePrecision: number };
export type CryptoQuote = { instrument: string; state: "LIVE" | "STALE" | "UNAVAILABLE"; last?: number; bid?: number; ask?: number; changePct?: number | null; asOf?: string; receivedAt?: string; pricePrecision?: number };
export type CryptoCandle = { timestamp: string; open: number; high: number; low: number; close: number; volume: number; vwap: null; source: "KRAKEN_SPOT"; forming: boolean };
export type CryptoMarketView = {
  schemaVersion: "public_crypto_observation_v1"; source: "KRAKEN_SPOT"; sourceClass: "EXTERNAL_OBSERVATION"; readOnly: true;
  asOf: string; instrument: string; timeframe: string; markets: CryptoMarket[]; timeframes: string[];
  feed: { state: "IDLE" | "CONNECTING" | "CONNECTED" | "RECONNECTING"; connected: boolean; exchange: string | null; lastFrameAt: string | null };
  quotes: CryptoQuote[]; history: null | { state: "LOADING" | "READY" | "ERROR"; loadedAt: string | null; bars: CryptoCandle[] };
};

export function isCryptoInstrument(instrument: string): boolean { return ["BTCUSD", "SOLUSD", "DOGEUSD"].includes(instrument); }
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const date = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const symbol = (value: unknown): value is string => typeof value === "string" && isCryptoInstrument(value);
const precision = (value: unknown): value is number => finite(value) && Number.isInteger(value) && value >= 0 && value <= 10;

export function isCryptoMarketView(value: unknown): value is CryptoMarketView {
  return object(value) && isObservationIdentity(value) && isScope(value)
    && isMarketTriple(value.markets, isMarket) && isMarketTriple(value.quotes, isQuote)
    && isFeed(value.feed) && isHistory(value.history);
}

function isObservationIdentity(value: Record<string, unknown>) {
  return value.schemaVersion === "public_crypto_observation_v1" && value.source === "KRAKEN_SPOT" && value.sourceClass === "EXTERNAL_OBSERVATION" && value.readOnly === true;
}

function isScope(value: Record<string, unknown>) {
  return symbol(value.instrument) && date(value.asOf) && typeof value.timeframe === "string" && Array.isArray(value.timeframes)
    && value.timeframes.includes(value.timeframe) && value.timeframes.every((unit) => typeof unit === "string" && ["1", "5", "15", "30", "1H", "4H", "1D"].includes(unit));
}

function isMarketTriple<T extends { instrument: string }>(value: unknown, validator: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.length === 3 && value.every(validator) && new Set(value.map((item) => item.instrument)).size === 3;
}

function isFeed(value: unknown) {
  return object(value) && ["IDLE", "CONNECTING", "CONNECTED", "RECONNECTING"].includes(String(value.state)) && typeof value.connected === "boolean"
    && (value.exchange === null || typeof value.exchange === "string") && (value.lastFrameAt === null || date(value.lastFrameAt));
}

function isHistory(value: unknown) {
  return value === null || (object(value) && ["LOADING", "READY", "ERROR"].includes(String(value.state)) && (value.loadedAt === null || date(value.loadedAt))
    && Array.isArray(value.bars) && value.bars.length <= 720 && value.bars.every(isCandle));
}

function isMarket(value: unknown): value is CryptoMarket {
  return object(value) && symbol(value.instrument) && typeof value.label === "string" && typeof value.base === "string" && value.quote === "USD" && precision(value.pricePrecision);
}

function isQuote(value: unknown): value is CryptoQuote {
  if (!object(value) || !symbol(value.instrument)) return false;
  if (value.state === "UNAVAILABLE") return value.last === undefined;
  return ["LIVE", "STALE"].includes(String(value.state)) && [value.last, value.bid, value.ask].every((price) => finite(price) && price > 0)
    && Number(value.bid) <= Number(value.ask) && date(value.asOf) && date(value.receivedAt) && precision(value.pricePrecision) && (value.changePct === null || finite(value.changePct));
}

function isCandle(value: unknown): value is CryptoCandle {
  return object(value) && date(value.timestamp) && [value.open, value.high, value.low, value.close].every((price) => finite(price) && price > 0)
    && Number(value.low) <= Math.min(Number(value.open), Number(value.close)) && Number(value.high) >= Math.max(Number(value.open), Number(value.close))
    && finite(value.volume) && value.volume >= 0 && value.vwap === null && value.source === "KRAKEN_SPOT" && typeof value.forming === "boolean";
}
