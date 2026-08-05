import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, ErrorView, Icon, LoadingView } from "@/components/common";
import { Breadcrumbs, EventTimeline, formatDateTime, formatDuration, formatTime, MetricCard, MetricStrip, PageHeading, ReplayChart, StatusTag, TechnicalDetails } from "@/components/operations";
import type { GptProcess, OperationsEvent } from "@/operationsTypes";
import { useOperationsEvents, useReplaySession } from "@/hooks/useOperations";
import { replayLabel, shortReference } from "@/lib/presentation";

export default function ReplaySessionPage() {
  useOperationsEvents();
  const { runId = "", date = "", sessionExecutionId = "" } = useParams();
  const parent = decodeURIComponent(runId);
  const execution = decodeURIComponent(sessionExecutionId);
  const query = useReplaySession(parent, execution);
  const [selected, setSelected] = useState<OperationsEvent | null>(null);

  if (query.isLoading) return <LoadingView/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Session introuvable"} retry={() => query.refetch()}/>;

  const data = query.data;
  const activeEvent = selected || data.timeline.at(-1) || null;
  const resultR = data.run.metrics.totalR;
  const hasResult = resultR !== null && resultR !== undefined && Number.isFinite(Number(resultR));
  const gptById = new Map(data.gptProcesses.map(process => [process.id, process]));
  const activeProcess = activeEvent?.processId ? gptById.get(activeEvent.processId) || null : null;
  const decisionEvents = data.timeline.filter(isDecisionRelevantEvent);
  const firstPrice = data.priceSeries[0] || null;
  const lastPrice = data.priceSeries.at(-1) || null;

  return <section className="view workspace-view replay-session-v3">
    <Breadcrumbs items={[{ label: "Journées de test", to: "/replay" }, { label: replayLabel(parent), to: `/replay/runs/${encodeURIComponent(parent)}` }, { label: date, to: `/replay/runs/${encodeURIComponent(parent)}/days/${date}` }, { label: sessionLabel(data.run.session) }]}/>
    <PageHeading eyebrow="Exécution détaillée" title={`${sessionLabel(data.run.session)} · ${data.run.strategyId || "Desk"}`} subtitle={`Variante ${data.run.variantId || "standard"} · tentative ${data.run.attempt || 1}`} backTo={`/replay/runs/${encodeURIComponent(parent)}/days/${date}`} actions={<><StatusTag status={data.run.status}/><Link className="secondary-btn" to={`/operations/workflows/${encodeURIComponent(data.run.id)}`}>Automatisation</Link></>}/>

    <MetricStrip className="metric-grid--compact replay-summary-strip">
      <MetricCard label="Progression" value={`${data.run.progress}%`}/>
      <MetricCard label="Durée" value={formatDuration(data.run.durationMs)}/>
      <MetricCard label="Événements" value={data.timeline.length}/>
      <MetricCard label="Processus GPT" value={data.gptProcesses.length} detail={`${data.gptProcesses.filter(item => item.status === "waiting_gpt").length} en attente`}/>
      <MetricCard label={data.run.resultEligible ? "Résultat certifié" : "Résultat provisoire"} value={hasResult ? `${Number(resultR).toFixed(2)} R` : "En calcul"} tone={!hasResult ? "neutral" : Number(resultR) >= 0 ? "positive" : "negative"}/>
      <MetricCard label="Dernier signal" value={formatTime(data.timeline.at(-1)?.at)} detail={data.timeline.at(-1)?.title || "Aucun"}/>
    </MetricStrip>

    <div className="replay-session-context-strip">
      <span>JOURNÉE <strong>{date}</strong></span><span>SESSION <strong>{sessionLabel(data.run.session)}</strong></span><span>VARIANTE <strong>{data.run.variantId || "Standard"}</strong></span><span>TENTATIVE <strong>#{data.run.attempt || 1}</strong></span><span>SOURCE <strong>PostgreSQL</strong></span>
    </div>
    <ReplaySessionOpsStrip
      prices={data.priceSeries.length}
      firstPriceTime={firstPrice?.time}
      lastPriceTime={lastPrice?.time}
      decisions={decisionEvents.length}
      gptProcesses={data.gptProcesses}
      activeEvent={activeEvent}
      activeProcess={activeProcess}
    />
    <ReplayEventTape events={data.timeline} selectedId={activeEvent?.id} onSelect={setSelected}/>

    <div className="replay-session-workbench">
      <ReplayChart prices={data.priceSeries} events={data.timeline} runId={parent} selectedId={activeEvent?.id} onSelect={setSelected}/>
      <aside className="replay-session-rail">
        <Card className="replay-event-inspector">
          <header><div><p className="eyebrow">Événement sélectionné</p><h2>{activeEvent?.title || "Aucun événement"}</h2></div>{activeEvent && <StatusTag status={activeEvent.status}/>}</header>
          {activeEvent ? <><div className="replay-event-inspector__meta"><span>HEURE <strong>{formatDateTime(activeEvent.at)}</strong></span><span>COUCHE <strong>{activeEvent.layer || activeEvent.type}</strong></span><span>PRIX <strong>{activeEvent.price ?? "—"}</strong></span><span>GPT <strong>{activeProcess?.workflow || activeEvent.processId || "—"}</strong></span></div><p>{activeEvent.conclusion || activeProcess?.conclusion || activeEvent.detail || activeEvent.decision || "Transition enregistrée."}</p>{activeEvent.processId && <Link className="row-link" to={`/replay/runs/${encodeURIComponent(parent)}/gpt/${encodeURIComponent(activeEvent.processId)}`}>Inspecter le processus GPT <Icon name="arrow" size={13}/></Link>}</> : <div className="terminal-empty-state"><span>NO_EVENT_SELECTED</span><small>Sélectionnez un marqueur sur la timeline.</small></div>}
        </Card>

        <Card className="replay-gpt-rail">
          <header><div><p className="eyebrow">Orchestration IA</p><h2>Processus GPT de la session</h2></div><span className="terminal-counter">{data.gptProcesses.length}</span></header>
          {!data.gptProcesses.length ? <div className="terminal-empty-state"><span>NO_GPT_PROCESS</span><small>Aucun processus GPT lié à cette session.</small></div> : <div className="replay-gpt-process-list">{data.gptProcesses.map(process => <Link key={process.id} className={activeProcess?.id === process.id ? "is-selected" : ""} to={`/replay/runs/${encodeURIComponent(parent)}/gpt/${encodeURIComponent(process.id)}`}>
            <span className="replay-gpt-process-list__index">{String(process.attempt).padStart(2, "0")}</span>
            <div><strong>{process.workflow}</strong><small>{processSummary(process)}</small></div>
            <StatusTag status={process.status}/>
          </Link>)}</div>}
        </Card>

        <Card className="replay-conclusion-rail">
          <header><p className="eyebrow">Conclusions matérialisées</p><span className="terminal-counter">{data.conclusions.length}</span></header>
          {!data.conclusions.length ? <p className="muted-copy">Aucune conclusion enregistrée.</p> : data.conclusions.map(item => <blockquote key={item.processId}><span>{formatTime(item.at)}</span>{item.conclusion}</blockquote>)}
        </Card>
      </aside>
    </div>

    <ReplayDecisionLedger events={decisionEvents} gptById={gptById} runId={parent} selectedId={activeEvent?.id} onSelect={setSelected}/>

    <section id="timeline-events" className="replay-terminal-section">
      <header><div><p className="eyebrow">Journal synchronisé</p><h2>Décisions horodatées</h2></div><span>{data.timeline.length} événements · prix, étapes et GPT</span></header>
      <EventTimeline events={data.timeline} runId={parent} selectedId={activeEvent?.id} onSelect={setSelected}/>
    </section>
    <TechnicalDetails items={[
      { label: "Replay parent", value: parent },
      { label: "Exécution de session", value: execution },
      { label: "Workflow", value: data.run.id },
      { label: "Référence courte", value: shortReference(execution) },
    ]}/>
  </section>;
}

function sessionLabel(value?: string | null) {
  return value === "asia_open" ? "Session Asie" : value === "ny_open" ? "Session New York" : value?.replaceAll("_", " ") || "Session";
}

function ReplaySessionOpsStrip({
  prices,
  firstPriceTime,
  lastPriceTime,
  decisions,
  gptProcesses,
  activeEvent,
  activeProcess
}: {
  prices: number;
  firstPriceTime?: string | null;
  lastPriceTime?: string | null;
  decisions: number;
  gptProcesses: GptProcess[];
  activeEvent: OperationsEvent | null;
  activeProcess: GptProcess | null;
}) {
  const waiting = gptProcesses.filter(process => process.status === "waiting_gpt").length;
  const failed = gptProcesses.filter(process => process.status === "failed" || process.status === "blocked").length;
  const completed = gptProcesses.filter(process => process.status === "completed").length;
  const telemetryCount = gptProcesses.filter(process => process.telemetry?.available).length;
  return <div className="replay-session-ops-strip" aria-label="Synthèse opérationnelle de la session replay">
    <span><em>Fenêtre prix</em><strong>{prices}</strong><small>{formatTime(firstPriceTime)} → {formatTime(lastPriceTime)}</small></span>
    <span><em>Décisions</em><strong>{decisions}</strong><small>{decisions ? "événements exploitables" : "aucune décision matérialisée"}</small></span>
    <span data-tone={failed ? "critical" : waiting ? "warning" : "positive"}><em>GPT</em><strong>{gptProcesses.length}</strong><small>{completed} done · {waiting} wait · {failed} risk</small></span>
    <span><em>Télémétrie</em><strong>{telemetryCount}/{gptProcesses.length || 0}</strong><small>tokens/coûts mesurés</small></span>
    <span data-tone={activeProcess ? "info" : "muted"}><em>Focus actif</em><strong>{activeEvent ? formatTime(activeEvent.at) : "—"}</strong><small>{activeProcess?.workflow || activeEvent?.title || "Aucun événement"}</small></span>
  </div>;
}

function ReplayEventTape({ events, selectedId, onSelect }: { events: OperationsEvent[]; selectedId?: string | null; onSelect: (event: OperationsEvent) => void }) {
  if (!events.length) return null;
  return <Card className="replay-event-tape" aria-label="Timeline compacte des décisions replay">
    <header><div><p className="eyebrow">Event tape</p><h2>Décisions, étapes et GPT</h2></div><span>{events.length} points · zoom via graphe</span></header>
    <div className="replay-event-tape__track">
      {events.map((event, index) => <button type="button" key={event.id} className={selectedId === event.id ? "is-selected" : ""} data-layer={event.layer || "event"} data-status={event.status} onClick={() => onSelect(event)}>
        <i aria-hidden="true"/><span>{String(index + 1).padStart(2, "0")} · {formatTime(event.at)}</span><strong>{event.title || event.type}</strong><small>{event.decision || event.conclusion || event.status}</small>
      </button>)}
    </div>
  </Card>;
}

function ReplayDecisionLedger({
  events,
  gptById,
  runId,
  selectedId,
  onSelect
}: {
  events: OperationsEvent[];
  gptById: Map<string, GptProcess>;
  runId: string;
  selectedId?: string | null;
  onSelect: (event: OperationsEvent) => void;
}) {
  return <section className="replay-terminal-section replay-decision-ledger">
    <header><div><p className="eyebrow">Ledger synchronisé</p><h2>Décisions, GPT et conclusions</h2></div><span>{events.length} lignes reliées au graphe</span></header>
    {!events.length ? <Card><div className="terminal-empty-state"><span>NO_DECISION_EVENT</span><small>Aucune décision exploitable pour cette session.</small></div></Card> : <div className="data-table-wrap"><table className="data-table replay-decision-table">
      <thead><tr><th>Focus</th><th>Couche</th><th>Décision</th><th>Prix</th><th>Processus GPT</th><th>Conclusion</th></tr></thead>
      <tbody>{events.map(event => {
        const process = event.processId ? gptById.get(event.processId) || null : null;
        return <tr key={event.id} className={selectedId === event.id ? "is-selected" : ""}>
          <td data-label="Focus"><button type="button" className="ledger-focus-btn" onClick={() => onSelect(event)}>{formatTime(event.at)}</button><small>{formatDateTime(event.at)}</small></td>
          <td data-label="Couche"><span className="terminal-code">{event.layer || event.type}</span><StatusTag status={event.status}/></td>
          <td data-label="Décision"><strong>{event.decision || event.title || "—"}</strong><small>{event.detail || event.type}</small></td>
          <td data-label="Prix" className="mono">{event.price ?? "—"}</td>
          <td data-label="Processus GPT">{process ? <Link className="row-link" to={`/replay/runs/${encodeURIComponent(runId)}/gpt/${encodeURIComponent(process.id)}`}>{process.workflow}<Icon name="arrow" size={13}/></Link> : "—"}<small>{process ? `${process.worker || "worker —"} · tentative ${process.attempt}/${process.maxAttempts || "—"}` : "Aucun process lié"}</small></td>
          <td data-label="Conclusion"><span>{event.conclusion || process?.conclusion || process?.decision || "—"}</span></td>
        </tr>;
      })}</tbody>
    </table></div>}
  </section>;
}

function isDecisionRelevantEvent(event: OperationsEvent) {
  return event.layer === "decision" || Boolean(event.decision || event.conclusion || event.processId || event.price != null);
}

function processSummary(process: GptProcess) {
  const telemetry = process.telemetry?.available
    ? `${process.telemetry.model || "model"} · ${process.telemetry.totalTokens ?? "—"} tok`
    : "télémétrie absente";
  const lease = process.leaseExpiresAt ? `lease ${formatTime(process.leaseExpiresAt)}` : "sans lease";
  return `${process.decision || process.conclusion || process.rawStatus} · ${lease} · ${telemetry}`;
}
