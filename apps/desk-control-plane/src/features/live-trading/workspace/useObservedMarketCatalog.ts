import { useCryptoMarket } from "@/domains/front-api/cryptoMarketRepository";
import type { LiveTradingModel } from "../model";

export type ObservedMarketCatalog = { instruments: readonly string[]; cryptoInstruments: readonly string[]; cryptoTimeframes: readonly string[] };

export function useObservedMarketCatalog(series: LiveTradingModel["marketSeries"]): ObservedMarketCatalog {
  const query = useCryptoMarket({ mode: "catalog" });
  const cryptoInstruments = query.data?.data.markets.map((market) => market.instrument) ?? [];
  return { instruments: [...new Set([...series.supportedInstruments, ...cryptoInstruments])], cryptoInstruments, cryptoTimeframes: query.data?.data.timeframes ?? [] };
}
