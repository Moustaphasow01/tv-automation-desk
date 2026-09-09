import test from "node:test";
import assert from "node:assert/strict";
import { createPublicCryptoObservation } from "../index.js";
import { cryptoScope, krakenQuote, krakenRestCandles } from "../src/adapter/kraken-public-contract.js";
import { ObservationCache } from "../src/application/observation-cache.js";
import { KrakenStream } from "../src/adapter/kraken-stream.js";

const start = Date.parse("2026-09-09T13:00:00Z");
const rawQuote = (overrides = {}) => ({ symbol: "DOGE/USD", last: 0.0911234, bid: 0.0911233, ask: 0.0911235, change_pct: 1.2, timestamp: new Date(start).toISOString(), ...overrides });
const rest = () => ({ error: [], result: { XXBTZUSD: [[start / 1000, "100", "103", "99", "102", "101", "12", 3]], last: start / 1000 } });

class Socket extends EventTarget {
  static all = [];
  readyState = 0;
  sent = [];
  constructor(url) { super(); assert.equal(url, "wss://ws.kraken.com/v2"); Socket.all.push(this); }
  send(data) { this.sent.push(JSON.parse(data)); }
  open() { this.readyState = 1; this.dispatchEvent(new Event("open")); this.message({ channel: "status", data: [{ system: "online" }] }); }
  message(data) { this.dispatchEvent(Object.assign(new Event("message"), { data: JSON.stringify(data) })); }
  close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
}

function fixture(t, fetch = async () => ({ ok: true, json: async () => rest() })) {
  let time = start;
  Socket.all = [];
  const api = createPublicCryptoObservation({ now: () => time, fetch, WebSocket: Socket });
  t.after(() => api.dispose());
  return { api, advance(ms) { time += ms; } };
}

test("closed market allowlist rejects URLs, unknown markets, unsupported intervals and command modes", () => {
  for (const input of [{ instrument: "https://evil.test" }, { instrument: "ETHUSD" }, { timeframe: "2" }, { mode: "buy" }]) assert.throws(() => cryptoScope(input), { code: "FRONT_CRYPTO_SCOPE_INVALID" });
  assert.equal(cryptoScope({ instrument: "btcusd", timeframe: "1h" }).interval, 60);
});
test("ticker preserves seven DOGE decimals, timestamps and price units", () => {
  const quote = krakenQuote(rawQuote(), start);
  assert.equal(quote.last, 0.0911234); assert.equal(quote.pricePrecision, 7);
  assert.equal(quote.instrument, "DOGEUSD"); assert.equal(quote.receivedAt, new Date(start).toISOString());
});
test("ticker rejects nonfinite, zero, crossed and future observations without replacement prices", () => {
  for (const input of [{ last: NaN }, { last: 0 }, { ask: -1 }, { bid: 1 }, { timestamp: new Date(start + 31_000).toISOString() }, { timestamp: "invalid" }]) assert.equal(krakenQuote(rawQuote(input), start), null);
});
test("REST validates bars, rejects empty numeric values and never exports bar VWAP as session VWAP", () => {
  const body = rest();
  body.result.XXBTZUSD.push([Number.MAX_VALUE, 1, 1, 1, 1, 1, 1, 1], [start / 1000, "", 1, 1, 1, 1, 1, 1]);
  const bars = krakenRestCandles(body, start);
  assert.equal(bars.length, 1); assert.equal(bars[0].vwap, null); assert.equal(bars[0].volume, 12);
  assert.throws(() => krakenRestCandles({ error: ["EAPI:Rate limit exceeded"] }, start));
});
test("catalog starts one shared stream and emits no order or private subscriptions", async (t) => {
  const { api } = fixture(t);
  const first = await api.read({ mode: "catalog" });
  assert.equal(first.readOnly, true); assert.equal(first.sourceClass, "EXTERNAL_OBSERVATION");
  assert.equal(first.markets.length, 3); assert.equal(first.quotes.every((quote) => quote.state === "UNAVAILABLE"), true);
  Socket.all[0].open();
  await api.read(); await api.read({ instrument: "SOLUSD" });
  assert.equal(Socket.all.length, 1);
  assert.deepEqual(Socket.all[0].sent, [{ method: "subscribe", params: { channel: "ticker", symbol: ["BTC/USD", "SOL/USD", "DOGE/USD"], snapshot: true } }]);
});
test("old ticks cannot replace newer prices and heartbeat never refreshes their timestamps", async (t) => {
  const { api, advance } = fixture(t);
  await api.read(); const socket = Socket.all[0]; socket.open();
  socket.message({ channel: "ticker", data: [rawQuote()] });
  socket.message({ channel: "ticker", data: [rawQuote({ last: 0.08, timestamp: new Date(start - 1_000).toISOString() })] });
  let quote = (await api.read()).quotes.find((item) => item.instrument === "DOGEUSD");
  assert.equal(quote.last, 0.0911234); assert.equal(quote.state, "LIVE");
  advance(31_000); socket.message({ channel: "heartbeat" });
  quote = (await api.read()).quotes.find((item) => item.instrument === "DOGEUSD");
  assert.equal(quote.last, 0.0911234); assert.equal(quote.state, "STALE"); assert.equal(quote.asOf, new Date(start).toISOString());
});
test("disconnect retains dated prices and reconnect ignores messages from the old socket", async (t) => {
  const { api, advance } = fixture(t);
  await api.read(); const old = Socket.all[0]; old.open(); old.message({ channel: "ticker", data: [rawQuote()] }); old.close();
  assert.equal((await api.read()).feed.state, "RECONNECTING");
  advance(6_000); await api.read(); const next = Socket.all[1]; next.open();
  next.message({ channel: "ticker", data: [rawQuote({ last: 0.10, timestamp: new Date(start + 6_000).toISOString() })] });
  old.message({ channel: "ticker", data: [rawQuote({ last: 0.20, timestamp: new Date(start + 7_000).toISOString() })] });
  assert.equal((await api.read()).quotes.find((item) => item.instrument === "DOGEUSD").last, 0.10);
});
test("provider maintenance cannot be labelled live", async (t) => {
  const { api } = fixture(t); await api.read(); const socket = Socket.all[0]; socket.open();
  socket.message({ channel: "ticker", data: [rawQuote()] }); socket.message({ channel: "status", data: [{ system: "maintenance" }] });
  assert.equal((await api.read()).quotes.find((item) => item.instrument === "DOGEUSD").state, "STALE");
});
test("history is deduplicated, reports the forming candle and keeps a bounded tail", async (t) => {
  let requests = 0;
  const { api } = fixture(t, async (url, options) => { requests++; assert.equal(url.hostname, "api.kraken.com"); assert.equal(url.searchParams.get("pair"), "XBTUSD"); assert.equal(options.redirect, "error"); return { ok: true, json: async () => rest() }; });
  const views = await Promise.all([api.read({ mode: "history" }), api.read({ mode: "history" })]);
  assert.equal(requests, 1); assert.equal(views[0].history.state, "READY"); assert.equal(views[0].history.bars[0].forming, true);
  await api.read({ mode: "live" }); assert.equal(requests, 1);
  const cache = new ObservationCache();
  cache.acceptCandles("BTCUSD:5", Array.from({ length: 800 }, (_, index) => ({ timestamp: new Date(start - index * 300_000).toISOString(), close: index })));
  assert.equal(cache.entry("BTCUSD:5").bars.length, 720);
});
test("history outage is explicit with cooldown and does not suppress the independent ticker", async (t) => {
  let requests = 0;
  const { api } = fixture(t, async () => { requests++; throw new Error("offline"); });
  const failed = await api.read({ mode: "history" });
  assert.equal(failed.history.state, "ERROR"); assert.deepEqual(failed.history.bars, []);
  Socket.all[0].open(); Socket.all[0].message({ channel: "ticker", data: [rawQuote()] });
  assert.equal((await api.read({ mode: "live" })).quotes.find((item) => item.instrument === "DOGEUSD").state, "LIVE"); assert.equal(requests, 1);
});
test("unused stream stops and can start again on demand", () => {
  let time = start; Socket.all = [];
  const stream = new KrakenStream({ cache: new ObservationCache(), now: () => time, WebSocket: Socket });
  stream.touch(cryptoScope({})); time += 91_000; stream.check();
  assert.equal(stream.state, "IDLE"); assert.equal(stream.timer, null); assert.equal(Socket.all[0].readyState, 3);
  stream.touch(cryptoScope({})); assert.equal(Socket.all.length, 2); stream.dispose();
});
