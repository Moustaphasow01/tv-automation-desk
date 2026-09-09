import { createPublicCryptoObservation } from "@tv-automation/desk-market-data";
import { SystemClock } from "@tv-automation/desk-time";

const clock = new SystemClock();
// One public stream per API process, shared under the host's existing read policy.
let observation;

export async function loadFrontPublicCryptoMarket(query = {}) {
  const started = Date.parse(clock.now().utc);
  observation ??= createPublicCryptoObservation({ now: () => Date.parse(clock.now().utc) });
  const data = await observation.read(query);
  const live = data.quotes.filter((quote) => quote.state === "LIVE").length;
  return {
    meta: {
      generatedAt: data.asOf, asOf: data.asOf, stale: live !== data.markets.length, latencyMs: Math.max(0, Date.parse(data.asOf) - started),
      correlationId: `crypto-observation:${data.asOf}`, schemaVersion: "1.0.0",
      availability: live === data.markets.length ? "AVAILABLE" : live ? "PARTIAL" : "UNAVAILABLE",
      sources: [{ source: data.source, state: data.feed.connected ? "AVAILABLE" : "UNAVAILABLE" }],
    },
    permissions: [], data,
  };
}
