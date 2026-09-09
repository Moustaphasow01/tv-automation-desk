import { useState, type ComponentProps } from "react";
import { FiList } from "react-icons/fi";
import { Watchlist } from "./Watchlist";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { marketName } from "./workspaceModel";

export function MobileMarketPicker(props: ComponentProps<typeof Watchlist>) {
  const [open, setOpen] = useState(false);
  const symbols = [...new Set([...props.settings.preferences.favorites, ...props.symbols])].filter((symbol) => (props.supported ?? props.model.marketSeries.supportedInstruments).includes(symbol));
  return <>
    <nav className="tw-mobile-markets" aria-label="Accès rapide aux marchés">
      <div className="tw-mobile-markets__shortcuts">{symbols.map((symbol) => <button key={symbol} aria-pressed={props.selected === symbol} title={marketName(symbol)} onClick={() => props.onSelect(symbol)}>{symbol}</button>)}</div>
      <button className="tw-mobile-markets__list" onClick={() => setOpen(true)}><FiList aria-hidden="true" />Listes</button>
    </nav>
    {open ? <WorkspaceDialog title="Choisir un marché" onClose={() => setOpen(false)}><Watchlist {...props} onSelect={(symbol) => { props.onSelect(symbol); setOpen(false); }} /></WorkspaceDialog> : null}
  </>;
}
