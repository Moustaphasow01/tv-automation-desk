import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { canonicalSha256 } from "@tv-automation/desk-domain";
import { toParisIso } from "@tv-automation/desk-time";
import { deskError } from "./desk-errors.js";
import { impactRank } from "./desk-pack-service.js";
import {
  frontProjectionCurrentStateId,
  frontProjectionMatchesScope,
  prepareFrontProjectionMaterialization,
} from "./front-projection-materializer.js";
import { parisMarketSessionState } from "./market-session-state.js";

const COLLECTIONS = DESK_COLLECTIONS;

export class DeskFrontService {
  constructor({ persistence, clock, marketFeedCandidates, canonicalTimeframe }) {
    this.persistence = persistence;
    this.clock = clock;
    this.marketFeedCandidates = marketFeedCandidates;
    this.canonicalTimeframe = canonicalTimeframe;
  }

  async getDailyMacroCalendar({ date, importance_min = "low" } = {}) {
    const events = date
      ? await this.persistence.queryCollectionDocuments({
        collection: COLLECTIONS.macroCalendarEvents,
        filters: [{ field: "date", operator: "==", value: date }],
        orderBy: [{ field: "timestamp_utc", direction: "asc" }],
        limit: 500,
      }).catch(() => [])
      : await this.persistence.listDocuments(COLLECTIONS.macroCalendarEvents, 500).catch(() => []);
    return frontDailyMacroCalendar(events, { date, importance_min });
  }

  async getLiveMarketSnapshot({ date } = {}) {
    const tick = this.clock.now();
    const tradingDate = String(date || tick.paris).slice(0, 10);
    const currentSession = parisMarketSessionState(new Date(Date.parse(tick.utc)));
    const specs = [
      { instrument: "MNQ", symbol: "MNQ", timeframes: ["1", "5"], lookbackDays: 8 },
      { instrument: "MES", symbol: "MES", timeframes: ["1", "5"], lookbackDays: 8 },
      { instrument: "ZC", symbol: "ZC", timeframes: ["1", "5"], lookbackDays: 8 },
      { instrument: "ZW", symbol: "ZW", timeframes: ["1", "5"], lookbackDays: 8 },
      { instrument: "CL", symbol: "MCL", timeframes: ["1", "5"], lookbackDays: 8 },
      { instrument: "NVDA", symbol: "NVDA", timeframes: ["1", "5"], lookbackDays: 7 },
      { instrument: "AAPL", symbol: "AAPL", timeframes: ["1", "5"], lookbackDays: 7 },
      { instrument: "MSFT", symbol: "MSFT", timeframes: ["1", "5"], lookbackDays: 7 },
      { instrument: "TSLA", symbol: "TSLA", timeframes: ["1", "5"], lookbackDays: 7 },
      { instrument: "SMH", symbol: "SMH", timeframes: ["1", "5"], lookbackDays: 7 },
      { instrument: "SOXX", symbol: "SOXX", timeframes: ["1", "5"], lookbackDays: 7 },
    ];
    const planned = specs.map((spec) => {
      const window = frontLiveMarketWindow(tradingDate, tick.utc, spec.lookbackDays);
      const candidates = spec.timeframes.flatMap((timeframe) => (
        this.marketFeedCandidates(spec.instrument, timeframe)
          .slice(0, 4)
          .map((feedId) => ({ timeframe, feedId }))
      ));
      return { spec, window, candidates };
    });
    let bulkRows = null;
    if (typeof this.persistence.queryFrontMarketCandles === "function") {
      const fromUtc = planned.map((item) => item.window.fromUtc).sort().at(0);
      const toUtc = planned.map((item) => item.window.toUtc).sort().at(-1);
      bulkRows = await this.persistence.queryFrontMarketCandles({
        feed_ids: planned.flatMap((item) => item.candidates.map((candidate) => candidate.feedId)),
        from_utc: fromUtc,
        to_utc: toUtc,
        limit_per_feed: 1500,
      }).catch(() => null);
    }
    const rowsByFeed = bulkRows ? new Map() : null;
    for (const item of bulkRows || []) {
      const grouped = rowsByFeed.get(item.feed_id) || [];
      grouped.push(item);
      rowsByFeed.set(item.feed_id, grouped);
    }
    const values = await Promise.all(planned.map(async ({ spec, window, candidates }) => {
      if (rowsByFeed) {
        for (const { timeframe, feedId } of candidates) {
          const rows = (rowsByFeed.get(feedId) || [])
            .map((item) => item.data)
            .filter((row) => {
              const timestamp = Date.parse(row?.timestamp_utc || "");
              return timestamp >= Date.parse(window.fromUtc) && timestamp <= Date.parse(window.toUtc);
            });
          if (!rows.length) continue;
          const summary = summarizeFrontLiveMarketRows(rows, {
            ...spec,
            timeframe,
            feedId,
            requestedDate: tradingDate,
            canonicalTimeframe: this.canonicalTimeframe,
          });
          if (summary) return summary;
        }
        return null;
      }
      for (const timeframe of spec.timeframes) {
        for (const feedId of this.marketFeedCandidates(spec.instrument, timeframe).slice(0, 4)) {
          const rows = await this.persistence.queryDocuments({
            parentPath: `${COLLECTIONS.marketFeeds}/${feedId}`,
            collectionId: COLLECTIONS.marketFeedCandles,
            fromUtc: window.fromUtc,
            toUtc: window.toUtc,
            orderField: "timestamp_utc",
            direction: "desc",
            limit: 5000,
          }).catch(() => []);
          if (!rows.length) continue;
          const summary = summarizeFrontLiveMarketRows(rows, {
            ...spec,
            timeframe,
            feedId,
            requestedDate: tradingDate,
            canonicalTimeframe: this.canonicalTimeframe,
          });
          if (summary) return summary;
        }
      }
      return null;
    }));
    const instruments = Object.fromEntries(values.filter(Boolean).map((value) => [value.symbol, value]));
    const effectiveMarketDate = resolveEffectiveFrontMarketDate(instruments);
    const requestedCurrentSession = !date || tradingDate === currentSession.trading_date;
    const marketClosed = Boolean(effectiveMarketDate && effectiveMarketDate < tradingDate)
      || (requestedCurrentSession && currentSession.market_closed === true);
    return {
      ok: Object.keys(instruments).length > 0,
      date: tradingDate,
      requested_date: tradingDate,
      effective_market_date: effectiveMarketDate,
      market_closed: marketClosed,
      market_session: requestedCurrentSession ? currentSession : null,
      availability: effectiveMarketDate
        ? effectiveMarketDate < tradingDate
          ? "last_closed_session"
          : requestedCurrentSession && currentSession.market_closed === true
            ? currentSession.state
            : "live_postgres"
        : "unavailable",
      timestamp_paris: latestFrontMarketTimestamp(instruments) || tick.paris,
      source: "postgres_market_feeds",
      instruments,
    };
  }

  async getProjectionCurrent(args = {}) {
    const documentId = frontProjectionCurrentStateId(args);
    const current = await this.persistence.getDocument(COLLECTIONS.deskFrontCurrentStates, documentId).catch(() => null);
    return current && frontProjectionMatchesScope(current, args) ? current : null;
  }

  async getOperatorCommandState({ state_id }) {
    return this.persistence.getDocument(COLLECTIONS.dashboardState, state_id);
  }

  async getOperatorCommand({ command_id }) {
    return this.persistence.getDocument(COLLECTIONS.dashboardCommands, command_id);
  }

  async completeOperatorCommand({ command_id, status, result = null, error_message = null, updated_at_utc }) {
    const current = await this.getOperatorCommand({ command_id });
    if (!current) return null;
    const next = { ...current, status, result: result ?? current.result ?? null, error_message, updated_at_utc };
    await this.persistence.setDocument(COLLECTIONS.dashboardCommands, command_id, next, { merge: false });
    await this.persistence.setDocument(COLLECTIONS.dashboardState, `front_control_plane__${command_id}`, {
      schema_version: "front_control_plane_command_state_v1",
      state_id: `front_control_plane__${command_id}`,
      command_id,
      command_type: current.command_type,
      environment: current.environment,
      status,
      revision: Number(current.revision || 1) + 1,
      last_command_id: command_id,
      updated_at_utc,
    }, { merge: false });
    return next;
  }

  async commitOperatorCommandMutation(plan) {
    if (typeof this.persistence.commitOperatorCommandMutation === "function") {
      return this.persistence.commitOperatorCommandMutation({
        stateCollection: COLLECTIONS.dashboardState,
        commandCollection: COLLECTIONS.dashboardCommands,
        eventCollection: COLLECTIONS.dashboardCommandEvents,
        auditCollection: COLLECTIONS.deskAuditLogs,
        ...plan,
      });
    }
    const existingCommand = await this.getOperatorCommand({ command_id: plan.commandId }).catch(() => null);
    if (existingCommand) {
      if (existingCommand.request_hash !== plan.requestHash) {
        throw deskError("IDEMPOTENCY_CONFLICT", "Operator command idempotency conflict.", { command_id: plan.commandId });
      }
      return { replayed: true, command: existingCommand, result: existingCommand.result || null };
    }
    const currentState = await this.getOperatorCommandState({ state_id: plan.stateId }).catch(() => null);
    if (Number(currentState?.revision || 0) !== Number(plan.expectedRevision)) {
      throw deskError("REVISION_CONFLICT", "Operator state revision conflict.");
    }
    for (const condition of plan.preconditions || []) {
      const current = await this.persistence.getDocument(condition.collection, condition.documentId).catch(() => null);
      if (!current || canonicalSha256(current) !== condition.expectedHash) {
        throw deskError("TARGET_CONFLICT", "Canonical operator target changed before commit.");
      }
    }
    for (const write of plan.writes || []) {
      await this.persistence.setDocument(write.collection, write.documentId, write.data, { merge: write.merge === true });
    }
    await this.persistence.setDocument(COLLECTIONS.dashboardState, plan.stateId, plan.stateDoc);
    await this.persistence.setDocument(COLLECTIONS.dashboardCommands, plan.commandId, plan.commandDoc);
    await this.persistence.setDocument(COLLECTIONS.dashboardCommandEvents, plan.eventDoc.event_id, plan.eventDoc);
    await this.persistence.setDocument(COLLECTIONS.deskAuditLogs, plan.auditDoc.audit_id, plan.auditDoc);
    return { replayed: false, command: plan.commandDoc, result: plan.result };
  }

  async prepareProjection(canonical, sourceType, sourceId, tick) {
    const currentId = frontProjectionCurrentStateId(canonical);
    const existingCurrent = canonical.front_projection
      ? await this.persistence.getDocument(COLLECTIONS.deskFrontCurrentStates, currentId).catch(() => null)
      : null;
    return prepareFrontProjectionMaterialization({ canonical, sourceType, sourceId, tick, existingCurrent });
  }

  async commitProjection({ sourceWrite, plan, additionalWrites = [] }) {
    const projectionWrites = [...plan.writes, ...additionalWrites];
    if (typeof this.persistence.commitFrontProjectionMutation === "function") {
      return this.persistence.commitFrontProjectionMutation({
        sourceWrite,
        projectionWrites,
        currentStatePrecondition: plan.currentStatePrecondition,
      });
    }
    await this.persistence.setDocument(sourceWrite.collection, sourceWrite.documentId, sourceWrite.data, { merge: sourceWrite.merge === true });
    for (const write of projectionWrites) {
      await this.persistence.setDocument(write.collection, write.documentId, write.data, { merge: write.merge === true });
    }
  }
}

function frontDailyMacroCalendar(events, { date, importance_min }) {
  const selected = (events || [])
    .filter((event) => event && event.active !== false)
    .filter((event) => {
      const eventDate = String(event.date || event.timestamp_paris || event.scheduled_at_paris || "").slice(0, 10);
      return !date || eventDate === date;
    })
    .filter((event) => impactRank(event.impact || event.importance) >= impactRank(importance_min))
    .sort((left, right) => String(left.timestamp_paris || left.scheduled_at_paris || left.time_paris || "")
      .localeCompare(String(right.timestamp_paris || right.scheduled_at_paris || right.time_paris || "")));
  return {
    ok: true,
    date: date || null,
    importance_min,
    source: "macro_calendar_events",
    events: selected,
  };
}

function frontLiveMarketWindow(date, nowUtc, lookbackDays = 0) {
  const requestedStart = Date.parse(`${date}T00:00:00.000Z`);
  const fromDate = new Date(requestedStart - Math.max(0, Number(lookbackDays) || 0) * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const fromMs = parisWallClockEpoch(fromDate, "00:00:00");
  const nowMs = Date.parse(nowUtc);
  const nowParisDate = Number.isFinite(nowMs) ? toParisIso(nowMs).slice(0, 10) : date;
  const nextDate = new Date(requestedStart + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const requestedEndMs = parisWallClockEpoch(nextDate, "00:00:00") - 1;
  const toMs = date < nowParisDate ? requestedEndMs : nowMs;
  return {
    fromUtc: documentFeedUtc(fromMs),
    toUtc: documentFeedUtc(Number.isFinite(toMs) ? toMs : requestedEndMs),
  };
}

function parisWallClockEpoch(date, time) {
  const target = Date.parse(`${date}T${time}.000Z`);
  let epochMs = target;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const observed = Date.parse(`${toParisIso(epochMs).slice(0, 19)}.000Z`);
    epochMs += target - observed;
  }
  return epochMs;
}

function documentFeedUtc(epochMs) {
  return new Date(epochMs).toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

function summarizeFrontLiveMarketRows(rows, { symbol, timeframe, feedId, requestedDate, canonicalTimeframe }) {
  const ordered = (rows || [])
    .map((row) => ({ row, epochMs: frontMarketRowEpoch(row) }))
    .filter((item) => Number.isFinite(item.epochMs))
    .filter((item) => toParisIso(item.epochMs).slice(0, 10) <= requestedDate)
    .sort((left, right) => left.epochMs - right.epochMs);
  const lastEntry = ordered.at(-1);
  if (!lastEntry) return null;
  const latestDate = toParisIso(lastEntry.epochMs).slice(0, 10);
  const daily = ordered.filter((item) => toParisIso(item.epochMs).slice(0, 10) === latestDate);
  const first = daily[0]?.row || lastEntry.row;
  const last = lastEntry.row;
  const open = frontMarketNumber(first.open);
  const close = frontMarketNumber(last.close);
  const highs = daily.map(({ row }) => frontMarketNumber(row.high)).filter((value) => value != null);
  const lows = daily.map(({ row }) => frontMarketNumber(row.low)).filter((value) => value != null);
  const high = highs.length ? Math.max(...highs) : frontMarketNumber(last.high);
  const low = lows.length ? Math.min(...lows) : frontMarketNumber(last.low);
  const intradaySeries = daily.slice(-240).map(({ row, epochMs }) => ({
    timestamp_paris: toParisIso(epochMs),
    open: frontMarketNumber(row.open),
    high: frontMarketNumber(row.high),
    low: frontMarketNumber(row.low),
    close: frontMarketNumber(row.close),
  })).filter((point) => point.close != null);
  const normalizedTimeframe = canonicalTimeframe(timeframe);
  return {
    symbol,
    latest_close: close,
    change_pct: open && close != null ? ((close - open) / open) * 100 : null,
    latest_timestamp_paris: toParisIso(lastEntry.epochMs),
    market_date: latestDate,
    day_ohlc: { open, high, low, close },
    rsi_14: frontMarketNumber(last.rsi_14),
    atr_14: frontMarketNumber(last.atr_14),
    timeframe: normalizedTimeframe === "1" ? "M1" : "M5",
    series_timeframe: normalizedTimeframe === "1" ? "M1" : "M5",
    intraday_series: intradaySeries,
    source: `market_feeds/${feedId}/candles`,
    availability: latestDate < requestedDate ? "last_closed_session" : "live_postgres",
  };
}

function frontMarketRowEpoch(row) {
  return Date.parse(row?.timestamp_utc || row?.time_utc || row?.timestamp || row?.timestamp_paris || "");
}

function frontMarketNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function latestFrontMarketTimestamp(instruments) {
  return Object.values(instruments || {})
    .map((value) => value?.latest_timestamp_paris)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
}

function resolveEffectiveFrontMarketDate(instruments) {
  const values = instruments || {};
  const coreDates = ["MNQ", "MES"]
    .map((symbol) => values[symbol]?.market_date)
    .filter(Boolean)
    .sort();
  if (coreDates.length) return coreDates.at(-1);
  return Object.values(values)
    .map((value) => value?.market_date)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
}
