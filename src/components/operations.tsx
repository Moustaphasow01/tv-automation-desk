import { useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { Card, Icon, StatusBadge } from "@/components/common";
import type { OperationsEvent, PricePoint, WorkflowStatus, WorkflowSummary } from "@/operationsTypes";

export function WorkspaceNav() {
  const items = [
    ["/operations", "Opérations"], ["/replay", "Replay Lab"], ["/performance/analysis", "Performance"],
    ["/history", "Historique"], ["/strategies", "Stratégies"]
  ];
  return <nav className="workspace-nav" aria-label="Espaces métier">
    {items.map(([to, label]) => <NavLink key={to} to={to} className={({ isActive }) => isActive ? "active" : ""}>{label}</NavLink>)}
  </nav>;
}

export function Breadcrumbs({ items }: { items: Array<{ label: string; to?: string }> }) {
  return <nav className="breadcrumbs" aria-label="Fil d’Ariane">
    {items.map((item, index) => <span key={`${item.label}-${index}`}>
      {index > 0 && <Icon name="arrow" size={13}/>} {item.to ? <Link to={item.to}>{item.label}</Link> : <strong>{item.label}</strong>}
    </span>)}
  </nav>;
}

export function PageHeading({ eyebrow, title, subtitle, backTo, actions }: { eyebrow?: string; title: string; subtitle?: string; backTo?: string; actions?: ReactNode }) {
  const navigate = useNavigate();
  return <header className="workspace-heading">
    <div className="workspace-heading__main">
      {backTo && <button className="back-btn" onClick={() => navigate(backTo)} aria-label="Retour"><Icon name="arrow" size={18}/></button>}
      <div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
    </div>
    {actions && <div className="workspace-heading__actions">{actions}</div>}
  </header>;
}

export function StatusTag({ status }: { status: WorkflowStatus | string }) {
  const tone = status === "failed" ? "critical" : status === "blocked" || status === "waiting_gpt" || status === "paused" ? "warning" : status === "completed" ? "positive" : status === "running" ? "info" : "muted";
  return <StatusBadge tone={tone}>{statusLabel(status)}</StatusBadge>;
}

export function ProgressBar({ value }: { value: number }) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  return <div className="progress-line" title={`${safe}%`}><i style={{ width: `${safe}%` }}/><span>{safe}%</span></div>;
}

export function MetricCard({ label, value, detail, tone = "neutral" }: { label: string; value: ReactNode; detail?: string; tone?: string }) {
  return <Card className={`metric-card metric-card--${tone}`}><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</Card>;
}

export function EmptyWorkspace({ title, text }: { title: string; text: string }) {
  return <Card className="workspace-empty"><Icon name="database"/><h3>{title}</h3><p>{text}</p></Card>;
}

export function WorkflowTable({ items, basePath = "/operations/workflows" }: { items: WorkflowSummary[]; basePath?: string }) {
  if (!items.length) return <EmptyWorkspace title="Aucune exécution" text="Les prochaines exécutions produites par le backend apparaîtront ici automatiquement."/>;
  return <div className="data-table-wrap"><table className="data-table">
    <thead><tr><th>Workflow</th><th>État</th><th>Session</th><th>Progression</th><th>Mise à jour</th><th/></tr></thead>
    <tbody>{items.map(item => <tr key={item.id}>
      <td><strong>{item.name}</strong><small>{item.sourceId}</small></td>
      <td><StatusTag status={item.status}/></td>
      <td>{item.tradingDate || "—"}<small>{item.session || item.kind}</small></td>
      <td><ProgressBar value={item.progress}/></td>
      <td>{formatDateTime(item.updatedAt)}</td>
      <td><Link className="row-link" to={`${basePath}/${encodeURIComponent(item.id)}`}><span>Ouvrir</span><Icon name="arrow" size={15}/></Link></td>
    </tr>)}</tbody>
  </table></div>;
}

export function EventTimeline({ events, runId, workflowId }: { events: OperationsEvent[]; runId?: string; workflowId?: string }) {
  if (!events.length) return <EmptyWorkspace title="Timeline vide" text="Les décisions, transitions et appels GPT seront horodatés ici."/>;
  return <ol className="event-timeline">{events.map(event => <li key={event.id} data-layer={event.layer || "event"}>
    <time>{formatDateTime(event.at)}</time><i/><div><div className="event-timeline__top"><strong>{event.title || event.type}</strong><StatusTag status={event.status}/></div>
      <p>{event.detail || event.conclusion || event.decision || "Transition enregistrée"}</p>
      {event.processId && runId && <Link to={`/replay/runs/${encodeURIComponent(runId)}/gpt/${encodeURIComponent(event.processId)}`}>Inspecter GPT <Icon name="arrow" size={13}/></Link>}
      {!event.processId && workflowId && <Link to={`/operations/workflows/${encodeURIComponent(workflowId)}/events/${encodeURIComponent(event.id)}`}>Ouvrir l’événement <Icon name="arrow" size={13}/></Link>}
    </div>
  </li>)}</ol>;
}

export function DecisionChart({ prices, events, runId }: { prices: PricePoint[]; events: OperationsEvent[]; runId: string }) {
  const [zoom, setZoom] = useState(1);
  const [layers, setLayers] = useState({ decision: true, step: true, gpt: true });
  const visible = useMemo(() => {
    const count = Math.max(20, Math.round(prices.length / zoom));
    return prices.slice(-count);
  }, [prices, zoom]);
  const chart = useMemo(() => chartModel(visible, events.filter(event => layers[event.layer as keyof typeof layers] !== false)), [visible, events, layers]);
  return <Card className="decision-chart">
    <header><div><p className="eyebrow">Timeline synchronisée</p><h2>Prix & décisions</h2></div><div className="chart-controls">
      <label>Zoom <input aria-label="Zoom timeline" type="range" min="1" max="8" step="1" value={zoom} onChange={event => setZoom(Number(event.target.value))}/></label>
      {Object.keys(layers).map(layer => <button key={layer} className={layers[layer as keyof typeof layers] ? "active" : ""} onClick={() => setLayers(value => ({ ...value, [layer]: !value[layer as keyof typeof layers] }))}>{layer}</button>)}
    </div></header>
    {!visible.length ? <div className="chart-empty">Aucune bougie n’est encore matérialisée pour ce replay. Les décisions restent visibles dans la timeline ci-dessous.</div> : <div className="chart-scroll"><svg viewBox="0 0 1000 340" role="img" aria-label="Évolution du prix et décisions du replay">
      <defs><linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#69f0b4" stopOpacity=".28"/><stop offset="1" stopColor="#69f0b4" stopOpacity="0"/></linearGradient></defs>
      {[0, 1, 2, 3, 4].map(index => <line key={index} x1="55" x2="980" y1={35 + index * 65} y2={35 + index * 65} className="chart-grid"/>)}
      <path d={`${chart.area} L ${chart.lastX} 305 L 55 305 Z`} fill="url(#priceFill)"/>
      <path d={chart.line} className="price-line"/>
      {chart.markers.map(marker => <g key={marker.event.id} className={`chart-marker chart-marker--${marker.event.layer}`}>
        <line x1={marker.x} x2={marker.x} y1="35" y2="305"/><circle cx={marker.x} cy={marker.y} r="7"/>
        <title>{`${marker.event.title}: ${marker.event.conclusion || marker.event.detail || marker.event.status}`}</title>
      </g>)}
      <text x="55" y="330">{formatTime(visible[0]?.time)}</text><text x="900" y="330">{formatTime(visible.at(-1)?.time)}</text>
      <text x="5" y="42">{chart.max.toFixed(2)}</text><text x="5" y="305">{chart.min.toFixed(2)}</text>
    </svg></div>}
    <div className="chart-event-strip">{events.slice(-12).map(event => <Link key={event.id} to={event.processId ? `/replay/runs/${encodeURIComponent(runId)}/gpt/${encodeURIComponent(event.processId)}` : "#timeline-events"}><i data-layer={event.layer}/><span>{formatTime(event.at)}</span><strong>{event.title}</strong></Link>)}</div>
  </Card>;
}

function chartModel(points: PricePoint[], events: OperationsEvent[]) {
  const closes = points.map(point => point.close).filter(Number.isFinite);
  const min = closes.length ? Math.min(...closes) : 0;
  const max = closes.length ? Math.max(...closes) : 1;
  const spread = Math.max(max - min, Math.abs(max || 1) * .001);
  const x = (index: number) => 55 + (index / Math.max(1, points.length - 1)) * 925;
  const y = (price: number) => 295 - ((price - min) / spread) * 250;
  const coords = points.map((point, index) => [x(index), y(point.close)] as const);
  const line = coords.map(([cx, cy], index) => `${index ? "L" : "M"} ${cx.toFixed(1)} ${cy.toFixed(1)}`).join(" ");
  const from = Date.parse(points[0]?.time || "");
  const to = Date.parse(points.at(-1)?.time || "");
  const markers = events.map(event => {
    const at = Date.parse(event.at || "");
    if (!Number.isFinite(at) || !Number.isFinite(from) || !Number.isFinite(to) || at < from || at > to) return null;
    const cx = 55 + ((at - from) / Math.max(1, to - from)) * 925;
    const nearest = points.reduce((best, point, index) => Math.abs(Date.parse(point.time) - at) < Math.abs(Date.parse(points[best]?.time || "") - at) ? index : best, 0);
    return { event, x: cx, y: y(points[nearest]?.close || min) };
  }).filter(Boolean) as Array<{ event: OperationsEvent; x: number; y: number }>;
  return { min, max, line, area: line, lastX: coords.at(-1)?.[0] || 55, markers };
}

export function statusLabel(status: string) {
  const labels: Record<string, string> = { queued: "En attente", running: "En cours", waiting_gpt: "Attente GPT", blocked: "Bloqué", failed: "Échec", completed: "Terminé", cancelled: "Annulé", paused: "En pause", unknown: "Inconnu" };
  return labels[status] || status;
}

export function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" }).format(date);
}

export function formatTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value).slice(11, 16) || value : new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(date);
}

export function formatDuration(value?: number | null) {
  if (value === null || value === undefined) return "—";
  if (value < 60_000) return `${Math.round(value / 1000)} s`;
  if (value < 3_600_000) return `${Math.round(value / 60_000)} min`;
  return `${(value / 3_600_000).toFixed(1)} h`;
}
