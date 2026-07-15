import { useNavigate } from "react-router-dom";
import { Card, HealthOrb, Icon, SectionTitle, StatusBadge } from "@/components/common";
import { useOverlay } from "@/context/OverlayContext";
import type { DeskSession, MarketItem } from "@/types";

const fmt = (value: number | null | undefined) => value == null ? "—" : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value);
const severityTone = (value: string): "critical" | "warning" | "positive" | "info" =>
  value === "critical" ? "critical" : value === "warning" ? "warning" : value === "positive" ? "positive" : "info";

function MarketIntradayChart({ item }: { item: MarketItem }) {
  const series = (item.series || []).filter(point => Number.isFinite(point.close));
  const timeframe = item.seriesTimeframe || "M1";
  if (series.length < 2) return <section className="drawer-section market-chart-card">
    <div className="market-chart-card__heading"><div><p className="eyebrow">Évolution intraday</p><h3>Courbe M1</h3></div><StatusBadge tone="muted">INDISPONIBLE</StatusBadge></div>
    <p className="market-chart-empty">Aucune série de bougies M1 n’est disponible pour {item.symbol}.</p>
  </section>;

  const width = 720;
  const height = 230;
  const padX = 12;
  const padTop = 14;
  const padBottom = 26;
  const closes = series.map(point => point.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = Math.max(max - min, Math.abs(max) * 0.0001, 1e-9);
  const chartHeight = height - padTop - padBottom;
  const coords = series.map((point, index) => ({
    x: padX + index * (width - padX * 2) / Math.max(series.length - 1, 1),
    y: padTop + (max - point.close) / range * chartHeight,
  }));
  const polyline = coords.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const area = `${padX},${height - padBottom} ${polyline} ${width - padX},${height - padBottom}`;
  const firstTime = new Date(series[0].time).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const lastTime = new Date(series.at(-1)!.time).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const formatPrice = (value: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value);

  return <section className={`drawer-section market-chart-card market-chart-card--${item.trend}`}>
    <div className="market-chart-card__heading">
      <div><p className="eyebrow">Évolution intraday</p><h3>Courbe {timeframe}</h3></div>
      <StatusBadge tone={timeframe === "M1" ? "positive" : "warning"}>{timeframe === "M1" ? "TEMPS RÉEL" : "M1 INDISPONIBLE"}</StatusBadge>
    </div>
    <div className="market-chart-card__stats">
      <span>Bas <strong>{formatPrice(min)}</strong></span><span>Haut <strong>{formatPrice(max)}</strong></span><span>Dernier <strong>{formatPrice(series.at(-1)!.close)}</strong></span>
    </div>
    <div className="market-chart-card__plot">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`Courbe ${timeframe} de ${item.symbol}`}>
        <line x1={padX} y1={padTop} x2={width - padX} y2={padTop} className="market-chart-grid"/>
        <line x1={padX} y1={padTop + chartHeight / 2} x2={width - padX} y2={padTop + chartHeight / 2} className="market-chart-grid"/>
        <line x1={padX} y1={height - padBottom} x2={width - padX} y2={height - padBottom} className="market-chart-grid"/>
        <polygon points={area} className="market-chart-area"/>
        <polyline points={polyline} className="market-chart-line"/>
        <circle cx={coords.at(-1)!.x} cy={coords.at(-1)!.y} r="5" className="market-chart-last"/>
      </svg>
      <div className="market-chart-card__axis"><span>{firstTime}</span><span>{series.length} bougies</span><span>{lastTime}</span></div>
    </div>
  </section>;
}

export function StatusRibbon({ data }: { data: DeskSession }) {
  const quality = data.dataQuality.status === "ready" ? "ready" : "warning";
  return <div className="status-ribbon">
    <span className="status-chip"><i className={`status-dot status-dot--${data.severity}`}/><strong>{data.status}</strong></span>
    <span className="status-chip">Données <strong>{data.lastDataAt}</strong></span>
    <span className="status-chip"><i className={`status-dot status-dot--${quality}`}/>{data.dataQuality.label}</span>
    <span className="status-chip">Monitor <strong>{data.lastMonitorAt}</strong></span>
    <span className="status-chip">Prochain <strong>{data.nextMonitorAt}</strong></span>
  </div>;
}

export function HeroCard({ data }: { data: DeskSession }) {
  const overlay = useOverlay();
  return <Card className="hero-card">
    <div data-severity={data.severity}>
      <div className="hero-card__top">
        <div>
          <p className="eyebrow">{data.liveBrief.eyebrow}</p>
          <h1>{data.liveBrief.headline}</h1>
          <div className="hero-card__decision"><i className={`status-dot status-dot--${data.severity}`}/>{data.liveBrief.decision}</div>
        </div>
        <HealthOrb score={data.thesis.health}/>
      </div>
      <p className="hero-card__summary">{data.liveBrief.summary}</p>
      <div className="hero-card__footer">
        <span className="action-pill">{data.liveBrief.action}</span>
        <button className="text-btn" onClick={() => overlay.openDrawer("Pourquoi cette décision ?", <div>
          <section className="drawer-section"><h3>Raisonnement</h3><p>{data.liveBrief.why}</p></section>
          <section className="drawer-section"><h3>Action immédiate</h3><p>{data.liveBrief.nextAction}</p></section>
          <section className="drawer-section"><div className="detail-pairs"><div><span>Décision</span><strong>{data.liveBrief.decision}</strong></div><div><span>Thèse</span><strong>{data.thesis.status}</strong></div><div><span>Confiance</span><strong>{data.thesis.confidence} %</strong></div></div></section>
        </div>)}>Pourquoi ? <Icon name="arrow" size={15}/></button>
      </div>
    </div>
  </Card>;
}

export function MarketStrip({ data }: { data: DeskSession }) {
  const overlay = useOverlay();
  const futures = data.market.filter(item => ["MNQ", "MES", "MCL"].includes(item.symbol));
  const megaCaps = data.market.filter(item => ["NVDA", "AAPL", "MSFT", "TSLA", "SMH", "SOXX"].includes(item.symbol));
  const groupedItems = new Set([...futures, ...megaCaps]);
  const other = data.market.filter(item => !groupedItems.has(item));
  const groups = [
    { key: "futures", label: "Futures", items: futures },
    { key: "mega-caps", label: "Mega caps & semis", items: megaCaps },
    { key: "cross-asset", label: "Cross-asset", items: other },
  ].filter(group => group.items.length);
  return <div className="market-overview">
    {groups.map(group => <section className={`market-group market-group--${group.key}`} key={group.key}>
      <div className="market-group__heading"><h3>{group.label}</h3><span>OHLC journalier</span></div>
      <div className="market-strip">
        {group.items.map(item => {
          const ohlc = item.ohlc || { open: "—", high: "—", low: "—", close: item.price };
          return <button key={item.symbol} className={"market-card market-card--" + item.trend + " card--clickable"} onClick={() => overlay.openDrawer(item.symbol + " · prix & évolution", <div>
            <section className="drawer-section"><div className="drawer-market-price">{item.price}</div><div className={"drawer-market-change " + item.trend}>{item.change}</div><p>{item.note}</p></section>
            <MarketIntradayChart item={item}/>
            <section className="drawer-section"><h3>OHLC du jour</h3><div className="detail-pairs detail-pairs--four"><div><span>Open</span><strong>{ohlc.open}</strong></div><div><span>High</span><strong>{ohlc.high}</strong></div><div><span>Low</span><strong>{ohlc.low}</strong></div><div><span>Close</span><strong>{ohlc.close}</strong></div></div></section>
            <section className="drawer-section"><h3>Indicateurs & source</h3><div className="detail-pairs"><div><span>RSI 14</span><strong>{item.rsi || "—"}</strong></div><div><span>ATR 14</span><strong>{item.atr || "—"}</strong></div><div><span>Source</span><strong>{item.source || "backend"}</strong></div><div><span>Date marché</span><strong>{item.marketDate || "—"}</strong></div></div></section>
          </div>)}>
            <div className="market-card__top">
              <span className="market-card__symbol">{item.symbol}</span>
              <span className={"trend-mark trend-mark--" + item.trend}><Icon name={item.trend === "up" ? "trendUp" : item.trend === "down" ? "trendDown" : "minus"}/></span>
            </div>
            <div className="market-card__quote">
              <strong className="market-card__price">{item.price}</strong>
              <span className={"market-card__change " + item.trend}>{item.change}</span>
            </div>
            <div className="market-card__ohlc" aria-label={`OHLC ${item.symbol}`}>
              <span><small>Open</small><strong>{ohlc.open}</strong></span>
              <span><small>High</small><strong>{ohlc.high}</strong></span>
              <span><small>Low</small><strong>{ohlc.low}</strong></span>
              <span><small>Close</small><strong>{ohlc.close}</strong></span>
            </div>
            <div className="market-card__footer">
              <div className="market-card__indicators"><span><small>RSI</small><strong>{item.rsi || "—"}</strong></span><span><small>ATR</small><strong>{item.atr || "—"}</strong></span></div>
              <time className="market-card__note">{item.note}</time>
            </div>
          </button>;
        })}
      </div>
    </section>)}
  </div>;
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
    <div className="delta-list">{data.latestChange.items.map((item, i) => <div className="delta-item" data-tone={item.tone} key={i}><span className="delta-item__dot"/><span>{item.text}</span></div>)}</div>
    <div className="delta-consequence">{data.latestChange.consequence}</div>
  </Card>;
}

export function ThesisCard({ data }: { data: DeskSession }) {
  const navigate = useNavigate();
  return <Card className="thesis-card" onClick={() => navigate("/thesis")}>
    <div className="thesis-card__top">
      <div className="thesis-card__instrument"><span className="instrument-badge">{data.thesis.instrument}</span><div><h3>Thèse active</h3><div className="thesis-card__subtitle">{data.thesis.direction.toUpperCase()} · jusqu’à {data.thesis.validUntil}</div></div></div>
      <StatusBadge tone={data.thesis.health < 40 ? "critical" : "warning"}>{data.thesis.status}</StatusBadge>
    </div>
    <p className="thesis-card__scenario">{data.thesis.dominantScenario}</p>
    <div className="thesis-card__metrics">
      <div><span>Santé</span><strong>{data.thesis.health}</strong><small>{data.thesis.initialHealth} initial</small></div>
      <div><span>Confiance</span><strong>{data.thesis.confidence}%</strong><small>{data.thesis.initialConfidence}% initial</small></div>
    </div>
    <div className="thesis-card__focus"><span>Prochain focus</span><p>{data.thesis.nextFocus}</p></div>
  </Card>;
}

export function SetupCard({ data }: { data: DeskSession }) {
  const navigate = useNavigate();
  const s = data.setup;
  return <Card className="setup-card" onClick={() => navigate("/setup")}>
    <div className="setup-card__header"><div><p className="eyebrow">Setup</p><h3>{s.label}</h3></div><StatusBadge tone={s.status === "ACTIVE" ? "positive" : "critical"}>{s.status}</StatusBadge></div>
    <div className="setup-card__body">
      <div className="price-grid">
        <div className="price-box"><span>Entrée</span><strong>{fmt(s.entryFrom)}–{fmt(s.entryTo)}</strong></div>
        <div className="price-box"><span>Stop</span><strong>{fmt(s.stop)}</strong></div>
        <div className="price-box"><span>TP1</span><strong>{fmt(s.tp1)}</strong></div>
        <div className="price-box"><span>TP2 / TP3</span><strong>{fmt(s.tp2)} / {fmt(s.tp3)}</strong></div>
      </div>
      <div className="setup-card__reason">{s.reason}</div>
    </div>
    <div className="setup-card__footer"><span>{s.statusLabel}</span><span>RR {fmt(s.rr)} · risque {s.risk == null ? "—" : `${fmt(s.risk)}%`}</span></div>
  </Card>;
}

export function PositionCard({ data }: { data: DeskSession }) {
  const navigate = useNavigate();
  const p = data.position;
  return <Card className="position-react-card" onClick={() => navigate("/setup#position")}>
    <div className="brief-card__header"><div><p className="eyebrow">Position canonique</p><h3>{p.active ? `${p.instrument} ${p.direction}` : p.status === "CLOSED" ? "Trade historique clôturé" : "Aucune position live"}</h3></div><StatusBadge tone={p.active ? "positive" : "info"}>{p.status}</StatusBadge></div>
    <div className="position-react-grid">
      <div><span>Entry</span><strong>{fmt(p.entry)}</strong></div><div><span>Mark / Exit</span><strong>{fmt(p.current)}</strong></div><div><span>Résultat</span><strong>{p.unrealizedR != null ? `${p.unrealizedR.toFixed(2)} R` : "—"}</strong></div>
    </div>
    <p>{p.note}</p>
    <div className="source-priority-react"><Icon name="database" size={15}/> Source prioritaire : backend d’exécution</div>
  </Card>;
}

export function ActivityCard({ data }: { data: DeskSession }) {
  return <Card className="activity-card">
    <div className="brief-card__header"><div><p className="eyebrow">Activité du Desk</p><h3>Ce que le système fait</h3></div><span className="card-icon"><Icon name="settings"/></span></div>
    <div className="activity-list">{data.activity.map((item, i) => <div className="activity-item" data-state={item.status === "queued" ? "scheduled" : item.status} key={i}><span className="activity-time">{item.time}</span><span className="activity-line"><span className="activity-dot"/></span><div><div className="activity-label">{item.title}</div><div className="activity-detail">{item.detail}</div></div></div>)}</div>
  </Card>;
}

export function ExpectedRealized({ monitor, compact = false }: { monitor: DeskSession["monitors"][number]; compact?: boolean }) {
  return <div className={`comparison-react ${compact ? "compact" : ""}`}>
    {monitor.expectedVsRealized.map((row, i) => <div className="comparison-react__row" key={i}>
      <div className="comparison-react__head"><strong>{row.element}</strong><StatusBadge tone={row.verdict === "invalidate" ? "critical" : row.verdict === "confirm" ? "positive" : "info"}>{row.verdict}</StatusBadge></div>
      <div className="comparison-react__cols"><div><span>Attendu</span><p>{row.expected}</p></div><div><span>Réalisé</span><p>{row.realized}</p></div></div>
      {!compact && <small>{row.impact}</small>}
    </div>)}
  </div>;
}

export function Conditions({ title, items }: { title: string; items: DeskSession["monitors"][number]["goConditions"] }) {
  return <Card className="conditions-react"><h3>{title}</h3><div>{items.length ? items.map((item, i) => <div className="condition-react" key={i}>
    <span className={`condition-react__icon ${item.status}`}><Icon name={item.status === "failed" || item.status === "triggered" ? "x" : item.status === "validated" || item.status === "previously_validated" ? "check" : "minus"} size={15}/></span>
    <div><div className="condition-react__head"><strong>{item.label}</strong><StatusBadge tone={item.status === "failed" || item.status === "triggered" ? "critical" : "positive"}>{item.status}</StatusBadge></div><p>{item.proof}</p><small>{item.impact} · {item.deterministic ? "déterministe" : "interprétation"}</small></div>
  </div>) : <p className="empty-copy">Aucune condition disponible.</p>}</div></Card>;
}

export function Timeline({ data, compact = false, onSelect }: { data: DeskSession; compact?: boolean; onSelect?: (event: DeskSession["timeline"][number]) => void }) {
  const items = compact ? data.timeline.slice(-4) : data.timeline;
  return <div className="timeline">{items.map((event, i) => <div className="timeline-item" data-type={event.type.toLowerCase()} data-status={severityTone(event.severity)} key={i}>
    <time className="timeline-item__time">{event.time}</time>
    <button className="timeline-item__content" onClick={() => onSelect?.(event)}>
      <div className="timeline-item__header"><strong>{event.title}</strong><StatusBadge tone={severityTone(event.severity)}>{event.status}</StatusBadge></div>
      <p>{event.summary}</p>{!compact && <small>{event.type} · {event.sourceType}</small>}
    </button>
  </div>)}</div>;
}

export function MacroNewsCard({ data }: { data: DeskSession }) {
  const navigate = useNavigate();
  const next = data.macro[0];
  return <Card className="brief-card" onClick={() => navigate("/news")}>
    <div className="brief-card__header"><div><p className="eyebrow">Macro & News</p><h3>{next ? `${next.time} · ${next.title}` : "Aucun event imminent"}</h3></div><span className="card-icon"><Icon name="news"/></span></div>
    {next && <p>{next.impactText}</p>}
    <div className="news-digest-preview"><span>Digest · {data.news.digestUpdatedAt}</span><p>{data.news.digest}</p></div>
    <div className="brief-card__verdict">{data.news.headlines.length} headlines disponibles</div>
  </Card>;
}

export function LiveSectionHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return <SectionTitle title={title} subtitle={subtitle} action={action}/>;
}
