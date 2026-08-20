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
    {expanded ? <div className="lt-panel-backdrop" onClick={() => setExpanded(false)} aria-hidden="true" /> : null}
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
  return <LivePanel title="Market Context" className="lt-panel--market"><table><thead><tr><th>Symbol</th><th>Last</th><th>Chg%</th><th>Trend</th></tr></thead><tbody>{model.watchlist.map((item) => <tr key={item.symbol}><td>{item.symbol}</td><td>{item.last === null ? "—" : item.last.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}</td><td className={item.changePct === null ? "" : `lt-tone--${item.changePct >= 0 ? "success" : "danger"}`}>{item.changePct === null ? "—" : `${item.changePct >= 0 ? "+" : ""}${item.changePct.toFixed(2)}%`}</td><td><Sparkline values={item.trend} positive={(item.changePct ?? 0) >= 0} /></td></tr>)}</tbody></table><TruthEmpty when={!model.watchlist.length} status="WATCHLIST NON PUBLIÉE" label="Aucun instantané de marché live n'est disponible." /><footer><StatusBadge tone={presentAvailability(model.freshness.marketData).tone}>{presentAvailability(model.freshness.marketData).label}</StatusBadge><span>Fraîcheur de la source de marché</span></footer></LivePanel>;
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
  return <LivePanel title="Active Strategy Instances" className="lt-panel--strategies"><table><thead><tr><th>Strategy</th><th>Status</th><th>Next eval</th><th>Confidence</th></tr></thead><tbody>{model.strategyInstances.slice(0, 4).map((item) => <tr key={item.strategyInstanceId}><td><Link to={`/strategies/${encodeURIComponent(item.strategyDefinitionId)}?instanceId=${encodeURIComponent(item.strategyInstanceId)}`} title={item.strategyInstanceId}>{item.name ?? shortId(item.strategyInstanceId)}</Link></td><td><StatusBadge tone={presentRuntimeStatus(item.runtimeState).tone}>{presentRuntimeStatus(item.runtimeState).label}</StatusBadge></td><td>{item.runtimeState === "MARKET_CLOSED" ? "À la réouverture" : displayTime(item.nextEvaluationAt)}</td><td>{typeof item.confidence !== "number" || Number.isNaN(item.confidence) ? <span className="lt-confidence-empty" title="Aucun signal actif pour cette instance">—</span> : <span className="lt-confidence-chip" title="Confiance du dernier signal actif de cette instance">{Math.round(item.confidence)}%</span>}</td></tr>)}</tbody></table><TruthEmpty when={!model.strategyInstances.length} status="AUCUNE INSTANCE ACTIVE" label="Aucune Strategy Instance active n'est publiée par le registre." /></LivePanel>;
}

export function MacroSessionPanel({ model }: { model: LiveTradingModel }) {
  return <LivePanel title="Macro / Session" className="lt-panel--macro"><dl className="lt-definition-list lt-definition-list--terms"><Pair label="Session" value={model.source.session.activeSession ?? model.source.session.phase} /><Pair label="Market state" value={model.source.session.marketState ?? model.source.session.marketDataStatus} /><Pair label="Trading date" value={model.source.session.tradingDate} /><Pair label="Timezone" value={model.source.session.exchangeTimezone ?? "—"} /><Pair label="Last known" value={displayTime(model.source.session.lastKnownAt)} /><Pair label="Signal cutoff" value={displayTime(model.freshness.signalCutoffAt)} /></dl><p className="lt-panel-note">Macro/news : {presentAvailability(model.source.macroSession ? String(model.source.macroSession.availability ?? "KNOWN") : "UNAVAILABLE").label}</p></LivePanel>;
}

export function InstrumentChartPanel({ model }: { model: LiveTradingModel }) {
  const signal = model.latestSignal;
  const instrument = model.marketSeries.instrument ?? signal?.symbol ?? "Instrument";
  const intent = model.orderIntent;
  const levels: { label: string; price: number; tone: "success" | "danger" | "info" }[] = [];
  if (intent?.limitPrice != null) levels.push({ label: "ENTRÉE", price: intent.limitPrice, tone: "info" });
  if (intent?.stopPrice != null) levels.push({ label: "STOP", price: intent.stopPrice, tone: "danger" });
  if (intent?.targetPrice != null) levels.push({ label: "TARGET", price: intent.targetPrice, tone: "success" });
  return <LivePanel title={`${instrument} · ${model.marketSeries.timeframe ? `M${model.marketSeries.timeframe}` : "futures"}`} className="lt-panel--chart" action={<Link to="/events">Audit</Link>}><div className="lt-chart-toolbar"><span>{model.marketSeries.supportedTimeframes.map((frame) => <b key={frame} aria-current={frame === model.marketSeries.timeframe ? "true" : undefined}>{frame === "60" ? "H1" : frame === "240" ? "H4" : `M${frame}`}</b>)}</span><span>OHLCV · VWAP · signals · intents</span></div><div className="lt-chart-frame" data-availability={model.marketSeries.availability}>{model.marketSeries.points.length ? <CandlestickChart points={model.marketSeries.points} levels={levels} /> : <><div className="lt-chart-grid" aria-hidden="true" /><div className="lt-chart-empty" role="status"><strong>{presentAvailability(model.marketSeries.availability).label}</strong><span>{model.marketSeries.reason}</span><small>{model.marketSeries.source} · asOf {displayTime(model.marketSeries.asOf)}</small></div></>}</div><footer className="lt-chart-footer"><span>{model.marketSeries.points.length} bougies clôturées · source {model.marketSeries.source}</span><StatusBadge tone={presentAvailability(model.marketSeries.availability).tone}>{presentAvailability(model.marketSeries.availability).label}</StatusBadge></footer></LivePanel>;
}

export function LatestSignalPanel({ model }: { model: LiveTradingModel }) {
  const signal = model.latestSignal;
  return <LivePanel title="Latest Strategy Signal" className="lt-panel--signal">{signal ? <><div className="lt-signal-hero"><span><small>Instrument</small><strong>{signal.symbol}</strong></span><span><small>Direction</small><strong className={`lt-tone--${signal.direction === "LONG" ? "success" : "danger"}`}>{signal.direction}</strong></span><span><small>Confidence</small><strong>{signal.confidence}%</strong></span></div><dl className="lt-definition-list"><Pair label="Strategy" value={shortId(signal.strategyId)} /><Pair label="State" value={presentSignalState(signal.state).label} /><Pair label="Regime" value={presentGeneric(signal.regime).label} /><Pair label="Expected R" value={`${displayValue(signal.expectancyR)} R`} /><Pair label="Reward / Risk" value={displayValue(signal.rewardRisk)} /><Pair label="Expires" value={displayTime(signal.expiresAt)} /></dl><div className="lt-tags">{signal.ruleHits.map((rule) => <span key={rule}>{rule}</span>)}</div><Link className="lt-detail-link" to={`/live/signals/${encodeURIComponent(signal.signalId)}`}>Open signal dossier</Link></> : <TruthEmpty status="AUCUN SIGNAL ACTUEL" label="Aucun StrategySignal n'a été publié pour la session ; le moteur n'invente pas d'opportunité." />}</LivePanel>;
}

export function RiskAuthorityPanel({ model }: { model: LiveTradingModel }) {
  const context = model.latestContextDecision;
  const risk = model.source.canonicalRuntime.riskCenter;
  return <LivePanel title="AI Context / Portfolio / Global Risk" className="lt-panel--risk"><div className="lt-authority-stack"><AuthorityRow label="AI Context" value={context?.recommendation ?? "CONNECTED_EMPTY"} detail={context?.reasonCodes.join(", ") || "Aucune décision consultative"} advisory /><AuthorityRow label="Portfolio" value={model.orderIntent ? "ORDER_INTENT_PUBLISHED" : "CONNECTED_EMPTY"} detail={model.orderIntent?.portfolioOrderIntentId ?? "Aucune intention post-netting"} /><AuthorityRow label="Global Risk" value={risk.globalStatus ?? risk.availability} detail={risk.reason || risk.openRisk?.reasonCode || "Source portfolio_risk_decisions"} /></div><div className="lt-risk-comparison"><span><small>Requested</small><strong>{displayValue(recordValue(model.orderIntent?.riskSnapshot, ["requestedQty"]))}</strong></span><span><small>Authorized</small><strong>{displayValue(recordValue(model.orderIntent?.riskSnapshot, ["authorizedQty"]))}</strong></span><span><small>Kill switch</small><strong>{presentAvailability(risk.killSwitch?.availability === "KNOWN" ? risk.killSwitch.active ? "ACTIVE" : "OFF" : "UNAVAILABLE").label}</strong></span></div></LivePanel>;
}

export function OrderIntentPanel({ model }: { model: LiveTradingModel }) {
  const intent = model.orderIntent;
  const terms = intent?.executionTerms;
  return <LivePanel title="Target Position & OrderIntent" className="lt-panel--intent">{intent ? <><div className="lt-readonly"><FaLock aria-hidden="true" />READ-ONLY AFTER RISK</div><dl className="lt-definition-list lt-definition-list--terms"><Pair label="Instrument" value={intent.symbol} /><Pair label="Side" value={intent.side} /><Pair label="Authorized qty" value={displayValue(recordValue(intent.riskSnapshot, ["authorizedQty"]) ?? intent.quantity)} /><Pair label="Order type" value={displayValue(recordValue(terms, ["order_type", "orderType"]) ?? intent.type)} /><Pair label="Entry" value={displayValue(priceValue(recordValue(terms, ["entry"])) ?? intent.limitPrice)} /><Pair label="Stop" value={displayValue(priceValue(recordValue(terms, ["stop"])) ?? intent.stopPrice)} /><Pair label="Target" value={displayValue(intent.targetPrice)} /><Pair label="Account" value={displayValue(recordValue(terms, ["account_id", "accountId"]) ?? intent.account)} /></dl><Link className="lt-detail-link" to={intent.route}>Open canonical dossier</Link></> : <TruthEmpty status="AUCUNE INTENTION EN ATTENTE" label="Aucun OrderIntent post-Risk n'est publié ; aucun terme de trade n'est supposé." />}</LivePanel>;
}

export function ProviderRuntimePanel({ model }: { model: LiveTradingModel }) {
  const provider = model.provider;
  const lifecycle = model.source.canonicalRuntime.pipeline.filter((step) => ["EXECUTION_GATEWAY", "PROVIDER_EVENTS"].includes(step.stepId));
  return <LivePanel title="Provider Runtime" className="lt-panel--provider" action={<span>{provider ? provider.label : "No provider state"}</span>}><ol className="lt-provider-steps">{lifecycle.map((step, index) => <li key={step.stepId}><i aria-hidden="true">{index + 1}</i><span>{step.label} · {presentGeneric(step.status).label}</span></li>)}</ol><TruthEmpty when={!lifecycle.length} status="DÉSACTIVÉ PAR POLITIQUE" label="L'exécution physique est fermée ; aucun lifecycle provider n'est attendu." /><footer><span>Un accusé de réception n'est pas une exécution.</span>{provider ? <StatusBadge tone={presentAvailability(provider.status).tone}>{presentAvailability(provider.status).label}</StatusBadge> : <StatusBadge tone="warning">Désactivé par politique</StatusBadge>}</footer></LivePanel>;
}

export function ReconciliationPanel({ model }: { model: LiveTradingModel }) {
  const inSync = model.reconciliation.status === "PASS" || model.reconciliation.status === "MATCHED";
  return <LivePanel title="Position Reconciliation" className="lt-panel--reconciliation"><div className="lt-reconciliation"><section><h3>Theoretical Position (System)</h3>{model.reconciliation.expected ? <RecordTable record={model.reconciliation.expected} /> : <TruthEmpty status="AUCUNE POSITION THÉORIQUE" label="Aucune position théorique canonique n'est ouverte." />}</section><section><h3>Broker Position (Simulated)</h3>{model.reconciliation.broker ? <RecordTable record={model.reconciliation.broker} /> : <TruthEmpty status="NON APPLICABLE" label="L'exécution physique est désactivée ; aucun snapshot broker n'est attendu." />}</section><aside className={inSync ? "lt-reconciliation__badge--sync" : "lt-reconciliation__badge--diff"}><span className="lt-reconciliation__icon">{inSync ? <FaCheck /> : <FaExclamationTriangle />}</span><strong>{presentBackendStatus(model.reconciliation.status).known ? presentBackendStatus(model.reconciliation.status).label : model.reconciliation.status}</strong><span>{model.reconciliation.detail}</span><small>asOf {displayTime(model.reconciliation.asOf)}</small></aside></div></LivePanel>;
}

function RecordTable({ record }: { record: Record<string, unknown> }) {
  const entries = Object.entries(record).slice(0, 6);
  return <table className="lt-reconciliation__table"><tbody>{entries.map(([key, value]) => <tr key={key}><th>{presentGeneric(key).label}</th><td>{displayValue(value)}</td></tr>)}</tbody></table>;
}

export function AuditTimelinePanel({ model }: { model: LiveTradingModel }) {
  return <LivePanel title="Event Timeline / Audit Stream" className="lt-panel--timeline" action={<Link to="/events">All events</Link>}><ol>{model.source.timeline.slice(0, 8).map((event) => <li key={event.eventId}><time dateTime={event.at}>{displayTime(event.at)}</time><i className={`lt-tone--${liveTone(event.tone)}`} aria-hidden="true" /><span><strong>{event.title}</strong><small>{event.step} · {event.detail}</small></span></li>)}</ol><TruthEmpty when={!model.source.timeline.length} label="Aucun événement Live autoritaire dans la projection." /></LivePanel>;
}

export function PerformancePanel({ model }: { model: LiveTradingModel }) {
  const perf = model.performance;
  const hasSeries = perf.series.length > 0;
  return <LivePanel title="Research / Performance (Today)" className="lt-panel--performance"><div className="lt-performance-metrics"><span><small>Sample</small><strong>{displayValue(perf.sampleSize)}</strong></span><span><small>Hit Rate</small><strong>{perf.hitRatePct === null ? "—" : `${perf.hitRatePct.toFixed(1)}%`}</strong></span><span><small>Total R</small><strong>{perf.totalR === null ? "—" : `${perf.totalR.toFixed(2)}R`}</strong></span><span><small>Drawdown R</small><strong>{perf.drawdownR === null ? "—" : `${perf.drawdownR.toFixed(2)}R`}</strong></span></div>{hasSeries ? <EquityCurve series={perf.series} /> : <div className="lt-performance-empty"><strong>{presentAvailability(perf.availability).label} · {presentGeneric(perf.sourceType).label}</strong><span>{perf.reason}</span></div>}</LivePanel>;
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
  return <LivePanel title="Jarvis Insight (Advisory only)" className="lt-panel--jarvis"><div className="lt-jarvis"><FaRobot aria-hidden="true" /><p>{model.source.aiAdvisory.summary || "Aucun contexte consultatif publié."}</p><small>Mode {presentExecutionMode(model.source.aiAdvisory.mode).label} · asOf {displayTime(model.source.aiAdvisory.lastContextAt)}</small></div><footer>Jarvis is advisory only and does not place orders.</footer></LivePanel>;
}

function AuthorityRow({ label, value, detail, advisory = false }: { label: string; value: string; detail: string; advisory?: boolean }) { return <article><span>{advisory ? <FaRobot /> : value === "UNAVAILABLE" ? <FaExclamationTriangle /> : <FaCheck />}</span><div><small>{label}{advisory ? " · Avis consultatif" : ""}</small><StatusBadge tone={presentAvailability(value).tone}>{presentAvailability(value).label}</StatusBadge><p>{detail}</p></div></article>; }
function Pair({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function TruthEmpty({ when = true, label, status = "ÉTAT VIDE CONFIRMÉ" }: { when?: boolean; label: string; status?: string }) { return when ? <div className="lt-empty" role="status"><FaTimes aria-hidden="true" /><strong>{status}</strong><span>{label}</span></div> : null; }
function shortId(value: string) { return value.length > 25 ? `${value.slice(0, 22)}…` : value; }
function priceValue(value: unknown): unknown { if (!value || typeof value !== "object") return value; const record = value as Record<string, unknown>; return record.price ?? record.value; }

function CandlestickChart({ points, levels = [] }: { points: LiveTradingModel["marketSeries"]["points"]; levels?: { label: string; price: number; tone: "success" | "danger" | "info" }[] }) {
  const drawable = points.filter((point) => [point.open, point.high, point.low, point.close].every((value) => typeof value === "number"));
  if (!drawable.length) return <div className="lt-chart-empty" role="status"><strong>CONNECTED EMPTY</strong><span>Aucune bougie complète à tracer.</span></div>;
  const lows = drawable.map((point) => point.low as number);
  const highs = drawable.map((point) => point.high as number);
  const levelPrices = levels.map((level) => level.price);
  const min = Math.min(...lows, ...levelPrices);
  const max = Math.max(...highs, ...levelPrices);
  const span = Math.max(max - min, 0.0001);
  const width = 900;
  const height = 300;
  const rightGutter = levels.length ? 96 : 0;
  const step = (width - rightGutter) / drawable.length;
  const y = (value: number) => height - ((value - min) / span) * (height - 20) - 10;
  const vwap = drawable.map((point, index) => point.vwap === null ? null : `${index * step + step / 2},${y(point.vwap)}`).filter(Boolean).join(" ");
  return <svg className="lt-market-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${drawable.length} bougies OHLCV clôturées avec VWAP`} preserveAspectRatio="none"><g className="lt-market-chart__candles">{drawable.map((point, index) => { const x = index * step + step / 2; const open = point.open as number; const high = point.high as number; const low = point.low as number; const close = point.close as number; const up = close >= open; return <g key={point.timestamp} className={up ? "is-up" : "is-down"}><line x1={x} x2={x} y1={y(high)} y2={y(low)} /><rect x={x - Math.max(1, step * 0.28)} y={Math.min(y(open), y(close))} width={Math.max(2, step * 0.56)} height={Math.max(1, Math.abs(y(open) - y(close)))} /></g>; })}</g>{vwap ? <polyline className="lt-market-chart__vwap" points={vwap} fill="none" /> : null}<g className="lt-market-chart__levels">{levels.map((level) => { const levelY = y(level.price); const lineWidth = width - rightGutter; return <g key={level.label} className={`lt-market-chart__level lt-market-chart__level--${level.tone}`}><line x1={0} x2={lineWidth} y1={levelY} y2={levelY} strokeDasharray="6 5" /><rect x={lineWidth + 3} y={levelY - 11} width={rightGutter - 6} height={22} rx={3} /><text x={lineWidth + rightGutter / 2} y={levelY + 4} textAnchor="middle">{level.label} {level.price.toFixed(2)}</text></g>; })}</g></svg>;
}
