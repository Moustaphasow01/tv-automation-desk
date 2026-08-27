import { useState, type KeyboardEvent, type ReactNode } from "react";
import { FaChartLine, FaClipboardList, FaExchangeAlt, FaRobot, FaSatelliteDish, FaSignal } from "react-icons/fa";
import {
  AuditTimelinePanel,
  DataQualityPanel,
  JarvisPanel,
  PerformancePanel,
  ProviderRuntimePanel,
  ReconciliationPanel,
  SignalFunnelPanel,
} from "./LiveTradingPanels";
import type { LiveTradingModel } from "./model";

type DockTab = "POSITION" | "EVENTS" | "SIGNALS" | "QUALITY" | "PERFORMANCE" | "ADVISORY";

const DOCK_TABS: readonly { id: DockTab; label: string; icon: ReactNode }[] = [
  { id: "POSITION", label: "Position", icon: <FaExchangeAlt aria-hidden="true" /> },
  { id: "EVENTS", label: "Événements", icon: <FaClipboardList aria-hidden="true" /> },
  { id: "SIGNALS", label: "Signaux", icon: <FaSignal aria-hidden="true" /> },
  { id: "QUALITY", label: "Flux & qualité", icon: <FaSatelliteDish aria-hidden="true" /> },
  { id: "PERFORMANCE", label: "Performance", icon: <FaChartLine aria-hidden="true" /> },
  { id: "ADVISORY", label: "Avis Jarvis", icon: <FaRobot aria-hidden="true" /> },
];

export function LiveActivityDock({ model }: { model: LiveTradingModel }) {
  const [activeTab, setActiveTab] = useState<DockTab>(() => initialTab(model));
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
    <section className="lt-activity-dock" aria-labelledby="lt-activity-dock-title">
      <header className="lt-activity-dock__header">
        <div>
          <h2 id="lt-activity-dock-title">Activité de session</h2>
          <p>Une seule profondeur à la fois, sans masquer l’état de décision.</p>
        </div>
        <div className="lt-activity-dock__summary" aria-label="Résumé de session">
          <span><small>Signaux</small><strong>{model.signalFunnel.rawSignals}</strong></span>
          <span><small>Suivis</small><strong>{model.signalFunnel.theoreticalTracked}</strong></span>
          <span><small>R clos</small><strong>{model.signalFunnel.totalClosedR === null ? "—" : `${model.signalFunnel.totalClosedR.toFixed(2)}R`}</strong></span>
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
        {renderTab(activeTab, model)}
      </div>
    </section>
  );
}

function renderTab(tab: DockTab, model: LiveTradingModel): ReactNode {
  if (tab === "POSITION") return <><ReconciliationPanel model={model} /><ProviderRuntimePanel model={model} /></>;
  if (tab === "EVENTS") return <AuditTimelinePanel model={model} />;
  if (tab === "SIGNALS") return <SignalFunnelPanel model={model} />;
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
