import { auditRelations, frontAuditEvents } from "./front-control-plane-domain-completeness.js";
import { average, countBy, number, upper } from "./front-control-plane-projection-helpers.js";

export function eventsAudit({ execution, strategy, incidents, runtime, warnings, nowIso }) {
  const events = frontAuditEvents({ execution, strategy, incidents, runtime, nowIso });
  if (!events.length) warnings.push("events-audit-source:UNAVAILABLE");
  const correlationIds = [...new Set(events.map((item) => item.correlationId).filter((item) => item && item !== "none"))];
  const selectedCorrelationId = correlationIds[0] || "none";
  const selectedEvents = events.filter((item) => item.correlationId === selectedCorrelationId);
  return {
    summary: {
      totalEvents: events.length,
      correlations: correlationIds.length,
      authoritativeSteps: countBy(events, (item) => item.authority === "AUTHORITATIVE"),
      advisoryBranches: countBy(events, (item) => item.authority === "ADVISORY"),
      avgLatencyMs: average(events.map((item) => number(item.latencyMs, NaN))),
      exportablePayloads: countBy(events, (item) => item.payloadPreview.length > 0),
    },
    filters: {
      activeCorrelationId: selectedCorrelationId,
      domains: [...new Set(events.map((item) => item.domain))],
      statuses: [...new Set(events.map((item) => item.status))],
      windowLabel: "BFF current",
    },
    events,
    selectedCorrelation: {
      correlationId: selectedCorrelationId,
      rootEventId: selectedEvents[0]?.eventId || "none",
      authoritativePath: selectedEvents.filter((item) => item.authority === "AUTHORITATIVE").map((item) => item.eventId),
      advisoryPath: selectedEvents.filter((item) => item.authority === "ADVISORY").map((item) => item.eventId),
      totalLatencyMs: selectedEvents.reduce((sum, item) => sum + number(item.latencyMs, 0), 0),
      payloadPreview: selectedEvents.flatMap((item) => item.payloadPreview).slice(0, 20),
      logs: selectedEvents.map((item) => ({
        logId: item.eventId,
        level: auditLogLevel(item.status),
        message: `${item.title}${item.detail ? ` · ${item.detail}` : ""}`,
      })),
    },
    relations: auditRelations(events),
    commandActions: [],
  };
}

function auditLogLevel(status) {
  const normalized = upper(status);
  if (["FAILED", "ERROR", "CRITICAL", "REJECTED", "BLOCKED"].includes(normalized)) return "ERROR";
  if (["WARN", "WARNING", "WATCH", "STALE", "DEGRADED"].includes(normalized)) return "WARN";
  return "INFO";
}
