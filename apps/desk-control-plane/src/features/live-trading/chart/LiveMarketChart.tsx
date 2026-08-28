import { useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { FaArrowsAltH, FaCompressAlt, FaCrosshairs, FaPause, FaPlay, FaSearchMinus, FaSearchPlus, FaSyncAlt } from "react-icons/fa";
import { StatusBadge } from "@/design-system/primitives";
import { presentAvailability, presentGeneric } from "@/design-system/labels";
import { displayTime, displayValue } from "../mapper";
import { LivePanel } from "../LivePanel";
import type { LiveTradingModel } from "../model";
import { resolveSignalTemporalState } from "../signalTemporalState";
import {
  instrumentCode,
  tradePlanOverlayFromIntent,
  tradePlanOverlayFromSignal,
  tradePlanOverlayFromTheoretical,
  visibleTradeOverlay,
  type TradeOverlay,
} from "./tradePlanOverlay";
import { accumulateHorizontalDrag, createViewport, historicalWindowStart, reduceViewport, visibleWindow } from "./viewport";

type MarketScope = { instrument?: string; timeframe?: string };
type OverlayMode = "AUTO" | "ORDER_INTENT" | "THEORETICAL" | "SIGNAL" | "NONE";

export type InstrumentChartPanelProps = {
  model: LiveTradingModel;
  onScopeChange?(scope: MarketScope): void;
  showScopeControls?: boolean;
  requestedScope?: MarketScope;
  loading?: boolean;
  error?: string | null;
  focusAt?: string | null;
};

export function InstrumentChartPanel({
  model,
  onScopeChange,
  showScopeControls = true,
  requestedScope = {},
  loading = false,
  error = null,
  focusAt = null,
}: InstrumentChartPanelProps) {
  const [overlayMode, setOverlayMode] = useState<OverlayMode>("AUTO");
  const instrument = model.marketSeries.instrument ?? "Instrument non publié";
  const timeframe = model.marketSeries.timeframe;
  const chartInstrument = normalizeInstrument(model.marketSeries.instrument);
  const intentOverlay = sameInstrument(chartInstrument, instrumentCode(model.orderIntent))
    ? tradePlanOverlayFromIntent(model.orderIntent)
    : null;
  const theoreticalOverlay = sameInstrument(chartInstrument, model.selectedTheoreticalExecution?.instrument)
    ? tradePlanOverlayFromTheoretical(model.selectedTheoreticalExecution)
    : null;
  const signalOverlay = sameInstrument(chartInstrument, model.latestSignal?.symbol)
    ? tradePlanOverlayFromSignal(model.latestSignal)
    : null;
  const autoOverlay = intentOverlay ?? theoreticalOverlay ?? signalOverlay;
  const overlay = selectOverlay(overlayMode, { intentOverlay, theoreticalOverlay, signalOverlay, autoOverlay });
  const requestedInstrument = normalizeInstrument(requestedScope.instrument);
  const requestedTimeframe = normalizeTimeframe(requestedScope.timeframe);
  const returnedTimeframe = normalizeTimeframe(timeframe);
  const pendingDifferentScope = loading && Boolean(
    (requestedInstrument && requestedInstrument !== chartInstrument)
    || (requestedTimeframe && requestedTimeframe !== returnedTimeframe),
  );
  const markers = useMemo(() => chartMarkers(model, chartInstrument), [chartInstrument, model]);

  return (
    <LivePanel
      title={`${instrument} · ${timeframe ? formatTimeframe(timeframe) : "futures"}`}
      className="lt-panel--chart lt-panel--chart-pro"
      action={<Link to="/events">Audit</Link>}
    >
      <ChartToolbar
        model={model}
        showScopeControls={showScopeControls}
        overlayMode={overlayMode}
        overlays={{ intentOverlay, theoreticalOverlay, signalOverlay, autoOverlay }}
        onOverlayMode={setOverlayMode}
        onScopeChange={onScopeChange}
      />
      <SignalChartContext model={model} chartInstrument={chartInstrument} focusAt={focusAt} />
      <div className="lt-chart-frame" data-availability={model.marketSeries.availability} aria-busy={loading}>
        {model.marketSeries.points.length ? (
          <CandlestickChart
            key={`${chartInstrument}:${returnedTimeframe}`}
            points={model.marketSeries.points}
            overlay={overlay}
            markers={markers}
            scope={`${instrument} ${formatTimeframe(timeframe ?? "")}`}
            refreshing={loading}
            syncLabel={pendingDifferentScope ? `Chargement ${requestedInstrument || instrument} ${formatTimeframe(requestedTimeframe || timeframe || "")}` : "Synchronisation"}
            focusAt={focusAt}
          />
        ) : (
          <ChartEmpty model={model} />
        )}
        {error ? <div className="lt-chart-error" role="alert"><strong>Graphique non actualisé</strong><small>{error}</small></div> : null}
      </div>
      <footer className="lt-chart-footer">
        <span>{model.marketSeries.points.length} bougies clôturées · {model.marketSeries.source} · asOf {displayTime(model.marketSeries.asOf)}</span>
        <OverlayScopeNote model={model} chartInstrument={chartInstrument} />
        <StatusBadge tone={presentAvailability(model.marketSeries.availability).tone}>{presentAvailability(model.marketSeries.availability).label}</StatusBadge>
      </footer>
    </LivePanel>
  );
}

function SignalChartContext({ model, chartInstrument, focusAt }: {
  model: LiveTradingModel;
  chartInstrument: string | null;
  focusAt: string | null;
}) {
  const signal = model.latestSignal;
  if (!signal) return null;
  const temporal = resolveSignalTemporalState(signal, model.meta.asOf);
  const sameScope = sameInstrument(chartInstrument, signal.symbol);
  const hasCoverage = focusAt ? coversTimestamp(model.marketSeries.points, focusAt) : true;
  return (
    <div className="lt-chart-signal-context" data-status={sameScope && hasCoverage ? "ready" : "partial"} role="status">
      <span className="lt-chart-signal-context__marker" aria-hidden="true" />
      <div>
        <strong>{signal.symbol} · {presentGeneric(signal.direction).label} · {temporal.label}</strong>
        <small>Signal {shortSignalId(signal.signalId)} · {displayTime(signal.sourceDataCutoffAt || signal.createdAt)} · fenêtre historique reproductible</small>
      </div>
      <span>{!sameScope ? `Graphique ${chartInstrument ?? "non publié"}` : !hasCoverage ? "Bougies hors fenêtre chargée" : "Signal centré"}</span>
      <Link to={`/live/signals/${encodeURIComponent(signal.signalId)}`}>Dossier complet</Link>
    </div>
  );
}

function ChartToolbar({ model, showScopeControls, overlayMode, overlays, onOverlayMode, onScopeChange }: {
  model: LiveTradingModel;
  showScopeControls: boolean;
  overlayMode: OverlayMode;
  overlays: { intentOverlay: TradeOverlay | null; theoreticalOverlay: TradeOverlay | null; signalOverlay: TradeOverlay | null; autoOverlay: TradeOverlay | null };
  onOverlayMode(mode: OverlayMode): void;
  onScopeChange?(scope: MarketScope): void;
}) {
  const instrumentOptions = optionSet(model.marketSeries.supportedInstruments);
  const timeframeOptions = optionSet(model.marketSeries.supportedTimeframes);
  const options = [
    ["AUTO", "Plan prioritaire", Boolean(overlays.autoOverlay)],
    ["SIGNAL", "Signal", Boolean(overlays.signalOverlay)],
    ["THEORETICAL", "Théorie", Boolean(overlays.theoreticalOverlay)],
    ["ORDER_INTENT", "Post-Risk", Boolean(overlays.intentOverlay)],
    ["NONE", "Sans plan", true],
  ] as const;
  return (
    <div className="lt-chart-toolbar">
      {showScopeControls ? <div className="lt-chart-selector" aria-label="Instrument affiché">{instrumentOptions.map((value) => <button key={value} type="button" aria-pressed={value === model.marketSeries.instrument} onClick={() => onScopeChange?.({ instrument: value })}>{formatInstrumentLabel(value)}</button>)}</div> : null}
      {showScopeControls ? <div className="lt-chart-selector" aria-label="Timeframe affichée">{timeframeOptions.map((value) => <button key={value} type="button" aria-pressed={normalizeTimeframe(value) === normalizeTimeframe(model.marketSeries.timeframe)} onClick={() => onScopeChange?.({ timeframe: value })}>{formatTimeframe(value)}</button>)}</div> : null}
      <div className="lt-chart-selector lt-chart-selector--overlays" aria-label="Plan affiché sur le graphique">
        {options.map(([value, label, enabled]) => <button key={value} type="button" aria-pressed={overlayMode === value} disabled={!enabled} onClick={() => onOverlayMode(value)}>{label}</button>)}
      </div>
      <span>OHLCV · VWAP · étapes backend</span>
    </div>
  );
}

type ChartPoint = LiveTradingModel["marketSeries"]["points"][number];
type ChartMarker = { id: string; at: string; label: string; tone: "signal" | "context" | "intent" | "fill"; selected?: boolean };

function CandlestickChart({ points, overlay, markers, scope, refreshing, syncLabel, focusAt }: {
  points: LiveTradingModel["marketSeries"]["points"];
  overlay?: TradeOverlay | null;
  markers: readonly ChartMarker[];
  scope: string;
  refreshing: boolean;
  syncLabel: string;
  focusAt?: string | null;
}) {
  const drawable = useMemo(() => points.filter(isDrawable), [points]);
  const [viewport, dispatch] = useReducer(reduceViewport, drawable.length, (length) => createViewport(length));
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [volumeRatio, setVolumeRatio] = useState(0.2);
  const previousDrawable = useRef(drawable);
  const viewportRef = useRef(viewport);
  const lastFocusedAt = useRef<string | null>(null);
  const drag = useRef<{ x: number; y: number; mode: "X" | "Y"; remainderPixels: number } | null>(null);

  viewportRef.current = viewport;

  useEffect(() => {
    const previous = previousDrawable.current;
    const currentViewport = viewportRef.current;
    const changed = previous.length !== drawable.length
      || previous[0]?.timestamp !== drawable[0]?.timestamp
      || previous.at(-1)?.timestamp !== drawable.at(-1)?.timestamp;
    if (!changed) return;
    if (!currentViewport.followLatest && previous.length) {
      dispatch({
        type: "RESTORE_WINDOW",
        start: historicalWindowStart(currentViewport, previous.map((point) => point.timestamp), drawable.map((point) => point.timestamp)),
        size: currentViewport.end - currentViewport.start,
        length: drawable.length,
      });
    } else {
      dispatch({ type: "DATA_CHANGED", previousLength: previous.length, length: drawable.length });
    }
    previousDrawable.current = drawable;
  }, [drawable]);

  useEffect(() => {
    if (!focusAt || !drawable.length || lastFocusedAt.current === focusAt) return;
    const index = nearestPointIndex(drawable, focusAt);
    const size = Math.min(48, drawable.length);
    const start = Math.max(0, Math.min(index - Math.floor(size * 0.4), drawable.length - size));
    dispatch({ type: "RESTORE_WINDOW", start, size, length: drawable.length });
    lastFocusedAt.current = focusAt;
  }, [drawable, focusAt]);

  if (!drawable.length) return <div className="lt-chart-empty" role="status"><strong>Connecté, sans bougie</strong><span>Aucune bougie OHLC complète à tracer.</span></div>;
  const range = visibleWindow(viewport, drawable.length);
  const visible = drawable.slice(range.start, range.end);
  const geometry = chartGeometry(visible, overlay, viewport, volumeRatio);
  const hoverPoint = hoverIndex === null ? null : visible[hoverIndex] ?? null;
  const hoverX = hoverIndex === null ? null : geometry.x(hoverIndex);
  const hoverY = typeof hoverPoint?.close === "number" ? geometry.y(hoverPoint.close) : null;
  const visibleMarkers = placeMarkers(markers, visible);
  const panByPixels = (deltaPixels: number, remainderPixels: number) => {
    const accumulated = accumulateHorizontalDrag(remainderPixels, deltaPixels, geometry.plotWidth, visible.length);
    if (accumulated.deltaCandles) dispatch({ type: "PAN_X", delta: accumulated.deltaCandles, length: drawable.length });
    return accumulated.remainderPixels;
  };
  const updateHover = (clientX: number, element: HTMLDivElement) => {
    const rect = element.getBoundingClientRect();
    const svgX = ((clientX - rect.left) / Math.max(rect.width, 1)) * geometry.width;
    const index = Math.max(0, Math.min(visible.length - 1, Math.round((svgX - geometry.left) / Math.max(geometry.step, 1))));
    setHoverIndex(index);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const page = Math.max(1, Math.round(visible.length * (event.shiftKey ? 0.5 : 0.15)));
    if (event.key === "ArrowLeft") dispatch({ type: "PAN_X", delta: -page, length: drawable.length });
    else if (event.key === "ArrowRight") dispatch({ type: "PAN_X", delta: page, length: drawable.length });
    else if (event.key === "ArrowUp") dispatch({ type: "PAN_Y", deltaRatio: 0.08 });
    else if (event.key === "ArrowDown") dispatch({ type: "PAN_Y", deltaRatio: -0.08 });
    else if (event.key === "+" || event.key === "=") dispatch({ type: event.altKey ? "ZOOM_Y" : "ZOOM_X", factor: 0.78, anchor: 0.5, length: drawable.length } as Parameters<typeof dispatch>[0]);
    else if (event.key === "-") dispatch({ type: event.altKey ? "ZOOM_Y" : "ZOOM_X", factor: 1.22, anchor: 0.5, length: drawable.length } as Parameters<typeof dispatch>[0]);
    else if (event.key === "Home") dispatch({ type: "GO_EARLIEST", length: drawable.length });
    else if (event.key === "End") dispatch({ type: "GO_LATEST", length: drawable.length });
    else if (event.key === "0") dispatch({ type: "RESET", length: drawable.length });
    else if (event.key.toLowerCase() === "a") dispatch({ type: "AUTO_Y" });
    else return;
    event.preventDefault();
  };

  return (
    <div
      className="lt-chart-canvas lt-chart-canvas--pro"
      tabIndex={0}
      aria-label={`${scope}. ${visible.length} bougies sur ${drawable.length}. Flèches horizontales pour naviguer, plus et moins pour zoomer, A pour l'échelle prix automatique.`}
      onKeyDown={onKeyDown}
      onWheel={(event) => {
        if (!event.ctrlKey && !event.metaKey && !event.shiftKey) return;
        event.preventDefault();
        if (event.shiftKey) dispatch({ type: "ZOOM_Y", factor: event.deltaY < 0 ? 1.15 : 0.86 });
        else {
          const rect = event.currentTarget.getBoundingClientRect();
          const anchor = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(rect.width, 1)));
          dispatch({ type: "ZOOM_X", factor: event.deltaY < 0 ? 0.84 : 1.18, anchor, length: drawable.length });
        }
      }}
      onPointerDown={(event) => {
        drag.current = { x: event.clientX, y: event.clientY, mode: event.shiftKey || event.altKey ? "Y" : "X", remainderPixels: 0 };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        updateHover(event.clientX, event.currentTarget);
        if (!drag.current) return;
        const deltaX = event.clientX - drag.current.x;
        const deltaY = event.clientY - drag.current.y;
        const remainderPixels = drag.current.mode === "Y"
          ? drag.current.remainderPixels
          : panByPixels(deltaX, drag.current.remainderPixels);
        if (drag.current.mode === "Y") dispatch({ type: "PAN_Y", deltaRatio: deltaY / 500 });
        drag.current = { ...drag.current, x: event.clientX, y: event.clientY, remainderPixels };
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      onPointerLeave={() => { drag.current = null; setHoverIndex(null); }}
    >
      <ChartControls viewport={viewport} length={drawable.length} volumeRatio={volumeRatio} dispatch={dispatch} setVolumeRatio={setVolumeRatio} refreshing={refreshing} syncLabel={syncLabel} />
      <ChartInspectionBar point={hoverPoint ?? visible.at(-1)} inspected={hoverPoint !== null} />
      <svg className="lt-market-chart" viewBox={`0 0 ${geometry.width} ${geometry.height}`} role="img" aria-label={`Graphique OHLCV. Prix de ${geometry.candleMin.toFixed(2)} à ${geometry.candleMax.toFixed(2)}. Échelle affichée ${geometry.min.toFixed(2)} à ${geometry.max.toFixed(2)}.`} preserveAspectRatio="none">
        <SessionAndGapLayer visible={visible} geometry={geometry} />
        <AxisLayer visible={visible} geometry={geometry} />
        {geometry.visibleOverlay ? <TradeZone overlay={geometry.visibleOverlay} y={geometry.y} x1={geometry.x(geometry.anchorIndex)} x2={geometry.width - geometry.right} /> : null}
        <CandleLayer visible={visible} geometry={geometry} />
        <VolumeLayer visible={visible} geometry={geometry} />
        <VwapLayer visible={visible} geometry={geometry} />
        <MarkerLayer markers={visibleMarkers} visible={visible} geometry={geometry} />
        <LatestPriceLayer point={visible.at(-1)} geometry={geometry} />
        {hoverPoint && hoverX !== null && hoverY !== null ? <Crosshair x={hoverX} y={hoverY} geometry={geometry} /> : null}
        {geometry.visibleOverlay ? <TradeLevelLabels overlay={geometry.visibleOverlay} y={geometry.y} x1={geometry.left} x2={geometry.width - geometry.right} labelWidth={geometry.right} /> : null}
      </svg>
      <ChartNavigator points={drawable} viewport={viewport} dispatch={dispatch} />
      <div className="lt-chart-readout">
        <span>{formatAxisTime(visible[0]?.timestamp ?? "")} → {formatAxisTime(visible.at(-1)?.timestamp ?? "")}</span>
        <span>{visible.length}/{drawable.length} bougies · {viewport.followLatest ? "Suivi direct" : "Historique inspecté"}</span>
        {overlay && !geometry.visibleOverlay ? <span className="lt-chart-readout__warning">Plan {overlay.label} hors échelle prix</span> : null}
        {geometry.visibleOverlay && geometry.hiddenOverlayLevelCount ? <span className="lt-chart-readout__warning">{geometry.hiddenOverlayLevelCount} niveau{geometry.hiddenOverlayLevelCount > 1 ? "x" : ""} du plan hors échelle</span> : null}
        {geometry.visibleOverlay ? <span>{geometry.visibleOverlay.label} · {geometry.visibleOverlay.side} · entrée {geometry.visibleOverlay.entry.toFixed(2)}{geometry.visibleOverlay.expiresAt ? ` · expire ${displayTime(geometry.visibleOverlay.expiresAt)}` : ""}</span> : null}
      </div>
      <details className="lt-chart-data-table"><summary>Tableau accessible des bougies visibles</summary><table><thead><tr><th>Heure</th><th>O</th><th>H</th><th>B</th><th>C</th><th>Volume</th><th>VWAP</th></tr></thead><tbody>{visible.slice(-24).map((point) => <tr key={point.timestamp}><td>{formatAxisTime(point.timestamp)}</td><td>{displayValue(point.open)}</td><td>{displayValue(point.high)}</td><td>{displayValue(point.low)}</td><td>{displayValue(point.close)}</td><td>{displayValue(point.volume)}</td><td>{displayValue(point.vwap)}</td></tr>)}</tbody></table></details>
    </div>
  );
}

type Geometry = ReturnType<typeof chartGeometry>;

function ChartControls({ viewport, length, volumeRatio, dispatch, setVolumeRatio, refreshing, syncLabel }: {
  viewport: ReturnType<typeof createViewport>;
  length: number;
  volumeRatio: number;
  dispatch: React.Dispatch<Parameters<typeof reduceViewport>[1]>;
  setVolumeRatio(value: number): void;
  refreshing: boolean;
  syncLabel: string;
}) {
  return <div className="lt-chart-controls" aria-label="Navigation du graphique">
    {[24, 48, 96].map((size) => <button key={size} type="button" onClick={() => dispatch({ type: "SET_RANGE", size, length })}>{size}</button>)}
    <button type="button" onClick={() => dispatch({ type: "ZOOM_X", factor: 0.76, anchor: 0.5, length })} aria-label="Zoomer dans le temps"><FaSearchPlus /></button>
    <button type="button" onClick={() => dispatch({ type: "ZOOM_X", factor: 1.24, anchor: 0.5, length })} aria-label="Dézoomer dans le temps"><FaSearchMinus /></button>
    <button type="button" onClick={() => dispatch({ type: "AUTO_Y" })} aria-label="Ajuster automatiquement l'échelle des prix" aria-pressed={viewport.autoScaleY} title="Ajuster automatiquement l'échelle des prix"><FaCrosshairs aria-hidden="true" /><span>Auto Y</span></button>
    <button type="button" onClick={() => dispatch(viewport.followLatest ? { type: "PAUSE_FOLLOW" } : { type: "GO_LATEST", length })} aria-label={viewport.followLatest ? "Quitter le suivi du dernier prix" : "Revenir au dernier prix"} aria-pressed={viewport.followLatest}>{viewport.followLatest ? <FaPause aria-hidden="true" /> : <FaPlay aria-hidden="true" />}<span>Dernier</span></button>
    <label className="lt-chart-volume-control" title="Ajuster la hauteur du panneau de volume"><FaArrowsAltH aria-hidden="true" /><span>Volume</span><input type="range" min="12" max="32" step="2" value={Math.round(volumeRatio * 100)} onChange={(event) => setVolumeRatio(Number(event.target.value) / 100)} aria-label="Hauteur du panneau de volume en pourcentage" /><output>{Math.round(volumeRatio * 100)}%</output></label>
    <button type="button" onClick={() => dispatch({ type: "RESET", length })} aria-label="Réinitialiser le graphique"><FaCompressAlt aria-hidden="true" /><span>Reset</span></button>
    <span className="lt-chart-sync" data-active={refreshing} role="img" aria-label={refreshing ? syncLabel : "Graphique à jour"} title={refreshing ? syncLabel : "Graphique à jour"}>
      <FaSyncAlt aria-hidden="true" />
      <span>{refreshing ? syncLabel : "À jour"}</span>
    </span>
  </div>;
}

function ChartInspectionBar({ point, inspected }: { point: ChartPoint | undefined; inspected: boolean }) {
  if (!point) return null;
  const range = isFiniteNumber(point.high) && isFiniteNumber(point.low) ? point.high - point.low : null;
  const values = [
    ["O", point.open],
    ["H", point.high],
    ["B", point.low],
    ["C", point.close],
    ["Range", range],
    ["Vol", point.volume],
    ["VWAP", point.vwap],
  ] as const;
  return <div className="lt-chart-inspector" data-inspected={inspected} role="group" aria-label={inspected ? "Données de la bougie inspectée" : "Données de la dernière bougie"} tabIndex={0}>
    <strong><span>{inspected ? "Bougie inspectée" : "Dernière bougie"}</span>{formatFullTime(point.timestamp)}</strong>
    <dl>{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{displayValue(value)}</dd></div>)}</dl>
  </div>;
}

function chartGeometry(visible: readonly ChartPoint[], overlay: TradeOverlay | null | undefined, viewport: ReturnType<typeof createViewport>, volumeRatio: number) {
  const width = 1000;
  const height = 420;
  const left = 72;
  const right = overlay ? 156 : 38;
  const top = 20;
  const bottom = 34;
  const volumeHeight = Math.round((height - top - bottom) * volumeRatio);
  const plotHeight = height - top - bottom - volumeHeight - 8;
  const plotWidth = width - left - right;
  const lows = visible.map((point) => point.low as number);
  const highs = visible.map((point) => point.high as number);
  const candleMin = Math.min(...lows);
  const candleMax = Math.max(...highs);
  const fittedOverlay = visibleTradeOverlay(overlay, candleMin, candleMax);
  const visibleOverlay = fittedOverlay.overlay;
  const overlayPrices = visibleOverlay ? [visibleOverlay.entry, visibleOverlay.stop, ...visibleOverlay.targets.map((target) => target.price)].filter(isFiniteNumber) : [];
  const autoMin = Math.min(candleMin, ...overlayPrices);
  const autoMax = Math.max(candleMax, ...overlayPrices);
  const autoSpan = Math.max(autoMax - autoMin, 0.0001) * 1.08;
  const center = (autoMax + autoMin) / 2 + autoSpan * viewport.yOffset;
  const span = viewport.autoScaleY ? autoSpan : autoSpan / viewport.yZoom;
  const min = center - span / 2;
  const max = center + span / 2;
  const step = visible.length > 1 ? plotWidth / (visible.length - 1) : plotWidth;
  const x = (index: number) => left + index * step;
  const y = (value: number) => top + ((max - value) / Math.max(span, 0.0001)) * plotHeight;
  const anchorIndex = visibleOverlay ? overlayAnchorIndex(visible, visibleOverlay.createdAt) : 0;
  return { width, height, left, right, top, bottom, plotHeight, plotWidth, volumeHeight, volumeTop: top + plotHeight + 8, candleMin, candleMax, min, max, span, step, x, y, anchorIndex, visibleOverlay, hiddenOverlayLevelCount: fittedOverlay.hiddenLevelCount };
}

function AxisLayer({ visible, geometry }: { visible: readonly ChartPoint[]; geometry: Geometry }) {
  const yTicks = Array.from({ length: 6 }, (_, index) => geometry.max - (geometry.span / 5) * index);
  const indexes = uniqueNumbers([0, Math.floor(visible.length * 0.25), Math.floor(visible.length * 0.5), Math.floor(visible.length * 0.75), visible.length - 1]);
  return <g className="lt-market-chart__axis"><g className="lt-market-chart__axis--price">{yTicks.map((tick) => <g key={tick.toFixed(5)}><line x1={geometry.left} x2={geometry.width - geometry.right} y1={geometry.y(tick)} y2={geometry.y(tick)} /><text x={geometry.left - 10} y={geometry.y(tick) + 4} textAnchor="end">{tick.toFixed(2)}</text></g>)}</g><g className="lt-market-chart__axis--time"><line x1={geometry.left} x2={geometry.width - geometry.right} y1={geometry.height - geometry.bottom} y2={geometry.height - geometry.bottom} />{indexes.map((index) => <text key={visible[index]?.timestamp ?? index} x={geometry.x(index)} y={geometry.height - 10} textAnchor={index === 0 ? "start" : index === visible.length - 1 ? "end" : "middle"}>{formatAxisTime(visible[index]?.timestamp ?? "")}</text>)}</g></g>;
}

function CandleLayer({ visible, geometry }: { visible: readonly ChartPoint[]; geometry: Geometry }) {
  const width = Math.max(2, Math.min(9, geometry.step * 0.58));
  return <g className="lt-market-chart__candles">{visible.map((point, index) => { const open = point.open as number; const high = point.high as number; const low = point.low as number; const close = point.close as number; const candleX = geometry.x(index); return <g key={point.timestamp} className={close >= open ? "is-up" : "is-down"}><line x1={candleX} x2={candleX} y1={geometry.y(high)} y2={geometry.y(low)} /><rect x={candleX - width / 2} y={Math.min(geometry.y(open), geometry.y(close))} width={width} height={Math.max(1, Math.abs(geometry.y(open) - geometry.y(close)))} /></g>; })}</g>;
}

function VolumeLayer({ visible, geometry }: { visible: readonly ChartPoint[]; geometry: Geometry }) {
  const maxVolume = Math.max(1, ...visible.map((point) => point.volume ?? 0));
  const width = Math.max(1, Math.min(8, geometry.step * 0.52));
  return <g className="lt-market-chart__volume" aria-hidden="true">{visible.map((point, index) => { const volume = point.volume ?? 0; const barHeight = (volume / maxVolume) * geometry.volumeHeight; return <rect key={point.timestamp} className={(point.close ?? 0) >= (point.open ?? 0) ? "is-up" : "is-down"} x={geometry.x(index) - width / 2} y={geometry.volumeTop + geometry.volumeHeight - barHeight} width={width} height={barHeight} />; })}</g>;
}

function VwapLayer({ visible, geometry }: { visible: readonly ChartPoint[]; geometry: Geometry }) {
  const points = visible.map((point, index) => point.vwap === null ? null : `${geometry.x(index)},${geometry.y(point.vwap)}`).filter(Boolean).join(" ");
  return points ? <polyline className="lt-market-chart__vwap" points={points} fill="none" /> : null;
}

function LatestPriceLayer({ point, geometry }: { point: ChartPoint | undefined; geometry: Geometry }) {
  if (!point || !isFiniteNumber(point.close)) return null;
  const priceY = geometry.y(point.close);
  return <g className="lt-market-chart__last-price"><line x1={geometry.left} x2={geometry.width - geometry.right} y1={priceY} y2={priceY} /><rect x={geometry.width - geometry.right + 6} y={priceY - 10} width={geometry.right - 12} height={20} rx={4} /><text x={geometry.width - geometry.right / 2} y={priceY + 4} textAnchor="middle">LAST {point.close.toFixed(2)}</text></g>;
}

function SessionAndGapLayer({ visible, geometry }: { visible: readonly ChartPoint[]; geometry: Geometry }) {
  const gaps = visible.map((point, index) => ({ index, delta: index ? Date.parse(point.timestamp) - Date.parse(visible[index - 1].timestamp) : 0 })).filter((item) => item.delta > medianInterval(visible) * 2.2);
  return <g className="lt-market-chart__sessions" aria-hidden="true">{visible.map((point, index) => index && utcDate(point.timestamp) !== utcDate(visible[index - 1].timestamp) ? <rect key={point.timestamp} x={geometry.x(index)} y={geometry.top} width={Math.max(1, geometry.step * 0.5)} height={geometry.plotHeight + geometry.volumeHeight + 8} /> : null)}{gaps.map((gap) => <line key={`gap-${gap.index}`} className="lt-market-chart__gap" x1={geometry.x(gap.index)} x2={geometry.x(gap.index)} y1={geometry.top} y2={geometry.volumeTop + geometry.volumeHeight} />)}</g>;
}

function MarkerLayer({ markers, visible, geometry }: { markers: readonly (ChartMarker & { index: number })[]; visible: readonly ChartPoint[]; geometry: Geometry }) {
  return <g className="lt-market-chart__markers">{markers.map((marker, stackIndex) => { const point = visible[marker.index]; const baseY = marker.tone === "fill" ? geometry.y(point.low as number) + 12 : geometry.y(point.high as number) - 12; return <g key={marker.id} className={`lt-market-chart__marker lt-market-chart__marker--${marker.tone}${marker.selected ? " is-selected" : ""}`} transform={`translate(${geometry.x(marker.index)},${baseY - (stackIndex % 3) * 8})`}><circle r={marker.selected ? 5 : 3.5} /><title>{`${marker.label} · ${displayTime(marker.at)}`}</title></g>; })}</g>;
}

function Crosshair({ x, y, geometry }: { x: number; y: number; geometry: Geometry }) {
  return <g className="lt-market-chart__crosshair" aria-hidden="true"><line x1={x} x2={x} y1={geometry.top} y2={geometry.volumeTop + geometry.volumeHeight} /><line x1={geometry.left} x2={geometry.width - geometry.right} y1={y} y2={y} /></g>;
}

function ChartNavigator({ points, viewport, dispatch }: { points: readonly ChartPoint[]; viewport: ReturnType<typeof createViewport>; dispatch: React.Dispatch<Parameters<typeof reduceViewport>[1]> }) {
  const width = 1000; const height = 34; const values = points.map((point) => point.close as number); const min = Math.min(...values); const max = Math.max(...values); const span = Math.max(max - min, 0.0001); const step = points.length > 1 ? width / (points.length - 1) : width; const polyline = values.map((value, index) => `${index * step},${height - 3 - ((value - min) / span) * (height - 6)}`).join(" ");
  return <button type="button" className="lt-chart-navigator" aria-label="Vue d'ensemble, cliquer pour revenir au centre de la plage chargée" onClick={() => dispatch({ type: "SET_RANGE", size: Math.min(96, points.length), length: points.length })}><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true"><polyline points={polyline} fill="none" /><rect x={(viewport.start / points.length) * width} y={1} width={Math.max(8, ((viewport.end - viewport.start) / points.length) * width)} height={height - 2} /></svg><span>Plage chargée</span></button>;
}

function TradeZone({ overlay, y, x1, x2 }: { overlay: TradeOverlay; y(value: number): number; x1: number; x2: number }) {
  const target = overlay.targets[0]?.price ?? null; const entryY = y(overlay.entry); const stopY = overlay.stop === null ? null : y(overlay.stop); const targetY = target === null ? null : y(target);
  return <g className="lt-market-chart__trade-zones" aria-hidden="true">{targetY !== null ? <rect className="lt-market-chart__zone lt-market-chart__zone--profit" x={x1} y={Math.min(entryY, targetY)} width={Math.max(0, x2 - x1)} height={Math.max(1, Math.abs(entryY - targetY))} rx={4} /> : null}{stopY !== null ? <rect className="lt-market-chart__zone lt-market-chart__zone--risk" x={x1} y={Math.min(entryY, stopY)} width={Math.max(0, x2 - x1)} height={Math.max(1, Math.abs(entryY - stopY))} rx={4} /> : null}</g>;
}

function TradeLevelLabels({ overlay, y, x1, x2, labelWidth }: { overlay: TradeOverlay; y(value: number): number; x1: number; x2: number; labelWidth: number }) {
  const rows = [{ label: "ENTRÉE", price: overlay.entry, tone: "entry", ratio: null }, overlay.stop === null ? null : { label: "STOP", price: overlay.stop, tone: "stop", ratio: null }, ...overlay.targets.slice(0, 3).map((target) => ({ label: target.label, price: target.price, tone: "target", ratio: target.ratioR }))].filter((row): row is { label: string; price: number; tone: string; ratio: number | null | undefined } => Boolean(row));
  return <g className="lt-market-chart__levels">{rows.map((row) => { const levelY = y(row.price); return <g key={`${row.label}:${row.price}`} className={`lt-market-chart__level lt-market-chart__level--${row.tone}`}><line x1={x1} x2={x2} y1={levelY} y2={levelY} strokeDasharray={row.tone === "entry" ? "none" : "6 5"} /><rect x={x2 + 6} y={levelY - 12} width={labelWidth - 12} height={24} rx={4} /><text x={x2 + labelWidth / 2} y={levelY + 4} textAnchor="middle">{row.label} {row.price.toFixed(2)}{row.ratio ? ` · ${row.ratio.toFixed(1)}R` : ""}</text></g>; })}</g>;
}

export function chartMarkers(model: LiveTradingModel, instrument: string | null): ChartMarker[] {
  const markers: ChartMarker[] = model.source.signals.filter((signal) => sameInstrument(instrument, signal.symbol)).map((signal) => ({ id: `signal:${signal.signalId}`, at: signal.sourceDataCutoffAt ?? signal.createdAt, label: `${signal.symbol} ${presentGeneric(signal.direction).label} · ${resolveSignalTemporalState(signal, model.meta.asOf).label}`, tone: "signal", selected: signal.signalId === model.latestSignal?.signalId }));
  const context = model.latestContextDecision; if (context?.decidedAt && sameInstrument(instrument, model.latestSignal?.symbol)) markers.push({ id: `context:${context.decisionId}`, at: context.decidedAt, label: `Contexte · ${presentGeneric(context.recommendation).label}`, tone: "context", selected: true });
  if (model.orderIntent?.createdAt && sameInstrument(instrument, instrumentCode(model.orderIntent))) markers.push({ id: `intent:${model.orderIntent.portfolioOrderIntentId}`, at: model.orderIntent.createdAt, label: `OrderIntent · ${presentGeneric(model.orderIntent.state).label}`, tone: "intent", selected: true });
  const theoretical = model.selectedTheoreticalExecution; if (theoretical && sameInstrument(instrument, theoretical.instrument)) { if (theoretical.entryFilledAt) markers.push({ id: `fill:${theoretical.tradeId}`, at: theoretical.entryFilledAt, label: "Entrée théorique exécutée", tone: "fill", selected: true }); if (theoretical.exitAt) markers.push({ id: `exit:${theoretical.tradeId}`, at: theoretical.exitAt, label: `Sortie théorique · ${presentGeneric(theoretical.status).label}`, tone: "fill", selected: true }); }
  return markers;
}

function placeMarkers(markers: readonly ChartMarker[], visible: readonly ChartPoint[]): (ChartMarker & { index: number })[] { const start = Date.parse(visible[0]?.timestamp ?? ""); const end = Date.parse(visible.at(-1)?.timestamp ?? ""); return markers.map((marker) => ({ ...marker, index: nearestPointIndex(visible, marker.at) })).filter((marker) => { const at = Date.parse(marker.at); return Number.isFinite(at) && at >= start && at <= end; }); }
function nearestPointIndex(points: readonly ChartPoint[], at: string): number { const target = Date.parse(at); let best = 0; let distance = Number.POSITIVE_INFINITY; points.forEach((point, index) => { const next = Math.abs(Date.parse(point.timestamp) - target); if (next < distance) { best = index; distance = next; } }); return best; }
function overlayAnchorIndex(points: readonly ChartPoint[], at?: string | null): number { const target = Date.parse(at || ""); if (!Number.isFinite(target)) return 0; const index = points.findIndex((point) => Date.parse(point.timestamp) >= target); return index >= 0 ? index : Math.max(0, points.length - 1); }
function medianInterval(points: readonly ChartPoint[]): number { const deltas = points.slice(1).map((point, index) => Date.parse(point.timestamp) - Date.parse(points[index].timestamp)).filter((value) => value > 0).sort((a, b) => a - b); return deltas[Math.floor(deltas.length / 2)] ?? Number.POSITIVE_INFINITY; }
function isDrawable(point: ChartPoint): boolean { return [point.open, point.high, point.low, point.close].every(isFiniteNumber); }
function isFiniteNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function sameInstrument(left: unknown, right: unknown): boolean { const a = normalizeInstrument(left); const b = normalizeInstrument(right); return Boolean(a && b && a === b); }
function normalizeInstrument(value: unknown): string | null { return String(value ?? "").trim().toUpperCase() || null; }
function normalizeTimeframe(value: unknown): string { const normalized = String(value ?? "").trim().toUpperCase().replace(/^M/, ""); if (["H1", "1H", "60"].includes(normalized)) return "60"; if (["H4", "4H", "240"].includes(normalized)) return "240"; if (["D", "D1", "1D", "1440"].includes(normalized)) return "D"; return normalized; }
function coversTimestamp(points: readonly ChartPoint[], at: string): boolean { const target = Date.parse(at); const start = Date.parse(points[0]?.timestamp ?? ""); const end = Date.parse(points.at(-1)?.timestamp ?? ""); return Number.isFinite(target) && Number.isFinite(start) && Number.isFinite(end) && target >= start && target <= end; }
function shortSignalId(value: string): string { return value.length > 30 ? `${value.slice(0, 15)}…${value.slice(-10)}` : value; }
function optionSet(values: readonly (string | null | undefined)[]): string[] { return [...new Set(values.map((value) => String(value ?? "").trim().toUpperCase()).filter(Boolean))]; }
function formatInstrumentLabel(value: string): string { if (value === "MNQ") return "MNQ · MQ"; if (value === "MES") return "MES · MS"; return value; }
function formatTimeframe(value: string): string { const normalized = normalizeTimeframe(value); if (normalized === "60") return "H1"; if (normalized === "240") return "H4"; if (normalized === "D") return "D1"; return normalized ? `M${normalized}` : "—"; }
function formatAxisTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date); }
function formatFullTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date); }
function utcDate(value: string): string { return value.slice(0, 10); }
function uniqueNumbers(values: readonly number[]): number[] { return [...new Set(values.filter((value) => Number.isFinite(value) && value >= 0))]; }
function selectOverlay(mode: OverlayMode, values: { intentOverlay: TradeOverlay | null; theoreticalOverlay: TradeOverlay | null; signalOverlay: TradeOverlay | null; autoOverlay: TradeOverlay | null }): TradeOverlay | null { if (mode === "NONE") return null; if (mode === "ORDER_INTENT") return values.intentOverlay; if (mode === "THEORETICAL") return values.theoreticalOverlay; if (mode === "SIGNAL") return values.signalOverlay; return values.autoOverlay; }
function ChartEmpty({ model }: { model: LiveTradingModel }) { return <div className="lt-chart-empty" role="status"><strong>{presentAvailability(model.marketSeries.availability).label}</strong><span>{model.marketSeries.reason}</span><small>{model.marketSeries.source} · asOf {displayTime(model.marketSeries.asOf)}</small></div>; }
function OverlayScopeNote({ model, chartInstrument }: { model: LiveTradingModel; chartInstrument: string | null }) { const intentInstrument = instrumentCode(model.orderIntent); const theoreticalInstrument = normalizeInstrument(model.selectedTheoreticalExecution?.instrument); const signalInstrument = normalizeInstrument(model.latestSignal?.symbol); if (model.orderIntent && !sameInstrument(chartInstrument, intentInstrument)) return <span className="lt-chart-scope-note">Niveaux {intentInstrument ?? "—"} masqués sur chart {chartInstrument ?? "—"} · dossier post-Risk conservé</span>; if (!model.orderIntent && model.selectedTheoreticalExecution && !sameInstrument(chartInstrument, theoreticalInstrument)) return <span className="lt-chart-scope-note">Suivi {theoreticalInstrument ?? "—"} conservé hors du chart {chartInstrument ?? "—"}</span>; if (!model.orderIntent && !model.selectedTheoreticalExecution && model.latestSignal && !sameInstrument(chartInstrument, signalInstrument)) return <span className="lt-chart-scope-note">Signal {signalInstrument ?? "—"} conservé hors du chart {chartInstrument ?? "—"}</span>; return null; }
