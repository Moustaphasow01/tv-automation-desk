import { useEffect, type RefObject } from "react";
import { createSeriesMarkers, type IChartApi, type ISeriesApi, type MouseEventParams } from "lightweight-charts";
import type { ChartBar } from "./chartData";
import { eventsOnBars, type ChartCursorLink, type ChartEvent } from "./chartAnnotations";

export type ChartAnnotations = {
  id: string;
  timeframe: string;
  events: readonly ChartEvent[];
  cursor: ChartCursorLink | null;
};
type ChartRef = RefObject<{ chart: IChartApi; candles: ISeriesApi<"Candlestick">; disposed: boolean } | null>;

export function useChartAnnotations(handle: ChartRef, bars: readonly ChartBar[], annotations: ChartAnnotations) {
  const { id, timeframe, events, cursor } = annotations;
  useEffect(() => {
    const instance = handle.current;
    if (!instance) return;
    const markers = createSeriesMarkers(instance.candles, eventsOnBars(events, bars, timeframe).map((event) => ({
      time: event.time, id: event.id, text: event.label,
      position: "aboveBar" as const, shape: "circle" as const,
      color: event.kind === "session" ? "#a6b5c3" : event.kind === "theory" ? "#e8c283" : "#91b8f8",
    })));
    return () => { if (!instance.disposed) markers.detach(); };
  }, [handle, bars, events, timeframe]);
  useEffect(() => {
    const instance = handle.current;
    if (!instance || !cursor) return;
    let receiving = false;
    const publish = (event: MouseEventParams) => {
      if (!receiving) cursor.publish({ origin: id, time: typeof event.time === "number" ? event.time : null });
    };
    const unsubscribe = cursor.subscribe((point) => {
      if (point.origin === id) return;
      receiving = true;
      const bar = bars.find((candidate) => candidate.time === point.time);
      if (bar) instance.chart.setCrosshairPosition(bar.close, bar.time, instance.candles);
      else instance.chart.clearCrosshairPosition();
      receiving = false;
    });
    instance.chart.subscribeCrosshairMove(publish);
    return () => { unsubscribe(); if (!instance.disposed) { instance.chart.unsubscribeCrosshairMove(publish); instance.chart.clearCrosshairPosition(); } };
  }, [handle, bars, cursor, id]);
}
