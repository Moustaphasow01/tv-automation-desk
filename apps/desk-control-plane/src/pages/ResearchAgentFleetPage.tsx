import { useState } from "react";
import { Link } from "react-router-dom";
import {
  FaBolt,
  FaBrain,
  FaClock,
  FaComments,
  FaExclamationTriangle,
  FaFingerprint,
  FaLock,
  FaPause,
  FaPlay,
  FaRedo,
  FaRoute,
  FaSignal
} from "react-icons/fa";
import { DeskButton } from "@/design-system/actions";
import { Card, KpiCard, ProgressBar, StatusBadge } from "@/design-system/primitives";
import { InlineAction, MetricBox, OperatorPageHeader } from "@/design-system/workspace";
import { ViewTruthBanner } from "@/design-system/states";
import { presentPermission } from "@/design-system/labels";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { ResearchAgentFleetView } from "@/domains/front-api/viewModels";
import type { CommandAccepted } from "@/domains/realtime/commandRuntime";

type AgentAction = ResearchAgentFleetView["commandActions"][number];
type AgentRow = ResearchAgentFleetView["agents"][number];
type QueueRow = ResearchAgentFleetView["queue"][number];

export function ResearchAgentFleetPage() {
  const query = useFrontView("research-agent-fleet");
  const repository = useFrontViewRepository();
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);

  if (query.isLoading) {
    return <ResearchAgentFleetLoading />;
  }

  if (query.isError) {
    return (
      <Card title="Agent Fleet indisponible" eyebrow="ERREUR CONTRAT" tone="danger" density="compact">
        <p>{(query.error as Error).message}</p>
      </Card>
    );
  }

  if (!query.data) {
    return (
      <Card title="Aucune projection agents" eyebrow="EMPTY" state="empty" density="compact">
        <p>Le BFF ne retourne pas encore la projection `/views/research-agent-fleet`.</p>
      </Card>
    );
  }

  const { data, meta } = query.data;

  const confirmAction = async (action: AgentAction) => {
    setSubmittingActionId(action.actionId);
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand({
        commandType: action.commandType,
        environment: "MOCK",
        expectedVersion: action.actionId,
        reason: `Research agent action confirmed: ${action.label}`,
        payload: action.payload
      });
      setCommand(accepted);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "RESEARCH_AGENT_COMMAND_FAILED");
    } finally {
      setSubmittingActionId(null);
    }
  };

  return (
    <div className="operator-page research-agent-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader
        title="Flotte d'agents IA"
        description={`Supervision IA Research uniquement · leases, conversations, files et budgets · projection ${meta.latencyMs} ms.`}
        actions={
          <>
            <Link to="/research">Research Lab</Link>
            <Link className="operator-primary-action" to="/operations">Opérations</Link>
          </>
        }
      />

      <section className="operator-kpi-strip" aria-label="Indicateurs flotte agents research">
        <KpiCard label="AGENTS IA" value={`${data.summary.totalAgents}`} delta={`${data.summary.activeAgents} actifs`} tone="info" />
        <KpiCard label="EN ATTENTE" value={`${data.summary.waitingAgents}`} delta="attente événement" tone={data.summary.waitingAgents > 0 ? "warning" : "success"} />
        <KpiCard label="LEASES" value={`${data.summary.lockedLeases}`} delta="locks protégés" tone="success" />
        <KpiCard label="FILE" value={`${data.summary.queueDepth}`} delta="items recherche" tone="accent" />
        <KpiCard label="SUCCÈS" value={`${data.summary.avgSuccessRatePct}%`} delta="moyenne rolling" tone="success" />
        <KpiCard label="SOURCE" value="BFF" delta="aucun moteur déterministe ici" tone="neutral" />
      </section>

      <section className="operator-grid operator-grid--top" aria-label="Agents, files et conversations">
        <Card title="Roster agents IA" actions={<InlineAction>Zoom agent</InlineAction>} density="compact">
          <div className="research-agent-roster">
            {data.agents.map((agent) => {
              const runtimeStatus = agentRuntimeStatus(agent.runtimeStatus);
              return (
                <article key={agent.agentId} className={`research-agent-fleet-card research-agent-fleet-card--${runtimeStatus.toLowerCase()}`}>
                  <div className="research-agent-fleet-card__head">
                    <FaBrain />
                    <div>
                      <strong>{agent.name}</strong>
                      <small>{agent.type} · {agent.model} · {agent.reasoningLevel}</small>
                    </div>
                    <StatusBadge tone={agentTone(runtimeStatus)}>{runtimeStatus}</StatusBadge>
                  </div>
                  <p>{agent.role}</p>
                  <div className="research-agent-fleet-card__task">
                    <FaRoute />
                    <span>{agent.currentTask}</span>
                  </div>
                  <div className="research-agent-fleet-budget-grid">
                    <BudgetLine label="Tokens" value={agent.tokenBudgetPct} tone="accent" />
                    <BudgetLine label="Compute" value={agent.computeBudgetPct} tone="info" />
                    <BudgetLine label="Succès" value={agent.successRatePct} tone="success" />
                  </div>
                </article>
              );
            })}
          </div>
        </Card>

        <Card title="Mission file & attentes" actions={<InlineAction>File</InlineAction>} density="compact">
          <div className="research-agent-queue">
            {data.queue.map((item) => (
              <QueueItem key={item.queueItemId} item={item} agent={agentById(data.agents, item.agentId)} />
            ))}
          </div>
        </Card>

        <Card title="Conversations & leases" actions={<InlineAction>Threads</InlineAction>} density="compact">
          <div className="research-agent-lease-list">
            {data.agents.map((agent) => {
              const conversation = data.conversations.find((item) => item.agentId === agent.agentId);
              return (
                <article key={agent.agentId}>
                  <FaComments />
                  <div>
                    <strong>{compactId(conversation?.conversationId ?? agent.conversationId)}</strong>
                    <small>{conversation?.retainedContext ?? "Contexte non retourné"}</small>
                    <span>{agent.leaseId} · {formatTime(agent.heartbeatAt)}</span>
                  </div>
                  <StatusBadge tone={lockTone(agent.lockState)}>{agent.lockState}</StatusBadge>
                </article>
              );
            })}
          </div>
        </Card>
      </section>

      <section className="operator-grid operator-grid--bottom" aria-label="Budgets, incidents et commandes">
        <Card title="Budgets & santé IA" actions={<InlineAction>Budgets</InlineAction>} density="compact">
          <div className="research-agent-health-grid">
            {data.agents.map((agent) => (
              <article key={agent.agentId}>
                <div>
                  <strong>{agent.name}</strong>
                  <small>{agent.queueDepth} items · {agent.retryCount} retries</small>
                </div>
                <ProgressBar value={agent.tokenBudgetPct} label={`${agent.name} token budget`} tone={agent.tokenBudgetPct > 70 ? "warning" : "accent"} />
                <ProgressBar value={agent.computeBudgetPct} label={`${agent.name} compute budget`} tone={agent.computeBudgetPct > 75 ? "warning" : "info"} />
              </article>
            ))}
          </div>
        </Card>

        <Card title="Incidents & retries" actions={<InlineAction>Audit</InlineAction>} density="compact">
          <div className="research-agent-incidents">
            {data.incidents.map((incident) => {
              const agent = agentById(data.agents, incident.agentId);
              return (
                <article key={incident.incidentId}>
                  <FaExclamationTriangle />
                  <div>
                    <strong>{incident.title}</strong>
                    <small>{agent?.name ?? incident.agentId} · {incident.retryable ? "retryable" : "non retryable"}</small>
                  </div>
                  <StatusBadge tone={severityTone(incident.severity)}>{incident.severity}</StatusBadge>
                </article>
              );
            })}
            <article className="research-agent-proof">
              <FaLock />
              <div>
                <strong>Front anti-confusion</strong>
                <small>Cette vue liste uniquement les workers IA Research ; Risk, Execution et Portfolio restent des moteurs déterministes séparés.</small>
              </div>
            </article>
          </div>
        </Card>

        <Card title="Actions agent" actions={<InlineAction>Flux de commande</InlineAction>} density="compact">
          <div className="research-agent-actions">
            {data.commandActions.map((action) => {
              const agent = agentById(data.agents, action.agentId);
              return (
                <article key={action.actionId}>
                  <span>{actionIcon(action.commandType)}</span>
                  <div>
                    <strong>{action.label}</strong>
                    <small>{agent?.name ?? action.agentId} · {action.commandType}</small>
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
              );
            })}
          </div>
          <div className="research-agent-command-result">
            <FaFingerprint />
            <div>
              <strong>{command ? `Commande ${command.status}` : commandError ? "Commande rejetée" : "Aucune commande envoyée"}</strong>
              <small>{command?.commandId ?? commandError ?? "Le BFF renverra un accusé async traçable."}</small>
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}

function ResearchAgentFleetLoading() {
  return (
    <div className="operator-page research-agent-page">
      <OperatorPageHeader title="Flotte d'agents IA" description="Chargement de la projection agents research." />
      <section className="operator-kpi-strip">
        {Array.from({ length: 6 }).map((_, index) => (
          <KpiCard key={index} label="LOADING" value="—" state="loading" />
        ))}
      </section>
    </div>
  );
}

function BudgetLine({ label, value, tone }: { label: string; value: number; tone: "accent" | "info" | "success" | "warning" }) {
  return (
    <span>
      <small>{label}</small>
      <ProgressBar value={value} label={label} tone={tone} />
      <b>{value}%</b>
    </span>
  );
}

function QueueItem({ item, agent }: { item: QueueRow; agent?: AgentRow }) {
  return (
    <article>
      <FaClock />
      <div>
        <strong>{item.expectedEvent}</strong>
        <small>{agent?.name ?? item.agentId} · {compactId(item.missionId)}</small>
      </div>
      <span>{item.eta}</span>
      <StatusBadge tone={queueTone(item.state)}>{item.state}</StatusBadge>
    </article>
  );
}

function agentById(agents: readonly AgentRow[], agentId: string) {
  return agents.find((agent) => agent.agentId === agentId);
}

function actionIcon(commandType: string) {
  if (commandType.includes("wake")) return <FaPlay />;
  if (commandType.includes("pause")) return <FaPause />;
  if (commandType.includes("retry")) return <FaRedo />;
  return <FaBolt />;
}

function agentRuntimeStatus(status: AgentRow["runtimeStatus"] | undefined) {
  return status ?? "UNKNOWN";
}

function agentTone(status: AgentRow["runtimeStatus"] | "UNKNOWN") {
  if (status === "ACTIVE") return "success";
  if (status === "WAITING") return "warning";
  if (status === "FAILED") return "danger";
  return "neutral";
}

function queueTone(status: QueueRow["state"]) {
  if (status === "RUNNING") return "success";
  if (status === "READY") return "accent";
  if (status === "RETRY") return "warning";
  return "neutral";
}

function lockTone(state: AgentRow["lockState"]) {
  if (state === "LOCKED") return "success";
  if (state === "STALE") return "danger";
  return "neutral";
}

function severityTone(severity: ResearchAgentFleetView["incidents"][number]["severity"]) {
  if (severity === "HIGH") return "danger";
  if (severity === "MEDIUM") return "warning";
  return "info";
}

function permissionTone(permission: AgentAction["permission"]) {
  if (permission === "ALLOWED") return "success";
  if (permission === "STEP_UP_REQUIRED") return "warning";
  return "danger";
}

function permissionLabel(permission: AgentAction["permission"]) {
  return presentPermission(permission).label;
}

function formatTime(value?: string) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}

function compactId(value?: string) {
  if (!value) {
    return "—";
  }
  if (value.length <= 26) {
    return value;
  }
  return `${value.slice(0, 12)}…${value.slice(-8)}`;
}
