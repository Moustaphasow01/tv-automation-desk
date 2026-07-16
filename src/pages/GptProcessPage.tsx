import { useParams } from "react-router-dom";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, EventTimeline, formatDateTime, formatDuration, MetricCard, PageHeading, StatusTag, WorkspaceNav } from "@/components/operations";
import { useGptProcess } from "@/hooks/useOperations";

export default function GptProcessPage() {
  const { runId = "", processId = "" } = useParams();
  const id = decodeURIComponent(processId);
  const query = useGptProcess(id);
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Processus GPT introuvable"} retry={() => query.refetch()}/>;
  const data = query.data;
  return <section className="view workspace-view">
    <WorkspaceNav/><Breadcrumbs items={[{ label: "Replay Lab", to: "/replay" }, { label: decodeURIComponent(runId), to: `/replay/runs/${runId}` }, { label: "GPT" }, { label: data.process.workflow }]}/>
    <PageHeading eyebrow="Inspecteur GPT" title={data.process.workflow} subtitle={data.process.id} backTo={`/replay/runs/${runId}`} actions={<StatusTag status={data.process.status}/>}/>
    <div className="metric-grid metric-grid--compact"><MetricCard label="Tentative" value={`${data.process.attempt}/${data.process.maxAttempts || "—"}`}/><MetricCard label="Durée" value={formatDuration(data.process.durationMs)}/><MetricCard label="Worker" value={data.process.worker || "—"}/><MetricCard label="Fin" value={formatDateTime(data.process.completedAt)}/></div>
    {data.process.error && <Card className="error-box"><strong>{data.process.error.code || "Erreur GPT"}</strong><p>{data.process.error.message}</p></Card>}
    <div className="content-grid content-grid--start">
      <Card className="workspace-panel"><p className="eyebrow">Conclusion matérialisée</p><h2>{data.process.decision || "Décision GPT"}</h2><p className="conclusion-copy">{data.process.conclusion || "Aucune conclusion n’a encore été sauvegardée par le workflow."}</p></Card>
      <Card className="workspace-panel"><h2>Transport & lease</h2><dl className="definition-grid"><dt>État source</dt><dd>{data.process.rawStatus}</dd><dt>Step</dt><dd>{data.process.stepId || "—"}</dd><dt>Lease</dt><dd>{formatDateTime(data.process.leaseExpiresAt)}</dd><dt>Bundle</dt><dd>{data.process.bundle?.bundleId || "—"}</dd></dl></Card>
    </div>
    <details className="raw-inspector"><summary>Manifest du bundle</summary><pre>{JSON.stringify(data.manifest, null, 2)}</pre></details>
    <details className="raw-inspector"><summary>Save target</summary><pre>{JSON.stringify(data.saveTarget, null, 2)}</pre></details>
    <details className="raw-inspector"><summary>Prompt d’exécution</summary><pre>{data.prompt || "Non exposé"}</pre></details>
    <div><h2>Cycle de vie GPT</h2><EventTimeline events={data.process.events} runId={decodeURIComponent(runId)}/></div>
  </section>;
}
