import { KRAKEN_MARKETS, krakenCandle, krakenQuote } from "./kraken-public-contract.js";

export class KrakenStream {
  socket = null;
  timer = null;
  retryAt = 0;
  attempts = 0;
  lastRequest = 0;
  lastFrame = null;
  state = "IDLE";
  exchange = null;
  wanted = new Map();
  subscriptions = new Set();

  constructor({ cache, now, WebSocket }) { Object.assign(this, { cache, now, WebSocket }); }

  touch(scope) {
    this.lastRequest = this.now();
    if (["history", "live"].includes(scope.mode)) this.wanted.set(scope.key, scope);
    if (!this.timer) {
      this.timer = setInterval(() => this.check(), 5_000);
      this.timer.unref?.();
    }
    this.check();
    this.subscribeCandles();
  }

  check() {
    const now = this.now();
    if (now - this.lastRequest > 90_000) { this.dispose(); return; }
    if (this.socket && this.lastFrame !== null && now - this.lastFrame > 20_000) this.fail(this.socket);
    if (!this.socket && now >= this.retryAt) this.connect();
  }

  connect() {
    this.state = "CONNECTING";
    this.exchange = null;
    this.lastFrame = this.now();
    try {
      const socket = new this.WebSocket("wss://ws.kraken.com/v2");
      this.socket = socket;
      socket.addEventListener("open", () => this.open(socket));
      socket.addEventListener("message", (event) => this.message(socket, event.data));
      socket.addEventListener("error", () => this.fail(socket));
      socket.addEventListener("close", () => this.fail(socket));
    } catch { this.fail(this.socket); }
  }

  open(socket) {
    if (socket !== this.socket) return;
    this.state = "CONNECTED";
    this.subscriptions.clear();
    socket.send(JSON.stringify({ method: "subscribe", params: { channel: "ticker", symbol: KRAKEN_MARKETS.map((market) => market.symbol), snapshot: true } }));
    this.subscribeCandles();
  }

  subscribeCandles() {
    if (this.socket?.readyState !== 1) return;
    for (const [key, scope] of this.wanted) {
      if (this.subscriptions.has(key)) continue;
      this.subscriptions.add(key);
      this.socket.send(JSON.stringify({ method: "subscribe", params: { channel: "ohlc", symbol: [scope.market.symbol], interval: scope.interval, snapshot: true } }));
    }
  }

  message(socket, data) {
    if (socket !== this.socket || typeof data !== "string" || data.length > 1_000_000) return;
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (!message || typeof message !== "object") return;
    this.lastFrame = this.now();
    if (message.success === false) { this.fail(socket); return; }
    if (message.channel === "status") this.exchange = message.data?.[0]?.system || null;
    if (!Array.isArray(message.data)) return;
    for (const raw of message.data) this.acceptObservation(message.channel, raw);
  }

  acceptObservation(channel, raw) {
    if (!raw || typeof raw !== "object") return;
    if (channel === "ticker") {
      const quote = krakenQuote(raw, this.now());
      if (quote) { this.cache.acceptQuote(quote); this.attempts = 0; }
    }
    if (channel === "ohlc") this.acceptCandle(raw);
  }

  acceptCandle(raw) {
    const scope = [...this.wanted.values()].find((item) => item.market.symbol === raw.symbol && item.interval === raw.interval);
    if (!scope) return;
    const candle = krakenCandle(raw, this.now());
    if (candle) this.cache.acceptCandles(scope.key, [candle]);
  }

  fail(socket) {
    if (socket !== this.socket) return;
    this.socket = null;
    this.exchange = null;
    this.state = "RECONNECTING";
    this.retryAt = this.now() + Math.min(30_000, 1_000 * 2 ** Math.min(this.attempts++, 5));
    try { socket?.close(); } catch { /* already closed */ }
  }

  snapshot() {
    const connected = this.state === "CONNECTED" && this.exchange === "online" && this.lastFrame !== null && this.now() - this.lastFrame <= 20_000;
    return { state: this.state, connected, exchange: this.exchange, lastFrameAt: this.lastFrame === null ? null : new Date(this.lastFrame).toISOString() };
  }

  dispose() {
    const socket = this.socket;
    this.socket = null;
    clearInterval(this.timer);
    this.timer = null;
    this.wanted.clear();
    this.subscriptions.clear();
    this.state = "IDLE";
    this.exchange = null;
    try { socket?.close(); } catch { /* already closed */ }
  }
}
