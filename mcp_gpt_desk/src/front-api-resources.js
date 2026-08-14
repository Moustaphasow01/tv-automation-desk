import { z } from "zod";
import { SystemClock } from "@tv-automation/desk-time";
import {
  loadFrontDailyMacroSource,
  loadFrontMarketSnapshot,
  normalizeFrontApiScope,
  projectDeskSession,
} from "./front-session-projection.js";

const FRONT_API_RESOURCE_CLOCK = new SystemClock();

const scopeSchema = z.object({
  strategyId: z.string().min(1),
  session: z.enum(["asia_open", "ny_open"]),
  tradingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.enum(["live", "paper"]),
});

const resourceBaseSchema = z.object({
  contract: z.string().min(1),
  schemaVersion: z.literal("1.0.0"),
  scope: scopeSchema,
  warnings: z.array(z.string()),
});

const marketItemSchema = z.object({
  symbol: z.string(),
  price: z.string(),
  change: z.string(),
  trend: z.enum(["up", "down", "flat"]),
  note: z.string(),
  ohlc: z.object({
    open: z.string(),
    high: z.string(),
    low: z.string(),
    close: z.string(),
  }),
  marketDate: z.string(),
  asOf: z.string(),
  source: z.string(),
  rsi: z.string(),
  atr: z.string(),
  seriesTimeframe: z.string(),
  availability: z.string(),
  series: z.array(z.object({
    time: z.string(),
    open: z.number().nullable(),
    high: z.number().nullable(),
    low: z.number().nullable(),
    close: z.number(),
  })),
});

const briefSchema = z.object({
  headline: z.string(),
  text: z.string(),
  verdict: z.string(),
});

const positionSchema = z.object({
  active: z.boolean(),
  status: z.string(),
  instrument: z.string(),
  direction: z.string(),
  entry: z.number().nullable(),
  current: z.number().nullable(),
  unrealizedR: z.number().nullable(),
  note: z.string(),
});

const macroEventSchema = z.object({
  time: z.string(),
  title: z.string(),
  importance: z.string(),
  impactText: z.string(),
  scheduledAt: z.string(),
  date: z.string(),
  currency: z.string(),
  previous: z.string(),
  forecast: z.string(),
  actual: z.string(),
  isNext: z.boolean(),
});

const headlineSchema = z.object({
  time: z.string(),
  title: z.string(),
  source: z.string(),
  impact: z.string(),
  scheduledAt: z.string(),
  date: z.string(),
  currency: z.string(),
  importance: z.string(),
  previous: z.string(),
  forecast: z.string(),
  actual: z.string(),
  isNext: z.boolean(),
  url: z.string(),
  provider: z.string(),
  publishedAt: z.string(),
  assets: z.array(z.string()),
  topics: z.array(z.string()),
});

const activityItemSchema = z.object({
  time: z.string(),
  title: z.string(),
  detail: z.string(),
  status: z.string(),
});

const alertSchema = z.object({
  level: z.enum(["info", "watch", "warning", "action", "critical", "positive"]),
  title: z.string(),
  message: z.string(),
  time: z.string(),
});

const qualitySchema = z.object({
  label: z.string(),
  status: z.string(),
  antiLookahead: z.boolean(),
  warnings: z.array(z.string()),
});

const performanceSummarySchema = z.object({
  closed_trades: z.number().optional(),
  wins: z.number().optional(),
  losses: z.number().optional(),
  win_rate: z.number().nullable().optional(),
  total_R: z.number().optional(),
  expectancy_R: z.number().optional(),
  max_drawdown_R: z.number().optional(),
}).passthrough();

const strategyCalendarSchema = z.object({
  ok: z.boolean().optional(),
  strategy_id: z.string(),
  pricing_mode: z.string(),
  year: z.number(),
  month: z.number(),
  from_date: z.string(),
  to_date: z.string(),
  summary: performanceSummarySchema.optional(),
  days: z.array(z.object({
    date: z.string(),
    status: z.string(),
    total_R: z.number(),
    closed_trades: z.number(),
    setup_count: z.number(),
    has_master: z.boolean(),
    has_trade: z.boolean(),
    has_open_position: z.boolean(),
    pack_status: z.string().nullable(),
    master_decision: z.string().nullable(),
    setup_status: z.string().nullable(),
  })),
});

const strategyDaySchema = z.object({
  ok: z.boolean().optional(),
  strategy_id: z.string(),
  pricing_mode: z.string(),
  date: z.string(),
  master: z.record(z.any()).nullable(),
  thesis: z.record(z.any()).nullable(),
  setups: z.array(z.record(z.any())),
  monitors: z.array(z.record(z.any())),
  trades: z.array(z.record(z.any())),
  performance: z.object({ summary: performanceSummarySchema.optional() }).passthrough(),
  timeline: z.array(z.record(z.any())),
}).passthrough();

export const frontApiResourceSchemas = {
  market: resourceBaseSchema.extend({
    contract: z.literal("DeskFrontMarketResource"),
    lastDataAt: z.string(),
    market: z.array(marketItemSchema),
    marketBrief: briefSchema,
    crossAssetBrief: briefSchema,
    levels: z.array(z.object({ price: z.string(), role: z.string(), state: z.string() })),
  }),
  position: resourceBaseSchema.extend({
    contract: z.literal("DeskFrontPositionResource"),
    position: positionSchema,
  }),
  macro: resourceBaseSchema.extend({
    contract: z.literal("DeskFrontMacroResource"),
    nextMacro: z.string(),
    nearEvent: z.boolean(),
    macro: z.array(macroEventSchema),
  }),
  newsDigest: resourceBaseSchema.extend({
    contract: z.literal("DeskFrontNewsDigestResource"),
    news: z.object({
      digestUpdatedAt: z.string(),
      digest: z.string(),
      headlines: z.array(headlineSchema),
      status: z.string(),
      provider: z.string(),
      freshness: z.object({
        status: z.string(),
        ageMinutes: z.number().nullable(),
      }),
    }),
  }),
  newsHeadlines: resourceBaseSchema.extend({
    contract: z.literal("DeskFrontNewsHeadlinesResource"),
    headlines: z.array(headlineSchema),
  }),
  activity: resourceBaseSchema.extend({
    contract: z.literal("DeskFrontActivityResource"),
    automation: z.object({ status: z.string(), worker: z.string(), cadence: z.string() }),
    activity: z.array(activityItemSchema),
  }),
  alerts: resourceBaseSchema.extend({
    contract: z.literal("DeskFrontAlertsResource"),
    alerts: z.array(alertSchema),
  }),
  audit: resourceBaseSchema.extend({
    contract: z.literal("DeskFrontAuditResource"),
    dataQuality: qualitySchema,
    audit: z.object({
      contracts: z.array(z.object({ name: z.string(), version: z.string(), status: z.string() })),
      checks: z.array(z.object({ label: z.string(), status: z.string() })),
      apiMap: z.array(z.object({ view: z.string(), endpoint: z.string() })),
    }),
  }),
  performanceCalendar: resourceBaseSchema.extend({
    contract: z.literal("DeskFrontPerformanceCalendarResource"),
    calendar: strategyCalendarSchema,
  }),
  performanceDay: resourceBaseSchema.extend({
    contract: z.literal("DeskFrontPerformanceDayResource"),
    day: strategyDaySchema,
  }),
};

export const FRONT_RESOURCE_PATHS = new Set([
  "/api/v1/market/snapshot",
  "/api/v1/positions/current",
  "/api/v1/macro/calendar",
  "/api/v1/news/headlines",
  "/api/v1/news/digest",
  "/api/v1/desk/activity",
  "/api/v1/alerts",
  "/api/v1/audit",
  "/api/v1/performance/calendar",
  "/api/v1/performance/day",
]);

export const FRONT_RESOURCE_CACHE_SECONDS = {
  "/api/v1/market/snapshot": 15,
  "/api/v1/positions/current": 5,
  "/api/v1/macro/calendar": 30,
  "/api/v1/news/headlines": 30,
  "/api/v1/news/digest": 60,
  "/api/v1/desk/activity": 5,
  "/api/v1/alerts": 5,
  "/api/v1/audit": 30,
  "/api/v1/performance/calendar": 30,
  "/api/v1/performance/day": 15,
};

const LIVE_CONTEXT_CACHE_TTL_MS = boundedTtlMs(process.env.DESK_FRONT_LIVE_CONTEXT_CACHE_TTL_MS, 10_000, 0, 60_000);
const liveContextCaches = new WeakMap();

export async function loadFrontApiResource(store, pathname, scopeInput = {}) {
  if (pathname === "/api/v1/market/snapshot") return loadFrontMarketResource(store, scopeInput);
  if (pathname === "/api/v1/positions/current") return loadFrontPositionResource(store, scopeInput);
  if (pathname === "/api/v1/macro/calendar") return loadFrontMacroResource(store, scopeInput);
  if (pathname === "/api/v1/news/headlines") return loadFrontNewsHeadlinesResource(store, scopeInput);
  if (pathname === "/api/v1/news/digest") return loadFrontNewsDigestResource(store, scopeInput);
  if (pathname === "/api/v1/desk/activity") return loadFrontActivityResource(store, scopeInput);
  if (pathname === "/api/v1/alerts") return loadFrontAlertsResource(store, scopeInput);
  if (pathname === "/api/v1/audit") return loadFrontAuditResource(store, scopeInput);
  if (pathname === "/api/v1/performance/calendar") return loadFrontPerformanceCalendarResource(store, scopeInput);
  if (pathname === "/api/v1/performance/day") return loadFrontPerformanceDayResource(store, scopeInput);
  throw new Error(`front_resource_not_found:${pathname}`);
}

export async function loadFrontPerformanceCalendarResource(store, scopeInput = {}) {
  const context = await liveContext(store, scopeInput);
  const now = new Date(frontApiResourceEpochMs());
  const year = Number(scopeInput.year || now.getUTCFullYear());
  const month = Number(scopeInput.month || now.getUTCMonth() + 1);
  const strategyId = String(scopeInput.strategy_id || "ny_open_1530");
  const pricingMode = String(scopeInput.pricing_mode || "conservative");
  const calendarRead = await safeResourceRead(() => store.getStrategyCalendar({
    strategy_id: strategyId,
    pricing_mode: pricingMode,
    year,
    month,
  }), "strategy_calendar_not_available");
  return frontApiResourceSchemas.performanceCalendar.parse({
    ...resourceBase("DeskFrontPerformanceCalendarResource", context, calendarRead.warning),
    calendar: calendarRead.value,
  });
}

export async function loadFrontPerformanceDayResource(store, scopeInput = {}) {
  const context = await liveContext(store, scopeInput);
  const date = String(scopeInput.date || context.scope.trading_date);
  const strategyId = String(scopeInput.strategy_id || "ny_open_1530");
  const pricingMode = String(scopeInput.pricing_mode || "conservative");
  const dayRead = await safeResourceRead(() => store.getStrategyDayDetail({
    strategy_id: strategyId,
    pricing_mode: pricingMode,
    date,
  }), "strategy_day_not_available");
  return frontApiResourceSchemas.performanceDay.parse({
    ...resourceBase("DeskFrontPerformanceDayResource", context, dayRead.warning),
    day: dayRead.value,
  });
}

export async function loadFrontMarketResource(store, scopeInput = {}) {
  const context = await liveContext(store, scopeInput);
  const instrument = context.live.active_thesis?.instrument || context.live.latest_master?.instrument || "MNQ";
  const snapshotRead = await safeResourceRead(() => loadFrontMarketSnapshot(store, {
    date: context.scope.trading_date,
    session: context.scope.session,
    instrument,
    front_cache: scopeInput.front_cache === true,
  }), "market_snapshot_not_available");
  const snapshot = snapshotRead.value?.session_snapshot || null;
  const projected = projectDeskSession({ live: context.live, marketSnapshot: snapshot });
  return frontApiResourceSchemas.market.parse({
    ...resourceBase("DeskFrontMarketResource", context, snapshotRead.warning),
    lastDataAt: projected.lastDataAt,
    market: projected.market,
    marketBrief: projected.marketBrief,
    crossAssetBrief: projected.crossAssetBrief,
    levels: projected.levels,
  });
}

export async function loadFrontPositionResource(store, scopeInput = {}) {
  const context = await liveContext(store, scopeInput);
  const projected = projectDeskSession({ live: context.live });
  return frontApiResourceSchemas.position.parse({
    ...resourceBase("DeskFrontPositionResource", context),
    position: projected.position,
  });
}

export async function loadFrontMacroResource(store, scopeInput = {}) {
  const context = await liveContext(store, scopeInput);
  const macroRead = await safeResourceRead(() => loadFrontDailyMacroSource(store, {
    date: context.scope.trading_date,
    mode: context.scope.mode,
    as_of_utc: context.live.resolved_scope?.as_of_utc || context.scope.as_of_utc,
  }), "macro_calendar_not_available");
  const projected = projectDeskSession({ live: context.live, macro: macroRead.value });
  return frontApiResourceSchemas.macro.parse({
    ...resourceBase("DeskFrontMacroResource", context, macroRead.warning || macroRead.value?.warning),
    nextMacro: projected.nextMacro,
    nearEvent: hasNearMacroEvent(macroRead.value?.events, context.live.resolved_scope?.as_of_utc || context.scope.as_of_utc),
    macro: projected.macro,
  });
}

export async function loadFrontNewsDigestResource(store, scopeInput = {}) {
  const { context, news, macro, warning } = await loadNewsSource(store, scopeInput);
  const projected = projectDeskSession({ live: context.live, news, macro });
  return frontApiResourceSchemas.newsDigest.parse({
    ...resourceBase("DeskFrontNewsDigestResource", context, warning),
    news: projected.news,
  });
}

export async function loadFrontNewsHeadlinesResource(store, scopeInput = {}) {
  const { context, news, macro, warning } = await loadNewsSource(store, scopeInput);
  const projected = projectDeskSession({ live: context.live, news, macro });
  return frontApiResourceSchemas.newsHeadlines.parse({
    ...resourceBase("DeskFrontNewsHeadlinesResource", context, warning),
    headlines: projected.news.headlines,
  });
}

export async function loadFrontActivityResource(store, scopeInput = {}) {
  const scope = normalizeFrontApiScope(scopeInput);
  const jobsRead = await safeResourceRead(() => store.listDeskJobs({
    date: scope.trading_date,
    session: scope.session,
    mode: scope.mode,
    limit: 20,
  }), "desk_activity_not_available");
  const live = liveShell(scope, { jobs: jobsRead.value?.jobs || [] });
  const projected = projectDeskSession({ live });
  const context = { scope, live };
  return frontApiResourceSchemas.activity.parse({
    ...resourceBase("DeskFrontActivityResource", context, jobsRead.warning),
    automation: projected.automation,
    activity: projected.activity,
  });
}

export async function loadFrontAlertsResource(store, scopeInput = {}) {
  const scope = normalizeFrontApiScope(scopeInput);
  const alertsRead = await safeResourceRead(() => store.listAlerts({
    date: scope.trading_date,
    limit: 20,
  }), "desk_alerts_not_available");
  const live = liveShell(scope, { alerts: alertsRead.value?.alerts || [] });
  const projected = projectDeskSession({ live });
  const context = { scope, live };
  return frontApiResourceSchemas.alerts.parse({
    ...resourceBase("DeskFrontAlertsResource", context, alertsRead.warning),
    alerts: projected.alerts,
  });
}

export async function loadFrontAuditResource(store, scopeInput = {}) {
  const context = await liveContext(store, scopeInput);
  const auditRead = await safeResourceRead(() => store.getAuditState(context.live.resolved_scope || context.scope), "desk_audit_not_available");
  const projected = projectDeskSession({ live: context.live, audit: auditRead.value });
  return frontApiResourceSchemas.audit.parse({
    ...resourceBase("DeskFrontAuditResource", context, auditRead.warning),
    dataQuality: projected.dataQuality,
    audit: projected.audit,
  });
}

async function liveContext(store, scopeInput) {
  const scope = normalizeFrontApiScope(scopeInput);
  if (scopeInput.front_cache !== true || LIVE_CONTEXT_CACHE_TTL_MS <= 0) {
    const live = await store.getLiveDeskState(scope);
    return { scope: live.resolved_scope || scope, live };
  }
  return cachedLiveContext(
    store,
    liveContextCacheKey(scopeInput, scope),
    () => store.getLiveDeskState({ ...scope, front_cache: true })
      .then((live) => ({ scope: live.resolved_scope || scope, live })),
  );
}

async function loadNewsSource(store, scopeInput) {
  const context = await liveContext(store, scopeInput);
  const [newsRead, macroRead] = await Promise.all([
    safeResourceRead(() => store.getNewsDigest({
      date: context.scope.trading_date,
      session: context.scope.session,
      pack_id: undefined,
      pack_build_id: undefined,
      as_of_utc: context.live.resolved_scope?.as_of_utc || context.scope.as_of_utc,
      mode: context.scope.mode,
    }), "news_digest_not_available"),
    safeResourceRead(() => loadFrontDailyMacroSource(store, {
      date: context.scope.trading_date,
      mode: context.scope.mode,
      as_of_utc: context.live.resolved_scope?.as_of_utc || context.scope.as_of_utc,
    }), "macro_calendar_not_available"),
  ]);
  const news = newsRead.value || { items: [] };
  return { context, news, macro: macroRead.value, warning: newsRead.warning };
}

function resourceBase(contract, context, warning = null) {
  return {
    contract,
    schemaVersion: "1.0.0",
    scope: {
      strategyId: context.scope.strategy_id || context.live.strategy_id,
      session: context.scope.session || context.live.session,
      tradingDate: context.scope.trading_date || context.live.trading_date || context.live.date,
      mode: context.scope.mode || context.live.mode || "live",
    },
    warnings: warning ? [warning] : [],
  };
}

function liveShell(scope, values) {
  return {
    strategy_id: scope.strategy_id,
    session: scope.session,
    trading_date: scope.trading_date,
    date: scope.trading_date,
    mode: scope.mode,
    resolved_scope: scope,
    ...values,
  };
}

async function safeResourceRead(read, fallbackWarning) {
  try {
    return { value: await read(), warning: null };
  } catch (error) {
    const detail = String(error?.message || error || "unknown_error").replace(/\s+/g, " ").slice(0, 240);
    return { value: null, warning: `${fallbackWarning}:${detail}` };
  }
}

function hasNearMacroEvent(eventsValue, asOfUtc) {
  const nowMs = Date.parse(asOfUtc || "");
  if (!Number.isFinite(nowMs)) return false;
  return (Array.isArray(eventsValue) ? eventsValue : []).some((event) => {
    const timestamp = firstEventTimestamp(event);
    const eventMs = Date.parse(timestamp || "");
    const deltaMs = eventMs - nowMs;
    return Number.isFinite(eventMs) && deltaMs >= 0 && deltaMs <= 90 * 60 * 1000;
  });
}

function firstEventTimestamp(event = {}) {
  return event.scheduled_at_paris || event.timestamp_paris || event.published_at_paris || event.datetime || event.timestamp;
}

function cachedLiveContext(store, key, read) {
  if (!store) return read();
  const cache = liveContextCacheFor(store);
  const now = frontApiResourceEpochMs();
  const existing = cache.get(key);
  if (existing && existing.expiresAt > now) return existing.promise;
  const entry = { expiresAt: Number.POSITIVE_INFINITY, promise: null };
  entry.promise = Promise.resolve()
    .then(read)
    .then((context) => {
      if (cache.get(key) === entry) entry.expiresAt = frontApiResourceEpochMs() + LIVE_CONTEXT_CACHE_TTL_MS;
      return context;
    })
    .catch((error) => {
      if (cache.get(key) === entry) cache.delete(key);
      throw error;
    });
  cache.set(key, entry);
  pruneLiveContextCache(cache, now);
  return entry.promise;
}

function liveContextCacheFor(store) {
  let cache = liveContextCaches.get(store);
  if (!cache) {
    cache = new Map();
    liveContextCaches.set(store, cache);
  }
  return cache;
}

function pruneLiveContextCache(cache, now = frontApiResourceEpochMs()) {
  if (cache.size <= 100) return;
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size > 100) {
    cache.delete(cache.keys().next().value);
  }
}

function frontApiResourceEpochMs() { return FRONT_API_RESOURCE_CLOCK.now().epochMs; }

function liveContextCacheKey(input = {}, scope = {}) {
  const explicitAsOf = Boolean(input.as_of_utc);
  const asOfMs = Date.parse(scope.as_of_utc || "");
  const asOfBucket = explicitAsOf && Number.isFinite(asOfMs) ? Math.floor(asOfMs / LIVE_CONTEXT_CACHE_TTL_MS) : "front-now";
  return JSON.stringify([
    scope.strategy_id,
    scope.session,
    scope.mode,
    scope.trading_date,
    scope.run_id,
    asOfBucket,
  ]);
}

function boundedTtlMs(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}
