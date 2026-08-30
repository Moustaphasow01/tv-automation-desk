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
import { presentDomain, presentPermission, presentQueueStatus, presentRelationKind } from "@/design-system/labels";
import { operatorCode, operatorCopy, operatorDuration } from "@/design-system/operatorVocabulary";
import { InlineAction, MetricBox, OperatorPageHeader } from "@/design-system/workspace";
import { DataBoundary, ViewTruthBanner } from "@/design-system/states";
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
      <div className="operator-page events-page">
        <h1 className="sr-only">Chronologie &amp; Audit</h1>
        <Card title="Chronologie et audit indisponibles" eyebrow="Erreur de contrat" tone="danger" density="compact">
          <p>{(query.error as Error).message}</p>
        </Card>
      </div>
    );
  }

  if (!query.data) {
    return (
      <div className="operator-page events-page">
        <h1 className="sr-only">Chronologie &amp; Audit</h1>
        <Card title="Aucun événement" eyebrow="État vide" state="empty" density="compact">
          <p>Le service du desk ne publie pas encore la chronologie d’audit.</p>
        </Card>
      </div>
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
        title="Chronologie & Audit"
        description={`Séquence active · fenêtre ${operatorCopy(data.filters.windowLabel)} · actualisée en ${formatLatency(meta.latencyMs)}.`}
        actions={
          <>
            <label className="events-search" aria-label="Séquence d’événements active" title={requestedCorrelationId}>
              <FaSearch />
              <input readOnly value="Séquence active" />
            </label>
            <Link className="operator-primary-action" to="/operations">Retour opérations</Link>
          </>
        }
      />

      <section className="operator-kpi-strip" aria-label="Indicateurs de la chronologie d’audit">
        <KpiCard label="Événements" value={`${data.summary.totalEvents}`} delta={`${data.summary.correlations} séquences`} tone="info" />
        <KpiCard label="Décisions qui engagent" value={`${data.summary.authoritativeSteps}`} delta="Ordre déterministe" tone="success" />
        <KpiCard label="Avis consultatifs" value={`${data.summary.advisoryBranches}`} delta="Hors chaîne d’ordre" tone="warning" />
        <KpiCard label="Latence moyenne" value={formatLatency(data.summary.avgLatencyMs)} delta={`${formatLatency(selected.totalLatencyMs)} au total`} tone="info" />
        <KpiCard label="Contenus exportables" value={`${data.summary.exportablePayloads}`} delta="Copie ou export autorisé" tone="success" />
        <KpiCard label="Début" value={rootEvent ? formatTime(rootEvent.at) : "—"} delta={rootEvent ? eventLabel(rootEvent) : "Non publié"} tone="info" />
      </section>

      <section className="operator-grid operator-grid--top" aria-label="Chronologie, décisions et détail">
        <Card title="Chronologie" actions={<InlineAction>Liens directs</InlineAction>} density="compact">
          <div className="events-timeline-list">
            {shownEvents.map((event, index) => (
              <Link key={`${event.eventId}-${index}`} to={`${event.route}?eventId=${event.eventId}&correlationId=${event.correlationId}`}>
                <span className={`events-lane-dot events-lane-dot--${(event.lane || "unknown").toLowerCase()}`}>{laneIcon(event.lane)}</span>
                <div>
                  <strong title={event.eventId}>{eventLabel(event)}</strong>
                  <small title={event.causationId ?? undefined}>{formatTime(event.at)} · {event.causationId ? "Déclenché par un événement précédent" : "Événement initial"}</small>
                </div>
                <b>{formatLatency(event.latencyMs)}</b>
                <StatusBadge tone={statusTone(event.status)}>{statusLabel(event.status)}</StatusBadge>
              </Link>
            ))}
          </div>
        </Card>

        <Card title="Décisions qui engagent et avis consultatifs" actions={<InlineAction>Séquence</InlineAction>} density="compact">
          <div className="events-correlation-chain">
            <section className="events-path events-path--authoritative">
              <header><FaShieldAlt /><strong>Décisions qui engagent le desk</strong><span>{selected.authoritativePath.length}</span></header>
              {selected.authoritativePath.map((eventId, index) => {
                const event = eventById.get(eventId);
                return (
                  <article key={`${eventId}-${index}`}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong title={eventId}>{event ? eventLabel(event) : "Événement manquant"}</strong>
                      <small>{event ? presentDomain(event.domain).label : "Non publié"}</small>
                    </div>
                    <StatusBadge tone={event ? statusTone(event.status) : "danger"}>{event ? statusLabel(event.status) : "Manquant"}</StatusBadge>
                  </article>
                );
              })}
            </section>
            <section className="events-path events-path--advisory">
              <header><FaRobot /><strong>Avis de l’IA, non contraignants</strong><span>{selected.advisoryPath.length}</span></header>
              {selected.advisoryPath.map((eventId, index) => {
                const event = eventById.get(eventId);
                return (
                  <article key={`${eventId}-${index}`}>
                    <span><FaCodeBranch /></span>
                    <div>
                      <strong title={eventId}>{event ? eventLabel(event) : "Événement manquant"}</strong>
                      <small>Documente le contexte, ne commande pas l’ordre.</small>
                    </div>
                    <StatusBadge tone="warning">Observation seule</StatusBadge>
                  </article>
                );
              })}
            </section>
          </div>
        </Card>

        <Card title="Détail de l’événement" actions={<InlineAction>Inspecter</InlineAction>} density="compact">
          <div className="events-payload-list">
            {selected.payloadPreview.map((item, index) => (
              <article key={`${item.key}-${index}`}>
                <small>{auditFieldLabel(item.key)}</small>
                <strong>{operatorCopy(item.value)}</strong>
              </article>
            ))}
          </div>
          <div className="events-log-list">
            {selected.logs.map((log, index) => (
              <article key={`${log.logId}-${index}`}>
                <StatusBadge tone={log.level === "ERROR" ? "danger" : log.level === "WARN" ? "warning" : "success"}>{operatorCode(log.level)}</StatusBadge>
                <div>
                  <strong title={log.logId}>Message système</strong>
                  <small>{operatorCopy(log.message)}</small>
                </div>
              </article>
            ))}
          </div>
        </Card>
      </section>

      <section className="operator-grid operator-grid--bottom" aria-label="Filtres, relations et commandes">
        <Card title="Filtres de recherche" actions={<InlineAction>Filtres</InlineAction>} density="compact">
          <div className="events-filter-grid">
            <MetricBox label="Séquence" value="Active" />
            <MetricBox label="Fenêtre" value={data.filters.windowLabel} />
            <MetricBox label="Domaines" value={data.filters.domains.length} />
            <MetricBox label="Statuts" value={data.filters.statuses.length} />
          </div>
          <div className="events-chip-cloud">
            {data.filters.domains.map((domain, index) => <StatusBadge key={`${domain}-${index}`} tone="info">{domainLabel(domain)}</StatusBadge>)}
            {data.filters.statuses.map((status, index) => <StatusBadge key={`${status}-${index}`} tone={statusTone(status)}>{statusLabel(status)}</StatusBadge>)}
          </div>
        </Card>

        <Card title="Enchaînement des événements" actions={<InlineAction>Graphe</InlineAction>} density="compact">
          <div className="events-relations-list">
            <DataBoundary value={data.relations} empty="Aucune relation causale n'est publiée pour la corrélation active.">
            {(relations) => relations.map((relation, index) => (
              <article key={`${relation.fromEventId}:${relation.toEventId}-${index}`}>
                <span><FaBezierCurve /></span>
                <div>
                  <strong title={relation.fromEventId}>{eventLabel(eventById.get(relation.fromEventId))}</strong>
                  <small>{presentRelationKind(relation.relation).label}</small>
                </div>
                <FaArrowRight />
                <div>
                  <strong title={relation.toEventId}>{eventLabel(eventById.get(relation.toEventId))}</strong>
                  <small>{presentDomain(eventById.get(relation.toEventId)?.domain).label}</small>
                </div>
              </article>
            ))}
            </DataBoundary>
          </div>
        </Card>

        <Card title="Export et commandes d’audit" actions={<InlineAction>Flux de commande</InlineAction>} density="compact">
          <div className="events-command-actions">
            {data.commandActions.map((action, index) => (
              <article key={`${action.actionId}-${index}`}>
                <span>{action.commandType.includes("export") ? <FaDownload /> : action.commandType.includes("copy") ? <FaDatabase /> : <FaProjectDiagram />}</span>
                <div>
                  <strong>{operatorCopy(action.label)}</strong>
                  <small title={action.commandType}>{action.requiresConfirmation ? "Confirmation requise" : "Action immédiate"}</small>
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
              <strong title={command?.commandId}>{command ? "Commande acceptée" : "Aucune commande confirmée"}</strong>
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
      <h1 className="sr-only">Chronologie &amp; Audit</h1>
      <section className="operator-kpi-strip">
        {Array.from({ length: 6 }).map((_, index) => <Card key={index} state="loading" density="compact"><div className="skeleton-line" /></Card>)}
      </section>
    </div>
  );
}

function laneIcon(lane: AuditEvent["lane"] | undefined) {
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
  return presentQueueStatus(status).label;
}

function permissionTone(permission: AuditAction["permission"]) {
  if (permission === "ALLOWED") return "success";
  if (permission === "STEP_UP_REQUIRED") return "warning";
  return "danger";
}

function permissionLabel(permission: AuditAction["permission"]) {
  return presentPermission(permission).label;
}

function domainLabel(domain: EventsAuditView["filters"]["domains"][number]) {
  return presentDomain(domain).label;
}

function eventLabel(event: AuditEvent | undefined) {
  if (!event) return "Événement non publié";
  return `${presentDomain(event.domain).label} · ${operatorCode(event.eventType)} · ${formatTime(event.at)}`;
}

function auditFieldLabel(key: string) {
  const labels: Record<string, string> = {
    sourceId: "Référence",
    source_id: "Référence",
    sourceCollection: "Origine",
    source_collection: "Origine",
    kind: "Type",
    title: "Titre",
    message: "Détail",
    payload: "Contenu de l’événement",
    eventId: "Événement",
    causationId: "Déclenché par",
  };
  return labels[key] ?? operatorCode(key);
}

function formatLatency(milliseconds: number) {
  if (!Number.isFinite(milliseconds)) return "Non publiée";
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  return operatorDuration(milliseconds / 1000);
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
