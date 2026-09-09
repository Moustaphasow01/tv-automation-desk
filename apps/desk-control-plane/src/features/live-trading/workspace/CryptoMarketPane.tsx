import { useMemo } from "react";
import { useCryptoMarket } from "@/domains/front-api/cryptoMarketRepository";
import { chartBars } from "./chartData";
import { FinancialChart } from "./FinancialChart";
import { ageLabel, marketName, numberLabel, parisTime, timeframeLabel } from "./workspaceModel";
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
    return chartBars(points).bars;
  }, [history.data, live.data]);
  const reading = useFrozenReading({ value: { bars, quote: data?.quotes.find((quote) => quote.instrument === instrument) }, id: annotations.id, resumeGeneration, onPauseChange });
  const quote = reading.value.quote;
  const precision = data?.markets.find((market) => market.instrument === instrument)?.pricePrecision ?? 7;
  const healthy = !live.isError && quote?.state === "LIVE" && Date.now() - Date.parse(quote.asOf ?? "") <= 30_000;
  return <article className="tw-chart tw-crypto" data-instrument={instrument} aria-label={`Marché ${instrument}`}>
    <header className="tw-chart__header"><div className="tw-chart__identity"><strong>{instrument}</strong><span>{marketName(instrument)} · USD</span><small>Comptant · 24 h / 24 · {timeframeLabel(timeframe)}</small></div>
      <div className="tw-chart__quote"><b className="tw-chart__price">{numberLabel(quote?.last, precision)}</b><span>{reading.paused ? "Prix figé" : "Dernier prix reçu"}</span><small><time dateTime={quote?.asOf}>{parisTime(quote?.asOf)}</time> Paris · {ageLabel(quote?.asOf, Date.now())}</small></div>
    </header>
    <div className="tw-crypto__status"><span data-live={healthy && !reading.paused}>{reading.paused ? "Lecture figée" : healthy ? "En direct" : quote?.last ? "Prix ancien · flux à vérifier" : "Connexion au marché…"}</span><span>Kraken · observation uniquement</span></div>
    <dl className="tw-crypto__spread"><div><dt>Acheteur</dt><dd>{numberLabel(quote?.bid, precision)}</dd></div><div><dt>Vendeur</dt><dd>{numberLabel(quote?.ask, precision)}</dd></div><div><dt>Variation 24 h</dt><dd>{numberLabel(quote?.changePct)}{typeof quote?.changePct === "number" ? " %" : ""}</dd></div></dl>
    {live.isError || history.isError || data?.history?.state === "ERROR" ? <p className="tw-inline-warning" role="status">Actualisation partiellement indisponible. Dernières valeurs conservées avec leur date. <button onClick={() => { void history.refetch(); void live.refetch(); }}>Réessayer</button></p> : null}
    {reading.value.bars.length ? <FinancialChart bars={reading.value.bars} instrument={instrument} overlay={null} pricePrecision={precision} annotations={{ ...annotations, events: [], cursor: reading.paused ? null : annotations.cursor }} /> : <div className="tw-chart__empty"><strong>{history.isLoading ? "Chargement des bougies…" : "Historique indisponible"}</strong><p>Le prix et l’historique sont deux flux distincts. Aucune bougie reconstituée.</p></div>}
    <footer className="tw-chart__footer"><span>Bougies reçues · dernière potentiellement en formation<small>Prix et bougies actualisés à la seconde · pas de signal crypto</small></span><button aria-pressed={reading.paused} disabled={!reading.value.bars.length && !quote?.last} onClick={reading.toggle}>{reading.paused ? "Reprendre" : "Figer la lecture"}</button></footer>
    {reading.paused ? <p className="tw-inline-warning" role="status">Lecture figée. Les décisions du poste sont suspendues jusqu’à la reprise.</p> : null}
    <details className="tw-source"><summary>Source et conditions de lecture</summary><p>Kraken · marché au comptant en dollars américains. Cotation reçue : {quote?.asOf ?? "non reçue"}. Réception serveur : {quote?.receivedAt ?? "non reçue"}. La date de cotation n’est pas nécessairement celle du dernier échange.</p><p>Historique limité aux 720 dernières bougies de la source, sans interpolation. La bougie en cours peut évoluer. Volumes en {data?.markets.find((market) => market.instrument === instrument)?.base ?? "unités de l’actif"}. Aucun ordre ni stratégie crypto n’est activé.</p><p>TradingView Lightweight Charts™ · <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView, Inc.</a> · <a href="/THIRD_PARTY_NOTICES.txt" target="_blank" rel="noreferrer">Licence et attribution</a></p></details>
  </article>;
}
