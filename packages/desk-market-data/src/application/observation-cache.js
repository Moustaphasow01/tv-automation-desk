import { mergeObservedCandles, observedQuoteState } from "../domain/public-market-observation.js";

// This bounded, ephemeral projection has no persistence or execution port.
export class ObservationCache {
  quotes = new Map();
  series = new Map();

  acceptQuote(quote) {
    if (!quote) return;
    const previous = this.quotes.get(quote.instrument);
    if (previous && Date.parse(previous.asOf) > Date.parse(quote.asOf)) return;
    this.quotes.set(quote.instrument, Object.freeze({ ...quote }));
  }

  entry(key) {
    if (!this.series.has(key)) {
      if (this.series.size >= 21) throw new Error("CRYPTO_SCOPE_LIMIT");
      this.series.set(key, { bars: [], loadedAt: null, attemptedAt: null, error: null, pending: null });
    }
    return this.series.get(key);
  }

  acceptCandles(key, candles) {
    const entry = this.entry(key);
    entry.bars = mergeObservedCandles(entry.bars, candles);
  }

  quoteSnapshot({ markets, connected, now }) {
    return markets.map((market) => {
      const quote = this.quotes.get(market.instrument);
      return { instrument: market.instrument, ...(quote || {}), state: observedQuoteState({ connected, asOf: quote?.asOf, now }) };
    });
  }

  candleSnapshot(scope, now) {
    const entry = this.entry(scope.key);
    const bars = scope.mode === "live" ? entry.bars.slice(-2) : entry.bars;
    return {
      state: entry.error ? "ERROR" : entry.loadedAt === null ? "LOADING" : "READY",
      loadedAt: entry.loadedAt === null ? null : new Date(entry.loadedAt).toISOString(),
      bars: bars.map((bar) => ({ ...bar, forming: Date.parse(bar.timestamp) + scope.interval * 60_000 > now })),
    };
  }
}
