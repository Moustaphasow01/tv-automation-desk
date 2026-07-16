import { Link, useParams } from "react-router-dom";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, DecisionChart, EventTimeline, formatDuration, MetricCard, PageHeading, StatusTag, WorkspaceNav } from "@/components/operations";
import { useReplaySession } from "@/hooks/useOperations";

export default function ReplaySessionPage() {
  const { runId = "", date = "", sessionExecutionId = "" } = useParams();
  const parent = decodeURIComponent(runId);
  const execution = decodeURIComponent(sessionExecutionId);
  const query = useReplaySession(parent, execution);
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Session introuvable"} retry={() => query.refetch()}/>;
  const data = query.data;
  return <section className="view workspace-view">
    <WorkspaceNav/><Breadcrumbs items={[{ label: "Replay Lab", to: "/replay" }, { label: parent, to: `/replay/runs/${encodeURIComponent(parent)}` }, { label: date, to: `/replay/runs/${encodeURIComponent(parent)}/days/${date}` }, { label: data.run.session || execution }]}/>
    <PageHeading eyebrow="Session replay" title={`${data.run.session || "Session"} · ${data.run.strategyId || "Desk"}`} subtitle={execution} backTo={`/replay/runs/${encodeURIComponent(parent)}/days/${date}`} actions={<StatusTag status={data.run.status}/>}/>
    <div className="metric-grid metric-grid--compact"><MetricCard label="Progression" value={`${data.run.progress}%`}/><MetricCard label="Durée" value={formatDuration(data.run.durationMs)}/><MetricCard label="Processus GPT" value={data.gptProcesses.length}/><MetricCard label="Résultat" value={`${Number(data.run.metrics.totalR || 0).toFixed(2)} R`}/></div>
    <DecisionChart prices={data.priceSeries} events={data.timeline} runId={execution}/>
    <div className="content-grid content-grid--start">
      <Card className="workspace-panel"><h2>Processus GPT de la session</h2>{!data.gptProcesses.length ? <p className="muted-copy">Aucun processus GPT lié.</p> : data.gptProcesses.map(process => <Link className="gpt-row" key={process.id} to={`/replay/runs/${encodeURIComponent(execution)}/gpt/${encodeURIComponent(process.id)}`}><div><strong>{process.workflow}</strong><small>{process.decision || process.conclusion || process.rawStatus}</small></div><StatusTag status={process.status}/></Link>)}</Card>
      <Card className="workspace-panel"><h2>Conclusions</h2>{!data.conclusions.length ? <p className="muted-copy">Les conclusions enregistrées apparaîtront après matérialisation.</p> : data.conclusions.map(item => <blockquote key={item.processId}>{item.conclusion}</blockquote>)}</Card>
    </div>
    <div id="timeline-events"><h2>Décisions horodatées</h2><EventTimeline events={data.timeline} runId={execution}/></div>
  </section>;
}
