import type { UTCTimestamp } from "lightweight-charts";
import type { LiveTradingModel } from "../model";

export type MarketPoint = LiveTradingModel["marketSeries"]["points"][number];
export type ChartBar = { time: UTCTimestamp; open: number; high: number; low: number; close: number; volume: number | null; vwap: number | null };

/** Display normalization only: no interpolation, price repair or strategy computation. */
export function chartBars(points: readonly MarketPoint[]): { bars: ChartBar[]; rejected: number } {
  const byTime = new Map<number, ChartBar>();
  let rejected = 0;
  for (const point of points) {
    const time = Math.floor(Date.parse(point.timestamp) / 1_000);
    const { open, high, low, close } = point;
    if (!Number.isFinite(time) || !finite(open) || !finite(high) || !finite(low) || !finite(close)
      || high < Math.max(open, close) || low > Math.min(open, close) || high < low) {
      rejected += 1;
      continue;
    }
    byTime.set(time, { time: time as UTCTimestamp, open, high, low, close,
      volume: finite(point.volume) && point.volume >= 0 ? point.volume : null, vwap: finite(point.vwap) ? point.vwap : null });
  }
  return { bars: [...byTime.values()].sort((a, b) => a.time - b.time), rejected };
}

export function changedBarCount(previous: readonly ChartBar[], next: readonly ChartBar[]): number {
  const old = new Map(previous.map((bar) => [bar.time, bar]));
  return next.filter((bar) => JSON.stringify(bar) !== JSON.stringify(old.get(bar.time))).length
    + previous.filter((bar) => !next.some((candidate) => candidate.time === bar.time)).length;
}

function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
