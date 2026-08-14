import { useState } from "react";
import { Link } from "react-router-dom";
import {
  FaBrain,
  FaChartLine,
  FaCheckCircle,
  FaClock,
  FaDatabase,
  FaExclamationTriangle,
  FaFlask,
  FaMicrochip,
  FaNetworkWired
} from "react-icons/fa";
import { DataTable, MobileDataList } from "@/design-system/data";
import { DeskButton, TrackedCommandReceipt } from "@/design-system/actions";
import { Card, KpiCard, ProgressBar, StatusBadge } from "@/design-system/primitives";
import { InlineAction, MetricBox, OperatorPageHeader } from "@/design-system/workspace";
import { ViewTruthBanner } from "@/design-system/states";
import { useCapabilityCatalog, useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import type { CommandAccepted } from "@/domains/realtime/commandRuntime";
import type { ResearchLabView } from "@/domains/front-api/viewModels";

type ExperimentRow = ResearchLabView["experiments"][number];
type ResultRow = ResearchLabView["results"][number];

export function ResearchLabPage() {
  const query = useFrontView("research-lab");
  const capabilityCatalog = useCapabilityCatalog();
  const repository = useFrontViewRepository();
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (query.isLoading) {
    return <ResearchLabLoading />;
  }

  if (query.isError) {
    return (
      <Card title="Research Lab indisponible" eyebrow="ERREUR CONTRAT" tone="danger" density="compact">
        <p>{(query.error as Error).message}</p>
      </Card>
    );
  }

  if (!query.data) {
    return (
      <Card title="Aucune donnée recherche" eyebrow="EMPTY" state="empty" density="compact">
        <p>Le BFF ne retourne pas encore la projection `/views/research-lab`.</p>
      </Card>
    );
  }

  const { data, meta } = query.data;
  const bootstrapAction = data.commandActions.find((action) => action.commandType === "research.bootstrap_demo_paper");
  const bootstrapCapability = capabilityCatalog.data?.actions.find((action) => action.commandType === "research.bootstrap_demo_paper");

  const bootstrapDemoPaperResearch = async () => {
    if (!bootstrapAction || bootstrapAction.permission !== "ALLOWED" || bootstrapCapability?.allowed !== true) {
      setCommandError("RESEARCH_BOOTSTRAP_CAPABILITY_UNAVAILABLE");
      return;
    }
    setSubmitting(true);
    setCommandError(null);
    try {
      const accepted = await repository.submitCommand({
        commandType: "research.bootstrap_demo_paper",
        environment: "MOCK",
        expectedVersion: bootstrapAction.actionId,
        reason: "Operator requested one-month autonomous demo-paper research bootstrap.",
        payload: bootstrapAction.payload
      });
      setCommand(accepted);
      void query.refetch();
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : "RESEARCH_BOOTSTRAP_COMMAND_FAILED");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="operator-page research-lab-page">
      <ViewTruthBanner meta={meta} />
      <OperatorPageHeader
        title="Research Lab"
        description="Pipeline autonome : hypothèses, expériences, validation quantitative, knowledge graph et compute."
        actions={
          <>
            <DeskButton variant="primary" disabled={submitting || bootstrapAction?.permission !== "ALLOWED" || bootstrapCapability?.allowed !== true} onClick={bootstrapDemoPaperResearch}>
              {submitting ? "Amorçage..." : bootstrapAction?.label ?? "Commande indisponible"}
            </DeskButton>
            <Link to="/research/data">Explorer les données</Link>
            {data.experiments[0] ? <Link className="operator-primary-action" to={`/research/experiments/${data.experiments[0].experimentId}`}>Ouvrir l’expérience active</Link> : <span>Aucune expérience active</span>}
          </>
        }
      />

      <Card title="Commande Research" eyebrow="ACTION OPÉRATEUR" density="compact">
        <div className="live-command-status">
          <strong>{command ? `Commande ${command.status}` : commandError ? "Commande rejetée" : "Aucune commande envoyée"}</strong>
          <small>{command?.commandId ?? commandError ?? "Amorce Dataset → StrategyVersion → SimulationRun → ResearchCandidate → AgentTask sur un mois de données réelles."}</small>
          <TrackedCommandReceipt command={command} />
        </div>
      </Card>

      <section className="operator-kpi-strip" aria-label="Indicateurs Research Lab">
        <KpiCard
          label="EXPÉRIENCES EN COURS"
          value={`${data.summary.runningExperiments}`}
          delta={`${data.summary.completedExperiments} terminées`}
          tone="info"
        />
        <KpiCard
          label="STRATÉGIES PROMUES"
          value={`${data.summary.promotedStrategies}`}
          delta={`${data.summary.rejectedStrategies} rejetées`}
          tone="success"
        />
        <KpiCard
          label="AGENTS RECHERCHE"
          value={`${data.summary.activeResearchAgents}`}
          delta="Workers IA dédiés, aucun humain assigné"
          tone="info"
        />
        <KpiCard
          label="BUDGET COMPUTE"
          value={formatPercent(data.summary.computeBudgetUsedPct)}
          delta="Quota journalier utilisé"
          detail={<ProgressBar value={data.summary.computeBudgetUsedPct} tone="warning" />}
          tone="warning"
        />
        <KpiCard
          label="BUDGET TOKEN"
          value={formatPercent(data.summary.tokenBudgetUsedPct)}
          delta="Niveau modèle pilotable par agent"
          detail={<ProgressBar value={data.summary.tokenBudgetUsedPct} tone="accent" />}
        />
        <KpiCard
          label="LATENCE PROJECTION"
          value={`${meta.latencyMs ?? 0} ms`}
          delta={`Schéma ${meta.schemaVersion} · ${meta.stale ? "stale" : "fresh"}`}
          tone={meta.stale ? "warning" : "success"}
        />
      </section>

      <section className="operator-grid operator-grid--top" aria-label="Pipeline, expériences et agents">
        <Card title="Pipeline recherche" actions={<InlineAction>Voir la factory</InlineAction>} density="compact">
          <ol className="research-pipeline">
            {data.pipeline.map((stage) => (
              <li key={stage.stageId} className={`research-pipeline__stage research-pipeline__stage--${stage.state.toLowerCase()}`}>
                <span className="research-pipeline__icon">{stageIcon(stage.state)}</span>
                <div>
                  <strong>{stage.label}</strong>
                  <small>{stage.activeExperiments} actifs · {stage.promoted} promus · {stage.rejected} rejetés</small>
                </div>
                <StatusBadge tone={stateTone(stage.state)}>{stage.state}</StatusBadge>
                <ProgressBar value={stage.budgetUsedPct} tone={stage.state === "BLOCKED" ? "danger" : "accent"} />
              </li>
            ))}
          </ol>
        </Card>

        <Card title="Expériences en cours" actions={<InlineAction>Explorer les expériences</InlineAction>} density="compact">
          <DataTable rows={data.experiments} rowKey={(row) => row.experimentId} columns={experimentColumns} />
          <MobileDataList
            rows={data.experiments}
            rowKey={(row) => row.experimentId}
            renderTitle={(row) => row.title}
            renderMeta={(row) => `${row.stage} · ${row.ownerAgent} · ${row.status}`}
            renderBody={(row) => `${row.currentTask} · score ${row.score}`}
          />
        </Card>

        <Card title="Agents IA actifs" actions={<InlineAction>Superviser agents</InlineAction>} density="compact">
          <div className="research-agent-list">
            {data.agents.map((agent) => (
              <Link key={agent.agentId} to="/research/agents" className="research-agent-card">
                <span className={`research-agent-card__status research-agent-card__status--${agent.status.toLowerCase()}`}><FaBrain /></span>
                <div>
                  <strong>{agent.name}</strong>
                  <small>{agent.task}</small>
                </div>
                <span>{agent.queueDepth}</span>
                <StatusBadge tone={agent.status === "ACTIVE" ? "success" : agent.status === "BLOCKED" ? "danger" : "warning"}>
                  {agent.status}
                </StatusBadge>
                <ProgressBar value={agent.tokenBudgetPct} tone={agent.reasoningLevel === "ultra" ? "warning" : "accent"} />
              </Link>
            ))}
          </div>
        </Card>
      </section>

      <section className="operator-grid operator-grid--bottom" aria-label="Coverage, résultats, compute et incidents">
        <Card title="Datasets, features & coverage" actions={<InlineAction>Data Foundation</InlineAction>} density="compact">
          <div className="research-coverage-list">
            {data.coverage.map((coverage) => (
              <article key={coverage.coverageId}>
                <span><FaDatabase /></span>
                <div><strong>{coverage.label}</strong><small>{coverage.detail}</small></div>
                <b>{formatPercent(coverage.coveragePct)}</b>
                <StatusBadge tone={qualityTone(coverage.quality)}>{coverage.quality}</StatusBadge>
                <ProgressBar value={coverage.coveragePct} tone={coverage.quality === "GAP" ? "danger" : coverage.quality === "WATCH" ? "warning" : "success"} />
              </article>
            ))}
          </div>
          <div className="research-dataset-strip">
            {data.datasets.map((dataset) => (
              <Link key={dataset.datasetId} to="/research/data">
                <strong>{dataset.label}</strong>
                <small>{dataset.coverage} · {dataset.pointInTime ? "point-in-time" : "non PIT"}</small>
              </Link>
            ))}
          </div>
        </Card>

        <Card title="Résultats récents & knowledge graph" actions={<InlineAction>Comparer</InlineAction>} density="compact">
          <DataTable rows={data.results} rowKey={(row) => row.resultId} columns={resultColumns} />
          <div className="research-graph-summary">
            <MetricBox label="Lien le plus fort" value={data.knowledgeGraph.strongestLink} />
            <MetricBox label="Novelty score" value={`${data.knowledgeGraph.noveltyScore}/100`} />
          </div>
          <div className="research-cluster-list">
            {data.knowledgeGraph.clusters.map((cluster) => (
              <article key={cluster.clusterId}>
                <FaNetworkWired />
                <div><strong>{cluster.label}</strong><small>{cluster.experiments} expériences · similarité {formatPercent(cluster.similarityPct)}</small></div>
                <StatusBadge tone={cluster.signal === "EDGE" ? "success" : cluster.signal === "DUPLICATE_RISK" ? "warning" : "accent"}>
                  {cluster.signal}
                </StatusBadge>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Compute queue, scheduler & incidents" actions={<InlineAction>Compute Lab</InlineAction>} density="compact">
          <div className="research-compute-list">
            {data.computeQueue.map((job) => (
              <Link key={job.jobId} to="/research/compute">
                <span><FaMicrochip /></span>
                <div><strong>{job.label}</strong><small>{job.worker} · {job.eta} · ${job.costUsd.toFixed(2)}</small></div>
                <StatusBadge tone={job.status === "DONE" ? "success" : job.status === "FAILED" ? "danger" : job.status === "RUNNING" ? "accent" : "warning"}>
                  {job.status}
                </StatusBadge>
                <ProgressBar value={job.progressPct} tone={job.status === "FAILED" ? "danger" : "accent"} />
              </Link>
            ))}
          </div>
          <div className="research-incidents">
            {data.incidents.map((incident) => (
              <article key={incident.incidentId}>
                <FaExclamationTriangle />
                <div><strong>{incident.title}</strong><small>{incident.detail}</small></div>
                <StatusBadge tone={incident.severity === "HIGH" ? "danger" : incident.severity === "MEDIUM" ? "warning" : "accent"}>
                  {incident.severity}
                </StatusBadge>
              </article>
            ))}
          </div>
        </Card>
      </section>
    </div>
  );
}

const experimentColumns = [
  { key: "mission", header: "Mission", render: (row: ExperimentRow) => <MissionCell row={row} /> },
  { key: "agent", header: "Agent", render: (row: ExperimentRow) => row.ownerAgent },
  { key: "stage", header: "Étape", render: (row: ExperimentRow) => <StatusBadge tone={stageTone(row.stage)}>{row.stage}</StatusBadge> },
  { key: "progress", header: "Progression", render: (row: ExperimentRow) => <ProgressWithLabel value={row.progressPct} /> },
  { key: "score", header: "Score", align: "right" as const, render: (row: ExperimentRow) => row.score },
  { key: "eta", header: "ETA", align: "right" as const, render: (row: ExperimentRow) => row.eta },
  { key: "state", header: "État", render: (row: ExperimentRow) => <StatusBadge tone={experimentTone(row.status)}>{row.status}</StatusBadge> }
] as const;

const resultColumns = [
  { key: "strategy", header: "Stratégie", render: (row: ResultRow) => <ResultCell row={row} /> },
  { key: "decision", header: "Décision", render: (row: ResultRow) => <StatusBadge tone={row.decision === "PROMOTED" ? "success" : row.decision === "REJECTED" ? "danger" : "warning"}>{row.decision}</StatusBadge> },
  { key: "oos", header: "OOS R", align: "right" as const, render: (row: ResultRow) => <span className={row.oosR >= 0 ? "text-success" : "text-danger"}>{formatSignedR(row.oosR)}</span> },
  { key: "sharpe", header: "Sharpe", align: "right" as const, render: (row: ResultRow) => row.sharpe.toFixed(2) },
  { key: "robust", header: "Robust.", align: "right" as const, render: (row: ResultRow) => `${row.robustnessScore}` }
] as const;

function MissionCell({ row }: { row: ExperimentRow }) {
  return (
    <Link className="research-table-link" to={`/research/experiments/${row.experimentId}`}>
      <strong>{row.title}</strong>
      <small>{row.missionId}</small>
    </Link>
  );
}

function ResultCell({ row }: { row: ResultRow }) {
  return (
    <Link className="research-table-link" to={`/strategies/${row.strategyId}`}>
      <strong>{row.title}</strong>
      <small>{row.experimentId}</small>
    </Link>
  );
}

function ProgressWithLabel({ value }: { value: number }) {
  return (
    <span className="research-progress-cell">
      <ProgressBar value={value} tone="accent" />
      <small>{formatPercent(value)}</small>
    </span>
  );
}

function ResearchLabLoading() {
  return (
    <div className="operator-page research-lab-page">
      <section className="operator-kpi-strip">
        {Array.from({ length: 6 }).map((_, index) => <Card key={index} state="loading" density="compact"><div className="skeleton-line" /></Card>)}
      </section>
    </div>
  );
}

function stageIcon(state: ResearchLabView["pipeline"][number]["state"]) {
  if (state === "DONE") return <FaCheckCircle />;
  if (state === "RUNNING") return <FaClock />;
  if (state === "BLOCKED") return <FaExclamationTriangle />;
  return <FaFlask />;
}

function stateTone(state: ResearchLabView["pipeline"][number]["state"]) {
  if (state === "DONE") return "success" as const;
  if (state === "RUNNING") return "accent" as const;
  if (state === "BLOCKED") return "danger" as const;
  return "warning" as const;
}

function stageTone(stage: ExperimentRow["stage"]) {
  if (stage === "PAPER_READY") return "success" as const;
  if (stage === "OOS" || stage === "ROBUSTNESS") return "warning" as const;
  return "accent" as const;
}

function experimentTone(status: ExperimentRow["status"]) {
  if (status === "PROMOTED" || status === "PASSED") return "success" as const;
  if (status === "FAILED" || status === "REJECTED") return "danger" as const;
  if (status === "WAITING") return "warning" as const;
  return "accent" as const;
}

function qualityTone(quality: ResearchLabView["coverage"][number]["quality"]) {
  if (quality === "OK") return "success" as const;
  if (quality === "GAP") return "danger" as const;
  return "warning" as const;
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

function formatSignedR(value: number) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1).replace(".", ",")} R`;
}
