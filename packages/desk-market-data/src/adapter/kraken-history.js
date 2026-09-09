import { krakenRestCandles } from "./kraken-public-contract.js";

export class KrakenHistory {
  active = 0;
  waiting = [];

  constructor({ cache, now, fetch }) { Object.assign(this, { cache, now, fetch }); }

  async ensure(scope) {
    const entry = this.cache.entry(scope.key);
    if (entry.pending) return entry.pending;
    if (entry.loadedAt !== null && this.now() - entry.loadedAt < 60_000) return;
    if (entry.error && this.now() - entry.attemptedAt < 30_000) return;
    entry.pending = this.load(scope, entry).finally(() => { entry.pending = null; });
    return entry.pending;
  }

  async load(scope, entry) {
    if (this.active >= 2) await new Promise((resolve) => this.waiting.push(resolve));
    this.active += 1;
    entry.attemptedAt = this.now();
    const before = entry.bars;
    try {
      const url = new URL("https://api.kraken.com/0/public/OHLC");
      url.searchParams.set("pair", scope.market.restPair);
      url.searchParams.set("interval", String(scope.interval));
      const response = await this.fetch(url, { signal: AbortSignal.timeout(8_000), redirect: "error" });
      if (!response.ok) throw new Error("CRYPTO_HISTORY_HTTP");
      const bars = krakenRestCandles(await response.json(), this.now());
      if (!bars.length) throw new Error("CRYPTO_HISTORY_EMPTY");
      // Preserve only stream changes received after REST started, not an old cached current bar.
      const changes = entry.bars.filter((bar) => !before.includes(bar));
      this.cache.acceptCandles(scope.key, bars);
      this.cache.acceptCandles(scope.key, changes);
      entry.loadedAt = this.now();
      entry.error = null;
    } catch {
      entry.error = "CRYPTO_HISTORY_UNAVAILABLE";
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}
