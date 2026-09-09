import type { CryptoMarket, CryptoQuote } from "@/domains/front-api/cryptoMarketContract";
import { ageLabel, marketName, numberLabel, parisTime, timeframeLabel } from "./workspaceModel";

export type CryptoReadingState = "PAUSED" | "LIVE" | "STALE" | "CONNECTING";
const stateLabels = { PAUSED: "Lecture figée", LIVE: "En direct", STALE: "Prix ancien · flux à vérifier", CONNECTING: "Connexion au marché…" };

export function CryptoMarketHeader({ instrument, timeframe, quote, precision, state }: {
  instrument: string; timeframe: string; quote?: CryptoQuote; precision: number; state: CryptoReadingState;
}) {
  return <>
    <header className="tw-chart__header"><div className="tw-chart__identity"><strong>{instrument}</strong><span>{marketName(instrument)} · USD</span><small>Comptant · 24 h / 24 · {timeframeLabel(timeframe)}</small></div>
      <div className="tw-chart__quote"><b className="tw-chart__price">{numberLabel(quote?.last, precision)}</b><span>{state === "PAUSED" ? "Prix figé" : "Dernier prix reçu"}</span><small><time dateTime={quote?.asOf}>{parisTime(quote?.asOf)}</time> Paris · {ageLabel(quote?.asOf, Date.now())}</small></div>
    </header>
    <div className="tw-crypto__status"><span data-live={state === "LIVE"}>{stateLabels[state]}</span><span>Kraken · observation uniquement</span></div>
    <dl className="tw-crypto__spread"><div><dt>Acheteur</dt><dd>{numberLabel(quote?.bid, precision)}</dd></div><div><dt>Vendeur</dt><dd>{numberLabel(quote?.ask, precision)}</dd></div><div><dt>Variation 24 h</dt><dd>{numberLabel(quote?.changePct)}{typeof quote?.changePct === "number" ? " %" : ""}</dd></div></dl>
  </>;
}

export function CryptoMarketSource({ quote, market }: { quote?: CryptoQuote; market?: CryptoMarket }) {
  return <details className="tw-source"><summary>Source et conditions de lecture</summary>
    <p>Kraken · marché au comptant en dollars américains. Cotation reçue : {quote?.asOf ?? "non reçue"}. Réception serveur : {quote?.receivedAt ?? "non reçue"}. La date de cotation n’est pas nécessairement celle du dernier échange.</p>
    <p>Historique limité aux 720 dernières bougies de la source, sans interpolation. La bougie en cours peut évoluer. Volumes en {market?.base ?? "unités de l’actif"}. Aucun ordre ni stratégie crypto n’est activé.</p>
    <p>TradingView Lightweight Charts™ · <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView, Inc.</a> · <a href="/THIRD_PARTY_NOTICES.txt" target="_blank" rel="noreferrer">Licence et attribution</a></p>
  </details>;
}
