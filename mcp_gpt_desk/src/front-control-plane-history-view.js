import { normalizeFrontApiScope } from "./front-session-projection.js";
import { nullableNumber, number, rows, stringList, upper } from "./front-control-plane-projection-helpers.js";
import { text } from "./front-control-plane-common.js";

export function sessionsView({ sessions, query }) {
  const scope = normalizeFrontApiScope(query);
  const items = rows(sessions).filter((item) => item?.id).map((item) => ({
    sessionId: String(item.id),
    label: text(item.label, String(item.id)),
    shortLabel: text(item.shortLabel, String(item.id).toUpperCase()),
    status: text(item.status, "UNKNOWN"),
    severity: text(item.severity, "info"),
    decision: text(item.decision, "NO_ACTION"),
    healthPct: number(item.health, 0),
    lastMonitorAt: text(item.lastMonitorAt, "—"),
    tradingDate: scope.trading_date,
    route: `/live?session=${encodeURIComponent(String(item.id))}`,
  }));
  return {
    summary: {
      total: items.length,
      nominal: items.filter((item) => ["ok", "success", "info"].includes(item.severity.toLowerCase())).length,
      attention: items.filter((item) => ["warning", "error", "critical", "danger"].includes(item.severity.toLowerCase())).length,
      activeTheses: items.filter((item) => !["NO_ACTIVE_THESIS", "NO_THESIS", "UNKNOWN"].includes(upper(item.status))).length,
      tradingDate: scope.trading_date,
    },
    sessions: items,
  };
}

export function liveNews({ liveSession, macro, news, query }) {
  const scope = normalizeFrontApiScope(query);
  const macroEvents = rows(macro?.macro).map((item, index) => ({
    eventId: text(item.id || item.event_id, `macro-${item.scheduledAt || item.date || index}`),
    scheduledAt: text(item.scheduledAt, "—"),
    time: text(item.time, "—"),
    title: text(item.title, "Événement macro"),
    currency: text(item.currency, "—"),
    importance: text(item.importance, "UNKNOWN"),
    previous: text(item.previous, "—"),
    forecast: text(item.forecast, "—"),
    actual: text(item.actual, "—"),
    isNext: item.isNext === true,
  }));
  const headlines = rows(news?.headlines).map((item, index) => ({
    headlineId: text(item.id || item.headline_id, `headline-${item.publishedAt || item.scheduledAt || index}`),
    publishedAt: text(item.publishedAt || item.scheduledAt, "—"),
    title: text(item.title, "Actualité sans titre"),
    source: text(item.source, "Source non publiée"),
    provider: text(item.provider, "Provider non publié"),
    importance: text(item.importance, "UNKNOWN"),
    impact: text(item.impact, "Impact non publié."),
    url: text(item.url, ""),
    assets: stringList(item.assets),
    topics: stringList(item.topics),
  }));
  const providerCount = new Set(headlines.map((item) => item.provider).filter((item) => item !== "Provider non publié")).size;
  return {
    summary: {
      macroEvents: macroEvents.length,
      highImpactEvents: macroEvents.filter((item) => upper(item.importance) === "HIGH").length,
      headlines: headlines.length,
      providers: providerCount,
      nearEvent: macro?.nearEvent === true,
      nextMacroAt: text(macro?.nextMacro || liveSession?.nextMacro, "—"),
    },
    scope: {
      sessionId: text(liveSession?.id, scope.session),
      tradingDate: text(liveSession?.date, scope.trading_date),
      mode: text(liveSession?.mode, scope.mode).toUpperCase(),
    },
    macroEvents,
    headlines,
  };
}

export function liveTimeline({ liveSession, query }) {
  const scope = normalizeFrontApiScope(query);
  const operational = rows(liveSession?.operationalTimeline).map((item, index) => ({
    eventId: text(item.id, `operational-${index + 1}`),
    category: text(item.type, "OPERATION"),
    title: text(item.label, "Événement opérationnel"),
    plannedAt: text(item.plannedAt, "—"),
    actualAt: item.actualAt ? String(item.actualAt) : null,
    status: text(item.status, "UNKNOWN"),
    latencySeconds: nullableNumber(item.latencySeconds),
    summary: text(item.summary, "Résumé non publié."),
    detail: text(item.detail, "Détail non publié."),
  }));
  const analytical = rows(liveSession?.timeline).map((item, index) => ({
    eventId: text(item.id || item.eventId, `timeline-${index + 1}`),
    category: text(item.type || item.category, "ANALYSIS"),
    title: text(item.title || item.label, "Événement d'analyse"),
    plannedAt: text(item.plannedAt || item.at || item.occurredAt, "—"),
    actualAt: item.actualAt || item.at || item.occurredAt ? String(item.actualAt || item.at || item.occurredAt) : null,
    status: text(item.status, "COMPLETED"),
    latencySeconds: nullableNumber(item.latencySeconds),
    summary: text(item.summary || item.description, "Résumé non publié."),
    detail: text(item.detail, "Détail non publié."),
  }));
  const events = [...operational, ...analytical].sort((left, right) => String(left.plannedAt).localeCompare(String(right.plannedAt)));
  return {
    summary: {
      total: events.length,
      completed: events.filter((item) => ["DONE", "COMPLETED", "EXECUTED"].includes(upper(item.status))).length,
      waiting: events.filter((item) => ["WAITING", "SCHEDULED", "READY"].includes(upper(item.status))).length,
      delayed: events.filter((item) => ["LATE", "DELAYED", "FAILED", "BLOCKED"].includes(upper(item.status))).length,
      nextCheckpointAt: text(liveSession?.nextCheckpointAt, "—"),
      lastCompletedAt: text(liveSession?.lastCompletedCheckpointAt, "—"),
    },
    scope: {
      sessionId: text(liveSession?.id, scope.session),
      tradingDate: text(liveSession?.date, scope.trading_date),
      mode: text(liveSession?.mode, scope.mode).toUpperCase(),
    },
    events,
  };
}
