import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Card, ErrorView, Icon, LoadingView } from "@/components/common";
import { Breadcrumbs, formatDateTime, PageHeading, PageTabs, StatusTag, TechnicalDetails } from "@/components/operations";
import { useRunbooks } from "@/hooks/useOperations";
import { gptProcessLabel, replayLabel, shortReference, workflowLabel } from "@/lib/presentation";
import type { OperationsRunbook } from "@/operationsTypes";

const operationsTabs = [
  { label: "Cockpit", to: "/operations", end: true },
  { label: "Agents IA", to: "/operations/agents" }, { label: "AI Context", to: "/operations/ai-context" },
  { label: "Portfolio Risk", to: "/operations/portfolio-risk" },
  { label: "Observabilité", to: "/operations/observability" },
  { label: "Incidents", to: "/operations/incidents" },
  { label: "Notifications", to: "/operations/notifications" },
  { label: "Runbooks", to: "/operations/runbooks" },
];

export default function RunbooksPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const paramsKey = params.toString();
  const requestedRunbook = params.get("runbook");
  const contextIncident = params.get("incident");
  const contextProcess = params.get("process");
  const contextWorkflow = params.get("workflow");
  const contextRunId = params.get("run_id") || params.get("runId");
  const hasDeepLinkContext = Boolean(requestedRunbook || contextIncident || contextProcess || contextWorkflow || contextRunId);
  const [status, setStatus] = useState(params.get("status") || (hasDeepLinkContext ? "all" : "action_required"));
  const [kind, setKind] = useState(params.get("kind") || "all");
  const [q, setQ] = useState(params.get("q") || "");
  const filters = useMemo(() => ({
    status: status === "all" ? null : status,
    kind: kind === "all" ? null : kind,
    q: q.trim() || null,
    incident: contextIncident || null,
    process: contextProcess || null,
    workflow: contextWorkflow || null,
    run_id: contextRunId || null,
  }), [contextIncident, contextProcess, contextRunId, contextWorkflow, kind, q, status]);
  const query = useRunbooks(filters);

  useEffect(() => {
    const nextHasContext = Boolean(params.get("runbook") || params.get("incident") || params.get("process") || params.get("workflow") || params.get("run_id") || params.get("runId"));
    setStatus(params.get("status") || (nextHasContext ? "all" : "action_required"));
    setKind(params.get("kind") || "all");
    setQ(params.get("q") || "");
  }, [paramsKey, params]);

  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Runbooks indisponibles"} retry={() => query.refetch()}/>;

  const items = query.data.items;
  const summary = query.data.summary;
  const updateParam = (key: string, value: string) => {
    setParams(current => {
      const next = new URLSearchParams(current);
      value ? next.set(key, value) : next.delete(key);
      return next;
    }, { replace: true });
  };
  const openRunbook = (id: string) => navigate(`/operations/runbooks/${encodeURIComponent(id)}`, {
    state: { returnTo: `/operations/runbooks${paramsKey ? `?${paramsKey}` : ""}` },
  });

  return <section className="view workspace-view runbook-center-view">
    <Breadcrumbs items={[{ label: "Opérations", to: "/operations" }, { label: "Procédures" }]}/>
    <PageHeading
      eyebrow="Runbooks opérateur"
      title="Runbooks opérateur"
      subtitle="Procédures générées depuis les incidents, notifications, workflows et processus GPT réellement persistés."
      backTo="/operations"
      actions={<button className="secondary-btn" onClick={() => query.refetch()}><Icon name="refresh" size={14}/>Actualiser</button>}
      tabs={<PageTabs items={operationsTabs}/>}
    />

    <div className="metric-grid metric-grid--compact runbook-kpis">
      <Card className="metric-card" data-tone={summary.actionRequired ? "negative" : "positive"}><span>Action requise</span><strong>{summary.actionRequired}</strong><small>{summary.critical} critiques</small></Card>
      <Card className="metric-card"><span>Lease</span><strong>{summary.leaseExpired}</strong><small>récupération work item</small></Card>
      <Card className="metric-card"><span>Workflow</span><strong>{summary.workflowBlocked}</strong><small>bloqué / échec</small></Card>
      <Card className="metric-card"><span>GPT</span><strong>{summary.gptFailure}</strong><small>erreurs outil/modèle</small></Card>
      <Card className="metric-card"><span>Qualité données</span><strong>{summary.dataQuality}</strong><small>pack/cutoff/données</small></Card>
    </div>

    {hasDeepLinkContext && <Card className="linked-context-banner">
      <span>Contexte URL</span>
      <strong>{requestedRunbook || contextIncident || contextProcess || contextWorkflow || contextRunId}</strong>
      <small>{contextIncident ? "incident lié" : contextProcess ? "process GPT lié" : contextWorkflow ? "workflow lié" : contextRunId ? "run lié" : "runbook ciblé"}</small>
      <Link to="/operations/runbooks">Réinitialiser</Link>
    </Card>}

    <RunbookPriorityBoard items={items} selected={null} onSelect={openRunbook}/>

    <div className="runbook-layout runbook-layout--ledger">
      <Card className="runbook-ledger-panel">
        <header className="incident-command-toolbar runbook-toolbar">
          <div><p className="eyebrow">Procédures actives</p><h2>{items.length} runbooks</h2></div>
          <div>
            <label>Statut<select value={status} onChange={(event) => { setStatus(event.target.value); updateParam("status", event.target.value); }}><option value="action_required">Action requise</option><option value="waiting">En attente</option><option value="watching">Sous surveillance</option><option value="all">Tous</option></select></label>
            <label>Type<select value={kind} onChange={(event) => { setKind(event.target.value); updateParam("kind", event.target.value === "all" ? "" : event.target.value); }}><option value="all">Tous</option><option value="lease_expired">Lease</option><option value="workflow_blocked">Workflow</option><option value="gpt_failure">Échec GPT</option><option value="telemetry_missing">Télémétrie</option><option value="cost_budget_breach">Budget</option><option value="data_quality_issue">Qualité données</option></select></label>
            <label>Recherche<input value={q} onChange={(event) => { setQ(event.target.value); updateParam("q", event.target.value); }} placeholder="run, incident, worker…"/></label>
          </div>
        </header>
        {!items.length ? <div className="workspace-empty incident-empty"><Icon name="check"/><h3>Aucun runbook actif</h3><p>Les runbooks apparaissent dès qu’un incident, une notification ou un workflow exige une intervention.</p></div> : <div className="data-table-wrap runbook-ledger-wrap">
          <table className="data-table runbook-ledger-table">
            <thead><tr><th>Procédure</th><th>Triage</th><th>Priorité</th><th>Contexte</th><th>Action suivante</th><th>État</th><th>Détail</th></tr></thead>
            <tbody>{items.map((item) => <tr key={item.id} data-kind={item.kind}>
              <td data-label="Runbook"><strong><i data-severity={item.severity}/>{item.title}</strong><small>{kindLabel(item.kind)} · {item.reasonCodes.join(" · ") || item.sourceId}</small></td>
              <td data-label="Triage"><strong>{item.triage?.score ?? item.priority}</strong><small>{triageLabel(item.triage?.queue)} · {formatSla(item.sla)}</small></td>
              <td data-label="Priorité"><span className="terminal-code">{item.priority}</span><small>{item.severity}</small></td>
              <td data-label="Contexte">{item.runId ? replayLabel(item.runId) : item.workflowId ? workflowLabel(item.workflowId) : "Desk"}<small>{item.processId ? gptProcessLabel(item.processId) : item.context.worker ? "Worker attribué" : item.owner || "Local"}</small></td>
              <td data-label="Action suivante">{item.nextAction?.title || "Inspecter"}<small>{item.nextAction?.commandAction || item.nextAction?.kind || "lecture"}</small></td>
              <td data-label="État"><StatusTag status={item.status}/><small>{formatDateTime(item.updatedAt)}</small></td>
              <td data-label="Détail"><Link className="row-link" to={`/operations/runbooks/${encodeURIComponent(item.id)}`} state={{ returnTo: `/operations/runbooks${paramsKey ? `?${paramsKey}` : ""}` }}>Ouvrir <Icon name="arrow" size={13}/></Link></td>
            </tr>)}</tbody>
          </table>
        </div>}
      </Card>

    </div>
  </section>;
}

export function RunbookZoomPage() {
  const { runbookId = "" } = useParams();
  const location = useLocation();
  const id = decodeURIComponent(runbookId);
  const returnTo = ((location.state as { returnTo?: string } | null)?.returnTo) || "/operations/runbooks";
  const query = useRunbooks({ status: null, kind: null, q: null, incident: null, process: null, workflow: null, run_id: null });
  const runbook = query.data?.items.find(item => item.id === id || item.sourceId === id) || null;
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Procédure indisponible"} retry={() => query.refetch()}/>;
  if (!runbook) return <section className="view workspace-view runbook-zoom-view">
    <Breadcrumbs items={[{ label: "Opérations", to: "/operations" }, { label: "Procédures", to: returnTo }, { label: "Introuvable" }]}/>
    <PageHeading eyebrow="Procédure détaillée" title="Procédure introuvable" subtitle="Cette référence ne figure pas dans la fenêtre chargée." backTo={returnTo}/>
  </section>;
  return <section className="view workspace-view runbook-zoom-view">
    <Breadcrumbs items={[{ label: "Opérations", to: "/operations" }, { label: "Procédures", to: returnTo }, { label: runbook.title }]}/>
    <PageHeading eyebrow="Procédure détaillée" title={runbook.title} subtitle={runbook.summary} backTo={returnTo} actions={<><Link className="secondary-btn" to={returnTo}>Retour à la liste</Link><StatusTag status={runbook.status}/></>}/>
    <Card className="runbook-detail-panel runbook-detail-panel--zoom"><RunbookDetail runbook={runbook}/></Card>
  </section>;
}

function RunbookDetail({ runbook }: { runbook: OperationsRunbook }) {
  return <>
    <header className="incident-detail-head runbook-detail-head">
      <div>
        <p className="eyebrow">{kindLabel(runbook.kind)} · prio {runbook.priority}</p>
        <h2>{runbook.title}</h2>
        <p>{runbook.summary}</p>
      </div>
      <StatusTag status={runbook.status}/>
    </header>
    <RunbookPlanPanel runbook={runbook}/>
    <div className="runbook-link-strip">
      {runbook.links.map((link) => <Link className="secondary-btn" key={`${link.kind}:${link.href}`} to={link.href}>{link.label}</Link>)}
    </div>
    <ol className="runbook-steps">
      {runbook.steps.map((step) => <li key={step.id} data-kind={step.kind}>
        <span>{step.index}</span>
        <div><strong>{step.title}</strong><p>{step.description}</p>{step.href && <Link className="row-link" to={step.href}>Ouvrir <Icon name="arrow" size={13}/></Link>}</div>
        <em>{step.commandAction || step.kind}</em>
      </li>)}
    </ol>
    <dl className="incident-evidence-grid runbook-context-grid">
      <div><dt>Incident</dt><dd>{runbook.incidentId ? shortReference(runbook.incidentId) : "N/D"}</dd></div>
      <div><dt>Notification</dt><dd>{runbook.notificationId ? shortReference(runbook.notificationId) : "N/D"}</dd></div>
      <div><dt>Automatisation</dt><dd>{runbook.workflowId ? workflowLabel(runbook.workflowId) : "N/D"}</dd></div>
      <div><dt>Analyse GPT</dt><dd>{runbook.processId ? gptProcessLabel(runbook.processId) : "N/D"}</dd></div>
    </dl>
    <TechnicalDetails items={[
      { label: "Procédure", value: runbook.id },
      { label: "Source", value: runbook.sourceId },
      { label: "Incident", value: runbook.incidentId },
      { label: "Notification", value: runbook.notificationId },
      { label: "Workflow", value: runbook.workflowId },
      { label: "Processus", value: runbook.processId },
    ]}/>
    <section className="incident-timeline-panel">
      <header><p className="eyebrow">Timeline liée</p><span>{runbook.timeline.length} événements</span></header>
      {!runbook.timeline.length ? <p className="empty-copy">Aucun événement source matérialisé.</p> : <ol className="incident-timeline">
        {runbook.timeline.map((event) => <li key={event.id}>
          <time>{formatDateTime(event.at)}</time>
          <i data-severity={event.severity}/>
          <div><strong>{event.type}</strong><p>{event.message || event.title}</p></div>
        </li>)}
      </ol>}
    </section>
  </>;
}

function RunbookPriorityBoard({ items, selected, onSelect }: { items: OperationsRunbook[]; selected: OperationsRunbook | null; onSelect: (id: string) => void }) {
  const active = items.filter((item) => item.status !== "resolved");
  const lanes = {
    page: active.filter((item) => item.triage?.queue === "page").length,
    action: active.filter((item) => item.triage?.queue === "action").length,
    watch: active.filter((item) => item.triage?.queue === "watch").length,
    backlog: active.filter((item) => item.triage?.queue === "backlog").length,
  };
  const top = [...active].sort((a, b) => Number(b.triage?.score || b.priority || 0) - Number(a.triage?.score || a.priority || 0)).slice(0, 5);
  return <Card className="runbook-priority-board" aria-label="Priorisation runbooks">
    <header><div><p className="eyebrow">Priorisation runbooks</p><h2>File d’intervention opérateur</h2></div><span>{active.length} actifs</span></header>
    <div className="incident-triage-lanes runbook-triage-lanes">
      <span data-queue="page">PAGE <strong>{lanes.page}</strong></span>
      <span data-queue="action">ACTION <strong>{lanes.action}</strong></span>
      <span data-queue="watch">SURVEILLANCE <strong>{lanes.watch}</strong></span>
      <span data-queue="backlog">BACKLOG <strong>{lanes.backlog}</strong></span>
    </div>
    <div className="incident-triage-top runbook-priority-top">{top.length ? top.map(item => <button key={item.id} className={selected?.id === item.id ? "active" : ""} onClick={() => onSelect(item.id)}><span>{triageLabel(item.triage?.queue)}</span><strong>{item.title}</strong><em>{item.triage?.score ?? item.priority}</em></button>) : <small>Aucun runbook priorisé.</small>}</div>
  </Card>;
}

function RunbookPlanPanel({ runbook }: { runbook: OperationsRunbook }) {
  return <section className="runbook-plan-panel">
    <header><div><p className="eyebrow">{triageLabel(runbook.triage?.queue)} · score {runbook.triage?.score ?? runbook.priority}</p><h3>Plan d’intervention</h3></div><span>{formatSla(runbook.sla)}</span></header>
    <div className="incident-triage-grid">
      <span>Action suivante <strong>{runbook.nextAction?.title || runbook.triage?.nextAction || "Inspecter"}</strong></span>
      <span>Responsable <strong>{runbook.owner || (runbook.triage?.ownerRequired ? "à assigner" : "desk")}</strong></span>
      <span>Périmètre d’impact <strong>{scopeLabel(runbook.blastRadius?.scope)} · {runbook.blastRadius?.count || 1}</strong></span>
    </div>
    {!!runbook.triage?.reasonCodes?.length && <div className="incident-risk-codes">{runbook.triage.reasonCodes.map(code => <span key={code}>{code}</span>)}</div>}
  </section>;
}

function kindLabel(kind: string) {
  return ({
    lease_expired: "Lease GPT",
    workflow_blocked: "Workflow bloqué",
    gpt_failure: "Échec GPT",
    telemetry_missing: "Télémétrie",
    cost_budget_breach: "Budget GPT",
    data_quality_issue: "Qualité données",
    incident_response: "Incident",
  } as Record<string, string>)[kind] || kind;
}

function triageLabel(value?: string | null) {
  return ({ page: "Page", action: "Action", watch: "Surveillance", backlog: "Backlog", closed: "Clos" } as Record<string, string>)[String(value || "")] || "Triage";
}

function scopeLabel(value?: string | null) {
  return ({ desk: "Desk", run: "Replay", workflow: "Automatisation", session: "Session", worker: "Worker GPT" } as Record<string, string>)[String(value || "").toLowerCase()] || String(value || "Desk");
}

function formatSla(sla?: OperationsRunbook["sla"]) {
  if (!sla || sla.remainingMs === null) return "SLA N/D";
  return `${sla.breached ? "T+" : "T-"}${formatDurationMs(Math.abs(sla.remainingMs))}`;
}

function formatDurationMs(value: number) {
  const minutes = Math.max(0, Math.round(value / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}j`;
}
