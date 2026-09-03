import { Link } from "react-router-dom";
import { FaCheck, FaExclamationTriangle, FaLock, FaRobot, FaTimes } from "react-icons/fa";
import { StatusBadge } from "@/design-system/primitives";
import { presentAvailability, presentExecutionMode, presentGeneric, presentOperationalStatus, presentRuntimeStatus, presentSignalState } from "@/design-system/labels";
import { presentBackendStatus } from "@/features/order-intent/statusRegistry";
import { operatorCode, operatorCopy, operatorReason } from "@/design-system/operatorVocabulary";
import { displayTime, displayValue, liveTone, recordValue } from "./mapper";
import { LivePanel } from "./LivePanel";
import type { LiveTradingModel } from "./model";

export { InstrumentChartPanel } from "./chart/LiveMarketChart";
export { LivePanel } from "./LivePanel";

export function LiveDecisionRibbon({ model }: { model: LiveTradingModel }) {
  const operator = model.operator;
  return (
    <section className="lt-decision-ribbon" aria-label="État opérateur Live Trading">
      <article className={`lt-decision-ribbon__operator lt-ribbon-tone--${operator.tone}`}>
        <small>État opérateur</small>
        <strong>{operator.label}</strong>
        <span>{operator.detail}</span>
      </article>
      <div className="lt-decision-ribbon__funnel" aria-label="Pipeline signal vers exécution">
        {model.signalFunnel.stages.map((stage) => (
          <div key={stage.key} className={`lt-funnel-stage lt-ribbon-tone--${stage.tone}`}>
            <small>{stage.label}</small>
            <strong>{stage.value.toLocaleString("fr-FR")}</strong>
            <span>{stage.detail}</span>
          </div>
        ))}
      </div>
      <article className="lt-decision-ribbon__guardrails">
        <small>Garde-fous</small>
        <strong>{model.mode.autoExecutionEnabled ? "Automatique activé" : "Automatique désactivé"} · {model.mode.physicalExecutionEnabled ? "Courtier activé" : "Courtier désactivé"}</strong>
        <span>Un accusé de réception n’est pas une exécution · l’interface ne modifie ni quantité, ni prix, ni risque.</span>
      </article>
    </section>
  );
}

export function MarketContextPanel({ model }: { model: LiveTradingModel }) {
  return <LivePanel title="Contexte marché" className="lt-panel--market"><table><thead><tr><th>Symbole</th><th>Dernier</th><th>Var%</th><th>Tendance</th></tr></thead><tbody>{model.watchlist.map((item) => <tr key={item.symbol}><td>{item.symbol}</td><td>{item.last === null ? "—" : item.last.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}</td><td className={item.changePct === null ? "" : `lt-tone--${item.changePct >= 0 ? "success" : "danger"}`}>{item.changePct === null ? "—" : `${item.changePct >= 0 ? "+" : ""}${item.changePct.toFixed(2)}%`}</td><td><Sparkline values={item.trend} positive={(item.changePct ?? 0) >= 0} /></td></tr>)}</tbody></table><TruthEmpty when={!model.watchlist.length} status="WATCHLIST NON PUBLIÉE" label="Aucun instantané de marché live n'est disponible." /><footer><StatusBadge tone={presentAvailability(model.freshness.marketData).tone}>{presentAvailability(model.freshness.marketData).label}</StatusBadge><span>Fraîcheur de la source de marché</span></footer></LivePanel>;
}

export function MarketIntelligencePanel({ model }: { model: LiveTradingModel }) {
  const context = model.marketIntelligence;
  return (
    <LivePanel title="Intelligence marché" className="lt-panel--intelligence">
      <div className="lt-intelligence-summary">
        <span><small>Biais</small><strong>{operatorCode(context.bias)}</strong></span>
        <span><small>Régime</small><strong>{operatorCode(context.regime)}</strong></span>
        <span><small>Volatilité</small><strong>{operatorCode(context.volatility)}</strong></span>
        <span><small>Macro</small><strong>{operatorCode(context.macroRisk)}</strong></span>
      </div>
      <dl className="lt-definition-list">
        <Pair label="Confiance contexte" value={context.confidence === null ? "—" : `${Math.round(context.confidence)}%`} />
        <Pair label="Multiplicateur risque" value={context.riskMultiplier === null ? "—" : `${context.riskMultiplier.toFixed(2)}x`} />
        <Pair label="Valide jusqu'à" value={displayTime(context.validUntil)} />
      </dl>
      <div className="lt-zone-list" aria-label="Zones de contexte">
        {context.zones.map((zone) => <article key={`${zone.label}:${zone.range}`} className={`lt-zone-list__item lt-ribbon-tone--${zone.tone}`}><strong>{operatorCopy(zone.label)}</strong><span>{operatorCode(zone.direction)} · {zone.range}</span><small>{operatorCopy(zone.detail || "Publié par le contexte ou le signal")}</small></article>)}
      </div>
      <TruthEmpty when={!context.zones.length && !context.reasonCodes.length} status="CONTEXTE STRUCTURÉ NON PUBLIÉ" label="Le front affiche les champs disponibles, mais le snapshot Market Context complet n'est pas encore présent dans cette projection." />
      <div className="lt-tags lt-tags--compact">
        {[...context.preferredFamilies.map((item) => `+ ${operatorCode(item)}`), ...context.discouragedFamilies.map((item) => `− ${operatorCode(item)}`), ...context.reasonCodes.map((item) => operatorReason(item))].slice(0, 12).map((item) => <span key={item}>{item}</span>)}
      </div>
    </LivePanel>
  );
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
        <tbody>{visibleInstances.map((item) => <tr key={item.strategyInstanceId}><td><Link to={`/strategies/${encodeURIComponent(item.strategyDefinitionId)}?instanceId=${encodeURIComponent(item.strategyInstanceId)}`} title={item.strategyInstanceId}>{item.name ?? shortId(item.strategyInstanceId)}</Link></td><td><StatusBadge tone={presentRuntimeStatus(item.runtimeState).tone}>{presentRuntimeStatus(item.runtimeState).label}</StatusBadge>{item.lastEvaluationResult ? <small className="lt-table-secondary">{operatorCode(item.lastEvaluationResult)}</small> : null}</td><td>{item.runtimeState === "MARKET_CLOSED" ? "À la réouverture" : displayTime(item.nextEvaluationAt)}</td><td>{typeof item.confidence !== "number" || Number.isNaN(item.confidence) ? <span className="lt-confidence-empty" title="Aucun signal actif pour cette instance">—</span> : <span className="lt-confidence-chip" title="Confiance du dernier signal actif de cette instance">{Math.round(item.confidence)}%</span>}</td></tr>)}</tbody>
      </table>
      <TruthEmpty when={!model.strategyInstances.length} status="Aucune stratégie active" label="Aucune stratégie en fonctionnement n’est publiée par le registre." />
    </LivePanel>
  );
}

export function MacroSessionPanel({ model }: { model: LiveTradingModel }) {
  return <LivePanel title="Macro et séance" className="lt-panel--macro"><dl className="lt-definition-list lt-definition-list--terms"><Pair label="Séance" value={operatorCode(model.source.session.activeSession ?? model.source.session.phase)} /><Pair label="État du marché" value={operatorCode(model.source.session.marketState ?? model.source.session.marketDataStatus)} /><Pair label="Date de trading" value={model.source.session.tradingDate} /><Pair label="Fuseau horaire" value={model.source.session.exchangeTimezone ?? "—"} /><Pair label="Dernière valeur connue" value={displayTime(model.source.session.lastKnownAt)} /><Pair label="Données du signal arrêtées à" value={displayTime(model.freshness.signalCutoffAt)} /></dl><p className="lt-panel-note">Calendrier macro et actualités : {presentAvailability(model.source.macroSession ? String(model.source.macroSession.availability ?? "KNOWN") : "UNAVAILABLE").label}</p></LivePanel>;
}

export function LatestSignalPanel({ model }: { model: LiveTradingModel }) {
  const signal = model.latestSignal;
  const plan = model.selectedSignalPlan;
  return (
    <LivePanel title="Dernier signal stratégie" className="lt-panel--signal">
      {signal ? (
        <>
          <div className="lt-signal-hero">
            <span><small>Instrument</small><strong>{signal.symbol}</strong></span>
            <span><small>Direction</small><strong className={`lt-tone--${signal.direction === "LONG" ? "success" : "danger"}`}>{operatorCode(signal.direction)}</strong></span>
            <span><small>Confiance</small><strong>{signal.confidence}%</strong></span>
          </div>
          <dl className="lt-definition-list">
            <Pair label="Stratégie" value={strategyDisplayName(model, signal.strategyId)} />
            <Pair label="État" value={presentSignalState(signal.state).label} />
            <Pair label="Régime" value={presentGeneric(signal.regime).label} />
            <Pair label="R attendu" value={`${displayValue(signal.expectancyR)} R`} />
            <Pair label="Gain / Risque" value={displayValue(signal.rewardRisk)} />
            <Pair label="Expire" value={displayTime(signal.expiresAt)} />
          </dl>
          {plan ? (
            <section className="lt-signal-plan" aria-label="Plan proposé par le signal">
              <header><strong>Plan proposé</strong><span>{plan.source}</span></header>
              <dl>
                <Pair label="Type" value={operatorCode(plan.orderType)} />
                <Pair label="Entrée" value={plan.entry} />
                <Pair label="Stop" value={plan.stop} />
                <Pair label="Objectifs" value={plan.targets.length ? plan.targets.map((value, index) => `Objectif ${index + 1} ${value}`).join(" · ") : "Non publiés"} />
              </dl>
            </section>
          ) : null}
          <div className="lt-tags">{signal.ruleHits.map((rule) => <span key={rule}>{rule}</span>)}</div>
          <Link className="lt-detail-link" to={`/live/signals/${encodeURIComponent(signal.signalId)}`}>Ouvrir le dossier signal</Link>
        </>
      ) : <TruthEmpty status="AUCUN SIGNAL ACTUEL" label="Aucun StrategySignal n'a été publié pour la session ; le moteur n'invente pas d'opportunité." />}
    </LivePanel>
  );
}

export function SignalFunnelPanel({ model }: { model: LiveTradingModel }) {
  const signals = [...model.source.signals]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 6);
  return (
    <LivePanel title="Entonnoir signaux" className="lt-panel--signal-funnel">
      <div className="lt-signal-funnel-metrics">
        <span><small>Acceptés par le contexte</small><strong>{model.signalFunnel.contextTake}</strong></span>
        <span><small>Risque validé</small><strong>{model.signalFunnel.riskPass}</strong></span>
        <span><small>À valider</small><strong>{model.signalFunnel.pendingHumanGates}</strong></span>
        <span><small>R théorique clos</small><strong>{model.signalFunnel.totalClosedR === null ? "—" : `${model.signalFunnel.totalClosedR.toFixed(2)}R`}</strong></span>
      </div>
      <table className="lt-signal-funnel-table">
        <thead><tr><th>Heure</th><th>Signal</th><th>État</th><th>RR</th></tr></thead>
        <tbody>
          {signals.map((signal) => (
            <tr key={signal.signalId}>
              <td>{displayTime(signal.createdAt)}</td>
              <td><Link to={`/live/signals/${encodeURIComponent(signal.signalId)}`}>{signal.symbol} {signal.direction}</Link></td>
              <td><StatusBadge tone={presentSignalState(signal.state).tone}>{presentSignalState(signal.state).label}</StatusBadge></td>
              <td>{displayValue(signal.rewardRisk)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <TruthEmpty when={!signals.length} status="AUCUN SIGNAL" label="Aucun signal récent n'est publié par le backend." />
    </LivePanel>
  );
}

export function RiskAuthorityPanel({ model }: { model: LiveTradingModel }) {
  const context = model.latestContextDecision;
  const risk = model.source.canonicalRuntime.riskCenter;
  const riskUsed = model.source.summary.riskUsedPct;
  const riskConfigured = model.source.summary.riskConfiguredPct;
  return <LivePanel title="Contexte, portefeuille et risque global" className="lt-panel--risk"><div className="lt-authority-stack"><AuthorityRow label="Avis du contexte" value={context?.recommendation ?? "CONNECTED_EMPTY"} detail={context?.reasonCodes.map((item) => operatorReason(item)).join(", ") || "Aucune décision consultative"} advisory /><AuthorityRow label="Compatibilité avec vos positions" value={model.orderIntent ? "ORDER_INTENT_PUBLISHED" : "CONNECTED_EMPTY"} detail={model.orderIntent ? "Un ordre proposé a été publié après arbitrage." : "Aucun arbitrage publié"} /><AuthorityRow label="Risque global" value={risk.globalStatus ?? risk.availability} detail={operatorReason(risk.reason || risk.openRisk?.reasonCode || "RISK_DECISION_UNAVAILABLE")} /></div><div className="lt-risk-comparison"><span><small>Demandé</small><strong>{displayValue(recordValue(model.orderIntent?.riskSnapshot, ["requestedQty"]))}</strong></span><span><small>Autorisé</small><strong>{displayValue(recordValue(model.orderIntent?.riskSnapshot, ["authorizedQty"]))}</strong></span><span><small>Arrêt d’urgence</small><strong>{presentOperationalStatus(risk.killSwitch?.availability === "KNOWN" ? risk.killSwitch.active ? "KILL_SWITCH_ACTIVE" : "OFF" : "UNAVAILABLE").label}</strong></span></div><p className="lt-panel-note">Risque consommé : {riskUsed === null ? "aucune exposition ouverte publiée" : `${riskUsed.toFixed(2)} %`} · limite configurée : {typeof riskConfigured === "number" ? `${riskConfigured.toFixed(2)} %` : "non publiée"}.</p></LivePanel>;
}

export function OrderIntentPanel({ model }: { model: LiveTradingModel }) {
  const intent = model.orderIntent;
  const terms = intent?.executionTerms;
  const target = model.targetPosition;
  return <LivePanel title="Position cible et ordre proposé" className="lt-panel--intent">{intent ? <><div className="lt-readonly"><FaLock aria-hidden="true" />Lecture seule après contrôle du risque</div><dl className="lt-definition-list lt-definition-list--terms"><Pair label="Instrument" value={displayValue(instrumentCode(intent))} /><Pair label="Sens" value={operatorCode(intent.side)} /><Pair label="Quantité autorisée" value={displayValue(recordValue(intent.riskSnapshot, ["authorizedQty", "authorized_qty"]) ?? intent.quantity)} /><Pair label="Type d'ordre" value={operatorCode(displayValue(recordValue(terms, ["order_type", "orderType"]) ?? intent.type))} /><Pair label="Entrée" value={displayValue(priceValue(recordValue(terms, ["entry"])) ?? intent.limitPrice)} /><Pair label="Stop" value={displayValue(priceValue(recordValue(terms, ["stop"])) ?? intent.stopPrice)} /><Pair label="Objectif 1" value={displayValue(firstTargetPrice(terms) ?? intent.targetPrice)} /><Pair label="Compte" value={displayValue(recordValue(terms, ["account_id", "accountId"]) ?? intent.account)} /><Pair label="Position cible" value={target ? "Publiée" : "Non publiée"} /><Pair label="Écart théorique" value={displayValue(recordValue(target, ["deltaSize", "delta_size"]))} /></dl><Link className="lt-detail-link" to={intent.route}>Ouvrir le dossier de l’ordre proposé</Link></> : <TruthEmpty status="Aucun ordre à valider" label="Aucun ordre proposé après contrôle du risque n’est publié ; aucun terme de transaction n’est supposé." />}</LivePanel>;
}

export function ProviderRuntimePanel({ model }: { model: LiveTradingModel }) {
  const provider = model.provider;
  const lifecycle = model.source.canonicalRuntime.pipeline.filter((step) => ["EXECUTION_GATEWAY", "PROVIDER_EVENTS"].includes(step.stepId));
  return <LivePanel title="Suivi du fournisseur" className="lt-panel--provider" action={<span>{provider ? operatorCopy(provider.label) : "Aucun état fournisseur"}</span>}><ol className="lt-provider-steps">{lifecycle.map((step, index) => <li key={step.stepId}><i aria-hidden="true">{index + 1}</i><span>{operatorCopy(step.label)} · {presentGeneric(step.status).label}</span></li>)}</ol><TruthEmpty when={!lifecycle.length} status="Désactivé par la politique du desk" label="L’exécution physique est fermée ; aucun suivi fournisseur n’est attendu." /><footer><span>Un accusé de réception n’est pas une exécution.</span>{provider ? <StatusBadge tone={presentAvailability(provider.status).tone}>{presentAvailability(provider.status).label}</StatusBadge> : <StatusBadge tone="warning">Désactivé par la politique du desk</StatusBadge>}</footer></LivePanel>;
}

export function ReconciliationPanel({ model }: { model: LiveTradingModel }) {
  const inSync = model.reconciliation.status === "PASS" || model.reconciliation.status === "MATCHED";
  return <LivePanel title="Rapprochement de position" className="lt-panel--reconciliation"><div className="lt-reconciliation"><section><h3>Suivi théorique</h3>{model.reconciliation.expected ? <RecordTable record={model.reconciliation.expected} /> : <TruthEmpty status="Aucun suivi théorique" label="Aucun état théorique d’entrée, d’expiration, d’objectif ou de stop n’est encore publié." />}</section><section><h3>Position chez le courtier (simulation)</h3>{model.reconciliation.broker ? <RecordTable record={model.reconciliation.broker} /> : <TruthEmpty status="Sans objet" label="L’exécution physique est désactivée ; aucun état du courtier n’est attendu." />}</section><aside className={inSync ? "lt-reconciliation__badge--sync" : "lt-reconciliation__badge--diff"}><span className="lt-reconciliation__icon">{inSync ? <FaCheck /> : <FaExclamationTriangle />}</span><strong>{presentBackendStatus(model.reconciliation.status).known ? presentBackendStatus(model.reconciliation.status).label : operatorCode(model.reconciliation.status)}</strong><span>{operatorCopy(model.reconciliation.detail)}</span><small>Arrêté à {displayTime(model.reconciliation.asOf)}</small></aside></div></LivePanel>;
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

export function DataQualityPanel({ model }: { model: LiveTradingModel }) {
  const quality = model.dataQuality;
  return (
    <LivePanel title="Qualité flux & contrats" className="lt-panel--quality">
      <div className="lt-quality-headline">
        <span><small>Marché</small><strong>{presentAvailability(quality.availability).label}</strong></span>
        <span><small>Âge</small><strong>{quality.marketAgeLabel}</strong></span>
        <span><small>Bougies</small><strong>{quality.candleCount}</strong></span>
        <span><small>Telegram</small><strong className={`lt-tone--${quality.telegram.tone}`} title={quality.telegram.status}>{operatorCode(quality.telegram.status)}</strong></span>
      </div>
      <div className="lt-quality-table-scroll" tabIndex={0} aria-label="Sources de données, défilement disponible">
        <table className="lt-quality-table">
          <thead><tr><th>Source</th><th>Lignes</th><th>Dernière</th></tr></thead>
          <tbody>{quality.sources.slice(0, 5).map((source) => <tr key={source.source}><td>{source.source}</td><td>{source.rows.toLocaleString("fr-FR")}</td><td>{displayTime(source.latestAt)}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="lt-quality-contracts">
        {quality.timeSeries.slice(0, 4).map((contract) => <span key={contract.seriesId} className={`lt-ribbon-tone--${contract.tone}`} title={contract.reason}><strong>{contract.label}</strong><small>{contract.source} · {presentAvailability(contract.availability).label}</small></span>)}
      </div>
      <footer>
        <span>Arrêté à {displayTime(quality.generatedAt)} · marché {displayTime(quality.marketAsOf)}</span>
        <StatusBadge tone={quality.telegram.tone}>Telegram {quality.telegram.healthy ? "Opérationnel" : quality.telegram.enabled ? "À surveiller" : "Désactivé"}</StatusBadge>
      </footer>
    </LivePanel>
  );
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
  return <LivePanel title="Avis Jarvis (consultatif uniquement)" className="lt-panel--jarvis"><div className="lt-jarvis"><FaRobot aria-hidden="true" /><p>{operatorCopy(model.source.aiAdvisory.summary || "Aucun contexte consultatif publié.")}</p><small>Mode {presentExecutionMode(model.source.aiAdvisory.mode).label} · arrêté à {displayTime(model.source.aiAdvisory.lastContextAt)}</small></div><footer>Jarvis est uniquement consultatif et ne passe aucun ordre.</footer></LivePanel>;
}

function AuthorityRow({ label, value, detail, advisory = false }: { label: string; value: string; detail: string; advisory?: boolean }) { const status = presentOperationalStatus(value); return <article><span>{advisory ? <FaRobot /> : value === "UNAVAILABLE" ? <FaExclamationTriangle /> : <FaCheck />}</span><div><small>{label}{advisory ? " · Avis consultatif" : ""}</small><StatusBadge tone={status.tone}>{status.label}</StatusBadge><p>{detail}</p></div></article>; }
function Pair({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function TruthEmpty({ when = true, label, status = "ÉTAT VIDE CONFIRMÉ" }: { when?: boolean; label: string; status?: string }) { return when ? <div className="lt-empty" role="status"><FaTimes aria-hidden="true" /><strong>{status}</strong><span>{label}</span></div> : null; }
function shortId(value: string) { return value.length > 25 ? `${value.slice(0, 22)}…` : value; }
function strategyDisplayName(model: LiveTradingModel, strategyId: string) { return model.strategyInstances.find((item) => item.strategyDefinitionId === strategyId || item.strategyInstanceId === strategyId)?.name ?? "Stratégie déterministe"; }
function priceValue(value: unknown): unknown { if (!value || typeof value !== "object") return value; const record = value as Record<string, unknown>; return record.price ?? record.value; }
function firstTargetPrice(terms: Record<string, unknown> | null | undefined): unknown { const targets = recordValue(terms, ["targets"]); if (Array.isArray(targets) && targets.length) return priceValue(targets[0]); return undefined; }
function instrumentCode(intent: unknown): string | null {
  if (!intent || typeof intent !== "object") return null;
  const record = intent as Record<string, unknown>;
  return String(record.symbol ?? record.instrument ?? recordValue(record.executionTerms as Record<string, unknown> | null, ["instrument", "instrument_code", "symbol"]) ?? "").trim().toUpperCase() || null;
}
