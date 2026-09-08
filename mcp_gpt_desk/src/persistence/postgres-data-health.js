import {
  marketDataFreshnessPolicyForSession,
  parisMarketSessionState,
} from "../market-session-state.js";
import { grainsTradingSessionState } from "../us-grains-data-quality.js";
import { coreFeedHealthSql } from "./postgres-data-health-query.js";
import { marketFeedIngestionTiming } from "./postgres-data-health-timing.js";
import { GRAINS_DATA_POLICIES, normalizeGrainsDataPolicy, requiredGrainsTimeframes } from "@tv-automation/desk-domain";
import { grainStrategyIdentity, usGrainsStrategyFamilies } from "../us-grains-strategy-catalog.js";
import { grainsDataPolicyFromEnvironment } from "../runtime-config.js";

const FALLBACK_INSTRUMENTS = Object.freeze(["MNQ", "MES"]);
const REQUIRED_TIMEFRAMES = Object.freeze(["1", "5"]);
const GRAIN_INSTRUMENTS = new Set(["ZC", "ZW"]);

export async function buildPostgresDataHealth(pool, {
  nowUtc = new Date().toISOString(), dataPolicy = grainsDataPolicyFromEnvironment(),
} = {}) {
  const compatibleIds = usGrainsStrategyFamilies().flatMap((family) =>
    [...GRAIN_INSTRUMENTS].map((instrument) => grainStrategyIdentity(family, instrument).strategy_instance_id));
  const activeScopeResult = await pool.query(activeRuntimeInstrumentScopeSql(), [compatibleIds]);
  const scopedPolicy = activeScopeResult.rows[0]?.m5_fallback_eligible === true
    ? normalizeGrainsDataPolicy(dataPolicy) : GRAINS_DATA_POLICIES.STRICT;
  const activeInstruments = normalizeInstruments(activeScopeResult.rows[0]?.instruments);
  const requiredInstruments = activeInstruments.length ? activeInstruments : [...FALLBACK_INSTRUMENTS];
  const [marketResult, schedulerResult] = await Promise.all([
    pool.query(coreFeedHealthSql(), [requiredInstruments, nowUtc]),
    pool.query(liveSchedulerHealthSql()),
  ]);
  return projectDataHealth({
    nowUtc,
    feedRows: marketResult.rows,
    scheduler: schedulerResult.rows[0] || null,
    requiredInstruments,
    dataPolicy: scopedPolicy,
    scopeSource: activeInstruments.length ? "active_strategy_instances" : "fallback_default",
  });
}

function healthFrame({ nowUtc, feedRows, requiredInstruments, dataPolicy }) {
  const timestampMs = Date.parse(nowUtc);
  const grainScope = requiredInstruments.length > 0 && requiredInstruments.every((instrument) => GRAIN_INSTRUMENTS.has(instrument));
  const marketSession = grainScope ? grainsTradingSessionState(nowUtc) : parisMarketSessionState(new Date(timestampMs));
  const exchangeTimezone = grainScope ? "America/Chicago" : "America/New_York";
  const freshnessPolicy = marketDataFreshnessPolicyForSession(marketSession);
  const feeds = selectRequiredFeeds(feedRows.map((row) => feedFromRow(row, exchangeTimezone)), requiredInstruments)
    .map((feed) => ({ ...feed, closed_candle_age_seconds: nullableClosedCandleAgeSeconds(feed, timestampMs) }));
  feeds.forEach((feed) => { feed.provenance = marketFeedProvenance(feed); });
  const requiredTimeframes = requiredGrainsTimeframes({ policy: dataPolicy, instruments: requiredInstruments });
  const requiredFeedKeys = requiredFeedKeysForScope(requiredInstruments, requiredTimeframes);
  const freshnessInput = {
    feeds,
    timestampMs,
    freshnessPolicy,
    tradingDate: marketSession.trading_date,
    lastExpectedMarketDate: marketSession.last_expected_market_date,
    lastExpectedCoreClosesUtc:
      marketSession.last_expected_core_close_utc_by_timeframe,
  };
  const freshness = coreFreshness({ ...freshnessInput, requiredFeedKeys });
  const strictFreshness = coreFreshness({ ...freshnessInput, requiredFeedKeys: requiredFeedKeysForScope(requiredInstruments) });
  if (dataPolicy === GRAINS_DATA_POLICIES.M5_FALLBACK) feeds.forEach((feed) => {
    feed.required = requiredTimeframes.includes(feed.timeframe);
    feed.stale = !coreFreshness({ ...freshnessInput, requiredFeedKeys: [feedKey(feed)] }).coreFreshEnough;
  });
  return { feeds, requiredFeedKeys, requiredTimeframes, freshness, strictFreshness, marketSession, freshnessPolicy, exchangeTimezone };
}

function projectDataHealth(input) {
  const { scheduler, requiredInstruments, scopeSource, dataPolicy } = input;
  const { feeds, requiredFeedKeys, requiredTimeframes, freshness, strictFreshness,
    marketSession, freshnessPolicy, exchangeTimezone } = healthFrame(input);
  const ok = marketSession.market_closed === true ? freshness.coreFreshEnough : freshness.currentTradingDayReady;
  const fallback = dataPolicy === GRAINS_DATA_POLICIES.M5_FALLBACK;
  const degraded = fallback && ok && !strictFreshness.coreFreshEnough;
  return {
    ok,
    state: degraded && !marketSession.market_closed ? "degraded"
      : dataHealthState({ marketClosed: marketSession.market_closed === true, ...freshness, marketSession }),
    ...(fallback ? { data_mode: !ok ? "BLOCKED" : degraded ? "M5_FALLBACK" : "M1_M5",
      reason_codes: degraded ? ["US_GRAINS_M1_UNAVAILABLE_M5_FALLBACK"] : [] } : {}),
    market_closed: marketSession.market_closed === true,
    market_session: marketSession,
    freshness_policy: freshnessPolicy,
    core_age_seconds: freshness.core_age_seconds,
    source_health: sourceHealthForCoreFeeds(feeds, requiredFeedKeys),
    readiness_scope: {
      source: scopeSource,
      instruments: requiredInstruments,
      timeframes: requiredTimeframes,
      ...(fallback ? { data_policy: dataPolicy, optional_timeframes: ["1"], execution_mode: "SHADOW" } : {}),
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
                          FILTER (WHERE trim(scope.instrument) <> ''), ARRAY[]::text[]) AS instruments,
                   bool_and(COALESCE(si.strategy_instance_id = ANY($1::uuid[])
                     AND si.execution_mode = 'shadow'
                     AND si.metadata->>'catalog_version' = 'us_grains_strategy_catalog_v1', false)) AS m5_fallback_eligible
            FROM strategy_instances si
            CROSS JOIN LATERAL unnest(si.instrument_scope) AS scope(instrument)
           WHERE si.runtime_state = 'running'
             AND si.execution_mode IN ('shadow', 'paper', 'live')`;
}

function liveSchedulerHealthSql() {
  return `SELECT service_id, status, details, heartbeat_at_utc, release_version
         FROM desk_service_heartbeats
         WHERE service_id = 'live_runtime_scheduler'
         LIMIT 1`;
}

function feedFromRow(row, exchangeTimezone) {
  const latestClosedAtUtc = row.latest_candle_close_utc || closeAtUtc(row.latest_timestamp_utc, row.timeframe);
  const ingestionTiming = marketFeedIngestionTiming(row, latestClosedAtUtc);
  const eventFields = projectedEventFields(row, ingestionTiming);
  return {
    instrument: row.instrument_code,
    timeframe: row.timeframe,
    feed_id: row.feed_id,
    provider: row.provider,
    source_service: row.source_service,
    latest_timestamp_utc: row.latest_timestamp_utc,
    latest_market_date: marketDate(row.latest_timestamp_utc, exchangeTimezone),
    latest_closed_candle_at_utc: latestClosedAtUtc,
    latest_imported_at_utc: row.latest_imported_at_utc,
    latest_received_at_utc: eventFields.receivedAtUtc,
    latest_source_collection: row.latest_source_collection,
    latest_source: eventFields.source || row.latest_candle_source || null,
    latest_alert_id: eventFields.alertId,
    earliest_available_received_at_utc: row.earliest_available_received_at_utc || null,
    timing_provenance_version: row.latest_timing_provenance_version || null,
    ingestion_timing: ingestionTiming,
  };
}

function projectedEventFields(row, ingestionTiming) {
  if (ingestionTiming.provenance === "current_event_linked") {
    return {
      receivedAtUtc: row.current_event_received_at_utc || null,
      source: row.current_event_payload_source || row.current_event_raw_source || null,
      alertId: row.current_event_alert_id || null,
    };
  }
  if (row.latest_timing_provenance_version === "tradingview_webhook_timing_v1") {
    return { receivedAtUtc: null, source: null, alertId: null };
  }
  return {
    receivedAtUtc: row.latest_event_received_at_utc || null,
    source: row.latest_event_payload_source || row.latest_event_raw_source || null,
    alertId: row.latest_event_alert_id || null,
  };
}

function coreFreshness(input) {
  const { feeds, requiredFeedKeys, timestampMs, freshnessPolicy, tradingDate } = input;
  const feedsByKey = new Map(feeds.map((feed) => [feedKey(feed), feed]));
  const requiredFeeds = requiredFeedKeys.map((key) => feedsByKey.get(key) || null);
  const ages = requiredFeeds.map((feed) => closedCandleAgeSeconds(feed, timestampMs));
  const coreReady = requiredFeeds.every(Boolean) && ages.every(Number.isFinite);
  const core_age_seconds = coreReady ? Math.max(...ages) : null;
  const marketDates = requiredFeeds.map((feed) => feed?.latest_market_date).filter(Boolean);
  const effectiveMarketDate = marketDates.length === requiredFeedKeys.length && new Set(marketDates).size === 1
    ? marketDates[0]
    : null;
  const marketDateReady = coreReady && requiredFeeds.every((feed) => feed.latest_market_date === tradingDate);
  const lastExpectedDateReady = !input.lastExpectedMarketDate
    || requiredFeeds.every((feed) => feed?.latest_market_date === input.lastExpectedMarketDate);
  const lastExpectedCloseReady = lastExpectedClosesReady(
    requiredFeeds,
    input.lastExpectedCoreClosesUtc,
  );
  const coreFreshEnough = coreReady
    && lastExpectedDateReady
    && lastExpectedCloseReady
    && core_age_seconds <= freshnessPolicy.max_age_seconds;
  return {
    effectiveMarketDate,
    coreReady,
    coreFreshEnough,
    core_age_seconds,
    marketDateReady,
    currentTradingDayReady: marketDateReady && coreFreshEnough,
  };
}

function lastExpectedClosesReady(feeds, expectedByTimeframe) {
  if (!expectedByTimeframe) return true;
  return feeds.every((feed) => {
    const expected = expectedByTimeframe[String(feed?.timeframe || "")];
    return !expected
      || Date.parse(feed?.latest_closed_candle_at_utc || "") === Date.parse(expected);
  });
}

function closedCandleAgeSeconds(feed, timestampMs) {
  const closeMs = Date.parse(feed?.latest_closed_candle_at_utc || "");
  if (!Number.isFinite(closeMs) || closeMs > timestampMs) return NaN;
  return Math.round((timestampMs - closeMs) / 1000);
}

function nullableClosedCandleAgeSeconds(feed, timestampMs) {
  const age = closedCandleAgeSeconds(feed, timestampMs);
  return Number.isFinite(age) ? age : null;
}

function timeframeSeconds(timeframe) {
  return ({
    "1": 60,
    "5": 5 * 60,
    "15": 15 * 60,
    "30": 30 * 60,
    "1H": 60 * 60,
    "60": 60 * 60,
    "4H": 4 * 60 * 60,
    "240": 4 * 60 * 60,
  })[String(timeframe || "")] || 60;
}

function closeAtUtc(timestampUtc, timeframe) {
  const timestampMs = Date.parse(timestampUtc || "");
  if (!Number.isFinite(timestampMs)) return null;
  return new Date(timestampMs + (timeframeSeconds(timeframe) * 1000)).toISOString();
}

function requiredFeedKeysForScope(instruments, timeframes = REQUIRED_TIMEFRAMES) {
  return instruments.flatMap((instrument) => timeframes.map((timeframe) => `${instrument}|${timeframe}`));
}

function selectRequiredFeeds(feeds, requiredInstruments) {
  const requiredKeys = new Set(requiredFeedKeysForScope(requiredInstruments));
  const selected = new Map();
  for (const feed of feeds) {
    const key = feedKey(feed);
    if (!requiredKeys.has(key) || feedIsOlderThan(feed, selected.get(key))) continue;
    selected.set(key, feed);
  }
  return [...selected.values()].sort((left, right) => feedKey(left).localeCompare(feedKey(right)));
}

function feedIsOlderThan(candidate, existing) {
  if (!existing) return false;
  const candidateMs = Date.parse(candidate.latest_closed_candle_at_utc || "");
  const existingMs = Date.parse(existing.latest_closed_candle_at_utc || "");
  if (!Number.isFinite(candidateMs)) return true;
  if (!Number.isFinite(existingMs)) return false;
  if (candidateMs !== existingMs) return candidateMs < existingMs;
  return String(candidate.feed_id || "") > String(existing.feed_id || "");
}

function feedKey(feed) {
  return `${String(feed?.instrument || "").toUpperCase()}|${String(feed?.timeframe || "")}`;
}

function dataHealthState({ marketClosed, coreFreshEnough, coreReady, currentTradingDayReady, marketSession }) {
  if (marketClosed) return coreFreshEnough ? marketSession.state : coreReady ? "stale_market_closed" : "missing";
  if (marketSession.reopen_data_grace_active && !currentTradingDayReady) return "awaiting_first_closed_bar";
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

function sourceHealthForCoreFeeds(feeds = [], requiredFeedKeys = []) {
  const requiredKeys = new Set(requiredFeedKeys);
  const core = (feeds || []).filter((feed) => requiredKeys.has(feedKey(feed)));
  const nonDurable = core.filter((feed) => feed.provenance?.durable !== true);
  return {
    required: true,
    durable: core.length === requiredKeys.size && nonDurable.length === 0,
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
    eventLinkMismatch: feed.timing_provenance_version === "tradingview_webhook_timing_v1"
      && feed.ingestion_timing?.provenance !== "current_event_linked",
    rescue: ["rescue", "backfill", "manual", "desktop_recent_ohlcv"].some((marker) => sourceLower.includes(marker)),
    durableSource: ["tradingview_alert_webhook", "tradingview_alert", "alert_webhook"].includes(sourceLower),
  };
}

function marketFeedDurable(facts = {}) {
  return !facts.rescue && !facts.eventLinkMismatch && facts.provider === "tradingview" && facts.sourceService === "local_tradingview_webhook" && facts.hasWebhookEvent && (facts.hasAlertId || facts.durableSource);
}

function marketFeedClassification(facts = {}, durable = false) {
  if (facts.rescue) return "rescue";
  if (facts.eventLinkMismatch) return "event_link_mismatch";
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
