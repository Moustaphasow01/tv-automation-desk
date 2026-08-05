import { useQuery } from "@tanstack/react-query";
import { executionApi } from "@/api/executionApi";

export const executionKeys = { all: ["execution"] as const, overview: ["execution", "overview"] as const };

export function useExecutionOverview() {
  return useQuery({ queryKey: executionKeys.overview, queryFn: executionApi.overview, refetchInterval: 10_000 });
}
