const EVENT_FACTS_VERSION = "market_context_event_facts_v1";
const VOLATILITY_SHOCK_THRESHOLD = 0.0075;
const EVENT_WINDOW_MS = 15 * 60_000;

export function buildMarketContextEventFacts(bundle = {}) {
  return {
    schemaVersion: EVENT_FACTS_VERSION,
    marketDataCutoffUtc: isoOrNull(bundle.marketDataCutoffUtc),
    marketSession: text(bundle.canonicalMarketSession?.marketSession),
    sourceStates: Object.fromEntries(array(bundle.sourceStates)
      .map((source) => [text(source.sourceId), text(source.status)])
      .filter(([sourceId]) => sourceId)),
    series: Object.fromEntries(Object.entries(object(bundle.series))
      .map(([key, series]) => [key, seriesFact(series)])),
    nearbyAgriEvents: nearbyAgriEventIds(bundle),
  };
}

export function previousMarketContextEventFactsFromDispatch(row = null) {
  if (!row) return null;
  const metadata = parseObject(row.metadata);
  const stored = object(metadata.event_facts);
  if (stored.schemaVersion === EVENT_FACTS_VERSION) return stored;
  return {
    schemaVersion: "legacy_market_context_dispatch_v1",
    marketDataCutoffUtc: isoOrNull(metadata.market_data_cutoff_utc),
    marketSession: text(metadata.market_session),
    sourceStates: {},
    series: {},
    nearbyAgriEvents: [],
    triggerReasons: strings(metadata.trigger_reasons),
  };
}

export function detectMarketContextEventReasons(bundle = {}) {
  const current = buildMarketContextEventFacts(bundle);
  const previous = previousFacts(bundle);
  const reasons = [
    ...sessionTransitionReasons(current, previous),
    ...sourceTransitionReasons(current, previous),
    ...seriesTransitionReasons(current, previous),
    ...agriEventReasons(current, previous),
  ];
  return [...new Set(reasons)].sort();
}

function previousFacts(bundle) {
  if (bundle.previousEventFacts) return bundle.previousEventFacts;
  const snapshot = bundle.previousSnapshot;
  if (!snapshot) return null;
  return {
    schemaVersion: "market_context_snapshot_fallback_v1",
    marketDataCutoffUtc: isoOrNull(snapshot.marketDataCutoffUtc),
    marketSession: text(snapshot.marketSession),
    sourceStates: Object.fromEntries(array(snapshot.sourceStates)
      .map((source) => [text(source.sourceId), text(source.status)])
      .filter(([sourceId]) => sourceId)),
    series: {},
    nearbyAgriEvents: [],
    triggerReasons: strings(snapshot.triggerReasons),
  };
}

function sessionTransitionReasons(current, previous) {
  if (!previous?.marketSession || previous.marketSession === current.marketSession) return [];
  return ["SESSION_TRANSITION"];
}

function sourceTransitionReasons(current, previous) {
  if (!previous) return [];
  return Object.entries(current.sourceStates).flatMap(([sourceId, status]) => {
    const prior = previous.sourceStates?.[sourceId];
    return prior && prior !== status ? [`SOURCE_${sourceId}_${prior}_TO_${status}`] : [];
  });
}

function seriesTransitionReasons(current, previous) {
  const reasons = [];
  for (const [key, fact] of Object.entries(current.series)) {
    const suffix = key.replace(":", "_");
    const prior = previous?.series?.[key];
    if (!isNewSeriesObservation(fact, prior, previous)) continue;
    if (fact.volatilityShock && !priorSeriesState(prior, previous, `VOLATILITY_SHOCK_${suffix}`, "volatilityShock")) {
      reasons.push(`VOLATILITY_SHOCK_${suffix}`);
    }
    const priorBreak = prior?.structureBreak
      || (strings(previous?.triggerReasons).includes(`STRUCTURE_BREAK_${suffix}`) ? "ANY" : null);
    if (fact.structureBreak && fact.structureBreak !== priorBreak) reasons.push(`STRUCTURE_BREAK_${suffix}`);
  }
  return reasons;
}

function agriEventReasons(current, previous) {
  if (!current.nearbyAgriEvents.length) return [];
  const prior = new Set(array(previous?.nearbyAgriEvents));
  if (!prior.size && strings(previous?.triggerReasons).includes("HIGH_AGRI_EVENT_NEARBY")) return [];
  return current.nearbyAgriEvents.some((eventId) => !prior.has(eventId))
    ? ["HIGH_AGRI_EVENT_NEARBY"] : [];
}

function isNewSeriesObservation(current, previousSeries, previous) {
  if (!previous) return true;
  const priorCutoff = previousSeries?.lastBarClosedAt || previous.marketDataCutoffUtc;
  if (!current.lastBarClosedAt || !priorCutoff) return true;
  return Date.parse(current.lastBarClosedAt) > Date.parse(priorCutoff);
}

function priorSeriesState(previousSeries, previous, reason, property) {
  if (typeof previousSeries?.[property] === "boolean") return previousSeries[property];
  return strings(previous?.triggerReasons).includes(reason);
}

function seriesFact(series = {}) {
  const bars = array(series.bars);
  return {
    lastBarClosedAt: isoOrNull(series.lastBarClosedAt || series.asOf || bars.at(-1)?.closedAt),
    volatilityShock: Number.isFinite(Number(series.return))
      && Math.abs(Number(series.return)) >= VOLATILITY_SHOCK_THRESHOLD,
    structureBreak: structureBreakDirection(bars),
  };
}

function structureBreakDirection(bars) {
  if (bars.length < 4) return null;
  const prior = bars.slice(0, -1);
  const latest = bars.at(-1);
  if (Number(latest.close) > Math.max(...prior.map((bar) => Number(bar.high)))) return "UP";
  if (Number(latest.close) < Math.min(...prior.map((bar) => Number(bar.low)))) return "DOWN";
  return null;
}

function nearbyAgriEventIds(bundle) {
  const cutoff = Date.parse(bundle.analysisAsOfUtc || bundle.cutoff || "");
  if (!Number.isFinite(cutoff)) return [];
  return array(bundle.coveredAgriEvents)
    .filter((event) => ["HIGH", "CRITICAL"].includes(text(event.importance).toUpperCase()))
    .filter((event) => Math.abs(Date.parse(eventTime(event)) - cutoff) <= EVENT_WINDOW_MS)
    .map(agriEventIdentity)
    .filter(Boolean)
    .sort();
}

function agriEventIdentity(event) {
  const canonicalId = text(event.marketAgriEventId || event.market_agri_event_id || event.eventId || event.event_id);
  if (canonicalId) return canonicalId;
  const identityParts = [eventTime(event), event.title, event.sourceProvider || event.source_provider].map(text);
  return identityParts.some(Boolean) ? identityParts.join("|") : null;
}

function eventTime(event) {
  return event.eventTimestampUtc || event.event_timestamp_utc || event.occurredAt || event.occurred_at;
}

function isoOrNull(value) {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function parseObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try { return object(JSON.parse(value)); } catch { return {}; }
}

function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function strings(value) { return array(value).map(text).filter(Boolean); }
function text(value) { return String(value ?? "").trim(); }
