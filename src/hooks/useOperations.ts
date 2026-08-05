import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { operationsApi } from "@/api/operationsApi";

export const operationsKeys = {
  all: ["operations"] as const,
  summary: ["operations", "summary"] as const,
  workflows: (filters: Record<string, unknown>) => ["operations", "workflows", filters] as const,
  workflow: (id: string) => ["operations", "workflow", id] as const,
  replays: ["operations", "replays"] as const,
  replay: (id: string) => ["operations", "replay", id] as const,
  replayDay: (id: string, date: string) => ["operations", "replay", id, "day", date] as const,
  replaySession: (id: string, session: string) => ["operations", "replay", id, "session", session] as const,
  gpt: (runId?: string) => ["operations", "gpt", runId || "all"] as const,
  gptProcess: (id: string) => ["operations", "gpt-process", id] as const,
  observability: (filters: Record<string, unknown> = {}) => ["operations", "observability", filters] as const,
  performance: ["operations", "performance"] as const,
  incidents: ["operations", "incidents"] as const,
  notifications: (filters: Record<string, unknown> = {}) => ["operations", "notifications", filters] as const,
  telegram: ["operations", "telegram"] as const,
  runbooks: (filters: Record<string, unknown> = {}) => ["operations", "runbooks", filters] as const,
  runbook: (id: string) => ["operations", "runbook", id] as const,
  history: (filters: Record<string, unknown> = {}) => ["operations", "history", filters] as const,
  historySession: (id: string) => ["operations", "history-session", id] as const,
  strategies: ["operations", "strategies"] as const,
};

export function useOperationsSummary() {
  return useQuery({ queryKey: operationsKeys.summary, queryFn: operationsApi.getSummary, refetchInterval: 30_000 });
}

export function useWorkflows(filters: Record<string, string | number | null | undefined> = {}) {
  return useQuery({ queryKey: operationsKeys.workflows(filters), queryFn: () => operationsApi.listWorkflows(filters), refetchInterval: 30_000 });
}

export function useWorkflow(id: string) {
  return useQuery({ queryKey: operationsKeys.workflow(id), queryFn: () => operationsApi.getWorkflow(id), enabled: Boolean(id), refetchInterval: 30_000 });
}

export function useReplays(filters: Record<string, string | number | null | undefined> = {}) {
  const isLiveScope = !["certified", "legacy"].includes(String(filters.version_scope || ""));
  return useQuery({
    queryKey: [...operationsKeys.replays, filters],
    queryFn: () => operationsApi.listReplays(filters),
    refetchInterval: isLiveScope ? 15_000 : 60_000,
  });
}

export function useReplay(id: string) {
  return useQuery({ queryKey: operationsKeys.replay(id), queryFn: () => operationsApi.getReplay(id), enabled: Boolean(id), refetchInterval: 10_000 });
}

export function useReplayDay(id: string, date: string) {
  return useQuery({ queryKey: operationsKeys.replayDay(id, date), queryFn: () => operationsApi.getReplayDay(id, date), enabled: Boolean(id && date), refetchInterval: 15_000 });
}

export function useReplaySession(id: string, sessionId: string) {
  return useQuery({ queryKey: operationsKeys.replaySession(id, sessionId), queryFn: () => operationsApi.getReplaySession(id, sessionId), enabled: Boolean(id && sessionId), refetchInterval: 10_000 });
}

export function useGptProcesses(runId?: string) {
  return useQuery({ queryKey: operationsKeys.gpt(runId), queryFn: () => operationsApi.listGptProcesses(runId), refetchInterval: 30_000 });
}

export function useGptProcess(id: string) {
  return useQuery({ queryKey: operationsKeys.gptProcess(id), queryFn: () => operationsApi.getGptProcess(id), enabled: Boolean(id), refetchInterval: 30_000 });
}

export function useObservability(filters: Record<string, string | number | null | undefined> = {}) {
  return useQuery({
    queryKey: operationsKeys.observability(filters),
    queryFn: () => operationsApi.getObservability(filters),
    refetchInterval: 30_000,
  });
}

export function useNotifications(filters: Record<string, string | number | null | undefined> = {}) {
  return useQuery({
    queryKey: operationsKeys.notifications(filters),
    queryFn: () => operationsApi.listNotifications(filters),
    refetchInterval: 30_000,
  });
}

export function useTelegramStatus() {
  return useQuery({
    queryKey: operationsKeys.telegram,
    queryFn: operationsApi.getTelegramStatus,
    refetchInterval: 10_000,
  });
}

export function useRunbooks(filters: Record<string, string | number | null | undefined> = {}) {
  return useQuery({
    queryKey: operationsKeys.runbooks(filters),
    queryFn: () => operationsApi.listRunbooks(filters),
    refetchInterval: 60_000,
  });
}

export function useRunbook(id: string) {
  return useQuery({
    queryKey: operationsKeys.runbook(id),
    queryFn: () => operationsApi.getRunbook(id),
    enabled: Boolean(id),
    refetchInterval: 60_000,
  });
}

export function useOperationsEvents() {
  const client = useQueryClient();
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const stream = new EventSource(operationsApi.eventsUrl, { withCredentials: true });
    const refresh = () => client.invalidateQueries({ queryKey: operationsKeys.all });
    stream.addEventListener("operations", refresh);
    return () => {
      stream.removeEventListener("operations", refresh);
      stream.close();
    };
  }, [client]);
}
