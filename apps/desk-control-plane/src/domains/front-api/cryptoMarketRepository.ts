import { useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DeskConfigContext } from "@/app/AppProviders";
import { createDeskTransport } from "@/shared/transport";
import { assertViewEnvelope } from "@/shared/contracts";
import { isCryptoMarketView } from "./cryptoMarketContract";

export function useCryptoMarket({ mode, instrument = "BTCUSD", timeframe = "5", activity = "foreground" }: {
  mode: "catalog" | "quotes" | "history" | "live"; instrument?: string; timeframe?: string; activity?: "foreground" | "background";
}) {
  const config = useContext(DeskConfigContext);
  const transport = useMemo(() => {
    if (!config) throw new Error("DESK_CONFIG_CONTEXT_MISSING");
    return createDeskTransport(config);
  }, [config]);
  return useQuery({
    queryKey: ["crypto-observation", config?.frontApiBaseUrl, mode, instrument, timeframe],
    queryFn: async ({ signal }) => assertViewEnvelope(await transport.getView("crypto-market", { mode, instrument, timeframe }, signal), isCryptoMarketView),
    enabled: activity === "foreground", retry: 1, staleTime: mode === "catalog" ? 60_000 : 500,
    refetchInterval: mode === "catalog" || mode === "history" ? 60_000 : 1_000,
    refetchIntervalInBackground: false, gcTime: 120_000,
  });
}
