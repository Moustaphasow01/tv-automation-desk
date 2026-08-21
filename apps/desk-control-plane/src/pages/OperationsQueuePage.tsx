import { useState } from "react";
import { Link } from "react-router-dom";
import {
  FaBolt,
  FaClock,
  FaExclamationTriangle,
  FaProjectDiagram,
  FaRandom,
  FaRobot,
  FaRoute,
  FaServer,
  FaShieldAlt
} from "react-icons/fa";
import { DeskButton } from "@/design-system/actions";
import { Card, KpiCard, ProgressBar, StatusBadge } from "@/design-system/primitives";
import { presentPermission, presentQueueStatus, presentSeverity } from "@/design-system/labels";
import { InlineAction, MetricBox, OperatorPageHeader } from "@/design-system/workspace";
import { ViewTruthBanner } from "@/design-system/states";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { CommandAccepted } from "@/domains/realtime/commandRuntime";
import type { OperationsQueueView } from "@/domains/front-api/viewModels";

type OperationAction = OperationsQueueView["commandActions"][number];

export function OperationsQueuePage() {
  const query = useFrontView("operations-queue");
  const repository = useFrontViewRepository();
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);

  if (query.isLoading) {
    return <OperationsLoading />;
  }

  if (query.isError) {
    return (
      <Card title="Operations Queue indisponible" eyebrow="ERREUR CONTRAT" tone="danger" density="compact">
        <p>{(query.error as Error).message}</p>
      </Card>
    );
  }

  if (!query.data) {
    return (
      <Card title="Aucune donnée Operations" eyebrow="EMPTY" state="empty" density="compact">
        <p>Le BFF ne retourne pas encore la projection `/views/operations-queue`.</p>
      </Card>
    );
  }

  const { data, meta } = query.data;

  const confirmAction = async (action: OperationAction) => {
    setSubmittingActionId(action.actionId);
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand({
        commandType: action.commandType,
        environment: "MOCK",
        expectedVersion: action.actionId,
        reason: `Operations autonomous action confirmed: ${action.label}`,
        payload: action.payload
      });
      setCommand(accepted);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "OPERATIONS_COMMAND_FAILED");
    } finally {
      setSubmittingActionId(null);
    }
  };

  return (
    <div className="operator-page operations-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader
        title="File d'opérations autonomes"
        description="Missions IA, événements attendus, transitions automatiques, retries et DLQ — sans assignation humaine."
        actions={
          <>
            <Link to="/events">Voir les événements</Link>
            <Link className="operator-primary-action" to="/events">Chronologie d'audit</Link>
          </>
        }
      />

      <section className="operator-kpi-strip" aria-label="Indicateurs Opérations">
        <KpiCard label="MISSIONS ACTIVES" value={`${data.summary.activeMissions}`} delta="Propriétaire = agent IA" tone="success" />
        <KpiCard label="ÉVÉNEMENTS ATTENDUS" value={`${data.summary.waitingEvents}`} delta="Transitions en attente" tone="info" />
        <KpiCard label="GATES BLOQUANTS" value={`${data.summary.blockedGates}`} delta="Operator gate exceptionnel" tone={data.summary.blockedGates > 0 ? "warning" : "success"} />
        <KpiCard label="BACKLOG DE TENTATIVES" value={`${data.summary.retryBacklog}`} delta="Backoff contrôlé" tone="warning" />
        <KpiCard label="DLQ" value={`${data.summary.dlqItems}`} delta="À investiguer" tone={data.summary.dlqItems > 0 ? "danger" : "success"} />
        <KpiCard label="BUDGET UTILISÉ" value={`${data.summary.budgetUsedPct}%`} delta={`Projection ${meta.latencyMs} ms`} tone="info" />
      </section>

      <section className="operator-grid operator-grid--top" aria-label="Queue autonome et événements">
        <Card title="Mission queue autonome" actions={<InlineAction>Missions</InlineAction>} density="compact">
          <div className="operations-mission-list">
            {data.missions.map((mission, index) => (
              <article key={uniqueViewKey(mission.missionId, index)} className={`operations-mission operations-mission--${mission.state.toLowerCase()}`}>
                <span><FaRobot /></span>
                <div>
                  <strong>{mission.title}</strong>
                  <small>{mission.ownerAgent} · {mission.currentTask}</small>
                </div>
                <StatusBadge tone={stateTone(mission.state)}>{presentQueueStatus(mission.state).label}</StatusBadge>
                <small>{mission.retryCount}/{mission.maxRetries}</small>
                <ProgressBar value={mission.computeBudgetPct} label={`Compute ${mission.computeBudgetPct}%`} tone={mission.computeBudgetPct > 70 ? "warning" : "accent"} />
              </article>
            ))}
          </div>
        </Card>

        <Card title="Events attendus/reçus" actions={<InlineAction>IDs de corrélation</InlineAction>} density="compact">
          <div className="operations-event-flow">
            {data.eventFlow.map((event, index) => (
              <Link key={uniqueViewKey(event.eventId, index)} to={`/events?correlationId=${event.correlationId}`}>
                <span><FaBolt /></span>
                <div>
                  <strong>{event.eventType}</strong>
                  <small>{event.correlationId} · {formatTime(event.at)}</small>
                </div>
                <b>{event.latencyMs ? `${event.latencyMs}ms` : "—"}</b>
                <StatusBadge tone={eventTone(event.status)}>{presentQueueStatus(event.status).label}</StatusBadge>
              </Link>
            ))}
          </div>
        </Card>

        <Card title="Gates de politique & commandes" actions={<InlineAction>Flux de commande</InlineAction>} density="compact">
          <div className="operations-gate-list">
            {data.policyGates.map((gate, index) => (
              <article key={uniqueViewKey(gate.gateId, index)}>
                <FaShieldAlt />
                <div>
                  <strong>{gate.label}</strong>
                  <small>{gate.reason}</small>
                </div>
                <StatusBadge tone={gateTone(gate.state)}>{presentQueueStatus(gate.state).label}</StatusBadge>
              </article>
            ))}
          </div>
          <div className="operations-command-actions">
            {data.commandActions.map((action, index) => (
              <article key={uniqueViewKey(action.actionId, index)}>
                <div>
                  <strong>{action.label}</strong>
                  <small>{action.commandType} · {action.missionId}</small>
                </div>
                <StatusBadge tone={action.permission === "ALLOWED" ? "success" : action.permission === "STEP_UP_REQUIRED" ? "warning" : "danger"}>{presentPermission(action.permission).label}</StatusBadge>
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
        </Card>
      </section>

      <section className="operator-grid operator-grid--bottom" aria-label="DLQ, incidents et preuve d'autonomie">
        <Card title="Tentatives, DLQ & budgets" actions={<InlineAction>Backoff</InlineAction>} density="compact">
          <div className="operations-budget-grid">
            <MetricBox label="Budget tokens max" value={`${Math.max(...data.missions.map((mission) => mission.tokenBudgetPct))}%`} />
            <MetricBox label="Budget compute max" value={`${Math.max(...data.missions.map((mission) => mission.computeBudgetPct))}%`} />
            <MetricBox label="Retry max" value={`${Math.max(...data.missions.map((mission) => mission.retryCount))}`} />
            <MetricBox label="DLQ retryable" value={`${data.deadLetters.filter((item) => item.retryable).length}`} />
          </div>
          <div className="operations-dlq-list">
            {data.deadLetters.map((item, index) => (
              <article key={uniqueViewKey(item.dlqId, index)}>
                <FaServer />
                <div>
                  <strong>{item.reason}</strong>
                  <small>{item.dlqId} · {item.lastErrorCode}</small>
                </div>
                <b>{item.ageMinutes}m</b>
                <StatusBadge tone={item.retryable ? "warning" : "danger"}>{item.retryable ? "Réessayable" : "Définitif"}</StatusBadge>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Incidents liés aux missions" actions={<InlineAction>Incidents</InlineAction>} density="compact">
          <div className="operations-incident-list">
            {data.incidents.map((incident, index) => (
              <Link key={uniqueViewKey(incident.incidentId, index)} to={incident.route}>
                <FaExclamationTriangle />
                <div>
                  <strong>{incident.title}</strong>
                  <small>{incident.incidentId} · {incident.missionId}</small>
                </div>
                <span>{incident.domain}</span>
                <StatusBadge tone={incidentTone(incident.severity)}>{presentSeverity(incident.severity).label}</StatusBadge>
              </Link>
            ))}
          </div>
          <div className="operations-command-result">
            <small>Dernière commande Operations</small>
            <strong>{command ? `Acceptée · ${command.commandId}` : "Aucune commande confirmée"}</strong>
            {commandError ? <span className="text-danger">{commandError}</span> : null}
          </div>
        </Card>

        <Card title="Preuve autonomie machine" actions={<InlineAction>Audit</InlineAction>} density="compact">
          <div className="operations-autonomy-flow">
            <article><FaRoute /><strong>Mission</strong><small>Objectif métier atomique</small></article>
            <article><FaRobot /><strong>Agent IA</strong><small>Owner logique, pas humain</small></article>
            <article><FaClock /><strong>Event attendu</strong><small>Transition déclenchée par événement</small></article>
            <article><FaRandom /><strong>Prochaine transition</strong><small>Automatique ou gate explicite</small></article>
          </div>
          <div className="operations-autonomy-note">
            <FaProjectDiagram />
            <span>Aucun champ d’assignation humaine n’est exposé. L’opérateur agit seulement via gates exceptionnels et commandes idempotentes.</span>
          </div>
        </Card>
      </section>
    </div>
  );
}

function OperationsLoading() {
  return (
    <div className="operator-page operations-page">
      <section className="operator-kpi-strip">
        {Array.from({ length: 6 }).map((_, index) => <Card key={index} state="loading" density="compact"><div className="skeleton-line" /></Card>)}
      </section>
    </div>
  );
}

function stateTone(state: OperationsQueueView["missions"][number]["state"]) {
  if (state === "RUNNING" || state === "DONE") return "success";
  if (state === "DLQ") return "danger";
  if (state === "OPERATOR_GATE_REQUIRED" || state === "RETRYING") return "warning";
  return "accent";
}

function eventTone(status: OperationsQueueView["eventFlow"][number]["status"]) {
  if (status === "RECEIVED") return "success";
  if (status === "BLOCKED") return "danger";
  if (status === "STALE") return "warning";
  return "accent";
}

function gateTone(state: OperationsQueueView["policyGates"][number]["state"]) {
  if (state === "PASS") return "success";
  if (state === "BLOCKED") return "danger";
  if (state === "OPERATOR_GATE_REQUIRED") return "warning";
  return "accent";
}

function incidentTone(severity: OperationsQueueView["incidents"][number]["severity"]) {
  if (severity === "CRITICAL" || severity === "HIGH") return "danger";
  if (severity === "MEDIUM") return "warning";
  return "accent";
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function uniqueViewKey(value: string | undefined, index: number) {
  return `${value?.trim() || "item"}__${index}`;
}
