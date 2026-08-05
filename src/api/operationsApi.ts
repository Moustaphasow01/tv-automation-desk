import { getOperatorIdToken } from "@/api/operatorAuth";
import { researchProgressFromCarrier, withResearchProgress } from "@/api/researchProgress";
import { fetchJsonWithTimeout } from "@/api/request";
import type {
  AiRuntimeSettingsActionInput, AiRuntimeSettingsResponse, DeskHistory, GptProcessDetail, GptProcessList, HistorySessionDetail, IncidentList, ObservabilityOverview,
  NotificationActionInput, NotificationList, NotificationSync, ObservabilityIncidentSync, ObservabilityPolicyActionInput,
  ObservabilityPolicyResponse, OperationsCommandInput, OperationsSummary,
  PerformanceOverview, ReplayComparison, ReplayDayDetail, ReplayList, ReplayRunDetail, ReplaySessionDetail, RunbookDetail, RunbookList, StrategyList,
  StrategyVersionComparison, TelegramActionInput, TelegramStatus, WorkflowDetail, WorkflowList
} from "@/operationsTypes";

const apiBase = String(import.meta.env.VITE_API_BASE_URL || "/api/v1").replace(/\/+$/, "");
const part = (value: string) => encodeURIComponent(value);

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = init?.method === "POST" ? await getOperatorIdToken() : null;
  const devApiKey = String(import.meta.env.VITE_DESK_API_KEY || "");
  return fetchJsonWithTimeout<T>(`${apiBase}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(devApiKey && init?.method === "POST" ? { "X-Desk-Api-Key": devApiKey } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : devApiKey && init?.method === "POST" ? { Authorization: `Bearer ${devApiKey}` } : {}),
      ...init?.headers
    }
  }, { label: path, timeoutMs: init?.method === "POST" ? 15_000 : 12_000 });
}

const query = (values: Record<string, string | number | null | undefined>) => {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => value !== null && value !== undefined && value !== "" && params.set(key, String(value)));
  const text = params.toString();
  return text ? `?${text}` : "";
};

const withDefaultLimit = (filters: Record<string, string | number | null | undefined>, limit: number) => ({
  ...filters,
  limit: filters.limit ?? limit
});

const post = <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

function normalizeGptProcessList(data: GptProcessList): GptProcessList {
  return {
    ...data,
    items: Array.isArray(data.items)
      ? data.items.map(item => withResearchProgress(item))
      : [],
  };
}

function normalizeGptProcessDetail(data: GptProcessDetail): GptProcessDetail {
  const detailProgress = researchProgressFromCarrier(data)
    || researchProgressFromCarrier(data.raw);
  const process = withResearchProgress(data.process, detailProgress);
  return {
    ...data,
    process,
    ...(process.researchProgress
      ? { researchProgress: process.researchProgress }
      : {}),
  };
}

function normalizeObservability(data: ObservabilityOverview): ObservabilityOverview {
  return {
    ...data,
    items: Array.isArray(data.items)
      ? data.items.map(item => withResearchProgress(item))
      : [],
  };
}

export type ReplayPreparationStatus =
  | "QUEUED"
  | "DATA_CHECK"
  | "PACK_BUILDING"
  | "AWAITING_CONFIRMATION"
  | "QUEUED_FOR_GPT"
  | "FAILED"
  | "CANCELLED";

export type ReplayPreparationJob = {
  preparation_id: string;
  status: ReplayPreparationStatus;
  progress_percent: number;
  trading_date: string;
  session: "asia_open" | "ny_open";
  run_scope: "full_day" | "session";
  phases: Array<{ phase_id: string; strategy_id: string; master_time: string; monitor_from: string; monitor_to: string }>;
  execution_id: string | null;
  run_family_id: string | null;
  run_number: number;
  aggregate_role: "primary" | "comparison";
  aggregate_eligible: boolean;
  cadence: "5m" | "15m" | "30m" | "60m";
  start_time: string;
  end_time: string;
  worker_group: string;
  pack_id: string | null;
  pack_build_id: string | null;
  pack_reused: boolean;
  config_id: string | null;
  backtest_id: string | null;
  pack_quality: Record<string, unknown> | null;
  source_coverage: Record<string, unknown> | null;
  error: { code: string; message: string; details?: Record<string, unknown> } | null;
  stages: Array<{ status: string; at_utc: string; at_paris?: string; message: string }>;
  created_at_utc: string;
  updated_at_utc: string;
};

export type ReplayPreparationList = { ok: true; count: number; items: ReplayPreparationJob[] };
export type ReplayPreparationCreate = { ok: true; status: string; count: number; jobs: ReplayPreparationJob[] };
export type ReplayPreparationAction = { ok: true; status: ReplayPreparationStatus; job: ReplayPreparationJob };

export type ClaimLaneState = {
  lane: "live" | "replay";
  enabled: boolean;
  status: "RUNNING" | "PAUSED";
  revision: number;
  reason: string | null;
  changed_by: string | null;
  updated_at_utc: string | null;
  counts: Record<string, number>;
  statuses: Record<string, number>;
  items: Array<Record<string, unknown>>;
  config_statuses?: Record<string, number>;
  preparation_statuses?: Record<string, number>;
};

export type ClaimLanesOverview = {
  ok: true;
  generated_at_utc: string;
  lanes: { live: ClaimLaneState; replay: ClaimLaneState };
  activity: Array<Record<string, unknown>>;
};

export const operationsApi = {
  getSummary: () => request<OperationsSummary>("/operations/summary"),
  listWorkflows: (filters: Record<string, string | number | null | undefined> = {}) => request<WorkflowList>(`/workflows${query(filters)}`),
  getWorkflow: (id: string) => request<WorkflowDetail>(`/workflows/${part(id)}`),
  executeWorkflowAction: (id: string, input: OperationsCommandInput) => post(`/workflows/${part(id)}/actions`, input),
  listReplays: (filters: Record<string, string | number | null | undefined> = {}) => request<ReplayList>(`/replays${query(filters)}`),
  createReplay: (input: Record<string, unknown>) => post<Record<string, unknown>>("/replays", input),
  listReplayPreparations: (filters: Record<string, string | number | null | undefined> = {}) => request<ReplayPreparationList>(`/replay-preparations${query(filters)}`),
  createReplayPreparation: (input: {
    trading_date: string;
    cadence: "5m" | "15m" | "30m" | "60m";
    worker_group: "replay-v4";
    idempotency_key: string;
  }) => post<ReplayPreparationCreate>("/replay-preparations", input),
  executeReplayPreparationAction: (id: string, action: "publish" | "retry" | "cancel") =>
    post<ReplayPreparationAction>(`/replay-preparations/${part(id)}/actions`, { action }),
  getClaimLanes: () => request<ClaimLanesOverview>("/claim-lanes"),
  executeClaimLaneAction: (lane: "live" | "replay", input: { action: "pause" | "resume"; expected_revision: number; reason: string }) =>
    post<{ ok: true; status: string; control: ClaimLaneState }>(`/claim-lanes/${lane}/actions`, input),
  getReplay: (id: string) => request<ReplayRunDetail>(`/replays/${part(id)}`),
  getReplayDay: (id: string, date: string) => request<ReplayDayDetail>(`/replays/${part(id)}/days/${part(date)}`),
  getReplaySession: (id: string, sessionExecutionId: string) => request<ReplaySessionDetail>(`/replays/${part(id)}/sessions/${part(sessionExecutionId)}`),
  listGptProcesses: (runId?: string) =>
    request<GptProcessList>(`/gpt-processes${query({ run_id: runId })}`)
      .then(normalizeGptProcessList),
  getGptProcess: (id: string) =>
    request<GptProcessDetail>(`/gpt-processes/${part(id)}`)
      .then(normalizeGptProcessDetail),
  getObservability: (filters: Record<string, string | number | null | undefined> = {}) =>
    request<ObservabilityOverview>(`/observability/overview${query(withDefaultLimit(filters, 300))}`)
      .then(normalizeObservability),
  getObservabilityPolicy: () => request<ObservabilityPolicyResponse>("/observability/policy"),
  updateObservabilityPolicy: (input: ObservabilityPolicyActionInput) => post<{ policy: ObservabilityPolicyResponse["policy"]; idempotent: boolean }>("/observability/policy", input),
  getAiRuntimeSettings: () => request<AiRuntimeSettingsResponse>("/ai/runtime-settings"),
  updateAiRuntimeSettings: (input: AiRuntimeSettingsActionInput) =>
    post<{ settings: AiRuntimeSettingsResponse["settings"]; idempotent: boolean }>("/ai/runtime-settings", input),
  evaluateObservabilityIncidents: (input: { autoResolve?: boolean; syncNotifications?: boolean; reason?: string } = {}) => post<ObservabilityIncidentSync>("/observability/incidents/evaluate", input),
  getPerformance: (filters: Record<string, string | null | undefined> = {}) => request<PerformanceOverview>(`/performance/overview${query(filters)}`),
  compareReplays: (ids: string[]) => request<ReplayComparison>(`/replays/compare${query({ ids: ids.join(",") })}`),
  listIncidents: (filters: Record<string, string | number | null | undefined> = {}) => request<IncidentList>(`/incidents${query(withDefaultLimit(filters, 300))}`),
  executeIncidentAction: (id: string, input: OperationsCommandInput) => post(`/incidents/${part(id)}/actions`, input),
  listNotifications: (filters: Record<string, string | number | null | undefined> = {}) => request<NotificationList>(`/notifications${query(withDefaultLimit(filters, 300))}`),
  syncNotifications: (input: { autoClear?: boolean; limit?: number; reason?: string } = {}) => post<NotificationSync>("/notifications/sync", input),
  executeNotificationAction: (id: string, input: NotificationActionInput) => post(`/notifications/${part(id)}/actions`, input),
  getTelegramStatus: () => request<TelegramStatus>("/telegram"),
  executeTelegramAction: (input: TelegramActionInput) => post<{ ok: true; action: string }>("/telegram/actions", input),
  listRunbooks: (filters: Record<string, string | number | null | undefined> = {}) => request<RunbookList>(`/runbooks${query(filters)}`),
  getRunbook: (id: string) => request<RunbookDetail>(`/runbooks/${part(id)}`),
  getHistory: (filters: Record<string, string | number | null | undefined> = {}) => request<DeskHistory>(`/history/sessions${query(filters)}`),
  getHistorySession: (id: string) => request<HistorySessionDetail>(`/history/sessions/${part(id)}`),
  listStrategies: () => request<StrategyList>("/strategies"),
  compareStrategyVersions: (id: string, left: string, right: string) => request<StrategyVersionComparison>(`/strategies/${part(id)}/versions/compare${query({ left, right })}`),
  eventsUrl: `${apiBase}/events`
};
