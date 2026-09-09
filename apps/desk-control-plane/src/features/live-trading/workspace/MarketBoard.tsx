import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FiMaximize2, FiMinimize2 } from "react-icons/fi";
import type { LiveTradingModel } from "../model";
import type { TradeOverlay } from "../chart/tradePlanOverlay";
import { MarketPane } from "./MarketPane";
import { Watchlist } from "./Watchlist";
import { marketName, timeframeLabel } from "./workspaceModel";
import type { WorkspacePreferencesController } from "./useWorkspacePreferences";
import { createChartCursorLink, type ChartEvent } from "./chartAnnotations";
import { useWorkspaceViewport } from "./useWorkspaceViewport";
import { MobileMarketPicker } from "./MobileMarketPicker";

type Props = {
  model: LiveTradingModel; instrument: string; timeframe: string; overlay: TradeOverlay | null;
  preferred: readonly string[]; settings: WorkspacePreferencesController; events: readonly ChartEvent[];
  pausedSlots?: readonly string[];
  onScopeChange(scope: { instrument?: string; timeframe?: string }): void;
  onPauseChange(instrument: string, paused: boolean): void;
};

export function MarketBoard(props: Props) {
  const { model, instrument, timeframe, overlay, preferred, settings, events, onScopeChange, onPauseChange } = props;
  const { preferences, update } = settings;
  const mobile = useWorkspaceViewport();
  const supported = model.marketSeries.supportedInstruments;
  const units = model.marketSeries.supportedTimeframes;
  const [expanded, setExpanded] = useState<number | null>(null);
  const [resumeGeneration, setResumeGeneration] = useState(0);
  const cursor = useMemo(() => createChartCursorLink(), []);
  const instruments = useMemo(() => {
    const defaults = [...new Set([instrument, ...preferred, ...supported])].filter((symbol) => supported.includes(symbol));
    return Array.from({ length: Math.min(preferences.chartCount, supported.length || 1) }, (_, index) => index === 0 ? instrument : supported.includes(preferences.secondary[index - 1]) ? preferences.secondary[index - 1] : defaults[index] ?? instrument);
  }, [instrument, preferred, supported, preferences.chartCount, preferences.secondary]);
  const watchSymbols = [...new Set([...preferred, ...instruments])];
  const watchProps = { model, symbols: watchSymbols, timeframe, selected: instrument, settings, onSelect: (symbol: string) => onScopeChange({ instrument: symbol }) };
  return <section className="tw-market-board" data-watchlist={!mobile && preferences.watchlistVisible} data-mobile={mobile} aria-label="Espace marchés">
    {mobile ? <MobileMarketPicker {...watchProps} /> : preferences.watchlistVisible ? <WatchlistDisclosure><Watchlist {...watchProps} /></WatchlistDisclosure> : null}
    {mobile && props.pausedSlots?.some((id) => id !== "chart-0") ? <div className="tw-hidden-pauses" role="status"><span>Une lecture figée est conservée sur un graphique masqué.</span><button onClick={() => setResumeGeneration((value) => value + 1)}>Reprendre toutes les lectures</button></div> : null}
    <div className="tw-market-board__main">
      <header className="tw-section-header" hidden={mobile}><div><h2>Marchés</h2><span>{instruments.length} graphique(s) indépendant(s)</span></div>
        <div className="tw-market-controls"><button aria-pressed={preferences.linkedCursor} onClick={() => update({ linkedCursor: !preferences.linkedCursor })}>Curseurs liés</button>
          <div className="tw-button-group" aria-label="Nombre de graphiques">{([1, 2, 4] as const).map((value) => <button key={value} disabled={supported.length < value} aria-pressed={preferences.chartCount === value} onClick={() => { setExpanded(null); update({ chartCount: value }); }}>{value}</button>)}</div>
        </div>
      </header>
      {preferences.linkedCursor && !mobile ? <p className="tw-chart-link-note">Même horodatage, uniquement si une bougie existe dans chaque graphique. Aucun prix interpolé.</p> : null}
      <div className="tw-chart-grid" data-count={mobile || expanded !== null ? 1 : instruments.length}>
        {instruments.map((symbol, index) => {
          const unit = index === 0 ? timeframe : units.includes(preferences.timeframes[index]) ? preferences.timeframes[index] : timeframe;
          const hidden = mobile ? index !== 0 : expanded !== null && expanded !== index;
          return <div className="tw-chart-slot" key={index} hidden={hidden}>
            <div className="tw-chart-slot-controls"><label className="tw-chart-select"><span>Graphique {index + 1}</span><select aria-label={"Actif du graphique " + (index + 1)} value={symbol} onChange={(event) => {
              if (index === 0) onScopeChange({ instrument: event.target.value });
              else update({ secondary: instruments.slice(1).map((item, position) => position === index - 1 ? event.target.value : item) });
            }}>{supported.map((value) => <option key={value} value={value}>{value} · {marketName(value)}</option>)}</select></label>
              <label><span className="tw-sr-only">Unité du graphique {index + 1}</span><select aria-label={"Unité du graphique " + (index + 1)} value={unit} onChange={(event) => {
                if (index === 0) onScopeChange({ timeframe: event.target.value });
                update({ timeframes: instruments.map((_, position) => position === index ? event.target.value : preferences.timeframes[position] || timeframe) });
              }}>{units.map((value) => <option key={value} value={value}>{timeframeLabel(value)}</option>)}</select></label>
              {!mobile ? <button aria-label={(expanded === index ? "Réduire" : "Agrandir") + " le graphique " + (index + 1)} aria-pressed={expanded === index} onClick={() => setExpanded(expanded === index ? null : index)}>{expanded === index ? <FiMinimize2 aria-hidden="true" /> : <FiMaximize2 aria-hidden="true" />}</button> : null}
            </div>
            <MarketPane key={symbol + ":" + unit} instrument={symbol} timeframe={unit} activity={hidden ? "background" : "foreground"} resumeGeneration={resumeGeneration} overlay={overlay} onPauseChange={onPauseChange} annotations={{ id: "chart-" + index, timeframe: unit, events, cursor: preferences.linkedCursor && !mobile ? cursor : null }} />
          </div>;
        })}
      </div>
    </div>
  </section>;
}

function WatchlistDisclosure({ children }: { children: ReactNode }) {
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 1180px)").matches);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1180px)");
    const update = () => setCompact(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return <details className="tw-watchlist-disclosure" open={!compact || expanded} onToggle={(event) => { if (compact) setExpanded(event.currentTarget.open); }}><summary>Marchés à surveiller · mes listes</summary>{children}</details>;
}
