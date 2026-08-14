import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Card, DataSourceBadge, ErrorView, Icon, InlineStateCard, LoadingView } from "@/components/common";
import { EmptyWorkspace, MetricCard, MetricStrip, PageHeading, PageTabs, StatusTag } from "@/components/operations";
import { operationsApi } from "@/api/operationsApi";
import {
  operationsKeys,
  useAgentRuntimeDeadLetters,
  useAgentRuntimeMetrics,
  useAgentRuntimeOverview,
  useAgentRuntimePools,
  useAgentRuntimeSchedulerPlan,
  useAgentRuntimeTasks,
  useOperationsEvents,
} from "@/hooks/useOperations";
import { buildAgentRuntimeViewModel } from "@/features/agent-runtime/viewModel";
import type { AgentRuntimeDeadLetterRow, AgentRuntimeTaskRow } from "@/features/agent-runtime/viewModel";

const operationsTabs = [
  { label: "Cockpit", to: "/operations", end: true },
  { label: "Agents IA", to: "/operations/agents" }, { label: "AI Context", to: "/operations/ai-context" },
  { label: "Files GPT", to: "/operations/claim-lanes" },
  { label: "Portfolio Risk", to: "/operations/portfolio-risk" },
  { label: "Exécution", to: "/operations/execution" },
  { label: "Observabilité", to: "/operations/observability" },
  { label: "Incidents", to: "/operations/incidents" },
];

const lanes = ["", "live", "safety", "operations", "replay", "validation", "research"];
const statuses = ["", "PENDING", "READY", "CLAIMED", "RUNNING", "WAITING_DEPENDENCY", "DONE", "ERROR", "CANCELLED", "EXPIRED"];

export default function AgentRuntimePage() {
  useOperationsEvents();
  const [lane, setLane] = useState("");
  const [status, setStatus] = useState("");
  const taskFilters = useMemo(() => ({ lane, status, limit: 120 }), [lane, status]);
  const laneFilters = useMemo(() => ({ lane: lane || null }), [lane]);
  const overview = useAgentRuntimeOverview(laneFilters);
  const pools = useAgentRuntimePools(laneFilters);
  const scheduler = useAgentRuntimeSchedulerPlan({ lane, limit: 120 });
  const tasks = useAgentRuntimeTasks(taskFilters);
  const deadLetters = useAgentRuntimeDeadLetters({ lane, status: "OPEN", limit: 100 });
  const metrics = useAgentRuntimeMetrics({ lane, limit: 80 });
  const queries = [overview, pools, scheduler, tasks, deadLetters, metrics];
  const isBooting = queries.every(query => query.isLoading);
  const hardError = overview.isError && pools.isError && tasks.isError;
  const view = buildAgentRuntimeViewModel({
    overview: overview.data,
    pools: pools.data,
    scheduler: scheduler.data,
    tasks: tasks.data,
    deadLetters: deadLetters.data,
    metrics: metrics.data,
  });
  const refresh = () => queries.forEach(query => query.refetch());
  const { requeue, cancel } = useAgentRuntimeMutations();

  if (isBooting) return <LoadingView title="Chargement cockpit Agents IA" message="Lecture durable des tâches, pools, scheduler, métriques et DLQ." source="POSTGRES + API"/>;
  if (hardError) return <ErrorView message={overview.error?.message || pools.error?.message || tasks.error?.message || "Cockpit Agents indisponible"} retry={refresh}/>;

  return <section className="view workspace-view agent-runtime-page">
    <AgentRuntimeHeading refresh={refresh}/>
    <AgentRuntimePartialNotice errors={[overview, pools, scheduler, tasks, deadLetters, metrics]} refresh={refresh}/>
    <MetricStrip className="metric-strip--six">{view.metrics.map(metric => <MetricCard key={metric.label} label={metric.label} value={metric.value} detail={metric.detail} tone={metric.tone}/>)}</MetricStrip>
    <AgentRuntimeToolbar lane={lane} status={status} health={view.health} onLane={setLane} onStatus={setStatus} refresh={refresh}/>
    <AgentRuntimeWarnings view={view}/>
    <section className="agent-runtime-layout">
      <AgentRuntimePools rows={view.poolRows} generatedAt={view.generatedAt}/>
      <AgentRuntimeScheduler rows={view.schedulerRows}/>
    </section>
    <AgentRuntimeTasks rows={view.taskRows} pending={cancel.isPending} onCancel={(row) => requestCancel(row, cancel.mutate)}/>
    <section className="agent-runtime-layout agent-runtime-layout--bottom">
      <AgentRuntimeDeadLetters rows={view.deadLetterRows} pending={requeue.isPending} onRequeue={(row) => requestRequeue(row, requeue.mutate)}/>
      <AgentRuntimeMetrics rows={view.metricRows}/>
    </section>
  </section>;
}

function useAgentRuntimeMutations() {
  const client = useQueryClient();
  const invalidateRuntime = () => client.invalidateQueries({ queryKey: operationsKeys.all });
  return {
    requeue: useMutation({
      mutationFn: ({ row, reason }: { row: AgentRuntimeDeadLetterRow; reason: string }) =>
        operationsApi.requeueAgentRuntimeDeadLetter(row.key, { reason, idempotency_key: `front-requeue-${row.key}-${Date.now()}` }),
      onSuccess: invalidateRuntime,
    }),
    cancel: useMutation({
      mutationFn: ({ row, reason }: { row: AgentRuntimeTaskRow; reason: string }) =>
        operationsApi.cancelAgentRuntimeTask(row.key, { reason, idempotency_key: `front-cancel-${row.key}-${Date.now()}` }),
      onSuccess: invalidateRuntime,
    }),
  };
}

function AgentRuntimeHeading({ refresh }: { refresh: () => void }) {
  return <PageHeading
    eyebrow="Automatisation"
    title="Cockpit Agents IA"
    subtitle="Superviser les workers Codex, pools isolés, tâches durables, scheduler et dead-letters sans accès SQL direct."
    backTo="/operations"
    actions={<><DataSourceBadge label="POSTGRES + API" detail="agent-runtime réel"/><button className="secondary-btn" onClick={refresh}><Icon name="refresh" size={14}/>Actualiser</button></>}
    tabs={<PageTabs items={operationsTabs}/>}
  />;
}

function AgentRuntimePartialNotice({ errors, refresh }: { errors: Array<{ isError: boolean; error: Error | null }>; refresh: () => void }) {
  const error = errors.find(item => item.isError)?.error;
  if (!error) return null;
  return <InlineStateCard
    tone="warning"
    code="AGENT_RUNTIME_PARTIAL"
    title="Vue agents partiellement disponible"
    text={error.message || "Une requête agent-runtime n’a pas répondu ; les autres blocs restent sur données réelles."}
    action={<button className="secondary-btn" onClick={refresh}><Icon name="refresh" size={14}/>Réessayer</button>}
  />;
}

function AgentRuntimeToolbar(props: { lane: string; status: string; health: { label: string; tone: string }; onLane: (value: string) => void; onStatus: (value: string) => void; refresh: () => void }) {
  return <div className="workspace-toolbar operations-filter-bar">
    <label>Pool<select value={props.lane} onChange={event => props.onLane(event.target.value)}>{lanes.map(item => <option key={item || "all"} value={item}>{item ? item.toUpperCase() : "Tous"}</option>)}</select></label>
    <label>État tâche<select value={props.status} onChange={event => props.onStatus(event.target.value)}>{statuses.map(item => <option key={item || "all"} value={item}>{item || "Tous"}</option>)}</select></label>
    <button className="secondary-btn" onClick={props.refresh}><Icon name="refresh" size={14}/>Rafraîchir maintenant</button>
    <span className={`agent-runtime-health agent-runtime-health--${props.health.tone}`}>{props.health.label}</span>
  </div>;
}

function AgentRuntimeWarnings({ view }: { view: ReturnType<typeof buildAgentRuntimeViewModel> }) {
  if (!view.warnings.length) return null;
  return <Card className="workspace-panel agent-runtime-warning-panel">
    <header><div><p className="eyebrow">Attention opérateur</p><h2>Points à surveiller</h2></div><StatusTag status={view.health.tone === "critical" ? "open" : "watching"}/></header>
    <div className="tag-list">{view.warnings.map(warning => <span key={warning}>{warning}</span>)}</div>
  </Card>;
}

function AgentRuntimePools({ rows, generatedAt }: { rows: ReturnType<typeof buildAgentRuntimeViewModel>["poolRows"]; generatedAt: string }) {
  return <Card className="workspace-panel agent-runtime-pools">
    <header><div><p className="eyebrow">Pools isolés</p><h2>Responsabilités workers</h2></div><span>{generatedAt}</span></header>
    {!rows.length ? <EmptyWorkspace title="Aucun pool visible" text="Le backend n’a retourné aucun pool agent-runtime. Aucun état n’est fabriqué côté front."/> : <div className="agent-pool-grid">
      {rows.map(pool => <article key={pool.key} className={`agent-pool-card agent-pool-card--${pool.tone}`}>
        <header><div><strong>{pool.label}</strong><small>{pool.lane} · max {pool.maxWorkers}</small></div><StatusTag status={pool.status}/></header>
        <dl><div><dt>Actives</dt><dd>{pool.active}</dd></div><div><dt>Prêtes</dt><dd>{pool.ready}</dd></div><div><dt>Erreurs</dt><dd>{pool.errors}</dd></div><div><dt>Runs</dt><dd>{pool.runRate}</dd></div></dl>
        <p>{pool.responsibilities}</p>
        <footer><span>{pool.cost}</span></footer>
      </article>)}
    </div>}
  </Card>;
}

function AgentRuntimeScheduler({ rows }: { rows: ReturnType<typeof buildAgentRuntimeViewModel>["schedulerRows"] }) {
  return <Card className="workspace-panel agent-runtime-scheduler">
    <header><div><p className="eyebrow">Scheduler live-first</p><h2>Prochaines sélections compute</h2></div><span>{rows.length} lignes</span></header>
    {!rows.length ? <EmptyWorkspace title="Scheduler idle" text="Aucune tâche candidate sélectionnée, différée ou rejetée dans la fenêtre lue."/> : <ol className="agent-scheduler-list">
      {rows.slice(0, 12).map(row => <li key={row.key} data-bucket={row.bucket}><span>{row.bucket}</span><div><strong>{row.label}</strong><small>{row.lane} · priorité {row.priority} · {row.reason}</small></div><time>{row.scheduledFor}</time></li>)}
    </ol>}
  </Card>;
}

function AgentRuntimeTasks({ rows, pending, onCancel }: { rows: AgentRuntimeTaskRow[]; pending: boolean; onCancel: (row: AgentRuntimeTaskRow) => void }) {
  return <Card className="workspace-panel">
    <header className="panel-heading"><div><p className="eyebrow">Tâches durables</p><h2>Ledger agent_tasks</h2></div><span>{rows.length} affichées</span></header>
    {!rows.length ? <EmptyWorkspace title="Aucune tâche agent" text="La base ne contient aucune tâche dans le filtre courant."/> : <div className="data-table-wrap agent-runtime-table"><table className="data-table">
      <thead><tr><th>Tâche</th><th>Pool</th><th>État</th><th>Worker</th><th>Tentatives</th><th>Payload</th><th>Dernier run</th><th>MAJ</th><th>Action</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.key}><td data-label="Tâche"><strong title={row.key}>{row.label}</strong><small>{row.idShort}</small></td><td data-label="Pool">{row.lane}</td><td data-label="État"><StatusTag status={row.status}/></td><td data-label="Worker">{row.worker}</td><td data-label="Tentatives">{row.attempts}</td><td data-label="Payload"><small>{row.payload}</small></td><td data-label="Dernier run">{row.lastRun}</td><td data-label="MAJ">{row.updated}</td><td data-label="Action"><button className="danger-btn" disabled={pending || ["DONE", "ERROR", "CANCELLED", "EXPIRED"].includes(row.status)} onClick={() => onCancel(row)}>Annuler</button></td></tr>)}</tbody>
    </table></div>}
  </Card>;
}

function AgentRuntimeDeadLetters({ rows, pending, onRequeue }: { rows: AgentRuntimeDeadLetterRow[]; pending: boolean; onRequeue: (row: AgentRuntimeDeadLetterRow) => void }) {
  return <Card className="workspace-panel">
    <header><div><p className="eyebrow">Dead letters</p><h2>Recovery opérateur</h2></div><span>{rows.length} ouvertes</span></header>
    {!rows.length ? <EmptyWorkspace title="Aucune DLQ ouverte" text="Aucun recovery agent-runtime n’est requis dans la fenêtre courante."/> : <ul className="agent-dlq-list">{rows.map(row => <li key={row.key}>
      <div><strong title={row.key}>{row.label}</strong><small>{row.idShort} · {row.lane} · {row.created}</small><p>{row.error}</p></div>
      <StatusTag status={row.status}/>
      <button className="primary-btn" disabled={pending || !row.retryable} onClick={() => onRequeue(row)}>{row.retryable ? "Requeue" : "Non retryable"}</button>
    </li>)}</ul>}
  </Card>;
}

function AgentRuntimeMetrics({ rows }: { rows: ReturnType<typeof buildAgentRuntimeViewModel>["metricRows"] }) {
  return <Card className="workspace-panel">
    <header><div><p className="eyebrow">Métriques LLM</p><h2>Latence, tokens et coût</h2></div><span>{rows.length} mesures</span></header>
    {!rows.length ? <EmptyWorkspace title="Aucune métrique récente" text="Les prochains runs Codex écriront ici latence, tokens, modèle et coût."/> : <div className="data-table-wrap agent-runtime-table"><table className="data-table">
      <thead><tr><th>Run</th><th>Worker</th><th>Modèle</th><th>Outcome</th><th>Latence</th><th>Tokens</th><th>Coût</th><th>Fin</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.key}><td data-label="Run"><strong>{row.label}</strong><small>{row.lane}</small></td><td data-label="Worker">{row.worker}</td><td data-label="Modèle">{row.model}</td><td data-label="Outcome"><StatusTag status={row.outcome}/></td><td data-label="Latence">{row.latency}</td><td data-label="Tokens">{row.tokens}</td><td data-label="Coût">{row.cost}</td><td data-label="Fin">{row.finished}</td></tr>)}</tbody>
    </table></div>}
  </Card>;
}

function requestRequeue(row: AgentRuntimeDeadLetterRow, mutate: (input: { row: AgentRuntimeDeadLetterRow; reason: string }) => void) {
  const reason = window.prompt(`Raison du requeue ${row.idShort}`, "Recovery opérateur validé depuis le cockpit Agents IA");
  if (reason && reason.trim().length >= 8) mutate({ row, reason: reason.trim() });
}

function requestCancel(row: AgentRuntimeTaskRow, mutate: (input: { row: AgentRuntimeTaskRow; reason: string }) => void) {
  const reason = window.prompt(`Raison de l’annulation ${row.idShort}`, "Annulation opérateur d’une tâche obsolète depuis le cockpit Agents IA");
  if (reason && reason.trim().length >= 8) mutate({ row, reason: reason.trim() });
}
