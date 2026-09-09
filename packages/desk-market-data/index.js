import { ObservationCache } from "./src/application/observation-cache.js";
import { KrakenHistory } from "./src/adapter/kraken-history.js";
import { KrakenStream } from "./src/adapter/kraken-stream.js";
import { CRYPTO_INTERVALS, KRAKEN_MARKETS, cryptoScope } from "./src/adapter/kraken-public-contract.js";

export function createPublicCryptoObservation({ now, fetch = globalThis.fetch, WebSocket = globalThis.WebSocket }) {
  if (typeof now !== "function") throw new Error("OBSERVATION_CLOCK_REQUIRED");
  const cache = new ObservationCache();
  const history = new KrakenHistory({ cache, now, fetch });
  const stream = new KrakenStream({ cache, now, WebSocket });
  return {
    async read(input = {}) {
      const scope = cryptoScope(input);
      stream.touch(scope);
      if (scope.mode === "history") await history.ensure(scope);
      if (scope.mode === "live") void history.ensure(scope);
      const time = now();
      const feed = stream.snapshot();
      return {
        schemaVersion: "public_crypto_observation_v1", source: "KRAKEN_SPOT", sourceClass: "EXTERNAL_OBSERVATION", readOnly: true,
        asOf: new Date(time).toISOString(), instrument: scope.market.instrument, timeframe: scope.timeframe,
        markets: KRAKEN_MARKETS.map(({ restPair: _rest, symbol: _symbol, ...market }) => ({ ...market })),
        timeframes: Object.keys(CRYPTO_INTERVALS), feed,
        quotes: cache.quoteSnapshot({ markets: KRAKEN_MARKETS, connected: feed.connected, now: time }),
        history: ["history", "live"].includes(scope.mode) ? cache.candleSnapshot(scope, time) : null,
      };
    },
    dispose() { stream.dispose(); },
  };
}
