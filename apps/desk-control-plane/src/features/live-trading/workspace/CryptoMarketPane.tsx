import { useMemo } from "react";
import { useCryptoMarket } from "@/domains/front-api/cryptoMarketRepository";
import { chartBars } from "./chartData";
import { FinancialChart } from "./FinancialChart";
import { CryptoMarketHeader, CryptoMarketSource } from "./CryptoMarketReading";
import { useFrozenReading } from "./useFrozenReading";
import type { MarketPaneProps } from "./MarketPane";
import "./crypto-market.css";

export function CryptoMarketPane({ instrument, timeframe, activity, resumeGeneration, onPauseChange, annotations }: MarketPaneProps) {
  const history = useCryptoMarket({ mode: "history", instrument, timeframe, activity });
  const live = useCryptoMarket({ mode: "live", instrument, timeframe, activity });
  const data = live.data?.data ?? history.data?.data;
  const bars = useMemo(() => {
    const older = history.data?.data.history?.bars ?? [];
    const newer = live.data?.data.history?.bars ?? [];
    // Both sources are the same server cache. Ignore a polling reply older than the history reply.
    const points = Date.parse(live.data?.data.asOf ?? "") >= Date.parse(history.data?.data.asOf ?? "") ? [...older, ...newer] : older.length ? older : newer;
    return chartBars(points).bars.slice(-720);
  }, [history.data, live.data]);
  const reading = useFrozenReading({ value: { bars, quote: data?.quotes.find((quote) => quote.instrument === instrument) }, id: annotations.id, resumeGeneration, onPauseChange });
  const quote = reading.value.quote;
  const market = data?.markets.find((market) => market.instrument === instrument);
  const precision = market?.pricePrecision ?? 7;
  const healthy = !live.isError && quote?.state === "LIVE" && Date.now() - Date.parse(quote.asOf ?? "") <= 30_000;
  const state = reading.paused ? "PAUSED" : healthy ? "LIVE" : quote?.last ? "STALE" : "CONNECTING";
  return <article className="tw-chart tw-crypto" data-instrument={instrument} aria-label={`Marché ${instrument}`}>
    <CryptoMarketHeader instrument={instrument} timeframe={timeframe} quote={quote} precision={precision} state={state} />
    {live.isError || history.isError || data?.history?.state === "ERROR" ? <p className="tw-inline-warning" role="status">Actualisation partiellement indisponible. Dernières valeurs conservées avec leur date. <button onClick={() => { void history.refetch(); void live.refetch(); }}>Réessayer</button></p> : null}
    {reading.value.bars.length ? <FinancialChart bars={reading.value.bars} instrument={instrument} overlay={null} pricePrecision={precision} annotations={{ ...annotations, events: [], cursor: reading.paused ? null : annotations.cursor }} /> : <div className="tw-chart__empty"><strong>{history.isLoading ? "Chargement des bougies…" : "Historique indisponible"}</strong><p>Le prix et l’historique sont deux flux distincts. Aucune bougie reconstituée.</p></div>}
    <footer className="tw-chart__footer"><span>Bougies reçues · dernière potentiellement en formation<small>Prix et bougies actualisés à la seconde · pas de signal crypto</small></span><button aria-pressed={reading.paused} disabled={!reading.value.bars.length && !quote?.last} onClick={reading.toggle}>{reading.paused ? "Reprendre" : "Figer la lecture"}</button></footer>
    {reading.paused ? <p className="tw-inline-warning" role="status">Lecture figée. Les décisions du poste sont suspendues jusqu’à la reprise.</p> : null}
    <CryptoMarketSource quote={quote} market={market} />
  </article>;
}
