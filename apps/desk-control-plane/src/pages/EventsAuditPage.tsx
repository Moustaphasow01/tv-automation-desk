import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  FaArrowRight,
  FaBezierCurve,
  FaCodeBranch,
  FaDatabase,
  FaDownload,
  FaExclamationTriangle,
  FaFingerprint,
  FaProjectDiagram,
  FaRobot,
  FaRoute,
  FaSearch,
  FaShieldAlt,
  FaStream
} from "react-icons/fa";
import { DeskButton } from "@/design-system/actions";
import { Card, KpiCard, StatusBadge } from "@/design-system/primitives";
import { InlineAction, MetricBox, OperatorPageHeader } from "@/design-system/workspace";
import { ViewTruthBanner } from "@/design-system/states";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { CommandAccepted } from "@/domains/realtime/commandRuntime";
import type { EventsAuditView } from "@/domains/front-api/viewModels";

type AuditAction = EventsAuditView["commandActions"][number];
type AuditEvent = EventsAuditView["events"][number];

export function EventsAuditPage() {
  const query = useFrontView("events-audit");
  const repository = useFrontViewRepository();
  const [searchParams] = useSearchParams();
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);

  if (query.isLoading) {
    return <EventsAuditLoading />;
  }

  if (query.isError) {
    return (
      <Card title="Timeline & Audit indisponible" eyebrow="ERREUR CONTRAT" tone="danger" density="compact">
        <p>{(query.error as Error).message}</p>
      </Card>
    );
  }

  if (!query.data) {
    return (
      <Card title="Aucun événement" eyebrow="EMPTY" state="empty" density="compact">
        <p>Le BFF ne retourne pas encore la projection `/views/events-audit`.</p>
      </Card>
    );
  }

  const { data, meta } = query.data;
  const requestedCorrelationId = searchParams.get("correlationId") ?? data.filters.activeCorrelationId;
  const eventById = new Map(data.events.map((event) => [event.eventId, event]));
  const activeEvents = data.events.filter((event) => event.correlationId === requestedCorrelationId);
  const shownEvents = activeEvents.length ? activeEvents : data.events;
  const selected = data.selectedCorrelation;
  const rootEvent = eventById.get(selected.rootEventId);

  const confirmAction = async (action: AuditAction) => {
    setSubmittingActionId(action.actionId);
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand({
        commandType: action.commandType,
        environment: "MOCK",
        expectedVersion: action.actionId,
        reason: `Events audit action confirmed: ${action.label}`,
        payload: action.payload
      });
      setCommand(accepted);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "EVENTS_COMMAND_FAILED");
    } finally {
      setSubmittingActionId(null);
    }
  };

  return (
    <div className="operator-page events-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader
        title="Timeline & Audit"
        description={`Correlation active ${compactId(requestedCorrelationId)} · fenêtre ${data.filters.windowLabel} · projection ${meta.latencyMs} ms.`}
        actions={
          <>
            <label className="events-search" aria-label="Recherche correlationId">
              <FaSearch />
              <input readOnly value={requestedCorrelationId} />
            </label>
            <Link className="operator-primary-action" to="/operations">Retour opérations</Link>
          </>
        }
      />

      <section className="operator-kpi-strip" aria-label="Indicateurs Timeline Audit">
        <KpiCard label="EVENTS" value={`${data.summary.totalEvents}`} delta={`${data.summary.correlations} correlations`} tone="info" />
        <KpiCard label="CHEMIN AUTH" value={`${data.summary.authoritativeSteps}`} delta="Ordre déterministe" tone="success" />
        <KpiCard label="IA ADVISORY" value={`${data.summary.advisoryBranches}`} delta="Hors chemin ordre" tone="warning" />
        <KpiCard label="LATENCE AVG" value={`${data.summary.avgLatencyMs}ms`} delta={`${selected.totalLatencyMs} ms total`} tone="info" />
        <KpiCard label="PAYLOADS" value={`${data.summary.exportablePayloads}`} delta="copie/export autorisé" tone="success" />
        <KpiCard label="ROOT" value={rootEvent ? formatTime(rootEvent.at) : "—"} delta={compactId(selected.rootEventId)} tone="info" />
      </section>

      <section className="operator-grid operator-grid--top" aria-label="Timeline, chemin et payload">
        <Card title="Timeline chronologique" actions={<InlineAction>Deep-links</InlineAction>} density="compact">
          <div className="events-timeline-list">
            {shownEvents.map((event) => (
              <Link key={event.eventId} to={`${event.route}?eventId=${event.eventId}&correlationId=${event.correlationId}`}>
                <span className={`events-lane-dot events-lane-dot--${event.lane.toLowerCase()}`}>{laneIcon(event.lane)}</span>
                <div>
                  <strong>{event.eventType}</strong>
                  <small>{formatTime(event.at)} · {compactId(event.eventId)} · cause {event.causationId ? compactId(event.causationId) : "ROOT"}</small>
                </div>
                <b>{event.latencyMs}ms</b>
                <StatusBadge tone={statusTone(event.status)}>{statusLabel(event.status)}</StatusBadge>
              </Link>
            ))}
          </div>
        </Card>

        <Card title="Chemin autoritaire vs advisory" actions={<InlineAction>Correlation</InlineAction>} density="compact">
          <div className="events-correlation-chain">
            <section className="events-path events-path--authoritative">
              <header><FaShieldAlt /><strong>AUTHORITATIVE ORDER PATH</strong><span>{selected.authoritativePath.length}</span></header>
              {selected.authoritativePath.map((eventId, index) => {
                const event = eventById.get(eventId);
                return (
                  <article key={eventId}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{event?.eventType ?? eventId}</strong>
                      <small>{event ? `${event.domain} · ${event.schemaVersion}` : "missing"}</small>
                    </div>
                    <StatusBadge tone={event ? statusTone(event.status) : "danger"}>{event ? statusLabel(event.status) : "MISS"}</StatusBadge>
                  </article>
                );
              })}
            </section>
            <section className="events-path events-path--advisory">
              <header><FaRobot /><strong>AI SHADOW / ADVISORY</strong><span>{selected.advisoryPath.length}</span></header>
              {selected.advisoryPath.map((eventId) => {
                const event = eventById.get(eventId);
                return (
                  <article key={eventId}>
                    <span><FaCodeBranch /></span>
                    <div>
                      <strong>{event?.eventType ?? eventId}</strong>
                      <small>Documente le contexte, ne commande pas l’ordre.</small>
                    </div>
                    <StatusBadge tone="warning">SHADOW</StatusBadge>
                  </article>
                );
              })}
            </section>
          </div>
        </Card>

        <Card title="Payload métier & logs" actions={<InlineAction>Inspecter</InlineAction>} density="compact">
          <div className="events-payload-list">
            {selected.payloadPreview.map((item) => (
              <article key={item.key}>
                <small>{item.key}</small>
                <strong>{item.value}</strong>
              </article>
            ))}
          </div>
          <div className="events-log-list">
            {selected.logs.map((log) => (
              <article key={log.logId}>
                <StatusBadge tone={log.level === "ERROR" ? "danger" : log.level === "WARN" ? "warning" : "success"}>{log.level}</StatusBadge>
                <div>
                  <strong>{compactId(log.logId)}</strong>
                  <small>{log.message}</small>
                </div>
              </article>
            ))}
          </div>
        </Card>
      </section>

      <section className="operator-grid operator-grid--bottom" aria-label="Filtres, relations et commandes">
        <Card title="Filtres et index audit" actions={<InlineAction>Filtres</InlineAction>} density="compact">
          <div className="events-filter-grid">
            <MetricBox label="Correlation" value={compactId(data.filters.activeCorrelationId)} />
            <MetricBox label="Window" value={data.filters.windowLabel} />
            <MetricBox label="Domaines" value={data.filters.domains.length} />
            <MetricBox label="Statuts" value={data.filters.statuses.length} />
          </div>
          <div className="events-chip-cloud">
            {data.filters.domains.map((domain) => <StatusBadge key={domain} tone="info">{domainLabel(domain)}</StatusBadge>)}
            {data.filters.statuses.map((status) => <StatusBadge key={status} tone={statusTone(status)}>{statusLabel(status)}</StatusBadge>)}
          </div>
        </Card>

        <Card title="Relations eventId / causationId" actions={<InlineAction>Graph</InlineAction>} density="compact">
          <div className="events-relations-list">
            {data.relations.map((relation) => (
              <article key={`${relation.fromEventId}:${relation.toEventId}`}>
                <span><FaBezierCurve /></span>
                <div>
                  <strong>{compactId(relation.fromEventId)}</strong>
                  <small>{relation.relation}</small>
                </div>
                <FaArrowRight />
                <div>
                  <strong>{compactId(relation.toEventId)}</strong>
                  <small>{eventById.get(relation.toEventId)?.domain ?? "UNKNOWN"}</small>
                </div>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Export & commandes audit" actions={<InlineAction>Command Runtime</InlineAction>} density="compact">
          <div className="events-command-actions">
            {data.commandActions.map((action) => (
              <article key={action.actionId}>
                <span>{action.commandType.includes("export") ? <FaDownload /> : action.commandType.includes("copy") ? <FaDatabase /> : <FaProjectDiagram />}</span>
                <div>
                  <strong>{action.label}</strong>
                  <small>{action.commandType} · {action.requiresConfirmation ? "confirm" : "instant"}</small>
                </div>
                <StatusBadge tone={permissionTone(action.permission)}>{permissionLabel(action.permission)}</StatusBadge>
                <DeskButton
                  variant="primary"
                  disabled={action.permission !== "ALLOWED" || submittingActionId === action.actionId}
                  onClick={() => confirmAction(action)}
                >
                  {submittingActionId === action.actionId ? "Envoi..." : "Confirmer"}
                </DeskButton>
              </article>
            ))}
          </div>
          <div className="events-command-result">
            <FaFingerprint />
            <div>
              <small>Dernière commande audit</small>
              <strong>{command ? `ACCEPTED · ${command.commandId}` : "Aucune commande confirmée"}</strong>
              {commandError ? <span className="text-danger">{commandError}</span> : null}
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}

function EventsAuditLoading() {
  return (
    <div className="operator-page events-page">
      <section className="operator-kpi-strip">
        {Array.from({ length: 6 }).map((_, index) => <Card key={index} state="loading" density="compact"><div className="skeleton-line" /></Card>)}
      </section>
    </div>
  );
}

function laneIcon(lane: AuditEvent["lane"]) {
  if (lane === "ADVISORY") return <FaRobot />;
  if (lane === "SYSTEM") return <FaStream />;
  return <FaRoute />;
}

function statusTone(status: AuditEvent["status"]) {
  if (status === "OK") return "success";
  if (status === "FAILED") return "danger";
  if (status === "WATCH") return "warning";
  return "accent";
}

function statusLabel(status: AuditEvent["status"]) {
  return status === "FAILED" ? "FAIL" : status === "EXPECTED" ? "NEXT" : status;
}

function permissionTone(permission: AuditAction["permission"]) {
  if (permission === "ALLOWED") return "success";
  if (permission === "STEP_UP_REQUIRED") return "warning";
  return "danger";
}

function permissionLabel(permission: AuditAction["permission"]) {
  if (permission === "STEP_UP_REQUIRED") return "STEP-UP";
  return permission;
}

function domainLabel(domain: EventsAuditView["filters"]["domains"][number]) {
  return domain === "PORTFOLIO" ? "PORTF" : domain === "EXECUTION" ? "EXEC" : domain;
}

function compactId(value: string) {
  return value
    .replace("corr_live_reconcile_", "corr:")
    .replace("evt_", "")
    .replace("provider_", "prov:")
    .replace("strinst_", "str:")
    .replace("sig_vnext_demo_", "sig:");
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}
