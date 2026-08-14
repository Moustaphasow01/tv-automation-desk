import { Link, useSearchParams } from "react-router-dom";
import { Card, DataSourceBadge, Icon, InlineStateCard } from "@/components/common";
import { formatDateTime, MetricCard, MetricStrip, PageHeading, PageTabs, ProgressBar, StatusTag, WorkflowTable } from "@/components/operations";
import { useOperationsEvents, useOperationsSummary, useWorkflows } from "@/hooks/useOperations";
import { workflowLabel } from "@/lib/presentation";
import type { WorkflowSummary } from "@/operationsTypes";

export default function OperationsPage() {
  useOperationsEvents();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") || "";
  const kind = params.get("kind") || "";
  const q = params.get("q") || "";
  const view = params.get("view") || "table";
  const setFilter = (key: string, value: string) => setParams(current => {
    const next = new URLSearchParams(current);
    value ? next.set(key, value) : next.delete(key);
    return next;
  }, { replace: true });
  const summary = useOperationsSummary();
  const workflows = useWorkflows({ status, kind, q, limit: 500 });
  const totals = summary.data?.totals || { workflows: 0, running: 0, waitingGpt: 0, blocked: 0, failed: 0, completed: 0, openIncidents: 0, gptInProgress: 0 };
  const items = workflows.data?.items || [];
  const isBooting = summary.isLoading && workflows.isLoading;
  return <section className="view workspace-view operations-command-view">
    <PageHeading eyebrow="Automatisation" title="Cockpit des opérations" subtitle="Tous les workflows automatisés, leur progression et les interventions requises." actions={<><DataSourceBadge label="POSTGRES"/><Link className="secondary-btn" to="/operations/incidents">Incidents · {totals.openIncidents}</Link></>} tabs={<PageTabs items={[{ label: "Cockpit", to: "/operations", end: true }, { label: "Agents IA", to: "/operations/agents" }, { label: "AI Context", to: "/operations/ai-context" }, { label: "Files GPT", to: "/operations/claim-lanes" }, { label: "Portfolio Risk", to: "/operations/portfolio-risk" }, { label: "Exécution", to: "/operations/execution" }, { label: "Observabilité", to: "/operations/observability" }, { label: "Incidents", to: "/operations/incidents" }, { label: "Notifications", to: "/operations/notifications" }, { label: "Runbooks", to: "/operations/runbooks" }]}/>}/>
    {(summary.isError || workflows.isError) && <InlineStateCard
      tone="warning"
      code="PARTIAL_API_STATE"
      title="Certaines données opérations sont lentes ou indisponibles"
      text={(summary.error || workflows.error)?.message || "Une requête n’a pas répondu dans le délai client. Les données déjà chargées restent affichées."}
      action={<button className="secondary-btn" onClick={() => { summary.refetch(); workflows.refetch(); }}><Icon name="refresh" size={14}/>Réessayer</button>}
    />}
    <MetricStrip className="metric-strip--six">
      <MetricCard label="Workflows" value={summary.isLoading ? "…" : totals.workflows} detail={summary.data?.health.label || (summary.isLoading ? "chargement" : "indisponible")} onClick={() => setFilter("status", "")}/>
      <MetricCard label="En cours" value={totals.running} tone="info" onClick={() => setFilter("status", "running")}/>
      <MetricCard label="Attente GPT" value={totals.waitingGpt} tone="warning" onClick={() => setFilter("status", "waiting_gpt")}/>
      <MetricCard label="Bloqués / échecs" value={totals.blocked + totals.failed} tone={totals.failed ? "critical" : "warning"} onClick={() => setFilter("status", totals.failed ? "failed" : "blocked")}/>
      <MetricCard label="Terminés" value={totals.completed} tone="positive" onClick={() => setFilter("status", "completed")}/>
      <MetricCard label="Process GPT actifs" value={totals.gptInProgress}/>
    </MetricStrip>
    <div className="workspace-toolbar operations-filter-bar">
      <label>Recherche<input value={q} onChange={event => setFilter("q", event.target.value)} placeholder="ID, type, état…"/></label>
      <label>Type<select value={kind} onChange={event => setFilter("kind", event.target.value)}><option value="">Tous</option><option value="replay">Replay</option><option value="backtest">Backtest</option><option value="job">Job</option><option value="feature">Feature</option></select></label>
      <label>État<select value={status} onChange={event => setFilter("status", event.target.value)}><option value="">Tous</option><option value="running">En cours</option><option value="waiting_gpt">Attente GPT</option><option value="blocked">Bloqué</option><option value="failed">Échec</option><option value="completed">Terminé</option><option value="paused">Pause</option></select></label>
      <div className="workspace-view-switch" role="group" aria-label="Vue workflows"><button className={view === "table" ? "active" : ""} onClick={() => setFilter("view", "table")}>Tableau</button><button className={view === "board" ? "active" : ""} onClick={() => setFilter("view", "board")}>Kanban</button><button className={view === "timeline" ? "active" : ""} onClick={() => setFilter("view", "timeline")}>Chronologie</button></div>
      <button className="secondary-btn" onClick={() => workflows.refetch()}><Icon name="refresh" size={14}/>Actualiser</button>
    </div>
    {isBooting ? <InlineStateCard tone="info" code="WORKFLOW_LEDGER_LOADING" title="Lecture du ledger workflows" text="Le desk attend la réponse réelle de PostgreSQL. La page ne charge plus en plein écran."/> :
      workflows.isError ? <InlineStateCard tone="critical" code="WORKFLOW_LEDGER_TIMEOUT" title="Ledger workflows indisponible" text={workflows.error?.message || "La requête workflows n’a pas répondu."} action={<button className="primary-btn" onClick={() => workflows.refetch()}>Réessayer</button>}/> :
      view === "board" ? <WorkflowBoard items={items}/> : view === "timeline" ? <WorkflowTimeline items={items}/> : <WorkflowTable items={items}/>}
  </section>;
}

function WorkflowBoard({ items }: { items: WorkflowSummary[] }) {
  const lanes = ["running", "waiting_gpt", "blocked", "failed", "queued", "paused", "completed"];
  const grouped = items.reduce<Record<string, WorkflowSummary[]>>((output, item) => {
    const key = lanes.includes(item.status) ? item.status : "queued";
    (output[key] ||= []).push(item);
    return output;
  }, {});
  return <div className="workflow-board workflow-board--responsive" aria-label="Board workflows automatisés">
    {lanes.map((lane) => <Card className="workflow-board__lane" key={lane}>
      <header><div><p className="eyebrow">{laneLabel(lane)}</p><h2>{grouped[lane]?.length || 0}</h2></div><StatusTag status={lane}/></header>
      <div>{(grouped[lane] || []).map((item) => <Link className="workflow-board-card" key={item.id} to={`/operations/workflows/${encodeURIComponent(item.id)}`}>
        <div><strong>{workflowLabel(item.sourceId || item.id)}</strong><small>{item.name}</small></div>
        <ProgressBar value={item.progress} status={item.status}/>
        <footer><span>{item.session || item.kind}</span><span>{formatDateTime(item.updatedAt)}</span></footer>
      </Link>)}</div>
    </Card>)}
  </div>;
}

function WorkflowTimeline({ items }: { items: WorkflowSummary[] }) {
  const ordered = [...items].sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
  return <Card className="workflow-timeline-panel">
    <header><div><p className="eyebrow">Timeline workflows</p><h2>Dernières transitions automatisées</h2></div><span>{ordered.length} événements</span></header>
    {!ordered.length ? <div className="terminal-empty-state"><span>NO_WORKFLOW</span><small>Aucun workflow dans le filtre courant.</small></div> : <ol className="workflow-timeline">
      {ordered.map((item) => <li key={item.id} data-status={item.status}>
        <time>{formatDateTime(item.updatedAt)}</time>
        <i/>
        <div><div><strong>{item.name}</strong><StatusTag status={item.status}/></div><p>{item.error?.message || `${item.kind} · ${item.session || "session globale"} · ${item.progress}%`}</p><Link className="row-link" to={`/operations/workflows/${encodeURIComponent(item.id)}`}>Ouvrir le workflow <Icon name="arrow" size={13}/></Link></div>
      </li>)}
    </ol>}
  </Card>;
}

function laneLabel(status: string) {
  return ({ running: "En cours", waiting_gpt: "Attente GPT", blocked: "Bloqués", failed: "Échecs", queued: "Queue", paused: "Pause", completed: "Terminés" } as Record<string, string>)[status] || status;
}
