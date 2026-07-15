import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { deskApi } from "@/api/deskApi";
import { refreshPolicyMs } from "@/api/endpoints";
import { Card, Drawer, Icon, SectionTitle } from "@/components/common";
import { useDeskContext } from "@/context/DeskContext";
import type { PerformanceCalendarDay, PerformancePricingMode, PerformanceSummary } from "@/types";

const weekDays = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const pricingLabels: Record<PerformancePricingMode, string> = {
  conservative: "Conservateur",
  middle: "Médian",
  optimistic: "Optimiste"
};

function parisToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function formatR(value: number | null | undefined) {
  const amount = Number(value || 0);
  return `${amount > 0 ? "+" : amount < 0 ? "−" : ""}${Math.abs(amount).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} R`;
}

function rTone(value: number | null | undefined) {
  return Number(value || 0) > 0 ? "positive" : Number(value || 0) < 0 ? "negative" : "flat";
}

function formatPercent(value: number | null | undefined) {
  return value == null ? "—" : `${(value * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

function valueOf(record: Record<string, unknown> | null | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return "—";
}

function DaySummary({ summary }: { summary?: PerformanceSummary }) {
  return <div className="performance-summary-grid">
    <Card className={`performance-kpi performance-kpi--${rTone(summary?.total_R)}`}><span>Résultat</span><strong>{formatR(summary?.total_R)}</strong><small>sur le mois</small></Card>
    <Card className="performance-kpi"><span>Trades clôturés</span><strong>{summary?.closed_trades ?? 0}</strong><small>{summary?.wins ?? 0} gagnants · {summary?.losses ?? 0} perdants</small></Card>
    <Card className="performance-kpi"><span>Taux de réussite</span><strong>{formatPercent(summary?.win_rate)}</strong><small>expectancy {formatR(summary?.expectancy_R)}</small></Card>
    <Card className="performance-kpi"><span>Drawdown max</span><strong>{formatR(summary?.max_drawdown_R)}</strong><small>sur la période</small></Card>
  </div>;
}

export default function PerformanceCalendarPage() {
  const { sessionId } = useDeskContext();
  const today = parisToday();
  const [cursor, setCursor] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }));
  const [pricingMode, setPricingMode] = useState<PerformancePricingMode>("conservative");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const calendarQuery = useQuery({
    queryKey: ["performance-calendar", sessionId, cursor.year, cursor.month, pricingMode],
    queryFn: () => deskApi.getPerformanceCalendar(sessionId, cursor.year, cursor.month, pricingMode),
    staleTime: refreshPolicyMs.performance,
    refetchInterval: refreshPolicyMs.performance
  });
  const dayQuery = useQuery({
    queryKey: ["performance-day", sessionId, selectedDate, pricingMode],
    queryFn: () => deskApi.getPerformanceDay(sessionId, selectedDate!, pricingMode),
    enabled: Boolean(selectedDate),
    staleTime: 15_000,
    refetchInterval: selectedDate ? refreshPolicyMs.performance : false
  });

  const monthLabel = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(cursor.year, cursor.month - 1, 1)));
  const leading = (new Date(Date.UTC(cursor.year, cursor.month - 1, 1)).getUTCDay() + 6) % 7;
  const cells = useMemo(() => [...Array.from({ length: leading }, () => null), ...(calendarQuery.data?.calendar.days || [])], [calendarQuery.data, leading]);
  const selectedDay = calendarQuery.data?.calendar.days.find(day => day.date === selectedDate);

  const moveMonth = (delta: number) => {
    const next = new Date(Date.UTC(cursor.year, cursor.month - 1 + delta, 1));
    setCursor({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 });
    setSelectedDate(null);
  };

  return <section className="view performance-view">
    <SectionTitle title="Calendrier des performances" subtitle="Résultat net quotidien en R · cliquez sur une date pour ouvrir la journée"/>

    <div className="performance-toolbar">
      <div className="performance-month-nav">
        <button className="icon-btn performance-prev" onClick={() => moveMonth(-1)} aria-label="Mois précédent"><Icon name="arrow"/></button>
        <strong>{monthLabel}</strong>
        <button className="icon-btn" onClick={() => moveMonth(1)} aria-label="Mois suivant"><Icon name="arrow"/></button>
      </div>
      <div className="performance-pricing" aria-label="Mode de calcul">
        {(Object.keys(pricingLabels) as PerformancePricingMode[]).map(mode => <button key={mode} className={pricingMode === mode ? "active" : ""} onClick={() => setPricingMode(mode)}>{pricingLabels[mode]}</button>)}
      </div>
    </div>

    {calendarQuery.isLoading ? <Card className="performance-loading">Chargement du calendrier…</Card> : calendarQuery.isError ? <Card className="performance-error"><Icon name="alert"/><div><strong>Calendrier indisponible</strong><p>{calendarQuery.error.message}</p></div><button className="text-btn" onClick={() => calendarQuery.refetch()}>Réessayer</button></Card> : <>
      <DaySummary summary={calendarQuery.data?.calendar.summary}/>
      <Card className="performance-calendar-card">
        <div className="performance-weekdays">{weekDays.map(day => <span key={day}>{day}</span>)}</div>
        <div className="performance-calendar-grid">
          {cells.map((day, index) => day ? <CalendarDay key={day.date} day={day} today={today} onClick={() => setSelectedDate(day.date)}/> : <span className="performance-day-placeholder" key={`empty-${index}`}/>) }
        </div>
        <footer className="performance-legend"><span><i className="positive"/>Gain</span><span><i className="negative"/>Perte</span><span><i className="flat"/>Flat / sans trade</span></footer>
      </Card>
    </>}

    <Drawer open={Boolean(selectedDate)} title={selectedDate ? new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${selectedDate}T12:00:00Z`)) : "Journée"} onClose={() => setSelectedDate(null)}>
      {dayQuery.isLoading ? <div className="performance-day-loading">Chargement de la journée…</div> : dayQuery.isError ? <div className="performance-day-loading">Impossible de charger le détail.<button className="text-btn" onClick={() => dayQuery.refetch()}>Réessayer</button></div> : dayQuery.data ? <DayZoom day={dayQuery.data.day} calendarDay={selectedDay}/> : null}
    </Drawer>
  </section>;
}

function CalendarDay({ day, today, onClick }: { day: PerformanceCalendarDay; today: string; onClick: () => void }) {
  const hasActivity = day.has_trade || day.closed_trades > 0 || day.has_open_position;
  return <button className={`performance-day performance-day--${rTone(day.total_R)} ${hasActivity ? "has-activity" : "is-empty"} ${day.date === today ? "is-today" : ""}`} onClick={onClick}>
    <span className="performance-day__number">{Number(day.date.slice(-2))}</span>
    <strong>{hasActivity ? formatR(day.total_R) : "—"}</strong>
    <small>{day.has_open_position ? "Position ouverte" : day.closed_trades ? `${day.closed_trades} trade${day.closed_trades > 1 ? "s" : ""}` : day.setup_count ? `${day.setup_count} setup${day.setup_count > 1 ? "s" : ""}` : "Sans trade"}</small>
  </button>;
}

function DayZoom({ day, calendarDay }: { day: Awaited<ReturnType<typeof deskApi.getPerformanceDay>>["day"]; calendarDay?: PerformanceCalendarDay }) {
  const summary = day.performance.summary;
  const totalR = summary?.total_R ?? calendarDay?.total_R ?? 0;
  return <div className="performance-day-zoom">
    <div className={`performance-day-result performance-day-result--${rTone(totalR)}`}><span>Résultat de la journée</span><strong>{formatR(totalR)}</strong><small>Mode {pricingLabels[day.pricing_mode]}</small></div>
    <div className="performance-day-stats"><div><span>Trades</span><strong>{summary?.closed_trades ?? day.trades.length}</strong></div><div><span>Gagnants</span><strong>{summary?.wins ?? 0}</strong></div><div><span>Perdants</span><strong>{summary?.losses ?? 0}</strong></div><div><span>Win rate</span><strong>{formatPercent(summary?.win_rate)}</strong></div></div>

    {day.master && <section className="performance-detail-section"><p className="eyebrow">Plan Master</p><h3>{valueOf(day.master, "decision", "status")}</h3><p>{valueOf(day.master, "summary", "dominant_scenario", "macro_thesis")}</p></section>}

    <section className="performance-detail-section"><p className="eyebrow">Trades</p>{day.trades.length ? <div className="performance-trades">{day.trades.map((trade, index) => <div className="performance-trade" key={valueOf(trade, "trade_id", "id") + index}><div><strong>{valueOf(trade, "instrument", "symbol")}</strong><span>{valueOf(trade, "direction", "side")} · {valueOf(trade, "status")}</span></div><strong className={`r-${rTone(Number(trade.result_R || 0))}`}>{formatR(Number(trade.result_R || 0))}</strong></div>)}</div> : <p className="performance-empty-detail">Aucun trade enregistré pour cette journée.</p>}</section>

    {!!day.setups.length && <section className="performance-detail-section"><p className="eyebrow">Setups</p><div className="performance-trades">{day.setups.map((setup, index) => <div className="performance-trade" key={valueOf(setup, "setup_id", "id") + index}><div><strong>{valueOf(setup, "instrument", "label")}</strong><span>{valueOf(setup, "direction")} · {valueOf(setup, "status", "lifecycle_status")}</span></div><span>{valueOf(setup, "setup_type", "label")}</span></div>)}</div></section>}

    {!!day.timeline.length && <section className="performance-detail-section"><p className="eyebrow">Chronologie</p><div className="performance-day-timeline">{day.timeline.map((event, index) => <div key={index}><time>{valueOf(event, "time").slice(11, 16)}</time><span><strong>{valueOf(event, "type")}</strong>{valueOf(event, "title")}</span></div>)}</div></section>}
  </div>;
}
