import { useState } from "react";
import { DataSourceBadge, Icon } from "@/components/common";
import { MetricCard, MetricStrip, PageHeading } from "@/components/operations";
import {
  ActivityCard,
  AuditMini,
  BriefCard,
  DeskReading,
  DecisionCard,
  DecisionDeskStrip,
  DeltaCard,
  LiveSectionHeading,
  MacroNewsCard,
  MarketTable,
  PositionCard,
  OperationalTimeline,
  SetupCard,
  StatusRibbon,
  ThesisSummary,
  Timeline
} from "@/components/deskCards";
import type { LiveDeskScreenProps } from "./LiveDeskScreen.types";
import type { DeskSession } from "@/types";
import "./liveDeskScreen.css";

const liveSections = [
  { id: "live-decision", key: "F1", label: "Décision" },
  { id: "live-market", key: "F2", label: "Marché" },
  { id: "live-thesis", key: "F3", label: "Lecture" },
  { id: "live-execution", key: "F4", label: "Exécution" },
  { id: "live-risk", key: "F5", label: "Risque" },
  { id: "live-activity", key: "F6", label: "Activité" }
] as const;

type LiveSectionId = (typeof liveSections)[number]["id"];

export function LiveDeskScreen({ data, phaseLabel, refreshing, dataUpdatedAt, onRefresh, actions }: LiveDeskScreenProps) {
  const [activeSection, setActiveSection] = useState<LiveSectionId>("live-decision");
  const upcomingMacro = data.macro.find(event => event.isNext);

  const jumpTo = (id: LiveSectionId) => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return <section className="view live-desk-v2 live-screen" data-screen="live-desk">
    <PageHeading
      eyebrow={`Session automatique · ${phaseLabel}`}
      title="Live Desk"
      subtitle={`${sessionDisplayLabel(data.label)} · ${data.date} · ${deskLabel(data.strategyId)}`}
      actions={<>
        <DataSourceBadge label="SOURCE LIVE" detail={qualityLabel(data.dataQuality.status)}/>
        <button className={`live-sync-indicator ${refreshing ? "is-refreshing" : ""}`} onClick={onRefresh}>
          <span className="live-sync-indicator__gear"><Icon name="settings" size={14}/></span>
          <span><strong>{refreshing ? "Synchronisation…" : "Desk actif"}</strong><small>mis à jour {formatUpdatedAt(dataUpdatedAt)}</small></span>
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
      <LiveProcessPulse data={data} refreshing={refreshing}/>
      <MetricStrip className="live-metric-strip metric-strip--ten">
        <MetricCard label="Confiance" value={`${data.thesis.confidence}%`}/>
        <MetricCard label="Santé" value={`${data.thesis.health}/100`}/>
        <MetricCard label="Risque setup" value={data.setup.risk == null ? "—" : `${fmtLive(data.setup.risk)}%`}/>
        <MetricCard
          label="R non réalisé"
          value={data.position.unrealizedR == null ? "—" : `${data.position.unrealizedR.toFixed(2)} R`}
          tone={data.position.unrealizedR == null ? "neutral" : data.position.unrealizedR >= 0 ? "positive" : "negative"}
        />
        <MetricCard label="Dernier monitor" value={data.lastMonitorAt}/>
        <MetricCard
          label="Dernier claim"
          value={data.claim.lastClaimAt}
          detail={data.claim.workerId || "Aucun worker"}
        />
        <MetricCard
          label="Checkpoint à traiter"
          value={data.claim.nextTaskStatusLabel}
          detail={`${data.claim.nextTaskLabel} · ${data.claim.dueCheckpoint || data.claim.nextTaskCheckpoint}`}
          tone={taskStatusTone(data.claim.nextTaskStatus)}
        />
        <MetricCard
          label="Checkpoint suivant"
          value={data.nextCheckpointAt || data.claim.followingTaskCheckpoint || data.nextMonitorAt}
          detail={workflowLabel(data.claim.followingTaskWorkflow)}
        />
        <MetricCard
          label="Checkpoint → claim"
          value={claimLatencyLabel(data.claim.latencySeconds)}
          detail={`dû ${data.claim.readyAt} · bundle → claim ${claimLatencyLabel(data.claim.bundleClaimLatencySeconds)} · cible < ${Math.round((data.claim.latencyTargetSeconds || 120) / 60)} min`}
          tone={data.claim.latencyStatus === "late" ? "negative" : data.claim.latencyStatus === "on_target" ? "positive" : "neutral"}
        />
        <MetricCard label="Prochain macro" value={upcomingMacro ? `${upcomingMacro.time} · ${upcomingMacro.title}` : "Aucun à venir"}/>
      </MetricStrip>
      <article className="card operational-timeline-card">
        <LiveSectionHeading title="Déroulé planifié / réel" subtitle="Chaque jalon ouvre son contexte et son délai observé"/>
        <OperationalTimeline data={data} onSelect={actions.openTimelineEvent}/>
      </article>
    </div>

    <div id="live-market" className="live-module live-screen__module">
      <LiveSectionHeading title="Prix & évolution" subtitle="MNQ, MES, MCL et mega caps · OHLC quotidien, RSI et ATR"/>
      <MarketTable data={data}/>
    </div>

    <div id="live-thesis" className="live-module live-screen__module">
      <LiveSectionHeading title="Lecture du Desk" subtitle="Faits, interprétation et évolution de la thèse"/>
      <div className="content-grid">
        <BriefCard eyebrow="Marché" headline={data.marketBrief.headline} text={data.marketBrief.text} verdict={data.marketBrief.verdict} icon="chart"/>
        <BriefCard eyebrow="Cross-asset" headline={data.crossAssetBrief.headline} text={data.crossAssetBrief.text} verdict={data.crossAssetBrief.verdict} icon="globe"/>
      </div>
      <DeskReading data={data}/>
      <DeltaCard data={data}/>
    </div>

    <div id="live-execution" className="live-module live-screen__module">
      <LiveSectionHeading title="Plan & exécution" subtitle="Setup théorique et position canonique restent distincts"/>
      <div className="content-grid">
        <SetupCard data={data} onOpenSetup={actions.openSetup}/>
        <PositionCard data={data} onOpenPosition={actions.openSetup}/>
      </div>
    </div>

    <div id="live-risk" className="live-module live-screen__module">
      <LiveSectionHeading title="Risque temporel & agenda"/>
      <div className="live-risk-grid">
        <MacroNewsCard data={data} onOpenNews={actions.openNews}/>
      </div>
    </div>

    <div id="live-activity" className="live-module live-screen__module">
      <LiveSectionHeading
        title="Activité & journal"
        subtitle="Traçabilité des décisions et des workers"
        action={<button className="text-btn" onClick={actions.openJournal}>Tout voir <Icon name="arrow" size={15}/></button>}
      />
      <div className="content-grid">
        <ActivityCard data={data}/>
        <article className="card timeline-card">
          <Timeline data={data} compact onSelect={actions.openTimelineEvent}/>
        </article>
      </div>
      <details className="live-quality-disclosure">
        <summary><span>Qualité des données & audit</span><strong>{data.dataQuality.label}</strong></summary>
        <AuditMini data={data} onOpenAudit={actions.openAudit}/>
      </details>
    </div>
  </section>;
}

function fmtLive(value: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value);
}

function taskStatusTone(status: DeskSession["claim"]["nextTaskStatus"]) {
  if (status === "executed") return "positive";
  if (status === "late") return "negative";
  if (status === "waiting") return "warning";
  return "neutral";
}

function deskLabel(value: string) {
  return ({ asia_open: "Session Asie", ny_open: "Session New York", full_day: "Journée continue" } as Record<string, string>)[value] || value.replaceAll("_", " ");
}

function sessionDisplayLabel(value: string) {
  return ({
    "Asia Open": "Session Asie",
    "NY Open": "Session New York",
    asia_open: "Session Asie",
    ny_open: "Session New York",
    full_day: "Journée continue",
  } as Record<string, string>)[value] || value.replaceAll("_", " ");
}

function qualityLabel(value: string) {
  return ({ ready: "prête", healthy: "opérationnelle", context_limited: "contexte partiel", degraded: "dégradée", waiting: "en attente" } as Record<string, string>)[value] || value.replaceAll("_", " ");
}

function formatUpdatedAt(value: number) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(value);
}

function claimLatencyLabel(value: number | null) {
  if (value == null) return "À mesurer";
  if (value < 60) return `${value} s`;
  return `${Math.floor(value / 60)} min ${value % 60} s`;
}

function workflowLabel(value: string | null) {
  if (value === "LIVE_MASTER") return "Master";
  if (value === "LIVE_M15_MONITOR") return "Monitor GPT M15";
  return "Planification backend";
}

function LiveProcessPulse({ data, refreshing }: { data: DeskSession; refreshing: boolean }) {
  const stages = [
    { label: "Données", detail: data.lastDataAt, state: data.lastDataAt === "—" ? "waiting" : "done" },
    { label: "Bundle", detail: data.claim.readyAt, state: data.claim.readyAt === "—" ? "waiting" : "done" },
    { label: "Claim", detail: data.claim.lastClaimAt, state: data.claim.nextTaskStatus === "in_progress" ? "active" : data.claim.lastClaimAt === "—" ? "waiting" : "done" },
    { label: data.claim.nextTaskLabel, detail: data.claim.dueCheckpoint, state: refreshing ? "active" : data.claim.nextTaskStatus },
  ];
  return <div className="live-process-pulse" aria-label="Processus live">
    <span className="live-process-pulse__label" title="Gestion déterministe des prix sur chaque clôture M1 ; analyse stratégique GPT toutes les 15 minutes et sur événement critique."><i className={refreshing ? "is-spinning" : ""}><Icon name="settings" size={14}/></i> Moteur M1 · GPT M15 + événements</span>
    <div>{stages.map((stage, index) => <span key={stage.label} data-state={stage.state}>
      <i/><strong>{stage.label}</strong><small>{stage.detail || "—"}</small>{index < stages.length - 1 && <em>→</em>}
    </span>)}</div>
  </div>;
}
