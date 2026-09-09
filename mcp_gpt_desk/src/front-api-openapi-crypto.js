const enumeration = (name, values, defaultValue) => ({ name, in: "query", required: false, schema: { type: "string", enum: values, default: defaultValue } });

export function cryptoObservationOpenApiPaths() {
  return {
    "/front-api/v1/views/crypto-market": {
      get: {
        operationId: "getPublicCryptoObservation", summary: "Read public Kraken USD spot observations; no trading authority",
        description: "Authenticated desk.read view. Modes catalog/quotes contain three quote states; history returns at most 720 real bars, live their latest two. Public WebSocket shared per API process; no canonical persistence. Never a broker or signal API.",
        servers: [{ url: "/" }], tags: ["Desk Front"],
        parameters: [enumeration("mode", ["catalog", "quotes", "history", "live"], "quotes"), enumeration("instrument", ["BTCUSD", "SOLUSD", "DOGEUSD"], "BTCUSD"), enumeration("timeframe", ["1", "5", "15", "30", "1H", "4H", "1D"], "5")],
        responses: {
          "200": { description: "Versioned read-only ViewEnvelope; unavailable quotes retain timestamps, never substitute zero", headers: { "Cache-Control": { schema: { type: "string", const: "no-store" } } }, content: { "application/json": { schema: {
            type: "object", required: ["meta", "permissions", "data"], properties: {
              meta: { type: "object", required: ["generatedAt", "asOf", "stale", "schemaVersion", "availability"] },
              permissions: { type: "array", maxItems: 0 },
              data: { type: "object", required: ["schemaVersion", "source", "sourceClass", "readOnly", "markets", "quotes", "feed", "history"], properties: {
                schemaVersion: { const: "public_crypto_observation_v1" }, source: { const: "KRAKEN_SPOT" }, sourceClass: { const: "EXTERNAL_OBSERVATION" }, readOnly: { const: true },
                markets: { type: "array", minItems: 3, maxItems: 3, items: { type: "object", required: ["instrument", "base", "quote", "pricePrecision"] } },
                quotes: { type: "array", minItems: 3, maxItems: 3, items: { type: "object", required: ["instrument", "state"], properties: { state: { enum: ["LIVE", "STALE", "UNAVAILABLE"] }, last: { type: "number", exclusiveMinimum: 0 }, asOf: { type: "string", format: "date-time" }, receivedAt: { type: "string", format: "date-time" } } } },
                feed: { type: "object", required: ["state", "connected", "exchange", "lastFrameAt"] },
                history: { type: ["object", "null"], properties: { state: { enum: ["LOADING", "READY", "ERROR"] }, bars: { type: "array", maxItems: 720, items: { type: "object", required: ["timestamp", "open", "high", "low", "close", "volume", "forming"] } } } },
              } },
            },
          } } } },
          "400": { description: "Unsupported allowlisted scope" }, "401": { description: "Authentication required" }, "403": { description: "desk.read scope required" }, "405": { description: "GET only; no mutation route" },
        },
      },
    },
  };
}
