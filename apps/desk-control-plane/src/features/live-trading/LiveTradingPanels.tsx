import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { FaCheck, FaCompress, FaExclamationTriangle, FaExpand, FaInfoCircle, FaLock, FaRobot, FaTimes } from "react-icons/fa";
import { StatusBadge } from "@/design-system/primitives";
import { presentAvailability, presentExecutionMode, presentGeneric, presentRuntimeStatus, presentSignalState } from "@/design-system/labels";
import { presentBackendStatus } from "@/features/order-intent/statusRegistry";
import { displayTime, displayValue, liveTone, recordValue } from "./mapper";
import type { LiveTradingModel } from "./model";

export function LivePanel({ title, className = "", action, children, expandable = true }: { title: string; className?: string; action?: ReactNode; children: ReactNode; expandable?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [expanded]);
  return <>
    {expanded ? <button type="button" className="lt-panel-backdrop" onClick={() => setExpanded(false)} aria-label={`Fermer ${title}`} /> : null}
    <section className={`lt-panel ${className}${expanded ? " lt-panel--expanded" : ""}`} role={expanded ? "dialog" : undefined} aria-modal={expanded || undefined} aria-label={expanded ? title : undefined}>
      <header>
        <h2>{title}</h2>
        {expandable ? <button type="button" className="lt-panel-expand" onClick={() => setExpanded((value) => !value)} aria-label={expanded ? `Réduire ${title}` : `Agrandir ${title}`}>{expanded ? <FaCompress /> : <FaExpand />}</button> : null}
        <FaInfoCircle aria-hidden="true" />
        {action ? <div>{action}</div> : null}
      </header>
      <div className="lt-panel__body">{children}</div>
    </section>
  </>;
}

export function MarketContextPanel({ model }: { model: LiveTradingModel }) {
  return <LivePanel title="Contexte marché" className="lt-panel--market"><table><thead><tr><th>Symbole</th><th>Dernier</th><th>Var%</th><th>Tendance</th></tr></thead><tbody>{model.watchlist.map((item) => <tr key={item.symbol}><td>{item.symbol}</td><td>{item.last === null ? "—" : item.last.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}</td><td className={item.changePct === null ? "" : `lt-tone--${item.changePct >= 0 ? "success" : "danger"}`}>{item.changePct === null ? "—" : `${item.changePct >= 0 ? "+" : ""}${item.changePct.toFixed(2)}%`}</td><td><Sparkline values={item.trend} positive={(item.changePct ?? 0) >= 0} /></td></tr>)}</tbody></table><TruthEmpty when={!model.watchlist.length} status="WATCHLIST NON PUBLIÉE" label="Aucun instantané de marché live n'est disponible." /><footer><StatusBadge tone={presentAvailability(model.freshness.marketData).tone}>{presentAvailability(model.freshness.marketData).label}</StatusBadge><span>Fraîcheur de la source de marché</span></footer></LivePanel>;
}

function Sparkline({ values, positive }: { values: readonly number[]; positive: boolean }) {
  if (values.length < 2) return <span className="lt-sparkline-empty">—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 0.0001);
  const width = 64;
  const height = 22;
  const step = width / (values.length - 1);
  const points = values.map((value, index) => `${index * step},${height - ((value - min) / span) * (height - 4) - 2}`).join(" ");
  return <svg className={`lt-sparkline ${positive ? "is-positive" : "is-negative"}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true"><polyline points={points} fill="none" /></svg>;
}

export function StrategyInstancesPanel({ model }: { model: LiveTradingModel }) {
  const visibleInstances = model.strategyInstances.slice(0, 4);
  const totalInstances = model.strategyInstances.length;
  const strategyAction = totalInstances ? (
    <Link className="lt-panel-action-link" to="/strategies/deployments" aria-label={`Voir toutes les instances de stratégie, ${totalInstances} publiées`}>
      Voir toutes <span>{totalInstances}</span>
    </Link>
  ) : null;
  return (
    <LivePanel title="Instances de stratégie actives" className="lt-panel--strategies" action={strategyAction}>
      <table>
        <caption className="sr-only">{`${visibleInstances.length} instances affichées sur ${totalInstances} instances publiées par le backend`}</caption>
        <thead><tr><th scope="col">Stratégie</th><th scope="col">Statut</th><th scope="col">Prochaine éval.</th><th scope="col">Confiance</th></tr></thead>
        <tbody>{visibleInstances.map((item) => <tr key={item.strategyInstanceId}><td><Link to={`/strategies/${encodeURIComponent(item.strategyDefinitionId)}?instanceId=${encodeURIComponent(item.strategyInstanceId)}`} title={item.strategyInstanceId}>{item.name ?? shortId(item.strategyInstanceId)}</Link></td><td><StatusBadge tone={presentRuntimeStatus(item.runtimeState).tone}>{presentRuntimeStatus(item.runtimeState).label}</StatusBadge></td><td>{item.runtimeState === "MARKET_CLOSED" ? "À la réouverture" : displayTime(item.nextEvaluationAt)}</td><td>{typeof item.confidence !== "number" || Number.isNaN(item.confidence) ? <span className="lt-confidence-empty" title="Aucun signal actif pour cette instance">—</span> : <span className="lt-confidence-chip" title="Confiance du dernier signal actif de cette instance">{Math.round(item.confidence)}%</span>}</td></tr>)}</tbody>
      </table>
      <TruthEmpty when={!model.strategyInstances.length} status="AUCUNE INSTANCE ACTIVE" label="Aucune Strategy Instance active n'est publiée par le registre." />
    </LivePanel>
  );
}

export function MacroSessionPanel({ model }: { model: LiveTradingModel }) {
  return <LivePanel title="Macro / Session" className="lt-panel--macro"><dl className="lt-definition-list lt-definition-list--terms"><Pair label="Session" value={model.source.session.activeSession ?? model.source.session.phase} /><Pair label="État marché" value={model.source.session.marketState ?? model.source.session.marketDataStatus} /><Pair label="Date de trading" value={model.source.session.tradingDate} /><Pair label="Fuseau horaire" value={model.source.session.exchangeTimezone ?? "—"} /><Pair label="Dernière connue" value={displayTime(model.source.session.lastKnownAt)} /><Pair label="Coupure signal" value={displayTime(model.freshness.signalCutoffAt)} /></dl><p className="lt-panel-note">Macro/news : {presentAvailability(model.source.macroSession ? String(model.source.macroSession.availability ?? "KNOWN") : "UNAVAILABLE").label}</p></LivePanel>;
}

export function InstrumentChartPanel({ model, onScopeChange }: { model: LiveTradingModel; onScopeChange?: (scope: { instrument?: string; timeframe?: string }) => void }) {
  const signal = model.latestSignal;
  const instrument = model.marketSeries.instrument ?? signal?.symbol ?? "Instrument";
  const timeframe = model.marketSeries.timeframe;
  const instrumentOptions = optionSet([model.marketSeries.instrument, ...model.marketSeries.supportedInstruments, "MNQ", "MES", "ZC", "ZW"]);
  const timeframeOptions = optionSet([model.marketSeries.timeframe, ...model.marketSeries.supportedTimeframes, "1", "5", "15", "60", "240"]);
  const intent = model.orderIntent;
  const intentInstrument = instrumentCode(intent);
  const theoretical = model.selectedTheoreticalExecution;
  const theoreticalInstrument = instrumentCode({ symbol: theoretical?.instrument });
  const signalInstrument = instrumentCode({ symbol: signal?.symbol });
  const chartInstrument = instrumentCode({ symbol: model.marketSeries.instrument ?? instrument });
  const canOverlayIntent = Boolean(intent && intentInstrument && chartInstrument && intentInstrument === chartInstrument);
  const canOverlayTheoretical = Boolean(!canOverlayIntent && theoretical && theoreticalInstrument && chartInstrument && theoreticalInstrument === chartInstrument);
  const canOverlaySignal = Boolean(!canOverlayIntent && !canOverlayTheoretical && signal && signalInstrument && chartInstrument && signalInstrument === chartInstrument);
  const overlay = canOverlayIntent
    ? tradePlanOverlayFromIntent(intent)
    : canOverlayTheoretical
      ? tradePlanOverlayFromTheoretical(theoretical)
      : canOverlaySignal
        ? tradePlanOverlayFromSignal(signal)
        : null;
  return (
    <LivePanel title={`${instrument} · ${timeframe ? formatTimeframe(timeframe) : "futures"}`} className="lt-panel--chart" action={<Link to="/events">Audit</Link>}>
      <div className="lt-chart-toolbar">
        <div className="lt-chart-selector" aria-label="Instrument affiché">
          {instrumentOptions.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === model.marketSeries.instrument}
              onClick={() => onScopeChange?.({ instrument: option })}
            >
              {formatInstrumentLabel(option)}
            </button>
          ))}
        </div>
        <div className="lt-chart-selector lt-chart-selector--timeframes" aria-label="Timeframe affichée">
          {timeframeOptions.map((frame) => (
            <button
              key={frame}
              type="button"
              aria-pressed={frame === timeframe}
              onClick={() => onScopeChange?.({ timeframe: frame })}
            >
              {formatTimeframe(frame)}
            </button>
          ))}
        </div>
        <span>OHLCV · VWAP · signals · intents</span>
      </div>
      <div className="lt-chart-frame" data-availability={model.marketSeries.availability}>
        {model.marketSeries.points.length ? <CandlestickChart points={model.marketSeries.points} overlay={overlay} /> : <><div className="lt-chart-grid" aria-hidden="true" /><div className="lt-chart-empty" role="status"><strong>{presentAvailability(model.marketSeries.availability).label}</strong><span>{model.marketSeries.reason}</span><small>{model.marketSeries.source} · asOf {displayTime(model.marketSeries.asOf)}</small></div></>}
      </div>
      <footer className="lt-chart-footer">
        <span>{model.marketSeries.points.length} bougies clôturées · source {model.marketSeries.source}</span>
        {intent && !canOverlayIntent ? <span className="lt-chart-scope-note">Niveaux {intentInstrument || "intent"} masqués sur chart {chartInstrument || "—"}</span> : null}
        {!intent && theoretical && !canOverlayTheoretical ? <span className="lt-chart-scope-note">Tracking {theoreticalInstrument || "intent"} masqué sur chart {chartInstrument || "—"}</span> : null}
        {!intent && !theoretical && signal && !canOverlaySignal ? <span className="lt-chart-scope-note">Signal {signalInstrument || "signal"} masqué sur chart {chartInstrument || "—"}</span> : null}
        <StatusBadge tone={presentAvailability(model.marketSeries.availability).tone}>{presentAvailability(model.marketSeries.availability).label}</StatusBadge>
      </footer>
    </LivePanel>
  );
}

export function LatestSignalPanel({ model }: { model: LiveTradingModel }) {
  const signal = model.latestSignal;
  return <LivePanel title="Dernier signal stratégie" className="lt-panel--signal">{signal ? <><div className="lt-signal-hero"><span><small>Instrument</small><strong>{signal.symbol}</strong></span><span><small>Direction</small><strong className={`lt-tone--${signal.direction === "LONG" ? "success" : "danger"}`}>{signal.direction}</strong></span><span><small>Confiance</small><strong>{signal.confidence}%</strong></span></div><dl className="lt-definition-list"><Pair label="Stratégie" value={shortId(signal.strategyId)} /><Pair label="État" value={presentSignalState(signal.state).label} /><Pair label="Régime" value={presentGeneric(signal.regime).label} /><Pair label="R attendu" value={`${displayValue(signal.expectancyR)} R`} /><Pair label="Gain / Risque" value={displayValue(signal.rewardRisk)} /><Pair label="Expire" value={displayTime(signal.expiresAt)} /></dl><div className="lt-tags">{signal.ruleHits.map((rule) => <span key={rule}>{rule}</span>)}</div><Link className="lt-detail-link" to={`/live/signals/${encodeURIComponent(signal.signalId)}`}>Ouvrir le dossier signal</Link></> : <TruthEmpty status="AUCUN SIGNAL ACTUEL" label="Aucun StrategySignal n'a été publié pour la session ; le moteur n'invente pas d'opportunité." />}</LivePanel>;
}

export function RiskAuthorityPanel({ model }: { model: LiveTradingModel }) {
  const context = model.latestContextDecision;
  const risk = model.source.canonicalRuntime.riskCenter;
  return <LivePanel title="Contexte IA / Portefeuille / Risque global" className="lt-panel--risk"><div className="lt-authority-stack"><AuthorityRow label="Contexte IA" value={context?.recommendation ?? "CONNECTED_EMPTY"} detail={context?.reasonCodes.join(", ") || "Aucune décision consultative"} advisory /><AuthorityRow label="Portefeuille" value={model.orderIntent ? "ORDER_INTENT_PUBLISHED" : "CONNECTED_EMPTY"} detail={model.orderIntent?.portfolioOrderIntentId ?? "Aucune intention post-netting"} /><AuthorityRow label="Risque global" value={risk.globalStatus ?? risk.availability} detail={risk.reason || risk.openRisk?.reasonCode || "Source portfolio_risk_decisions"} /></div><div className="lt-risk-comparison"><span><small>Demandé</small><strong>{displayValue(recordValue(model.orderIntent?.riskSnapshot, ["requestedQty"]))}</strong></span><span><small>Autorisé</small><strong>{displayValue(recordValue(model.orderIntent?.riskSnapshot, ["authorizedQty"]))}</strong></span><span><small>Coupe-circuit</small><strong>{presentAvailability(risk.killSwitch?.availability === "KNOWN" ? risk.killSwitch.active ? "ACTIVE" : "OFF" : "UNAVAILABLE").label}</strong></span></div></LivePanel>;
}

export function OrderIntentPanel({ model }: { model: LiveTradingModel }) {
  const intent = model.orderIntent;
  const terms = intent?.executionTerms;
  const target = model.targetPosition;
  return <LivePanel title="Position cible & OrderIntent" className="lt-panel--intent">{intent ? <><div className="lt-readonly"><FaLock aria-hidden="true" />LECTURE SEULE APRÈS RISQUE</div><dl className="lt-definition-list lt-definition-list--terms"><Pair label="Instrument" value={displayValue(instrumentCode(intent))} /><Pair label="Sens" value={intent.side} /><Pair label="Qté autorisée" value={displayValue(recordValue(intent.riskSnapshot, ["authorizedQty", "authorized_qty"]) ?? intent.quantity)} /><Pair label="Type d'ordre" value={displayValue(recordValue(terms, ["order_type", "orderType"]) ?? intent.type)} /><Pair label="Entrée" value={displayValue(priceValue(recordValue(terms, ["entry"])) ?? intent.limitPrice)} /><Pair label="Stop" value={displayValue(priceValue(recordValue(terms, ["stop"])) ?? intent.stopPrice)} /><Pair label="Cible" value={displayValue(firstTargetPrice(terms) ?? intent.targetPrice)} /><Pair label="Compte" value={displayValue(recordValue(terms, ["account_id", "accountId"]) ?? intent.account)} /><Pair label="ID Position cible" value={displayValue(recordValue(target, ["targetPositionId", "target_position_id"]) ?? intent.targetPositionId)} /><Pair label="Delta théorique" value={displayValue(recordValue(target, ["deltaSize", "delta_size"]))} /></dl><Link className="lt-detail-link" to={intent.route}>Ouvrir le dossier canonique</Link></> : <TruthEmpty status="AUCUNE INTENTION EN ATTENTE" label="Aucun OrderIntent post-Risk n'est publié ; aucun terme de trade n'est supposé." />}</LivePanel>;
}

export function ProviderRuntimePanel({ model }: { model: LiveTradingModel }) {
  const provider = model.provider;
  const lifecycle = model.source.canonicalRuntime.pipeline.filter((step) => ["EXECUTION_GATEWAY", "PROVIDER_EVENTS"].includes(step.stepId));
  return <LivePanel title="Runtime fournisseur" className="lt-panel--provider" action={<span>{provider ? provider.label : "Aucun état fournisseur"}</span>}><ol className="lt-provider-steps">{lifecycle.map((step, index) => <li key={step.stepId}><i aria-hidden="true">{index + 1}</i><span>{step.label} · {presentGeneric(step.status).label}</span></li>)}</ol><TruthEmpty when={!lifecycle.length} status="DÉSACTIVÉ PAR POLITIQUE" label="L'exécution physique est fermée ; aucun lifecycle provider n'est attendu." /><footer><span>Un accusé de réception n'est pas une exécution.</span>{provider ? <StatusBadge tone={presentAvailability(provider.status).tone}>{presentAvailability(provider.status).label}</StatusBadge> : <StatusBadge tone="warning">Désactivé par politique</StatusBadge>}</footer></LivePanel>;
}

export function ReconciliationPanel({ model }: { model: LiveTradingModel }) {
  const inSync = model.reconciliation.status === "PASS" || model.reconciliation.status === "MATCHED";
  return <LivePanel title="Réconciliation de position" className="lt-panel--reconciliation"><div className="lt-reconciliation"><section><h3>Suivi théorique (Backend)</h3>{model.reconciliation.expected ? <RecordTable record={model.reconciliation.expected} /> : <TruthEmpty status="AUCUN SUIVI THÉORIQUE" label="Aucun état théorique entry/expiry/TP/SL n'est encore publié par le backend." />}</section><section><h3>Position broker (Simulée)</h3>{model.reconciliation.broker ? <RecordTable record={model.reconciliation.broker} /> : <TruthEmpty status="NON APPLICABLE" label="L'exécution physique est désactivée ; aucun snapshot broker n'est attendu." />}</section><aside className={inSync ? "lt-reconciliation__badge--sync" : "lt-reconciliation__badge--diff"}><span className="lt-reconciliation__icon">{inSync ? <FaCheck /> : <FaExclamationTriangle />}</span><strong>{presentBackendStatus(model.reconciliation.status).known ? presentBackendStatus(model.reconciliation.status).label : model.reconciliation.status}</strong><span>{model.reconciliation.detail}</span><small>asOf {displayTime(model.reconciliation.asOf)}</small></aside></div></LivePanel>;
}

function RecordTable({ record }: { record: Record<string, unknown> }) {
  const entries = Object.entries(record).slice(0, 6);
  return <table className="lt-reconciliation__table"><tbody>{entries.map(([key, value]) => <tr key={key}><th>{presentGeneric(key).label}</th><td>{displayValue(value)}</td></tr>)}</tbody></table>;
}

export function AuditTimelinePanel({ model }: { model: LiveTradingModel }) {
  return <LivePanel title="Chronologie événements / Flux d'audit" className="lt-panel--timeline" action={<Link to="/events">Tous les événements</Link>}><ol>{model.timeline.slice(0, 8).map((event) => <li key={event.eventId}><time dateTime={event.at}>{displayTime(event.at)}</time><i className={`lt-tone--${liveTone(event.tone)}`} aria-hidden="true" /><span><strong>{event.title}</strong><small>{event.step} · {event.detail}</small></span></li>)}</ol><TruthEmpty when={!model.timeline.length} label="Aucun événement Live autoritaire dans la projection." /></LivePanel>;
}

export function PerformancePanel({ model }: { model: LiveTradingModel }) {
  const perf = model.performance;
  const hasSeries = perf.series.length > 0;
  return <LivePanel title="Recherche / Performance (Aujourd'hui)" className="lt-panel--performance"><div className="lt-performance-metrics"><span><small>Échantillon</small><strong>{displayValue(perf.sampleSize)}</strong></span><span><small>Taux de réussite</small><strong>{perf.hitRatePct === null ? "—" : `${perf.hitRatePct.toFixed(1)}%`}</strong></span><span><small>Total R</small><strong>{perf.totalR === null ? "—" : `${perf.totalR.toFixed(2)}R`}</strong></span><span><small>Drawdown R</small><strong>{perf.drawdownR === null ? "—" : `${perf.drawdownR.toFixed(2)}R`}</strong></span></div>{hasSeries ? <EquityCurve series={perf.series} /> : <div className="lt-performance-empty"><strong>{presentAvailability(perf.availability).label} · {presentGeneric(perf.sourceType).label}</strong><span>{perf.reason}</span></div>}</LivePanel>;
}

function EquityCurve({ series }: { series: LiveTradingModel["performance"]["series"] }) {
  const values = series.map((point) => point.cumulativeR);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = Math.max(max - min, 0.0001);
  const width = 600;
  const height = 120;
  const step = series.length > 1 ? width / (series.length - 1) : 0;
  const y = (value: number) => height - ((value - min) / span) * (height - 12) - 6;
  const points = series.map((point, index) => `${index * step},${y(point.cumulativeR)}`).join(" ");
  const zeroY = y(0);
  const latest = values.at(-1) ?? 0;
  return <div className="lt-equity-curve"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Courbe R cumulé, ${series.length} points, dernière valeur ${latest.toFixed(2)}R`} preserveAspectRatio="none"><line className="lt-equity-curve__zero" x1={0} x2={width} y1={zeroY} y2={zeroY} /><polyline className={`lt-equity-curve__line ${latest >= 0 ? "is-positive" : "is-negative"}`} points={points} fill="none" /></svg></div>;
}

export function JarvisPanel({ model }: { model: LiveTradingModel }) {
  return <LivePanel title="Avis Jarvis (Consultatif uniquement)" className="lt-panel--jarvis"><div className="lt-jarvis"><FaRobot aria-hidden="true" /><p>{model.source.aiAdvisory.summary || "Aucun contexte consultatif publié."}</p><small>Mode {presentExecutionMode(model.source.aiAdvisory.mode).label} · asOf {displayTime(model.source.aiAdvisory.lastContextAt)}</small></div><footer>Jarvis est uniquement consultatif et ne passe aucun ordre.</footer></LivePanel>;
}

function AuthorityRow({ label, value, detail, advisory = false }: { label: string; value: string; detail: string; advisory?: boolean }) { return <article><span>{advisory ? <FaRobot /> : value === "UNAVAILABLE" ? <FaExclamationTriangle /> : <FaCheck />}</span><div><small>{label}{advisory ? " · Avis consultatif" : ""}</small><StatusBadge tone={presentAvailability(value).tone}>{presentAvailability(value).label}</StatusBadge><p>{detail}</p></div></article>; }
function Pair({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function TruthEmpty({ when = true, label, status = "ÉTAT VIDE CONFIRMÉ" }: { when?: boolean; label: string; status?: string }) { return when ? <div className="lt-empty" role="status"><FaTimes aria-hidden="true" /><strong>{status}</strong><span>{label}</span></div> : null; }
function shortId(value: string) { return value.length > 25 ? `${value.slice(0, 22)}…` : value; }
function priceValue(value: unknown): unknown { if (!value || typeof value !== "object") return value; const record = value as Record<string, unknown>; return record.price ?? record.value; }
function firstTargetPrice(terms: Record<string, unknown> | null | undefined): unknown { const targets = recordValue(terms, ["targets"]); if (Array.isArray(targets) && targets.length) return priceValue(targets[0]); return undefined; }
function finitePrice(value: unknown): number | null { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : null; }
function instrumentCode(intent: unknown): string | null {
  if (!intent || typeof intent !== "object") return null;
  const record = intent as Record<string, unknown>;
  return String(record.symbol ?? record.instrument ?? recordValue(record.executionTerms as Record<string, unknown> | null, ["instrument", "instrument_code", "symbol"]) ?? "").trim().toUpperCase() || null;
}

type TradeOverlayTarget = { label: string; price: number; ratioR?: number | null };
type TradeOverlay = {
  source: "ORDER_INTENT" | "THEORETICAL_EXECUTION" | "SIGNAL";
  label: string;
  instrument: string | null;
  side: "LONG" | "SHORT";
  entry: number;
  stop: number | null;
  targets: readonly TradeOverlayTarget[];
  createdAt?: string | null;
  expiresAt?: string | null;
  status?: string | null;
};

function tradePlanOverlayFromIntent(intent: LiveTradingModel["orderIntent"]): TradeOverlay | null {
  if (!intent) return null;
  const terms = intent.executionTerms;
  const entry = finitePrice(
    priceValue(recordValue(terms, ["entry"]))
    ?? recordValue(terms, ["entry_price", "entryPrice"])
    ?? intent.limitPrice,
  );
  if (entry === null) return null;
  const stop = finitePrice(
    priceValue(recordValue(terms, ["stop"]))
    ?? recordValue(terms, ["stop_price", "stopPrice"])
    ?? intent.stopPrice,
  );
  const targets = tradeTargetsFrom(recordValue(terms, ["targets"]));
  const intentTarget = finitePrice(firstTargetPrice(terms) ?? intent.targetPrice);
  const allTargets = targets.length || intentTarget === null ? targets : [{ label: "T1", price: intentTarget }];
  return {
    source: "ORDER_INTENT",
    label: "OrderIntent post-risk",
    instrument: instrumentCode(intent),
    side: normalizeTradeSide(intent.side),
    entry,
    stop,
    targets: allTargets,
    createdAt: intent.createdAt ?? null,
    expiresAt: intent.allowedActions.expiresAt,
    status: intent.humanGate.status,
  };
}

function tradePlanOverlayFromTheoretical(row: LiveTradingModel["selectedTheoreticalExecution"]): TradeOverlay | null {
  if (!row) return null;
  const entry = finitePrice(row.entry);
  const stop = finitePrice(row.stop);
  if (entry === null) return null;
  return {
    source: "THEORETICAL_EXECUTION",
    label: "Suivi théorique backend",
    instrument: row.instrument,
    side: normalizeTradeSide(row.side),
    entry,
    stop,
    targets: tradeTargetsFrom(row.targets),
    createdAt: row.sourceCandleAt || row.latestEventAt,
    expiresAt: null,
    status: row.status,
  };
}

function tradePlanOverlayFromSignal(signal: LiveTradingModel["latestSignal"]): TradeOverlay | null {
  if (!signal) return null;
  const plan = signal.proposedTradePlan ?? {};
  const setup = signal.setup ?? {};
  const economics = signal.tradePlanEconomics ?? {};
  const entry = finitePrice(
    priceValue(recordValue(plan, ["entry"]))
    ?? recordValue(economics, ["entry_price", "entryPrice"])
    ?? recordValue(setup, ["entry_price", "entryPrice", "entry"])
    ?? entryFromZone(recordValue(setup, ["entry_zone", "entryZone"]) ?? recordValue(plan, ["entry_zone", "entryZone"])),
  );
  if (entry === null) return null;
  const stop = finitePrice(
    priceValue(recordValue(plan, ["stop"]))
    ?? recordValue(economics, ["stop_price", "stopPrice"])
    ?? recordValue(setup, ["stop_price", "stopPrice", "stop", "stop_loss", "stopLoss"]),
  );
  const targets = tradeTargetsFrom(recordValue(plan, ["targets"]))
    .concat(tradeTargetsFrom(recordValue(setup, ["targets", "take_profit_targets", "takeProfitTargets", "target_prices", "targetPrices"])))
    .concat(tradeTargetsFrom(recordValue(economics, ["targets"])));
  return {
    source: "SIGNAL",
    label: "Dernier signal tradable",
    instrument: signal.symbol,
    side: normalizeTradeSide(signal.direction),
    entry,
    stop,
    targets: uniqueTargets(targets),
    createdAt: signal.sourceDataCutoffAt ?? signal.createdAt,
    expiresAt: signal.expiresAt,
    status: signal.availability ?? signal.state,
  };
}

function normalizeTradeSide(value: unknown): "LONG" | "SHORT" {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "SELL" || normalized === "SHORT") return "SHORT";
  return "LONG";
}

function tradeTargetsFrom(value: unknown): TradeOverlayTarget[] {
  const items = Array.isArray(value) ? value : value == null ? [] : [value];
  return items.map((item, index) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : { price: item };
    const price = finitePrice(priceValue(record) ?? record.target_price ?? record.targetPrice ?? record.value);
    if (price === null) return null;
    return {
      label: String(record.label ?? record.name ?? `T${index + 1}`),
      price,
      ratioR: Number.isFinite(Number(record.ratioR ?? record.reward_risk ?? record.rewardRisk ?? record.expected_r ?? record.expectedR))
        ? Number(record.ratioR ?? record.reward_risk ?? record.rewardRisk ?? record.expected_r ?? record.expectedR)
        : null,
    };
  }).filter((item): item is TradeOverlayTarget => Boolean(item));
}

function entryFromZone(value: unknown): number | null {
  if (Array.isArray(value) && value.length >= 2) {
    const left = finitePrice(value[0]);
    const right = finitePrice(value[1]);
    return left !== null && right !== null ? (left + right) / 2 : null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const direct = finitePrice(record.mid ?? record.center ?? record.price);
  if (direct !== null) return direct;
  const low = finitePrice(record.low ?? record.min ?? record.from ?? record.lower);
  const high = finitePrice(record.high ?? record.max ?? record.to ?? record.upper);
  return low !== null && high !== null ? (low + high) / 2 : null;
}

function uniqueTargets(targets: readonly TradeOverlayTarget[]): TradeOverlayTarget[] {
  const seen = new Set<string>();
  const result: TradeOverlayTarget[] = [];
  for (const target of targets) {
    const key = `${target.label}:${target.price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(target);
  }
  return result;
}
function optionSet(values: readonly (string | null | undefined)[]): string[] { return [...new Set(values.map((value) => String(value || "").trim().toUpperCase()).filter(Boolean))]; }
function formatInstrumentLabel(value: string) {
  if (value === "MNQ") return "MNQ · MQ";
  if (value === "MES") return "MES · MS";
  return value;
}
function formatTimeframe(value: string) {
  if (value === "60") return "H1";
  if (value === "240") return "H4";
  if (value === "D" || value === "1D") return "D1";
  return `M${value}`;
}
function formatAxisTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function CandlestickChart({ points, overlay }: { points: LiveTradingModel["marketSeries"]["points"]; overlay?: TradeOverlay | null }) {
  const drawable = points.filter((point) => [point.open, point.high, point.low, point.close].every((value) => typeof value === "number"));
  const defaultWindow = Math.min(96, drawable.length);
  const [windowRange, setWindowRange] = useState(() => ({ start: Math.max(0, drawable.length - defaultWindow), end: drawable.length }));
  const dragStartX = useRef<number | null>(null);
  const firstDrawableTimestamp = drawable[0]?.timestamp ?? "";
  const lastDrawableTimestamp = drawable.at(-1)?.timestamp ?? "";

  useEffect(() => {
    const nextWindow = Math.min(96, drawable.length);
    setWindowRange({ start: Math.max(0, drawable.length - nextWindow), end: drawable.length });
  }, [drawable.length, firstDrawableTimestamp, lastDrawableTimestamp]);

  if (!drawable.length) return <div className="lt-chart-empty" role="status"><strong>{presentAvailability("CONNECTED_EMPTY").label}</strong><span>Aucune bougie complète à tracer.</span></div>;
  const visible = drawable.slice(windowRange.start, windowRange.end);
  const visibleCount = visible.length;
  const moveWindow = (delta: number) => {
    setWindowRange((current) => {
      const size = current.end - current.start;
      const start = Math.max(0, Math.min(drawable.length - size, current.start + delta));
      return { start, end: start + size };
    });
  };
  const zoomWindow = (factor: number) => {
    setWindowRange((current) => {
      const size = current.end - current.start;
      const nextSize = Math.max(18, Math.min(drawable.length, Math.round(size * factor)));
      const center = current.start + size / 2;
      const start = Math.max(0, Math.min(drawable.length - nextSize, Math.round(center - nextSize / 2)));
      return { start, end: start + nextSize };
    });
  };
  const resetWindow = () => setWindowRange({ start: Math.max(0, drawable.length - defaultWindow), end: drawable.length });
  const goLatest = () => setWindowRange((current) => {
    const size = current.end - current.start;
    return { start: Math.max(0, drawable.length - size), end: drawable.length };
  });

  if (!visible.length) return <div className="lt-chart-empty" role="status"><strong>{presentAvailability("CONNECTED_EMPTY").label}</strong><span>Fenêtre graphique vide.</span></div>;
  const visibleLows = visible.map((point) => point.low as number);
  const visibleHighs = visible.map((point) => point.high as number);
  const candleMin = Math.min(...visibleLows);
  const candleMax = Math.max(...visibleHighs);
  const candleSpan = Math.max(candleMax - candleMin, 0.0001);
  const overlayPrices = overlay ? [overlay.entry, overlay.stop, ...overlay.targets.map((target) => target.price)].filter((value): value is number => typeof value === "number" && Number.isFinite(value)) : [];
  const overlayInScale = Boolean(overlay && overlayPrices.length && overlayPrices.every((price) => price >= candleMin - candleSpan * 2 && price <= candleMax + candleSpan * 2));
  const visibleOverlay = overlayInScale ? overlay : null;
  const levelPrices = visibleOverlay ? [visibleOverlay.entry, visibleOverlay.stop, ...visibleOverlay.targets.map((target) => target.price)].filter((value): value is number => typeof value === "number" && Number.isFinite(value)) : [];
  const min = Math.min(candleMin, ...levelPrices);
  const max = Math.max(candleMax, ...levelPrices);
  const span = Math.max(max - min, 0.0001);
  const width = 900;
  const height = 300;
  const leftGutter = 58;
  const rightGutter = visibleOverlay ? 132 : 56;
  const topGutter = 12;
  const bottomGutter = 30;
  const plotWidth = width - leftGutter - rightGutter;
  const plotHeight = height - topGutter - bottomGutter;
  const step = visible.length > 1 ? plotWidth / (visible.length - 1) : plotWidth;
  const x = (index: number) => leftGutter + index * step;
  const y = (value: number) => topGutter + ((max - value) / span) * plotHeight;
  const vwap = visible.map((point, index) => point.vwap === null ? null : `${x(index)},${y(point.vwap)}`).filter(Boolean).join(" ");
  const yTicks = Array.from({ length: 5 }, (_, index) => max - (span / 4) * index);
  const xTickIndexes = uniqueNumbers([0, Math.floor(visible.length * 0.25), Math.floor(visible.length * 0.5), Math.floor(visible.length * 0.75), visible.length - 1]);
  const anchorIndex = visibleOverlay ? overlayAnchorIndex(visible, visibleOverlay.createdAt) : 0;
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") moveWindow(-Math.max(1, Math.round(visibleCount * 0.2)));
    if (event.key === "ArrowRight") moveWindow(Math.max(1, Math.round(visibleCount * 0.2)));
    if (event.key === "+" || event.key === "=") zoomWindow(0.75);
    if (event.key === "-") zoomWindow(1.25);
    if (event.key === "Home") setWindowRange({ start: 0, end: Math.min(defaultWindow, drawable.length) });
    if (event.key === "End") goLatest();
  };
  return (
    <div
      className="lt-chart-canvas"
      tabIndex={0}
      role="application"
      aria-label={`${visible.length} bougies affichées sur ${drawable.length}. Utiliser les flèches pour déplacer le graphique et plus ou moins pour zoomer.`}
      onKeyDown={onKeyDown}
      onWheel={(event) => {
        event.preventDefault();
        zoomWindow(event.deltaY < 0 ? 0.85 : 1.15);
      }}
      onPointerDown={(event) => { dragStartX.current = event.clientX; event.currentTarget.setPointerCapture?.(event.pointerId); }}
      onPointerMove={(event) => {
        if (dragStartX.current === null) return;
        const delta = event.clientX - dragStartX.current;
        if (Math.abs(delta) < 18) return;
        moveWindow(delta > 0 ? -Math.max(1, Math.round(visibleCount * 0.12)) : Math.max(1, Math.round(visibleCount * 0.12)));
        dragStartX.current = event.clientX;
      }}
      onPointerUp={() => { dragStartX.current = null; }}
      onPointerCancel={() => { dragStartX.current = null; }}
    >
      <div className="lt-chart-controls" aria-label="Navigation du graphique">
        <button type="button" onClick={() => moveWindow(-Math.max(1, Math.round(visibleCount * 0.5)))} aria-label="Reculer dans le graphique">←</button>
        <button type="button" onClick={() => moveWindow(Math.max(1, Math.round(visibleCount * 0.5)))} aria-label="Avancer dans le graphique">→</button>
        <button type="button" onClick={() => zoomWindow(0.75)} aria-label="Zoomer">+</button>
        <button type="button" onClick={() => zoomWindow(1.25)} aria-label="Dézoomer">−</button>
        <button type="button" onClick={goLatest}>Dernier</button>
        <button type="button" onClick={resetWindow}>Reset</button>
      </div>
      <svg className="lt-market-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${visible.length} bougies OHLCV clôturées. Prix de ${min.toFixed(2)} à ${max.toFixed(2)}.`} preserveAspectRatio="none">
        <g className="lt-market-chart__axis lt-market-chart__axis--price">
          {yTicks.map((tick) => {
            const tickY = y(tick);
            return <g key={tick.toFixed(4)}><line x1={leftGutter} x2={width - rightGutter} y1={tickY} y2={tickY} /><text x={leftGutter - 8} y={tickY + 4} textAnchor="end">{tick.toFixed(2)}</text><text x={width - rightGutter + 8} y={tickY + 4}>{tick.toFixed(2)}</text></g>;
          })}
        </g>
        <g className="lt-market-chart__axis lt-market-chart__axis--time">
          <line x1={leftGutter} x2={width - rightGutter} y1={height - bottomGutter} y2={height - bottomGutter} />
          {xTickIndexes.map((index) => <text key={visible[index]?.timestamp ?? index} x={x(index)} y={height - 8} textAnchor={index === 0 ? "start" : index === visible.length - 1 ? "end" : "middle"}>{formatAxisTime(visible[index]?.timestamp ?? "")}</text>)}
        </g>
        <g className="lt-market-chart__axis-labels">
          <text x={leftGutter - 46} y={topGutter + 9}>Prix</text>
          <text x={leftGutter + plotWidth / 2} y={height - 1} textAnchor="middle">Temps</text>
        </g>
        {visibleOverlay ? <TradeZone overlay={visibleOverlay} y={y} x1={x(anchorIndex)} x2={width - rightGutter} /> : null}
        <g className="lt-market-chart__candles">{visible.map((point, index) => {
          const candleX = x(index);
          const open = point.open as number;
          const high = point.high as number;
          const low = point.low as number;
          const close = point.close as number;
          const up = close >= open;
          const candleWidth = Math.max(2, Math.min(8, step * 0.58));
          return <g key={point.timestamp} className={up ? "is-up" : "is-down"}><line x1={candleX} x2={candleX} y1={y(high)} y2={y(low)} /><rect x={candleX - candleWidth / 2} y={Math.min(y(open), y(close))} width={candleWidth} height={Math.max(1, Math.abs(y(open) - y(close)))} /></g>;
        })}</g>
        {vwap ? <polyline className="lt-market-chart__vwap" points={vwap} fill="none" /> : null}
        {visibleOverlay ? <TradeLevelLabels overlay={visibleOverlay} y={y} x1={leftGutter} x2={width - rightGutter} labelWidth={rightGutter} /> : null}
      </svg>
      <div className="lt-chart-readout">
        <span>{formatAxisTime(visible[0]?.timestamp ?? "")} → {formatAxisTime(visible.at(-1)?.timestamp ?? "")}</span>
        <span>{visible.length}/{drawable.length} bougies</span>
        {overlay && !visibleOverlay ? <span className="lt-chart-readout__warning">Plan {overlay.label} hors fenêtre prix actuelle</span> : null}
        {visibleOverlay ? <span>{visibleOverlay.label} · {visibleOverlay.side} · entrée {visibleOverlay.entry.toFixed(2)}</span> : null}
      </div>
    </div>
  );
}

function TradeZone({ overlay, y, x1, x2 }: { overlay: TradeOverlay; y(value: number): number; x1: number; x2: number }) {
  const firstTarget = overlay.targets[0]?.price ?? null;
  const entryY = y(overlay.entry);
  const stopY = overlay.stop === null ? null : y(overlay.stop);
  const targetY = firstTarget === null ? null : y(firstTarget);
  return (
    <g className="lt-market-chart__trade-zones" aria-hidden="true">
      {targetY !== null ? <rect className="lt-market-chart__zone lt-market-chart__zone--profit" x={x1} y={Math.min(entryY, targetY)} width={Math.max(0, x2 - x1)} height={Math.max(1, Math.abs(entryY - targetY))} rx={3} /> : null}
      {stopY !== null ? <rect className="lt-market-chart__zone lt-market-chart__zone--risk" x={x1} y={Math.min(entryY, stopY)} width={Math.max(0, x2 - x1)} height={Math.max(1, Math.abs(entryY - stopY))} rx={3} /> : null}
    </g>
  );
}

function TradeLevelLabels({ overlay, y, x1, x2, labelWidth }: { overlay: TradeOverlay; y(value: number): number; x1: number; x2: number; labelWidth: number }) {
  const rows = [
    { label: "ENTRÉE", price: overlay.entry, tone: "entry" },
    overlay.stop === null ? null : { label: "STOP", price: overlay.stop, tone: "stop" },
    ...overlay.targets.slice(0, 3).map((target) => ({ label: target.label, price: target.price, tone: "target" })),
  ].filter((row): row is { label: string; price: number; tone: string } => Boolean(row));
  return (
    <g className="lt-market-chart__levels">
      {rows.map((row) => {
        const levelY = y(row.price);
        return <g key={`${row.label}:${row.price}`} className={`lt-market-chart__level lt-market-chart__level--${row.tone}`}><line x1={x1} x2={x2} y1={levelY} y2={levelY} strokeDasharray={row.tone === "entry" ? "none" : "6 5"} /><rect x={x2 + 6} y={levelY - 11} width={labelWidth - 12} height={22} rx={4} /><text x={x2 + labelWidth / 2} y={levelY + 4} textAnchor="middle">{row.label} {row.price.toFixed(2)}</text></g>;
      })}
    </g>
  );
}

function overlayAnchorIndex(points: readonly LiveTradingModel["marketSeries"]["points"][number][], at?: string | null): number {
  const target = Date.parse(at || "");
  if (!Number.isFinite(target)) return 0;
  const index = points.findIndex((point) => Date.parse(point.timestamp) >= target);
  return index >= 0 ? index : Math.max(0, points.length - 1);
}

function uniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values.filter((value) => Number.isFinite(value) && value >= 0))];
}
