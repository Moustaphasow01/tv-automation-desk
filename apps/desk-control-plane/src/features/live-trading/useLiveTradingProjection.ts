import { useMemo } from "react";
import { useFrontView } from "@/domains/front-api/repositories";
import { toLiveTradingModel } from "./mapper";

/** Chart exploration must not change the desk's selected decision or authority. */
export function useLiveTradingProjection(scope: { instrument?: string; timeframe?: string }, signalId: string | null, focus: boolean) {
  const deskQuery = useFrontView("live-trading");
  const chartQuery = useFrontView("live-trading", scope, {
    preservePreviousData: true, queryScope: "market-series", refetchInterval: 60_000,
  });
  const focusQuery = useFrontView("live-focus", scope, {
    preservePreviousData: true, queryScope: "live-focus", refetchInterval: 60_000, enabled: focus,
  });
  const model = useMemo(() => {
    if (!deskQuery.data) return null;
    const desk = toLiveTradingModel(deskQuery.data, { signalId });
    if (!chartQuery.data) return desk;
    const chart = toLiveTradingModel(chartQuery.data, { signalId });
    const theoretical = chart.selectedTheoreticalExecution;
    return {
      ...desk,
      marketSeries: chart.marketSeries,
      selectedTheoreticalExecution: theoretical?.portfolioOrderIntentId === desk.selectedTheoreticalExecution?.portfolioOrderIntentId
        ? theoretical : desk.selectedTheoreticalExecution,
    };
  }, [chartQuery.data, deskQuery.data, signalId]);
  return { deskQuery, chartQuery, focusQuery, model };
}
