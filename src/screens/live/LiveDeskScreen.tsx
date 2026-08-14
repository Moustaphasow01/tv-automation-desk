import { useState } from "react";
import { DataSourceBadge, Icon } from "@/components/common";
import { MetricCard, MetricStrip, PageHeading } from "@/components/operations";
import {
  ActivityCard,
  AuditMini,
  DecisionCard,
  DecisionDeskStrip,
  LiveSectionHeading,
  MarketTable,
  OperationalTimeline,
  StatusRibbon,
  ThesisSummary
} from "@/components/deskCards";
import type { LiveDeskScreenProps } from "./LiveDeskScreen.types";
import {
  buildLiveDeskScreenViewModel,
  type LiveBrokerGuardViewModel,
  type LiveDeskScreenViewModel,
  type LiveProcessStageViewModel
} from "@/features/live-desk/viewModel";
import "./liveDeskScreen.css";

const liveSections = [
  { id: "live-decision", key: "F1", label: "Décision" },
  { id: "live-market", key: "F2", label: "Marché" },
  { id: "live-execution", key: "F3", label: "Exécution" },
  { id: "live-thesis", key: "F4", label: "Analyse" },
  { id: "live-activity", key: "F5", label: "Activité" }
] as const;

type LiveSectionId = (typeof liveSections)[number]["id"];

export function LiveDeskScreen({
  data,
  phaseLabel,
  refreshing,
  dataUpdatedAt,
  executionOverview,
  onRefresh,
  actions,
  tabs,
  activeTab,
  activeTabContent,
  executionContent
}: LiveDeskScreenProps) {
  const [activeSection, setActiveSection] = useState<LiveSectionId>("live-decision");
  const viewModel = buildLiveDeskScreenViewModel(data, { phaseLabel, refreshing, dataUpdatedAt, executionOverview });

  const jumpTo = (id: LiveSectionId) => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return <section className="view live-desk-v2 live-screen" data-screen="live-desk">
    <PageHeading
      eyebrow={viewModel.heading.eyebrow}
      title={viewModel.heading.title}
      subtitle={viewModel.heading.subtitle}
      actions={<>
        <DataSourceBadge label={viewModel.source.label} detail={viewModel.source.detail}/>
        <button className={`live-sync-indicator ${refreshing ? "is-refreshing" : ""}`} onClick={onRefresh}>
          <span className="live-sync-indicator__gear"><Icon name="settings" size={14}/></span>
          <span><strong>{viewModel.sync.title}</strong><small>{viewModel.sync.detail}</small></span>
        </button>
        <button className="text-btn" onClick={actions.openJournal}>Ouvrir le journal</button>
        <button className="secondary-btn" onClick={actions.openSetup}>Setup & Position</button>
      </>}
    />
    <DecisionDeskStrip data={data}/>
    <nav className="desk-function-bar live-screen__section-nav" aria-label="Sections du Live Desk">
      {liveSections.map(item => <button
        key={item.id}
        className={activeSection === item.id ? "active" : ""}
        aria-pressed={activeSection === item.id}
        onClick={() => jumpTo(item.id)}
      >
        <kbd>{item.key}</kbd><span>{item.label}</span>
      </button>)}
    </nav>

    <div id="live-decision" className="live-module live-module--decision live-screen__module">
      <StatusRibbon data={data}/>
      <div className="live-decision-grid">
        <DecisionCard data={data} onOpenSetup={actions.openSetup}/>
        <ThesisSummary data={data} onOpenThesis={actions.openThesis}/>
      </div>
      <LiveProcessPulse process={viewModel.process} refreshing={refreshing}/>
      <MetricStrip className="live-metric-strip metric-strip--ten">
        <MetricCard label="Confiance" value={`${data.thesis.confidence}%`}/>
        <MetricCard label="Santé" value={`${data.thesis.health}/100`}/>
        <MetricCard label="Risque setup" value={viewModel.metrics.riskSetup}/>
        <MetricCard
          label="R non réalisé"
          value={viewModel.metrics.unrealizedR}
          tone={viewModel.metrics.unrealizedRTone}
        />
        <MetricCard label="Dernier monitor" value={data.lastMonitorAt}/>
        <MetricCard
          label="Dernier claim"
          value={viewModel.metrics.lastClaimAt}
          detail={viewModel.metrics.lastClaimDetail}
        />
        <MetricCard
          label="Checkpoint à traiter"
          value={viewModel.metrics.nextTaskStatusLabel}
          detail={viewModel.metrics.nextTaskDetail}
          tone={viewModel.metrics.nextTaskTone}
        />
        <MetricCard
          label="Checkpoint suivant"
          value={viewModel.metrics.followingCheckpoint}
          detail={viewModel.metrics.followingWorkflow}
        />
        <MetricCard
          label="Checkpoint → claim"
          value={viewModel.metrics.claimLatency}
          detail={viewModel.metrics.claimLatencyDetail}
          tone={viewModel.metrics.claimLatencyTone}
        />
        <MetricCard label="Prochain macro" value={viewModel.metrics.nextMacro}/>
      </MetricStrip>
      <article className="card operational-timeline-card">
        <LiveSectionHeading title="Déroulé planifié / réel" subtitle="Chaque jalon ouvre son contexte et son délai observé"/>
        <OperationalTimeline data={data} onSelect={actions.openTimelineEvent}/>
      </article>
    </div>

    <div id="live-market" className="live-module live-screen__module">
      <LiveSectionHeading title="Prix & évolution" subtitle="MNQ, MES, MCL et mega caps · OHLC quotidien, RSI et ATR Wilder"/>
      <MarketTable data={data}/>
    </div>

    <div id="live-execution" className="live-module live-screen__module">
      <LiveSectionHeading title="Plan & exécution" subtitle="Setup théorique et position canonique restent distincts"/>
      <BrokerGuardPanel guard={viewModel.brokerGuard}/>
      {executionContent}
    </div>

    <div id="live-thesis" className="live-module live-screen__module">
      <nav className="desk-function-bar live-tab-bar" aria-label="Détail de la session">
        {tabs.map(tab => <button
          key={tab.id}
          className={activeTab === tab.id ? "active" : ""}
          aria-pressed={activeTab === tab.id}
          onClick={() => actions.onChangeTab(tab.id)}
        >{tab.label}</button>)}
      </nav>
      {activeTabContent}
    </div>

    <div id="live-activity" className="live-module live-screen__module">
      <LiveSectionHeading
        title="Activité"
        subtitle="Traçabilité des workers et qualité des données"
        action={<button className="text-btn" onClick={actions.openJournal}>Voir le journal <Icon name="arrow" size={15}/></button>}
      />
      <ActivityCard data={data}/>
      <details className="live-quality-disclosure">
        <summary><span>Qualité des données & audit</span><strong>{data.dataQuality.label}</strong></summary>
        <AuditMini data={data} onOpenAudit={actions.openAudit}/>
      </details>
    </div>
  </section>;
}

function BrokerGuardPanel({ guard }: { guard: LiveBrokerGuardViewModel }) {
  return <article className="card live-broker-guard" data-tone={guard.tone} aria-label="Projection broker front">
    <header>
      <div>
        <p className="eyebrow">Broker · données · protections</p>
        <h2>{guard.headline}</h2>
        <span>{guard.summary}</span>
      </div>
      <strong>{guard.available ? "POSTGRES + NINJATRADER" : "NON CHARGÉ"}</strong>
    </header>
    <div className="live-broker-guard__grid">
      {guard.cards.map(card => <div key={card.label} data-tone={card.tone}>
        <span>{card.label}</span>
        <strong>{card.value}</strong>
        <small>{card.detail}</small>
      </div>)}
    </div>
    {guard.alerts.length > 0 && <ul className="live-broker-guard__alerts">
      {guard.alerts.slice(0, 4).map(alert => <li key={alert}>{alert}</li>)}
    </ul>}
  </article>;
}

function LiveProcessPulse({ process, refreshing }: { process: LiveDeskScreenViewModel["process"]; refreshing: boolean }) {
  const stages = process.stages;
  return <div className="live-process-pulse" aria-label="Processus live">
    <span className="live-process-pulse__label" title={process.title}><i className={refreshing ? "is-spinning" : ""}><Icon name="settings" size={14}/></i> {process.label}</span>
    <div>{stages.map((stage: LiveProcessStageViewModel, index: number) => <span key={stage.label} data-state={stage.state}>
      <i/><strong>{stage.label}</strong><small>{stage.detail || "—"}</small>{index < stages.length - 1 && <em>→</em>}
    </span>)}</div>
  </div>;
}
