import { useEffect, useRef, useState } from "react";
import type { LiveTradingModel } from "../model";
import { useWorkspaceMarket } from "./useWorkspaceMarket";
import { marketName, numberLabel, parisTime } from "./workspaceModel";
import { groupSymbols, normalizedSearch } from "./workspacePreferences";
import type { WorkspacePreferencesController } from "./useWorkspacePreferences";
import { WatchlistEditor } from "./WatchlistEditor";

type Props = { model: LiveTradingModel; symbols: readonly string[]; timeframe: string; selected: string; settings: WorkspacePreferencesController; onSelect(symbol: string): void };

export function Watchlist({ model, symbols: desk, timeframe, selected, settings, onSelect }: Props) {
  const [ranking, setRanking] = useState<string[] | null>(null);
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState(false);
  const { preferences, update } = settings;
  const pinned = groupSymbols(preferences, desk, model.marketSeries.supportedInstruments);
  const quotes = model.watchlist.filter((quote) => pinned.includes(quote.symbol) && Number.isFinite(quote.changePct)
    && ["AVAILABLE", "KNOWN", "LIVE"].includes(quote.availability));
  const ordered = ranking ? [...ranking.filter((symbol) => pinned.includes(symbol)), ...pinned.filter((symbol) => !ranking.includes(symbol))] : pinned;
  const symbols = ordered.filter((symbol) => normalizedSearch(symbol + " " + marketName(symbol)).includes(normalizedSearch(filter)));
  const rank = () => setRanking([...quotes].sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity)).map((quote) => quote.symbol));
  return <aside className="tw-watchlist" aria-label="Liste des marchés">
    <header><h2>À surveiller</h2><button onClick={() => setEditing(true)}>Mes listes</button></header>
    <label className="tw-watch-group"><span className="tw-sr-only">Liste de marchés</span><select value={preferences.activeGroup} onChange={(event) => { update({ activeGroup: event.target.value }); setRanking(null); }}>
      <option value="desk">Marchés du desk</option><option value="favorites">Mes favoris</option>
      {preferences.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
    </select></label>
    <label className="tw-watch-filter"><span className="tw-sr-only">Filtrer les marchés</span><input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Chercher un actif…" /></label>
    <div className="tw-watchlist__columns" aria-hidden="true"><span>Actif</span><span>Prix reçu</span></div>
    <div className="tw-watchlist__rows">{symbols.map((symbol) => <div className="tw-watch-item" key={symbol}>
      <WatchQuote symbol={symbol} timeframe={timeframe} selected={selected === symbol} onSelect={() => onSelect(symbol)} />
      <button className="tw-favorite" aria-label={(preferences.favorites.includes(symbol) ? "Retirer " : "Ajouter ") + symbol + " des favoris"} aria-pressed={preferences.favorites.includes(symbol)} onClick={() => update({ favorites: preferences.favorites.includes(symbol) ? preferences.favorites.filter((value) => value !== symbol) : [...preferences.favorites, symbol] })}>{preferences.favorites.includes(symbol) ? "★" : "☆"}</button>
    </div>)}</div>
    {!symbols.length ? <p className="tw-watchlist__note">{filter ? "Aucun marché ne correspond au filtre." : "Cette liste est vide. Ajoutez des actifs dans Mes listes ou avec l’étoile."}</p> : null}
    <button className="tw-rank-refresh" disabled={!quotes.length && !ranking} onClick={ranking ? () => setRanking(null) : rank}>{ranking ? "Ordre de ma liste" : "Classer par variation"}</button>
    {ranking ? <button className="tw-rank-refresh" onClick={rank}>Reclasser maintenant</button> : null}
    <p className="tw-watchlist__note">{ranking ? "Classement figé pour garder vos repères." : "Le prix indique sa nature et son horodatage."} Variations publiées uniquement.</p>
    {editing ? <WatchlistEditor settings={settings} supported={model.marketSeries.supportedInstruments} initialSymbols={pinned} onClose={() => setEditing(false)} /> : null}
  </aside>;
}

function WatchQuote({ symbol, timeframe, selected, onSelect }: { symbol: string; timeframe: string; selected: boolean; onSelect(): void }) {
  const { query, series, normalized, matches, quote } = useWorkspaceMarket(symbol, timeframe);
  const lastBar = normalized.bars.at(-1);
  const quoteTime = Date.parse(quote?.asOf ?? "");
  const publishedQuote = typeof quote?.last === "number" && Number.isFinite(quote.last) && ["AVAILABLE", "KNOWN", "LIVE"].includes(quote.availability)
    && Number.isFinite(quoteTime) && quoteTime <= Date.now() + 30_000 && (!lastBar || quoteTime >= lastBar.time * 1_000);
  const price = matches ? publishedQuote ? quote?.last : lastBar?.close : null;
  const asOf = publishedQuote ? quote?.asOf : lastBar ? new Date(lastBar.time * 1_000).toISOString() : series?.asOf;
  const previous = useRef(price);
  const [change, setChange] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = price;
    if (typeof before !== "number" || typeof price !== "number" || before === price) return;
    setChange(price > before ? "up" : "down");
    const timer = window.setTimeout(() => setChange(null), 1_200);
    return () => window.clearTimeout(timer);
  }, [price]);
  const pct = publishedQuote && Number.isFinite(quote?.changePct) ? quote?.changePct : null;
  const degraded = query.isError || query.data?.meta.stale || !matches;
  return <button className="tw-quote" data-change={change} aria-pressed={selected} onClick={onSelect}>
    <span><strong>{symbol}</strong><small>{marketName(symbol)}</small></span>
    <span><b>{numberLabel(price)}</b><small className={typeof pct === "number" ? pct < 0 ? "tw-negative" : pct > 0 ? "tw-positive" : "" : ""}>{typeof pct === "number" ? (pct > 0 ? "+" : "") + numberLabel(pct) + " %" : publishedQuote ? "Variation —" : "Clôture"}</small></span>
    <time dateTime={asOf} title={asOf}>{degraded ? "À vérifier · " : ""}{parisTime(asOf, true)}</time>
    {publishedQuote ? <small className="tw-quote-kind">Cotation reçue · pas de tick direct</small> : null}
  </button>;
}
