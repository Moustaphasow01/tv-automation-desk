import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, ErrorView, Icon, LoadingView } from "@/components/common";
import { Breadcrumbs, EventTimeline, formatDateTime, formatTime, MetricCard, MetricStrip, PageHeading, StatusTag } from "@/components/operations";
import { useOperationsEvents, useReplayDay, useReplaySession } from "@/hooks/useOperations";
import { shortReference } from "@/lib/presentation";
import type { OperationsEvent, ReplayDayDetail, WorkflowSummary } from "@/operationsTypes";

type ReplayDayTab = "sessions" | "decisions" | "gpt" | "prix";

const tabs: Array<{ id: ReplayDayTab; label: string }> = [
  { id: "sessions", label: "Sessions" },
  { id: "decisions", label: "Décisions" },
  { id: "gpt", label: "GPT" },
  { id: "prix", label: "Prix" },
];

export default function ReplayDayPage() {
  useOperationsEvents();
  const { runId = "", date = "" } = useParams();
  const id = decodeURIComponent(runId);
  const query = useReplayDay(id, date);
  const [activeTab, setActiveTab] = useState<ReplayDayTab>("sessions");
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<OperationsEvent | null>(null);

  // `useReplaySession` must be called unconditionally, before any early
  // return, to respect the Rules of Hooks — even though its arguments
  // depend on `query.data`, which may not exist yet on the loading render.
  // `sessions` falls back to an empty array so `activeSession` is `null`
  // and `sessionQuery`'s own `enabled: Boolean(id && sessionId)` guard
  // (see `useReplaySession` in `src/hooks/useOperations.ts`) keeps it idle
  // until real data is available.
  const sessions = query.data?.sessions || [];
  const activeSession = sessions.find(item => sessionKey(item) === selectedSessionKey) || sessions[0] || null;
  const sessionQuery = useReplaySession(id, activeSession?.sessionExecutionId || activeSession?.sourceId || "");

  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Journée introuvable"} retry={() => query.refetch()}/>;

  const day = query.data;
  const certifiedResult = day.sessions.some((item) => item.resultEligible);
  const displayedResult = certifiedResult ? day.metrics.totalR : day.metrics.provisionalR;

  return <section className="view workspace-view replay-day-v3">
    <Breadcrumbs items={[{ label: "Journées de test", to: "/replay" }, { label: day.date }]}/>
    <PageHeading eyebrow="Journée de test détaillée" title={day.date} subtitle={`${day.sessions.length} exécutions · ${day.variants.length} variantes · données PostgreSQL`} backTo="/replay" actions={<StatusTag status={day.status}/>}/>

    <MetricStrip className="metric-grid--compact replay-summary-strip">
      <MetricCard label="Exécutions" value={day.metrics.sessionCount}/>
      <MetricCard label="Variantes" value={day.variants.length}/>
      <MetricCard label="Progression moy." value={`${day.metrics.progress}%`}/>
      <MetricCard label={certifiedResult ? "Résultat certifié" : "Résultat provisoire"} value={displayedResult === null || displayedResult === undefined ? "En calcul" : `${displayedResult.toFixed(2)} R`} tone={displayedResult === null || displayedResult === undefined ? "neutral" : displayedResult >= 0 ? "positive" : "negative"}/>
      <MetricCard label="Processus GPT" value={day.metrics.gptProcesses || 0} detail={`${day.metrics.gptWaiting || 0} attente`}/>
      <MetricCard label="Échecs" value={day.metrics.gptFailed || 0}/>
    </MetricStrip>

    <nav className="desk-function-bar replay-session-strip" aria-label="Sélection de session">
      {day.sessions.map(session => <button
        key={sessionKey(session)}
        className={activeSession && sessionKey(activeSession) === sessionKey(session) ? "active" : ""}
        aria-pressed={activeSession ? sessionKey(activeSession) === sessionKey(session) : false}
        onClick={() => setSelectedSessionKey(sessionKey(session))}
      >
        <span>{sessionTitle(session)}</span>
        <strong className={Number(session.metrics.totalR || 0) >= 0 ? "positive" : "negative"}>{formatSessionResult(session)}</strong>
      </button>)}
    </nav>

    <nav className="desk-function-bar replay-day-tab-bar" aria-label="Détail de la journée">
      {tabs.map(tab => <button
        key={tab.id}
        className={activeTab === tab.id ? "active" : ""}
        aria-pressed={activeTab === tab.id}
        onClick={() => setActiveTab(tab.id)}
      >{tab.label}</button>)}
    </nav>

    {activeTab === "sessions" && <ReplaySessionsTab day={day} activeSession={activeSession} onSelectSession={setSelectedSessionKey}/>}
    {activeTab === "decisions" && <ReplayDecisionsTab runId={id} query={sessionQuery} selectedEvent={selectedEvent} onSelectEvent={setSelectedEvent}/>}
    {activeTab === "gpt" && <ReplayGptTab runId={id} query={sessionQuery}/>}
    {activeTab === "prix" && <ReplayPrixTab runId={id} query={sessionQuery} selectedEvent={selectedEvent} onSelectEvent={setSelectedEvent}/>}
  </section>;
}

function sessionKey(session: WorkflowSummary) {
  return session.sessionExecutionId || session.sourceId || session.id;
}

function sessionTitle(session: WorkflowSummary) {
  return `${sessionLabel(session.session || "globale")} · ${session.variantId || "default"} · #${session.attempt || 1}`;
}

function formatSessionResult(session: WorkflowSummary) {
  const value = session.metrics.totalR;
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? "En calcul" : `${Number(value).toFixed(2)} R`;
}

function sessionLabel(value: string) {
  return value === "asia_open" ? "Session Asie" : value === "ny_open" ? "Session New York" : value.replaceAll("_", " ");
}

function ReplaySessionsTab({ day, activeSession, onSelectSession }: { day: ReplayDayDetail; activeSession: WorkflowSummary | null; onSelectSession: (key: string) => void }) {
  const lanes = groupSessions(day.sessions);
  const variantStats = buildVariantStats(day.sessions);
  return <>
    <section className="replay-terminal-section replay-day-map-section">
      <header><div><p className="eyebrow">Carte des exécutions</p><h2>Sessions et tentatives</h2></div><span>{day.sessions.length} exécutions</span></header>
      <div className="replay-session-lanes" aria-label="Carte multi-sessions de la journée">
        {Object.entries(lanes).map(([session, items]) => <div className="replay-session-lane" key={session}>
          <div><strong>{sessionLabel(session)}</strong><small>{items.length} tentative{items.length > 1 ? "s" : ""}</small></div>
          <div className="replay-session-lane__track">{items.map(item => <button type="button" key={item.id} className={activeSession && sessionKey(activeSession) === sessionKey(item) ? "is-selected" : ""} data-status={item.status} onClick={() => onSelectSession(sessionKey(item))} title={`${item.sourceId} · ${item.status}`}>
            <span>#{item.attempt || 1}</span><i aria-hidden="true"/><small>{item.variantId || "default"}</small>
          </button>)}</div>
          <div className="replay-session-lane__result"><strong>{formatReplayLaneResult(items)}</strong><small>{Math.round(items.reduce((total, item) => total + item.progress, 0) / Math.max(1, items.length))}%</small></div>
        </div>)}
      </div>
    </section>
    <section className="replay-terminal-section replay-variant-matrix-section">
      <header><div><p className="eyebrow">Comparaison locale</p><h2>Variantes, tentatives et résultat</h2></div><span>{variantStats.length} variantes · calcul front depuis contrat backend</span></header>
      <div className="replay-variant-matrix">
        {variantStats.map(stat => <article key={stat.variantId}>
          <header><div><strong>{stat.variantId || "default"}</strong><small>{stat.sessions.length} tentative{stat.sessions.length > 1 ? "s" : ""}</small></div><span className={stat.totalR >= 0 ? "positive" : "negative"}>{stat.totalR.toFixed(2)} R</span></header>
          <div className="replay-variant-ruler"><i style={{ width: `${Math.max(4, Math.min(100, Math.abs(stat.totalR) * 40))}%` }} data-tone={stat.totalR >= 0 ? "positive" : "negative"}/></div>
          <footer>{stat.sessions.map(session => <button type="button" key={session.id} className={activeSession && sessionKey(activeSession) === sessionKey(session) ? "is-selected" : ""} data-status={session.status} onClick={() => onSelectSession(sessionKey(session))}>
            <span>#{session.attempt || 1}</span><i aria-hidden="true"/><strong>{Number(session.metrics.totalR || 0).toFixed(2)} R</strong><small>{shortReference(session.sourceId)}</small>
          </button>)}</footer>
        </article>)}
      </div>
    </section>
  </>;
}

function ReplayDecisionsTab({ runId, query, selectedEvent, onSelectEvent }: { runId: string; query: ReturnType<typeof useReplaySession>; selectedEvent: OperationsEvent | null; onSelectEvent: (event: OperationsEvent) => void }) {
  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Session introuvable"} retry={() => query.refetch()}/>;
  const data = query.data;
  const activeEvent = selectedEvent && data.timeline.some(event => event.id === selectedEvent.id) ? selectedEvent : data.timeline.at(-1) || null;
  const decisionEvents = data.timeline.filter(isDecisionRelevantEvent);
  const gptById = new Map(data.gptProcesses.map(process => [process.id, process]));
  return <>
    <Card className="replay-event-tape" aria-label="Timeline compacte des décisions replay">
      <header><div><p className="eyebrow">Event tape</p><h2>Décisions, étapes et GPT</h2></div><span>{data.timeline.length} points</span></header>
      <div className="replay-event-tape__track">
        {data.timeline.map((event, index) => <button type="button" key={event.id} className={activeEvent?.id === event.id ? "is-selected" : ""} data-layer={event.layer || "event"} data-status={event.status} onClick={() => onSelectEvent(event)}>
          <i aria-hidden="true"/><span>{String(index + 1).padStart(2, "0")} · {formatTime(event.at)}</span><strong>{event.title || event.type}</strong><small>{event.decision || event.conclusion || event.status}</small>
        </button>)}
      </div>
    </Card>
    <section className="replay-terminal-section replay-decision-ledger">
      <header><div><p className="eyebrow">Ledger synchronisé</p><h2>Décisions, GPT et conclusions</h2></div><span>{decisionEvents.length} lignes reliées au graphe</span></header>
      {!decisionEvents.length ? <Card><div className="terminal-empty-state"><span>NO_DECISION_EVENT</span><small>Aucune décision exploitable pour cette session.</small></div></Card> : <div className="data-table-wrap"><table className="data-table replay-decision-table">
        <thead><tr><th>Focus</th><th>Couche</th><th>Décision</th><th>Prix</th><th>Processus GPT</th><th>Conclusion</th></tr></thead>
        <tbody>{decisionEvents.map(event => {
          const process = event.processId ? gptById.get(event.processId) || null : null;
          return <tr key={event.id} className={activeEvent?.id === event.id ? "is-selected" : ""}>
            <td data-label="Focus"><button type="button" className="ledger-focus-btn" onClick={() => onSelectEvent(event)}>{formatTime(event.at)}</button><small>{formatDateTime(event.at)}</small></td>
            <td data-label="Couche"><span className="terminal-code">{event.layer || event.type}</span><StatusTag status={event.status}/></td>
            <td data-label="Décision"><strong>{event.decision || event.title || "—"}</strong><small>{event.detail || event.type}</small></td>
            <td data-label="Prix" className="mono">{event.price ?? "—"}</td>
            <td data-label="Processus GPT">{process ? <Link className="row-link" to={`/replay/runs/${encodeURIComponent(runId)}/gpt/${encodeURIComponent(process.id)}`}>{process.workflow}<Icon name="arrow" size={13}/></Link> : "—"}<small>{process ? `${process.worker || "worker —"} · tentative ${process.attempt}/${process.maxAttempts || "—"}` : "Aucun process lié"}</small></td>
            <td data-label="Conclusion"><span>{event.conclusion || process?.conclusion || process?.decision || "—"}</span></td>
          </tr>;
        })}</tbody>
      </table></div>}
    </section>
    <section id="timeline-events" className="replay-terminal-section">
      <header><div><p className="eyebrow">Journal synchronisé</p><h2>Décisions horodatées</h2></div><span>{data.timeline.length} événements · prix, étapes et GPT</span></header>
      <EventTimeline events={data.timeline} runId={runId} selectedId={activeEvent?.id} onSelect={onSelectEvent}/>
    </section>
  </>;
}

function isDecisionRelevantEvent(event: OperationsEvent) {
  return event.layer === "decision" || Boolean(event.decision || event.conclusion || event.processId || event.price != null);
}

function ReplayGptTab({ runId, query }: { runId: string; query: ReturnType<typeof useReplaySession> }) {
  return <p>PLACEHOLDER_TASK_4</p>;
}

function ReplayPrixTab({ runId, query, selectedEvent, onSelectEvent }: { runId: string; query: ReturnType<typeof useReplaySession>; selectedEvent: OperationsEvent | null; onSelectEvent: (event: OperationsEvent) => void }) {
  return <p>PLACEHOLDER_TASK_5</p>;
}

function groupSessions(items: WorkflowSummary[]) {
  return items.reduce<Record<string, WorkflowSummary[]>>((output, item) => {
    const key = item.session || "globale";
    (output[key] ||= []).push(item);
    return output;
  }, {});
}

type VariantStat = {
  variantId: string;
  sessions: WorkflowSummary[];
  totalR: number;
};

function buildVariantStats(items: WorkflowSummary[]): VariantStat[] {
  const grouped = items.reduce<Record<string, WorkflowSummary[]>>((output, item) => {
    const key = item.variantId || "default";
    (output[key] ||= []).push(item);
    return output;
  }, {});
  return Object.entries(grouped).map(([variantId, sessions]) => ({
    variantId,
    sessions,
    totalR: sessions.reduce((total, item) => total + Number(item.metrics.totalR || 0), 0),
  })).sort((left, right) => right.totalR - left.totalR);
}

function formatReplayLaneResult(items: WorkflowSummary[]) {
  const values = items
    .map((item) => item.metrics.totalR)
    .filter((value): value is number => value !== null && value !== undefined && Number.isFinite(Number(value)))
    .map(Number);
  return values.length ? `${values.reduce((total, value) => total + value, 0).toFixed(2)} R` : "En calcul";
}
