import { useNavigate } from "react-router-dom";
import { Card, Icon, SectionTitle, StatusBadge, StatusPill } from "@/components/common";
import { deskStatusText as humanDeskText } from "@/lib/presentation";
import type { DeskSession, TimelineEvent } from "@/types";

const fmt = (value: number | null | undefined) => value == null ? "—" : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value);
const sameText = (left?: string | null, right?: string | null) => (left || "").trim().toLowerCase() === (right || "").trim().toLowerCase();
const severityTone = (value: string): "critical" | "warning" | "positive" | "info" =>
  value === "critical" ? "critical" : value === "warning" ? "warning" : "info";

export function DecisionDeskStrip({
  data,
  focusLabel = "Action suivante",
  focusValue,
  focusDetail,
  className = ""
}: {
  data: DeskSession;
  focusLabel?: string;
  focusValue?: string;
  focusDetail?: string;
  className?: string;
}) {
  const decisionTone = data.severity === "critical" ? "critical" : data.severity === "warning" || data.severity === "watch" ? "warning" : "info";
  const pipelineTone = data.claim.nextTaskStatus === "late"
    ? "critical"
    : data.claim.nextTaskStatus === "executed"
      ? "positive"
      : "info";
  const positionTone = data.position.unrealizedR == null ? "muted" : data.position.unrealizedR >= 0 ? "positive" : "critical";
  const riskValue = data.position.active
    ? `${data.position.unrealizedR == null ? "—" : data.position.unrealizedR.toFixed(2)} R`
    : data.setup.risk == null ? "—" : `${fmt(data.setup.risk)}%`;
  const riskDetail = data.position.active
    ? `${humanDeskText(data.position.status)} · entrée ${fmt(data.position.entry)}`
    : `RR ${fmt(data.setup.rr)} · ${humanDeskText(data.setup.statusLabel)}`;
  const nextCheckpoint = data.nextMonitorAt || data.lastMonitorAt || "—";
  const macroCheckpoint = data.macro[0] ? `${data.macro[0].time} · ${data.macro[0].title}` : "Macro —";
  return <Card className={`decision-desk-strip ${className}`.trim()} aria-label="Synthèse décisionnelle du Desk">
    <div className="decision-desk-cell decision-desk-cell--primary" data-tone={decisionTone}>
      <span>Décision</span>
      <strong>{humanDeskText(data.liveBrief.decision || data.status)}</strong>
      <small>{data.thesis.instrument} · {humanDeskText(data.thesis.direction)}</small>
    </div>
    <div className="decision-desk-cell" data-tone={decisionTone}>
      <span>{focusLabel}</span>
      <strong>{humanDeskText(focusValue || data.liveBrief.nextAction)}</strong>
      <small>{humanDeskText(focusDetail || data.liveBrief.action)}</small>
    </div>
    <div className="decision-desk-cell" data-tone={positionTone}>
      <span>Risque / PnL</span>
      <strong>{riskValue}</strong>
      <small>{riskDetail}</small>
    </div>
    <div className="decision-desk-cell" data-tone={pipelineTone}>
      <span>Pipeline</span>
      <strong>{data.claim.nextTaskStatusLabel}</strong>
      <small>{data.claim.nextTaskLabel} · {data.claim.dueCheckpoint || data.currentCheckpointAt}</small>
    </div>
    <div className="decision-desk-cell">
      <span>Checkpoint</span>
      <strong>{nextCheckpoint}</strong>
      <small>{macroCheckpoint}</small>
    </div>
  </Card>;
}

export function StatusRibbon({ data }: { data: DeskSession }) {
  const sessionTone = data.severity === "critical" ? "critical" : data.severity === "warning" || data.severity === "watch" ? "warning" : "info";
  return <div className="status-ribbon">
    <StatusPill tone={sessionTone}>{humanDeskText(data.status)}</StatusPill>
    <span className="status-chip">Données <strong>{data.lastDataAt}</strong></span>
    <span className="status-chip">Dernier Monitor <strong>{data.lastMonitorAt}</strong></span>
    <span className="status-chip">À traiter <strong>{data.claim.dueCheckpoint || data.currentCheckpointAt}</strong></span>
    <span className="status-chip">Suivant <strong>{data.nextCheckpointAt || data.nextMonitorAt}</strong></span>
  </div>;
}

export function DecisionCard({ data, onOpenSetup }: { data: DeskSession; onOpenSetup?: () => void }) {
  const tone = data.severity === "critical" ? "critical" : data.severity === "warning" || data.severity === "watch" ? "warning" : "info";
  const headline = humanDeskText(data.liveBrief.headline);
  const decision = humanDeskText(data.liveBrief.decision);
  const summary = humanDeskText(data.liveBrief.summary);
  const showSummary = !!summary && !sameText(summary, headline) && !sameText(summary, decision);
  return <Card className="decision-card">
    <div className="decision-card__signal" data-severity={data.severity}/>
    <div className="decision-card__body">
      <div className="decision-card__top">
        <div>
          <p className="eyebrow">{humanDeskText(data.liveBrief.eyebrow)}</p>
          <h2>{headline}</h2>
        </div>
        <StatusBadge tone={tone}>{humanDeskText(data.status)}</StatusBadge>
      </div>
      <div className="decision-card__decision">{decision}</div>
      {showSummary && <p className="decision-card__summary">{summary}</p>}
      <div className="decision-card__reasoning">
        <div><span>Pourquoi</span><p>{humanDeskText(data.liveBrief.why)}</p></div>
        <div><span>Prochaine action</span><p>{humanDeskText(data.liveBrief.nextAction)}</p></div>
      </div>
      <div className="decision-card__footer">
        <span className="action-pill">{humanDeskText(data.liveBrief.action)}</span>
        <button className="secondary-btn" onClick={onOpenSetup}>Setup & Position <Icon name="arrow" size={15}/></button>
      </div>
    </div>
  </Card>;
}

export function ThesisSummary({ data, onOpenThesis }: { data: DeskSession; onOpenThesis?: () => void }) {
  return <Card className="thesis-summary" onClick={onOpenThesis}>
    <div className="thesis-summary__head"><div><p className="eyebrow">Thèse active</p><h2>{data.thesis.instrument} · {humanDeskText(data.thesis.direction)}</h2></div><StatusBadge tone={data.thesis.status === "ACTIVE" ? "info" : "warning"}>{humanDeskText(data.thesis.status)}</StatusBadge></div>
    <p>{humanDeskText(data.thesis.dominantScenario)}</p>
    <dl><dt>Valide jusqu’à</dt><dd>{data.thesis.validUntil}</dd><dt>Prochain focus</dt><dd>{humanDeskText(data.thesis.nextFocus)}</dd></dl>
  </Card>;
}

export function MarketTable({ data }: { data: DeskSession }) {
  if (!data.market.length) return <Card className="workspace-empty market-empty-state">
    <Icon name="chart" size={24}/>
    <h3>Flux marché en attente</h3>
    <p>Aucun snapshot matérialisé. Le tableau apparaîtra au prochain cycle backend.</p>
  </Card>;
  return <div className="market-compact-grid">{data.market.map(item => <article className="market-compact-card" key={item.symbol} data-trend={item.trend}>
    <header><strong>{item.symbol}</strong><span className={item.trend === "up" ? "positive" : item.trend === "down" ? "negative" : ""}>{item.change}</span></header>
    <div className="market-compact-card__price">{item.price}</div>
    <dl><dt>RSI</dt><dd>{item.rsi || "—"}</dd><dt>ATR</dt><dd>{item.atr || "—"}</dd></dl>
    <small title={item.note}>{item.note || item.marketDate || "Source backend"}</small>
  </article>)}</div>;
}

export function AuditMini({ data, onOpenAudit }: { data: DeskSession; onOpenAudit?: () => void }) {
  const ready = data.dataQuality.status === "ready" && !data.dataQuality.warnings.length;
  return <Card className="audit-mini" onClick={onOpenAudit}>
    <div className="brief-card__header"><div><p className="eyebrow">Qualité & audit</p><h3>{data.dataQuality.label}</h3></div><StatusBadge tone={ready ? "info" : "warning"}>{ready ? "CONFORME" : "À CONTRÔLER"}</StatusBadge></div>
    <dl className="definition-grid"><dt>Anti-lookahead</dt><dd>{data.dataQuality.antiLookahead ? "Actif" : "Inactif"}</dd><dt>Avertissements</dt><dd>{data.dataQuality.warnings.length}</dd></dl>
    {!!data.dataQuality.warnings.length && <p>{data.dataQuality.warnings.map(qualityWarningLabel).join(" · ")}</p>}
    <span className="row-link">Ouvrir l’audit <Icon name="arrow" size={14}/></span>
  </Card>;
}

function qualityWarningLabel(value: string) {
  const [kind, detail] = value.split(":", 2);
  const labels: Record<string, string> = {
    technical_events: "Événements techniques indisponibles",
    cross_asset_delta: "Ancien delta cross-asset indisponible",
    optional_dataset_stale: "Source complémentaire ancienne",
    missing: "indisponible",
    "Contexte last-known": "Dernière valeur connue",
  };
  const base = labels[kind] || kind.replaceAll("_", " ");
  const detailLabel = detail ? labels[detail] || detail.replaceAll("_", " ") : "";
  return detail ? `${base} · ${detailLabel}` : labels[value] || value.replaceAll("_", " ");
}

export function BriefCard({ eyebrow, headline, text, verdict, icon }: { eyebrow: string; headline: string; text: string; verdict?: string; icon: "globe" | "chart" | "brain" | "news" }) {
  return <Card className="brief-card">
    <div className="brief-card__header"><div><p className="eyebrow">{eyebrow}</p><h3>{headline}</h3></div><span className="card-icon"><Icon name={icon}/></span></div>
    <p>{text}</p>{verdict && <div className="brief-card__verdict">{verdict}</div>}
  </Card>;
}

export function DeltaCard({ data }: { data: DeskSession }) {
  return <Card className="delta-card">
    <div className="brief-card__header"><div><p className="eyebrow">Delta Monitor</p><h3>{data.latestChange.title}</h3></div><span className="card-icon"><Icon name="change"/></span></div>
    <div className="delta-list">{data.latestChange.items.length ? data.latestChange.items.map((item, i) => <div className="delta-item" data-tone={item.tone} key={i}><span className="delta-item__dot"/><span>{item.text}</span></div>) : <TerminalEmpty code="NO_MONITOR_DELTA" label="Aucune évolution matérialisée depuis le dernier cycle."/>}</div>
    <div className="delta-consequence">{data.latestChange.consequence}</div>
  </Card>;
}

export function DeskReading({ data }: { data: DeskSession }) {
  const reading = data.deskReading || { facts: [], interpretation: [], thesisEvolution: [] };
  const sections = [
    { label: "Faits", items: reading.facts, tone: "fact" },
    { label: "Interprétation", items: reading.interpretation, tone: "interpretation" },
    { label: "Évolution de la thèse", items: reading.thesisEvolution, tone: "evolution" },
  ];
  return <div className="desk-reading-grid">{sections.map(section => <Card className="desk-reading-card" key={section.label}>
    <header><i data-tone={section.tone}/><strong>{section.label}</strong></header>
    <ul>{section.items.length ? section.items.map((item, index) => <li key={index}>{item}</li>) : <li>Aucune donnée structurée matérialisée.</li>}</ul>
  </Card>)}</div>;
}

export function ThesisCard({ data }: { data: DeskSession }) {
  const navigate = useNavigate();
  return <Card className="thesis-card" onClick={() => navigate("/thesis")}>
    <div className="thesis-card__top">
      <div className="thesis-card__instrument"><span className="instrument-badge">{data.thesis.instrument}</span><div><h3>Thèse active</h3><div className="thesis-card__subtitle">{humanDeskText(data.thesis.direction)} · jusqu’à {data.thesis.validUntil}</div></div></div>
      <StatusBadge tone={data.thesis.health < 40 ? "critical" : "warning"}>{humanDeskText(data.thesis.status)}</StatusBadge>
    </div>
    <p className="thesis-card__scenario">{data.thesis.dominantScenario}</p>
    <div className="thesis-card__metrics">
      <div><span>Santé</span><strong>{data.thesis.health}</strong><small>{data.thesis.initialHealth} initial</small></div>
      <div><span>Confiance</span><strong>{data.thesis.confidence}%</strong><small>{data.thesis.initialConfidence}% initial</small></div>
    </div>
    <div className="thesis-card__focus"><span>Prochain focus</span><p>{data.thesis.nextFocus}</p></div>
  </Card>;
}

export function SetupCard({ data, onOpenSetup }: { data: DeskSession; onOpenSetup?: () => void }) {
  const s = data.setup;
  return <Card className="setup-card" onClick={onOpenSetup}>
    <div className="setup-card__header"><div><p className="eyebrow">Setup</p><h3>{s.label}</h3></div><StatusBadge tone={s.geometryReady ? "info" : s.id === "no-setup" ? "muted" : "warning"}>{humanDeskText(s.statusLabel)}</StatusBadge></div>
    <div className="setup-card__body">
      <div className="price-grid">
        <div className="price-box"><span>Borne basse</span><strong>{fmt(s.entryLower ?? s.entryFrom)}</strong></div>
        <div className="price-box"><span>Borne haute</span><strong>{fmt(s.entryUpper ?? s.entryTo)}</strong></div>
        <div className="price-box price-box--execution"><span>Prix d’exécution</span><strong>{fmt(s.executionEntry)}</strong><small>{s.executionRule}</small></div>
        <div className="price-box"><span>Stop</span><strong>{fmt(s.stop)}</strong></div>
        <div className="price-box"><span>TP1</span><strong>{fmt(s.tp1)}</strong></div>
        <div className="price-box"><span>TP2 / TP3</span><strong>{fmt(s.tp2)} / {fmt(s.tp3)}</strong></div>
      </div>
      <div className="setup-card__reason">{s.reason}</div>
    </div>
    <div className="setup-card__footer"><span>{humanDeskText(s.statusLabel)}</span><span>RR {fmt(s.rr)} / min {fmt(s.minimumRr)} · risque {s.risk == null ? "—" : `${fmt(s.risk)}%`}</span></div>
  </Card>;
}

export function PositionCard({ data, onOpenPosition }: { data: DeskSession; onOpenPosition?: () => void }) {
  const p = data.position;
  return <Card className="position-react-card" onClick={onOpenPosition}>
    <div className="brief-card__header"><div><p className="eyebrow">{p.executionMode === "paper" ? "Position paper" : "Position canonique"}</p><h3>{p.active ? `${p.instrument} ${humanDeskText(p.direction)}` : p.status === "CLOSED" ? "Trade historique clôturé" : "Aucune position active"}</h3></div><StatusBadge tone={p.active ? "info" : p.status === "CLOSED" ? "positive" : "muted"}>{humanDeskText(p.status)}</StatusBadge></div>
    <div className="position-react-grid">
      <div><span>Entrée</span><strong>{fmt(p.entry)}</strong></div><div><span>Cours / sortie</span><strong>{fmt(p.current)}</strong></div><div><span>Résultat</span><strong>{p.unrealizedR != null ? `${p.unrealizedR.toFixed(2)} R` : "—"}</strong></div>
    </div>
    <p>{p.note}</p>
    <div className="source-priority-react"><Icon name="database" size={15}/> {p.executionMode === "paper" ? "Simulation backend · aucun ordre broker" : "Source prioritaire : backend d’exécution"}</div>
  </Card>;
}

export function ActivityCard({ data }: { data: DeskSession }) {
  return <Card className="activity-card">
    <div className="brief-card__header"><div><p className="eyebrow">Activité du Desk</p><h3>Ce que le système fait</h3></div><span className="card-icon"><Icon name="settings"/></span></div>
    <div className="activity-list">{data.activity.length ? data.activity.map((item, i) => <div className="activity-item" data-state={item.status === "queued" ? "scheduled" : item.status} key={i}><span className="activity-time">{item.time}</span><span className="activity-line"><span className="activity-dot"/></span><div><div className="activity-label">{item.title}</div><div className="activity-detail">{item.detail}</div></div></div>) : <TerminalEmpty code="NO_WORKER_ACTIVITY" label="Aucune activité worker pour cette session."/>}</div>
  </Card>;
}

export function ExpectedRealized({ monitor, compact = false }: { monitor: DeskSession["monitors"][number]; compact?: boolean }) {
  return <div className={`comparison-react ${compact ? "compact" : ""}`}>
    {monitor.expectedVsRealized.map((row, i) => <div className="comparison-react__row" key={i}>
      <div className="comparison-react__head"><strong>{row.element}</strong><StatusBadge tone={row.verdict === "invalidate" ? "critical" : row.verdict === "confirm" ? "info" : "muted"}>{row.verdict}</StatusBadge></div>
      <div className="comparison-react__cols"><div><span>Attendu</span><p>{row.expected}</p></div><div><span>Réalisé</span><p>{row.realized}</p></div></div>
      {!compact && <small>{row.impact}</small>}
    </div>)}
  </div>;
}

export function Conditions({ title, items }: { title: string; items: DeskSession["monitors"][number]["goConditions"] }) {
  return <Card className="conditions-react"><h3>{title}</h3><div>{items.length ? items.map((item, i) => <div className="condition-react" key={i}>
    <span className={`condition-react__icon ${item.status}`}><Icon name={item.status === "failed" || item.status === "triggered" ? "x" : item.status === "validated" || item.status === "previously_validated" ? "check" : "minus"} size={15}/></span>
    <div><div className="condition-react__head"><strong>{item.label}</strong><StatusBadge tone={item.status === "failed" || item.status === "triggered" ? "critical" : item.status === "completed" ? "positive" : "info"}>{item.status}</StatusBadge></div><p>{item.proof}</p><small>{item.impact} · {item.deterministic ? "déterministe" : "interprétation"}</small></div>
  </div>) : <p className="empty-copy">Aucune condition disponible.</p>}</div></Card>;
}

export function Timeline({ data, compact = false, onSelect }: { data: DeskSession; compact?: boolean; onSelect?: (event: DeskSession["timeline"][number]) => void }) {
  const items = compact ? data.timeline.slice(-4) : data.timeline;
  return <div className="timeline">{items.length ? items.map((event, i) => <div className="timeline-item" data-type={event.type.toLowerCase()} data-status={severityTone(event.severity)} key={i}>
    <time className="timeline-item__time">{event.time}</time>
    <button className="timeline-item__content" onClick={() => onSelect?.(event)}>
      <div className="timeline-item__header"><strong>{event.title}</strong><StatusBadge tone={severityTone(event.severity)}>{event.status}</StatusBadge></div>
      <p>{event.summary}</p>{!compact && <small>{event.type} · {event.sourceType}</small>}
    </button>
  </div>) : <TerminalEmpty code="NO_TIMELINE_EVENT" label="Le journal se remplira au prochain événement du Desk."/>}</div>;
}

export function OperationalTimeline({
  data,
  onSelect,
}: {
  data: DeskSession;
  onSelect?: (event: TimelineEvent) => void;
}) {
  const items = data.operationalTimeline || [];
  if (!items.length) return <TerminalEmpty code="NO_OPERATIONAL_TIMELINE" label="La comparaison planifié / réel apparaîtra au prochain checkpoint."/>;
  return <div className="operational-timeline" style={{ "--timeline-columns": items.length } as React.CSSProperties}>
    <div className="operational-timeline__lane operational-timeline__lane--planned">
      <strong className="operational-timeline__lane-label">Planifié</strong>
      <div className="operational-timeline__rail">{items.map(item => <button key={`planned-${item.id}`} onClick={() => onSelect?.(timelineEventFromOperational(item, "Planifié"))}>
        <i/><time>{item.plannedTime}</time><span>{item.label}</span>
      </button>)}</div>
    </div>
    <div className="operational-timeline__lane operational-timeline__lane--actual">
      <strong className="operational-timeline__lane-label">Réel</strong>
      <div className="operational-timeline__rail">{items.map(item => <button
        key={`actual-${item.id}`}
        data-status={item.actualAt ? "done" : item.status.toLowerCase()}
        onClick={() => onSelect?.(timelineEventFromOperational(item, "Réel"))}
      >
        <i/><time>{item.actualTime}</time><span>{item.actualAt ? latencyLabel(item.latencySeconds) : humanDeskText(item.status)}</span>
      </button>)}</div>
    </div>
  </div>;
}

function timelineEventFromOperational(item: DeskSession["operationalTimeline"][number], lane: string): TimelineEvent {
  return {
    time: lane === "Réel" ? item.actualTime : item.plannedTime,
    type: item.type,
    title: `${item.label} · ${lane}`,
    status: item.status,
    detail: `${item.detail}${item.latencySeconds == null ? "" : ` Délai observé : ${latencyLabel(item.latencySeconds)}.`}`,
    severity: item.status.toLowerCase().includes("late") ? "warning" : item.actualAt ? "positive" : "info",
    summary: item.summary,
    sourceType: "LIVE_SCHEDULE",
  };
}

function latencyLabel(value: number | null) {
  if (value == null) return "En attente";
  if (value < 60) return `+${value} s`;
  return `+${Math.floor(value / 60)} min ${value % 60} s`;
}

function TerminalEmpty({ code: _code, label }: { code: string; label: string }) {
  return <div className="terminal-empty-state terminal-empty-state--human"><span>{label}</span></div>;
}

export function MacroNewsCard({ data, onOpenNews }: { data: DeskSession; onOpenNews?: () => void }) {
  const next = data.macro.find(event => event.isNext);
  const latest = data.macro.at(-1);
  const focus = next || latest;
  const nextHeadlineIndex = data.news.headlines.findIndex(headline => headline.isNext);
  const previewStart = nextHeadlineIndex >= 0
    ? Math.max(0, nextHeadlineIndex - 3)
    : 0;
  const preview = data.news.headlines.slice(previewStart, previewStart + 12);
  return <Card className="brief-card macro-news-card" onClick={onOpenNews}>
    <div className="brief-card__header"><div><p className="eyebrow">Macro & News · ±48 h</p><h3>{focus ? `${focus.time} · ${focus.title}` : "Aucun événement disponible"}</h3></div><span className="card-icon"><Icon name="news"/></span></div>
    {focus && <p>{focus.impactText}</p>}
    <div className="news-digest-preview"><span>Digest · {data.news.digestUpdatedAt}</span><p>{data.news.digest}</p></div>
    <div className="macro-news-card__scroll" aria-label="Événements macro et news sur 48 heures">
      {preview.length ? preview.map((headline, index) => <div className={headline.isNext ? "macro-news-card__row is-next" : "macro-news-card__row"} key={`${headline.scheduledAt || headline.time}-${headline.title}-${index}`}>
        <time>{headline.date && headline.date !== data.date ? shortMacroDate(headline.date) : headline.time}</time>
        <span><strong>{headline.title}</strong><small>{headline.source} · {headline.time}</small></span>
      </div>) : <div className="macro-news-card__empty">Aucun événement ni headline dans la fenêtre disponible.</div>}
    </div>
    <div className="brief-card__verdict">{data.news.headlines.length} titres disponibles</div>
  </Card>;
}

function shortMacroDate(date?: string) {
  if (!date) return "—";
  const [, month = "", day = ""] = date.split("-");
  return `${day}/${month}`;
}

export function LiveSectionHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return <SectionTitle title={title} subtitle={subtitle} action={action}/>;
}
