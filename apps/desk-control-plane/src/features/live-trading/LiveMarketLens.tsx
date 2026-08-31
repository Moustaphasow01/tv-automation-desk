import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { StatusBadge } from "@/design-system/primitives";
import {
  presentAvailability,
  presentGeneric,
  presentRuntimeStatus,
} from "@/design-system/labels";
import { operatorCode } from "@/design-system/operatorVocabulary";
import { displayTime } from "./mapper";
import type { LiveTradingModel } from "./model";
import { LivePanel } from "./LivePanel";

type LensProps = { model: LiveTradingModel };

export function LiveMarketLens({ model }: LensProps) {
  return (
    <LivePanel
      title="Lecture du marché"
      className="lt-panel--market-lens"
      action={<StatusBadge tone={presentAvailability(model.freshness.marketData).tone}>{presentAvailability(model.freshness.marketData).label}</StatusBadge>}
      expandable={false}
    >
      <div className="lt-market-lens" data-market-freshness={model.freshness.marketData}>
        <MarketTape model={model} />
        <ContextBrief model={model} />
        <SessionBrief model={model} />
        <StrategyBrief model={model} />
      </div>
    </LivePanel>
  );
}

function MarketTape({ model }: LensProps) {
  const rows = prioritizedWatchlist(model).slice(0, 6);
  return (
    <section className="lt-market-lens__section lt-market-lens__tape" aria-labelledby="market-lens-tape">
      <LensHeading id="market-lens-tape" title="Prix suivis" />
      {rows.length ? (
        <table>
          <thead><tr><th scope="col">Actif</th><th scope="col">Dernier</th><th scope="col">Variation</th><th scope="col">Flux</th></tr></thead>
          <tbody>{rows.map((item) => (
            <tr key={item.symbol}>
              <th scope="row">{item.symbol}</th>
              <td className="lt-market-lens__number">{formatPrice(item.last)}</td>
              <td className={changeTone(item.changePct)}>{formatChange(item.changePct)}</td>
              <td><StatusBadge tone={presentAvailability(item.availability).tone}><span title={presentAvailability(item.availability).label}>{compactAvailability(item.availability)}</span></StatusBadge></td>
            </tr>
          ))}</tbody>
        </table>
      ) : <LensEmpty title="Watchlist non publiée" detail="Aucun instantané de marché n'est présent dans la projection live." />}
      <p className="lt-market-lens__source">Marché arrêté à {displayTime(model.marketSeries.asOf)} · {model.marketSeries.source}</p>
    </section>
  );
}

export function prioritizedWatchlist(model: LiveTradingModel): LiveTradingModel["watchlist"] {
  const priority = uniqueSymbols([
    model.marketSeries.instrument,
    model.latestSignal?.symbol,
    ...model.source.signals.map((signal) => signal.symbol),
    ...model.source.canonicalRuntime.latestSignals.map((signal) => signal.symbol),
  ]);
  const rank = new Map(priority.map((symbol, index) => [symbol, index]));
  return [...model.watchlist].sort((left, right) => (
    (rank.get(left.symbol.trim().toUpperCase()) ?? Number.MAX_SAFE_INTEGER)
    - (rank.get(right.symbol.trim().toUpperCase()) ?? Number.MAX_SAFE_INTEGER)
  ));
}

function uniqueSymbols(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.map((value) => String(value ?? "").trim().toUpperCase()).filter(Boolean))];
}

function ContextBrief({ model }: LensProps) {
  const context = model.marketIntelligence;
  return (
    <section className="lt-market-lens__section lt-market-lens__context" aria-labelledby="market-lens-context">
      <LensHeading id="market-lens-context" title="Lecture contextuelle" />
      <div className="lt-market-lens__context-grid">
        <LensMetric label="Biais" value={presentGeneric(context.bias).label} />
        <LensMetric label="Régime" value={presentGeneric(context.regime).label} />
        <LensMetric label="Volatilité" value={presentGeneric(context.volatility).label} />
        <LensMetric label="Risque macro" value={presentGeneric(context.macroRisk).label} />
      </div>
      <dl className="lt-definition-list">
        <LensPair label="Confiance" value={context.confidence === null ? "—" : `${Math.round(context.confidence)} %`} />
        <LensPair label="Multiplicateur risque" value={context.riskMultiplier === null ? "—" : `${context.riskMultiplier.toFixed(2)}×`} />
        <LensPair label="Contexte valide jusqu'à" value={displayTime(context.validUntil)} />
      </dl>
      {context.reasonCodes.length ? <div className="lt-tags lt-tags--compact">{context.reasonCodes.slice(0, 5).map((reason) => <span key={reason}>{presentGeneric(reason).label}</span>)}</div> : null}
    </section>
  );
}

function SessionBrief({ model }: LensProps) {
  const session = model.source.session;
  const macroAvailability = String(model.source.macroSession?.availability ?? "UNAVAILABLE");
  return (
    <section className="lt-market-lens__section lt-market-lens__session" aria-labelledby="market-lens-session">
      <LensHeading id="market-lens-session" title="Session et fraîcheur" action={<Link to="/live/news">Voir macro &amp; news</Link>} />
      <dl className="lt-definition-list">
        <LensPair label="Session" value={operatorCode(session.activeSession ?? session.phase)} />
        <LensPair label="État marché" value={presentGeneric(session.marketState ?? session.marketDataStatus).label} />
        <LensPair label="Date de trading" value={session.tradingDate} />
        <LensPair label="Dernière donnée connue" value={displayTime(session.lastKnownAt)} />
        <LensPair label="Coupure signal" value={displayTime(model.freshness.signalCutoffAt)} />
        <LensPair label="Macro / news" value={presentAvailability(macroAvailability).label} />
      </dl>
    </section>
  );
}

function StrategyBrief({ model }: LensProps) {
  const visible = model.strategyInstances.slice(0, 3);
  return (
    <section className="lt-market-lens__section lt-market-lens__strategies" aria-labelledby="market-lens-strategies">
      <LensHeading id="market-lens-strategies" title={`${model.strategyInstances.length} instances actives`} action={<Link to="/strategies/deployments">Voir toutes</Link>} />
      {visible.length ? <ul>{visible.map((instance) => (
        <li key={instance.strategyInstanceId}>
          <span><strong title={instance.strategyInstanceId}>{instance.name ?? compactId(instance.strategyInstanceId)}</strong><small>{compactId(instance.strategyVersionId)}</small></span>
          <span><StatusBadge tone={presentRuntimeStatus(instance.runtimeState).tone}>{presentRuntimeStatus(instance.runtimeState).label}</StatusBadge><small>{instance.lastEvaluationResult ? operatorCode(instance.lastEvaluationResult) : instance.runtimeState === "MARKET_CLOSED" ? "À la réouverture" : `Éval. ${displayTime(instance.nextEvaluationAt)}`}</small></span>
        </li>
      ))}</ul> : <LensEmpty title="Aucune instance active" detail="Le registre backend ne publie aucune instance pour cette session." />}
    </section>
  );
}

function LensHeading({ id, title, action }: { id: string; title: string; action?: ReactNode }) {
  return <header className="lt-market-lens__heading"><h3 id={id}>{title}</h3>{action}</header>;
}

function LensMetric({ label, value }: { label: string; value: string }) {
  return <span><small>{label}</small><strong title={value}>{value}</strong></span>;
}

function LensPair({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd title={value}>{value}</dd></div>;
}

function LensEmpty({ title, detail }: { title: string; detail: string }) {
  return <div className="lt-truth-empty" role="status"><strong>{title}</strong><span>{detail}</span></div>;
}

function formatPrice(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

function formatChange(value: number | null): string {
  return value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)} %`;
}

function changeTone(value: number | null): string {
  return value === null ? "" : `lt-tone--${value >= 0 ? "success" : "danger"}`;
}

function compactId(value: string): string {
  return value.length > 23 ? `${value.slice(0, 20)}…` : value;
}

function compactAvailability(value: string): string {
  const code = value.toUpperCase();
  if (["AVAILABLE", "KNOWN", "LIVE", "FRESH", "ACTIVE", "READY"].includes(code) || code.includes("LIVE_") || code.includes("POSTGRES")) return "Live";
  if (["MARKET_CLOSED", "CLOSED", "CLOSED_SESSION", "LAST_KNOWN"].some((token) => code.includes(token))) return "Clos";
  if (code.includes("STALE")) return "Périmé";
  if (code.includes("EMPTY")) return "Vide";
  if (code.includes("DEGRADED") || code.includes("PARTIAL")) return "Partiel";
  if (code.includes("UNAVAILABLE") || code.includes("DISCONNECTED") || code.includes("MISSING")) return "Absent";
  return presentAvailability(value).label;
}
