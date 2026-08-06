import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, ErrorView, LoadingView } from "@/components/common";
import { Breadcrumbs, MetricCard, MetricStrip, PageHeading, StatusTag } from "@/components/operations";
import { useOperationsEvents, useReplayDay, useReplaySession } from "@/hooks/useOperations";
import { replayLabel } from "@/lib/presentation";
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
      <MetricCard label="Exécutions" value={day.metrics.sessionCount} detail={`${day.variants.length} variantes`}/>
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
  return <p>PLACEHOLDER_TASK_2</p>;
}

function ReplayDecisionsTab({ runId, query, selectedEvent, onSelectEvent }: { runId: string; query: ReturnType<typeof useReplaySession>; selectedEvent: OperationsEvent | null; onSelectEvent: (event: OperationsEvent) => void }) {
  return <p>PLACEHOLDER_TASK_3</p>;
}

function ReplayGptTab({ runId, query }: { runId: string; query: ReturnType<typeof useReplaySession> }) {
  return <p>PLACEHOLDER_TASK_4</p>;
}

function ReplayPrixTab({ runId, query, selectedEvent, onSelectEvent }: { runId: string; query: ReturnType<typeof useReplaySession>; selectedEvent: OperationsEvent | null; onSelectEvent: (event: OperationsEvent) => void }) {
  return <p>PLACEHOLDER_TASK_5</p>;
}
