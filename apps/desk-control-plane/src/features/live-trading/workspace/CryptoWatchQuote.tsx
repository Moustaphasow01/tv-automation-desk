import { useEffect, useRef, useState } from "react";
import type { CryptoQuote } from "@/domains/front-api/cryptoMarketContract";
import { marketName, numberLabel, parisTime } from "./workspaceModel";

export function CryptoWatchQuote({ symbol, quote, degraded, selected, onSelect }: { symbol: string; quote?: CryptoQuote; degraded: boolean; selected: boolean; onSelect(): void }) {
  const before = useRef(quote?.last);
  const [change, setChange] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    const previous = before.current;
    before.current = quote?.last;
    if (typeof previous !== "number" || typeof quote?.last !== "number" || quote.last === previous) return;
    setChange(quote.last > previous ? "up" : "down");
    const timer = window.setTimeout(() => setChange(null), 1_200);
    return () => window.clearTimeout(timer);
  }, [quote?.last]);
  const healthy = !degraded && quote?.state === "LIVE" && Date.now() - Date.parse(quote.asOf ?? "") <= 30_000;
  return <button className="tw-quote" data-change={healthy ? change : null} aria-pressed={selected} onClick={onSelect}>
    <span><strong>{symbol}</strong><small>{marketName(symbol)}</small></span>
    <span><b>{numberLabel(quote?.last, quote?.pricePrecision ?? 7)}</b><small>{numberLabel(quote?.changePct)}{typeof quote?.changePct === "number" ? " % · 24 h" : ""}</small></span>
    <time dateTime={quote?.asOf}>{healthy ? "" : "À vérifier · "}{parisTime(quote?.asOf)}</time>
    <small className="tw-quote-kind">Kraken · USD · observation</small>
  </button>;
}
