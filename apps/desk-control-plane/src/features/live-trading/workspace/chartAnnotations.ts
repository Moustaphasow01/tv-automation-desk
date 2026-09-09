import type { LiveFocusView, LiveTheoreticalExecutionRow } from "@/domains/front-api/viewModels";
import type { FocusQueueItem } from "../focusJournalModel";
import type { ChartBar } from "./chartData";
import { timeframeSeconds } from "./timeframeDuration";

export type ChartEvent = { id: string; at: string; label: string; instrument?: string; kind: "session" | "ticket" | "theory" };
export type CursorPoint = { origin: string; time: number | null };

export function createChartCursorLink() {
  const listeners = new Set<(point: CursorPoint) => void>();
  let previous: CursorPoint | null = null;
  return {
    publish(point: CursorPoint) {
      if (previous?.origin === point.origin && previous.time === point.time) return;
      previous = point;
      listeners.forEach((listener) => listener(point));
    },
    subscribe(listener: (point: CursorPoint) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export type ChartCursorLink = ReturnType<typeof createChartCursorLink>;

export function chartEvents(focus: LiveFocusView, selected: FocusQueueItem | null, rows: readonly LiveTheoreticalExecutionRow[]): ChartEvent[] {
  const events: ChartEvent[] = [];
  const add = (event: Omit<ChartEvent, "at"> & { at: string | null | undefined }) => {
    if (event.at && Number.isFinite(Date.parse(event.at))) events.push({ ...event, at: event.at });
  };
  add({ id: "session-open", at: focus.session.sessionStart, label: "Ouverture de séance", kind: "session" });
  add({ id: "session-close", at: focus.session.sessionEnd, label: "Fin de séance", kind: "session" });
  if (selected?.card) {
    const common = { instrument: selected.instrument };
    add({ ...common, id: selected.key + ":created", at: selected.createdAt, label: "Ticket reçu", kind: "ticket" });
    add({ ...common, id: selected.key + ":expires", at: selected.expiresAt, label: "Fin de validité du ticket", kind: "ticket" });
    const row = rows.find((item) => item.portfolioOrderIntentId === selected.card?.orderIntentId);
    add({ ...common, id: selected.key + ":entry", at: row?.entryFilledAt, label: "Entrée théorique", kind: "theory" });
    add({ ...common, id: selected.key + ":exit", at: row?.exitAt, label: "Sortie théorique", kind: "theory" });
  }
  return events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

export function eventsOnBars(events: readonly ChartEvent[], bars: readonly ChartBar[], timeframe: string) {
  const duration = timeframeSeconds(timeframe);
  if (duration === null || !Number.isFinite(duration)) return [];
  return events.flatMap((event) => {
    const time = Date.parse(event.at) / 1_000;
    // Only the containing received bar; never bridge a missing-data or overnight gap.
    const bar = bars.find((candidate) => candidate.time <= time && time < candidate.time + duration);
    return bar ? [{ ...event, time: bar.time }] : [];
  });
}
