import { useState, type KeyboardEvent, type ReactNode } from "react";
import { FaChartLine, FaClipboardList, FaCompress, FaExchangeAlt, FaExpand, FaRobot, FaSatelliteDish, FaSignal } from "react-icons/fa";
import {
  AuditTimelinePanel,
  DataQualityPanel,
  JarvisPanel,
  PerformancePanel,
  ProviderRuntimePanel,
  ReconciliationPanel,
} from "./LiveTradingPanels";
import { LiveSignalInbox } from "./LiveSignalInbox";
import type { LiveSignalNavigationTarget } from "./LiveSignalInbox";
import type { LiveTradingModel } from "./model";
import { useFullscreenSurface } from "./useFullscreenSurface";

type DockTab = "POSITION" | "EVENTS" | "SIGNALS" | "QUALITY" | "PERFORMANCE" | "ADVISORY";

const DOCK_TABS: readonly { id: DockTab; label: string; icon: ReactNode }[] = [
  { id: "POSITION", label: "Position", icon: <FaExchangeAlt aria-hidden="true" /> },
  { id: "EVENTS", label: "Événements", icon: <FaClipboardList aria-hidden="true" /> },
  { id: "SIGNALS", label: "Signaux", icon: <FaSignal aria-hidden="true" /> },
  { id: "QUALITY", label: "Flux & qualité", icon: <FaSatelliteDish aria-hidden="true" /> },
  { id: "PERFORMANCE", label: "Performance", icon: <FaChartLine aria-hidden="true" /> },
  { id: "ADVISORY", label: "Avis Jarvis", icon: <FaRobot aria-hidden="true" /> },
];

export function LiveActivityDock({ model, selectedSignalId, onSelectSignal, onClearSignal, onShowOnChart }: {
  model: LiveTradingModel;
  selectedSignalId?: string | null;
  onSelectSignal?(target: LiveSignalNavigationTarget): void;
  onClearSignal?(): void;
  onShowOnChart?(target: LiveSignalNavigationTarget): void;
}) {
  const [activeTab, setActiveTab] = useState<DockTab>(() => initialTab(model));
  const fullscreen = useFullscreenSurface<HTMLElement>();
  const leaveFullscreenThen = (callback: (() => void) | undefined) => {
    if (!callback) return;
    if (fullscreen.expanded) fullscreen.close();
    window.requestAnimationFrame(() => window.requestAnimationFrame(callback));
  };
  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = DOCK_TABS.findIndex((tab) => tab.id === activeTab);
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? DOCK_TABS.length - 1
        : event.key === "ArrowRight" || event.key === "ArrowDown" ? (currentIndex + 1) % DOCK_TABS.length
          : (currentIndex - 1 + DOCK_TABS.length) % DOCK_TABS.length;
    const nextTab = DOCK_TABS[nextIndex];
    setActiveTab(nextTab.id);
    event.currentTarget.querySelector<HTMLButtonElement>(`#lt-dock-tab-${nextTab.id.toLowerCase()}`)?.focus();
  };
  return (
    <>
      {fullscreen.expanded ? <button type="button" className="lt-panel-backdrop" onClick={fullscreen.close} aria-label="Fermer l’activité de session" tabIndex={-1} /> : null}
      <section
        ref={fullscreen.surfaceRef}
        className={`lt-activity-dock${fullscreen.expanded ? " lt-activity-dock--fullscreen" : ""}`}
        aria-labelledby="lt-activity-dock-title"
        aria-modal={fullscreen.expanded || undefined}
        role={fullscreen.expanded ? "dialog" : undefined}
        tabIndex={fullscreen.expanded ? -1 : undefined}
      >
        <header className="lt-activity-dock__header">
          <div>
            <h2 id="lt-activity-dock-title">Activité de session</h2>
            <p>Explorez une profondeur à la fois ou ouvrez cet espace pour une investigation complète.</p>
          </div>
          <div className="lt-activity-dock__summary" aria-label="Résumé de session">
            <span><small>Signaux</small><strong>{model.signalFunnel.rawSignals}</strong></span>
            <span><small>Suivis</small><strong>{model.signalFunnel.theoreticalTracked}</strong></span>
            <span><small>R clos</small><strong>{model.signalFunnel.totalClosedR === null ? "—" : `${model.signalFunnel.totalClosedR.toFixed(2)}R`}</strong></span>
            <button
              ref={fullscreen.triggerRef}
              type="button"
              className="lt-activity-dock__focus"
              aria-expanded={fullscreen.expanded}
              onClick={fullscreen.toggleExpanded}
            >
              {fullscreen.expanded ? <FaCompress aria-hidden="true" /> : <FaExpand aria-hidden="true" />}
              <span>{fullscreen.expanded ? "Réduire" : "Plein écran"}</span>
            </button>
          </div>
        </header>
        <div className="lt-activity-dock__tabs" role="tablist" aria-label="Détails de la session Live" onKeyDown={onTabKeyDown}>
          {DOCK_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              tabIndex={activeTab === tab.id ? 0 : -1}
              aria-controls={`lt-dock-panel-${tab.id.toLowerCase()}`}
              id={`lt-dock-tab-${tab.id.toLowerCase()}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.icon}<span>{tab.label}</span>{dockCount(tab.id, model)}
            </button>
          ))}
        </div>
        <div
          className="lt-activity-dock__content"
          role="tabpanel"
          id={`lt-dock-panel-${activeTab.toLowerCase()}`}
          aria-labelledby={`lt-dock-tab-${activeTab.toLowerCase()}`}
          tabIndex={0}
        >
          {renderTab(activeTab, model, {
            selectedSignalId,
            onSelectSignal: (target) => leaveFullscreenThen(() => onSelectSignal?.(target)),
            onClearSignal,
            onShowOnChart: (target) => leaveFullscreenThen(() => onShowOnChart?.(target)),
          })}
        </div>
      </section>
    </>
  );
}

function renderTab(tab: DockTab, model: LiveTradingModel, signalProps: Omit<Parameters<typeof LiveSignalInbox>[0], "model">): ReactNode {
  if (tab === "POSITION") return <><ReconciliationPanel model={model} /><ProviderRuntimePanel model={model} /></>;
  if (tab === "EVENTS") return <AuditTimelinePanel model={model} />;
  if (tab === "SIGNALS") return <LiveSignalInbox model={model} {...signalProps} />;
  if (tab === "QUALITY") return <DataQualityPanel model={model} />;
  if (tab === "PERFORMANCE") return <PerformancePanel model={model} />;
  return <JarvisPanel model={model} />;
}

function initialTab(model: LiveTradingModel): DockTab {
  if (model.operator.status === "DEGRADED") return "QUALITY";
  if (model.operator.status === "THEORETICAL_TRACKING") return "POSITION";
  return "EVENTS";
}

function dockCount(tab: DockTab, model: LiveTradingModel): ReactNode {
  const count = tab === "EVENTS" ? model.timeline.length
    : tab === "SIGNALS" ? model.signalFunnel.rawSignals
      : tab === "POSITION" ? model.theoreticalExecution?.rows.length ?? 0
        : null;
  return count === null ? null : <small>{count}</small>;
}
