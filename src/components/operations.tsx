import { useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { Card, Icon, StatusPill } from "@/components/common";
import { workflowLabel } from "@/lib/presentation";
import type { OperationsEvent, PricePoint, WorkflowStatus, WorkflowSummary } from "@/operationsTypes";

export function Breadcrumbs({ items }: { items: Array<{ label: string; to?: string }> }) {
  return <nav className="breadcrumbs" aria-label="Fil d’Ariane">
    {items.map((item, index) => <span key={`${item.label}-${index}`}>
      {index > 0 && <Icon name="arrow" size={12}/>} {item.to ? <Link to={item.to}>{item.label}</Link> : <strong aria-current="page">{item.label}</strong>}
    </span>)}
  </nav>;
}

export function TechnicalDetails({
  title = "Références techniques",
  items,
}: {
  title?: string;
  items: Array<{ label: string; value: ReactNode }>;
}) {
  const visible = items.filter(item => item.value !== null && item.value !== undefined && item.value !== "");
  if (!visible.length) return null;
  return <details className="technical-details">
    <summary>{title}</summary>
    <dl className="technical-details__grid">
      {visible.map((item, index) => <span key={`${item.label}:${index}`} style={{ display: "contents" }}>
        <dt>{item.label}</dt><dd>{item.value}</dd>
      </span>)}
    </dl>
  </details>;
}

export function PageHeading({ eyebrow, title, subtitle, backTo, actions, tabs }: { eyebrow?: string; title: string; subtitle?: string; backTo?: string; actions?: ReactNode; tabs?: ReactNode }) {
  const navigate = useNavigate();
  return <header className="workspace-heading page-header-v2">
    <div className="workspace-heading__main">
      {backTo && <button className="back-btn" onClick={() => navigate(backTo)} aria-label="Retour au parent"><Icon name="collapse" size={17}/></button>}
      <div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
    </div>
    {actions && <div className="workspace-heading__actions">{actions}</div>}
    {tabs && <div className="page-header-v2__tabs">{tabs}</div>}
  </header>;
}

export function PageTabs({ items }: { items: Array<{ label: string; to: string; end?: boolean }> }) {
  return <>{items.map(item => <NavLink key={item.to} to={item.to} end={item.end}>{item.label}</NavLink>)}</>;
}

const statusGlyph: Record<string, string> = { queued: "○", running: "◐", waiting_gpt: "▲", paused: "Ⅱ", blocked: "□", failed: "×", completed: "✓", cancelled: "⊘", unknown: "?", open: "!", acknowledged: "✓", snoozed: "Ⅱ", resolved: "✓", archived: "○", pending: "!", read: "✓", dismissed: "−", cleared: "○", action_required: "!", waiting: "…", watching: "◐" };

export function StatusTag({ status }: { status: WorkflowStatus | string }) {
  const normalized = String(status || "unknown").toLowerCase();
  return <StatusPill status={normalized}><i aria-hidden="true">{statusGlyph[normalized] || "•"}</i>{statusLabel(normalized)}</StatusPill>;
}

export function ProgressBar({ value, status }: { value: number; status?: string }) {
  const safe = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return <div className={`progress-line progress-line--${status || "default"}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={safe}><i style={{ width: `${safe}%` }}/><span>{safe}%</span></div>;
}

export function MetricStrip({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`metric-grid metric-strip ${className}`}>{children}</div>;
}

export function MetricCard({ label, value, detail, tone = "neutral", onClick }: { label: string; value: ReactNode; detail?: string; tone?: string; onClick?: () => void }) {
  const Element = onClick ? "button" : "div";
  return <Element className={`metric-card metric-card--${tone} ${onClick ? "metric-card--interactive" : ""}`} onClick={onClick}><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</Element>;
}

export function EmptyWorkspace({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <Card className="workspace-empty"><Icon name="database" size={24}/><h3>{title}</h3><p>{text}</p>{action}</Card>;
}

export function WorkflowTable({ items, basePath = "/operations/workflows" }: { items: WorkflowSummary[]; basePath?: string }) {
  if (!items.length) return <EmptyWorkspace title="Aucune exécution" text="Les prochaines exécutions produites par le backend apparaîtront ici automatiquement."/>;
  return <div className="data-table-wrap"><table className="data-table">
    <thead><tr><th scope="col">Workflow</th><th scope="col">État</th><th scope="col">Session</th><th scope="col">Progression</th><th scope="col">Mise à jour</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
    <tbody>{items.map(item => <tr key={item.id}>
      <td data-label="Workflow"><strong>{workflowLabel(item.sourceId || item.id)}</strong><small>{item.name}</small></td>
      <td data-label="État"><StatusTag status={item.status}/></td>
      <td data-label="Session"><span>{item.tradingDate || "—"}</span><small>{item.session || item.kind}</small></td>
      <td data-label="Progression"><ProgressBar value={item.progress} status={item.status}/></td>
      <td data-label="Mise à jour"><time>{formatDateTime(item.updatedAt)}</time></td>
      <td data-label="Action"><Link className="row-link" to={`${basePath}/${encodeURIComponent(item.id)}`}><span>Ouvrir</span><Icon name="arrow" size={15}/></Link></td>
    </tr>)}</tbody>
  </table></div>;
}

export function EventTimeline({ events, runId, workflowId, selectedId, onSelect }: { events: OperationsEvent[]; runId?: string; workflowId?: string; selectedId?: string | null; onSelect?: (event: OperationsEvent) => void }) {
  if (!events.length) return <EmptyWorkspace title="Timeline vide" text="Les décisions, transitions et appels GPT seront horodatés ici."/>;
  return <ol className="event-timeline">{events.map(event => <li key={event.id} data-layer={event.layer || "event"} className={selectedId === event.id ? "is-selected" : ""}>
    <time>{formatDateTime(event.at)}</time><i aria-hidden="true"/><div tabIndex={onSelect ? 0 : undefined} onClick={() => onSelect?.(event)} onKeyDown={key => key.key === "Enter" && onSelect?.(event)}><div className="event-timeline__top"><strong>{event.title || event.type}</strong><StatusTag status={event.status}/></div>
      <p>{event.detail || event.conclusion || event.decision || "Transition enregistrée"}</p>
      {event.processId && runId && <Link to={`/replay/runs/${encodeURIComponent(runId)}/gpt/${encodeURIComponent(event.processId)}`}>Inspecter GPT <Icon name="arrow" size={13}/></Link>}
      {!event.processId && (workflowId || event.workflowId) && <Link to={`/operations/workflows/${encodeURIComponent(workflowId || event.workflowId || "")}/events/${encodeURIComponent(event.id)}`}>Ouvrir l’événement <Icon name="arrow" size={13}/></Link>}
    </div>
  </li>)}</ol>;
}

export function ReplayChart({ prices, events, runId, selectedId, onSelect }: { prices: PricePoint[]; events: OperationsEvent[]; runId: string; selectedId?: string | null; onSelect?: (event: OperationsEvent | null) => void }) {
  const [zoom, setZoom] = useState(1);
  const [layers, setLayers] = useState({ decision: true, step: true, gpt: true });
  const [internalSelected, setInternalSelected] = useState<OperationsEvent | null>(null);
  const visible = useMemo(() => {
    const count = Math.max(20, Math.ceil(prices.length / zoom));
    return prices.slice(Math.max(0, prices.length - count));
  }, [prices, zoom]);
  const filteredEvents = useMemo(() => events.filter(event => layers[event.layer as keyof typeof layers] !== false), [events, layers]);
  const selected = selectedId !== undefined ? filteredEvents.find(event => event.id === selectedId) || null : internalSelected;
  const chart = useMemo(() => chartModel(visible, filteredEvents), [visible, filteredEvents]);
  const select = (event: OperationsEvent | null) => { setInternalSelected(event); onSelect?.(event); };
  const windowLabel = visible.length ? `${formatTime(visible[0]?.time)}–${formatTime(visible.at(-1)?.time)}` : "indisponible";

  return <Card className="decision-chart replay-chart-v2">
    <header><div><p className="eyebrow">Timeline synchronisée</p><h2>Prix & décisions</h2><small>Fenêtre · {windowLabel}</small></div><div className="chart-controls">
      <div className="zoom-control"><button type="button" aria-label="Réduire le zoom" onClick={() => setZoom(value => Math.max(1, value - 1))}>−</button><label>Zoom <input aria-label="Zoom timeline" type="range" min="1" max="8" step="1" value={zoom} onChange={event => setZoom(Number(event.target.value))}/></label><button type="button" aria-label="Augmenter le zoom" onClick={() => setZoom(value => Math.min(8, value + 1))}>+</button></div>
      <div className="layer-toggles" role="group" aria-label="Couches affichées">{Object.keys(layers).map(layer => <button type="button" key={layer} data-layer={layer} aria-pressed={layers[layer as keyof typeof layers]} className={layers[layer as keyof typeof layers] ? "active" : ""} onClick={() => setLayers(value => ({ ...value, [layer]: !value[layer as keyof typeof layers] }))}><i/>{layerLabel(layer)}</button>)}</div>
    </div></header>
    {!visible.length ? <div className="chart-empty"><Icon name="chart"/><strong>Aucune bougie matérialisée</strong><p>Les décisions restent disponibles ci-dessous. Aucun prix n’est inventé.</p><ol className="chart-fallback-timeline">{filteredEvents.map(event => <li key={event.id}><time>{formatTime(event.at)}</time><span><strong>{event.title}</strong><small>{event.conclusion || event.detail || statusLabel(event.status)}</small></span><StatusTag status={event.status}/></li>)}</ol></div> : <div className="chart-scroll"><svg viewBox="0 0 1000 420" preserveAspectRatio="none" role="img" aria-label="Évolution du prix et décisions du replay">
      {[0,1,2,3,4].map(index => { const y = 35 + index * 78; return <g key={index}><line x1="70" x2="975" y1={y} y2={y} className="chart-grid"/><text x="5" y={y + 4}>{(chart.max - (chart.spread * index / 4)).toFixed(2)}</text></g>; })}
      <path d={chart.area} className="price-area"/><path d={chart.line} className="price-line"/>
      {chart.markers.map(marker => <g key={marker.event.id} className={`chart-marker chart-marker--${marker.event.layer} ${selected?.id === marker.event.id ? "is-selected" : ""}`} tabIndex={0} role="button" aria-label={`${marker.event.title}, ${formatTime(marker.event.at)}, ${marker.event.conclusion || marker.event.detail || marker.event.status}`} onFocus={() => select(marker.event)} onMouseEnter={() => select(marker.event)} onClick={() => select(marker.event)}>
        <line x1={marker.x} x2={marker.x} y1="35" y2="347"/>{markerShape(marker.event.layer, marker.x, marker.y)}
      </g>)}
      {selected && chart.markers.find(item => item.event.id === selected.id) && (() => { const marker = chart.markers.find(item => item.event.id === selected.id)!; return <g className="chart-tooltip"><line x1={marker.x} x2={marker.x} y1="28" y2="356"/><rect x={Math.min(765, Math.max(75, marker.x - 100))} y="10" width="200" height="52" rx="6"/><text x={Math.min(780, Math.max(90, marker.x - 85))} y="31">{formatTime(marker.event.at)} · {marker.event.title}</text><text x={Math.min(780, Math.max(90, marker.x - 85))} y="49">{marker.event.decision || marker.event.status}</text></g>; })()}
      <text x="70" y="392">{formatTime(visible[0]?.time)}</text><text x="900" y="392">{formatTime(visible.at(-1)?.time)}</text>
    </svg></div>}
    <div className="chart-event-strip" aria-label="Événements du graphique">{filteredEvents.slice(-12).map(event => <Link key={event.id} className={selected?.id === event.id ? "is-selected" : ""} onMouseEnter={() => select(event)} onFocus={() => select(event)} to={event.processId ? `/replay/runs/${encodeURIComponent(runId)}/gpt/${encodeURIComponent(event.processId)}` : "#timeline-events"}><i data-layer={event.layer}/><span>{formatTime(event.at)}</span><strong>{event.title}</strong></Link>)}</div>
  </Card>;
}

export const DecisionChart = ReplayChart;

function markerShape(layer: string | undefined, x: number, y: number) {
  if (layer === "decision") return <rect x={x - 6} y={y - 6} width="12" height="12" transform={`rotate(45 ${x} ${y})`}/>;
  if (layer === "gpt") return <path d={`M ${x} ${y - 8} L ${x + 8} ${y + 7} L ${x - 8} ${y + 7} Z`}/>;
  return <circle cx={x} cy={y} r="7"/>;
}

function layerLabel(layer: string) { return ({ decision: "Décision", step: "Étape", gpt: "GPT" } as Record<string,string>)[layer] || layer; }

function chartModel(points: PricePoint[], events: OperationsEvent[]) {
  const closes = points.map(point => point.close).filter(Number.isFinite);
  const min = closes.length ? Math.min(...closes) : 0;
  const max = closes.length ? Math.max(...closes) : 1;
  const spread = Math.max(max - min, Math.abs(max || 1) * .001);
  const x = (index: number) => 70 + (index / Math.max(1, points.length - 1)) * 905;
  const y = (price: number) => 347 - ((price - min) / spread) * 312;
  const coords = points.map((point, index) => [x(index), y(point.close)] as const);
  const line = coords.map(([cx, cy], index) => `${index ? "L" : "M"} ${cx.toFixed(1)} ${cy.toFixed(1)}`).join(" ");
  const from = Date.parse(points[0]?.time || "");
  const to = Date.parse(points.at(-1)?.time || "");
  const markers = events.map(event => {
    const at = Date.parse(event.at || "");
    if (!Number.isFinite(at) || !Number.isFinite(from) || !Number.isFinite(to) || at < from || at > to) return null;
    const cx = 70 + ((at - from) / Math.max(1, to - from)) * 905;
    const nearest = points.reduce((best, point, index) => Math.abs(Date.parse(point.time) - at) < Math.abs(Date.parse(points[best]?.time || "") - at) ? index : best, 0);
    return { event, x: cx, y: y(points[nearest]?.close || min) };
  }).filter(Boolean) as Array<{ event: OperationsEvent; x: number; y: number }>;
  const area = line ? `${line} L ${coords.at(-1)?.[0] || 70} 347 L 70 347 Z` : "";
  return { min, max, spread, line, area, markers };
}

export function statusLabel(status: string) {
  const labels: Record<string, string> = {
    queued: "En attente",
    ready: "Prêt",
    leased: "Pris en charge",
    claimed: "Pris en charge",
    work_claimed: "Pris en charge",
    waiting_gpt: "Attente GPT",
    waiting_data: "Attente données",
    waiting_pack: "Préparation des données",
    preparing: "Préparation",
    running: "En cours",
    retrying: "Nouvelle tentative",
    blocked: "Bloqué",
    failed: "Échec",
    fetch_failed: "Collecte en échec",
    timeout: "Délai dépassé",
    completed: "Terminé",
    terminal: "Terminé",
    cancelled: "Annulé",
    paused: "En pause",
    disabled: "Désactivé",
    degraded: "Dégradé",
    healthy: "Opérationnel",
    unknown: "Inconnu",
    open: "Ouvert",
    acknowledged: "Acquitté",
    snoozed: "Reporté",
    resolved: "Résolu",
    archived: "Archivé",
    pending: "À lire",
    read: "Lu",
    dismissed: "Masqué",
    cleared: "Clôturé",
    action_required: "Action requise",
    waiting: "En attente",
    watching: "Sous surveillance",
  };
  return labels[status] || status;
}

export function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("fr-FR", { dateStyle:"short",timeStyle:"short",timeZone:"Europe/Paris" }).format(date);
}
export function formatTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value).slice(11,16) || value : new Intl.DateTimeFormat("fr-FR", { hour:"2-digit",minute:"2-digit",timeZone:"Europe/Paris" }).format(date);
}
export function formatDuration(value?: number | null) {
  if (value == null) return "—";
  if (value < 60_000) return `${Math.round(value / 1000)} s`;
  if (value < 3_600_000) return `${Math.round(value / 60_000)} min`;
  return `${(value / 3_600_000).toFixed(1)} h`;
}
