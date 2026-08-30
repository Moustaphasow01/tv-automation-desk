import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { routeDisplayName } from "@/app/routes";
import {
  FaBell,
  FaCheckCircle,
  FaExternalLinkAlt,
  FaMicrophone,
  FaRobot,
  FaShieldAlt,
  FaTasks,
  FaVolumeMute
} from "react-icons/fa";
import { DeskButton } from "@/design-system/actions";
import { Card, KpiCard, ProgressBar, StatusBadge } from "@/design-system/primitives";
import { operatorCode, operatorDuration } from "@/design-system/operatorVocabulary";
import { InlineAction, MetricBox, OperatorPageHeader } from "@/design-system/workspace";
import { ViewTruthBanner } from "@/design-system/states";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { CommandAccepted } from "@/domains/realtime/commandRuntime";
import type { JarvisWorkspaceView } from "@/domains/front-api/viewModels";

type PendingAction = JarvisWorkspaceView["pendingActions"][number];

export function JarvisWorkspacePage() {
  const query = useFrontView("jarvis-workspace");
  const repository = useFrontViewRepository();
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);
  const [selectedAssistantId, setSelectedAssistantId] = useState("assistant_research");
  const [assistantQuestion, setAssistantQuestion] = useState("");

  if (query.isLoading) {
    return <JarvisLoading />;
  }

  if (query.isError) {
    return (
      <div className="operator-page jarvis-page">
        <h1 className="sr-only">Espace Jarvis</h1>
        <Card title="Jarvis indisponible" eyebrow="ERREUR CONTRAT" tone="danger" density="compact">
          <p>{(query.error as Error).message}</p>
        </Card>
      </div>
    );
  }

  if (!query.data) {
    return (
      <div className="operator-page jarvis-page">
        <h1 className="sr-only">Espace Jarvis</h1>
        <Card title="Aucune donnée Jarvis" eyebrow="EMPTY" state="empty" density="compact">
          <p>Les données de l’espace Jarvis ne sont pas encore publiées.</p>
        </Card>
      </div>
    );
  }

  const { data, meta } = query.data;
  const assistantOptions = data.missions.map((mission) => ({ assistantId: mission.missionId, label: mission.title }));
  const activeAssistantId = assistantOptions.some((item) => item.assistantId === selectedAssistantId)
    ? selectedAssistantId
    : assistantOptions[0]?.assistantId ?? "assistant_research";

  const confirmAction = async (action: PendingAction) => {
    setSubmittingActionId(action.actionId);
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand({
        commandType: action.commandType,
        environment: "MOCK",
        expectedVersion: action.actionId,
        reason: `Jarvis pending action confirmed: ${action.title}`,
        payload: action.payload
      });
      setCommand(accepted);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "JARVIS_COMMAND_FAILED");
    } finally {
      setSubmittingActionId(null);
    }
  };

  const submitAssistantQuestion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const question = assistantQuestion.trim();
    if (!question) return;
    setSubmittingActionId("assistant-question");
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand({
        commandType: "assistant.question.submit",
        environment: "PAPER",
        reason: `Jarvis domain assistant question: ${activeAssistantId}`,
        payload: {
          assistantId: activeAssistantId,
          question,
          sourceRefs: data.citations.map((citation) => citation.citationId),
          domainSnapshot: {
            riskUsedPct: data.deskSnapshot.riskUsedPct,
            liveSignals: data.deskSnapshot.liveSignals,
            researchExperiments: data.deskSnapshot.researchExperiments,
            openIncidents: data.deskSnapshot.openIncidents
          }
        }
      });
      setCommand(accepted);
      setAssistantQuestion("");
      void query.refetch();
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "JARVIS_QUESTION_FAILED");
    } finally {
      setSubmittingActionId(null);
    }
  };

  return (
    <div className="operator-page jarvis-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader
        title="Espace Jarvis"
        description="Assistant opérateur : brief, sources, conversation et actions contrôlées."
        actions={
          <>
            <span title="Création de brief non exposée par le backend">Nouveau brief indisponible</span>
            <span title="Commande vocale non exposée par le backend">Push-to-talk indisponible</span>
            <Link className="operator-primary-action" to="/command-center">Retour {routeDisplayName("command-center")}</Link>
          </>
        }
      />

      <section className="operator-kpi-strip" aria-label="Indicateurs Jarvis">
        <KpiCard label="Brief matinal" value={operatorCode(data.summary.morningBriefStatus)} delta={`${data.morningBrief.length} sections`} tone="success" />
        <KpiCard label="Suggestions" value={`${data.summary.openSuggestions}`} delta="Propositions contextuelles" tone="info" />
        <KpiCard label="Actions en attente" value={`${data.summary.pendingActions}`} delta="Confirmation opérateur requise" tone="warning" />
        <KpiCard label="Agents IA actifs" value={`${data.summary.activeAgents}`} delta={`${data.missions.length} missions visibles`} tone="info" />
        <KpiCard label="Service vocal" value={operatorCode(data.summary.voiceStatus)} delta={data.voice.degradationReason ?? "Commande vocale prête"} tone={data.summary.voiceStatus === "READY" ? "success" : "warning"} />
        <KpiCard label="Fraîcheur" value={operatorDuration(data.summary.freshnessSeconds)} delta={`Réponse en ${meta.latencyMs} ms`} tone={data.summary.freshnessSeconds > 3600 ? "warning" : "success"} />
      </section>

      <section className="operator-grid operator-grid--top" aria-label="Brief, conversation et actions Jarvis">
        <Card title="Brief matinal structuré" actions={<InlineAction>Brief complet</InlineAction>} density="compact">
          <div className="jarvis-brief-list">
            {data.morningBrief.map((section) => (
              <article key={section.sectionId}>
                <span>{briefIcon(section.status)}</span>
                <div><strong>{section.domain} · {section.headline}</strong><small>{section.detail}</small></div>
                <StatusBadge tone={section.status === "OK" ? "success" : section.status === "HIGH" ? "danger" : "warning"}>{operatorCode(section.status)}</StatusBadge>
              </article>
            ))}
          </div>
          <div className="jarvis-suggestions">
            {data.suggestions.map((suggestion) => (
              <article key={suggestion.suggestionId}>
                <strong>{suggestion.title}</strong>
                <small>{suggestion.impact}</small>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Conversation et réponses sourcées" actions={<InlineAction>Historique</InlineAction>} density="compact">
          <form className="jarvis-question-box" onSubmit={submitAssistantQuestion}>
            <label>
              <span>Assistant</span>
              <select value={activeAssistantId} onChange={(event) => setSelectedAssistantId(event.target.value)}>
                {assistantOptions.map((option) => (
                  <option key={option.assistantId} value={option.assistantId}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Question opérateur</span>
              <textarea
                value={assistantQuestion}
                onChange={(event) => setAssistantQuestion(event.target.value)}
                placeholder="Posez une question en lecture seule : recherche, signaux, risque, fournisseurs ou données…"
                rows={3}
              />
            </label>
            <DeskButton variant="primary" type="submit" disabled={!assistantQuestion.trim() || submittingActionId === "assistant-question"}>
              {submittingActionId === "assistant-question" ? "Envoi…" : "Demander"}
            </DeskButton>
          </form>
          <div className="jarvis-conversation">
            {data.conversation.map((message) => (
              <article key={message.messageId} className={`jarvis-message jarvis-message--${message.role}`}>
                <header><strong>{message.role === "jarvis" ? "Jarvis" : message.role === "operator" ? "Opérateur" : "Système"}</strong><span>{formatTime(message.at)}</span></header>
                <p>{message.text}</p>
                {message.citationIds.length ? (
                  <div>
                    {message.citationIds.map((citationId) => <CitationLink key={citationId} citationId={citationId} citations={data.citations} />)}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </Card>

        <Card title="Actions en attente et voix" actions={<InlineAction>Commandes</InlineAction>} density="compact">
          <div className="jarvis-action-list">
            {data.pendingActions.map((action) => (
              <article key={action.actionId}>
                <div><strong>{action.title}</strong><small>{action.impact}</small></div>
                <StatusBadge tone={action.permission === "ALLOWED" ? "success" : action.permission === "STEP_UP_REQUIRED" ? "warning" : "danger"}>
                  {operatorCode(action.permission)}
                </StatusBadge>
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
          <div className="jarvis-voice-card">
            {data.voice.pushToTalkAvailable ? <FaMicrophone /> : <FaVolumeMute />}
            <div>
              <strong>Voix · {operatorCode(data.voice.serviceStatus)}</strong>
              <small>{data.voice.degradationReason ?? data.voice.lastTranscript ?? "Push-to-talk accessible"}</small>
            </div>
          </div>
          <div className="jarvis-command-result">
            <small>Résultat commande</small>
            <strong title={command?.commandId}>{command ? "Commande acceptée" : "Aucune commande Jarvis confirmée"}</strong>
            {commandError ? <span className="text-danger">{commandError}</span> : null}
          </div>
        </Card>
      </section>

      <section className="operator-grid operator-grid--bottom" aria-label="État du desk, sources et alertes Jarvis">
        <Card title="État du desk et missions IA" actions={<InlineAction>Agents IA</InlineAction>} density="compact">
          <div className="jarvis-snapshot-grid">
            <MetricBox label="Risque utilisé" value={`${Math.round(data.deskSnapshot.riskUsedPct)}%`} />
            <MetricBox label="Signaux en direct" value={`${data.deskSnapshot.liveSignals}`} />
            <MetricBox label="Expériences de recherche" value={`${data.deskSnapshot.researchExperiments}`} />
            <MetricBox label="Fournisseurs sains" value={`${data.deskSnapshot.providersOk}/${data.deskSnapshot.providersTotal}`} />
          </div>
          <div className="jarvis-mission-list">
            {data.missions.map((mission) => (
              <article key={mission.missionId}>
                <span><FaTasks /></span>
                <div title={mission.missionId}><strong>{mission.title}</strong><small>{mission.ownerAgent}</small></div>
                <StatusBadge tone={mission.state === "DONE" ? "success" : mission.state === "NEEDS_OPERATOR" ? "warning" : "accent"}>{operatorCode(mission.state)}</StatusBadge>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Sources, références et fraîcheur" actions={<InlineAction>Sources</InlineAction>} density="compact">
          <div className="jarvis-source-list">
            {data.citations.map((citation) => (
              <Link key={citation.citationId} to={citation.route}>
                <div title={citation.citationId}><strong>{citation.label}</strong><small>Ouvrir la source</small></div>
                <StatusBadge tone={citation.freshness === "fresh" ? "success" : citation.freshness === "degraded" ? "warning" : "danger"}>{operatorCode(citation.freshness)}</StatusBadge>
                <FaExternalLinkAlt />
              </Link>
            ))}
          </div>
        </Card>

        <Card title="Alertes et commandes en cours" actions={<InlineAction>Observabilité</InlineAction>} density="compact">
          <div className="jarvis-alert-list">
            {data.alerts.map((alert, index) => (
              <Link key={`${alert.alertId}:${alert.route}:${index}`} to={alert.route}>
                <FaBell />
                <div title={alert.alertId}><strong>{alert.title}</strong><small>Ouvrir l’alerte</small></div>
                <StatusBadge tone={alert.severity === "HIGH" ? "danger" : alert.severity === "MEDIUM" ? "warning" : "accent"}>{operatorCode(alert.severity)}</StatusBadge>
              </Link>
            ))}
          </div>
          <div className="jarvis-command-list">
            {data.commands.map((item) => (
              <article key={item.commandId}>
                <div title={item.commandId}><strong>{item.title}</strong><small>Commande auditée</small></div>
                <StatusBadge tone={item.status === "SUCCEEDED" ? "success" : item.status === "FAILED" || item.status === "REJECTED" ? "danger" : "accent"}>{operatorCode(item.status)}</StatusBadge>
              </article>
            ))}
          </div>
          <div className="jarvis-authority-note">
            <FaShieldAlt />
            <span>Jarvis propose → action en attente → confirmation dans l’interface → commande auditée. Aucun contournement du risque, de l’exécution ou des permissions.</span>
          </div>
        </Card>
      </section>
    </div>
  );
}

function CitationLink({
  citationId,
  citations
}: {
  citationId: string;
  citations: ReadonlyArray<JarvisWorkspaceView["citations"][number]>;
}) {
  const citation = citations.find((item) => item.citationId === citationId);
  if (!citation) return null;

  return (
    <Link to={citation.route}>
      {citation.label}
    </Link>
  );
}

function JarvisLoading() {
  return (
    <div className="operator-page jarvis-page">
      <h1 className="sr-only">Espace Jarvis</h1>
      <section className="operator-kpi-strip">
        {Array.from({ length: 6 }).map((_, index) => <Card key={index} state="loading" density="compact"><div className="skeleton-line" /></Card>)}
      </section>
    </div>
  );
}

function briefIcon(status: JarvisWorkspaceView["morningBrief"][number]["status"]) {
  if (status === "OK") return <FaCheckCircle />;
  if (status === "HIGH") return <FaBell />;
  return <FaRobot />;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
