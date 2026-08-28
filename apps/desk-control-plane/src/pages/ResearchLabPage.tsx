import { useContext, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  FaCheckCircle,
  FaClipboardList,
  FaCoins,
  FaFlask,
  FaMicrochip,
  FaPlay,
  FaSearch,
  FaTimesCircle,
  FaUsers
} from "react-icons/fa";
import { DeskButton, TrackedCommandReceipt } from "@/design-system/actions";
import { Card, ProgressBar, StatusBadge } from "@/design-system/primitives";
import { presentResearchDecision } from "@/design-system/labels";
import { useCapabilityCatalog, useFrontView, useFrontViewRepository } from "@/domains/front-api/repositories";
import { useOperatorSession } from "@/domains/permissions/PermissionGate";
import { RealtimeContext } from "@/domains/realtime/RealtimeProvider";
import { OperatorMenu } from "@/shell/OperatorMenu";
import type { CommandAccepted } from "@/domains/realtime/commandRuntime";
import type { ResearchLabView } from "@/domains/front-api/viewModels";
import "@/features/research-lab/research-lab.css";

type ExperimentRow = ResearchLabView["experiments"][number];
type ResultRow = ResearchLabView["results"][number];
type AgentRow = ResearchLabView["agents"][number];

const MISSIONS_PER_PAGE = 8;

export function ResearchLabPage() {
  const { session } = useOperatorSession();
  const realtime = useContext(RealtimeContext);
  const query = useFrontView("research-lab");
  const capabilityCatalog = useCapabilityCatalog();
  const repository = useFrontViewRepository();
  const [command, setCommand] = useState<CommandAccepted | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [missionSearch, setMissionSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<"ALL" | ExperimentRow["stage"]>("ALL");
  const [missionPage, setMissionPage] = useState(1);

  const data = query.data?.data ?? null;

  const filteredMissions = useMemo(() => {
    if (!data) return [];
    const needle = missionSearch.trim().toLocaleLowerCase("fr");
    return data.experiments.filter((row) => {
      if (stageFilter !== "ALL" && row.stage !== stageFilter) return false;
      if (!needle) return true;
      return `${row.title} ${row.missionId}`.toLocaleLowerCase("fr").includes(needle);
    });
  }, [data, missionSearch, stageFilter]);

  const totalMissionPages = Math.max(1, Math.ceil(filteredMissions.length / MISSIONS_PER_PAGE));
  const pagedMissions = useMemo(() => {
    const page = Math.min(missionPage, totalMissionPages);
    return filteredMissions.slice((page - 1) * MISSIONS_PER_PAGE, page * MISSIONS_PER_PAGE);
  }, [filteredMissions, missionPage, totalMissionPages]);

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

  const bootstrapAction = data.commandActions.find((action) => action.commandType === "research.bootstrap_demo_paper");
  const bootstrapCapability = capabilityCatalog.data?.actions.find((action) => action.commandType === "research.bootstrap_demo_paper");
  const activeAgents = data.agents.filter((agent) => agent.status === "ACTIVE").length;

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
          <h1>Laboratoire de recherche</h1>
          <p>Découverte et validation automatisée de stratégies</p>
        </div>
        <div className="rl-header__engine">
          <small>Moteur de recherche</small>
          <span className={`rl-header__engine-pill rl-header__engine-pill--${data.summary.runningExperiments > 0 ? "on" : "off"}`}>
            <span aria-hidden="true" />
            {data.summary.runningExperiments > 0 ? "En cours" : "Inactif"}
          </span>
        </div>
        <div className="rl-header__clock">
          <strong>{formatClock(realtime?.now)}</strong>
          <small>{formatClockDate(realtime?.now)}</small>
        </div>
        <div className="rl-header__actions">
          <DeskButton variant="primary" disabled={submitting || bootstrapAction?.permission !== "ALLOWED" || bootstrapCapability?.allowed !== true} onClick={bootstrapDemoPaperResearch}>
            {submitting ? "Amorçage..." : bootstrapAction?.label ?? "Commande indisponible"}
          </DeskButton>
          <Link to="/research/data">Explorer les données</Link>
        </div>
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
          <KpiCard icon={<FaClipboardList />} tone="var(--rl-cyan)" label="Missions recherche" value={String(data.experiments.length)} />
          <KpiCard icon={<FaUsers />} tone="var(--rl-blue)" label="Workers actifs" value={`${activeAgents} / ${data.agents.length}`} detail="Utilisation" />
          <KpiCard icon={<FaPlay />} tone="var(--rl-purple)" label="Runs compute" value={String(data.computeQueue.length)} />
          <KpiCard icon={<FaFlask />} tone="var(--rl-cyan)" label="Candidats" value={String(data.results.length)} />
          <KpiCard icon={<FaCheckCircle />} tone="var(--rl-green)" label="Gates passées" value={String(data.summary.promotedStrategies)} />
          <KpiCard icon={<FaTimesCircle />} tone="var(--rl-red)" label="Rejetées" value={String(data.summary.rejectedStrategies)} />
          <KpiCard icon={<FaMicrochip />} tone="var(--rl-amber)" label="Compute utilisé" value={formatPercent(data.summary.computeBudgetUsedPct)} detail="CPU / RAM" />
          <KpiCard icon={<FaCoins />} tone="var(--rl-blue)" label="Budget IA (jour)" value={formatPercent(data.summary.tokenBudgetUsedPct)} detail="Tokens utilisés" />
        </section>

        <div className="rl-row1">
          <section className="rl-panel" aria-label="File de missions recherche">
            <header>
              <h2>File de missions</h2>
              <small>{filteredMissions.length} missions</small>
              <div className="rl-panel__search">
                <FaSearch aria-hidden="true" color="var(--rl-muted)" />
                <input
                  type="search"
                  placeholder="Rechercher une mission..."
                  value={missionSearch}
                  onChange={(event) => { setMissionSearch(event.target.value); setMissionPage(1); }}
                />
              </div>
              <select
                className="rl-panel__select"
                aria-label="Filtrer les missions par étape"
                value={stageFilter}
                onChange={(event) => { setStageFilter(event.target.value as typeof stageFilter); setMissionPage(1); }}
              >
                <option value="ALL">Toutes étapes</option>
                {data.pipeline.map((stage) => <option key={stage.stageId} value={stage.stageId}>{stage.label}</option>)}
              </select>
            </header>
            <div className="rl-panel__body" style={{ padding: 0 }}>
              <div className="rl-table-scroll" role="region" aria-label="Liste des missions de recherche" tabIndex={0}>
                <table className="rl-table">
                  <thead>
                    <tr><th>Mission</th><th>Agent</th><th>Étape</th><th>Progression</th><th>Score</th><th>ETA</th><th>État</th></tr>
                  </thead>
                  <tbody>
                    {pagedMissions.map((row, index) => (
                      <tr key={`${row.experimentId}_${index}`} aria-selected={row.experimentId === selectedExperiment?.experimentId} onClick={() => setSelectedMissionId(row.experimentId)}>
                        <td><strong>{row.title}</strong><span className="rl-mission-id">{row.missionId}</span></td>
                        <td>{row.ownerAgent}</td>
                        <td><StatusBadge tone={stageTone(row.stage)}>{row.stage}</StatusBadge></td>
                        <td>
                          <div className="rl-progress-cell">
                            <ProgressBar value={row.progressPct} tone="accent" />
                            <small>{row.progressPct}%</small>
                          </div>
                        </td>
                        <td>{row.score}</td>
                        <td>{row.eta}</td>
                        <td><StatusBadge tone={experimentTone(row.status)}>{row.status}</StatusBadge></td>
                      </tr>
                    ))}
                    {!pagedMissions.length ? (
                      <tr><td colSpan={7}><p className="rl-empty">Aucune mission ne correspond à ce filtre.</p></td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              {totalMissionPages > 1 ? (
                <div className="rl-pagination">
                  <span>Page {Math.min(missionPage, totalMissionPages)} / {totalMissionPages}</span>
                  <div className="rl-pagination__pages">
                    <button type="button" disabled={missionPage <= 1} onClick={() => setMissionPage((page) => Math.max(1, page - 1))}>‹</button>
                    {Array.from({ length: totalMissionPages }, (_, index) => index + 1).map((page) => (
                      <button key={page} type="button" aria-current={page === missionPage} onClick={() => setMissionPage(page)}>{page}</button>
                    ))}
                    <button type="button" disabled={missionPage >= totalMissionPages} onClick={() => setMissionPage((page) => Math.min(totalMissionPages, page + 1))}>›</button>
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <div className="rl-column">
            <section className="rl-panel" aria-label="Pipeline de recherche">
              <header><h2>Pipeline de recherche</h2><small>Idée → Paper Ready</small></header>
              <div className="rl-panel__body">
                <div className="rl-pipeline-flow">
                  {data.pipeline.map((stage, index) => (
                    <div key={stage.stageId} style={{ display: "flex", alignItems: "flex-start" }}>
                      <div className="rl-pipe-node">
                        <div className="rl-pipe-node__ring" style={{ "--ring-color": stageRingColor(stage.state) } as CSSProperties}>
                          {stage.state === "DONE" ? <FaCheckCircle /> : stage.activeExperiments}
                        </div>
                        <strong>{stage.activeExperiments}</strong>
                        <small title={stage.label}>{stage.label.replace(/_/g, " ")}</small>
                      </div>
                      {index < data.pipeline.length - 1 ? <span className="rl-pipe-arrow">→</span> : null}
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="rl-panel" aria-label="Workers actifs">
              <header><h2>Workers actifs</h2><small>{activeAgents} / {data.agents.length}</small><Link to="/research/agents">Tous les workers</Link></header>
              <div className="rl-panel__body rl-worker-list">
                {data.agents.map((agent, index) => <WorkerRow key={`${agent.taskId || agent.agentId}_${index}`} agent={agent} />)}
              </div>
            </section>
          </div>
        </div>

        <div className="rl-row2">
          <section className="rl-panel" aria-label="Classement des candidats">
            <header><h2>Classement candidats</h2><small>Top 10</small></header>
            <div className="rl-panel__body" style={{ padding: 0 }}>
              <div className="rl-table-scroll">
                <table className="rl-table">
                  <thead>
                    <tr><th>#</th><th>Candidat</th><th>OOS R</th><th>Robust.</th><th>Score</th><th>Décision</th></tr>
                  </thead>
                  <tbody>
                    {topCandidates.map((row, index) => (
                      <tr key={`${row.resultId}_${index}`} onClick={() => setSelectedMissionId(row.experimentId)}>
                        <td><span className="rl-rank-index">{index + 1}</span></td>
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
            <div className="rl-panel__body" style={{ paddingTop: 0 }}>
              <Link to="/research/candidates">Voir tous les candidats →</Link>
            </div>
          </section>

          <section className="rl-panel" aria-label="Mission sélectionnée">
            <header><h2>Mission sélectionnée</h2>{selectedExperiment ? <Link to={`/research/experiments/${selectedExperiment.experimentId}`}>Voir le détail</Link> : null}</header>
            <div className="rl-panel__body">
              {selectedExperiment ? (
                <div className="rl-mission-detail">
                  <div>
                    <strong>{selectedExperiment.title}</strong>
                    <p className="rl-mission-detail__hyp">{selectedExperiment.hypothesis}</p>
                  </div>
                  <div className="rl-mission-box">
                    <small>Résumé mission</small>
                    <div className="rl-mission-box__grid">
                      <div><small>Agent</small><strong>{selectedExperiment.ownerAgent}</strong></div>
                      <div><small>Étape</small><strong>{selectedExperiment.stage}</strong></div>
                      <div><small>Tâche en cours</small><strong>{selectedExperiment.currentTask}</strong></div>
                      <div><small>Score</small><strong>{selectedExperiment.score}</strong></div>
                    </div>
                  </div>
                  <div className="rl-mission-box">
                    <small>Progression</small>
                    <ProgressBar value={selectedExperiment.progressPct} tone="accent" />
                    <div className="rl-mission-box__grid">
                      <div><small>Avancement</small><strong>{selectedExperiment.progressPct}%</strong></div>
                      <div><small>Budget tokens</small><strong>{formatPercent(selectedExperiment.tokenBudgetPct)}</strong></div>
                      <div><small>Budget compute</small><strong>{formatPercent(selectedExperiment.computeBudgetPct)}</strong></div>
                      <div><small>ETA</small><strong>{selectedExperiment.eta}</strong></div>
                    </div>
                  </div>
                  <div className="rl-mission-box rl-mission-box--next">
                    <span className="rl-mission-box--next__play"><FaPlay /></span>
                    <div>
                      <small>Prochaine action automatisée</small>
                      <strong>{selectedExperiment.expectedEvent}</strong>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="rl-empty">Aucune mission sélectionnée.</p>
              )}
            </div>
          </section>

          <section className="rl-panel" aria-label="Flux d'activité recherche">
            <header><h2>Activité recherche</h2><span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, color: "var(--rl-green)", fontSize: 11 }}><FaCircleDot />Live</span></header>
            <div className="rl-panel__body">
              {data.activityStream.length ? (
                <div className="rl-activity-stream" role="region" aria-label="Flux d’activité recherche" tabIndex={0}>
                  {data.activityStream.map((event) => (
                    <div key={event.eventId} className="rl-activity-row">
                      <time>{formatTime(event.at)}</time>
                      <div>
                        <strong style={{ color: activityTone(event.eventType) }}>{event.eventType}</strong>
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
    </div>
  );
}

function KpiCard({ icon, tone, label, value, detail }: { icon: ReactNode; tone: string; label: string; value: string; detail?: string }) {
  return (
    <article className="rl-kpi-card">
      <span className="rl-kpi-card__icon" style={{ color: tone, background: "rgba(255,255,255,.06)" }}>{icon}</span>
      <div className="rl-kpi-card__body">
        <small>{label}</small>
        <strong>{value}</strong>
        {detail ? <span>{detail}</span> : null}
      </div>
    </article>
  );
}

function FaCircleDot() {
  return <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />;
}

function WorkerRow({ agent }: { agent: AgentRow }) {
  const toneClass = agent.status === "ACTIVE" ? "active" : agent.status === "BLOCKED" ? "blocked" : "waiting";
  return (
    <Link to="/research/agents" className={`rl-worker-row rl-worker-row--${toneClass}`}>
      <span className="rl-worker-dot" aria-hidden="true" />
      <div>
        <strong>{agent.name}</strong>
        <small>{agent.role} · {agent.model} · {agent.task}</small>
      </div>
      <StatusBadge tone={agent.status === "ACTIVE" ? "success" : agent.status === "BLOCKED" ? "danger" : "warning"}>{agent.status}</StatusBadge>
    </Link>
  );
}

function ResearchLabLoading() {
  return (
    <div className="rl-page">
      <div className="rl-workspace">
        <section className="rl-kpi-strip">
          {Array.from({ length: 8 }).map((_, index) => <Card key={index} state="loading" density="compact"><div className="skeleton-line" /></Card>)}
        </section>
      </div>
    </div>
  );
}

function stageTone(stage: ExperimentRow["stage"]) {
  if (stage === "PAPER_READY") return "success" as const;
  if (stage === "OOS" || stage === "ROBUSTNESS") return "warning" as const;
  return "accent" as const;
}

function stageRingColor(state: ResearchLabView["pipeline"][number]["state"]) {
  if (state === "DONE") return "var(--rl-green)";
  if (state === "RUNNING") return "var(--rl-blue)";
  if (state === "BLOCKED") return "var(--rl-red)";
  return "var(--rl-amber)";
}

function activityTone(eventType: string) {
  const upper = eventType.toUpperCase();
  if (upper.includes("FAIL") || upper.includes("REJECT")) return "var(--rl-red)";
  if (upper.includes("PASS") || upper.includes("SUCCESS") || upper.includes("COMPLET") || upper.includes("CREATED")) return "var(--rl-green)";
  if (upper.includes("START") || upper.includes("CLAIM") || upper.includes("GENERATED")) return "var(--rl-blue)";
  return "var(--rl-secondary)";
}

function experimentTone(status: ExperimentRow["status"]) {
  if (status === "PROMOTED" || status === "PASSED") return "success" as const;
  if (status === "FAILED" || status === "REJECTED") return "danger" as const;
  if (status === "WAITING") return "warning" as const;
  return "accent" as const;
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

function formatClock(value: Date | undefined) {
  if (!value) return "—:—:—";
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(value);
}

function formatClockDate(value: Date | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "2-digit", month: "short" }).format(value);
}
