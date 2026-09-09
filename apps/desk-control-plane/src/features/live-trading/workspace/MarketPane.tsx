import { useEffect, useMemo, useState } from "react";
import { changedBarCount, type ChartBar } from "./chartData";
import { useWorkspaceMarket } from "./useWorkspaceMarket";
import { FinancialChart } from "./FinancialChart";
import { ageLabel, marketName, numberLabel, parisTime, timeframeLabel } from "./workspaceModel";
import type { TradeOverlay } from "../chart/tradePlanOverlay";
import type { ChartAnnotations } from "./useChartAnnotations";

export function MarketPane({ instrument, timeframe, overlay, onPauseChange, annotations }: {
  instrument: string; timeframe: string; overlay: TradeOverlay | null; annotations: ChartAnnotations; onPauseChange(instrument: string, paused: boolean): void;
}) {
  const { query, series, normalized, matches } = useWorkspaceMarket(instrument, timeframe);
  const visibleEvents = useMemo(() => annotations.events.filter((event) => !event.instrument || event.instrument === instrument), [annotations.events, instrument]);
  const [frozen, setFrozen] = useState<{ bars: ChartBar[]; asOf: string } | null>(null);
  useEffect(() => () => onPauseChange(annotations.id, false), [annotations.id, onPauseChange]);
  const bars = frozen?.bars ?? normalized.bars;
  const pending = frozen ? changedBarCount(frozen.bars, normalized.bars) : 0;
  const latestTime = normalized.bars.at(-1)?.time;
  const barAsOf = latestTime === undefined ? series?.asOf : new Date(latestTime * 1_000).toISOString();
  const asOf = frozen?.asOf ?? barAsOf;
  const last = bars.at(-1);
  const paused = frozen !== null;
  return <article className="tw-chart" data-instrument={instrument} aria-label={`Marché ${instrument}`} aria-busy={query.isFetching}>
    <header className="tw-chart__header"><div className="tw-chart__identity"><strong>{instrument}</strong><span>{marketName(instrument)}</span><small>{timeframeLabel(timeframe)}</small></div>
      <div className="tw-chart__quote"><b className="tw-chart__price">{matches ? numberLabel(last?.close) : "—"}</b><span>{paused ? "Clôture reçue · lecture figée" : "Clôture reçue"}</span><small><time dateTime={asOf}>{parisTime(asOf, true)} Paris</time> · {ageLabel(asOf, Date.now())}</small></div>
    </header>
    {query.isError ? <div className="tw-inline-warning" role="status">Actualisation interrompue. {bars.length ? "Dernières données conservées." : "Données indisponibles."} <button onClick={() => void query.refetch()}>Réessayer</button></div> : null}
    {series && (query.data?.meta.stale || !["AVAILABLE", "KNOWN", "LIVE"].includes(series.availability)) ? <p className="tw-data-state">Données {series.availability === "PARTIAL" ? "partielles" : "à vérifier"} · historique reçu uniquement</p> : null}
    {!matches || !bars.length ? <div className="tw-chart__empty"><strong>{query.isLoading ? "Chargement du marché…" : "Aucune bougie exploitable"}</strong><p>Le graphique apparaîtra lorsque des données seront disponibles pour {instrument} · {timeframeLabel(timeframe)}.</p></div>
      : <FinancialChart bars={bars} instrument={instrument} overlay={overlay?.instrument === instrument ? overlay : null} annotations={{ ...annotations, events: visibleEvents, cursor: frozen ? null : annotations.cursor }} />}
    <footer className="tw-chart__footer"><span title={asOf}>Dernière bougie · {parisTime(asOf, true)}<small>{ageLabel(asOf, Date.now())} · {timeframeLabel(timeframe)}</small><small>Barres clôturées · pas de cotation tick par tick</small></span>
      <button disabled={!matches || !bars.length} aria-pressed={paused} onClick={() => {
        setFrozen(paused ? null : { bars: normalized.bars, asOf: barAsOf ?? "" }); onPauseChange(annotations.id, !paused);
      }}>{paused ? `Reprendre${pending ? ` · ${pending} mise(s) à jour` : ""}` : "Figer la lecture"}</button>
    </footer>
    {paused ? <p className="tw-inline-warning" role="status">Lecture figée. Les décisions sont suspendues jusqu’à la reprise.</p> : null}
    {normalized.rejected ? <p className="tw-inline-warning">{normalized.rejected} bougie(s) incomplète(s) non tracée(s). Aucune valeur reconstituée.</p> : null}
    <details className="tw-source"><summary>Source du graphique</summary><p>{series?.source || "Source non publiée"} · arrêté de la source : {series?.asOf || "Date non publiée"}</p><p>TradingView Lightweight Charts™ · Copyright (с) 2025 <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView, Inc.</a> · données du desk. <a href="/THIRD_PARTY_NOTICES.txt" target="_blank" rel="noreferrer">Licence et attribution</a></p></details>
  </article>;
}
