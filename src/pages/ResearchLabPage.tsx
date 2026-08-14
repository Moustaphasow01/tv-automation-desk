import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { Card, DataSourceBadge, ErrorView, Icon, LoadingView } from "@/components/common";
import { EmptyWorkspace, MetricCard, MetricStrip, PageHeading, StatusTag } from "@/components/operations";
import {
  buildResearchCandidateDetailViewModel,
  buildResearchExperimentDetailViewModel,
  buildResearchLabViewModel,
} from "@/features/research-lab/viewModel";

type ResearchLabView = ReturnType<typeof buildResearchLabViewModel>;

export default function ResearchLabPage() {
  const overview = useQuery({ queryKey: ["research-lab", "overview"], queryFn: () => operationsApi.getResearchLabOverview({ limit: 200 }), refetchInterval: 60_000 });
  const [actionState, setActionState] = useState<{ status: "idle" | "running" | "done" | "error"; message: string }>({ status: "idle", message: "Aucun amorçage demandé." });

  if (overview.isLoading) return <LoadingView title="Chargement Research Lab" message="Lecture des experiments, candidates, rapports et graphe depuis l’API réelle." source="POSTGRES + API"/>;
  if (overview.isError) return <ErrorView message={overview.error.message} retry={() => overview.refetch()}/>;

  const view = buildResearchLabViewModel(overview.data);
  const bootstrapDemoPaper = async () => {
    setActionState({ status: "running", message: "Bootstrap recherche/backtest 1 mois en cours..." });
    try {
      const result = await operationsApi.executeResearchLabAction({
        action: "bootstrap_demo_paper_research",
        symbol_code: "MNQ1!",
        instrument: "MNQ",
        timeframe: "5",
        start_utc: "2026-06-01T00:00:00.000Z",
        end_utc: "2026-07-01T00:00:00.000Z",
        dataset_key: "demo-paper.mnq.m5.2026-06-01_2026-07-01",
        reason: "Legacy Research Lab operator bootstrap."
      });
      setActionState({ status: "done", message: `Bootstrap accepté : ${String(result.status || "READY")}` });
      void overview.refetch();
    } catch (error) {
      setActionState({ status: "error", message: error instanceof Error ? error.message : "RESEARCH_BOOTSTRAP_FAILED" });
    }
  };

  return <ResearchLabOverviewContent view={view} onRefresh={() => overview.refetch()} actionState={actionState} onBootstrap={bootstrapDemoPaper}/>;
}

function ResearchLabOverviewContent({
  view,
  onRefresh,
  actionState,
  onBootstrap,
}: {
  view: ResearchLabView;
  onRefresh: () => void;
  actionState: { status: "idle" | "running" | "done" | "error"; message: string };
  onBootstrap: () => void;
}) {
  return <section className="view workspace-view research-lab-page">
    <PageHeading
      eyebrow="Research Lab"
      title="Experiments, candidates & preuves"
      subtitle="Pilotage transitoire du nouveau pipeline recherche : génération, validation contradictoire, promotion et mémoire d’échecs."
      actions={<><DataSourceBadge label="POSTGRES + API" detail="aucun mock"/><button className="primary-btn" disabled={actionState.status === "running"} onClick={onBootstrap}>{actionState.status === "running" ? "Amorçage..." : "Amorcer 1 mois"}</button><button className="secondary-btn" onClick={onRefresh}><Icon name="refresh" size={14}/>Actualiser</button></>}
    />
    <p className={`operator-feedback${actionState.status === "error" ? " operator-feedback--error" : ""}`}>{actionState.message}</p>

    <MetricStrip className="metric-grid--compact">
      {view.metrics.map((metric) => <MetricCard key={metric.label} label={metric.label} value={metric.value} detail={metric.detail} tone={metric.tone}/>)}
    </MetricStrip>

    <ResearchSourcePanel view={view}/>
    <ResearchWarningsPanel warnings={view.warnings}/>
    <section className="data-foundation-grid">
      <ResearchExperimentTable rows={view.experimentRows}/>
      <ResearchCandidateTable rows={view.candidateRows}/>
    </section>
    <ResearchReportTable rows={view.reportRows}/>
    <p className="muted-copy">Graphe logique : {view.graphLabel}. Besoin des versions publiées ? <Link to="/strategies">ouvrir Stratégie & contrats</Link>.</p>
  </section>;
}

function ResearchSourcePanel({ view }: { view: ResearchLabView }) {
  return <Card className="workspace-panel strategy-source-panel">
    <div>
      <p className="eyebrow">{view.sourceLabel}</p>
      <h2>Front Research contrôlé</h2>
      <p>Cette vue lit uniquement les projections Research Lab du BFF. Les tables registry et graphe restent derrière les services backend.</p>
    </div>
    <span className="terminal-counter">MAJ {view.generatedAt}</span>
  </Card>;
}

function ResearchWarningsPanel({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return <Card className="workspace-panel">
    <h2>À surveiller</h2>
    <div className="tag-list">{warnings.map((warning) => <span key={warning}>{warning}</span>)}</div>
  </Card>;
}

function ResearchExperimentTable({ rows }: { rows: ResearchLabView["experimentRows"] }) {
  return <Panel title="Experiments" subtitle="Vue globale · cliquer pour zoomer">
    {rows.length ? <div className="data-table-wrap"><table className="data-table">
      <thead><tr><th>Experiment</th><th>État</th><th>Candidates</th><th>Rapports</th><th>Action</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.research_experiment_id}>
        <td data-label="Experiment"><strong>{row.label}</strong><small>{row.objective || row.research_experiment_id}</small></td>
        <td data-label="État"><StatusTag status={row.status}/><small>{row.statusLabel}</small></td>
        <td data-label="Candidates">{row.counts.candidates}<small>{row.counts.promotion_ready} prêtes promotion</small></td>
        <td data-label="Rapports">{row.counts.evaluation_reports}<small>{row.counts.failed_reports} échec(s)</small></td>
        <td data-label="Action"><Link className="secondary-btn" to={row.href}>Ouvrir</Link></td>
      </tr>)}</tbody>
    </table></div> : <EmptyWorkspace title="Aucun experiment" text="État réel vide : le front ne fabrique aucun experiment fictif."/>}
  </Panel>;
}

function ResearchReportTable({ rows }: { rows: ResearchLabView["reportRows"] }) {
  return <Panel title="Derniers rapports" subtitle="Validation, robustesse, critique contradictoire">
    {rows.length ? <div className="data-table-wrap"><table className="data-table">
      <thead><tr><th>Rapport</th><th>Verdict</th><th>Score</th><th>Simulation</th><th>Candidate</th></tr></thead>
      <tbody>{rows.slice(0, 20).map((row) => <tr key={row.research_evaluation_report_id}>
        <td data-label="Rapport"><strong>{row.label}</strong><small>{row.research_evaluation_report_id}</small></td>
        <td data-label="Verdict"><StatusTag status={row.verdict}/><small>{row.verdictLabel}</small></td>
        <td data-label="Score">{row.scoreLabel}</td>
        <td data-label="Simulation">{row.simulation_run_id || "—"}</td>
        <td data-label="Candidate"><Link to={`/research/candidates/${encodeURIComponent(row.research_candidate_id)}`}>{row.research_candidate_id}</Link></td>
      </tr>)}</tbody>
    </table></div> : <EmptyWorkspace title="Aucun rapport" text="Les preuves apparaîtront après les simulations et validations."/>}
  </Panel>;
}

export function ResearchExperimentZoomPage() {
  const { experimentId = "" } = useParams();
  const detail = useQuery({ queryKey: ["research-lab", "experiment", experimentId], queryFn: () => operationsApi.getResearchExperiment(experimentId), enabled: Boolean(experimentId), refetchInterval: 60_000 });
  if (detail.isLoading) return <LoadingView title="Chargement experiment" message={experimentId} source="POSTGRES + API"/>;
  if (detail.isError) return <ErrorView message={detail.error.message} retry={() => detail.refetch()}/>;
  const view = buildResearchExperimentDetailViewModel(detail.data);
  return <section className="view workspace-view research-lab-page">
    <PageHeading eyebrow="Research Lab · Zoom" title={view.experiment?.name || experimentId} subtitle={view.experiment?.objective || "Experiment Research"} actions={<Link className="secondary-btn" to="/research">Retour Research</Link>}/>
    <MetricStrip className="metric-grid--compact">{view.metrics.map((metric) => <MetricCard key={metric.label} label={metric.label} value={metric.value} detail={metric.detail} tone={metric.tone}/>)}</MetricStrip>
    <Panel title="Hypothèses" subtitle="Questions falsifiables">
      {view.hypotheses.length ? <ul className="terminal-list">{view.hypotheses.map((item) => <li key={item.research_hypothesis_id}>
        <span><strong>{item.statement}</strong><small>{item.falsifiable_question} · {item.invalidation_criteria}</small></span><StatusTag status={item.status}/>
      </li>)}</ul> : <EmptyWorkspace title="Aucune hypothèse" text="Experiment sans hypothèse visible."/>}
    </Panel>
    <ResearchCandidateTable rows={view.candidateRows}/>
  </section>;
}

export function ResearchCandidateZoomPage() {
  const { candidateId = "" } = useParams();
  const detail = useQuery({ queryKey: ["research-lab", "candidate", candidateId], queryFn: () => operationsApi.getResearchCandidate(candidateId), enabled: Boolean(candidateId), refetchInterval: 60_000 });
  if (detail.isLoading) return <LoadingView title="Chargement candidate" message={candidateId} source="POSTGRES + API"/>;
  if (detail.isError) return <ErrorView message={detail.error.message} retry={() => detail.refetch()}/>;
  const view = buildResearchCandidateDetailViewModel(detail.data);
  return <section className="view workspace-view research-lab-page">
    <PageHeading eyebrow="Research Lab · Candidate" title={view.candidate?.label || candidateId} subtitle={view.candidate?.primary_change_summary || "Candidate Research"} actions={<Link className="secondary-btn" to="/research">Retour Research</Link>}/>
    {view.candidate && <MetricStrip className="metric-grid--compact">
      <MetricCard label="État" value={view.candidate.statusLabel} detail={view.candidate.decisionLabel} tone={view.candidate.tone}/>
      <MetricCard label="Score" value={scoreLabel(view.candidate.evaluation_score)} detail={`novelty ${scoreLabel(view.candidate.novelty_score)}`}/>
      <MetricCard label="Rapports" value={view.candidate.report_count} detail={`${view.candidate.failed_report_count} échec(s)`}/>
      <MetricCard label="Version" value={view.candidate.strategy_version_id || "—"} detail="StrategyVersion liée"/>
    </MetricStrip>}
    {view.hypothesis && <Panel title="Hypothèse" subtitle="Cadre falsifiable"><p>{view.hypothesis.statement}</p><p className="muted-copy">{view.hypothesis.falsifiable_question}</p></Panel>}
    <Panel title="Rapports" subtitle="Preuves liées à la candidate">
      {view.reports.length ? <ul className="terminal-list">{view.reports.map((report) => <li key={report.research_evaluation_report_id}>
        <span><strong>{report.label}</strong><small>{report.verdictLabel} · score {report.scoreLabel} · {report.simulation_run_id || "simulation non liée"}</small></span><StatusTag status={report.verdict}/>
      </li>)}</ul> : <EmptyWorkspace title="Aucun rapport" text="Candidate sans preuve visible."/>}
    </Panel>
  </section>;
}

function ResearchCandidateTable({ rows }: { rows: ReturnType<typeof buildResearchLabViewModel>["candidateRows"] }) {
  return <Panel title="Candidates" subtitle="Cliquer pour zoomer">
    {rows.length ? <div className="data-table-wrap"><table className="data-table">
      <thead><tr><th>Candidate</th><th>État</th><th>Décision</th><th>Score</th><th>Action</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.research_candidate_id}>
        <td data-label="Candidate"><strong>{row.label}</strong><small>{row.primary_change_summary}</small></td>
        <td data-label="État"><StatusTag status={row.status}/><small>{row.statusLabel}</small></td>
        <td data-label="Décision">{row.decisionLabel}</td>
        <td data-label="Score">{scoreLabel(row.evaluation_score)}</td>
        <td data-label="Action"><Link className="secondary-btn" to={row.href}>Zoom</Link></td>
      </tr>)}</tbody>
    </table></div> : <EmptyWorkspace title="Aucune candidate" text="Experiment sans candidate visible."/>}
  </Panel>;
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <Card className="workspace-panel"><header className="panel-heading"><div><p className="eyebrow">{subtitle}</p><h2>{title}</h2></div></header>{children}</Card>;
}

function scoreLabel(value: number | null) {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}
