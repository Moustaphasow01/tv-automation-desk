import { createHash, timingSafeEqual } from "node:crypto";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";

const MAX_PAYLOAD_BYTES = 64_000;
const SECRET_FIELDS = new Set(["secret", "sec", "token", "webhook_secret"]);
const LOCAL_ENVIRONMENT = "preprod";

export async function ingestTradingViewWebhook({ persistence, body, secret, requestIp = null, now = new Date() }) {
  if (!secret) return response(503, "webhook_secret_not_configured");
  if (!body || typeof body !== "object" || Array.isArray(body)) return response(400, "json_object_required");
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_PAYLOAD_BYTES) return response(413, "payload_too_large");

  const provided = String(body.token ?? body.secret ?? body.sec ?? body.webhook_secret ?? "").trim();
  if (!provided) return response(401, "webhook_secret_required");
  if (!safeEqual(provided, secret)) return response(401, "webhook_secret_invalid");

  const items = Array.isArray(body.candles) ? body.candles : [body];
  if (!items.length) return response(422, "candles_required");
  const writes = [];
  const results = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = normalizePayload({ ...body, candles: undefined, ...items[index] });
    const validation = validateCandle(item);
    if (validation) {
      results.push({ index, ok: false, error: validation });
      continue;
    }
    const canonical = canonicalCandle(item, { now, requestIp });
    writes.push(...canonical.writes);
    results.push({ index, ok: true, ...canonical.result });
  }

  if (writes.length) await persistence.writeDocuments(writes);
  const accepted = results.filter((item) => item.ok).length;
  const rejected = results.length - accepted;
  return {
    statusCode: accepted ? 202 : 422,
    body: {
      ok: rejected === 0,
      status: rejected === 0 ? "ACCEPTED" : accepted ? "PARTIAL" : "REJECTED",
      total: results.length,
      accepted,
      rejected,
      results,
    },
  };
}

function normalizePayload(raw) {
  const price = object(raw.price) || object(raw.px) || {};
  const studies = object(raw.studies) || object(raw.ctx) || {};
  return {
    alert_id: raw.alert_id ?? raw.id ?? null,
    symbol: canonicalSymbol(raw.symbol ?? raw.sym ?? raw.ticker),
    timeframe: canonicalTimeframe(raw.timeframe ?? raw.tf ?? raw.interval ?? raw.resolution),
    timestamp_utc: canonicalUtc(raw.timestamp_utc ?? raw.ts ?? raw.timestamp ?? raw.time),
    bar_status: String(raw.bar_status || (raw.confirmed === false ? "open" : "closed")).toLowerCase(),
    open: number(raw.open ?? price.open ?? price.o),
    high: number(raw.high ?? price.high ?? price.h),
    low: number(raw.low ?? price.low ?? price.l),
    close: number(raw.close ?? price.close ?? price.c),
    volume: number(raw.volume ?? price.volume ?? price.v ?? 0),
    studies,
    payload: stripSecrets(raw),
  };
}

function validateCandle(candle) {
  if (!candle.symbol) return "missing_symbol";
  if (!candle.timeframe) return "missing_timeframe";
  if (!candle.timestamp_utc) return "invalid_timestamp";
  if (!["closed", "confirmed"].includes(candle.bar_status)) return "bar_status_closed_required";
  for (const field of ["open", "high", "low", "close", "volume"]) {
    if (!Number.isFinite(candle[field])) return `invalid_number_${field}`;
  }
  if (candle.high < Math.max(candle.open, candle.close, candle.low)) return "invalid_ohlc_high";
  if (candle.low > Math.min(candle.open, candle.close, candle.high)) return "invalid_ohlc_low";
  return null;
}

function canonicalCandle(candle, { now, requestIp }) {
  const feedId = safeId(LOCAL_ENVIRONMENT, "tradingview", candle.symbol, candle.timeframe);
  const candleId = candle.timestamp_utc.replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
  const eventId = `event_${createHash("sha256").update(stableStringify(candle.payload)).digest("hex")}`;
  const queueId = candle.alert_id
    ? `alert_${createHash("sha256").update(String(candle.alert_id)).digest("hex")}`
    : eventId.replace("event_", "hash_");
  const timestamp = new Date(candle.timestamp_utc);
  const base = {
    schema_version: "market-candle-v2",
    environment: LOCAL_ENVIRONMENT,
    provider: "tradingview",
    source_service: "local_tradingview_webhook",
    feed_id: feedId,
    symbol: candle.symbol,
    timeframe: candle.timeframe,
    timeframe_group: candle.timeframe.endsWith("H") ? "higher_timeframe" : "intraday",
    timestamp_utc: candle.timestamp_utc,
    trading_date_paris: parisDate(timestamp),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    studies: candle.studies,
    is_closed: true,
    alert_id: candle.alert_id,
    updated_at_utc: now.toISOString(),
  };
  const feed = {
    schema_version: "market-feed-v2",
    environment: LOCAL_ENVIRONMENT,
    provider: "tradingview",
    source_service: "local_tradingview_webhook",
    feed_id: feedId,
    symbol: candle.symbol,
    timeframe: candle.timeframe,
    timeframe_group: base.timeframe_group,
    timezone: "Europe/Paris",
    enabled: true,
    latest_timestamp_utc: candle.timestamp_utc,
    latest_candle_path: `${DESK_COLLECTIONS.marketFeeds}/${feedId}/${DESK_COLLECTIONS.marketFeedCandles}/${candleId}`,
    updated_at_utc: now.toISOString(),
  };
  const event = {
    event_id: eventId,
    received_at_utc: now.toISOString(),
    endpoint: "/api/v1/webhooks/tradingview",
    client_ip: requestIp,
    alert_id: candle.alert_id,
    symbol: candle.symbol,
    timeframe: candle.timeframe,
    timestamp_utc: candle.timestamp_utc,
    payload: candle.payload,
    status: "ACCEPTED",
    feed_id: feedId,
    candle_id: candleId,
  };
  const queue = {
    queue_id: queueId,
    status: "QUEUED",
    attempts: 0,
    source: "local_tradingview_webhook",
    alert_id: candle.alert_id,
    symbol: candle.symbol,
    timeframe: candle.timeframe,
    timestamp_utc: candle.timestamp_utc,
    payload: candle.payload,
    created_at_utc: now.toISOString(),
    updated_at_utc: now.toISOString(),
  };
  return {
    writes: [
      { collection: DESK_COLLECTIONS.marketFeeds, documentId: feedId, data: feed, merge: true },
      { collection: `${DESK_COLLECTIONS.marketFeeds}/${feedId}/${DESK_COLLECTIONS.marketFeedCandles}`, documentId: candleId, data: base, merge: true },
      { collection: DESK_COLLECTIONS.tradingviewWebhookEvents, documentId: eventId, data: event, merge: true },
      { collection: "tradingview_alert_queue", documentId: queueId, data: queue, merge: true },
      { collection: DESK_COLLECTIONS.liveDataFeedStatus, documentId: feedId, data: { ...feed, latest_bar_age_seconds: Math.max(0, Math.floor((now.getTime() - timestamp.getTime()) / 1000)), status: "OK" }, merge: true },
    ],
    result: { market_feed_id: feedId, market_feed_candle_id: candleId, event_id: eventId },
  };
}

function canonicalSymbol(value) {
  const text = String(value || "").trim().toUpperCase();
  return text.includes(":") ? text.split(":").at(-1) : text;
}

function canonicalTimeframe(value) {
  const text = String(value || "").trim().toUpperCase().replace(/^M(?=\d+$)/, "");
  return ({ "60": "1H", H1: "1H", "240": "4H", H4: "4H" })[text] || text;
}

function canonicalUtc(value) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = typeof value === "number" || /^\d+$/.test(String(value)) ? Number(value) : null;
  const date = numeric == null ? new Date(String(value)) : new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function stripSecrets(value) {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET_FIELDS.has(key.toLowerCase())).map(([key, item]) => [key, stripSecrets(item)]));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function safeId(...parts) {
  return parts.map((part) => String(part || "_").trim().replace(/[\\/\s]+/g, "_")).join("__");
}

function parisDate(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : Number.NaN;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function response(statusCode, error) {
  return { statusCode, body: { ok: false, error } };
}
