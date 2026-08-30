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
import { operatorCode, operatorCopy, operatorDuration, operatorReason } from "@/design-system/operatorVocabulary";
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
      <Card title="File d’opérations indisponible" eyebrow="ERREUR CONTRAT" tone="danger" density="compact">
        <p>{(query.error as Error).message}</p>
      </Card>
    );
  }

  if (!query.data) {
    return (
      <Card title="Aucune donnée d’opération" eyebrow="ÉTAT VIDE" state="empty" density="compact">
        <p>La file d’opérations n’est pas encore publiée.</p>
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
        description="Missions IA, événements attendus, transitions automatiques, nouvelles tentatives et traitements en échec — sans assignation humaine."
        actions={
          <>
            <Link to="/events">Voir les événements</Link>
            <Link className="operator-primary-action" to="/events">Chronologie d'audit</Link>
          </>
        }
      />

      <section className="operator-kpi-strip" aria-label="Indicateurs Opérations">
        <KpiCard label="Missions actives" value={`${data.summary.activeMissions}`} delta="Pilotées par un agent IA" tone="success" />
        <KpiCard label="Événements attendus" value={`${data.summary.waitingEvents}`} delta="Transitions en attente" tone="info" />
        <KpiCard label="Validations bloquantes" value={`${data.summary.blockedGates}`} delta="Intervention opérateur exceptionnelle" tone={data.summary.blockedGates > 0 ? "warning" : "success"} />
        <KpiCard label="Nouvelles tentatives" value={`${data.summary.retryBacklog}`} delta="Délai contrôlé" tone="warning" />
        <KpiCard label="Traitements en échec" value={`${data.summary.dlqItems}`} delta="À examiner" tone={data.summary.dlqItems > 0 ? "danger" : "success"} />
        <KpiCard label="Budget utilisé" value={`${data.summary.budgetUsedPct}%`} delta={`Réponse en ${meta.latencyMs} ms`} tone="info" />
      </section>

      <section className="operator-grid operator-grid--top" aria-label="Queue autonome et événements">
        <Card title="File des missions autonomes" actions={<InlineAction>Missions</InlineAction>} density="compact">
          <div className="operations-mission-list">
            {data.missions.map((mission, index) => (
              <article key={uniqueViewKey(mission.missionId, index)} className={`operations-mission operations-mission--${mission.state.toLowerCase()}`}>
                <span><FaRobot /></span>
                <div>
                  <strong>{mission.title}</strong>
                  <small>{mission.ownerAgent} · {operatorCopy(mission.currentTask)}</small>
                </div>
                <StatusBadge tone={stateTone(mission.state)}>{presentQueueStatus(mission.state).label}</StatusBadge>
                <small>{mission.retryCount}/{mission.maxRetries}</small>
                <ProgressBar value={mission.computeBudgetPct} label={`Compute ${mission.computeBudgetPct}%`} tone={mission.computeBudgetPct > 70 ? "warning" : "accent"} />
              </article>
            ))}
          </div>
        </Card>

        <Card title="Événements attendus et reçus" actions={<InlineAction>Traçabilité</InlineAction>} density="compact">
          <div className="operations-event-flow">
            {data.eventFlow.map((event, index) => (
              <Link key={uniqueViewKey(event.eventId, index)} to={`/events?correlationId=${event.correlationId}`}>
                <span><FaBolt /></span>
                <div>
                  <strong title={event.eventType}>{operatorCode(event.eventType)}</strong>
                  <small>{formatTime(event.at)}</small>
                </div>
                <b>{event.latencyMs ? `${event.latencyMs}ms` : "—"}</b>
                <StatusBadge tone={eventTone(event.status)}>{presentQueueStatus(event.status).label}</StatusBadge>
              </Link>
            ))}
          </div>
        </Card>

        <Card title="Contrôles de politique et commandes" actions={<InlineAction>Flux de commande</InlineAction>} density="compact">
          <div className="operations-gate-list">
            {data.policyGates.map((gate, index) => (
              <article key={uniqueViewKey(gate.gateId, index)}>
                <FaShieldAlt />
                <div>
                  <strong>{gate.label}</strong>
                  <small title={gate.reason}>{operatorReason(gate.reason)}</small>
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
                  <small title={`${action.commandType} · ${action.missionId}`}>{operatorCode(action.commandType)}</small>
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

      <section className="operator-grid operator-grid--bottom" aria-label="Traitements en échec, incidents et preuve d'autonomie">
        <Card title="Tentatives, traitements en échec et budgets" actions={<InlineAction>Délais</InlineAction>} density="compact">
          <div className="operations-budget-grid">
            <MetricBox label="Budget tokens max" value={`${Math.max(...data.missions.map((mission) => mission.tokenBudgetPct))}%`} />
            <MetricBox label="Budget compute max" value={`${Math.max(...data.missions.map((mission) => mission.computeBudgetPct))}%`} />
            <MetricBox label="Retry max" value={`${Math.max(...data.missions.map((mission) => mission.retryCount))}`} />
            <MetricBox label="Échecs récupérables" value={`${data.deadLetters.filter((item) => item.retryable).length}`} />
          </div>
          <div className="operations-dlq-list">
            {data.deadLetters.map((item, index) => (
              <article key={uniqueViewKey(item.dlqId, index)}>
                <FaServer />
                <div>
                  <strong title={item.reason}>{operatorReason(item.reason)}</strong>
                  <small title={`${item.dlqId} · ${item.lastErrorCode}`}>{operatorCode(item.lastErrorCode)}</small>
                </div>
                <b>{operatorDuration(item.ageMinutes * 60)}</b>
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
                  <small title={`${incident.incidentId} · ${incident.missionId}`}>Ouvrir l’incident</small>
                </div>
                <span>{incident.domain}</span>
                <StatusBadge tone={incidentTone(incident.severity)}>{presentSeverity(incident.severity).label}</StatusBadge>
              </Link>
            ))}
          </div>
          <div className="operations-command-result">
            <small>Dernière commande d’opération</small>
            <strong title={command?.commandId}>{command ? "Commande acceptée" : "Aucune commande confirmée"}</strong>
            {commandError ? <span className="text-danger">{commandError}</span> : null}
          </div>
        </Card>

        <Card title="Preuve autonomie machine" actions={<InlineAction>Audit</InlineAction>} density="compact">
          <div className="operations-autonomy-flow">
            <article><FaRoute /><strong>Mission</strong><small>Objectif métier atomique</small></article>
            <article><FaRobot /><strong>Agent IA</strong><small>Responsable logique, pas humain</small></article>
            <article><FaClock /><strong>Événement attendu</strong><small>Transition déclenchée par événement</small></article>
            <article><FaRandom /><strong>Prochaine transition</strong><small>Automatique ou validation explicite</small></article>
          </div>
          <div className="operations-autonomy-note">
            <FaProjectDiagram />
            <span>Aucun champ d’assignation humaine n’est exposé. L’opérateur agit seulement via des validations exceptionnelles et des commandes sans doublon.</span>
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
