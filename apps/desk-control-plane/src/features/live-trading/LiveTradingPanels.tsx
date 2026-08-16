import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { FaCheck, FaExclamationTriangle, FaInfoCircle, FaLock, FaRobot, FaTimes } from "react-icons/fa";
import { StatusBadge } from "@/design-system/primitives";
import { presentBackendStatus } from "@/features/order-intent/statusRegistry";
import { displayTime, displayValue, liveTone, recordValue } from "./mapper";
import type { LiveTradingModel } from "./model";

export function LivePanel({ title, className = "", action, children }: { title: string; className?: string; action?: ReactNode; children: ReactNode }) {
  return <section className={`lt-panel ${className}`}><header><h2>{title}</h2><FaInfoCircle aria-hidden="true" />{action ? <div>{action}</div> : null}</header><div className="lt-panel__body">{children}</div></section>;
}

export function MarketContextPanel({ model }: { model: LiveTradingModel }) {
  return <LivePanel title="Market Context" className="lt-panel--market"><table><thead><tr><th>Source</th><th>Rows</th><th>Dernier</th></tr></thead><tbody>{model.source.canonicalRuntime.authoritativeSources.slice(0, 5).map((source) => <tr key={source.source}><td>{source.source.replaceAll("_", " ")}</td><td>{source.rows}</td><td>{displayTime(source.latestAt)}</td></tr>)}</tbody></table><TruthEmpty when={!model.source.canonicalRuntime.authoritativeSources.length} label="Aucune source autoritaire publiée." /><footer><StatusBadge tone={liveTone(model.freshness.marketData)}>{model.freshness.marketData}</StatusBadge><span>source health.data_readiness</span></footer></LivePanel>;
}

export function StrategyInstancesPanel({ model }: { model: LiveTradingModel }) {
  return <LivePanel title="Active Strategy Instances" className="lt-panel--strategies"><table><thead><tr><th>Instance</th><th>Status</th><th>Next eval</th></tr></thead><tbody>{model.strategyInstances.slice(0, 4).map((item) => <tr key={item.strategyInstanceId}><td><Link to={`/strategies/${encodeURIComponent(item.strategyInstanceId)}`}>{shortId(item.strategyInstanceId)}</Link></td><td><StatusBadge tone={liveTone(item.runtimeState)}>{item.runtimeState}</StatusBadge></td><td>{displayTime(item.nextEvaluationAt)}</td></tr>)}</tbody></table><TruthEmpty when={!model.strategyInstances.length} label="Aucune Strategy Instance active publiée." /></LivePanel>;
}

export function MacroSessionPanel({ model }: { model: LiveTradingModel }) {
  return <LivePanel title="Macro / Session" className="lt-panel--macro"><dl className="lt-definition-list"><Pair label="Session" value={model.source.session.phase} /><Pair label="Trading date" value={model.source.session.tradingDate} /><Pair label="Next monitor" value={displayTime(model.source.session.nextMonitorAt)} /><Pair label="Market data" value={model.source.session.marketDataStatus} /><Pair label="Signal cutoff" value={displayTime(model.freshness.signalCutoffAt)} /></dl><p className="lt-panel-note">Le calendrier macro détaillé n'est pas publié dans cette projection Live.</p></LivePanel>;
}

export function InstrumentChartPanel({ model }: { model: LiveTradingModel }) {
  const signal = model.latestSignal;
  return <LivePanel title={`${signal?.symbol ?? "Instrument"} · ${signal ? "futures" : "UNAVAILABLE"}`} className="lt-panel--chart" action={<Link to="/events">Audit</Link>}><div className="lt-chart-toolbar"><span>{["M1", "M5", "M15", "H1"].map((frame) => <b key={frame}>{frame}</b>)}</span><span>OHLCV · VWAP · signals · intents</span></div><div className="lt-chart-frame" data-availability={model.marketSeries.availability}><div className="lt-chart-grid" aria-hidden="true" /><div className="lt-chart-empty" role="status"><strong>{model.marketSeries.availability}</strong><span>{model.marketSeries.reason}</span><small>{model.marketSeries.source} · asOf {displayTime(model.marketSeries.asOf)}</small></div></div><footer className="lt-chart-footer"><span>Les prix et niveaux absents ne sont jamais projetés à zéro.</span><StatusBadge tone={liveTone(model.marketSeries.availability)}>{model.marketSeries.availability}</StatusBadge></footer></LivePanel>;
}

export function LatestSignalPanel({ model }: { model: LiveTradingModel }) {
  const signal = model.latestSignal;
  return <LivePanel title="Latest Strategy Signal" className="lt-panel--signal">{signal ? <><div className="lt-signal-hero"><span><small>Instrument</small><strong>{signal.symbol}</strong></span><span><small>Direction</small><strong className={`lt-tone--${signal.direction === "LONG" ? "success" : "danger"}`}>{signal.direction}</strong></span><span><small>Confidence</small><strong>{signal.confidence}%</strong></span></div><dl className="lt-definition-list"><Pair label="Strategy" value={shortId(signal.strategyId)} /><Pair label="State" value={signal.state} /><Pair label="Regime" value={signal.regime} /><Pair label="Expected R" value={`${displayValue(signal.expectancyR)} R`} /><Pair label="Reward / Risk" value={displayValue(signal.rewardRisk)} /><Pair label="Expires" value={displayTime(signal.expiresAt)} /></dl><div className="lt-tags">{signal.ruleHits.map((rule) => <span key={rule}>{rule}</span>)}</div><Link className="lt-detail-link" to={`/live/signals/${encodeURIComponent(signal.signalId)}`}>Open signal dossier</Link></> : <TruthEmpty label="Aucun StrategySignal publié dans la fenêtre courante." />}</LivePanel>;
}

export function RiskAuthorityPanel({ model }: { model: LiveTradingModel }) {
  const context = model.latestContextDecision;
  const risk = model.source.canonicalRuntime.riskCenter;
  return <LivePanel title="AI Context / Portfolio / Global Risk" className="lt-panel--risk"><div className="lt-authority-stack"><AuthorityRow label="AI Context" value={context?.recommendation ?? "UNAVAILABLE"} detail={context?.reasonCodes.join(", ") || "Aucune décision consultative"} advisory /><AuthorityRow label="Portfolio" value={model.orderIntent ? "ALLOCATED" : "UNAVAILABLE"} detail={model.orderIntent?.portfolioOrderIntentId ?? "Aucune intention post-netting"} /><AuthorityRow label="Global Risk" value={risk.globalStatus ?? risk.availability} detail={risk.reason || risk.openRisk?.reasonCode || "Source portfolio_risk_decisions"} /></div><div className="lt-risk-comparison"><span><small>Requested</small><strong>{displayValue(recordValue(model.orderIntent?.riskSnapshot, ["requestedQty"]))}</strong></span><span><small>Authorized</small><strong>{displayValue(recordValue(model.orderIntent?.riskSnapshot, ["authorizedQty"]))}</strong></span><span><small>Kill switch</small><strong>{risk.killSwitch?.availability === "KNOWN" ? risk.killSwitch.active ? "ACTIVE" : "OFF" : "UNAVAILABLE"}</strong></span></div></LivePanel>;
}

export function OrderIntentPanel({ model }: { model: LiveTradingModel }) {
  const intent = model.orderIntent;
  const terms = intent?.executionTerms;
  return <LivePanel title="Target Position & OrderIntent" className="lt-panel--intent">{intent ? <><div className="lt-readonly"><FaLock aria-hidden="true" />READ-ONLY AFTER RISK</div><dl className="lt-definition-list lt-definition-list--terms"><Pair label="Instrument" value={intent.symbol} /><Pair label="Side" value={intent.side} /><Pair label="Authorized qty" value={displayValue(recordValue(intent.riskSnapshot, ["authorizedQty"]) ?? intent.quantity)} /><Pair label="Order type" value={displayValue(recordValue(terms, ["order_type", "orderType"]) ?? intent.type)} /><Pair label="Entry" value={displayValue(priceValue(recordValue(terms, ["entry"])) ?? intent.limitPrice)} /><Pair label="Stop" value={displayValue(priceValue(recordValue(terms, ["stop"])) ?? intent.stopPrice)} /><Pair label="Target" value={displayValue(intent.targetPrice)} /><Pair label="Account" value={displayValue(recordValue(terms, ["account_id", "accountId"]) ?? intent.account)} /></dl><Link className="lt-detail-link" to={intent.route}>Open canonical dossier</Link></> : <TruthEmpty label="Aucun OrderIntent post-Risk publié. Aucun terme de trade n'est supposé." />}</LivePanel>;
}

export function ProviderRuntimePanel({ model }: { model: LiveTradingModel }) {
  const provider = model.provider;
  const lifecycle = ["ACCEPTED", "ACK", "PARTIAL FILL", "FILLED", "REJECTED"];
  return <LivePanel title="Provider Runtime" className="lt-panel--provider" action={<span>{provider ? provider.label : "No provider state"}</span>}><ol className="lt-provider-steps">{lifecycle.map((step) => <li key={step}><i aria-hidden="true" /><span>{step}</span></li>)}</ol><footer><span>ACKNOWLEDGEMENT IS NOT A FILL.</span>{provider ? <StatusBadge tone={liveTone(provider.status)}>{provider.status}</StatusBadge> : <StatusBadge tone="warning">UNAVAILABLE</StatusBadge>}</footer></LivePanel>;
}

export function ReconciliationPanel({ model }: { model: LiveTradingModel }) {
  return <LivePanel title="Position Reconciliation" className="lt-panel--reconciliation"><div className="lt-reconciliation"><section><h3>Theoretical Position (system)</h3><TruthEmpty label="La position théorique n'est pas publiée dans cette vue." /></section><section><h3>Broker Position</h3><TruthEmpty label="La position broker réconciliée n'est pas publiée." /></section><aside><strong>{model.reconciliation.status}</strong><span>{model.reconciliation.detail}</span><small>asOf {displayTime(model.reconciliation.asOf)}</small></aside></div></LivePanel>;
}

export function AuditTimelinePanel({ model }: { model: LiveTradingModel }) {
  return <LivePanel title="Event Timeline / Audit Stream" className="lt-panel--timeline" action={<Link to="/events">All events</Link>}><ol>{model.source.timeline.slice(0, 8).map((event) => <li key={event.eventId}><time dateTime={event.at}>{displayTime(event.at)}</time><i className={`lt-tone--${liveTone(event.tone)}`} aria-hidden="true" /><span><strong>{event.title}</strong><small>{event.step} · {event.detail}</small></span></li>)}</ol><TruthEmpty when={!model.source.timeline.length} label="Aucun événement Live autoritaire dans la projection." /></LivePanel>;
}

export function PerformancePanel({ model }: { model: LiveTradingModel }) {
  return <LivePanel title="Research / Performance (Today)" className="lt-panel--performance"><div className="lt-performance-metrics"><span><small>Total R</small><strong>{model.performance.totalR === null ? "—" : `${model.performance.totalR.toFixed(2)}R`}</strong></span><span><small>Drawdown R</small><strong>{model.performance.drawdownR === null ? "—" : `${model.performance.drawdownR.toFixed(2)}R`}</strong></span><span><small>Availability</small><strong>{model.performance.availability}</strong></span></div><div className="lt-performance-empty"><strong>{model.performance.availability}</strong><span>{model.performance.reason}</span></div></LivePanel>;
}

export function JarvisPanel({ model }: { model: LiveTradingModel }) {
  return <LivePanel title="Jarvis Insight (Advisory only)" className="lt-panel--jarvis"><div className="lt-jarvis"><FaRobot aria-hidden="true" /><p>{model.source.aiAdvisory.summary || "Aucun contexte consultatif publié."}</p><small>Mode {model.source.aiAdvisory.mode} · asOf {displayTime(model.source.aiAdvisory.lastContextAt)}</small></div><footer>Jarvis is advisory only and does not place orders.</footer></LivePanel>;
}

function AuthorityRow({ label, value, detail, advisory = false }: { label: string; value: string; detail: string; advisory?: boolean }) { return <article><span>{advisory ? <FaRobot /> : value === "UNAVAILABLE" ? <FaExclamationTriangle /> : <FaCheck />}</span><div><small>{label}{advisory ? " · ADVISORY" : ""}</small><strong>{value}</strong><p>{detail}</p></div></article>; }
function Pair({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function TruthEmpty({ when = true, label }: { when?: boolean; label: string }) { return when ? <div className="lt-empty"><FaTimes aria-hidden="true" /><strong>UNAVAILABLE</strong><span>{label}</span></div> : null; }
function shortId(value: string) { return value.length > 25 ? `${value.slice(0, 22)}…` : value; }
function priceValue(value: unknown): unknown { if (!value || typeof value !== "object") return value; const record = value as Record<string, unknown>; return record.price ?? record.value; }
