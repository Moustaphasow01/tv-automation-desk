import { useContext, useEffect, useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { FiArrowUpRight, FiRefreshCw } from "react-icons/fi";
import { RealtimeContext } from "@/domains/realtime/RealtimeProvider";
import { presentExecutionMode } from "@/design-system/labels";
import type { LiveTradingModel } from "./model";
import { LiveMarketLens } from "./LiveMarketLens";
import { capabilityPresentation } from "./LiveTradingHeader";
import { MarketPane } from "./workspace/MarketPane";
import { WorkspaceSafetyNotice } from "./workspace/WorkspaceSafetyNotice";
import { ageLabel, marketName, parisTime, timeframeLabel, workspaceCopy } from "./workspace/workspaceModel";
import { tradePlanOverlayFromTheoretical } from "./chart/tradePlanOverlay";
import { useObservedMarketCatalog } from "./workspace/useObservedMarketCatalog";
import "./workspace/workspace.tokens.css";
import "./workspace/workspace.css";
import "./workspace/workspace.extensions.css";
import "./live-overview.css";

type Props = {
  model: LiveTradingModel; requestedScope: { instrument?: string; timeframe?: string }; refreshing: boolean;
  decision: ReactNode; activity: ReactNode; chartDetail: ReactNode; selectedSignalId: string | null;
  onEnterFocus(): void; onRefresh(): void;
  onScopeChange(scope: { instrument?: string; timeframe?: string }): void;
  onPauseChange(instrument: string, paused: boolean): void;
};

/** Session observation stays separate from Focus's ticket workbench. */
export function LiveOverview(props: Props) {
  const { model } = props;
  useEffect(() => {
    document.documentElement.classList.add("tw-document"); document.body.classList.add("tw-document");
    return () => { document.documentElement.classList.remove("tw-document"); document.body.classList.remove("tw-document"); };
  }, []);
  return <div className="lt-page lt-overview trading-workspace" data-testid="live-trading-golden-master" data-operator-state={model.operator.status}>
    <OverviewHeader model={model} refreshing={props.refreshing} onRefresh={props.onRefresh} onEnterFocus={props.onEnterFocus} />
    <WorkspaceSafetyNotice model={model} />
    <OverviewSession model={model} />
    <div className="lt-overview__grid">
      <section className="lt-overview__market" aria-label="Marché observé">
        <OverviewMarket {...props} />
        <details className="lt-overview__disclosure" key={props.selectedSignalId ?? "no-signal"} open={Boolean(props.selectedSignalId)}><summary>Plans, repères et lecture historique du signal</summary>{props.chartDetail}</details>
      </section>
      <section className="lt-overview__activity" aria-label="Activité du desk">{props.activity}</section>
    </div>
    <details className="lt-overview__disclosure" key={`decision-${props.selectedSignalId ?? "none"}`} open={Boolean(props.selectedSignalId || model.signalFunnel.pendingHumanGates)}>
      <summary>Dossier de décision{props.selectedSignalId ? ` · ${model.latestSignal?.symbol ?? "signal sélectionné"}` : " · ouvrir le détail"}</summary>{props.decision}
    </details>
    <details className="lt-overview__disclosure"><summary>Contexte de séance, stratégies et qualité des marchés</summary><LiveMarketLens model={model} /></details>
    <footer className="tw-footer"><span>Live · vue d’ensemble de la séance</span><Link to="/live?focus=1">Examiner les tickets dans Focus</Link></footer>
  </div>;
}

function OverviewHeader({ model, refreshing, onRefresh, onEnterFocus }: Pick<Props, "model" | "refreshing" | "onRefresh" | "onEnterFocus">) {
  const realtime = useContext(RealtimeContext);
  const connected = realtime?.connectionStatus === "OPEN" && !realtime.resyncing;
  const capabilities = model.source.launchGate.capabilityStates ?? [];
  const physical = capabilities.find((item) => item.capability === "PHYSICAL_EXECUTION");
  return <>
    <header className="lt-overview__header"><div><h1>Live</h1><span>Vue d’ensemble</span></div>
      <span className="lt-overview__connection" data-connected={connected} role="status">{connected ? "Synchronisé" : "Connexion à vérifier"}</span>
      <button onClick={onRefresh} disabled={refreshing} aria-label="Actualiser la séance"><FiRefreshCw aria-hidden="true" /></button>
      <button className="lt-overview__focus" onClick={onEnterFocus}>Focus <FiArrowUpRight aria-hidden="true" /></button>
    </header>
    <div className="lt-overview__policy" aria-label="Politique de la séance"><div><strong>{workspaceCopy(model.mode.environment)}</strong><span>{presentExecutionMode(model.mode.executionMode).label}</span></div>
      <span className="lt-overview__physical">{physical ? capabilityPresentation(physical.capability, physical.status) : "Exécution physique · état non publié"}</span>
      {model.mode.autoExecutionEnabled ? <strong className="tw-inline-warning">Exécution automatique activée</strong> : null}
      <details><summary>Autorisations</summary><p>Exécution automatique {model.mode.autoExecutionEnabled ? "activée" : "désactivée"}</p>{capabilities.length ? <ul>{capabilities.map((item) => <li key={item.capability}>{capabilityPresentation(item.capability, item.status)}</li>)}</ul> : <p>Autorisations non publiées.</p>}<p>Les droits de décision restent ceux publiés par le desk.</p></details>
    </div>
  </>;
}

function OverviewSession({ model }: { model: LiveTradingModel }) {
  const realtime = useContext(RealtimeContext);
  const published = model.meta.availability === "AVAILABLE" && !model.meta.stale;
  return <section className="lt-overview__session" aria-label="État de la séance">
    <div><strong>{workspaceCopy(model.source.session.activeSession ?? model.source.session.phase)}</strong><span>{workspaceCopy(model.source.session.marketState ?? model.source.session.marketDataStatus)}</span></div>
    <dl><div><dt>Tickets à valider</dt><dd>{published ? model.signalFunnel.pendingHumanGates : "À vérifier"}</dd></div><div><dt>Positions théoriques ouvertes</dt><dd>{published ? model.signalFunnel.theoreticalOpen : "À vérifier"}</dd></div></dl>
    <p>Projection reçue · <time dateTime={model.meta.asOf}>{parisTime(model.meta.asOf, true)} Paris</time><span>{ageLabel(model.meta.generatedAt, realtime?.now.getTime() ?? Date.now())}{published ? "" : " · données incomplètes ou anciennes"}</span></p>
  </section>;
}

function OverviewMarket(props: Props) {
  const { model, requestedScope, onScopeChange } = props;
  const catalog = useObservedMarketCatalog(model.marketSeries);
  const instrument = requestedScope.instrument ?? model.marketSeries.instrument ?? "";
  const units = catalog.cryptoInstruments.includes(instrument) ? catalog.cryptoTimeframes : model.marketSeries.supportedTimeframes;
  const requested = requestedScope.timeframe ?? model.marketSeries.timeframe ?? "5";
  const timeframe = units.includes(requested) ? requested : units.includes("5") ? "5" : units[0] ?? requested;
  const overlay = useMemo(() => model.selectedTheoreticalExecution ? tradePlanOverlayFromTheoretical(model.selectedTheoreticalExecution) : null, [model.selectedTheoreticalExecution]);
  return <>
    <header className="lt-overview__market-controls"><label><span>Marché</span><select aria-label="Instrument du cockpit" value={instrument} onChange={(event) => onScopeChange({ instrument: event.target.value, timeframe: "5" })}>{catalog.instruments.map((symbol) => <option key={symbol} value={symbol}>{symbol} · {marketName(symbol)}</option>)}</select></label>
      <label><span>Unité</span><select aria-label="Unité du cockpit" value={timeframe} onChange={(event) => onScopeChange({ timeframe: event.target.value })}>{units.map((unit) => <option key={unit} value={unit}>{timeframeLabel(unit)}</option>)}</select></label>
    </header>
    <MarketPane key={instrument + ":" + timeframe} instrument={instrument} timeframe={timeframe} overlay={overlay} annotations={{ id: "overview-chart", timeframe, events: [], cursor: null }} onPauseChange={props.onPauseChange} />
  </>;
}
