import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { operationsApi } from "@/api/operationsApi";
import { Card, DataSourceBadge, ErrorView, Icon, LoadingView } from "@/components/common";
import { MetricCard, MetricStrip, PageHeading, PageTabs, ProgressBar, StatusTag } from "@/components/operations";
import { operationsKeys } from "@/hooks/useOperations";
import { replayLabel } from "@/lib/presentation";
import type { PerformanceAttributionItem, PerformanceBreakdownItem, PerformanceDailyPoint, PerformanceDayDrilldown, PerformanceEquityPoint, PerformanceOverview, PerformanceTradeItem } from "@/operationsTypes";

export default function PerformanceAnalysisPage() {
  const [params, setParams] = useSearchParams();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const rawFilters = useMemo(() => ({
    strategyId: params.get("strategy") || "",
    session: params.get("session") || "",
    instrument: params.get("instrument") || "",
    direction: params.get("direction") || "",
    from: params.get("from") || "",
    to: params.get("to") || "",
  }), [params]);
  const filters = useDeferredValue(rawFilters);
  const apiFilters = useMemo(() => ({
    strategy_id: filters.strategyId || null,
    session: filters.session || null,
    instrument: filters.instrument || null,
    direction: filters.direction || null,
    from: filters.from || null,
    to: filters.to || null,
  }), [filters]);
  const query = useQuery({ queryKey: [...operationsKeys.performance, apiFilters], queryFn: () => operationsApi.getPerformance(apiFilters) });
  const setFilter = (key: string, value: string) => setParams(current => {
    const next = new URLSearchParams(current);
    value ? next.set(key, value) : next.delete(key);
    return next;
  }, { replace: true });
  const clearFilters = () => setParams({}, { replace: true });

  if (query.isLoading) return <LoadingView title="Chargement de l’analyse performance" message="Lecture des trades, bilans journaliers, equity et attributions réellement persistés." source="performance/trades PostgreSQL"/>;
  if (query.isError || !query.data) return <ErrorView message={query.error?.message || "Analyse indisponible"} retry={() => query.refetch()}/>;

  const data = query.data;
  const totals = data.totals;
  const hasFilters = Object.values(rawFilters).some(Boolean);
  const isEmpty = !data.equity.length && !data.dailySeries.length && !data.breakdowns.some(item => item.items.length);
  const dayDrilldowns = data.dayDrilldowns || [];
  const activeDay = dayDrilldowns.find(day => day.date === selectedDate) || dayDrilldowns.at(-1) || null;
  const attribution = data.attribution || [];

  return <section className="view workspace-view performance-intelligence-v3">
    <PageHeading eyebrow="Performance intelligence" title="Analyse de performance" subtitle="Equity, drawdown, régularité et attribution sur les trades réellement persistés." actions={<><DataSourceBadge label="POSTGRES"/><button className="secondary-btn" onClick={() => query.refetch()}>Actualiser</button><Link className="primary-btn" to="/replay/compare">Comparer les runs</Link></>} tabs={<PageTabs items={[{ label: "Analyse", to: "/performance/analysis", end: true }, { label: "Calendrier R", to: "/performance" }]}/>}/>

    <MetricStrip className="metric-grid--compact performance-kpi-strip">
      <MetricCard label="Résultat net" value={formatR(totals.totalR)} detail={`${totals.activeDays} jours actifs`} tone={tone(totals.totalR)}/>
      <MetricCard label="Trades" value={totals.trades} detail={`${totals.wins} W · ${totals.losses} L · ${totals.flats} flat`}/>
      <MetricCard label="Win rate" value={formatPercent(totals.winRate)} detail={`${totals.winningDays} jours gagnants`}/>
      <MetricCard label="Expectancy" value={formatNullableR(totals.expectancyR)} tone={tone(totals.expectancyR)}/>
      <MetricCard label="Max drawdown" value={formatR(totals.maxDrawdownR)} detail={`Actuel ${formatR(totals.currentDrawdownR)}`} tone={totals.maxDrawdownR < 0 ? "critical" : "neutral"}/>
      <MetricCard label="Profit factor" value={totals.profitFactor === null ? "∞" : totals.profitFactor.toFixed(2)} detail={`${formatR(totals.grossProfitR)} / ${formatR(-totals.grossLossR)}`}/>
    </MetricStrip>

    <Card className="performance-filter-bar" aria-label="Filtres de performance">
      <FilterSelect label="Stratégie" value={rawFilters.strategyId} values={data.facets.strategies} onChange={value => setFilter("strategy", value)}/>
      <FilterSelect label="Session" value={rawFilters.session} values={data.facets.sessions} onChange={value => setFilter("session", value)} format={shortLabel}/>
      <FilterSelect label="Instrument" value={rawFilters.instrument} values={data.facets.instruments} onChange={value => setFilter("instrument", value)}/>
      <FilterSelect label="Direction" value={rawFilters.direction} values={data.facets.directions} onChange={value => setFilter("direction", value)} format={shortLabel}/>
      <label><span>Du</span><input aria-label="Performance depuis" type="date" value={rawFilters.from} min={data.facets.dateRange.from || undefined} max={data.facets.dateRange.to || undefined} onChange={event => setFilter("from", event.target.value)}/></label>
      <label><span>Au</span><input aria-label="Performance jusqu’au" type="date" value={rawFilters.to} min={data.facets.dateRange.from || undefined} max={data.facets.dateRange.to || undefined} onChange={event => setFilter("to", event.target.value)}/></label>
      <div className="performance-filter-bar__result"><strong>{totals.trades}</strong><span>trades</span>{hasFilters && <button className="text-btn" onClick={clearFilters}>Réinitialiser</button>}</div>
    </Card>

    {isEmpty ? <Card className="workspace-empty performance-empty-state"><span className="terminal-code">{hasFilters ? "NO_MATCHING_PERFORMANCE" : "NO_PERFORMANCE_MATERIALIZED"}</span><h3>{hasFilters ? "Aucun résultat pour ces filtres" : "Pas encore de résultat matérialisé"}</h3><p>Cette vue lit les trades, bilans journaliers et courbes d’equity persistés. Aucune performance n’est simulée côté frontend.</p>{hasFilters && <button className="secondary-btn" onClick={clearFilters}>Effacer les filtres</button>}</Card> : <>
      <PerformanceCommandCenter days={dayDrilldowns} activeDay={activeDay} onSelectDay={setSelectedDate} attribution={attribution}/>
      <PerformanceInsightGrid data={data} activeDay={activeDay} onSelectDay={setSelectedDate}/>
      <div className="performance-workbench-v3">
        <PerformanceEquityChart points={data.equity}/>
        <PerformanceRiskRail data={data}/>
      </div>
      <DailyPerformanceTable days={data.dailySeries} equity={data.equity} runs={data.relatedRuns}/>
      <PerformanceBreakdowns groups={data.breakdowns}/>
      <RelatedRunsTable runs={data.relatedRuns}/>
    </>}
  </section>;
}

function PerformanceCommandCenter({
  days,
  activeDay,
  onSelectDay,
  attribution
}: {
  days: PerformanceDayDrilldown[];
  activeDay: PerformanceDayDrilldown | null;
  onSelectDay: (date: string) => void;
  attribution: PerformanceOverview["attribution"];
}) {
  return <div className="performance-command-center">
    <Card className="performance-day-focus-panel">
      <header><div><p className="eyebrow">{activeDay?.date || "Aucune journée"}</p><h2>Focus journée performance</h2></div><span className={tone(activeDay?.totalR)}>{activeDay ? formatR(activeDay.totalR) : "—"}</span></header>
      {!activeDay ? <div className="terminal-empty-state"><span>NO_DAY_FOCUS</span><small>Aucune journée disponible pour les filtres actifs.</small></div> : <>
        <div className="performance-day-picker" aria-label="Sélectionner une journée de performance">
          {days.map(day => <button type="button" key={day.date} className={activeDay.date === day.date ? "is-selected" : ""} data-tone={day.totalR >= 0 ? "positive" : "negative"} aria-label={`${day.date} · ${formatR(day.totalR)} · ${day.trades} trades`} title={`${day.trades} trades`} onClick={() => onSelectDay(day.date)}>
            <span>{day.date.slice(5)}</span><strong>{formatR(day.totalR)}</strong>
          </button>)}
        </div>
        <dl className="performance-day-focus-grid">
          <span><dt>Trades</dt><dd>{activeDay.trades}</dd></span>
          <span><dt>Win rate</dt><dd>{formatPercent(activeDay.winRate)}</dd></span>
          <span><dt>Equity</dt><dd>{activeDay.cumulativeR == null ? "—" : formatR(activeDay.cumulativeR)}</dd></span>
          <span><dt>Drawdown</dt><dd className={tone(activeDay.drawdownR)}>{activeDay.drawdownR == null ? "—" : formatR(activeDay.drawdownR)}</dd></span>
          <span><dt>Best</dt><dd>{activeDay.bestTrade?.resultR == null ? "—" : formatR(activeDay.bestTrade.resultR)}</dd></span>
          <span><dt>Worst</dt><dd>{activeDay.worstTrade?.resultR == null ? "—" : formatR(activeDay.worstTrade.resultR)}</dd></span>
        </dl>
        <PerformanceDayTradeTape trades={activeDay.tradeItems}/>
        <div className="performance-day-run-links">
          <header><span>Runs liés</span><strong>{activeDay.relatedRuns.length}</strong></header>
          {!activeDay.relatedRuns.length ? <small>Aucun replay lié à cette journée.</small> : activeDay.relatedRuns.map(run => <Link key={run.sourceId} to={`/replay/runs/${encodeURIComponent(run.sourceId)}/days/${activeDay.date}`}>
            <strong>{replayLabel(run.sourceId)}</strong><span>{shortLabel(run.session || "global")}</span><StatusTag status={run.status}/>
          </Link>)}
        </div>
      </>}
    </Card>
    <PerformanceAttributionPanel attribution={attribution}/>
  </div>;
}

function PerformanceDayTradeTape({ trades }: { trades: PerformanceTradeItem[] }) {
  if (!trades.length) return <div className="terminal-empty-state"><span>NO_TRADE_ITEM</span><small>Aucun trade détaillé pour cette journée.</small></div>;
  return <div className="performance-trade-tape" aria-label="Trades de la journée sélectionnée">{trades.map(trade => <Link key={trade.id} to={trade.runId ? `/replay/runs/${encodeURIComponent(trade.runId)}` : "/history"}>
    <time>{trade.at ? new Date(trade.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—"}</time>
    <strong className={tone(trade.resultR)}>{trade.resultR == null ? "—" : formatR(trade.resultR)}</strong>
    <span>{trade.instrument || "—"} · {shortLabel(trade.session || "global")}</span>
    <small>{trade.direction || "—"} · {trade.strategyId || "—"}</small>
  </Link>)}</div>;
}

function PerformanceAttributionPanel({ attribution }: { attribution: PerformanceOverview["attribution"] }) {
  return <section className="performance-attribution-panel">
    <header><div><p className="eyebrow">Attribution par facteur</p><h2>Contribution session, stratégie, instrument</h2></div><span>{attribution.reduce((total, group) => total + group.items.length, 0)} segments</span></header>
    {!attribution.length ? <Card className="workspace-empty"><span className="terminal-code">NO_ATTRIBUTION</span><p>Aucune attribution calculable sur ce filtre.</p></Card> : <div className="performance-attribution-grid">{attribution.map(group => <div key={group.dimension}>
      <header><strong>{dimensionLabel(group.dimension)}</strong><small>best {group.best ? formatR(group.best.totalR) : "—"}</small></header>
      {group.items.slice(0, 6).map(item => <AttributionRow key={`${group.dimension}:${item.label}`} dimension={group.dimension} item={item}/>)}
    </div>)}</div>}
  </section>;
}

function AttributionRow({ dimension, item }: { dimension: string; item: PerformanceAttributionItem }) {
  const content = <><span>{dimension === "strategy" && item.label !== "unknown" ? item.label : shortLabel(item.label)}</span><strong className={tone(item.totalR)}>{formatR(item.totalR)}</strong><small>{item.trades} T · {formatPercent(item.winRate ?? null)} · {Math.round((item.contributionPct || 0) * 100)}%</small><i style={{ width: `${Math.max(4, Math.min(100, (item.contributionPct || 0) * 100))}%` }} data-tone={item.totalR >= 0 ? "positive" : "negative"}/></>;
  if (dimension === "strategy" && item.label !== "unknown") return <Link className="performance-attribution-row" to={`/strategies/${encodeURIComponent(item.label)}`}>{content}</Link>;
  if (item.runIds.length === 1) return <Link className="performance-attribution-row" to={`/replay/runs/${encodeURIComponent(item.runIds[0])}`}>{content}</Link>;
  return <div className="performance-attribution-row">{content}</div>;
}

function FilterSelect({ label, value, values, onChange, format = value => value }: { label: string; value: string; values: string[]; onChange: (value: string) => void; format?: (value: string) => string }) {
  const [open, setOpen] = useState(false);
  const buttonId = useId();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const choices = useMemo(() => {
    const current = value && !values.includes(value) ? [value] : [];
    return Array.from(new Set(["", ...current, ...values]));
  }, [value, values]);
  const selectedLabel = value ? format(value) : "Tous";

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const selectValue = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
  };

  return <div className={`performance-select ${open ? "is-open" : ""}`} ref={rootRef}>
    <span className="performance-select__label">{label}</span>
    <button
      id={buttonId}
      type="button"
      className="performance-select__button"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={menuId}
      onClick={() => setOpen(current => !current)}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setOpen(true);
        }
      }}
    >
      <span>{selectedLabel}</span><Icon name="arrow" size={12}/>
    </button>
    {open && <div id={menuId} className="performance-select__menu" role="listbox" aria-labelledby={buttonId} tabIndex={-1}>
      {choices.map((item) => {
        const selected = item === value;
        return <button
          key={item || "__all__"}
          type="button"
          role="option"
          aria-selected={selected}
          className={selected ? "is-selected" : ""}
          onClick={() => selectValue(item)}
        >
          <span>{item ? format(item) : "Tous"}</span>
          {selected && <Icon name="check" size={13}/>}
        </button>;
      })}
      {choices.length <= 1 && <small>Aucun autre choix disponible</small>}
    </div>}
  </div>;
}

function PerformanceInsightGrid({ data, activeDay, onSelectDay }: { data: PerformanceOverview; activeDay: PerformanceDayDrilldown | null; onSelectDay: (date: string) => void }) {
  return <div className="performance-insight-grid">
    <Card className="performance-heatmap-card">
      <header><div><p className="eyebrow">Heatmap R</p><h2>Régularité par journée</h2></div><span>{data.dailySeries.length} jours</span></header>
      {!data.dailySeries.length ? <p className="muted-copy">Aucune journée matérialisée.</p> : <div className="performance-heatmap" aria-label="Heatmap des performances journalières">
        {[...data.dailySeries].sort((left, right) => left.date.localeCompare(right.date)).map(day => <button key={day.date} type="button" data-tone={day.totalR > 0 ? "positive" : day.totalR < 0 ? "negative" : "neutral"} className={activeDay?.date === day.date ? "is-selected" : ""} onClick={() => onSelectDay(day.date)} title={`${day.date} · ${formatR(day.totalR)} · ${day.trades} trades`}>
          <span>{day.date.slice(5)}</span><strong>{formatR(day.totalR)}</strong>
        </button>)}
      </div>}
    </Card>

    <Card className="trade-lifecycle-card">
      <header><div><p className="eyebrow">Trade lifecycle</p><h2>Cycle de vie journée</h2></div><span>{activeDay?.date || "—"}</span></header>
      {!activeDay ? <p className="muted-copy">Sélectionnez une journée pour voir le cycle.</p> : <>
        <div className="trade-lifecycle-steps">
          <span><strong>{activeDay.tradeItems.length}</strong><small>trades</small></span>
          <span><strong>{activeDay.tradeItems.filter(trade => String(trade.direction || "").toLowerCase().includes("long")).length}</strong><small>long</small></span>
          <span><strong>{activeDay.tradeItems.filter(trade => String(trade.direction || "").toLowerCase().includes("short")).length}</strong><small>short</small></span>
          <span><strong>{activeDay.wins}</strong><small>wins</small></span>
          <span><strong>{activeDay.losses}</strong><small>losses</small></span>
        </div>
        <div className="trade-lifecycle-tape">
          {activeDay.tradeItems.slice(-5).map(trade => <Link key={trade.id} to={trade.runId ? `/replay/runs/${encodeURIComponent(trade.runId)}` : "/history"}>
            <span>{trade.at ? new Date(trade.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
            <strong className={tone(trade.resultR)}>{trade.resultR == null ? "—" : formatR(trade.resultR)}</strong>
            <small>{trade.instrument || "—"} · {trade.direction || "—"} · {trade.status || "statut absent"}</small>
          </Link>)}
          {!activeDay.tradeItems.length && <p className="muted-copy">Aucun trade détaillé sur cette journée.</p>}
        </div>
      </>}
    </Card>

    <Card className="performance-source-card">
      <header><div><p className="eyebrow">Contrat & source</p><h2>Données affichées</h2></div><DataSourceBadge label="CANONICAL"/></header>
      <dl className="performance-risk-list">
        <dt>Contrat</dt><dd>{data.contract}</dd>
        <dt>Généré</dt><dd>{new Date(data.generatedAt).toLocaleString("fr-FR")}</dd>
        <dt>Période</dt><dd>{data.facets.dateRange.from || "—"} → {data.facets.dateRange.to || "—"}</dd>
        <dt>Runs liés</dt><dd>{data.relatedRuns.length}</dd>
        <dt>Filtres actifs</dt><dd>{Object.values(data.filters).filter(Boolean).length}</dd>
      </dl>
    </Card>
  </div>;
}

function PerformanceEquityChart({ points }: { points: PerformanceEquityPoint[] }) {
  const model = useMemo(() => equityChartModel(points), [points]);
  return <Card className="performance-equity-panel">
    <header><div><p className="eyebrow">Courbe cumulée</p><h2>Equity & drawdown</h2></div><div className="performance-chart-legend"><span><i data-series="equity"/>Equity R</span><span><i data-series="drawdown"/>Drawdown</span></div></header>
    {!points.length ? <div className="performance-chart-empty"><Icon name="chart"/><strong>Aucun point d’equity</strong><p>La série apparaîtra après matérialisation d’un trade ou d’un bilan journalier.</p></div> : <svg viewBox="0 0 1000 340" preserveAspectRatio="none" role="img" aria-label="Courbe d’equity et drawdown">
      {[0, 1, 2, 3, 4].map(index => <g key={index}><line className="performance-grid-line" x1="70" x2="980" y1={28 + index * 48} y2={28 + index * 48}/><text x="8" y={33 + index * 48}>{(model.max - model.spread * index / 4).toFixed(2)} R</text></g>)}
      <line className="performance-zero-line" x1="70" x2="980" y1={model.zeroY} y2={model.zeroY}/>
      <path className="performance-equity-area" d={model.area}/><path className="performance-equity-line" d={model.line}/>
      {model.points.map(point => <g key={`${point.source.sequence}:${point.x}`}><circle className="performance-equity-point" cx={point.x} cy={point.y} r="4"><title>{`${point.source.date || "—"} · ${formatR(point.source.cumulativeR)}`}</title></circle></g>)}
      <line className="performance-drawdown-baseline" x1="70" x2="980" y1="250" y2="250"/>
      <path className="performance-drawdown-area" d={model.drawdownArea}/><path className="performance-drawdown-line" d={model.drawdownLine}/>
      <text x="8" y="255">DD 0</text><text x="8" y="320">{model.minDrawdown.toFixed(2)} R</text>
      <text x="70" y="337">{points[0]?.date || "—"}</text><text x="900" y="337">{points.at(-1)?.date || "—"}</text>
    </svg>}
    <footer><span>Source · trades/equity PostgreSQL</span><strong>{points.length} points matérialisés</strong></footer>
  </Card>;
}

function PerformanceRiskRail({ data }: { data: PerformanceOverview }) {
  const totals = data.totals;
  return <aside className="performance-risk-rail">
    <Card><header><p className="eyebrow">Risk tape</p><span className="terminal-counter">{totals.trades}</span></header><dl className="performance-risk-list"><dt>Gain brut</dt><dd className="positive">{formatR(totals.grossProfitR)}</dd><dt>Perte brute</dt><dd className="negative">{formatR(-totals.grossLossR)}</dd><dt>Meilleur trade</dt><dd>{formatNullableR(totals.bestTradeR)}</dd><dt>Pire trade</dt><dd>{formatNullableR(totals.worstTradeR)}</dd><dt>Meilleure journée</dt><dd>{formatNullableR(totals.bestDayR)}</dd><dt>Pire journée</dt><dd>{formatNullableR(totals.worstDayR)}</dd></dl></Card>
    <Card><header><p className="eyebrow">Research scope</p><span>CANONICAL</span></header><dl className="performance-risk-list"><dt>Période source</dt><dd>{data.facets.dateRange.from || "—"}</dd><dt>Dernier jour</dt><dd>{data.facets.dateRange.to || "—"}</dd><dt>Stratégies</dt><dd>{data.facets.strategies.length}</dd><dt>Sessions</dt><dd>{data.facets.sessions.length}</dd><dt>Runs liés</dt><dd>{data.relatedRuns.length}</dd><dt>Mise à jour</dt><dd>{new Date(data.generatedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</dd></dl></Card>
  </aside>;
}

function DailyPerformanceTable({ days, equity, runs }: { days: PerformanceDailyPoint[]; equity: PerformanceEquityPoint[]; runs: PerformanceOverview["relatedRuns"] }) {
  const equityByDay = new Map<string, PerformanceEquityPoint>();
  equity.forEach(point => point.date && equityByDay.set(point.date, point));
  return <section className="replay-terminal-section performance-daily-section"><header><div><p className="eyebrow">Distribution temporelle</p><h2>Journées matérialisées</h2></div><span>{days.length} séances agrégées</span></header>
    <div className="data-table-wrap"><table className="data-table performance-daily-table"><thead><tr><th>Date</th><th>Résultat</th><th>Trades</th><th>Win rate</th><th>Equity clôture</th><th>Drawdown</th><th>Stratégies</th><th>Sessions</th><th/></tr></thead><tbody>{[...days].reverse().map(day => {
      const point = equityByDay.get(day.date);
      const run = (day.runIds.length ? runs.find(item => day.runIds.includes(item.sourceId)) : undefined) || runs.find(item => item.tradingDate === day.date);
      return <tr key={day.date}><td data-label="Date"><strong>{day.date}</strong><small>{day.source}</small></td><td data-label="Résultat" className={tone(day.totalR)}><strong>{formatR(day.totalR)}</strong><ResultBar value={day.totalR} max={Math.max(1, ...days.map(item => Math.abs(item.totalR)))}/></td><td data-label="Trades">{day.trades}<small>{day.wins} W · {day.losses} L</small></td><td data-label="Win rate">{formatPercent(day.winRate)}</td><td data-label="Equity">{point ? formatR(point.cumulativeR) : "—"}</td><td data-label="Drawdown" className={tone(point?.drawdownR)}>{point ? formatR(point.drawdownR) : "—"}</td><td data-label="Stratégies">{day.strategyIds.join(", ") || "—"}</td><td data-label="Sessions">{day.sessions.map(shortLabel).join(", ") || "—"}</td><td data-label="Action">{run ? <Link className="row-link" to={`/replay/runs/${encodeURIComponent(run.sourceId)}/days/${day.date}`}>Replay <Icon name="arrow" size={13}/></Link> : <span className="muted-copy">—</span>}</td></tr>;
    })}</tbody></table></div>
  </section>;
}

function PerformanceBreakdowns({ groups }: { groups: PerformanceOverview["breakdowns"] }) {
  const visible = groups.filter(group => group.dimension !== "day" && group.items.length);
  if (!visible.length) return null;
  return <section className="performance-breakdown-terminal"><header><div><p className="eyebrow">Attribution</p><h2>Ventilations comparées</h2></div><span>{visible.length} dimensions</span></header><div className="performance-breakdown-matrix">{visible.map(group => <div key={group.dimension}><header><strong>{dimensionLabel(group.dimension)}</strong><span>{group.items.length}</span></header>{group.items.slice(0, 12).map(item => <BreakdownRow key={item.label} dimension={group.dimension} item={item}/>)}</div>)}</div></section>;
}

function BreakdownRow({ dimension, item }: { dimension: string; item: PerformanceBreakdownItem }) {
  const label = dimension === "strategy" && item.label !== "unknown" ? <Link to={`/strategies/${encodeURIComponent(item.label)}`}>{item.label}</Link> : shortLabel(item.label);
  return <div className="performance-breakdown-row"><span>{label}</span><strong className={tone(item.totalR)}>{formatR(item.totalR)}</strong><small>{item.trades} T · {formatPercent(item.winRate ?? null)}</small></div>;
}

function RelatedRunsTable({ runs }: { runs: PerformanceOverview["relatedRuns"] }) {
  if (!runs.length) return null;
  return <section className="replay-terminal-section performance-related-runs"><header><div><p className="eyebrow">Traçabilité</p><h2>Replays sur la période</h2></div><span>{runs.length} exécutions liées par date/stratégie/session</span></header><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Replay</th><th>Date / session</th><th>Stratégie</th><th>État</th><th>Progression</th><th>Résultat</th><th/></tr></thead><tbody>{runs.map(run => <tr key={run.id}><td data-label="Replay"><strong>{replayLabel(run.sourceId)}</strong><small>{run.variantId || run.kind}</small></td><td data-label="Date"><strong>{run.tradingDate || "—"}</strong><small>{shortLabel(run.session || "global")}</small></td><td data-label="Stratégie">{run.strategyId ? <Link className="row-link" to={`/strategies/${encodeURIComponent(run.strategyId)}`}>{run.strategyId}</Link> : "—"}</td><td data-label="État"><StatusTag status={run.status}/></td><td data-label="Progression"><ProgressBar value={run.progress} status={run.status}/></td><td data-label="Résultat" className={tone(Number(run.metrics.totalR || 0))}>{formatR(Number(run.metrics.totalR || 0))}</td><td data-label="Action"><Link className="row-link" to={`/replay/runs/${encodeURIComponent(run.sourceId)}`}>Inspecter <Icon name="arrow" size={13}/></Link></td></tr>)}</tbody></table></div></section>;
}

function ResultBar({ value, max }: { value: number; max: number }) {
  return <span className="performance-result-bar" aria-hidden="true"><i data-tone={value >= 0 ? "positive" : "negative"} style={{ width: `${Math.max(3, Math.abs(value) / max * 100)}%` }}/></span>;
}

function equityChartModel(points: PerformanceEquityPoint[]) {
  const values = points.map(point => Number(point.cumulativeR || 0));
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const spread = Math.max(1, max - min);
  const x = (index: number) => 70 + index / Math.max(1, points.length - 1) * 910;
  const y = (value: number) => 220 - (value - min) / spread * 192;
  const coords = points.map((point, index) => ({ source: point, x: x(index), y: y(point.cumulativeR) }));
  const line = coords.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const area = line ? `${line} L ${coords.at(-1)?.x || 70} 220 L 70 220 Z` : "";
  const minDrawdown = Math.min(-0.01, ...points.map(point => Number(point.drawdownR || 0)));
  const ddY = (value: number) => 250 + Math.abs(value / minDrawdown) * 68;
  const ddCoords = points.map((point, index) => ({ x: x(index), y: ddY(point.drawdownR) }));
  const drawdownLine = ddCoords.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const drawdownArea = drawdownLine ? `${drawdownLine} L ${ddCoords.at(-1)?.x || 70} 250 L 70 250 Z` : "";
  return { min, max, spread, points: coords, line, area, zeroY: y(0), minDrawdown, drawdownLine, drawdownArea };
}

function formatR(value: number) { return `${value > 0 ? "+" : ""}${Number(value || 0).toFixed(2)} R`; }
function formatNullableR(value: number | null | undefined) { return value === null || value === undefined ? "—" : formatR(value); }
function formatPercent(value: number | null | undefined) { return value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`; }
function tone(value: number | null | undefined) { return Number(value || 0) > 0 ? "positive" : Number(value || 0) < 0 ? "negative" : "neutral"; }
function shortLabel(value: string) { return value.replaceAll("_", " ").toUpperCase(); }
function dimensionLabel(value: string) { return ({ strategy: "Stratégies", session: "Sessions", instrument: "Instruments", direction: "Directions" } as Record<string, string>)[value] || value.toUpperCase(); }
