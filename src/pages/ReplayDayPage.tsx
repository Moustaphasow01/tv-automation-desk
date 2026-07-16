import { Link, useParams } from "react-router-dom";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, MetricCard, PageHeading, ProgressBar, StatusTag, WorkspaceNav } from "@/components/operations";
import { useReplayDay } from "@/hooks/useOperations";

export default function ReplayDayPage() {
  const { runId = "", date = "" } = useParams();
  const id = decodeURIComponent(runId);
  const query = useReplayDay(id, date);
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Journée introuvable"} retry={() => query.refetch()}/>;
  const day = query.data;
  return <section className="view workspace-view">
    <WorkspaceNav/><Breadcrumbs items={[{ label: "Replay Lab", to: "/replay" }, { label: id, to: `/replay/runs/${encodeURIComponent(id)}` }, { label: day.date }]}/>
    <PageHeading eyebrow="Journée replay" title={day.date} subtitle={`${day.sessions.length} exécutions · ${day.variants.length} variantes`} backTo={`/replay/runs/${encodeURIComponent(id)}`} actions={<StatusTag status={day.status}/>}/>
    <div className="metric-grid metric-grid--compact"><MetricCard label="Sessions" value={day.metrics.sessionCount}/><MetricCard label="Variantes" value={day.variants.length}/><MetricCard label="Progression moyenne" value={`${day.metrics.progress}%`}/><MetricCard label="Résultat cumulé" value={`${day.metrics.totalR.toFixed(2)} R`}/></div>
    <Card className="workspace-panel"><div className="panel-heading"><div><p className="eyebrow">Exécutions distinctes</p><h2>Sessions, variantes et tentatives</h2></div></div>
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Session</th><th>Variante</th><th>Tentative</th><th>État</th><th>Progression</th><th>Résultat</th><th/></tr></thead><tbody>{day.sessions.map(session => <tr key={session.id}><td><strong>{session.session || "globale"}</strong><small>{session.sessionExecutionId}</small></td><td>{session.variantId || "default"}</td><td>#{session.attempt || 1}</td><td><StatusTag status={session.status}/></td><td><ProgressBar value={session.progress}/></td><td>{Number(session.metrics.totalR || 0).toFixed(2)} R</td><td><Link className="row-link" to={`/replay/runs/${encodeURIComponent(id)}/days/${day.date}/sessions/${encodeURIComponent(session.sessionExecutionId || session.sourceId)}`}>Ouvrir →</Link></td></tr>)}</tbody></table></div>
    </Card>
    <Card className="workspace-panel"><h2>Variantes présentes</h2><div className="tag-list">{day.variants.map(variant => <span key={variant}>{variant}</span>)}</div></Card>
  </section>;
}
