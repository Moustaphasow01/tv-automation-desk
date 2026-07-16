import { Link, useParams } from "react-router-dom";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, DecisionChart, EventTimeline, MetricCard, PageHeading, ProgressBar, StatusTag, WorkspaceNav } from "@/components/operations";
import { useReplay } from "@/hooks/useOperations";

export default function ReplayRunPage() {
  const { runId = "" } = useParams();
  const id = decodeURIComponent(runId);
  const query = useReplay(id);
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Replay introuvable"} retry={() => query.refetch()}/>;
  const data = query.data;
  return <section className="view workspace-view">
    <WorkspaceNav/><Breadcrumbs items={[{ label: "Replay Lab", to: "/replay" }, { label: data.run.tradingDate || data.run.name }]}/>
    <PageHeading eyebrow="Replay run" title={data.run.name} subtitle={data.run.sourceId} backTo="/replay" actions={<StatusTag status={data.run.status}/>}/>
    <div className="metric-grid metric-grid--compact"><MetricCard label="Progression" value={`${data.run.progress}%`}/><MetricCard label="Étapes" value={`${data.run.metrics.stepsDone || 0}/${data.run.metrics.stepsTotal || 0}`}/><MetricCard label="Process GPT" value={data.gptProcesses.length}/><MetricCard label="Résultat" value={`${Number(data.run.metrics.totalR || 0).toFixed(2)} R`}/></div>
    <ProgressBar value={data.run.progress}/>
    <div className="inline-actions"><Link className="primary-btn" to={`/replay/runs/${encodeURIComponent(id)}/days/${data.run.tradingDate}`}>Sessions de la journée</Link><Link className="secondary-btn" to={`/operations/workflows/${encodeURIComponent(data.run.id)}`}>Contrôler le workflow</Link></div>
    <DecisionChart prices={data.priceSeries} events={data.timeline} runId={id}/>
    <div className="content-grid content-grid--start"><Card className="workspace-panel"><h2>Conclusions GPT</h2>{!data.conclusions.length ? <p className="muted-copy">Aucune conclusion GPT matérialisée.</p> : data.conclusions.map(item => <Link className="conclusion-item" key={item.processId} to={`/replay/runs/${encodeURIComponent(id)}/gpt/${encodeURIComponent(item.processId)}`}><strong>{item.conclusion}</strong><span>Inspecter →</span></Link>)}</Card><Card className="workspace-panel"><h2>Processus GPT</h2>{data.gptProcesses.map(process => <Link className="gpt-row" key={process.id} to={`/replay/runs/${encodeURIComponent(id)}/gpt/${encodeURIComponent(process.id)}`}><div><strong>{process.workflow}</strong><small>Tentative {process.attempt}/{process.maxAttempts || "—"}</small></div><StatusTag status={process.status}/></Link>)}</Card></div>
    <div id="timeline-events"><h2>Timeline complète</h2><EventTimeline events={data.timeline} runId={id}/></div>
  </section>;
}
