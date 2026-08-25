import { useContext, useMemo, useState } from "react";
import { RealtimeContext } from "@/domains/realtime/RealtimeProvider";
import { useFrontView } from "@/domains/front-api/repositories";
import type { PerformanceDimension, PerformanceView } from "@/domains/front-api/viewModels";
import "@/features/performance/performance.css";

type AttributionGroup = PerformanceView["attribution"][number];
type AttributionItem = AttributionGroup["items"][number];

const TABS = [
  { key: "OVERVIEW", label: "Overview" },
  { key: "STRATEGY", label: "Par stratégie" },
  { key: "INSTRUMENT", label: "Par instrument" },
  { key: "ACCOUNT", label: "Par compte" },
  { key: "SESSION", label: "Par session" },
  { key: "REGIME", label: "Par régime" },
  { key: "ATTRIBUTION", label: "Attribution" },
  { key: "TRADES", label: "Trades" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const UNBACKED_TABS: ReadonlySet<TabKey> = new Set(["ACCOUNT", "REGIME"]);

export function PerformancePage() {
  const realtime = useContext(RealtimeContext);
  const query = useFrontView("performance-overview");
  const [tab, setTab] = useState<TabKey>("OVERVIEW");

  const data = query.data?.data ?? null;
  const byDimension = useMemo(() => {
    const map = new Map<PerformanceDimension, AttributionGroup>();
    (data?.attribution ?? []).forEach((group) => map.set(group.dimension, group));
    return map;
  }, [data]);

  if (query.isLoading) return <PerformanceLoading />;
  if (query.isError) return <div className="pa-page"><div className="pa-workspace"><p className="pa-empty">Performance indisponible : {(query.error as Error).message}</p></div></div>;
  if (!data) return <div className="pa-page"><div className="pa-workspace"><p className="pa-empty">Le BFF ne retourne pas encore la projection `/views/performance-overview`.</p></div></div>;

  return (
    <div className="pa-page" data-testid="performance-golden-master">
      <header className="pa-header">
        <div className="pa-header__title">
          <h1>Performance Analytics</h1>
          <p>Résultats officiels en R, risque &amp; attribution</p>
        </div>
        <div className="pa-header__clock">
          <strong>{formatClock(realtime?.now)}</strong>
          <small>{formatClockDate(realtime?.now)}</small>
        </div>
      </header>

      <nav className="pa-tabs" aria-label="Onglets Performance Analytics">
        {TABS.map((item) => (
          <button key={item.key} type="button" aria-selected={tab === item.key} onClick={() => setTab(item.key)}>
            {item.label}
          </button>
        ))}
      </nav>

      <div className="pa-workspace">
        {tab === "OVERVIEW" ? <OverviewTab data={data} strategyGroup={byDimension.get("STRATEGY")} /> : null}
        {tab === "STRATEGY" ? <DimensionTab group={byDimension.get("STRATEGY")} label="stratégie" /> : null}
        {tab === "INSTRUMENT" ? <DimensionTab group={byDimension.get("INSTRUMENT")} label="instrument" /> : null}
        {tab === "SESSION" ? <DimensionTab group={byDimension.get("SESSION")} label="session" /> : null}
        {UNBACKED_TABS.has(tab) ? <UnbackedTab label={TABS.find((item) => item.key === tab)?.label ?? tab} /> : null}
        {tab === "ATTRIBUTION" ? <AttributionTab data={data} /> : null}
        {tab === "TRADES" ? <TradesTab data={data} /> : null}
      </div>
    </div>
  );
}

function OverviewTab({ data, strategyGroup }: { data: PerformanceView; strategyGroup?: AttributionGroup }) {
  const s = data.summary;
  return (
    <>
      <section className="pa-kpi-strip" aria-label="Indicateurs Performance">
        <KpiCell label="Total R" value={formatSignedR(s.totalR)} tone={toneOf(s.totalR)} />
        <KpiCell label="Trades" value={String(s.trades)} detail={`${s.wins}G / ${s.losses}P / ${s.flats}N`} />
        <KpiCell label="Win rate" value={s.winRate == null ? "Non publié" : formatPct(s.winRate)} />
        <KpiCell label="Expectancy" value={s.expectancyR == null ? "Non publié" : formatSignedR(s.expectancyR)} tone={s.expectancyR == null ? undefined : toneOf(s.expectancyR)} />
        <KpiCell label="Profit factor" value={s.profitFactor == null ? "Non publié" : s.profitFactor.toFixed(2)} />
        <KpiCell label="Max drawdown" value={formatSignedR(s.maxDrawdownR)} tone="neg" />
        <KpiCell label="Drawdown actuel" value={formatSignedR(s.currentDrawdownR)} tone={s.currentDrawdownR < 0 ? "neg" : undefined} />
        <KpiCell label="Meilleur trade" value={s.bestTradeR == null ? "Non publié" : formatSignedR(s.bestTradeR)} tone="pos" />
        <KpiCell label="Pire trade" value={s.worstTradeR == null ? "Non publié" : formatSignedR(s.worstTradeR)} tone="neg" />
      </section>

      <div className="pa-row1">
        <section className="pa-panel" aria-label="Courbe d'equity">
          <header><h2>Courbe d'equity (R cumulé)</h2><small>{data.equityCurve.length} points</small></header>
          <div className="pa-panel__body">
            <EquityCurveChart points={data.equityCurve} />
          </div>
        </section>

        <section className="pa-panel" aria-label="Top stratégies">
          <header><h2>Top stratégies</h2></header>
          <div className="pa-panel__body" style={{ padding: 0 }}>
            <div className="pa-table-scroll">
              <table className="pa-table">
                <thead><tr><th>Stratégie</th><th>Total R</th><th>Trades</th><th>Win rate</th></tr></thead>
                <tbody>
                  {(strategyGroup?.items ?? []).slice(0, 8).map((item) => (
                    <tr key={item.label}>
                      <td><strong>{item.label}</strong></td>
                      <td className={item.totalR >= 0 ? "pa-num-pos" : "pa-num-neg"}>{formatSignedR(item.totalR)}</td>
                      <td>{item.trades}</td>
                      <td>{item.winRate == null ? "—" : formatPct(item.winRate)}</td>
                    </tr>
                  ))}
                  {!strategyGroup?.items.length ? <tr><td colSpan={4}><p className="pa-empty">Aucune stratégie publiée.</p></td></tr> : null}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      <div className="pa-row2">
        <section className="pa-panel" aria-label="PnL par jour">
          <header><h2>PnL par jour (R)</h2><small>{data.pnlByDay.length} jours</small></header>
          <div className="pa-panel__body">
            <PnlByDayChart points={data.pnlByDay} />
          </div>
        </section>

        <section className="pa-panel" aria-label="Derniers trades">
          <header><h2>Derniers trades</h2><small>{data.latestTrades.length}</small></header>
          <div className="pa-panel__body" style={{ padding: 0 }}>
            <div className="pa-table-scroll">
              <table className="pa-table">
                <thead><tr><th>Heure</th><th>Stratégie</th><th>Instrument</th><th>Résultat</th></tr></thead>
                <tbody>
                  {data.latestTrades.slice(0, 8).map((trade) => (
                    <tr key={trade.tradeId}>
                      <td>{formatTime(trade.at)}</td>
                      <td>{trade.strategyId ?? "—"}</td>
                      <td>{trade.instrument ?? "—"}</td>
                      <td className={(trade.resultR ?? 0) >= 0 ? "pa-num-pos" : "pa-num-neg"}>{trade.resultR == null ? "—" : formatSignedR(trade.resultR)}</td>
                    </tr>
                  ))}
                  {!data.latestTrades.length ? <tr><td colSpan={4}><p className="pa-empty">Aucun trade publié.</p></td></tr> : null}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function DimensionTab({ group, label }: { group?: AttributionGroup; label: string }) {
  return (
    <section className="pa-panel" aria-label={`Performance par ${label}`}>
      <header><h2>Performance par {label}</h2><small>{group?.items.length ?? 0}</small></header>
      <div className="pa-panel__body" style={{ padding: 0 }}>
        <div className="pa-table-scroll">
          <table className="pa-table">
            <thead><tr><th>{label}</th><th>Total R</th><th>Trades</th><th>Win rate</th><th>Expectancy</th><th>Contribution</th></tr></thead>
            <tbody>
              {(group?.items ?? []).map((item) => <AttributionRow key={item.label} item={item} />)}
              {!group?.items.length ? <tr><td colSpan={6}><p className="pa-empty">Aucune donnée publiée pour cette dimension.</p></td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function AttributionRow({ item }: { item: AttributionItem }) {
  return (
    <tr>
      <td><strong>{item.label}</strong></td>
      <td className={item.totalR >= 0 ? "pa-num-pos" : "pa-num-neg"}>{formatSignedR(item.totalR)}</td>
      <td>{item.trades}</td>
      <td>{item.winRate == null ? "—" : formatPct(item.winRate)}</td>
      <td>{item.expectancyR == null ? "—" : formatSignedR(item.expectancyR)}</td>
      <td style={{ minWidth: 90 }}>
        {formatPct(item.contributionPct)}
        <div className="pa-contribution-bar"><span style={{ width: `${Math.min(100, item.contributionPct * 100)}%`, background: item.tone === "positive" ? "var(--pa-green)" : item.tone === "negative" ? "var(--pa-red)" : "var(--pa-muted)" }} /></div>
      </td>
    </tr>
  );
}

function AttributionTab({ data }: { data: PerformanceView }) {
  return (
    <div className="pa-attribution-grid">
      {data.attribution.map((group) => (
        <div key={group.dimension} className="pa-attribution-card">
          <h3>{dimensionLabel(group.dimension)}</h3>
          {group.items.slice(0, 6).map((item) => (
            <div key={item.label} className="pa-attribution-row">
              <span>{item.label}</span>
              <span className={item.totalR >= 0 ? "pa-num-pos" : "pa-num-neg"}>{formatSignedR(item.totalR)}</span>
              <span>{formatPct(item.contributionPct)}</span>
            </div>
          ))}
          {!group.items.length ? <p className="pa-empty">Aucune donnée publiée.</p> : null}
        </div>
      ))}
      {!data.attribution.length ? <p className="pa-empty">Aucune attribution publiée.</p> : null}
    </div>
  );
}

function TradesTab({ data }: { data: PerformanceView }) {
  return (
    <section className="pa-panel" aria-label="Historique des trades">
      <header><h2>Trades</h2><small>{data.latestTrades.length}</small></header>
      <div className="pa-panel__body" style={{ padding: 0 }}>
        <div className="pa-table-scroll" style={{ maxHeight: "70vh" }}>
          <table className="pa-table">
            <thead><tr><th>Heure</th><th>Stratégie</th><th>Instrument</th><th>Session</th><th>Sens</th><th>Résultat</th></tr></thead>
            <tbody>
              {data.latestTrades.map((trade) => (
                <tr key={trade.tradeId}>
                  <td>{formatTime(trade.at)}</td>
                  <td>{trade.strategyId ?? "—"}</td>
                  <td>{trade.instrument ?? "—"}</td>
                  <td>{trade.session ?? "—"}</td>
                  <td>{trade.direction ?? "—"}</td>
                  <td className={(trade.resultR ?? 0) >= 0 ? "pa-num-pos" : "pa-num-neg"}>{trade.resultR == null ? "—" : formatSignedR(trade.resultR)}</td>
                </tr>
              ))}
              {!data.latestTrades.length ? <tr><td colSpan={6}><p className="pa-empty">Aucun trade publié.</p></td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function UnbackedTab({ label }: { label: string }) {
  return (
    <section className="pa-panel" aria-label={label}>
      <header><h2>{label}</h2></header>
      <div className="pa-panel__body">
        <p className="pa-empty">Non publié — cette dimension n'est pas encore calculée par le backend de performance.</p>
      </div>
    </section>
  );
}

function EquityCurveChart({ points }: { points: PerformanceView["equityCurve"] }) {
  if (!points.length) return <p className="pa-empty">Aucune courbe d'equity publiée.</p>;
  const width = 640;
  const height = 220;
  const padding = 8;
  const values = points.map((point) => point.cumulativeR);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const stepX = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;
  const y = (value: number) => height - padding - ((value - min) / span) * (height - padding * 2);
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${padding + index * stepX},${y(point.cumulativeR)}`).join(" ");
  const zeroY = y(0);
  return (
    <svg className="pa-chart-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <line x1={padding} y1={zeroY} x2={width - padding} y2={zeroY} stroke="var(--pa-border-strong)" strokeDasharray="4 4" />
      <path d={path} fill="none" stroke="var(--pa-blue)" strokeWidth="2" />
    </svg>
  );
}

function PnlByDayChart({ points }: { points: PerformanceView["pnlByDay"] }) {
  if (!points.length) return <p className="pa-empty">Aucun PnL journalier publié.</p>;
  const width = 640;
  const height = 180;
  const padding = 6;
  const max = Math.max(1, ...points.map((point) => Math.abs(point.totalR)));
  const barWidth = (width - padding * 2) / points.length;
  const zeroY = height / 2;
  return (
    <svg className="pa-chart-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <line x1={padding} y1={zeroY} x2={width - padding} y2={zeroY} stroke="var(--pa-border-strong)" />
      {points.map((point, index) => {
        const barHeight = (Math.abs(point.totalR) / max) * (height / 2 - padding);
        const x = padding + index * barWidth;
        const y = point.totalR >= 0 ? zeroY - barHeight : zeroY;
        return <rect key={point.date} x={x + 1} y={y} width={Math.max(1, barWidth - 2)} height={Math.max(1, barHeight)} fill={point.totalR >= 0 ? "var(--pa-green)" : "var(--pa-red)"} />;
      })}
    </svg>
  );
}

function KpiCell({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: "pos" | "neg" }) {
  return (
    <article className={`pa-kpi-card${tone ? ` pa-kpi-card--${tone}` : ""}`}>
      <small>{label}</small>
      <strong className={tone ? `pa-${tone}` : undefined}>{value}</strong>
      {detail ? <span>{detail}</span> : null}
    </article>
  );
}

function PerformanceLoading() {
  return (
    <div className="pa-page">
      <div className="pa-workspace">
        <section className="pa-kpi-strip">
          {Array.from({ length: 9 }).map((_, index) => <article key={index} className="pa-kpi-card"><div className="skeleton-line" /></article>)}
        </section>
      </div>
    </div>
  );
}

function toneOf(value: number): "pos" | "neg" | undefined {
  if (value > 0) return "pos";
  if (value < 0) return "neg";
  return undefined;
}

function dimensionLabel(dimension: PerformanceDimension) {
  if (dimension === "STRATEGY") return "Par stratégie";
  if (dimension === "SESSION") return "Par session";
  if (dimension === "INSTRUMENT") return "Par instrument";
  if (dimension === "DIRECTION") return "Par sens";
  return "Autre";
}

function formatSignedR(value: number) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2).replace(".", ",")} R`;
}

function formatPct(value: number) {
  return `${(value * 100).toFixed(1).replace(".", ",")}%`;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatClock(value: Date | undefined) {
  if (!value) return "—:—:—";
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(value);
}

function formatClockDate(value: Date | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(value);
}
