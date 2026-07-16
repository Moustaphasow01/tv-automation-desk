import { useState } from "react";
import { Link } from "react-router-dom";
import { ErrorView, LoadingView } from "@/components/common";
import { MetricCard, PageHeading, WorkspaceNav, WorkflowTable } from "@/components/operations";
import { useOperationsEvents, useOperationsSummary, useWorkflows } from "@/hooks/useOperations";

export default function OperationsPage() {
  useOperationsEvents();
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const summary = useOperationsSummary();
  const workflows = useWorkflows({ status, kind, q, limit: 500 });
  if (summary.isLoading || workflows.isLoading) return <LoadingView/>;
  if (summary.isError || workflows.isError || !summary.data || !workflows.data) return <ErrorView message={(summary.error || workflows.error)?.message || "Cockpit indisponible"} retry={() => { summary.refetch(); workflows.refetch(); }}/ >;
  const totals = summary.data.totals;
  return <section className="view workspace-view">
    <WorkspaceNav/>
    <PageHeading eyebrow="Control plane" title="Cockpit des opérations" subtitle="Tous les workflows automatisés, leur progression et les interventions requises." actions={<Link className="secondary-btn" to="/operations/incidents">Incidents · {totals.openIncidents}</Link>}/>
    <div className="metric-grid">
      <MetricCard label="Workflows" value={totals.workflows} detail={summary.data.health.label}/>
      <MetricCard label="En cours" value={totals.running} tone="info"/>
      <MetricCard label="Attente GPT" value={totals.waitingGpt} tone="warning"/>
      <MetricCard label="Bloqués / échecs" value={totals.blocked + totals.failed} tone={totals.failed ? "critical" : "warning"}/>
      <MetricCard label="Terminés" value={totals.completed} tone="positive"/>
      <MetricCard label="Process GPT actifs" value={totals.gptInProgress}/>
    </div>
    <div className="workspace-toolbar">
      <label>Recherche<input value={q} onChange={event => setQ(event.target.value)} placeholder="ID, type, état…"/></label>
      <label>Type<select value={kind} onChange={event => setKind(event.target.value)}><option value="">Tous</option><option value="replay">Replay</option><option value="backtest">Backtest</option><option value="job">Job</option><option value="feature">Feature</option></select></label>
      <label>État<select value={status} onChange={event => setStatus(event.target.value)}><option value="">Tous</option><option value="running">En cours</option><option value="waiting_gpt">Attente GPT</option><option value="blocked">Bloqué</option><option value="failed">Échec</option><option value="completed">Terminé</option><option value="paused">Pause</option></select></label>
      <button className="text-btn" onClick={() => workflows.refetch()}>Actualiser</button>
    </div>
    <WorkflowTable items={workflows.data.items}/>
  </section>;
}
