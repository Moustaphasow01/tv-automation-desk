import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, ErrorView, Icon, LoadingView } from "@/components/common";
import { Breadcrumbs, EventTimeline, formatDateTime, formatDuration, formatTime, MetricCard, MetricStrip, PageHeading, ProgressBar, statusLabel, StatusTag, TechnicalDetails } from "@/components/operations";
import { useOperationsEvents, useReplayDay } from "@/hooks/useOperations";
import { gptProcessLabel, replayLabel, shortReference } from "@/lib/presentation";
import type { GptProcess, OperationsEvent, WorkflowSummary } from "@/operationsTypes";

type VariantStat = {
  variantId: string;
  sessions: WorkflowSummary[];
  totalR: number;
  avgProgress: number;
  gpt: number;
  best: WorkflowSummary | null;
  worst: WorkflowSummary | null;
};

export default function ReplayDayPage() {
  useOperationsEvents();
  const { runId = "", date = "" } = useParams();
  const id = decodeURIComponent(runId);
  const query = useReplayDay(id, date);
  const [sessionFilter, setSessionFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [variantFilter, setVariantFilter] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<OperationsEvent | null>(null);

  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Journée introuvable"} retry={() => query.refetch()}/>;

  const day = query.data;
  const allEvents = day.timeline || [];
  const allProcesses = day.gptProcesses || [];
  const allConclusions = day.conclusions || [];
  const sessions = day.sessions.filter(item =>
    (!sessionFilter || item.session === sessionFilter) &&
    (!statusFilter || item.status === statusFilter) &&
    (!variantFilter || item.variantId === variantFilter)
  );
  const lanes = groupSessions(day.sessions);
  const statusCounts = countValues(day.sessions.map(item => item.status));
  const sessionOptions = [...new Set(day.sessions.map(item => item.session).filter(Boolean))] as string[];
  const activeSession = sessions.find(item => sessionKey(item) === selectedSessionId) || sessions[0] || day.sessions[0] || null;
  const activeProcesses = activeSession ? allProcesses.filter(process => processBelongsToSession(process, activeSession)) : allProcesses;
  const activeEvents = activeSession ? allEvents.filter(event => eventBelongsToSession(event, activeSession, activeProcesses)) : allEvents;
  const focusEvents = activeEvents.length || !activeSession ? activeEvents : allEvents;
  const activeConclusions = activeSession ? allConclusions.filter(item => conclusionBelongsToSession(item, activeSession, activeProcesses)) : allConclusions;
  const activeEvent = selectedEvent && allEvents.some(event => event.id === selectedEvent.id) ? selectedEvent : focusEvents.at(-1) || allEvents.at(-1) || null;
  const variantStats = buildVariantStats(day.sessions);
  const consolidatedEvents = allEvents.length > 300 ? allEvents.slice(-300) : allEvents;
  const certifiedResult = day.sessions.some((item) => item.resultEligible);
  const displayedResult = certifiedResult ? day.metrics.totalR : day.metrics.provisionalR;

  return <section className="view workspace-view replay-day-v3">
    <Breadcrumbs items={[{ label: "Journées de test", to: "/replay" }, { label: replayLabel(id), to: `/replay/runs/${encodeURIComponent(id)}` }, { label: day.date }]}/>
    <PageHeading eyebrow="Journée de test détaillée" title={day.date} subtitle={`${day.sessions.length} exécutions · ${day.variants.length} variantes · données PostgreSQL`} backTo="/replay" actions={<StatusTag status={day.status}/>}/>

    <MetricStrip className="metric-grid--compact replay-summary-strip">
      <MetricCard label="Exécutions" value={day.metrics.sessionCount} detail={`${sessionOptions.length} sessions`}/>
      <MetricCard label="Variantes" value={day.variants.length}/>
      <MetricCard label="Progression moy." value={`${day.metrics.progress}%`}/>
      <MetricCard label={certifiedResult ? "Résultat certifié" : "Résultat provisoire"} value={displayedResult === null || displayedResult === undefined ? "En calcul" : `${displayedResult.toFixed(2)} R`} tone={displayedResult === null || displayedResult === undefined ? "neutral" : displayedResult >= 0 ? "positive" : "negative"}/>
      <MetricCard label="Processus GPT" value={day.metrics.gptProcesses || 0} detail={`${day.metrics.gptWaiting || 0} attente`}/>
      <MetricCard label="Échecs / bloqués" value={`${day.metrics.gptFailed || statusCounts.failed || 0} / ${statusCounts.blocked || 0}`} tone={day.metrics.gptFailed || statusCounts.failed || statusCounts.blocked ? "critical" : "neutral"}/>
    </MetricStrip>

    <div className="replay-session-context-strip replay-day-context-strip">
      <span>JOURNÉE <strong>{day.date}</strong></span><span>EXÉCUTION <strong>{activeSession ? sessionTitle(activeSession) : "—"}</strong></span><span>ÉVÉNEMENTS <strong>{allEvents.length}</strong></span><span>SOURCE <strong>PostgreSQL</strong></span>
    </div>

    <section className="replay-terminal-section replay-day-map-section">
      <header><div><p className="eyebrow">Carte des exécutions</p><h2>Sessions et tentatives</h2></div><span>Focus local + ouverture écran session via le fil d’Ariane</span></header>
      <div className="replay-day-command-center">
        <ReplaySessionLanes lanes={lanes} parent={id} date={day.date} selectedKey={activeSession ? sessionKey(activeSession) : null} onFocus={setSelectedSessionId}/>
        <ReplayDayFocusPanel
          parent={id}
          date={day.date}
          session={activeSession}
          processes={activeProcesses}
          events={focusEvents}
          conclusions={activeConclusions}
          activeEvent={activeEvent}
          onEventSelect={setSelectedEvent}
        />
      </div>
    </section>

    <ReplayVariantMatrix stats={variantStats} selectedKey={activeSession ? sessionKey(activeSession) : null} onFocus={setSelectedSessionId}/>
    <ReplayDayEventTape events={focusEvents} selectedId={activeEvent?.id} onSelect={setSelectedEvent}/>

    <div className="replay-day-intelligence-grid">
      <Card className="replay-day-gpt-panel">
        <header><div><p className="eyebrow">Processus GPT</p><h2>État par session</h2></div><span>{allProcesses.length}</span></header>
        {!allProcesses.length ? <div className="terminal-empty-state"><span>NO_GPT_PROCESS</span><small>Aucun processus GPT matérialisé sur cette journée.</small></div> : <div className="replay-day-gpt-list">{allProcesses.map((process) => <Link key={process.id} className={activeProcesses.some(item => item.id === process.id) ? "is-selected" : ""} to={`/replay/runs/${encodeURIComponent(process.runId || id)}/gpt/${encodeURIComponent(process.id)}`}>
          <span>{process.workflow}</span><strong>{gptProcessLabel(process.id)}</strong><small>{process.worker ? "Pris en charge" : "En attente de prise en charge"}</small><StatusTag status={process.status}/>
        </Link>)}</div>}
      </Card>
      <Card className="replay-day-conclusion-panel">
        <header><div><p className="eyebrow">Conclusions GPT</p><h2>Dernières synthèses</h2></div><span>{allConclusions.length}</span></header>
        {!allConclusions.length ? <p className="muted-copy">Aucune conclusion GPT persistée.</p> : <div>{allConclusions.map((item) => <blockquote key={`${item.runId}:${item.processId}`} className={activeConclusions.some(active => active.processId === item.processId) ? "is-selected" : ""}><span>{formatDateTime(item.at)}</span>{item.conclusion}</blockquote>)}</div>}
      </Card>
    </div>

    <Card className="replay-day-filters">
      <label><span>Session</span><select aria-label="Filtrer les exécutions par session" value={sessionFilter} onChange={event => setSessionFilter(event.target.value)}><option value="">Toutes</option>{sessionOptions.map(value => <option value={value} key={value}>{sessionLabel(value)}</option>)}</select></label>
      <label><span>État</span><select aria-label="Filtrer les exécutions par état" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="">Tous</option>{Object.keys(statusCounts).map(value => <option value={value} key={value}>{statusLabel(value)}</option>)}</select></label>
      <label><span>Variante</span><select aria-label="Filtrer les exécutions par variante" value={variantFilter} onChange={event => setVariantFilter(event.target.value)}><option value="">Toutes</option>{day.variants.map(value => <option value={value || "default"} key={value || "default"}>{value || "default"}</option>)}</select></label>
      <div><strong>{sessions.length}</strong><span>lignes visibles</span>{(sessionFilter || statusFilter || variantFilter) && <button className="text-btn" onClick={() => { setSessionFilter(""); setStatusFilter(""); setVariantFilter(""); }}>Réinitialiser</button>}</div>
    </Card>

    <section className="replay-terminal-section">
      <header><div><p className="eyebrow">Matrice détaillée</p><h2>Sessions, variantes et tentatives</h2></div><span>Navigation sans empilement</span></header>
      <div className="data-table-wrap"><table className="data-table replay-session-table">
        <thead><tr><th>Session</th><th>Stratégie</th><th>Variante</th><th>Tentative</th><th>État</th><th>Progression</th><th>Résultat</th><th>GPT</th><th>Mise à jour</th><th/></tr></thead>
        <tbody>{sessions.map(session => <tr key={session.id} className={activeSession && sessionKey(activeSession) === sessionKey(session) ? "is-selected" : ""}>
          <td data-label="Session"><button type="button" className="replay-session-focus-btn" onClick={() => setSelectedSessionId(sessionKey(session))}>Focus</button><strong>{sessionLabel(session.session || "globale")}</strong><small>{shortReference(session.sessionExecutionId)}</small></td>
          <td data-label="Stratégie">{session.strategyId || "—"}</td>
          <td data-label="Variante"><span className="mono">{session.variantId || "default"}</span></td>
          <td data-label="Tentative"><strong>#{session.attempt || 1}</strong></td>
          <td data-label="État"><StatusTag status={session.status}/></td>
          <td data-label="Progression"><ProgressBar value={session.progress} status={session.status}/></td>
          <td data-label="Résultat" className={Number(session.metrics.totalR || 0) >= 0 ? "positive" : "negative"}><strong>{formatReplayResult(session)}</strong><small>{session.resultEligible ? "certifié" : session.metrics.totalR === null || session.metrics.totalR === undefined ? "" : "provisoire"}</small></td>
          <td data-label="GPT">{Number(session.metrics.gptProcesses || 0)}</td>
          <td data-label="Mise à jour"><time>{formatDateTime(session.updatedAt)}</time></td>
          <td data-label="Action"><Link className="row-link" to={sessionUrl(id, day.date, session)}>Inspecter <Icon name="arrow" size={13}/></Link></td>
        </tr>)}</tbody>
      </table></div>
      {!sessions.length && <div className="terminal-empty-state"><span>NO_SESSION_MATCH</span><small>Aucune exécution ne correspond aux filtres actifs.</small></div>}
    </section>
    <TechnicalDetails items={[
      { label: "Replay parent", value: id },
      { label: "Date canonique", value: day.date },
    ]}/>

    <section className="replay-terminal-section replay-day-timeline-section">
      <header><div><p className="eyebrow">Timeline consolidée journée</p><h2>Décisions, étapes et GPT</h2></div><span>{consolidatedEvents.length}/{allEvents.length} événements · focus {focusEvents.length}</span></header>
      <EventTimeline events={consolidatedEvents} runId={id} selectedId={activeEvent?.id} onSelect={setSelectedEvent}/>
    </section>
  </section>;
}

function formatReplayResult(session: WorkflowSummary) {
  const value = session.metrics.totalR;
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? "En calcul" : `${Number(value).toFixed(2)} R`;
}

function formatReplayLaneResult(items: WorkflowSummary[]) {
  const values = items
    .map((item) => item.metrics.totalR)
    .filter((value): value is number => value !== null && value !== undefined && Number.isFinite(Number(value)))
    .map(Number);
  return values.length ? `${values.reduce((total, value) => total + value, 0).toFixed(2)} R` : "En calcul";
}

function ReplaySessionLanes({
  lanes,
  parent,
  date,
  selectedKey,
  onFocus
}: {
  lanes: Record<string, WorkflowSummary[]>;
  parent: string;
  date: string;
  selectedKey: string | null;
  onFocus: (key: string) => void;
}) {
  return <div className="replay-session-lanes" aria-label="Carte multi-sessions de la journée">
    {Object.entries(lanes).map(([session, items]) => <div className="replay-session-lane" key={session}>
      <div><strong>{sessionLabel(session)}</strong><small>{items.length} tentative{items.length > 1 ? "s" : ""}</small></div>
      <div className="replay-session-lane__track">{items.map(item => <Link key={item.id} className={selectedKey === sessionKey(item) ? "is-selected" : ""} data-status={item.status} to={sessionUrl(parent, date, item)} onFocus={() => onFocus(sessionKey(item))} onMouseEnter={() => onFocus(sessionKey(item))} title={`${item.sourceId} · ${item.status}`}>
        <span>#{item.attempt || 1}</span><i aria-hidden="true"/><small>{item.variantId || "default"}</small>
      </Link>)}</div>
      <div className="replay-session-lane__result"><strong>{formatReplayLaneResult(items)}</strong><small>{Math.round(items.reduce((total, item) => total + item.progress, 0) / Math.max(1, items.length))}%</small></div>
    </div>)}
  </div>;
}

function ReplayDayFocusPanel({
  parent,
  date,
  session,
  processes,
  events,
  conclusions,
  activeEvent,
  onEventSelect
}: {
  parent: string;
  date: string;
  session: WorkflowSummary | null;
  processes: GptProcess[];
  events: OperationsEvent[];
  conclusions: Array<{ processId: string; runId: string | null; conclusion: string; at: string | null }>;
  activeEvent: OperationsEvent | null;
  onEventSelect: (event: OperationsEvent) => void;
}) {
  if (!session) return <Card className="replay-day-focus-panel"><div className="terminal-empty-state"><span>NO_SESSION_FOCUS</span><small>Aucune session matérialisée sur cette journée.</small></div></Card>;
  const resultR = session.metrics.totalR;
  const hasResult = resultR !== null && resultR !== undefined && Number.isFinite(Number(resultR));
  const waiting = processes.filter(process => process.status === "waiting_gpt").length;
  const risk = processes.filter(process => process.status === "failed" || process.status === "blocked").length;
  return <Card className="replay-day-focus-panel">
    <header><div><p className="eyebrow">Exécution sélectionnée</p><h2>{sessionTitle(session)}</h2><small>{shortReference(session.sourceId)}</small></div><StatusTag status={session.status}/></header>
    <dl className="replay-day-focus-grid">
      <span><dt>Résultat</dt><dd className={Number(resultR || 0) >= 0 ? "positive" : "negative"}>{hasResult ? `${Number(resultR).toFixed(2)} R` : "En calcul"}</dd></span>
      <span><dt>Progression</dt><dd>{session.progress}%</dd></span>
      <span><dt>Durée</dt><dd>{formatDuration(session.durationMs)}</dd></span>
      <span><dt>GPT</dt><dd>{processes.length} · {waiting} wait</dd></span>
      <span><dt>Risque</dt><dd>{risk ? `${risk} blocage/échec` : "clean"}</dd></span>
      <span><dt>Update</dt><dd>{formatTime(session.updatedAt)}</dd></span>
    </dl>
    <div className="replay-day-focus-actions">
      <Link className="primary-btn" to={sessionUrl(parent, date, session)}>Ouvrir écran session</Link>
      <Link className="secondary-btn" to={`/operations/workflows/${encodeURIComponent(session.id)}`}>Workflow</Link>
    </div>
    <div className="replay-day-focus-events">
      <header><span>Event focus</span><strong>{events.length}</strong></header>
      {!events.length ? <div className="terminal-empty-state"><span>NO_EVENT_FOR_SESSION</span><small>Le backend ne retourne aucun événement relié à ce run.</small></div> : events.slice(-6).map(event => <button key={event.id} type="button" className={activeEvent?.id === event.id ? "is-selected" : ""} data-layer={event.layer || "event"} onClick={() => onEventSelect(event)}>
        <time>{formatTime(event.at)}</time><strong>{event.title || event.type}</strong><small>{event.conclusion || event.decision || event.status}</small>
      </button>)}
    </div>
    <div className="replay-day-focus-conclusions">
      <header><span>Conclusions GPT</span><strong>{conclusions.length}</strong></header>
      {!conclusions.length ? <small>Aucune conclusion reliée à ce focus.</small> : conclusions.slice(-3).map(item => <blockquote key={`${item.processId}:${item.at}`}>{item.conclusion}</blockquote>)}
    </div>
  </Card>;
}

function ReplayVariantMatrix({ stats, selectedKey, onFocus }: { stats: VariantStat[]; selectedKey: string | null; onFocus: (key: string) => void }) {
  return <section className="replay-terminal-section replay-variant-matrix-section">
    <header><div><p className="eyebrow">Comparaison locale</p><h2>Variantes, tentatives et résultat</h2></div><span>{stats.length} variantes · calcul front depuis contrat backend</span></header>
    <div className="replay-variant-matrix">
      {stats.map(stat => <article key={stat.variantId}>
        <header><div><strong>{stat.variantId || "default"}</strong><small>{stat.sessions.length} tentative{stat.sessions.length > 1 ? "s" : ""}</small></div><span className={stat.totalR >= 0 ? "positive" : "negative"}>{stat.totalR.toFixed(2)} R</span></header>
        <div className="replay-variant-ruler"><i style={{ width: `${Math.max(4, Math.min(100, Math.abs(stat.totalR) * 40))}%` }} data-tone={stat.totalR >= 0 ? "positive" : "negative"}/></div>
        <footer>{stat.sessions.map(session => <button type="button" key={session.id} className={selectedKey === sessionKey(session) ? "is-selected" : ""} data-status={session.status} onClick={() => onFocus(sessionKey(session))}>
          <span>#{session.attempt || 1}</span><i aria-hidden="true"/><strong>{Number(session.metrics.totalR || 0).toFixed(2)} R</strong><small>{shortReference(session.sourceId)}</small>
        </button>)}</footer>
      </article>)}
    </div>
  </section>;
}

function ReplayDayEventTape({ events, selectedId, onSelect }: { events: OperationsEvent[]; selectedId?: string | null; onSelect: (event: OperationsEvent) => void }) {
  const [showAll, setShowAll] = useState(false);
  if (!events.length) return null;
  const visibleEvents = showAll || events.length <= 120 ? events : events.slice(-120);
  return <Card className="replay-event-tape replay-day-event-tape" aria-label="Timeline compacte du focus journée">
    <header><div><p className="eyebrow">Event tape journée</p><h2>Focus décisions et processus</h2></div><span>{visibleEvents.length}/{events.length} points</span>{events.length > 120 && <button className="text-btn" type="button" onClick={() => setShowAll(value => !value)}>{showAll ? "Compacter" : "Tout afficher"}</button>}</header>
    <div className="replay-event-tape__track">
      {visibleEvents.map((event, index) => <button type="button" key={event.id} className={selectedId === event.id ? "is-selected" : ""} data-layer={event.layer || "event"} data-status={event.status} onClick={() => onSelect(event)}>
        <i aria-hidden="true"/><span>{String(index + 1).padStart(2, "0")} · {formatTime(event.at)}</span><strong>{event.title || event.type}</strong><small>{event.decision || event.conclusion || event.status}</small>
      </button>)}
    </div>
  </Card>;
}

function sessionUrl(parent: string, date: string, session: WorkflowSummary) {
  return `/replay/runs/${encodeURIComponent(parent)}/days/${date}/sessions/${encodeURIComponent(session.sessionExecutionId || session.sourceId)}`;
}

function groupSessions(items: WorkflowSummary[]) {
  return items.reduce<Record<string, WorkflowSummary[]>>((output, item) => {
    const key = item.session || "globale";
    (output[key] ||= []).push(item);
    return output;
  }, {});
}

function buildVariantStats(items: WorkflowSummary[]): VariantStat[] {
  const grouped = items.reduce<Record<string, WorkflowSummary[]>>((output, item) => {
    const key = item.variantId || "default";
    (output[key] ||= []).push(item);
    return output;
  }, {});
  return Object.entries(grouped).map(([variantId, sessions]) => {
    const ordered = [...sessions].sort((left, right) => Number(right.metrics.totalR || 0) - Number(left.metrics.totalR || 0));
    const totalR = sessions.reduce((total, item) => total + Number(item.metrics.totalR || 0), 0);
    return {
      variantId,
      sessions,
      totalR,
      avgProgress: sessions.reduce((total, item) => total + item.progress, 0) / Math.max(1, sessions.length),
      gpt: sessions.reduce((total, item) => total + Number(item.metrics.gptProcesses || 0), 0),
      best: ordered[0] || null,
      worst: ordered.at(-1) || null,
    };
  }).sort((left, right) => right.totalR - left.totalR);
}

function countValues(values: string[]) {
  return values.reduce<Record<string, number>>((output, value) => ({ ...output, [value]: (output[value] || 0) + 1 }), {});
}

function sessionKey(session: WorkflowSummary) {
  return session.sessionExecutionId || session.sourceId || session.id;
}

function sessionTitle(session: WorkflowSummary) {
  return `${sessionLabel(session.session || "globale")} · ${session.variantId || "default"} · #${session.attempt || 1}`;
}

function sessionLabel(value: string) {
  return value === "asia_open" ? "Session Asie" : value === "ny_open" ? "Session New York" : value.replaceAll("_", " ");
}

function processBelongsToSession(process: GptProcess, session: WorkflowSummary) {
  const ids = new Set([session.sourceId, session.sessionExecutionId, session.id].filter(Boolean));
  return Boolean(process.runId && ids.has(process.runId));
}

function eventBelongsToSession(event: OperationsEvent, session: WorkflowSummary, processes: GptProcess[]) {
  const ids = new Set([session.sourceId, session.sessionExecutionId, session.id, `replay:${session.sourceId}`].filter(Boolean));
  return Boolean(
    (event.runId && ids.has(event.runId)) ||
    (event.workflowId && ids.has(event.workflowId)) ||
    (event.processId && processes.some(process => process.id === event.processId))
  );
}

function conclusionBelongsToSession(item: { processId: string; runId: string | null }, session: WorkflowSummary, processes: GptProcess[]) {
  const ids = new Set([session.sourceId, session.sessionExecutionId, session.id].filter(Boolean));
  return Boolean((item.runId && ids.has(item.runId)) || processes.some(process => process.id === item.processId));
}
