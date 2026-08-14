import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  FaArchive,
  FaBook,
  FaBrain,
  FaDatabase,
  FaFingerprint,
  FaFlask,
  FaHistory,
  FaMicrochip,
  FaProjectDiagram,
  FaRobot,
  FaRoute,
  FaShieldAlt,
  FaStream
} from "react-icons/fa";
import { DeskButton } from "@/design-system/actions";
import { Card, KpiCard, ProgressBar, StatusBadge } from "@/design-system/primitives";
import { InlineAction, MetricBox, OperatorPageHeader } from "@/design-system/workspace";
import { ViewTruthBanner } from "@/design-system/states";
import { useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { CommandAccepted } from "@/domains/realtime/commandRuntime";
import type { ResearchExperimentDetailView } from "@/domains/front-api/viewModels";

type ExperimentAction = ResearchExperimentDetailView["commandActions"][number];
type SegmentVerdict = ResearchExperimentDetailView["segmentedMetrics"][number]["verdict"];

export function ResearchExperimentDetailPage() {
  const { experimentId } = useParams();
  const query = useFrontView("research-experiment-detail", { experimentId });
  const repository = useFrontViewRepository();
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submittingActionId, setSubmittingActionId] = useState<string | null>(null);

  if (query.isLoading) {
    return <ResearchExperimentLoading />;
  }

  if (query.isError) {
    return (
      <Card title="Détail expérience indisponible" eyebrow="ERREUR CONTRAT" tone="danger" density="compact">
        <p>{(query.error as Error).message}</p>
      </Card>
    );
  }

  if (!query.data) {
    return (
      <Card title="Aucune expérience" eyebrow="EMPTY" state="empty" density="compact">
        <p>Le BFF ne retourne pas encore la projection `/views/research-experiment-detail`.</p>
      </Card>
    );
  }

  const { data, meta } = query.data;
  const requestedExperimentId = experimentId ?? data.experiment.experimentId;
  const idMismatch = requestedExperimentId !== data.experiment.experimentId;

  const confirmAction = async (action: ExperimentAction) => {
    setSubmittingActionId(action.actionId);
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand({
        commandType: action.commandType,
        environment: "MOCK",
        expectedVersion: action.actionId,
        reason: `Research experiment action confirmed: ${action.label}`,
        payload: action.payload
      });
      setCommand(accepted);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "RESEARCH_EXPERIMENT_COMMAND_FAILED");
    } finally {
      setSubmittingActionId(null);
    }
  };

  return (
    <div className="operator-page research-experiment-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader
        title="Experiment Dossier"
        description={`${data.experiment.title} · ${data.experiment.stage} · ${data.experiment.currentTask} · projection ${meta.latencyMs} ms.`}
        actions={
          <>
            <span title="Comparaison non exposée par le backend">Comparaison indisponible</span>
            <Link className="operator-primary-action" to="/research">Retour Research</Link>
          </>
        }
      />

      <section className="operator-kpi-strip" aria-label="Indicateurs détail expérience">
        <KpiCard label="SCORE" value={`${data.experiment.score}`} delta={`${data.experiment.status} · ${data.experiment.stage}`} tone={data.experiment.score >= 70 ? "success" : "warning"} />
        <KpiCard label="PROGRESSION" value={`${data.experiment.progressPct}%`} delta={data.experiment.expectedEvent} detail={<ProgressBar value={data.experiment.progressPct} tone="accent" />} tone="info" />
        <KpiCard label="TOKEN BUDGET" value={`${data.ownership.tokenBudgetPct}%`} delta={data.ownership.ownerAgentName} tone="warning" />
        <KpiCard label="COMPUTE" value={`${data.ownership.computeBudgetPct}%`} delta={data.ownership.leaseId} tone="warning" />
        <KpiCard label="DATASETS" value={`${data.datasets.length}`} delta={`${data.datasets.filter((dataset) => dataset.pointInTime).length} point-in-time`} tone="success" />
        <KpiCard label="SEGMENTS" value={`${data.segmentedMetrics.length}`} delta={`${data.segmentedMetrics.filter((segment) => segment.verdict === "PASS").length} pass`} tone="info" />
      </section>

      <section className="operator-grid operator-grid--top" aria-label="Hypothèse, stratégie et données">
        <Card title="Hypothèse & mission IA" actions={<InlineAction>Dossier</InlineAction>} density="compact" tone={idMismatch ? "warning" : "neutral"}>
          <div className="research-experiment-brief">
            {idMismatch ? (
              <article className="research-experiment-warning">
                <FaShieldAlt />
                <div><strong>ID demandé différent du mock actif</strong><small>{requestedExperimentId} → {data.experiment.experimentId}</small></div>
              </article>
            ) : null}
            <article>
              <FaFlask />
              <div>
                <strong>{data.experiment.hypothesis}</strong>
                <small>{data.experiment.family} · prochaine transition {data.experiment.nextAutomaticTransition}</small>
              </div>
            </article>
            <div className="research-experiment-owner">
              <MetricBox label="Mission" value={compactId(data.experiment.missionId)} />
              <MetricBox label="Agent" value={data.ownership.ownerAgentName} />
              <MetricBox label="Conversation" value={compactId(data.ownership.conversationId)} />
              <MetricBox label="Heartbeat" value={formatTime(data.ownership.heartbeatAt)} />
            </div>
          </div>
        </Card>

        <Card title="Strategy Spec & versions" actions={<InlineAction>Spec</InlineAction>} density="compact">
          <div className="research-spec-card">
            <article>
              <FaProjectDiagram />
              <div>
                <strong>{data.strategySpec.strategyId} · {data.strategySpec.instrument}</strong>
                <small>{data.strategySpec.strategyVersionId} · {data.strategySpec.timeframe}</small>
              </div>
              <StatusBadge tone="info">{data.strategySpec.specId.replace("spec_", "")}</StatusBadge>
            </article>
            <div className="research-spec-models">
              <MetricBox label="Entrée" value={data.strategySpec.entryModel} />
              <MetricBox label="Risque" value={data.strategySpec.riskModel} />
            </div>
            <div className="research-invariant-list">
              {data.strategySpec.invariants.map((invariant) => <span key={invariant}>{invariant}</span>)}
            </div>
            <div className="research-version-list">
              {data.versions.map((version) => (
                <article key={version.versionId}>
                  <div><strong>{version.label}</strong><small>{version.change}</small></div>
                  <StatusBadge tone={version.status === "ACTIVE" ? "success" : version.status === "CANDIDATE" ? "warning" : "info"}>{version.status}</StatusBadge>
                </article>
              ))}
            </div>
          </div>
        </Card>

        <Card title="Datasets & lineage" actions={<InlineAction>Data Catalog</InlineAction>} density="compact">
          <div className="research-dataset-list">
            {data.datasets.map((dataset) => (
              <Link key={dataset.datasetId} to="/research/data">
                <FaDatabase />
                <div>
                  <strong>{dataset.label}</strong>
                  <small>{dataset.datasetId} · {dataset.hash} · {dataset.coverage}</small>
                </div>
                <StatusBadge tone={dataset.quality === "OK" ? "success" : dataset.quality === "WATCH" ? "warning" : "danger"}>{dataset.quality}</StatusBadge>
              </Link>
            ))}
          </div>
        </Card>
      </section>

      <section className="operator-grid operator-grid--bottom" aria-label="Résultats, journal et actions">
        <Card title="Iterations & métriques segmentées" actions={<InlineAction>Run</InlineAction>} density="compact">
          <div className="research-iteration-list">
            {data.iterations.map((iteration) => (
              <article key={iteration.iterationId}>
                <FaHistory />
                <div><strong>{iteration.stage} · {formatSignedR(iteration.metricR)}</strong><small>{iteration.note}</small></div>
                <span>{formatTime(iteration.at)}</span>
                <StatusBadge tone={verdictTone(iteration.result)}>{iteration.result}</StatusBadge>
              </article>
            ))}
          </div>
          <div className="research-segment-grid">
            {data.segmentedMetrics.map((segment) => (
              <article key={segment.segmentId}>
                <strong>{segment.label}</strong>
                <small>{segment.trades} trades · Sharpe {segment.sharpe.toFixed(2)} · DD {formatSignedR(segment.maxDrawdownR)}</small>
                <b className={segment.pnlR >= 0 ? "text-success" : "text-danger"}>{formatSignedR(segment.pnlR)}</b>
                <StatusBadge tone={verdictTone(segment.verdict)}>{segment.verdict}</StatusBadge>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Journal agent & connaissances" actions={<InlineAction>Knowledge</InlineAction>} density="compact">
          <div className="research-agent-journal">
            {data.agentJournal.map((entry) => (
              <article key={entry.journalId}>
                <StatusBadge tone={entry.level === "ERROR" ? "danger" : entry.level === "WARN" ? "warning" : "success"}>{entry.level}</StatusBadge>
                <div><strong>{formatTime(entry.at)}</strong><small>{entry.message}</small></div>
              </article>
            ))}
          </div>
          <div className="research-knowledge-list">
            {data.knowledgeCreated.map((knowledge) => (
              <Link key={knowledge.knowledgeId} to={knowledge.route}>
                <FaBook />
                <div><strong>{knowledge.title}</strong><small>{knowledge.kind} · confiance {knowledge.confidencePct}%</small></div>
                <StatusBadge tone={knowledge.kind === "ANTI_PATTERN" ? "warning" : "success"}>{knowledge.kind === "ANTI_PATTERN" ? "ANTI" : knowledge.kind}</StatusBadge>
              </Link>
            ))}
          </div>
        </Card>

        <Card title="Actions automatiques" actions={<InlineAction>Command Runtime</InlineAction>} density="compact">
          <div className="research-experiment-actions">
            {data.commandActions.map((action) => (
              <article key={action.actionId}>
                <span>{action.commandType.includes("archive") ? <FaArchive /> : action.commandType.includes("candidate") ? <FaBrain /> : <FaMicrochip />}</span>
                <div><strong>{action.label}</strong><small>{action.commandType} · {action.requiresConfirmation ? "confirm" : "instant"}</small></div>
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
          <div className="research-experiment-command-result">
            <FaFingerprint />
            <div>
              <small>Dernière commande expérience</small>
              <strong>{command ? `ACCEPTED · ${command.commandId}` : "Aucune commande confirmée"}</strong>
              {commandError ? <span className="text-danger">{commandError}</span> : null}
            </div>
          </div>
          <div className="research-experiment-proof">
            <FaStream />
            <span>Aucun workflow humain assigné : la transition attendue reste pilotée par événement et mission IA.</span>
          </div>
        </Card>
      </section>
    </div>
  );
}

function ResearchExperimentLoading() {
  return (
    <div className="operator-page research-experiment-page">
      <section className="operator-kpi-strip">
        {Array.from({ length: 6 }).map((_, index) => <Card key={index} state="loading" density="compact"><div className="skeleton-line" /></Card>)}
      </section>
    </div>
  );
}

function verdictTone(verdict: SegmentVerdict | "PASS" | "WATCH" | "FAIL") {
  if (verdict === "PASS") return "success";
  if (verdict === "FAIL") return "danger";
  return "warning";
}

function permissionTone(permission: ExperimentAction["permission"]) {
  if (permission === "ALLOWED") return "success";
  if (permission === "STEP_UP_REQUIRED") return "warning";
  return "danger";
}

function permissionLabel(permission: ExperimentAction["permission"]) {
  return permission === "STEP_UP_REQUIRED" ? "STEP-UP" : permission;
}

function compactId(value: string) {
  return value
    .replace("mission_research_", "mission:")
    .replace("exp_", "exp:")
    .replace("run_research_", "run:")
    .replace("codex-thread-", "thread:")
    .replace("agent_", "agent:");
}

function formatSignedR(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)} R`;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
