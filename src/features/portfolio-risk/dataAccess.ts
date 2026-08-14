import { useQuery } from "@tanstack/react-query";
import { operationsApi } from "@/api/operationsApi";

export const portfolioRiskKeys = {
  all: ["operations", "portfolio-risk"] as const,
  overview: ["operations", "portfolio-risk", "overview"] as const,
};

export function usePortfolioRiskOverview() {
  return useQuery({
    queryKey: portfolioRiskKeys.overview,
    queryFn: operationsApi.getPortfolioRiskOverview,
    refetchInterval: 15_000,
  });
}
