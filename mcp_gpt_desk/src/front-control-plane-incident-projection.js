import {
  ageMinutes,
  average,
  countBy,
  currentUtc,
  hasIncidentId,
  number,
  objectFacts,
  rows,
  stringList,
  text,
  upper,
} from "./front-control-plane-projection-helpers.js";

export function executionIncidents({ incidents, warnings }) {
  const list = rows(incidents).filter(hasIncidentId).map(incidentRow);
  if (!list.length) warnings.push("incidents:EMPTY");
  return {
    summary: {
      openIncidents: countBy(list, (item) => !["RESOLVED", "CLOSED", "EXPECTED_STOPPED"].includes(upper(item.status))),
      criticalIncidents: countBy(list, (item) => item.severity === "HIGH" && item.category === "ACTIVE_FAILURE"),
      highIncidents: countBy(list, (item) => item.severity === "HIGH"),
      retryableIncidents: countBy(list, (item) => item.retryable),
      pendingReconciliations: countBy(list, (item) => item.category === "RECONCILIATION_REQUIRED"),
      impactedOrders: new Set(list.flatMap((item) => item.impactedOrderIds)).size,
      avgAgeMinutes: average(list.map((item) => number(item.ageMinutes, Number.NaN))),
      impactR: list.reduce((sum, item) => sum + number(item.impactR, 0), 0),
    },
    filters: {
      activeDomain: "ALL",
      activeSeverity: "ALL",
      searchHint: "incident, provider, order",
      statuses: [...new Set(list.map((item) => item.status))],
      categories: [...new Set(list.map((item) => item.category))],
      sourceKinds: [...new Set(list.map((item) => item.sourceKind))],
    },
    incidents: list,
    selectedIncident: list[0] || emptyIncident(),
    retries: list.flatMap((item) => item.retries || []),
    commandActions: [],
  };
}

export function incidentSummary(item) {
  const classification = classifyIncident(item);
  return {
    incidentId: text(item.incident_id, ""),
    severity: severity(item.severity),
    title: text(item.title, "Incident"),
    detail: text(item.detail || item.message, "Incident backend"),
    category: classification.category,
    sourceKind: classification.sourceKind,
    route: `/operations/incidents/${encodeURIComponent(String(item.incident_id))}`,
  };
}

export function incidentRow(item) {
  const classification = classifyIncident(item);
  const impactedOrderIds = stringList(item.impacted_order_ids || item.order_ids || item.order_id).filter((value) => value !== "unavailable");
  const createdAt = text(item.created_at_utc || item.opened_at_utc || item.updated_at_utc, "");
  return {
    ...incidentSummary(item),
    domain: text(item.domain, "operations"),
    status: text(item.status, "OPEN"),
    category: classification.category,
    sourceKind: classification.sourceKind,
    retryable: classification.retryable,
    expectedStopped: classification.category === "EXPECTED_STOPPED",
    ageMinutes: ageMinutes(createdAt),
    impactR: number(item.impact_R ?? item.impact_r, 0),
    impactedOrderIds,
    correlationId: text(item.correlation_id, "none"),
    route: `/operations/incidents/${encodeURIComponent(String(item.incident_id))}`,
    chronology: incidentChronology(item, createdAt),
    reconciliationResults: rows(item.reconciliation_results || item.reconciliations),
    retries: incidentRetries(item),
    meta: [
      { label: "Source", value: text(item.domain, "operations") },
      { label: "Catégorie", value: classification.category },
      { label: "Kind", value: classification.sourceKind },
    ],
    payloadPreview: [
      { key: "incident_id", value: text(item.incident_id, "unknown") },
      ...objectFacts(item, Object.keys(item).slice(0, 6)).map((factItem) => ({ key: factItem.label, value: factItem.value })),
    ],
    postMortem: item.post_mortem || emptyPostMortem(),
  };
}

function classifyIncident(item = {}) {
  const status = upper(item.status);
  const domain = upper(item.domain);
  const title = upper(`${item.title || ""} ${item.detail || ""} ${item.message || ""} ${item.error_code || ""}`);
  if (["RESOLVED", "CLOSED"].includes(status)) return { category: "HISTORICAL_FAILURE", sourceKind: "RESOLVED_INCIDENT", retryable: false };
  if (status === "DISABLED" || title.includes("POLICY_DISABLED") || title.includes("DISABLED")) return { category: "POLICY_DISABLED", sourceKind: "EXPECTED_POLICY_STATE", retryable: false };
  if (status === "STOPPED" && (title.includes("EXPECTED") || title.includes("OPERATOR"))) return { category: "EXPECTED_STOPPED", sourceKind: "OPERATOR_CONTROLLED", retryable: false };
  if (title.includes("RECONCILIATION") || domain.includes("RECONCILIATION")) return { category: "RECONCILIATION_REQUIRED", sourceKind: "RECONCILIATION", retryable: true };
  if (title.includes("STALE") || title.includes("HEARTBEAT") || title.includes("TIMEOUT")) return { category: "STALE_HEARTBEAT", sourceKind: "HEALTHCHECK", retryable: true };
  if (["FAILED", "OPEN", "DEGRADED", "BLOCKED"].includes(status) || ["HIGH", "CRITICAL"].includes(upper(item.severity))) return { category: "ACTIVE_FAILURE", sourceKind: "RUNTIME", retryable: item.retryable !== false };
  return { category: "HISTORICAL_FAILURE", sourceKind: "BACKEND", retryable: item.retryable === true };
}

function incidentChronology(item, createdAt) {
  return rows(item.chronology || item.events).map((event, index) => ({
    eventId: text(event.event_id || event.id, `incident-event-${index + 1}`),
    at: text(event.occurred_at_utc || event.created_at_utc, createdAt || "unavailable"),
    status: text(event.status || event.event_type, "RECORDED"),
    detail: text(event.detail || event.message, "Détail non publié"),
  }));
}

function incidentRetries(item) {
  return rows(item.retries).map((retry, index) => ({
    retryId: text(retry.retry_id || retry.id, `retry-${index + 1}`),
    status: text(retry.status, "UNKNOWN"),
    at: text(retry.created_at_utc || retry.updated_at_utc, "unavailable"),
    errorCode: text(retry.error_code, ""),
  }));
}

function emptyIncident() {
  return {
    incidentId: "none",
    severity: "LOW",
    title: "Aucun incident",
    detail: "Aucun incident ouvert dans la projection.",
    route: "/execution/incidents",
    chronology: [],
    reconciliationResults: [],
    meta: [],
    payloadPreview: [],
    postMortem: emptyPostMortem(),
  };
}

function emptyPostMortem() {
  return {
    rootCause: "Aucun incident sélectionné",
    containment: "Aucune action requise",
    permanentFix: "Non applicable",
    ownerRole: "SYSTEM",
    dueAt: currentUtc(),
  };
}

function severity(value) {
  const normalized = upper(value);
  if (normalized === "CRITICAL") return "HIGH";
  return ["LOW", "MEDIUM", "HIGH"].includes(normalized) ? normalized : "LOW";
}

