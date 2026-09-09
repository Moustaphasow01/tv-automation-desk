import { useEffect, useRef } from "react";
import { CandlestickSeries, ColorType, createChart, HistogramSeries, LineSeries, type IChartApi, type IPriceLine, type ISeriesApi } from "lightweight-charts";
import type { ChartBar } from "./chartData";
import type { TradeOverlay } from "../chart/tradePlanOverlay";
import { parisTime } from "./workspaceModel";
import { useChartAnnotations, type ChartAnnotations } from "./useChartAnnotations";

type ChartHandle = { chart: IChartApi; candles: ISeriesApi<"Candlestick">; volume: ISeriesApi<"Histogram">; vwap: ISeriesApi<"Line">; lines: IPriceLine[]; disposed: boolean };

export function useFinancialChart(bars: readonly ChartBar[], overlay: TradeOverlay | null, showVwap: boolean, annotations: ChartAnnotations) {
  const container = useRef<HTMLDivElement>(null);
  const handle = useRef<ChartHandle | null>(null);
  const initialized = useRef(false);
  useEffect(() => {
    if (!container.current) return;
    handle.current = createFinancialChart(container.current);
    return () => { if (handle.current) { handle.current.disposed = true; handle.current.chart.remove(); } handle.current = null; initialized.current = false; };
  }, []);
  useEffect(() => {
    const instance = handle.current;
    if (!instance) return;
    const viewport = instance.chart.timeScale().getVisibleLogicalRange();
    const timeWindow = instance.chart.timeScale().getVisibleRange();
    const previousLength = instance.candles.data().length;
    const following = viewport ? viewport.to >= previousLength - 1 : true;
    instance.candles.setData(bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    instance.volume.setData(bars.map((bar) => bar.volume === null ? { time: bar.time } : {
      time: bar.time, value: bar.volume, color: bar.close >= bar.open ? "#3f6d60" : "#785b5c",
    }));
    instance.vwap.setData(bars.map((bar) => bar.vwap === null ? { time: bar.time } : { time: bar.time, value: bar.vwap }));
    if (!initialized.current && bars.length) {
      instance.chart.timeScale().setVisibleLogicalRange({ from: Math.max(-1, bars.length - 70), to: bars.length + 3 });
      initialized.current = true;
    } else if (!following && timeWindow) {
      instance.chart.timeScale().setVisibleRange(timeWindow);
    } else if (viewport) {
      const shift = following ? Math.max(0, bars.length - previousLength) : 0;
      instance.chart.timeScale().setVisibleLogicalRange({ from: viewport.from + shift, to: viewport.to + shift });
    }
  }, [bars]);
  useEffect(() => { handle.current?.vwap.applyOptions({ visible: showVwap }); }, [showVwap]);
  useEffect(() => {
    const instance = handle.current;
    if (!instance) return;
    instance.lines.forEach((line) => instance.candles.removePriceLine(line));
    instance.lines = chartLevels(overlay).map((level) => instance.candles.createPriceLine({ ...level, lineWidth: 1, lineStyle: 2, axisLabelVisible: true }));
  }, [overlay]);
  useChartAnnotations(handle, bars, annotations);
  const navigate = (direction: "in" | "out" | "left" | "right" | "reset") => navigateChart(handle.current?.chart, direction);
  return { container, navigate };
}

function createFinancialChart(container: HTMLDivElement): ChartHandle {
  const chart = createChart(container, {
    autoSize: true,
    layout: { background: { type: ColorType.Solid, color: "#111820" }, textColor: "#a6b5c3", fontSize: 12, fontFamily: "Consolas, monospace", attributionLogo: true },
    grid: { vertLines: { color: "#202b35" }, horzLines: { color: "#25313c" } },
    crosshair: { vertLine: { color: "#8ea1b5", labelBackgroundColor: "#354350" }, horzLine: { color: "#8ea1b5", labelBackgroundColor: "#354350" } },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.25 } },
    timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#354350", rightOffset: 3, tickMarkFormatter: (time: number) => parisTime(new Date(time * 1_000).toISOString()).slice(0, 5) },
    localization: { locale: "fr-FR", timeFormatter: (time: number) => `${parisTime(new Date(time * 1_000).toISOString(), true)} Paris` },
    handleScroll: { vertTouchDrag: false, horzTouchDrag: true },
  });
  const candles = chart.addSeries(CandlestickSeries, { upColor: "#7cc9a6", downColor: "#ed999a", borderVisible: false, wickUpColor: "#7cc9a6", wickDownColor: "#ed999a", priceLineColor: "#a6b5c3" });
  const volume = chart.addSeries(HistogramSeries, { priceScaleId: "volume", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
  volume.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
  const vwap = chart.addSeries(LineSeries, { color: "#e8c283", lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
  return { chart, candles, volume, vwap, lines: [], disposed: false };
}

function chartLevels(overlay: TradeOverlay | null) {
  if (!overlay) return [];
  return [
    { price: overlay.entry, color: "#91b8f8", title: "Entrée" },
    ...(overlay.stop === null ? [] : [{ price: overlay.stop, color: "#ed999a", title: "Stop" }]),
    ...overlay.targets.map((target, index) => ({ price: target.price, color: "#7cc9a6", title: `Objectif ${index + 1}` })),
  ];
}

function navigateChart(chart: IChartApi | undefined, direction: "in" | "out" | "left" | "right" | "reset") {
  if (!chart) return;
  if (direction === "reset") { chart.timeScale().fitContent(); chart.priceScale("right").applyOptions({ autoScale: true }); return; }
  const range = chart.timeScale().getVisibleLogicalRange();
  if (!range) return;
  const span = range.to - range.from;
  const delta = direction === "left" ? -span * 0.2 : direction === "right" ? span * 0.2 : 0;
  const zoom = direction === "in" ? 0.2 : direction === "out" ? -0.25 : 0;
  chart.timeScale().setVisibleLogicalRange({ from: range.from + delta + span * zoom, to: range.to + delta - span * zoom });
}
