import { SystemClock, toParisIso } from "@tv-automation/desk-time";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { impactRank } from "./desk-pack-service.js";
import { sanitizeMacroActualsAtCutoff } from "./pack-integrity.js";

const COLLECTIONS = DESK_COLLECTIONS;
const DEFAULT_SOURCE_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const DEFAULT_ACTUAL_SOURCE_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.ics";
const DEFAULT_ACTUAL_EVENT_URL_TEMPLATE = "https://faireconomy.media/calendar/{event_id}.json";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_REFRESH_MS = 2 * 60_000;
const DEFAULT_ACTUAL_INDEX_REFRESH_MS = 30 * 60_000;
const DEFAULT_INSTRUMENTS = ["MNQ", "MES"];
const US_INDEX_ASSETS = ["MNQ", "MES", "NQ", "ES", "YM", "RTY", "SPX", "DXY", "US10Y", "US02Y"];
const ENERGY_ASSETS = ["MCL", "CL", "WTI", "OIL", "CRUDE", "ENERGY", "PETROLEUM"];
const MACRO_KEYWORDS = ["FOMC", "FED", "CPI", "PCE", "NFP", "NON-FARM", "PAYROLL", "POWELL", "RATE", "GDP", "ISM", "PPI", "CLAIMS", "RETAIL SALES"];
const ENERGY_KEYWORDS = ["EIA", "API", "OPEC", "CRUDE", "OIL", "PETROLEUM", "WTI", "INVENTORIES", "SANCTIONS", "MIDDLE EAST", "RUSSIA"];

export class MacroCalendarService {
  constructor({
    persistence,
    clock = new SystemClock(),
    fetchImpl = globalThis.fetch,
    sourceUrl = process.env.DESK_MACRO_CALENDAR_URL || DEFAULT_SOURCE_URL,
    actualSourceUrl = process.env.DESK_FOREX_FACTORY_ACTUAL_URL || DEFAULT_ACTUAL_SOURCE_URL,
    actualEventUrlTemplate = process.env.DESK_FOREX_FACTORY_ACTUAL_EVENT_URL_TEMPLATE || DEFAULT_ACTUAL_EVENT_URL_TEMPLATE,
    actualIndexRefreshMs = process.env.DESK_FOREX_FACTORY_ACTUAL_INDEX_REFRESH_MS,
    timeoutMs = process.env.DESK_MACRO_CALENDAR_TIMEOUT_MS,
    minimumRefreshMs = process.env.DESK_MACRO_CALENDAR_MIN_REFRESH_MS,
  } = {}) {
    if (!persistence) throw new Error("document_persistence_required");
    if (typeof fetchImpl !== "function") throw new Error("macro_calendar_fetch_required");
    this.persistence = persistence;
    this.clock = clock;
    this.fetchImpl = fetchImpl;
    this.sourceUrl = String(sourceUrl || DEFAULT_SOURCE_URL);
    this.actualSourceUrl = String(actualSourceUrl || DEFAULT_ACTUAL_SOURCE_URL);
    this.actualEventUrlTemplate = String(actualEventUrlTemplate || DEFAULT_ACTUAL_EVENT_URL_TEMPLATE);
    this.timeoutMs = boundedNumber(timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 60_000);
    this.minimumRefreshMs = boundedNumber(minimumRefreshMs, DEFAULT_REFRESH_MS, 60_000, 6 * 60 * 60_000);
    this.actualIndexRefreshMs = boundedNumber(actualIndexRefreshMs, DEFAULT_ACTUAL_INDEX_REFRESH_MS, 5 * 60_000, 6 * 60 * 60_000);
    this.actualIndexCache = null;
    this.actualIndexFetchedAtMs = 0;
  }

  async refresh({ anchor_date, requested_by = "live_runtime_scheduler", force = false } = {}) {
    const tick = this.clock.now();
    const fetchedAtUtc = normalizeInstant(tick.utc);
    const anchorDate = validDate(anchor_date) || toParisIso(Date.parse(fetchedAtUtc)).slice(0, 10);
    const previousState = await this.persistence.getDocument(COLLECTIONS.macroNewsState, "current").catch(() => null);
    const previousFetchMs = Date.parse(previousState?.fetched_at_utc || "");
    const previousStatus = String(previousState?.status || "");
    if (!force
      && ["READY", "PARTIAL", "MISSING", "FETCH_FAILED"].includes(previousStatus)
      && Number.isFinite(previousFetchMs)
      && Date.parse(fetchedAtUtc) - previousFetchMs < this.minimumRefreshMs) {
      const coverage = await this.getCoverage({ anchor_date: anchorDate });
      return {
        ok: previousStatus === "READY",
        status: previousStatus,
        anchor_date: anchorDate,
        source: "faireconomy_forex_factory",
        source_url: this.sourceUrl,
        fetched_at_utc: new Date(previousFetchMs).toISOString(),
        events_received: previousState.events_received_count ?? null,
        events_written: 0,
        reused_existing_fetch: true,
        actual_source: previousState.actual_source || null,
        coverage,
      };
    }
    let response = [];
    let scheduleError = null;
    try {
      response = await fetchJson(this.fetchImpl, this.sourceUrl, this.timeoutMs);
    } catch (error) {
      scheduleError = error;
    }

    const rawEvents = Array.isArray(response) ? response : [];
    let normalizedSchedule = normalizeMacroCalendarEvents(rawEvents, {
      nowUtc: fetchedAtUtc,
      sourceUrl: this.sourceUrl,
    });
    let actualSource;
    let actualObservations = [];
    try {
      const fetchedAtMs = Date.parse(fetchedAtUtc);
      const indexDue = !this.actualIndexCache
        || fetchedAtMs - this.actualIndexFetchedAtMs >= this.actualIndexRefreshMs;
      let indexReused = !indexDue;
      let indexWarning = null;
      if (indexDue) {
        try {
          const ics = await fetchText(this.fetchImpl, this.actualSourceUrl, this.timeoutMs, "text/calendar,text/plain");
          this.actualIndexCache = parseForexFactoryCalendarIcs(ics);
          this.actualIndexFetchedAtMs = fetchedAtMs;
          indexReused = false;
        } catch (error) {
          if (!this.actualIndexCache) throw error;
          indexReused = true;
          indexWarning = String(error?.message || error).slice(0, 300);
        }
      }
      const indexed = this.actualIndexCache || [];
      const candidates = selectForexFactoryActualCandidates(indexed, {
        nowUtc: fetchedAtUtc,
        force,
      });
      const fetched = await mapWithConcurrency(candidates, 5, async (event) => {
        const eventUrl = this.actualEventUrlTemplate.replace("{event_id}", encodeURIComponent(event.id));
        try {
          const payload = await fetchJson(this.fetchImpl, eventUrl, this.timeoutMs);
          return {
            ok: true,
            event: {
              ...event,
              ...payload,
              id: payload?.event_id ?? event.id,
              name: event.name,
              currency: event.currency,
              actual_source_url: eventUrl,
            },
          };
        } catch (error) {
          const message = String(error?.message || error).slice(0, 300);
          if (message.endsWith(":404")) {
            return {
              ok: true,
              unavailable: true,
              event: {
                ...event,
                actual: null,
                actual_source_url: eventUrl,
              },
            };
          }
          return { ok: false, event, error: message };
        }
      });
      const successful = fetched.filter((item) => item.ok).map((item) => item.event);
      const unavailable = fetched.filter((item) => item.unavailable);
      const failed = fetched.filter((item) => !item.ok);
      actualObservations = normalizeForexFactoryActualObservations(successful, {
        fetchedAtUtc,
        sourceUrl: this.actualSourceUrl,
      });
      actualSource = {
        status: failed.length || indexWarning ? (successful.length || indexReused ? "PARTIAL" : "FETCH_FAILED") : "READY",
        source: "forex_factory_calendar",
        source_url: this.actualSourceUrl,
        fetched_at_utc: fetchedAtUtc,
        events_received: indexed.length,
        index_reused: indexReused,
        index_warning: indexWarning,
        events_requested: candidates.length,
        events_unavailable: unavailable.length,
        events_failed: failed.length,
        actuals_received: actualObservations.length,
        actuals_matched: 0,
        error: failed.length ? failed.map((item) => `${item.event.id}:${item.error}`).slice(0, 5).join("; ") : null,
      };
    } catch (error) {
      actualSource = {
        status: "FETCH_FAILED",
        source: "forex_factory_calendar",
        source_url: this.actualSourceUrl,
        fetched_at_utc: fetchedAtUtc,
        events_received: 0,
        index_reused: false,
        index_warning: null,
        events_requested: 0,
        events_unavailable: 0,
        events_failed: 0,
        actuals_received: 0,
        actuals_matched: 0,
        error: String(error?.message || error).slice(0, 500),
      };
    }
    if (scheduleError && actualObservations.length) {
      normalizedSchedule = await loadPersistedScheduleForActuals(this.persistence, actualObservations);
    }
    const enriched = enrichMacroEventsWithForexFactoryActuals(normalizedSchedule, actualObservations);
    const normalized = enriched.events;
    actualSource.actuals_matched = enriched.matched;
    const writes = [];
    for (const event of normalized) {
      const existing = await this.persistence.getDocument(COLLECTIONS.macroCalendarEvents, event.event_id).catch(() => null);
      writes.push({
        collection: COLLECTIONS.macroCalendarEvents,
        documentId: event.event_id,
        data: mergeObservedMacroEvent(existing, event, fetchedAtUtc),
        merge: true,
      });
    }
    if (writes.length) {
      if (typeof this.persistence.writeDocuments === "function") await this.persistence.writeDocuments(writes);
      else {
        for (const write of writes) {
          await this.persistence.setDocument(write.collection, write.documentId, write.data, { merge: true });
        }
      }
    }

    const coverage = await this.getCoverage({ anchor_date: anchorDate });
    const status = scheduleError
      ? "FETCH_FAILED"
      : coverage.missing_required_dates.length
        ? coverage.total_event_count ? "PARTIAL" : "MISSING"
        : "READY";
    const state = await this.#saveState({
      anchorDate,
      fetchedAtUtc,
      requestedBy: requested_by,
      status,
      sourceEventCount: rawEvents.length,
      writtenEventCount: writes.length,
      coverage,
      events: normalized,
      actualSource,
      error: scheduleError?.message || (scheduleError ? String(scheduleError) : null),
    });
    await this.#syncCoverageAlert({ anchorDate, fetchedAtUtc, status, coverage, error: scheduleError });
    return {
      ok: status === "READY",
      status,
      anchor_date: anchorDate,
      source: "faireconomy_forex_factory",
      source_url: this.sourceUrl,
      fetched_at_utc: fetchedAtUtc,
      events_received: rawEvents.length,
      events_written: writes.length,
      actual_source: actualSource,
      error: state.last_error,
      coverage,
    };
  }

  async getDailyCalendar({ date, importance_min = "medium", as_of_utc } = {}) {
    const requestedDate = validDate(date);
    if (!requestedDate) throw new Error(`MACRO_CALENDAR_DATE_INVALID:${date}`);
    const events = await this.persistence.queryCollectionDocuments({
      collection: COLLECTIONS.macroCalendarEvents,
      filters: [{ field: "date", operator: "==", value: requestedDate }],
      orderBy: [
        { field: "timestamp_utc", direction: "asc" },
        { field: "event_id", direction: "asc" },
      ],
      limit: 500,
    }).catch(() => []);
    const selected = events
      .filter((event) => event && event.active !== false)
      .filter((event) => impactRank(event.impact || event.importance) >= impactRank(importance_min));
    const cutoffUtc = as_of_utc ? normalizeInstant(as_of_utc) : normalizeInstant(this.clock.now().utc);
    return {
      ok: true,
      date: requestedDate,
      importance_min,
      source: "macro_calendar_events",
      fallback: true,
      as_of_utc: cutoffUtc,
      events: sanitizeMacroActualsAtCutoff(selected, cutoffUtc),
    };
  }

  async getWindowCalendar({
    date,
    as_of_utc,
    before_hours = 48,
    after_hours = 48,
    importance_min = "low",
  } = {}) {
    const tick = this.clock.now();
    const centerUtc = normalizeInstant(as_of_utc || tick.utc);
    const beforeHours = boundedNumber(before_hours, 48, 0, 168);
    const afterHours = boundedNumber(after_hours, 48, 0, 168);
    const centerMs = Date.parse(centerUtc);
    const fromUtc = new Date(centerMs - beforeHours * 60 * 60_000).toISOString();
    const toUtc = new Date(centerMs + afterHours * 60 * 60_000).toISOString();
    const events = await this.persistence.queryCollectionDocuments({
      collection: COLLECTIONS.macroCalendarEvents,
      filters: [
        { field: "timestamp_utc", operator: ">=", value: fromUtc },
        { field: "timestamp_utc", operator: "<=", value: toUtc },
      ],
      orderBy: [
        { field: "timestamp_utc", direction: "asc" },
        { field: "event_id", direction: "asc" },
      ],
      limit: 1_000,
    }).catch(() => []);
    const selected = events
      .filter((event) => event && event.active !== false)
      .filter((event) => impactRank(event.impact || event.importance) >= impactRank(importance_min));
    return {
      ok: true,
      date: validDate(date),
      importance_min,
      source: "macro_calendar_events",
      fallback: true,
      as_of_utc: centerUtc,
      window: {
        before_hours: beforeHours,
        after_hours: afterHours,
        from_utc: fromUtc,
        to_utc: toUtc,
      },
      events: sanitizeMacroActualsAtCutoff(selected, centerUtc),
    };
  }

  async getCoverage({ anchor_date } = {}) {
    const tick = this.clock.now();
    const anchorDate = validDate(anchor_date) || toParisIso(Date.parse(tick.utc)).slice(0, 10);
    const calendarDates = [addDays(anchorDate, -1), anchorDate, addDays(anchorDate, 1)];
    const previousTradingDate = previousBusinessDay(anchorDate);
    const nextTradingDate = nextBusinessDay(anchorDate);
    const dates = [...new Set([...calendarDates, previousTradingDate, nextTradingDate])];
    const entries = await Promise.all(dates.map(async (date) => {
      const rows = await this.persistence.queryCollectionDocuments({
        collection: COLLECTIONS.macroCalendarEvents,
        filters: [{ field: "date", operator: "==", value: date }],
        orderBy: [{ field: "timestamp_utc", direction: "asc" }],
        limit: 500,
      }).catch(() => []);
      return [date, rows.filter((event) => event?.active !== false).length];
    }));
    const counts = Object.fromEntries(entries);
    const requiredDates = [...new Set([
      ...calendarDates.filter(isWeekday),
      previousTradingDate,
      nextTradingDate,
    ])];
    const missingRequiredDates = requiredDates.filter((date) => Number(counts[date] || 0) === 0);
    return {
      anchor_date: anchorDate,
      calendar_window: {
        previous_date: calendarDates[0],
        current_date: calendarDates[1],
        next_date: calendarDates[2],
      },
      trading_window: {
        previous_trading_date: previousTradingDate,
        next_trading_date: nextTradingDate,
      },
      counts_by_date: counts,
      required_dates: requiredDates,
      missing_required_dates: missingRequiredDates,
      next_trading_date_ready: Number(counts[nextTradingDate] || 0) > 0,
      total_event_count: Object.values(counts).reduce((total, count) => total + Number(count || 0), 0),
    };
  }

  async #saveState({
    anchorDate,
    fetchedAtUtc,
    requestedBy,
    status,
    sourceEventCount,
    writtenEventCount,
    coverage,
    events = [],
    actualSource = null,
    error = null,
  }) {
    const previous = await this.persistence.getDocument(COLLECTIONS.macroNewsState, "current").catch(() => ({}));
    const state = {
      ...previous,
      schema_version: "macro_calendar_state_v4",
      state_id: "current",
      source: "faireconomy_forex_factory",
      source_url: this.sourceUrl,
      status,
      global_status: status === "READY" ? "NORMAL" : "CAUTION",
      stale: status === "FETCH_FAILED",
      source_missing: sourceEventCount === 0,
      fetched_at_utc: fetchedAtUtc,
      refreshed_at_utc: fetchedAtUtc,
      refreshed_at_paris: toParisIso(Date.parse(fetchedAtUtc)),
      requested_anchor_date: anchorDate,
      events_received_count: sourceEventCount,
      events_written_count: writtenEventCount,
      events_today_count: Number(coverage.counts_by_date?.[anchorDate] || 0),
      coverage,
      last_error: error ? String(error).slice(0, 500) : null,
      events_window: events.slice(0, 120),
      actual_source: actualSource,
      source_health: {
        calendar_loaded: sourceEventCount > 0,
        actuals_loaded: actualSource?.status === "READY",
        actuals_received: actualSource?.actuals_received ?? null,
        actuals_matched: actualSource?.actuals_matched ?? null,
        actual_source_error: actualSource?.error || null,
        stale: status === "FETCH_FAILED",
        single_source: true,
        multi_source_confirmed: actualSource?.status === "READY",
        refreshed_by: requestedBy,
      },
      refreshed_by: requestedBy,
    };
    await this.persistence.setDocument(COLLECTIONS.macroNewsState, "current", state, { merge: true });
    return state;
  }

  async #syncCoverageAlert({ anchorDate, fetchedAtUtc, status, coverage, error = null }) {
    const targetDate = coverage.trading_window.next_trading_date;
    const alertId = `macro_calendar_coverage__${targetDate}`;
    const current = await this.persistence.getDocument(COLLECTIONS.deskAlerts, alertId).catch(() => null);
    const ready = status === "READY";
    if (ready && !current) return;
    const timestampParis = toParisIso(Date.parse(fetchedAtUtc));
    const alert = {
      ...(current || {}),
      alert_id: alertId,
      alert_type: "MACRO_CALENDAR_COVERAGE",
      status: ready ? "RESOLVED" : "OPEN",
      level: ready ? "positive" : status === "FETCH_FAILED" ? "critical" : "warning",
      severity: ready ? "INFO" : status === "FETCH_FAILED" ? "CRITICAL" : "WARNING",
      title: ready ? "Calendrier macro disponible" : "Calendrier macro incomplet",
      message: ready
        ? `La couverture macro est prête pour la prochaine séance (${targetDate}).`
        : `Dates macro manquantes : ${coverage.missing_required_dates.join(", ") || targetDate}.${error ? ` Source indisponible : ${error.message || String(error)}` : ""}`,
      coverage,
      target_trading_date: targetDate,
      timestamp_paris: timestampParis,
      timestamp_utc: fetchedAtUtc,
      created_at: current?.created_at || fetchedAtUtc,
      created_at_utc: current?.created_at_utc || fetchedAtUtc,
      created_at_paris: current?.created_at_paris || timestampParis,
      updated_at_utc: fetchedAtUtc,
      updated_at_paris: timestampParis,
      resolved_at_utc: ready ? fetchedAtUtc : null,
    };
    await this.persistence.setDocument(COLLECTIONS.deskAlerts, alertId, alert, { merge: true });
  }
}

export function normalizeMacroCalendarEvents(rawEvents, { nowUtc, sourceUrl = DEFAULT_SOURCE_URL } = {}) {
  const nowMs = Date.parse(normalizeInstant(nowUtc || new Date().toISOString()));
  return (rawEvents || [])
    .map((raw) => normalizeMacroEvent(raw, { nowMs, sourceUrl }))
    .filter(Boolean)
    .sort((left, right) => left.timestamp_utc.localeCompare(right.timestamp_utc)
      || left.event_id.localeCompare(right.event_id));
}

export function parseForexFactoryCalendarHtml(html) {
  const source = String(html || "");
  const markers = ["days: [", "\"days\":["];
  for (const marker of markers) {
    let cursor = 0;
    while (cursor < source.length) {
      const markerIndex = source.indexOf(marker, cursor);
      if (markerIndex < 0) break;
      const arrayStart = source.indexOf("[", markerIndex + marker.indexOf("["));
      const arrayEnd = matchingJsonArrayEnd(source, arrayStart);
      cursor = markerIndex + marker.length;
      if (arrayStart < 0 || arrayEnd < 0) continue;
      try {
        const days = JSON.parse(source.slice(arrayStart, arrayEnd + 1));
        if (!Array.isArray(days)) continue;
        const events = days.flatMap((day) => Array.isArray(day?.events) ? day.events : []);
        if (events.length) return events;
      } catch {
        // Forex Factory can embed more than one calendar component. Continue
        // until a complete, parseable `days` payload is found.
      }
    }
  }
  throw new Error("forex_factory_calendar_payload_not_found");
}

export function parseForexFactoryCalendarIcs(ics) {
  const unfolded = String(ics || "").replace(/\r?\n[ \t]/g, "");
  const events = [];
  for (const block of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const body = block.split("END:VEVENT", 1)[0] || "";
    const uid = icsValue(body, "UID");
    const summary = unescapeIcsValue(icsValue(body, "SUMMARY"));
    const dateLine = body.match(/^DTSTART(?:;TZID=([^:;\r\n]+))?:(\d{8}T\d{6}Z?)$/m);
    if (!uid || !summary || !dateLine) continue;
    const timestampUtc = icsDateTimeToUtc(dateLine[2], dateLine[1] || "UTC");
    if (!timestampUtc) continue;
    const normalizedSummary = summary.replace(/^[^A-Za-z0-9]*/, "").trim();
    const prefix = normalizedSummary.match(/^([A-Z]{2})\s+(.+)$/);
    const country = prefix?.[1] || "";
    const title = prefix?.[2] || normalizedSummary;
    events.push({
      id: uid,
      name: title,
      currency: forexFactoryCurrency(country),
      country,
      dateline: Math.floor(Date.parse(timestampUtc) / 1_000),
      timestamp_utc: timestampUtc,
    });
  }
  if (!events.length) throw new Error("forex_factory_ics_events_not_found");
  return events;
}

export function normalizeForexFactoryActualObservations(
  rawEvents,
  { fetchedAtUtc, sourceUrl = DEFAULT_ACTUAL_SOURCE_URL } = {},
) {
  const observedAtUtc = normalizeInstant(fetchedAtUtc || new Date().toISOString());
  const observations = new Map();
  for (const raw of rawEvents || []) {
    const actual = optionalValue(raw?.actual);
    const eventMs = Number(raw?.dateline) * 1_000;
    const title = stringValue(raw?.name || raw?.title || raw?.event);
    if (!actual || !Number.isFinite(eventMs) || !title) continue;
    const timestampUtc = new Date(eventMs).toISOString();
    const timestampParis = toParisIso(eventMs);
    const date = timestampParis.slice(0, 10);
    const timeParis = timestampParis.slice(11, 16);
    const eventId = safeDocumentId(date, timeParis, title.slice(0, 80));
    observations.set(eventId, {
      event_id: eventId,
      title,
      currency: stringValue(raw?.currency).toUpperCase() || null,
      timestamp_utc: timestampUtc,
      timestamp_paris: timestampParis,
      actual,
      actual_source: "forex_factory_calendar",
      actual_source_url: raw?.actual_source_url || sourceUrl,
      actual_source_event_id: raw?.id == null ? null : String(raw.id),
      actual_observed_at_utc: observedAtUtc,
      actual_better_worse: numberOrNull(raw?.actualBetterWorse),
    });
  }
  return [...observations.values()];
}

function enrichMacroEventsWithForexFactoryActuals(events, observations) {
  const byEventId = new Map((observations || []).map((item) => [item.event_id, item]));
  const byIdentity = new Map();
  const byDateCurrency = new Map();
  for (const item of observations || []) {
    const key = macroIdentity(item);
    if (!byIdentity.has(key)) byIdentity.set(key, []);
    byIdentity.get(key).push(item);
    const dateCurrency = macroDateCurrency(item);
    if (!byDateCurrency.has(dateCurrency)) byDateCurrency.set(dateCurrency, []);
    byDateCurrency.get(dateCurrency).push(item);
  }
  let matched = 0;
  const enriched = (events || []).map((event) => {
    let observation = byEventId.get(event.event_id);
    if (!observation) {
      const eventMs = Date.parse(event.timestamp_utc || "");
      observation = (byIdentity.get(macroIdentity(event)) || []).find((candidate) => {
        const candidateMs = Date.parse(candidate.timestamp_utc || "");
        return Number.isFinite(eventMs)
          && Number.isFinite(candidateMs)
          && Math.abs(candidateMs - eventMs) <= 10 * 60_000;
      });
    }
    if (!observation) {
      const eventMs = Date.parse(event.timestamp_utc || "");
      observation = (byDateCurrency.get(macroDateCurrency(event)) || []).find((candidate) => {
        const candidateMs = Date.parse(candidate.timestamp_utc || "");
        return Number.isFinite(eventMs)
          && Number.isFinite(candidateMs)
          && Math.abs(candidateMs - eventMs) <= 10 * 60_000
          && comparableMacroTitle(candidate.title) === comparableMacroTitle(event.title);
      });
    }
    if (!observation) return event;
    matched += 1;
    return {
      ...event,
      actual: observation.actual,
      actual_source: observation.actual_source,
      actual_source_url: observation.actual_source_url,
      actual_source_event_id: observation.actual_source_event_id,
      actual_observed_at_utc: observation.actual_observed_at_utc,
      actual_better_worse: observation.actual_better_worse,
    };
  });
  return { events: enriched, matched };
}

function normalizeMacroEvent(raw, { nowMs, sourceUrl }) {
  const rawDate = stringValue(raw?.date || raw?.datetime || raw?.timestamp);
  if (!rawDate) return null;
  const eventMs = Date.parse(rawDate.replace(" ", "T"));
  if (!Number.isFinite(eventMs)) return null;
  const timestampUtc = new Date(eventMs).toISOString();
  const timestampParis = toParisIso(eventMs);
  const date = timestampParis.slice(0, 10);
  const timeParis = timestampParis.slice(11, 16);
  const title = stringValue(raw?.title || raw?.name || raw?.event) || "unknown";
  const currency = stringValue(raw?.country || raw?.currency).toUpperCase();
  const impact = normalizeImpact(raw?.impact || raw?.importance);
  const assets = assetsForEvent(currency, title);
  return {
    event_id: safeDocumentId(date, timeParis, title.slice(0, 80)),
    date,
    time_paris: timeParis,
    timestamp_utc: timestampUtc,
    timestamp_paris: timestampParis,
    scheduled_at_utc: timestampUtc,
    scheduled_at_paris: timestampParis,
    title,
    event: title,
    impact,
    importance: impact,
    currency: currency || null,
    assets,
    instrument_scope: instrumentScope(currency, title, assets),
    previous: optionalValue(raw?.previous),
    forecast: optionalValue(raw?.forecast),
    actual: optionalValue(raw?.actual),
    minutes_until: Math.round(((eventMs - nowMs) / 60_000) * 10) / 10,
    active: true,
    source: "faireconomy_forex_factory",
    source_url: sourceUrl,
    source_event: {
      title,
      country: currency || null,
      date: rawDate,
      impact: raw?.impact ?? null,
      previous: raw?.previous ?? null,
      forecast: raw?.forecast ?? null,
      actual: raw?.actual ?? null,
    },
  };
}

function mergeObservedMacroEvent(existing, event, fetchedAtUtc) {
  const incomingActual = optionalValue(event.actual);
  const existingActual = optionalValue(existing?.actual);
  const actual = incomingActual ?? existingActual;
  const actualFirstObservedAt = incomingActual
    ? existing?.actual_published_at_utc || existing?.actual_available_at_utc || fetchedAtUtc
    : existing?.actual_published_at_utc || existing?.actual_available_at_utc || null;
  const actualSource = incomingActual
    ? event.actual_source || event.source || existing?.actual_source || null
    : existing?.actual_source || null;
  return {
    ...(existing || {}),
    ...event,
    previous: event.previous ?? existing?.previous ?? null,
    forecast: event.forecast ?? existing?.forecast ?? null,
    actual: actual ?? null,
    actual_source: actualSource,
    actual_source_url: incomingActual
      ? event.actual_source_url || event.source_url || existing?.actual_source_url || null
      : existing?.actual_source_url || null,
    actual_source_event_id: incomingActual
      ? event.actual_source_event_id || existing?.actual_source_event_id || null
      : existing?.actual_source_event_id || null,
    actual_better_worse: incomingActual
      ? event.actual_better_worse ?? existing?.actual_better_worse ?? null
      : existing?.actual_better_worse ?? null,
    actual_last_observed_at_utc: incomingActual ? fetchedAtUtc : existing?.actual_last_observed_at_utc || null,
    actual_published_at_utc: actualFirstObservedAt,
    actual_available_at_utc: actualFirstObservedAt,
    actual_published_at_paris: actualFirstObservedAt ? toParisIso(Date.parse(actualFirstObservedAt)) : null,
    first_seen_at_utc: existing?.first_seen_at_utc || fetchedAtUtc,
    first_seen_at_paris: existing?.first_seen_at_paris || toParisIso(Date.parse(fetchedAtUtc)),
    last_seen_at_utc: fetchedAtUtc,
    last_seen_at_paris: toParisIso(Date.parse(fetchedAtUtc)),
    updated_at_utc: fetchedAtUtc,
    updated_at_paris: toParisIso(Date.parse(fetchedAtUtc)),
  };
}

async function fetchText(fetchImpl, url, timeoutMs, accept = "text/html,application/xhtml+xml") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
      headers: {
        accept,
        "accept-language": "en-US,en;q=0.9",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 DeskFutures/1.0",
      },
      signal: controller.signal,
    });
    if (!response?.ok) throw new Error(`forex_factory_actual_fetch_failed:${response?.status || "unknown"}`);
    if (typeof response.text !== "function") throw new Error("forex_factory_actual_response_text_required");
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
      headers: {
        accept: "application/json",
        "user-agent": "DeskFuturesMacroCalendar/1.0",
      },
      signal: controller.signal,
    });
    if (!response?.ok) throw new Error(`macro_calendar_fetch_failed:${response?.status || "unknown"}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function instrumentScope(currency, title, assets) {
  const upperTitle = title.toUpperCase();
  const scope = new Set();
  if (currency === "USD" || assets.some((asset) => US_INDEX_ASSETS.includes(asset))
    || MACRO_KEYWORDS.some((keyword) => upperTitle.includes(keyword))) {
    DEFAULT_INSTRUMENTS.forEach((instrument) => scope.add(instrument));
  }
  if (currency === "USD" || assets.some((asset) => ENERGY_ASSETS.includes(asset))
    || ENERGY_KEYWORDS.some((keyword) => upperTitle.includes(keyword))) {
    scope.add("MCL");
  }
  return scope.size ? [...scope] : DEFAULT_INSTRUMENTS;
}

function matchingJsonArrayEnd(source, start) {
  if (start < 0 || source[start] !== "[") return -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") quoted = false;
      continue;
    }
    if (character === "\"") {
      quoted = true;
      continue;
    }
    if (character === "[") depth += 1;
    else if (character === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function selectForexFactoryActualCandidates(events, { nowUtc, force = false } = {}) {
  const nowMs = Date.parse(normalizeInstant(nowUtc || new Date().toISOString()));
  const lookbackMs = (force ? 48 * 60 : 30) * 60_000;
  const lookaheadMs = 10 * 60_000;
  return (events || [])
    .filter((event) => {
      const timestamp = Date.parse(event.timestamp_utc || "");
      return Number.isFinite(timestamp)
        && timestamp >= nowMs - lookbackMs
        && timestamp <= nowMs + lookaheadMs;
    })
    .slice(0, 100);
}

function icsValue(block, name) {
  const match = String(block || "").match(new RegExp(`^${name}:(.*)$`, "m"));
  return match?.[1]?.trim() || "";
}

function unescapeIcsValue(value) {
  return String(value || "")
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function icsDateTimeToUtc(value, timeZone) {
  const match = String(value || "").match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, utcSuffix] = match;
  const parts = [year, month, day, hour, minute, second].map(Number);
  const naiveUtc = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
  if (utcSuffix === "Z" || !timeZone || timeZone === "UTC") return new Date(naiveUtc).toISOString();
  try {
    let candidate = naiveUtc;
    for (let iteration = 0; iteration < 2; iteration += 1) {
      const zoned = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }).formatToParts(candidate).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
      const renderedAsUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
      candidate += naiveUtc - renderedAsUtc;
    }
    return new Date(candidate).toISOString();
  } catch {
    return null;
  }
}

function forexFactoryCurrency(country) {
  return ({
    US: "USD",
    UK: "GBP",
    JN: "JPY",
    AU: "AUD",
    CA: "CAD",
    NZ: "NZD",
    CH: "CHF",
    CN: "CNY",
    GE: "EUR",
    EZ: "EUR",
    FR: "EUR",
    IT: "EUR",
    SP: "EUR",
  })[String(country || "").toUpperCase()] || "";
}

function macroIdentity(event) {
  return [
    String(event?.timestamp_paris || "").slice(0, 10),
    stringValue(event?.currency).toUpperCase(),
    stringValue(event?.title, event?.event, event?.name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim(),
  ].join("|");
}

function macroDateCurrency(event) {
  return [
    String(event?.timestamp_paris || "").slice(0, 10),
    stringValue(event?.currency).toUpperCase(),
  ].join("|");
}

function comparableMacroTitle(value) {
  return stringValue(value)
    .toLowerCase()
    .replace(/\b(german|spanish|french|italian|eurozone|european|british|uk|us|japanese|australian|canadian|swiss)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const items = Array.from(values || []);
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function loadPersistedScheduleForActuals(persistence, observations) {
  const dates = [...new Set((observations || [])
    .map((event) => String(event.timestamp_paris || "").slice(0, 10))
    .filter(validDate))];
  const groups = await Promise.all(dates.map((date) => persistence.queryCollectionDocuments({
    collection: COLLECTIONS.macroCalendarEvents,
    filters: [{ field: "date", operator: "==", value: date }],
    orderBy: [
      { field: "timestamp_utc", direction: "asc" },
      { field: "event_id", direction: "asc" },
    ],
    limit: 500,
  }).catch(() => [])));
  return groups.flat().filter((event) => event?.active !== false);
}

function assetsForEvent(currency, title) {
  const assets = new Set(currency === "USD" ? US_INDEX_ASSETS : []);
  const upperTitle = title.toUpperCase();
  if (ENERGY_KEYWORDS.some((keyword) => upperTitle.includes(keyword))) {
    ENERGY_ASSETS.forEach((asset) => assets.add(asset));
  }
  return [...assets];
}

function normalizeImpact(value) {
  const text = stringValue(value).toUpperCase();
  if (text.includes("CRITICAL")) return "CRITICAL";
  if (text.includes("HIGH") || text === "RED") return "HIGH";
  if (text.includes("MEDIUM") || text === "ORANGE") return "MEDIUM";
  if (text.includes("LOW") || text === "YELLOW") return "LOW";
  if (text.includes("HOLIDAY")) return "HOLIDAY";
  return text || "UNKNOWN";
}

function previousBusinessDay(date) {
  let candidate = addDays(date, -1);
  while (!isWeekday(candidate)) candidate = addDays(candidate, -1);
  return candidate;
}

function nextBusinessDay(date) {
  let candidate = isWeekday(date) ? addDays(date, 1) : date;
  while (!isWeekday(candidate)) candidate = addDays(candidate, 1);
  return candidate;
}

function isWeekday(date) {
  const day = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  return day >= 1 && day <= 5;
}

function addDays(date, days) {
  return new Date(Date.parse(`${date}T12:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function safeDocumentId(...parts) {
  return parts.join("__").replace(/[\/\\\s]/g, "_");
}

function optionalValue(value) {
  const text = stringValue(value);
  return text ? text : null;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function validDate(value) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(Date.parse(`${text}T12:00:00.000Z`))
    ? text
    : null;
}

function normalizeInstant(value) {
  const epochMs = Date.parse(String(value || ""));
  if (!Number.isFinite(epochMs)) throw new Error(`MACRO_CALENDAR_INSTANT_INVALID:${value}`);
  return new Date(epochMs).toISOString();
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.floor(number))) : fallback;
}
