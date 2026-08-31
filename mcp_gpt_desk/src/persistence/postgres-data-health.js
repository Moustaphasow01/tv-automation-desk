import {
  marketDataFreshnessPolicyForSession,
  parisMarketSessionState,
} from "../market-session-state.js";
import { grainsTradingSessionState } from "../us-grains-data-quality.js";

const FALLBACK_INSTRUMENTS = Object.freeze(["MNQ", "MES"]);
const REQUIRED_TIMEFRAMES = Object.freeze(["1", "5"]);
const GRAIN_INSTRUMENTS = new Set(["ZC", "ZW"]);

export async function buildPostgresDataHealth(pool, { nowUtc = new Date().toISOString() } = {}) {
  const activeScopeResult = await pool.query(activeRuntimeInstrumentScopeSql());
  const activeInstruments = normalizeInstruments(activeScopeResult.rows[0]?.instruments);
  const requiredInstruments = activeInstruments.length ? activeInstruments : [...FALLBACK_INSTRUMENTS];
  const [marketResult, schedulerResult] = await Promise.all([
    pool.query(coreFeedHealthSql(), [requiredInstruments]),
    pool.query(liveSchedulerHealthSql()),
  ]);
  return projectDataHealth({
    nowUtc,
    feedRows: marketResult.rows,
    scheduler: schedulerResult.rows[0] || null,
    requiredInstruments,
    scopeSource: activeInstruments.length ? "active_strategy_instances" : "fallback_default",
  });
}

function projectDataHealth({ nowUtc, feedRows, scheduler, requiredInstruments, scopeSource }) {
  const timestampMs = Date.parse(nowUtc);
  const grainScope = requiredInstruments.length > 0 && requiredInstruments.every((instrument) => GRAIN_INSTRUMENTS.has(instrument));
  const marketSession = grainScope ? grainsTradingSessionState(nowUtc) : parisMarketSessionState(new Date(timestampMs));
  const exchangeTimezone = grainScope ? "America/Chicago" : "America/New_York";
  const freshnessPolicy = marketDataFreshnessPolicyForSession(marketSession);
  const feeds = feedRows.map((row) => feedFromRow(row, exchangeTimezone));
  feeds.forEach((feed) => { feed.provenance = marketFeedProvenance(feed); });
  const expectedFeedCount = requiredInstruments.length * REQUIRED_TIMEFRAMES.length;
  const freshness = coreFreshness({ feeds, timestampMs, freshnessPolicy, tradingDate: marketSession.trading_date, expectedFeedCount });
  return {
    ok: marketSession.market_closed === true ? freshness.coreFreshEnough : freshness.currentTradingDayReady,
    state: dataHealthState({ marketClosed: marketSession.market_closed === true, ...freshness, marketSession }),
    market_closed: marketSession.market_closed === true,
    market_session: marketSession,
    freshness_policy: freshnessPolicy,
    core_age_seconds: freshness.core_age_seconds,
    source_health: sourceHealthForCoreFeeds(feeds, expectedFeedCount),
    readiness_scope: {
      source: scopeSource,
      instruments: requiredInstruments,
      timeframes: [...REQUIRED_TIMEFRAMES],
    },
    active_session: marketSession.active_session || marketSession.state,
    exchange_timezone: exchangeTimezone,
    next_eligible_at_utc: marketSession.next_eligible_at_utc || null,
    requested_trading_date: marketSession.trading_date,
    effective_market_date: freshness.effectiveMarketDate,
    core_feeds: feeds,
    scheduler: schedulerProjection(scheduler),
  };
}

function activeRuntimeInstrumentScopeSql() {
  return `SELECT COALESCE(array_agg(DISTINCT upper(trim(scope.instrument)))
                          FILTER (WHERE trim(scope.instrument) <> ''), ARRAY[]::text[]) AS instruments
            FROM strategy_instances si
            CROSS JOIN LATERAL unnest(si.instrument_scope) AS scope(instrument)
           WHERE si.runtime_state = 'running'
             AND si.execution_mode IN ('shadow', 'paper', 'live')`;
}

function coreFeedHealthSql() {
  return `SELECT mf.instrument_code,
                mf.timeframe,
                mf.feed_id,
                mf.provider,
                mf.source_service,
                latest.timestamp_utc AS latest_timestamp_utc,
                (latest.timestamp_utc AT TIME ZONE 'Europe/Paris')::date::text AS latest_market_date,
                latest.imported_at AS latest_imported_at_utc,
                latest.source_collection AS latest_source_collection,
                latest.raw->>'source' AS latest_candle_source,
                event.received_at AS latest_event_received_at_utc,
                event.alert_id AS latest_event_alert_id,
                event.payload->>'source' AS latest_event_payload_source,
                event.raw->>'source' AS latest_event_raw_source
         FROM market_feeds mf
         LEFT JOIN LATERAL (
           SELECT mc.timestamp_utc, mc.imported_at, mc.source_collection, mc.raw
           FROM market_candles mc
           WHERE mc.feed_id = mf.feed_id
             AND mc.is_closed = true
           ORDER BY mc.timestamp_utc DESC
           LIMIT 1
         ) latest ON true
         LEFT JOIN LATERAL (
           SELECT te.received_at, te.alert_id, te.payload, te.raw
           FROM tradingview_events te
           WHERE te.feed_id = mf.feed_id
             AND te.timestamp_utc = latest.timestamp_utc
           ORDER BY te.received_at DESC NULLS LAST, te.updated_at DESC
           LIMIT 1
         ) event ON true
         WHERE mf.enabled = true
           AND mf.environment = 'prod'
           AND mf.instrument_code = ANY($1::text[])
           AND mf.timeframe IN ('1', '5')
         ORDER BY mf.instrument_code, mf.timeframe`;
}

function liveSchedulerHealthSql() {
  return `SELECT service_id, status, details, heartbeat_at_utc, release_version
         FROM desk_service_heartbeats
         WHERE service_id = 'live_runtime_scheduler'
         LIMIT 1`;
}

function feedFromRow(row, exchangeTimezone) {
  return {
    instrument: row.instrument_code,
    timeframe: row.timeframe,
    feed_id: row.feed_id,
    provider: row.provider,
    source_service: row.source_service,
    latest_timestamp_utc: row.latest_timestamp_utc,
    latest_market_date: marketDate(row.latest_timestamp_utc, exchangeTimezone),
    latest_imported_at_utc: row.latest_imported_at_utc,
    latest_received_at_utc: row.latest_event_received_at_utc,
    latest_source_collection: row.latest_source_collection,
    latest_source: row.latest_event_payload_source || row.latest_event_raw_source || row.latest_candle_source || null,
    latest_alert_id: row.latest_event_alert_id || null,
  };
}

function coreFreshness({ feeds, timestampMs, freshnessPolicy, tradingDate, expectedFeedCount }) {
  const effectiveMarketDate = feeds.map((feed) => feed.latest_market_date).filter(Boolean).sort().at(-1) || null;
  const coreReady = feeds.length >= expectedFeedCount && feeds.every((feed) => Boolean(feed.latest_timestamp_utc));
  const oldestCoreLatestMs = feeds
    .map((feed) => Date.parse(feed.latest_timestamp_utc || ""))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
    .at(0);
  const core_age_seconds = Number.isFinite(oldestCoreLatestMs)
    ? Math.max(0, Math.round((timestampMs - oldestCoreLatestMs) / 1000))
    : null;
  const coreFreshEnough = coreReady && core_age_seconds !== null && core_age_seconds <= freshnessPolicy.max_age_seconds;
  return { effectiveMarketDate, coreReady, coreFreshEnough, core_age_seconds, currentTradingDayReady: coreReady && effectiveMarketDate === tradingDate && coreFreshEnough };
}

function dataHealthState({ marketClosed, coreFreshEnough, coreReady, currentTradingDayReady, marketSession }) {
  if (marketClosed) return coreFreshEnough ? marketSession.state : coreReady ? "stale_market_closed" : "missing";
  return currentTradingDayReady ? "ready" : coreReady ? "stale" : "missing";
}

function schedulerProjection(scheduler) {
  return scheduler && {
    status: scheduler.status,
    heartbeat_at_utc: scheduler.heartbeat_at_utc,
    release_version: scheduler.release_version,
    data_state: scheduler.details?.data_state || null,
    data_blocker: scheduler.details?.data_blocker || null,
  };
}

function marketFeedProvenance(feed = {}) {
  const facts = marketFeedSourceFacts(feed);
  const durable = marketFeedDurable(facts);
  const source = String(feed.latest_source || "").trim();
  const sourceService = String(feed.source_service || "").trim();
  return {
    classification: marketFeedClassification(facts, durable),
    durable,
    source: source || null,
    source_service: sourceService || null,
    received_at_utc: feed.latest_received_at_utc || null,
    alert_id: feed.latest_alert_id || null,
    source_collection: feed.latest_source_collection || null,
  };
}

function sourceHealthForCoreFeeds(feeds = [], expectedFeedCount = 0) {
  const core = (feeds || []).filter((feed) => REQUIRED_TIMEFRAMES.includes(String(feed.timeframe)));
  const nonDurable = core.filter((feed) => feed.provenance?.durable !== true);
  return {
    required: true,
    durable: core.length >= expectedFeedCount && nonDurable.length === 0,
    durable_count: countDurableFeeds(core),
    total_count: core.length,
    non_durable_feeds: nonDurable.map(nonDurableFeedProjection),
  };
}

function marketFeedSourceFacts(feed = {}) {
  const source = String(feed.latest_source || "").trim();
  const sourceLower = source.toLowerCase();
  return {
    provider: String(feed.provider || "").toLowerCase(),
    sourceService: String(feed.source_service || "").trim(),
    hasWebhookEvent: Boolean(feed.latest_received_at_utc),
    hasAlertId: Boolean(feed.latest_alert_id),
    rescue: ["rescue", "backfill", "manual", "desktop_recent_ohlcv"].some((marker) => sourceLower.includes(marker)),
    durableSource: ["tradingview_alert_webhook", "tradingview_alert", "alert_webhook"].includes(sourceLower),
  };
}

function marketFeedDurable(facts = {}) {
  return !facts.rescue && facts.provider === "tradingview" && facts.sourceService === "local_tradingview_webhook" && facts.hasWebhookEvent && (facts.hasAlertId || facts.durableSource);
}

function marketFeedClassification(facts = {}, durable = false) {
  if (facts.rescue) return "rescue";
  if (durable) return "durable_alert";
  return facts.hasWebhookEvent ? "webhook_unclassified" : "unknown";
}

function countDurableFeeds(feeds = []) {
  return feeds.filter((feed) => feed.provenance?.durable === true).length;
}

function normalizeInstruments(value) {
  return (Array.isArray(value) ? value : [])
    .map((instrument) => String(instrument || "").trim().toUpperCase())
    .filter(Boolean)
    .sort();
}

function marketDate(value, timeZone) {
  const parsed = Date.parse(value || "");
  if (!Number.isFinite(parsed)) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(parsed)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function nonDurableFeedProjection(feed = {}) {
  const provenance = feed.provenance || {};
  return {
    instrument: feed.instrument,
    timeframe: feed.timeframe,
    feed_id: feed.feed_id || null,
    classification: provenance.classification || "unknown",
    source: provenance.source || null,
    source_service: provenance.source_service || null,
    received_at_utc: provenance.received_at_utc || null,
    alert_id: provenance.alert_id || null,
  };
}
