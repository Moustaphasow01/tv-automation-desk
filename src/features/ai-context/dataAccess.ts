import { useQuery } from "@tanstack/react-query";
import { operationsApi } from "@/api/operationsApi";

export const aiContextKeys = {
  all: ["operations", "ai-context"] as const,
  overview: ["operations", "ai-context", "overview"] as const,
};

export function useAiContextOverview() {
  return useQuery({
    queryKey: aiContextKeys.overview,
    queryFn: operationsApi.getAiContextOverview,
    refetchInterval: 30_000,
  });
}
