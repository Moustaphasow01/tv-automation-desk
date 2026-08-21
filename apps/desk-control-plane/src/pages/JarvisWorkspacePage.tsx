import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
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
      <Card title="Jarvis indisponible" eyebrow="ERREUR CONTRAT" tone="danger" density="compact">
        <p>{(query.error as Error).message}</p>
      </Card>
    );
  }

  if (!query.data) {
    return (
      <Card title="Aucune donnée Jarvis" eyebrow="EMPTY" state="empty" density="compact">
        <p>Le BFF ne retourne pas encore la projection `/views/jarvis-workspace`.</p>
      </Card>
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
        description="Assistant opérateur : brief, citations, conversation et actions contrôlées via Command Runtime."
        actions={
          <>
            <span title="Création de brief non exposée par le backend">Nouveau brief indisponible</span>
            <span title="Commande vocale non exposée par le backend">Push-to-talk indisponible</span>
            <Link className="operator-primary-action" to="/command-center">Retour Centre de contrôle</Link>
          </>
        }
      />

      <section className="operator-kpi-strip" aria-label="Indicateurs Jarvis">
        <KpiCard label="BRIEF MATINAL" value={data.summary.morningBriefStatus} delta={`${data.morningBrief.length} sections`} tone="success" />
        <KpiCard label="SUGGESTIONS" value={`${data.summary.openSuggestions}`} delta="Propositions contextuelles" tone="info" />
        <KpiCard label="ACTIONS EN ATTENTE" value={`${data.summary.pendingActions}`} delta="Confirmation opérateur requise" tone="warning" />
        <KpiCard label="AGENTS IA ACTIFS" value={`${data.summary.activeAgents}`} delta={`${data.missions.length} missions visibles`} tone="info" />
        <KpiCard label="SERVICE VOCAL" value={data.summary.voiceStatus} delta={data.voice.degradationReason ?? "Push-to-talk prêt"} tone={data.summary.voiceStatus === "READY" ? "success" : "warning"} />
        <KpiCard label="FRAÎCHEUR" value={`${data.summary.freshnessSeconds}s`} delta={`Projection ${meta.latencyMs} ms`} tone="success" />
      </section>

      <section className="operator-grid operator-grid--top" aria-label="Brief, conversation et actions Jarvis">
        <Card title="Brief matinal structuré" actions={<InlineAction>Brief complet</InlineAction>} density="compact">
          <div className="jarvis-brief-list">
            {data.morningBrief.map((section) => (
              <article key={section.sectionId}>
                <span>{briefIcon(section.status)}</span>
                <div><strong>{section.domain} · {section.headline}</strong><small>{section.detail}</small></div>
                <StatusBadge tone={section.status === "OK" ? "success" : section.status === "HIGH" ? "danger" : "warning"}>{section.status}</StatusBadge>
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

        <Card title="Conversation & réponses citées" actions={<InlineAction>Historique</InlineAction>} density="compact">
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
                placeholder="Pose une question read-only : état research, signal, risk, provider, data…"
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

        <Card title="Pending actions & voice" actions={<InlineAction>Commandes</InlineAction>} density="compact">
          <div className="jarvis-action-list">
            {data.pendingActions.map((action) => (
              <article key={action.actionId}>
                <div><strong>{action.title}</strong><small>{action.impact}</small></div>
                <StatusBadge tone={action.permission === "ALLOWED" ? "success" : action.permission === "STEP_UP_REQUIRED" ? "warning" : "danger"}>
                  {action.permission}
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
              <strong>Voix · {data.voice.serviceStatus}</strong>
              <small>{data.voice.degradationReason ?? data.voice.lastTranscript ?? "Push-to-talk accessible"}</small>
            </div>
          </div>
          <div className="jarvis-command-result">
            <small>Résultat commande</small>
            <strong>{command ? `Acceptée · ${command.commandId}` : "Aucune commande Jarvis confirmée"}</strong>
            {commandError ? <span className="text-danger">{commandError}</span> : null}
          </div>
        </Card>
      </section>

      <section className="operator-grid operator-grid--bottom" aria-label="Snapshot, sources et alertes Jarvis">
        <Card title="Desk Snapshot & missions IA" actions={<InlineAction>Agents IA</InlineAction>} density="compact">
          <div className="jarvis-snapshot-grid">
            <MetricBox label="Risque utilisé" value={`${Math.round(data.deskSnapshot.riskUsedPct)}%`} />
            <MetricBox label="Signaux live" value={`${data.deskSnapshot.liveSignals}`} />
            <MetricBox label="Exp. research" value={`${data.deskSnapshot.researchExperiments}`} />
            <MetricBox label="Providers OK" value={`${data.deskSnapshot.providersOk}/${data.deskSnapshot.providersTotal}`} />
          </div>
          <div className="jarvis-mission-list">
            {data.missions.map((mission) => (
              <article key={mission.missionId}>
                <span><FaTasks /></span>
                <div><strong>{mission.title}</strong><small>{mission.ownerAgent} · {mission.missionId}</small></div>
                <StatusBadge tone={mission.state === "DONE" ? "success" : mission.state === "NEEDS_OPERATOR" ? "warning" : "accent"}>{mission.state}</StatusBadge>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Sources, citations & freshness" actions={<InlineAction>Sources</InlineAction>} density="compact">
          <div className="jarvis-source-list">
            {data.citations.map((citation) => (
              <Link key={citation.citationId} to={citation.route}>
                <div><strong>{citation.label}</strong><small>{citation.citationId}</small></div>
                <StatusBadge tone={citation.freshness === "fresh" ? "success" : citation.freshness === "degraded" ? "warning" : "danger"}>{citation.freshness}</StatusBadge>
                <FaExternalLinkAlt />
              </Link>
            ))}
          </div>
        </Card>

        <Card title="Alertes & commandes en cours" actions={<InlineAction>Observabilité</InlineAction>} density="compact">
          <div className="jarvis-alert-list">
            {data.alerts.map((alert) => (
              <Link key={alert.alertId} to={alert.route}>
                <FaBell />
                <div><strong>{alert.title}</strong><small>{alert.alertId}</small></div>
                <StatusBadge tone={alert.severity === "HIGH" ? "danger" : alert.severity === "MEDIUM" ? "warning" : "accent"}>{alert.severity}</StatusBadge>
              </Link>
            ))}
          </div>
          <div className="jarvis-command-list">
            {data.commands.map((item) => (
              <article key={item.commandId}>
                <div><strong>{item.title}</strong><small>{item.commandId}</small></div>
                <StatusBadge tone={item.status === "SUCCEEDED" ? "success" : item.status === "FAILED" || item.status === "REJECTED" ? "danger" : "accent"}>{item.status}</StatusBadge>
              </article>
            ))}
          </div>
          <div className="jarvis-authority-note">
            <FaShieldAlt />
            <span>Jarvis propose → Action en attente → confirmation interface → Flux de commande. Aucun contournement Risque/Exécution/PermissionGate.</span>
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
