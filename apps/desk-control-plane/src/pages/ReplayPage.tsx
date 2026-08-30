import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { routeDisplayName } from "@/app/routes";
import { RealtimeContext } from "@/domains/realtime/RealtimeProvider";
import { useFrontView } from "@/domains/front-api/repositories";
import type { ReplayOverviewView, ReplayTimelineLayer } from "@/domains/front-api/viewModels";
import "@/features/replay/replay.css";

type TimelineEvent = ReplayOverviewView["timeline"][number];

const LAYER_COLORS: Record<ReplayTimelineLayer, string> = {
  decision: "var(--rp-blue)",
  step: "var(--rp-purple)",
  gpt: "var(--rp-cyan)",
  event: "var(--rp-amber)"
};
const LAYER_LABELS: Record<ReplayTimelineLayer, string> = {
  decision: "Décision",
  step: "Étape",
  gpt: "IA / GPT",
  event: "Événement"
};
const SPEEDS = [1, 2, 4, 8];

export function ReplayPage() {
  const realtime = useContext(RealtimeContext);
  const [selectedRunId, setSelectedRunId] = useState("");
  const query = useFrontView("replay-overview", selectedRunId ? { runId: selectedRunId } : {});
  const [playheadIndex, setPlayheadIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const intervalRef = useRef<number | null>(null);

  const data = query.data?.data ?? null;
  const candleCount = data?.candles.length ?? 0;

  useEffect(() => {
    if (!selectedRunId && data?.days.length) {
      const candidates = data.days.filter((day) => day.primaryRunId);
      const latestCompleted = [...candidates]
        .filter((day) => String(day.status).toUpperCase() === "COMPLETED")
        .sort((left, right) => right.date.localeCompare(left.date))[0];
      const fallback = [...candidates].sort((left, right) => right.date.localeCompare(left.date))[0];
      const defaultRun = latestCompleted ?? fallback;
      if (defaultRun?.primaryRunId) setSelectedRunId(defaultRun.primaryRunId);
    }
  }, [data, selectedRunId]);

  useEffect(() => {
    setPlayheadIndex(candleCount ? candleCount - 1 : 0);
    setSelectedEventId(null);
  }, [data?.selectedRun?.runId, candleCount]);

  useEffect(() => {
    if (!isPlaying || !data?.candles.length) return;
    intervalRef.current = window.setInterval(() => {
      setPlayheadIndex((index) => {
        const next = index + 1;
        if (next >= data.candles.length) {
          setIsPlaying(false);
          return index;
        }
        return next;
      });
    }, Math.max(60, 480 / speed));
    return () => { if (intervalRef.current) window.clearInterval(intervalRef.current); };
  }, [isPlaying, speed, data?.candles.length]);

  const playheadTime = data?.candles[playheadIndex]?.time ?? null;
  const visibleTimeline = useMemo(
    () => (data && playheadTime ? data.timeline.filter((item) => item.at <= playheadTime) : data?.timeline ?? []),
    [data, playheadTime]
  );
  const selectedEvent = useMemo(
    () => (selectedEventId ? visibleTimeline.find((item) => item.eventId === selectedEventId) ?? null : visibleTimeline.at(-1) ?? null),
    [visibleTimeline, selectedEventId]
  );
  const decisionCluster = useMemo(() => {
    if (!data || !selectedEvent) return [];
    if (!selectedEvent.stepId) return [selectedEvent];
    return data.timeline.filter((item) => item.stepId === selectedEvent.stepId);
  }, [data, selectedEvent]);

  if (query.isLoading) return <ReplayLoading />;
  if (query.isError) return <div className="rp-page"><h1 className="sr-only">Rejeu</h1><div className="rp-workspace" role="region" aria-label="Espace de travail du replay" tabIndex={0}><p className="rp-empty">La projection du replay ne répond pas. Réessayez dans quelques instants.</p></div></div>;
  if (!data) return <div className="rp-page"><h1 className="sr-only">Rejeu</h1><div className="rp-workspace" role="region" aria-label="Espace de travail du replay" tabIndex={0}><p className="rp-empty">Aucune projection de replay n'est publiée.</p></div></div>;

  return (
    <div className="rp-page" data-testid="replay-golden-master">
      <header className="rp-header">
        <div className="rp-header__title">
          <h1>{routeDisplayName("replay")}</h1>
          <p>Rejeu des journées &amp; contexte de décision</p>
        </div>
        <div className="rp-header__clock">
          <strong>{formatClock(realtime?.now)}</strong>
          <small>{formatClockDate(realtime?.now)}</small>
        </div>
      </header>

      <div className="rp-controls">
        <label>
          Session
          <select value={selectedRunId} onChange={(event) => setSelectedRunId(event.target.value)}>
            <optgroup label="Terminées">
              {data.days.filter((day) => day.primaryRunId && String(day.status).toUpperCase() === "COMPLETED").map((day) => (
                <option key={day.primaryRunId} value={day.primaryRunId!}>{day.date} · {day.status}</option>
              ))}
            </optgroup>
            <optgroup label="Autres sessions">
              {data.days.filter((day) => day.primaryRunId && String(day.status).toUpperCase() !== "COMPLETED").map((day) => (
                <option key={day.primaryRunId} value={day.primaryRunId!}>{day.date} · {day.status}</option>
              ))}
            </optgroup>
          </select>
        </label>
        <label>Stratégie <strong>{data.selectedRun?.strategyId ?? "—"}</strong></label>
        <label>Moteur <strong>{data.selectedRun?.engineVersion ?? "—"}</strong></label>
        <input
          className="rp-scrub"
          type="range"
          aria-label="Position de lecture du replay"
          min={0}
          max={Math.max(0, data.candles.length - 1)}
          value={playheadIndex}
          onChange={(event) => { setIsPlaying(false); setPlayheadIndex(Number(event.target.value)); }}
        />
        <div className="rp-transport">
          {SPEEDS.map((value) => (
            <button key={value} type="button" className={speed === value ? "is-active" : undefined} onClick={() => setSpeed(value)}>{value}×</button>
          ))}
          <button type="button" onClick={() => setPlayheadIndex(0)}>⏮</button>
          <button type="button" className={isPlaying ? "is-active" : undefined} onClick={() => setIsPlaying((value) => !value)}>{isPlaying ? "⏸ Pause" : "▶ Lecture"}</button>
          <button type="button" onClick={() => setPlayheadIndex(Math.max(0, data.candles.length - 1))}>⏭</button>
        </div>
      </div>

      <div className="rp-workspace" role="region" aria-label="Espace de travail du replay" tabIndex={0}>
        <section className="rp-session-strip" aria-label="Repères de session">
          <SessionCell label="Date" value={data.selectedRun?.tradingDate ?? "—"} />
          <SessionCell label="Session" value={data.selectedRun?.session ?? "—"} />
          <SessionCell label="Statut" value={data.selectedRun?.status ?? "—"} />
          <SessionCell label="Progression" value={data.selectedRun ? `${data.selectedRun.progress}%` : "—"} />
          <SessionCell label="Total R" value={data.selectedRun ? formatSignedR(data.selectedRun.totalR) : "—"} />
          <SessionCell label="Bougies" value={String(data.candles.length)} />
        </section>

        <div className="rp-main-grid">
          <section className="rp-panel" aria-label="Graphique en chandeliers">
            <header><h2>Chandeliers</h2><small>{playheadTime ? formatTime(playheadTime) : "—"}</small></header>
            <div className="rp-panel__body">
              <CandleChart candles={data.candles} playheadIndex={playheadIndex} events={visibleTimeline} onSelectEvent={setSelectedEventId} />
            </div>
            <div className="rp-chart-legend">
              {(Object.keys(LAYER_LABELS) as ReplayTimelineLayer[]).map((layer) => (
                <span key={layer}><i style={{ background: LAYER_COLORS[layer] }} />{LAYER_LABELS[layer]} ({data.timelineCounts[layer]})</span>
              ))}
            </div>
          </section>

          <div className="rp-side-grid">
            <section className="rp-panel" aria-label="Compteur d'événements">
              <header><h2>Chronologie des événements</h2><small>{visibleTimeline.length}/{data.timeline.length}</small></header>
              <div className="rp-counts">
                {(Object.keys(LAYER_LABELS) as ReplayTimelineLayer[]).map((layer) => (
                  <div key={layer}><small>{LAYER_LABELS[layer]}</small><strong>{data.timelineCounts[layer]}</strong></div>
                ))}
              </div>
            </section>

            <section className="rp-panel" aria-label="Détail événement">
              <header><h2>Détail événement</h2></header>
              <div className="rp-panel__body">
                <div className="rp-event-list">
                  {[...visibleTimeline].reverse().slice(0, 30).map((item) => (
                    <button
                      type="button"
                      key={item.eventId}
                      className="rp-event-row"
                      aria-selected={selectedEvent?.eventId === item.eventId}
                      onClick={() => setSelectedEventId(item.eventId)}
                    >
                      <time>{formatTime(item.at)}</time>
                      <span style={{ color: LAYER_COLORS[item.layer] }}>●</span>
                      <strong>{item.title}</strong>
                    </button>
                  ))}
                  {!visibleTimeline.length ? <p className="rp-empty">Aucun événement avant ce point de lecture.</p> : null}
                </div>
                {selectedEvent ? (
                  <div className="rp-detail-grid" style={{ marginTop: 10 }}>
                    <div><small>Type</small><strong>{selectedEvent.type}</strong></div>
                    <div><small>Décision</small><strong>{selectedEvent.decision ?? "Non publié"}</strong></div>
                    <div><small>Détail</small><strong>{selectedEvent.detail || "Non publié"}</strong></div>
                    <div><small>Conclusion</small><strong>{selectedEvent.conclusion ?? "Non publié"}</strong></div>
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </div>

        <section className="rp-panel" aria-label="Contexte de décision">
          <header><h2>Contexte de décision</h2>{selectedEvent ? <small>{formatTime(selectedEvent.at)}</small> : null}</header>
          <div className="rp-panel__body">
            <div className="rp-decision-grid">
              <DecisionColumn title="Évaluation stratégie" event={pickByHint(decisionCluster, ["decision", "strategy", "signal"])} />
              <DecisionColumn title="Contexte portefeuille" event={pickByHint(decisionCluster, ["portfolio", "position", "context"])} />
              <DecisionColumn title="Contrôle risque" event={pickByHint(decisionCluster, ["risk"])} />
              <DecisionColumn title="Order intent" event={pickByHint(decisionCluster, ["order", "intent"])} />
              <DecisionColumn title="Exécution simulée" event={pickByHint(decisionCluster, ["gpt", "execution", "fill"])} />
            </div>
          </div>
        </section>

        <section className="rp-panel" aria-label="Journées replay">
          <header><h2>Journées</h2><small>{data.days.length}</small></header>
          <div className="rp-panel__body" style={{ padding: 0 }}>
            <table className="rp-days-table">
              <thead><tr><th>Date</th><th>Statut</th><th>Sessions</th><th>Total R</th><th>Progression</th></tr></thead>
              <tbody>
                {data.days.map((day) => (
                  <tr
                    key={day.date}
                    aria-selected={day.primaryRunId === selectedRunId}
                    onClick={() => day.primaryRunId && setSelectedRunId(day.primaryRunId)}
                  >
                    <td><strong>{day.date}</strong></td>
                    <td>{day.status}</td>
                    <td>{day.sessionCount}</td>
                    <td className={day.totalR >= 0 ? "rp-num-pos" : "rp-num-neg"}>{formatSignedR(day.totalR)}</td>
                    <td>{day.totalProgress}%</td>
                  </tr>
                ))}
                {!data.days.length ? <tr><td colSpan={5}><p className="rp-empty">Aucune journée replay publiée.</p></td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function CandleChart({ candles, playheadIndex, events, onSelectEvent }: {
  candles: ReplayOverviewView["candles"];
  playheadIndex: number;
  events: readonly TimelineEvent[];
  onSelectEvent: (eventId: string) => void;
}) {
  if (!candles.length) return <p className="rp-empty">Aucune bougie publiée pour ce run replay.</p>;
  const width = 900;
  const height = 320;
  const padding = 10;
  const visible = candles;
  const highs = visible.map((c) => c.high);
  const lows = visible.map((c) => c.low);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const span = Math.max(max - min, 0.0001);
  const step = (width - padding * 2) / Math.max(1, visible.length - 1 || 1);
  const x = (index: number) => padding + index * step;
  const y = (price: number) => height - padding - ((price - min) / span) * (height - padding * 2);
  const candleWidth = Math.max(1.5, Math.min(7, step * 0.6));

  const eventPositions = events
    .map((event) => {
      const index = candles.findIndex((c) => c.time >= event.at);
      return index === -1 ? null : { event, index };
    })
    .filter((item): item is { event: TimelineEvent; index: number } => item !== null);

  return (
    <svg className="rp-chart-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${visible.length} bougies replay`}>
      {visible.map((candle, index) => {
        const up = candle.close >= candle.open;
        const dimmed = index > playheadIndex;
        return (
          <g key={`${candle.time}-${index}`} opacity={dimmed ? 0.25 : 1}>
            <line x1={x(index)} x2={x(index)} y1={y(candle.high)} y2={y(candle.low)} stroke={up ? "var(--rp-green)" : "var(--rp-red)"} strokeWidth="1" />
            <rect
              x={x(index) - candleWidth / 2}
              y={Math.min(y(candle.open), y(candle.close))}
              width={candleWidth}
              height={Math.max(1, Math.abs(y(candle.open) - y(candle.close)))}
              fill={up ? "var(--rp-green)" : "var(--rp-red)"}
            />
          </g>
        );
      })}
      <line x1={x(playheadIndex)} x2={x(playheadIndex)} y1={0} y2={height} stroke="var(--rp-secondary)" strokeDasharray="3 3" />
      {eventPositions.map(({ event, index }, position) => {
        const cx = x(Math.min(index, visible.length - 1));
        const showLabel = eventPositions.length <= 12;
        const labelY = 10 + (position % 3) * 12;
        return (
          <g key={`${event.eventId}-${position}`} onClick={() => onSelectEvent(event.eventId)} style={{ cursor: "pointer" }}>
            {showLabel ? <line x1={cx} x2={cx} y1={labelY + 4} y2={y(candles[Math.min(index, visible.length - 1)].high)} stroke={LAYER_COLORS[event.layer]} strokeWidth="1" strokeDasharray="2 2" opacity={0.6} /> : null}
            <circle cx={cx} cy={showLabel ? labelY : 8} r={4} fill={LAYER_COLORS[event.layer]}>
              <title>{event.title}</title>
            </circle>
            {showLabel ? (
              <text x={cx + 6} y={labelY + 3} fontSize="11" fill={LAYER_COLORS[event.layer]} fontWeight="700">{event.title}</text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function DecisionColumn({ title, event }: { title: string; event: TimelineEvent | null }) {
  if (!event) {
    return (
      <div className="rp-decision-col">
        <h3>{title}</h3>
        <p style={{ color: "var(--rp-muted)" }}>Non publié</p>
      </div>
    );
  }
  const fields: [string, string][] = [
    ["Type", event.type],
    ["Décision", event.decision ?? "Non publié"],
    ["Détail", event.detail || event.title],
  ];
  if (event.conclusion) fields.push(["Conclusion", event.conclusion]);
  if (event.price != null) fields.push(["Prix", event.price.toFixed(2)]);
  if (event.severity) fields.push(["Sévérité", event.severity]);
  return (
    <div className="rp-decision-col">
      <h3>{title}</h3>
      <div className="rp-decision-fields">
        {fields.map(([label, value]) => (
          <div key={label}><small>{label}</small><span>{value}</span></div>
        ))}
      </div>
    </div>
  );
}

function pickByHint(cluster: readonly TimelineEvent[], hints: string[]): TimelineEvent | null {
  const lowerHints = hints.map((hint) => hint.toLowerCase());
  return cluster.find((event) => {
    const haystack = `${event.type} ${event.title} ${event.layer}`.toLowerCase();
    return lowerHints.some((hint) => haystack.includes(hint));
  }) ?? null;
}

function SessionCell({ label, value }: { label: string; value: string }) {
  return (
    <article className="rp-session-card">
      <small>{label}</small>
      <strong>{value}</strong>
    </article>
  );
}

function ReplayLoading() {
  return (
    <div className="rp-page">
      <h1 className="sr-only">Rejeu</h1>
      <div className="rp-workspace" role="region" aria-label="Chargement du replay" tabIndex={0}>
        <section className="rp-session-strip">
          {Array.from({ length: 6 }).map((_, index) => <article key={index} className="rp-session-card"><div className="skeleton-line" /></article>)}
        </section>
      </div>
    </div>
  );
}

function formatSignedR(value: number) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2).replace(".", ",")} R`;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}

function formatClock(value: Date | undefined) {
  if (!value) return "—:—:—";
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(value);
}

function formatClockDate(value: Date | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(value);
}
