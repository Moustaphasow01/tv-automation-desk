import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, Icon, LoadingView, Modal } from "@/components/common";
import { ConfirmActionForm } from "@/components/ConfirmActionForm";
import { Breadcrumbs, formatDateTime, PageHeading, PageTabs, StatusTag, TechnicalDetails } from "@/components/operations";
import { operationsKeys } from "@/hooks/useOperations";
import { gptProcessLabel, replayLabel, shortReference, workflowLabel } from "@/lib/presentation";
import type { Incident, OperationsCommandInput } from "@/operationsTypes";

type IncidentAction = Extract<OperationsCommandInput["action"], "acknowledge" | "assign" | "snooze" | "resolve" | "reopen">;

const actionLabels: Record<IncidentAction, string> = {
  acknowledge: "Acquitter",
  assign: "Assigner",
  snooze: "Reporter",
  resolve: "Résoudre",
  reopen: "Réouvrir",
};

export default function IncidentsPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const contextFilters = useMemo(() => ({
    process: params.get("process") || null,
    run_id: params.get("run_id") || params.get("runId") || null,
    workflow: params.get("workflow") || null,
    target: params.get("target") || null,
  }), [params]);
  const query = useQuery({ queryKey: [...operationsKeys.incidents, contextFilters], queryFn: () => operationsApi.listIncidents(contextFilters), refetchInterval: 30_000 });
  const client = useQueryClient();
  const [status, setStatus] = useState("active");
  const [kind, setKind] = useState("all");
  const [q, setQ] = useState("");
  const sync = useMutation({
    mutationFn: () => operationsApi.evaluateObservabilityIncidents({ autoResolve: true, reason: "Synchronisation manuelle Command Center incidents" }),
    onSuccess: async () => client.invalidateQueries({ queryKey: operationsKeys.all }),
  });

  const items = query.data?.items || [];
  const filtered = useMemo(() => {
    const search = q.trim().toLowerCase();
    return items.filter((incident) => {
      if (kind !== "all" && incident.kind !== kind) return false;
      if (status === "active" && ["resolved", "archived"].includes(incident.lifecycleStatus)) return false;
      if (status !== "active" && status !== "all" && incident.lifecycleStatus !== status) return false;
      if (!search) return true;
      return [incident.id, incident.title, incident.message, incident.kind, incident.guardrailType, incident.runId, incident.processId, incident.workflow, incident.owner]
        .filter(Boolean).join(" ").toLowerCase().includes(search);
    });
  }, [items, kind, q, status]);

  useEffect(() => {
    const requested = params.get("incident");
    if (!requested) return;
    const next = new URLSearchParams(params);
    next.delete("incident");
    const returnTo = `/operations/incidents${next.toString() ? `?${next.toString()}` : ""}`;
    navigate(`/operations/incidents/${encodeURIComponent(requested)}`, { replace: true, state: { returnTo } });
  }, [navigate, params]);

  const summary = query.data?.summary || summarize(items);
  const triage = query.data?.triage || summarizeTriage(items);
  const returnTo = `${location.pathname}${location.search}`;

  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Incidents indisponibles"} retry={() => query.refetch()}/>;

  const openIncidentById = (id: string) => navigate(`/operations/incidents/${encodeURIComponent(id)}`, { state: { returnTo } });
  const openIncident = (incident: Incident) => openIncidentById(incident.id);

  return <section className="view workspace-view incident-command-view">
    <Breadcrumbs items={[{ label: "Opérations", to: "/operations" }, { label: "Incidents", to: "/operations/incidents" }]}/>
    <PageHeading
      eyebrow="Incident Command"
      title="Centre incidents"
      subtitle="Alertes, erreurs et guardrails matérialisés avec evidence, ownership et timeline."
      backTo="/operations"
      actions={<button className="secondary-btn" onClick={() => sync.mutate()} disabled={sync.isPending}><Icon name="refresh" size={14}/>{sync.isPending ? "Sync…" : "Évaluer guardrails"}</button>}
      tabs={<PageTabs items={[{ label: "Cockpit", to: "/operations", end: true }, { label: "Agents IA", to: "/operations/agents" }, { label: "AI Context", to: "/operations/ai-context" }, { label: "Portfolio Risk", to: "/operations/portfolio-risk" }, { label: "Observabilité", to: "/operations/observability" }, { label: "Incidents", to: "/operations/incidents" }, { label: "Notifications", to: "/operations/notifications" }, { label: "Runbooks", to: "/operations/runbooks" }]}/>}
    />

    <div className="metric-grid metric-grid--compact incident-command-kpis">
      <Card className="metric-card" data-tone={summary.page ? "negative" : "positive"}><span>Page queue</span><strong>{summary.page || 0}</strong><small>{summary.critical} critiques</small></Card>
      <Card className="metric-card"><span>Action queue</span><strong>{summary.action || 0}</strong><small>{summary.open} actifs</small></Card>
      <Card className="metric-card" data-tone={summary.slaBreached ? "negative" : "positive"}><span>SLA breach</span><strong>{summary.slaBreached || 0}</strong><small>priorité temps réel</small></Card>
      <Card className="metric-card"><span>Sans owner</span><strong>{summary.unowned || 0}</strong><small>{summary.acknowledged} acquittés</small></Card>
      <Card className="metric-card"><span>Guardrails</span><strong>{summary.guardrails}</strong><small>{sync.data ? `${sync.data.active} signaux actifs` : "SLA, leases, budgets"}</small></Card>
      <Card className="metric-card"><span>Résolus</span><strong>{summary.resolved}</strong><small>Historique conservé</small></Card>
    </div>

    <IncidentTriageBoard triage={triage} selectedId={null} onOpen={openIncidentById}/>

    <div className="incident-command-layout incident-command-layout--ledger">
      <Card className="incident-ledger-panel">
        <header className="incident-command-toolbar">
          <div>
            <p className="eyebrow">Ledger</p>
            <h2>{filtered.length} incidents</h2>
          </div>
          <div>
            <label>Statut<select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filtrer par statut"><option value="active">Actifs</option><option value="open">Ouverts</option><option value="acknowledged">Acquittés</option><option value="snoozed">Reportés</option><option value="resolved">Résolus</option><option value="all">Tous</option></select></label>
            <label>Source<select value={kind} onChange={(event) => setKind(event.target.value)} aria-label="Filtrer par source"><option value="all">Toutes</option><option value="guardrail">Guardrails</option><option value="alert">Alertes</option><option value="error">Erreurs</option><option value="data_quality">Data quality</option></select></label>
            <label>Recherche<input value={q} onChange={(event) => setQ(event.target.value)} placeholder="run, worker, titre…" aria-label="Rechercher un incident"/></label>
          </div>
        </header>
        {!filtered.length ? <div className="workspace-empty incident-empty"><Icon name="check"/><h3>Aucun incident dans ce filtre</h3><p>Les guardrails peuvent être matérialisés via l’évaluation manuelle ou le scheduler local.</p></div> : <div className="data-table-wrap incident-ledger-wrap">
          <table className="data-table incident-ledger-table">
            <thead><tr><th>Incident</th><th>Triage</th><th>Signal</th><th>Owner</th><th>SLA</th><th>État</th><th>Zoom</th></tr></thead>
            <tbody>{filtered.map((incident) => <tr key={incident.id} data-severity={incident.severity} tabIndex={0} onClick={() => openIncident(incident)} onKeyDown={event => event.key === "Enter" && openIncident(incident)}>
              <td data-label="Incident"><strong><i data-severity={incident.severity}/>{incident.title}</strong><small>{kindLabel(incident.kind)} · {incident.runId ? replayLabel(incident.runId) : shortReference(incident.targetId || incident.sourceId)}</small></td>
              <td data-label="Triage"><strong>{incident.triage?.score ?? "—"}</strong><small>{triageLabel(incident.triage?.queue)} · {actionLabel(incident.triage?.nextAction)}</small></td>
              <td data-label="Signal"><span className="terminal-code">{incident.guardrailType || incident.kind}</span><small>{formatValue(incident.observedValue, incident.unit)} / {formatValue(incident.thresholdValue, incident.unit)}</small></td>
              <td data-label="Owner">{incident.owner || "Non assigné"}<small>{incident.workflow || incident.worker || "desk"}</small></td>
              <td data-label="SLA">{formatSla(incident.sla)}<small>{formatDateTime(incident.sla?.dueAt || incident.updatedAt)}</small></td>
              <td data-label="État"><StatusTag status={incident.lifecycleStatus}/></td>
              <td data-label="Zoom"><Link className="row-link" to={`/operations/incidents/${encodeURIComponent(incident.id)}`} state={{ returnTo }} onClick={event => event.stopPropagation()}>Ouvrir <Icon name="arrow" size={13}/></Link></td>
            </tr>)}</tbody>
          </table>
        </div>}
      </Card>
    </div>
  </section>;
}

export function IncidentZoomPage() {
  const { incidentId = "" } = useParams();
  const location = useLocation();
  const client = useQueryClient();
  const id = decodeURIComponent(incidentId);
  const returnTo = ((location.state as { returnTo?: string } | null)?.returnTo) || "/operations/incidents";
  const query = useQuery({ queryKey: [...operationsKeys.incidents, "detail", id], queryFn: () => operationsApi.listIncidents({}), refetchInterval: 30_000 });
  const incident = query.data?.items.find(item => item.id === id || item.sourceId === id) || null;
  const [commandOpen, setCommandOpen] = useState(false);
  const [action, setAction] = useState<IncidentAction>("acknowledge");
  const [owner, setOwner] = useState("");
  const [snoozeMinutes, setSnoozeMinutes] = useState(60);
  const expected = `CONFIRM_${action.toUpperCase()}`;
  const command = useMutation({
    mutationFn: (input: OperationsCommandInput) => operationsApi.executeIncidentAction(incident!.id, input),
    onSuccess: async () => {
      setCommandOpen(false);
      await client.invalidateQueries({ queryKey: operationsKeys.all });
    },
  });

  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Incident indisponible"} retry={() => query.refetch()}/>;
  if (!incident) return <section className="view workspace-view incident-command-view incident-zoom-view">
    <Breadcrumbs items={[{ label: "Opérations", to: "/operations" }, { label: "Incidents", to: "/operations/incidents" }, { label: "Introuvable" }]}/>
    <PageHeading eyebrow="Incident Command" title="Incident introuvable" subtitle={id} backTo={returnTo} actions={<Link className="secondary-btn" to={returnTo}>Retour au ledger</Link>}/>
    <Card className="workspace-empty incident-empty"><Icon name="alert"/><h3>Aucun incident trouvé</h3><p>Le ledger local ne contient pas cet identifiant dans la fenêtre chargée.</p></Card>
  </section>;

  const openCommand = (_incident: Incident, nextAction: IncidentAction) => {
    setAction(nextAction);
    setOwner(incident.owner || "");
    setSnoozeMinutes(60);
    setCommandOpen(true);
  };

  return <section className="view workspace-view incident-command-view incident-zoom-view">
    <Breadcrumbs items={[{ label: "Opérations", to: "/operations" }, { label: "Incidents", to: returnTo }, { label: incident.title }]}/>
    <PageHeading
      eyebrow={`${kindLabel(incident.kind)} · détail incident`}
      title={incident.title}
      subtitle={incident.message || "Incident sans message complémentaire"}
      backTo={returnTo}
      actions={<><Link className="secondary-btn" to={returnTo}>Retour au ledger</Link><StatusTag status={incident.lifecycleStatus}/></>}
      tabs={<PageTabs items={[{ label: "Cockpit", to: "/operations", end: true }, { label: "Agents IA", to: "/operations/agents" }, { label: "AI Context", to: "/operations/ai-context" }, { label: "Portfolio Risk", to: "/operations/portfolio-risk" }, { label: "Observabilité", to: "/operations/observability" }, { label: "Incidents", to: "/operations/incidents" }, { label: "Notifications", to: "/operations/notifications" }, { label: "Runbooks", to: "/operations/runbooks" }]}/>}
    />
    <div className="metric-grid metric-grid--compact incident-command-kpis incident-zoom-kpis">
      <Card className="metric-card" data-tone={incident.severity === "critical" ? "negative" : "warning"}><span>Sévérité</span><strong>{severityLabel(incident.severity)}</strong><small>{kindLabel(incident.kind)}</small></Card>
      <Card className="metric-card"><span>Triage</span><strong>{incident.triage?.score ?? "—"}</strong><small>{triageLabel(incident.triage?.queue)} · {actionLabel(incident.triage?.nextAction)}</small></Card>
      <Card className="metric-card" data-tone={incident.sla?.breached ? "negative" : "positive"}><span>SLA</span><strong>{formatSla(incident.sla)}</strong><small>{formatDateTime(incident.sla?.dueAt || incident.updatedAt)}</small></Card>
      <Card className="metric-card"><span>Occurrences</span><strong>{incident.occurrenceCount || 1}</strong><small>rev {incident.revision}</small></Card>
    </div>
    <Card className="incident-detail-panel incident-zoom-panel">
      <IncidentDetail incident={incident} onCommand={openCommand}/>
    </Card>

    <Modal open={commandOpen} title={`${actionLabels[action]} · ${incident.title}`} onClose={() => !command.isPending && setCommandOpen(false)}>
      <>
        <label className="confirm-action__action">Action
          <select value={action} onChange={(event) => setAction(event.target.value as IncidentAction)}>
            <option value="acknowledge">Acquitter</option><option value="assign">Assigner</option><option value="snooze">Reporter</option><option value="resolve">Résoudre</option><option value="reopen">Réouvrir</option>
          </select>
        </label>
        <ConfirmActionForm
          key={`${incident.id}:${action}`}
          target={incident.title}
          revision={incident.revision}
          expectedPhrase={expected}
          onCancel={() => setCommandOpen(false)}
          danger={action === "resolve" || action === "reopen"}
          confirmLabel={actionLabels[action]}
          validateExtra={() => !["acknowledge", "assign"].includes(action) || owner.trim().length >= 2}
          onConfirm={({ confirmationPhrase, reason }) => {
            const snoozedUntilUtc = action === "snooze" ? new Date(Date.now() + Math.max(5, snoozeMinutes) * 60_000).toISOString() : undefined;
            return command.mutateAsync({
              action,
              reason,
              confirmationPhrase,
              idempotencyKey: crypto.randomUUID(),
              expectedRevision: incident.revision,
              owner: ["acknowledge", "assign"].includes(action) ? owner.trim() : undefined,
              snoozedUntilUtc,
            }).then(() => undefined);
          }}
        >
          {["acknowledge", "assign"].includes(action) && <label>Responsable<input value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="desk-operator, email, équipe…" required/></label>}
          {action === "snooze" && <label>Durée du report<input type="number" min={5} max={1440} value={snoozeMinutes} onChange={(event) => setSnoozeMinutes(Number(event.target.value) || 60)}/><small>{snoozeMinutes} minutes</small></label>}
        </ConfirmActionForm>
      </>
    </Modal>
  </section>;
}

function IncidentDetail({ incident, onCommand }: { incident: Incident; onCommand: (incident: Incident, action: IncidentAction) => void }) {
  const active = !["resolved", "archived"].includes(incident.lifecycleStatus);
  const timeline = incident.timeline || [];
  return <>
    <header className="incident-detail-head">
      <div>
        <p className="eyebrow">{kindLabel(incident.kind)} · rev {incident.revision}</p>
        <h2>{incident.title}</h2>
        <p>{incident.message || "Aucun message détaillé."}</p>
      </div>
      <StatusTag status={incident.lifecycleStatus}/>
    </header>
    <IncidentTriagePanel incident={incident} onCommand={onCommand}/>
    <div className="incident-action-strip">
      {active && <button className="secondary-btn" onClick={() => onCommand(incident, "acknowledge")}>Acquitter</button>}
      {active && <button className="secondary-btn" onClick={() => onCommand(incident, "assign")}>Assigner</button>}
      {active && <button className="secondary-btn" onClick={() => onCommand(incident, "snooze")}>Reporter</button>}
      {active ? <button className="danger-btn" onClick={() => onCommand(incident, "resolve")}>Résoudre</button> : <button className="secondary-btn" onClick={() => onCommand(incident, "reopen")}>Réouvrir</button>}
    </div>
    <dl className="incident-evidence-grid">
      <div><dt>Mesure</dt><dd>{formatValue(incident.observedValue, incident.unit)}</dd></div>
      <div><dt>Seuil</dt><dd>{formatValue(incident.thresholdValue, incident.unit)}</dd></div>
      <div><dt>Politique</dt><dd>{incident.policyRevision ?? "N/D"}</dd></div>
      <div><dt>Responsable</dt><dd>{incident.owner || "Non assigné"}</dd></div>
      <div><dt>Replay</dt><dd>{incident.runId ? <Link to={`/replay/runs/${encodeURIComponent(incident.runId)}`}>{replayLabel(incident.runId)}</Link> : "N/D"}</dd></div>
      <div><dt>Analyse GPT</dt><dd>{incident.processId && incident.runId ? <Link to={`/replay/runs/${encodeURIComponent(incident.runId)}/gpt/${encodeURIComponent(incident.processId)}`}>{gptProcessLabel(incident.processId)}</Link> : incident.processId ? gptProcessLabel(incident.processId) : "N/D"}</dd></div>
      <div><dt>Automatisation</dt><dd>{incident.workflow ? workflowLabel(incident.workflow) : "N/D"}</dd></div>
      <div><dt>Prise en charge</dt><dd>{incident.worker ? "Worker attribué" : "Non attribué"}</dd></div>
    </dl>
    <TechnicalDetails items={[
      { label: "Incident", value: incident.id },
      { label: "Source", value: incident.sourceId },
      { label: "Run", value: incident.runId },
      { label: "Processus", value: incident.processId },
      { label: "Workflow", value: incident.workflow },
      { label: "Worker", value: incident.worker },
      { label: "Empreinte", value: incident.fingerprint },
    ]}/>
    <div className="incident-link-strip">
      <Link to={`/operations/runbooks?incident=${encodeURIComponent(incident.id)}&status=all`}>Runbooks liés</Link>
      {incident.processId && <Link to={`/operations/observability?process=${encodeURIComponent(incident.processId)}`}>Observabilité process</Link>}
      {incident.runId && <Link to={`/operations/workflows/${encodeURIComponent(`replay:${incident.runId}`)}`}>Workflow parent</Link>}
      {incident.links?.map(link => <Link key={`${link.kind}:${link.href}`} to={link.href}>{link.label}</Link>)}
    </div>
    <section className="incident-policy-evidence">
      <header><p className="eyebrow">Preuves de la règle</p><span>{incident.fingerprint?.slice(0, 12) || "sans-empreinte"}</span></header>
      <pre>{JSON.stringify(incident.policySnapshot || incident.evidence || {}, null, 2)}</pre>
    </section>
    <section className="incident-timeline-panel">
      <header><p className="eyebrow">Chronologie</p><span>{timeline.length} événements</span></header>
      {!timeline.length ? <p className="empty-copy">Aucun événement matérialisé.</p> : <ol className="incident-timeline">
        {timeline.map((event) => <li key={event.id}>
          <time>{formatDateTime(event.at)}</time>
          <i data-severity={event.severity}/>
          <div><strong>{event.type}</strong><p>{event.message || event.title}</p></div>
        </li>)}
      </ol>}
    </section>
  </>;
}

function IncidentTriageBoard({ triage, selectedId, onOpen }: { triage: NonNullable<ReturnType<typeof summarizeTriage>>; selectedId: string | null; onOpen: (id: string) => void }) {
  return <Card className="incident-triage-board" aria-label="Triage opérateur">
    <header><div><p className="eyebrow">Triage opérateur</p><h2>File priorisée incidents</h2></div><span>{triage.active} actifs · {triage.closed} clos</span></header>
    <div className="incident-triage-lanes">
      <span data-queue="page">PAGE <strong>{triage.page}</strong></span>
      <span data-queue="action">ACTION <strong>{triage.action}</strong></span>
      <span data-queue="watch">WATCH <strong>{triage.watch}</strong></span>
      <span data-queue="backlog">BACKLOG <strong>{triage.backlog}</strong></span>
    </div>
    <div className="incident-triage-top">{triage.top.length ? triage.top.map(item => <button key={item.id} className={selectedId === item.id ? "active" : ""} onClick={() => onOpen(item.id)}><span>{triageLabel(item.queue)}</span><strong>{item.title}</strong><em>{item.score}</em></button>) : <small>Aucune alerte active priorisée.</small>}</div>
  </Card>;
}

function IncidentTriagePanel({ incident, onCommand }: { incident: Incident; onCommand: (incident: Incident, action: IncidentAction) => void }) {
  const triage = incident.triage;
  return <section className="incident-triage-panel">
    <header><div><p className="eyebrow">Décision opérateur</p><h3>{triageLabel(triage?.queue)} · score {triage?.score ?? "—"}</h3></div><span>{formatSla(incident.sla)}</span></header>
    <div className="incident-triage-grid">
      <span>Action suivante <strong>{actionLabel(triage?.nextAction)}</strong></span>
      <span>Périmètre d’impact <strong>{scopeLabel(incident.blastRadius?.scope)} · {incident.blastRadius?.count || 1}</strong></span>
      <span>Responsable <strong>{incident.owner || "à assigner"}</strong></span>
    </div>
    {!!triage?.reasonCodes?.length && <div className="incident-risk-codes">{triage.reasonCodes.map(code => <span key={code}>{code}</span>)}</div>}
    {!!incident.recommendedActions?.length && <div className="incident-recommended-actions">{incident.recommendedActions.slice(0, 3).map(item => <button key={item.action} onClick={() => onCommand(incident, item.action as IncidentAction)} data-tone={item.tone}><strong>{item.label}</strong><small>{item.reason}</small></button>)}</div>}
  </section>;
}

function summarize(items: Incident[]) {
  const open = items.filter((item) => !["resolved", "archived"].includes(item.lifecycleStatus));
  return {
    open: open.length,
    critical: open.filter((item) => item.severity === "critical").length,
    warning: open.filter((item) => item.severity === "warning").length,
    acknowledged: items.filter((item) => item.lifecycleStatus === "acknowledged").length,
    snoozed: items.filter((item) => item.lifecycleStatus === "snoozed").length,
    resolved: items.filter((item) => item.lifecycleStatus === "resolved").length,
    guardrails: items.filter((item) => item.kind === "guardrail").length,
    unowned: open.filter((item) => !item.owner).length,
    slaBreached: open.filter((item) => item.sla?.breached).length,
    page: open.filter((item) => item.triage?.queue === "page").length,
    action: open.filter((item) => item.triage?.queue === "action").length,
  };
}

function severityLabel(value?: string | null) {
  return ({ critical: "Critique", warning: "Avertissement", info: "Information" } as Record<string, string>)[String(value || "").toLowerCase()] || String(value || "N/D");
}

function scopeLabel(value?: string | null) {
  return ({ desk: "Desk", run: "Replay", workflow: "Automatisation", session: "Session", worker: "Worker GPT" } as Record<string, string>)[String(value || "").toLowerCase()] || String(value || "Desk");
}

function summarizeTriage(items: Incident[]) {
  const active = items.filter((item) => !["resolved", "archived"].includes(item.lifecycleStatus));
  return {
    active: active.length,
    page: active.filter((item) => item.triage?.queue === "page").length,
    action: active.filter((item) => item.triage?.queue === "action").length,
    watch: active.filter((item) => item.triage?.queue === "watch").length,
    backlog: active.filter((item) => item.triage?.queue === "backlog").length,
    closed: items.length - active.length,
    top: active.sort((a, b) => Number(b.triage?.score || 0) - Number(a.triage?.score || 0)).slice(0, 5).map((item) => ({ id: item.id, title: item.title, score: item.triage?.score || 0, queue: item.triage?.queue || "backlog", href: `/operations/incidents?incident=${encodeURIComponent(item.id)}` })),
  };
}

function kindLabel(kind: string) {
  if (kind === "guardrail") return "Guardrail";
  if (kind === "data_quality") return "Data quality";
  if (kind === "error") return "Erreur";
  return "Alerte";
}

function formatAge(value?: string | null) {
  const at = Date.parse(value || "");
  if (!Number.isFinite(at)) return "N/D";
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}j`;
}

function triageLabel(value?: string | null) {
  return ({ page: "Page", action: "Action", watch: "Watch", backlog: "Backlog", closed: "Clos" } as Record<string, string>)[String(value || "")] || "Triage";
}

function actionLabel(value?: string | null) {
  return ({ assign: "Assigner", acknowledge: "Acquitter", snooze: "Reporter", resolve: "Résoudre", reopen: "Réouvrir", watch: "Surveiller" } as Record<string, string>)[String(value || "")] || "Inspecter";
}

function formatSla(sla?: Incident["sla"]) {
  if (!sla || sla.remainingMs === null) return "SLA N/D";
  const prefix = sla.breached ? "T+" : "T-";
  return `${prefix}${formatDurationMs(Math.abs(sla.remainingMs))}`;
}

function formatDurationMs(value: number) {
  const minutes = Math.max(0, Math.round(value / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}j`;
}

function formatValue(value?: number | null, unit?: string | null) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "N/D";
  if (unit === "ms") {
    const seconds = Math.round(Number(value) / 1000);
    return Math.abs(seconds) >= 60 ? `${Math.round(seconds / 60)}m` : `${seconds}s`;
  }
  if (unit === "usd") return `$${Number(value).toFixed(4)}`;
  if (unit === "percent") return `${Number(value).toFixed(0)}%`;
  return `${Number(value).toLocaleString("fr-FR")} ${unit || ""}`.trim();
}
