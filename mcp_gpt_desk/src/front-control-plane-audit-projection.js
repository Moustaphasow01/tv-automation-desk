import { currentUtc, hasIncidentId, hasSignalId, nullableNumber, objectFacts, rows, text } from "./front-control-plane-projection-helpers.js";

export function frontAuditEvents({ execution = {}, strategy = {}, incidents = {}, runtime = {}, nowIso = currentUtc() }) {
  return [
    ...auditSignalEvents(strategy),
    ...auditOrderIntentEvents(execution),
    ...auditProviderCommandEvents(execution),
    ...auditProviderEvents(execution),
    ...auditExecutionTimelineEvents(execution),
    ...auditRuntimeEvents(runtime, nowIso),
    ...auditIncidentEvents(incidents, nowIso),
  ].filter((item) => item.eventId).sort((left, right) => String(right.at).localeCompare(String(left.at)));
}

export function auditRelations(events) {
  const byCorrelation = new Map();
  const byEventId = new Map(events.map((event) => [event.eventId, event]));
  for (const event of events) {
    const key = event.correlationId || "none";
    if (!byCorrelation.has(key)) byCorrelation.set(key, []);
    byCorrelation.get(key).push(event);
  }
  const relations = [];
  const seen = new Set();
  for (const items of byCorrelation.values()) {
    const ordered = [...items].sort((left, right) => String(left.at).localeCompare(String(right.at)));
    ordered.forEach((event, index) => {
      const explicitCause = event.causationId ? byEventId.get(event.causationId) : null;
      const previous = ordered[index - 1];
      const from = explicitCause?.eventId || previous?.eventId;
      if (!from || from === event.eventId) return;
      const relation = explicitCause
        ? (event.authority === "ADVISORY" ? "ADVISES" : "CAUSES")
        : "FOLLOWS";
      const key = `${from}:${event.eventId}:${relation}`;
      if (seen.has(key)) return;
      seen.add(key);
      relations.push({ fromEventId: from, toEventId: event.eventId, relation });
    });
  }
  return relations;
}

function auditSignalEvents(strategy) {
  return rows(strategy?.signals).filter(hasSignalId).map((item) => auditEventRow({
    id: item.signal_outbox_id || item.signal_id,
    at: item.created_at_utc || item.source_data_cutoff_utc,
    domain: "Strategy",
    eventType: "strategy.signal.published",
    status: item.status || item.state || "RECORDED",
    title: `Signal ${text(item.instrument_code || item.symbol, "instrument")}`,
    detail: text(item.reason || item.summary, "Signal déterministe publié par le Strategy Kernel."),
    correlationId: item.correlation_id || item.signal_id || item.signal_outbox_id,
    causationId: item.strategy_instance_id,
    authority: "AUTHORITATIVE",
    route: item.signal_id || item.signal_outbox_id ? `/live/signals/${encodeURIComponent(String(item.signal_id || item.signal_outbox_id))}` : null,
    payload: item,
  }));
}

function auditOrderIntentEvents(execution) {
  return rows(execution?.portfolioOrderIntents).map((item) => {
    const payload = item.order_intent_payload || item.payload || {};
    return auditEventRow({
      id: item.portfolio_order_intent_id || payload.order_intent_id,
      at: item.created_at_utc || payload.requested_at_utc,
      domain: "OrderIntent",
      eventType: "portfolio.order_intent.created",
      status: item.status || payload.status || "READY",
      title: `OrderIntent ${text(item.target_instrument || payload.instrument, "instrument")}`,
      detail: "Intention post Portfolio/Risk ; ne constitue pas un ordre provider ni un fill.",
      correlationId: item.correlation_id || payload.correlation_id || payload.signal_id,
      causationId: item.target_position_id || payload.target_position_id,
      authority: "AUTHORITATIVE",
      route: `/execution/orders/${encodeURIComponent(String(item.portfolio_order_intent_id || payload.order_intent_id || ""))}`,
      payload: { order_intent_payload: payload, risk_snapshot: item.risk_snapshot, immutability: item.immutability },
    });
  });
}

function auditProviderCommandEvents(execution) {
  return rows(execution?.providerCommands).map((item) => auditEventRow({
    id: item.execution_provider_command_id,
    at: item.created_at_utc || item.updated_at_utc,
    domain: "ExecutionGateway",
    eventType: "execution.provider_command.created",
    status: item.status || "RECORDED",
    title: `Provider command ${text(item.action || item.command_type, "command")}`,
    detail: "Commande provider auditée ; un ACK provider n'est pas un fill.",
    correlationId: item.correlation_id || item.portfolio_order_intent_id,
    causationId: item.portfolio_order_intent_id,
    authority: "AUTHORITATIVE",
    route: item.portfolio_order_intent_id ? `/execution/orders/${encodeURIComponent(String(item.portfolio_order_intent_id))}` : "/execution/providers",
    payload: item,
  }));
}

function auditProviderEvents(execution) {
  return rows(execution?.providerEvents).map((item) => auditEventRow({
    id: item.broker_provider_event_id || item.provider_event_id || item.event_id,
    at: item.occurred_at_utc || item.created_at_utc,
    domain: "Provider",
    eventType: item.event_type || "provider.event",
    status: item.status || item.provider_status || "RECORDED",
    title: text(item.message || item.event_type, "Provider event"),
    detail: "Événement provider normalisé. Le fill doit venir d'un événement FILL explicite.",
    correlationId: item.correlation_id || item.portfolio_order_intent_id || item.execution_provider_command_id,
    causationId: item.execution_provider_command_id,
    authority: "AUTHORITATIVE",
    route: item.portfolio_order_intent_id ? `/execution/orders/${encodeURIComponent(String(item.portfolio_order_intent_id))}` : "/execution/providers",
    payload: item,
  }));
}

function auditExecutionTimelineEvents(execution) {
  return rows(execution?.timeline).filter((item) => item?.event_id).map((item) => auditEventRow({
    id: item.event_id,
    at: item.occurred_at_utc || item.created_at_utc,
    domain: text(item.domain || item.step, "Execution"),
    eventType: item.event_type || item.title,
    status: item.status || item.severity || "RECORDED",
    title: item.title || item.event_type,
    detail: item.detail || item.message,
    correlationId: item.correlation_id,
    causationId: item.causation_id,
    authority: "AUTHORITATIVE",
    route: "/operations/observability",
    payload: item,
  }));
}

function auditRuntimeEvents(runtime, nowIso) {
  return rows(runtime).filter((item) => item?.task_id || item?.worker_id).map((item) => auditEventRow({
    id: item.task_id || item.worker_id,
    at: item.updated_at_utc || item.created_at_utc || nowIso,
    domain: "AgentRuntime",
    eventType: item.task_type || "agent.task",
    status: item.status || "RECORDED",
    title: `Agent ${text(item.worker_id, "runtime")}`,
    detail: text(item.error_message || item.message, "Tâche agent persistée."),
    correlationId: item.correlation_id || item.task_id,
    causationId: item.mission_id,
    authority: "ADVISORY",
    route: "/operations",
    payload: item,
  }));
}

function auditIncidentEvents(incidents, nowIso) {
  return rows(incidents).filter(hasIncidentId).map((item) => auditEventRow({
    id: item.incident_id || item.id,
    at: item.created_at_utc || item.opened_at_utc || nowIso,
    domain: text(item.domain, "Incident"),
    eventType: "incident.created",
    status: item.status || item.severity || "OPEN",
    title: item.title,
    detail: item.detail || item.message,
    correlationId: item.correlation_id || item.incident_id || item.id,
    causationId: item.order_id || item.position_id || item.workflow_id,
    authority: "AUTHORITATIVE",
    route: `/operations/incidents/${encodeURIComponent(String(item.incident_id || item.id))}`,
    payload: item,
  }));
}

function auditEventRow({ id, at, domain, eventType, status, title, detail, correlationId, causationId, authority, route, payload }) {
  const sourcePayload = payload && typeof payload === "object" ? payload : {};
  const eventId = text(id, "");
  return {
    eventId,
    at: text(at, "unavailable"),
    domain: text(domain, "operations"),
    eventType: text(eventType, "event"),
    status: text(status, "RECORDED"),
    title: text(title, "Événement"),
    detail: text(detail, "Détail non publié."),
    correlationId: text(correlationId, "none"),
    causationId: text(causationId, ""),
    authority: authority === "ADVISORY" ? "ADVISORY" : "AUTHORITATIVE",
    latencyMs: nullableNumber(sourcePayload.latency_ms ?? sourcePayload.latencyMs),
    route: route || `/events/${encodeURIComponent(eventId)}`,
    payloadPreview: objectFacts(sourcePayload, Object.keys(sourcePayload).slice(0, 8)),
  };
}
