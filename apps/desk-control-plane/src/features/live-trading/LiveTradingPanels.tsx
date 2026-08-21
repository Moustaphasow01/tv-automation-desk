import { useEffect, useState, type ReactNode } from "react";
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
  const instrumentOptions = optionSet([model.marketSeries.instrument, ...model.marketSeries.supportedInstruments, "MNQ", "MES"]);
  const timeframeOptions = optionSet([model.marketSeries.timeframe, ...model.marketSeries.supportedTimeframes, "1", "5", "15"]);
  const intent = model.orderIntent;
  const intentInstrument = instrumentCode(intent);
  const theoretical = model.selectedTheoreticalExecution;
  const theoreticalInstrument = instrumentCode({ symbol: theoretical?.instrument });
  const chartInstrument = instrumentCode({ symbol: model.marketSeries.instrument ?? instrument });
  const canOverlayIntent = Boolean(intent && intentInstrument && chartInstrument && intentInstrument === chartInstrument);
  const canOverlayTheoretical = Boolean(!canOverlayIntent && theoretical && theoreticalInstrument && chartInstrument && theoreticalInstrument === chartInstrument);
  const levels = canOverlayIntent ? tradePlanLevels(intent) : canOverlayTheoretical ? theoreticalExecutionLevels(theoretical) : [];
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
        {model.marketSeries.points.length ? <CandlestickChart points={model.marketSeries.points} levels={levels} /> : <><div className="lt-chart-grid" aria-hidden="true" /><div className="lt-chart-empty" role="status"><strong>{presentAvailability(model.marketSeries.availability).label}</strong><span>{model.marketSeries.reason}</span><small>{model.marketSeries.source} · asOf {displayTime(model.marketSeries.asOf)}</small></div></>}
      </div>
      <footer className="lt-chart-footer">
        <span>{model.marketSeries.points.length} bougies clôturées · source {model.marketSeries.source}</span>
        {intent && !canOverlayIntent ? <span className="lt-chart-scope-note">Niveaux {intentInstrument || "intent"} masqués sur chart {chartInstrument || "—"}</span> : null}
        {!intent && theoretical && !canOverlayTheoretical ? <span className="lt-chart-scope-note">Tracking {theoreticalInstrument || "intent"} masqué sur chart {chartInstrument || "—"}</span> : null}
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
function tradePlanLevels(intent: LiveTradingModel["orderIntent"]): { label: string; price: number; tone: "success" | "danger" | "info" }[] {
  if (!intent) return [];
  const terms = intent.executionTerms;
  const levels: { label: string; price: number; tone: "success" | "danger" | "info" }[] = [];
  const entry = finitePrice(priceValue(recordValue(terms, ["entry"])) ?? intent.limitPrice);
  const stop = finitePrice(priceValue(recordValue(terms, ["stop"])) ?? intent.stopPrice);
  const target = finitePrice(firstTargetPrice(terms) ?? intent.targetPrice);
  if (entry !== null) levels.push({ label: "ENTRÉE", price: entry, tone: "info" });
  if (stop !== null) levels.push({ label: "STOP", price: stop, tone: "danger" });
  if (target !== null) levels.push({ label: "CIBLE", price: target, tone: "success" });
  return levels;
}

function theoreticalExecutionLevels(row: LiveTradingModel["selectedTheoreticalExecution"]): { label: string; price: number; tone: "success" | "danger" | "info" }[] {
  if (!row) return [];
  const levels: { label: string; price: number; tone: "success" | "danger" | "info" }[] = [];
  const entry = finitePrice(row.entry);
  const stop = finitePrice(row.stop);
  const target = finitePrice(row.targets[0]?.price);
  if (entry !== null) levels.push({ label: "ENTRÉE", price: entry, tone: "info" });
  if (stop !== null) levels.push({ label: "STOP", price: stop, tone: "danger" });
  if (target !== null) levels.push({ label: "CIBLE", price: target, tone: "success" });
  return levels;
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

function CandlestickChart({ points, levels = [] }: { points: LiveTradingModel["marketSeries"]["points"]; levels?: { label: string; price: number; tone: "success" | "danger" | "info" }[] }) {
  const drawable = points.filter((point) => [point.open, point.high, point.low, point.close].every((value) => typeof value === "number"));
  if (!drawable.length) return <div className="lt-chart-empty" role="status"><strong>{presentAvailability("CONNECTED_EMPTY").label}</strong><span>Aucune bougie complète à tracer.</span></div>;
  const lows = drawable.map((point) => point.low as number);
  const highs = drawable.map((point) => point.high as number);
  const candleMin = Math.min(...lows);
  const candleMax = Math.max(...highs);
  const candleSpan = Math.max(candleMax - candleMin, 0.0001);
  const visibleLevels = levels.filter((level) => level.price >= candleMin - candleSpan * 1.5 && level.price <= candleMax + candleSpan * 1.5);
  const levelPrices = visibleLevels.map((level) => level.price);
  const min = Math.min(candleMin, ...levelPrices);
  const max = Math.max(candleMax, ...levelPrices);
  const span = Math.max(max - min, 0.0001);
  const width = 900;
  const height = 300;
  const leftGutter = 58;
  const rightGutter = visibleLevels.length ? 112 : 56;
  const topGutter = 12;
  const bottomGutter = 30;
  const plotWidth = width - leftGutter - rightGutter;
  const plotHeight = height - topGutter - bottomGutter;
  const step = drawable.length > 1 ? plotWidth / (drawable.length - 1) : plotWidth;
  const x = (index: number) => leftGutter + index * step;
  const y = (value: number) => topGutter + ((max - value) / span) * plotHeight;
  const vwap = drawable.map((point, index) => point.vwap === null ? null : `${x(index)},${y(point.vwap)}`).filter(Boolean).join(" ");
  const yTicks = Array.from({ length: 5 }, (_, index) => max - (span / 4) * index);
  const xTickIndexes = uniqueNumbers([0, Math.floor(drawable.length * 0.25), Math.floor(drawable.length * 0.5), Math.floor(drawable.length * 0.75), drawable.length - 1]);
  return (
    <svg className="lt-market-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${drawable.length} bougies OHLCV clôturées. Prix de ${min.toFixed(2)} à ${max.toFixed(2)}.`} preserveAspectRatio="none">
      <g className="lt-market-chart__axis lt-market-chart__axis--price">
        {yTicks.map((tick) => {
          const tickY = y(tick);
          return <g key={tick.toFixed(4)}><line x1={leftGutter} x2={width - rightGutter} y1={tickY} y2={tickY} /><text x={leftGutter - 8} y={tickY + 4} textAnchor="end">{tick.toFixed(2)}</text><text x={width - rightGutter + 8} y={tickY + 4}>{tick.toFixed(2)}</text></g>;
        })}
      </g>
      <g className="lt-market-chart__axis lt-market-chart__axis--time">
        <line x1={leftGutter} x2={width - rightGutter} y1={height - bottomGutter} y2={height - bottomGutter} />
        {xTickIndexes.map((index) => <text key={drawable[index]?.timestamp ?? index} x={x(index)} y={height - 8} textAnchor={index === 0 ? "start" : index === drawable.length - 1 ? "end" : "middle"}>{formatAxisTime(drawable[index]?.timestamp ?? "")}</text>)}
      </g>
      <g className="lt-market-chart__axis-labels">
        <text x={leftGutter - 46} y={topGutter + 9}>Prix</text>
        <text x={leftGutter + plotWidth / 2} y={height - 1} textAnchor="middle">Temps</text>
      </g>
      <g className="lt-market-chart__candles">{drawable.map((point, index) => {
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
      <g className="lt-market-chart__levels">{visibleLevels.map((level) => {
        const levelY = y(level.price);
        const lineEnd = width - rightGutter;
        return <g key={level.label} className={`lt-market-chart__level lt-market-chart__level--${level.tone}`}><line x1={leftGutter} x2={lineEnd} y1={levelY} y2={levelY} strokeDasharray="6 5" /><rect x={lineEnd + 6} y={levelY - 11} width={rightGutter - 12} height={22} rx={4} /><text x={lineEnd + rightGutter / 2} y={levelY + 4} textAnchor="middle">{level.label} {level.price.toFixed(2)}</text></g>;
      })}</g>
    </svg>
  );
}

function uniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values.filter((value) => Number.isFinite(value) && value >= 0))];
}
