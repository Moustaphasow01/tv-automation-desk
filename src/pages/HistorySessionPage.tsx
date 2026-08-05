import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { Card, ErrorView, Icon, LoadingView } from "@/components/common";
import { Breadcrumbs, EventTimeline, formatDateTime, formatDuration, MetricCard, MetricStrip, PageHeading, StatusTag, TechnicalDetails, WorkflowTable } from "@/components/operations";
import { operationsKeys } from "@/hooks/useOperations";
import type { HistoryAuditItem, HistoryDecisionFlowItem, HistoryMatrixItem, HistorySessionDetail, OperationsEvent } from "@/operationsTypes";

export default function HistorySessionPage() {
  const { sessionId = "" } = useParams();
  const id = decodeURIComponent(sessionId);
  const query = useQuery({ queryKey: operationsKeys.historySession(id), queryFn: () => operationsApi.getHistorySession(id), enabled: Boolean(id) });
  const [selected, setSelected] = useState<OperationsEvent | null>(null);
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Session historique introuvable"} retry={() => query.refetch()}/>;

  const data = query.data;
  const session = data.session;
  const totals = data.summary;
  const activeEvent = selected || data.timeline.at(-1) || null;
  return <section className="view workspace-view history-session-v3">
    <Breadcrumbs items={[{ label: "Historique", to: "/history" }, { label: session.tradingDate || id }, { label: sessionLabel(session.session) }]}/>
    <PageHeading eyebrow="Archive détaillée" title={`${session.tradingDate || "Date inconnue"} · ${sessionLabel(session.session)}`} subtitle="Lecture consolidée persistante" backTo="/history" actions={<><StatusTag status={session.status}/><Link className="secondary-btn" to={`/operations?session=${encodeURIComponent(session.session || "")}`}>Voir les automatisations</Link></>}/>

    <MetricStrip className="metric-grid--compact history-kpi-strip">
      <MetricCard label="Workflows" value={totals.workflows} detail={`${totals.completed} terminés`}/>
      <MetricCard label="Progression" value={`${totals.progress}%`} detail={`${totals.running} actifs`}/>
      <MetricCard label="Résultat" value={formatR(totals.totalR)} tone={totals.totalR >= 0 ? "positive" : "critical"}/>
      <MetricCard label="Processus GPT" value={totals.gptProcesses} detail={`${totals.waitingGpt} en attente`}/>
      <MetricCard label="Incidents" value={totals.incidents} detail={`${totals.failed} échecs · ${totals.blocked} bloqués`} tone={totals.incidents || totals.failed ? "warning" : "neutral"}/>
      <MetricCard label="Événements" value={totals.events} detail={formatDuration(session.durationMs)}/>
    </MetricStrip>

    <div className="replay-session-context-strip">
      <span>STRATÉGIES <strong>{session.strategies.join(", ") || "—"}</strong></span><span>TYPES <strong>{session.kinds.join(", ") || "—"}</strong></span><span>PREMIER ÉVÉNEMENT <strong>{formatDateTime(session.startedAt)}</strong></span><span>SOURCE <strong>PostgreSQL</strong></span>
    </div>
    <TechnicalDetails items={[{ label: "Session", value: id }]}/>

    <HistorySessionCommandConsole data={data}/>

    <div className="history-session-workbench">
      <section className="replay-terminal-section history-session-workflows">
        <header><div><p className="eyebrow">Exécutions persistées</p><h2>Workflows de la session</h2></div><span>{data.workflows.length} workflows</span></header>
        <WorkflowTable items={data.workflows}/>
      </section>
      <aside className="history-session-rail">
        <Card className="history-event-inspector">
          <header><div><p className="eyebrow">Dernier événement</p><h2>{activeEvent?.title || "Aucune activité"}</h2></div>{activeEvent && <StatusTag status={activeEvent.status}/>}</header>
          {activeEvent ? <><div className="replay-event-inspector__meta"><span>HEURE <strong>{formatDateTime(activeEvent.at)}</strong></span><span>WORKFLOW <strong>{activeEvent.workflowName || "—"}</strong></span><span>COUCHE <strong>{activeEvent.layer || activeEvent.type}</strong></span></div><p>{activeEvent.conclusion || activeEvent.detail || activeEvent.decision || "Transition persistée."}</p></> : <TerminalEmpty code="NO_EVENT" text="Aucun événement lié à ces workflows."/>}
        </Card>

        <Card className="history-performance-rail">
          <header><div><p className="eyebrow">Performance du scope</p><h2>{formatR(data.performance.totals.totalR)}</h2></div><span className="terminal-counter">{data.performance.totals.trades} trades</span></header>
          <div className="history-rail-stats"><span>Win rate <strong>{data.performance.totals.winRate === null ? "—" : `${(data.performance.totals.winRate * 100).toFixed(1)}%`}</strong></span><span>Expectancy <strong>{data.performance.totals.expectancyR === null ? "—" : formatR(data.performance.totals.expectancyR)}</strong></span><span>Max DD <strong>{formatR(data.performance.totals.maxDrawdownR)}</strong></span></div>
        </Card>

        <Card className="replay-gpt-rail">
          <header><div><p className="eyebrow">Orchestration IA</p><h2>Processus GPT</h2></div><span className="terminal-counter">{data.gptProcesses.length}</span></header>
          {!data.gptProcesses.length ? <TerminalEmpty code="NO_GPT_PROCESS" text="Aucun processus GPT lié."/> : <div className="replay-gpt-process-list">{data.gptProcesses.map(process => <Link key={process.id} to={process.runId ? `/replay/runs/${encodeURIComponent(process.runId)}/gpt/${encodeURIComponent(process.id)}` : "/operations"}>
            <span className="replay-gpt-process-list__index">{String(process.attempt).padStart(2, "0")}</span><div><strong>{process.workflow}</strong><small>{process.conclusion || process.decision || process.rawStatus}</small></div><StatusTag status={process.status}/>
          </Link>)}</div>}
        </Card>

        <Card className="history-incident-rail">
          <header><div><p className="eyebrow">Surveillance</p><h2>Incidents liés</h2></div><Link className="row-link" to="/operations/incidents">Tous <Icon name="arrow" size={12}/></Link></header>
          {!data.incidents.length ? <TerminalEmpty code="NO_INCIDENT" text="Aucun incident sur ce scope."/> : <div className="history-incident-list">{data.incidents.map(incident => <div key={incident.id}><i data-severity={incident.severity}/><span><strong>{incident.title}</strong><small>{incident.message || incident.kind}</small></span><StatusTag status={incident.lifecycleStatus}/></div>)}</div>}
        </Card>
      </aside>
    </div>

    <section id="timeline-events" className="replay-terminal-section history-timeline">
      <header><div><p className="eyebrow">Journal consolidé</p><h2>Timeline de la session</h2></div><span>{data.timeline.length} transitions · tous workflows</span></header>
      <EventTimeline events={data.timeline} selectedId={activeEvent?.id} onSelect={setSelected}/>
    </section>
  </section>;
}

function HistorySessionCommandConsole({ data }: { data: HistorySessionDetail }) {
  return <section className="history-session-command-console" aria-label="Console audit de session">
    <Card className="history-session-matrix-panel">
      <header><div><p className="eyebrow">Contrôle de scope</p><h2>Couverture workflow</h2></div><span className="terminal-counter">{data.session.automationScore}%</span></header>
      <div className="history-session-matrix-grid">
        <HistoryMiniMatrix title="États" items={data.matrix.statuses}/>
        <HistoryMiniMatrix title="GPT" items={data.matrix.gptStatuses}/>
        <HistoryMiniMatrix title="Événements" items={data.matrix.eventLayers}/>
      </div>
      <div className="history-session-linkbar">{data.links.map(link => <Link key={`${link.kind}:${link.href}`} to={link.href}><Icon name={link.kind === "gpt" ? "brain" : link.kind === "performance" ? "chart" : "arrow"} size={13}/>{link.label}</Link>)}</div>
    </Card>

    <Card className="history-decision-flow-panel">
      <header><div><p className="eyebrow">Processus IA</p><h2>Flux décisionnel GPT</h2></div><span>{data.decisionFlow.length} transitions</span></header>
      <HistoryDecisionFlow items={data.decisionFlow}/>
    </Card>

    <Card className="history-session-audit-panel">
      <header><div><p className="eyebrow">Journal preuve</p><h2>Audit trail session</h2></div><span>{data.auditTrail.length} preuves</span></header>
      <HistorySessionAudit items={data.auditTrail}/>
    </Card>
  </section>;
}

function HistoryMiniMatrix({ title, items }: { title: string; items: HistoryMatrixItem[] }) {
  return <div className="history-mini-matrix"><h3>{title}</h3>{!items.length ? <small>—</small> : items.slice(0, 4).map(item => {
    const body = <><span>{label(item.label)}</span><strong>{item.count}</strong><small>{item.gptProcesses} GPT · {item.incidents} inc.</small></>;
    return item.href && !item.href.startsWith("#") ? <Link key={item.label} data-tone={item.tone} to={item.href}>{body}</Link> : <div key={item.label} data-tone={item.tone}>{body}</div>;
  })}</div>;
}

function HistoryDecisionFlow({ items }: { items: HistoryDecisionFlowItem[] }) {
  if (!items.length) return <TerminalEmpty code="NO_DECISION_FLOW" text="Aucun événement décisionnel GPT matérialisé." />;
  return <ol className="history-decision-flow">{items.slice(-10).map(item => <li key={item.id} data-layer={item.layer}>
    <time>{formatDateTime(item.at)}</time><i aria-hidden="true"/><div><div><strong>{item.decision || item.title}</strong><StatusTag status={item.status}/></div><p>{item.conclusion || item.detail || item.type}</p><small>{item.workflowName || item.workflowId || "workflow"}{item.telemetry?.model ? ` · ${item.telemetry.model}` : ""}{item.telemetry?.totalTokens ? ` · ${item.telemetry.totalTokens} tokens` : ""}</small>{item.href && <Link className="row-link" to={item.href}>Inspecter <Icon name="arrow" size={12}/></Link>}</div>
  </li>)}</ol>;
}

function HistorySessionAudit({ items }: { items: HistoryAuditItem[] }) {
  if (!items.length) return <TerminalEmpty code="NO_AUDIT_TRAIL" text="Aucun audit lié à cette session." />;
  return <div className="history-session-audit-list">{items.slice(0, 8).map(item => {
    const body = <><time>{formatDateTime(item.at)}</time><span><strong>{item.title}</strong><small>{item.type} · {item.actor}</small></span><StatusTag status={item.status}/></>;
    return item.href ? <Link key={item.id} to={item.href} data-severity={item.severity}>{body}</Link> : <div key={item.id} data-severity={item.severity}>{body}</div>;
  })}</div>;
}

function TerminalEmpty({ code: _code, text }: { code: string; text: string }) {
  return <div className="terminal-empty-state terminal-empty-state--human"><span>{text}</span></div>;
}
function sessionLabel(value?: string | null) { return value === "asia_open" ? "Session Asie" : value === "ny_open" ? "Session New York" : value?.replaceAll("_", " ") || "Journée globale"; }
function label(value?: string | null) { return value?.replaceAll("_", " ").toUpperCase() || "—"; }
function formatR(value: number) { return `${value > 0 ? "+" : ""}${Number(value || 0).toFixed(2)} R`; }
