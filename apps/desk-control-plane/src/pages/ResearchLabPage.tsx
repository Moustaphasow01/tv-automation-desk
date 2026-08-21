import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  FaDatabase,
  FaExclamationTriangle,
  FaMicrochip,
  FaNetworkWired
} from "react-icons/fa";
import { DataTable } from "@/design-system/data";
import { DeskButton, TrackedCommandReceipt } from "@/design-system/actions";
import { Card, KpiCard, ProgressBar, StatusBadge } from "@/design-system/primitives";
import { presentResearchDecision } from "@/design-system/labels";
import { InlineAction, MetricBox, OperatorPageHeader } from "@/design-system/workspace";
import { useCapabilityCatalog, useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import { useOperatorSession } from "@/domains/permissions/PermissionGate";
import { OperatorMenu } from "@/shell/OperatorMenu";
import type { CommandAccepted } from "@/domains/realtime/commandRuntime";
import type { ResearchLabView } from "@/domains/front-api/viewModels";
import "@/features/research-lab/research-lab.css";

type ExperimentRow = ResearchLabView["experiments"][number];
type ResultRow = ResearchLabView["results"][number];
type AgentRow = ResearchLabView["agents"][number];

export function ResearchLabPage() {
  const { session } = useOperatorSession();
  const query = useFrontView("research-lab");
  const capabilityCatalog = useCapabilityCatalog();
  const repository = useFrontViewRepository();
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);

  const data = query.data?.data ?? null;
  const selectedExperiment = useMemo(
    () => (data ? data.experiments.find((item) => item.experimentId === selectedMissionId) ?? data.experiments[0] ?? null : null),
    [data, selectedMissionId]
  );
  const topCandidates = useMemo(
    () => (data ? [...data.results].sort((a, b) => b.compositeScore - a.compositeScore).slice(0, 10) : []),
    [data]
  );

  if (query.isLoading) return <ResearchLabLoading />;

  if (query.isError) {
    return (
      <Card title="Laboratoire de recherche indisponible" eyebrow="ERREUR CONTRAT" tone="danger" density="compact">
        <p>{(query.error as Error).message}</p>
      </Card>
    );
  }

  if (!query.data || !data) {
    return (
      <Card title="Aucune donnée recherche" eyebrow="EMPTY" state="empty" density="compact">
        <p>Le BFF ne retourne pas encore la projection `/views/research-lab`.</p>
      </Card>
    );
  }

  const { meta } = query.data;
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
    <div className="rl-page" data-testid="research-lab-golden-master">
      <header className="rl-header">
        <div className="rl-header__title">
          <h1>Research Lab</h1>
          <p>Pipeline autonome : hypothèses, expériences, validation quantitative, compute</p>
        </div>
        <div className="rl-header__divider" aria-hidden="true" />
        <DeskButton variant="primary" disabled={submitting || bootstrapAction?.permission !== "ALLOWED" || bootstrapCapability?.allowed !== true} onClick={bootstrapDemoPaperResearch}>
          {submitting ? "Amorçage..." : bootstrapAction?.label ?? "Commande indisponible"}
        </DeskButton>
        <Link to="/research/data">Explorer les données</Link>
        <OperatorMenu variant="command-center" displayName={session?.principal.displayName ?? "Session non authentifiée"} roleLabel={session?.principal.roles[0] ?? "Lecture seule"} />
      </header>

      <div className="rl-workspace">
        {(command || commandError) && (
          <Card title="Commande Research" eyebrow="ACTION OPÉRATEUR" density="compact">
            <div className="live-command-status">
              <strong>{command ? `Commande ${command.status}` : "Commande rejetée"}</strong>
              <small>{command?.commandId ?? commandError}</small>
              <TrackedCommandReceipt command={command} />
            </div>
          </Card>
        )}

        <section className="rl-kpi-strip" aria-label="Indicateurs Laboratoire de recherche">
          <article><small>Expériences en cours</small><strong>{data.summary.runningExperiments}</strong></article>
          <article><small>Terminées</small><strong>{data.summary.completedExperiments}</strong></article>
          <article><small>Stratégies promues</small><strong>{data.summary.promotedStrategies}</strong></article>
          <article><small>Rejetées</small><strong>{data.summary.rejectedStrategies}</strong></article>
          <article><small>Agents recherche</small><strong>{data.summary.activeResearchAgents}</strong></article>
          <article><small>Budget compute</small><strong>{formatPercent(data.summary.computeBudgetUsedPct)}</strong></article>
          <article><small>Latence projection</small><strong>{meta.latencyMs ?? 0} ms</strong></article>
        </section>

        <section className="rl-panel" aria-label="Pipeline de recherche">
          <header><h2>Pipeline de recherche</h2><small>Hypothèse → Paper Ready</small></header>
          <div className="rl-panel__body">
            <div className="rl-pipeline-track">
              {data.pipeline.map((stage) => (
                <div key={stage.stageId} className="rl-pipeline-stage">
                  <StatusBadge tone={stateTone(stage.state)}>{stage.state}</StatusBadge>
                  <strong>{stage.label.replace("_", " ")}</strong>
                  <small>{stage.activeExperiments} actifs · {stage.promoted} promus · {stage.rejected} rejetés</small>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="rl-grid">
          <div className="rl-column">
            <section className="rl-panel" aria-label="File de missions recherche">
              <header><h2>File de missions recherche</h2><small>{data.experiments.length}</small></header>
              <div className="rl-panel__body" style={{ padding: 0 }}>
                <div className="rl-table-scroll">
                  <table className="rl-table">
                    <thead>
                      <tr><th>Mission</th><th>Agent</th><th>Étape</th><th>Progression</th><th>Score</th><th>ETA</th><th>État</th></tr>
                    </thead>
                    <tbody>
                      {data.experiments.map((row) => (
                        <tr key={row.experimentId} aria-selected={row.experimentId === selectedExperiment?.experimentId} onClick={() => setSelectedMissionId(row.experimentId)}>
                          <td><strong>{row.title}</strong><br /><small style={{ color: "var(--rl-muted)" }}>{row.missionId}</small></td>
                          <td>{row.ownerAgent}</td>
                          <td><StatusBadge tone={stageTone(row.stage)}>{row.stage}</StatusBadge></td>
                          <td><ProgressBar value={row.progressPct} tone="accent" /></td>
                          <td>{row.score}</td>
                          <td>{row.eta}</td>
                          <td><StatusBadge tone={experimentTone(row.status)}>{row.status}</StatusBadge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section className="rl-panel" aria-label="Mission sélectionnée">
              <header><h2>Mission sélectionnée</h2>{selectedExperiment ? <Link to={`/research/experiments/${selectedExperiment.experimentId}`}>Ouvrir le détail</Link> : null}</header>
              <div className="rl-panel__body">
                {selectedExperiment ? (
                  <div className="rl-mission-detail">
                    <strong>{selectedExperiment.title}</strong>
                    <span>{selectedExperiment.hypothesis}</span>
                    <div className="rl-mission-detail__meta">
                      <div><small>Agent</small><strong>{selectedExperiment.ownerAgent}</strong></div>
                      <div><small>Étape</small><strong>{selectedExperiment.stage}</strong></div>
                      <div><small>Tâche en cours</small><strong>{selectedExperiment.currentTask}</strong></div>
                      <div><small>Score</small><strong>{selectedExperiment.score}</strong></div>
                      <div><small>Budget tokens</small><strong>{formatPercent(selectedExperiment.tokenBudgetPct)}</strong></div>
                      <div><small>Budget compute</small><strong>{formatPercent(selectedExperiment.computeBudgetPct)}</strong></div>
                    </div>
                  </div>
                ) : (
                  <p className="rl-empty">Aucune mission sélectionnée.</p>
                )}
              </div>
            </section>
          </div>

          <div className="rl-column">
            <section className="rl-panel" aria-label="Agents actifs">
              <header><h2>Agents actifs</h2><small>{data.agents.length}</small></header>
              <div className="rl-panel__body">
                {data.agents.map((agent) => <WorkerRow key={agent.taskId || agent.agentId} agent={agent} />)}
              </div>
            </section>

            <section className="rl-panel" aria-label="Classement des candidats">
              <header><h2>Classement des candidats</h2><small>Top 10</small></header>
              <div className="rl-panel__body" style={{ padding: 0 }}>
                <div className="rl-table-scroll">
                  <table className="rl-table">
                    <thead>
                      <tr><th>Candidat</th><th>OOS R</th><th>Robust.</th><th>Score</th><th>Décision</th></tr>
                    </thead>
                    <tbody>
                      {topCandidates.map((row) => (
                        <tr key={row.resultId} onClick={() => setSelectedMissionId(row.experimentId)}>
                          <td><Link className="research-table-link" to={`/strategies/${row.strategyId}`}><strong>{row.title}</strong></Link></td>
                          <td className={row.oosR >= 0 ? "text-success" : "text-danger"}>{formatSignedR(row.oosR)}</td>
                          <td>{row.robustnessScore}</td>
                          <td><strong>{row.compositeScore}</strong></td>
                          <td><StatusBadge tone={presentResearchDecision(row.decision).tone}>{presentResearchDecision(row.decision).label}</StatusBadge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section className="rl-panel" aria-label="Flux d'activité recherche">
              <header><h2>Flux d'activité recherche</h2></header>
              <div className="rl-panel__body">
                {data.activityStream.length ? (
                  <div className="rl-activity-stream">
                    {data.activityStream.map((event) => (
                      <div key={event.eventId} className="rl-activity-row">
                        <time>{formatTime(event.at)}</time>
                        <div>
                          <strong>{event.eventType}</strong>
                          <small>{event.missionKey} · {event.detail}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rl-empty">Aucun événement agent publié.</p>
                )}
              </div>
            </section>
          </div>
        </div>

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
    </div>
  );
}

function WorkerRow({ agent }: { agent: AgentRow }) {
  const toneClass = agent.status === "ACTIVE" ? "active" : agent.status === "BLOCKED" ? "blocked" : "waiting";
  return (
    <Link to="/research/agents" className={`rl-worker-row rl-worker-row--${toneClass}`}>
      <span className="rl-worker-dot" aria-hidden="true" />
      <div>
        <strong>{agent.name}</strong>
        <small>{agent.task}</small>
      </div>
      <StatusBadge tone={agent.status === "ACTIVE" ? "success" : agent.status === "BLOCKED" ? "danger" : "warning"}>{agent.status}</StatusBadge>
    </Link>
  );
}

const resultColumns = [
  { key: "strategy", header: "Stratégie", render: (row: ResultRow) => <ResultCell row={row} /> },
  { key: "decision", header: "Décision", render: (row: ResultRow) => <StatusBadge tone={presentResearchDecision(row.decision).tone}>{presentResearchDecision(row.decision).label}</StatusBadge> },
  { key: "oos", header: "OOS R", align: "right" as const, render: (row: ResultRow) => <span className={row.oosR >= 0 ? "text-success" : "text-danger"}>{formatSignedR(row.oosR)}</span> },
  { key: "sharpe", header: "Sharpe", align: "right" as const, render: (row: ResultRow) => row.sharpe.toFixed(2) },
  { key: "robust", header: "Robust.", align: "right" as const, render: (row: ResultRow) => `${row.robustnessScore}` }
] as const;

function ResultCell({ row }: { row: ResultRow }) {
  return (
    <Link className="research-table-link" to={`/strategies/${row.strategyId}`}>
      <strong>{row.title}</strong>
      <small>{row.experimentId}</small>
    </Link>
  );
}

function ResearchLabLoading() {
  return (
    <div className="rl-page">
      <div className="rl-workspace">
        <section className="rl-kpi-strip">
          {Array.from({ length: 7 }).map((_, index) => <Card key={index} state="loading" density="compact"><div className="skeleton-line" /></Card>)}
        </section>
      </div>
    </div>
  );
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

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date);
}
