import { useMemo } from "react";
import { useFrontView } from "@/domains/front-api/repositories";
import { toLiveTradingModel } from "../mapper";
import { chartBars } from "./chartData";

/** Quotes and canvases share a cache entry for each explicit instrument/timeframe. */
export function useWorkspaceMarket(instrument: string, timeframe: string, activity: "foreground" | "background" = "foreground") {
  const query = useFrontView("live-trading", { instrument, timeframe }, { queryScope: "market-series", refetchInterval: 30_000, enabled: activity === "foreground" });
  const series = useMemo(() => query.data ? toLiveTradingModel(query.data).marketSeries : null, [query.data]);
  const normalized = useMemo(() => chartBars(series?.points ?? []), [series?.points]);
  const matches = series?.instrument === instrument && series?.timeframe === timeframe;
  const quote = query.data?.data.watchlist?.find((item) => item.symbol === instrument);
  return { query, series, normalized, matches, quote };
}
