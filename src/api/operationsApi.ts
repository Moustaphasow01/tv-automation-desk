import { getOperatorIdToken } from "@/api/operatorAuth";
import type {
  DeskHistory, GptProcessDetail, GptProcessList, IncidentList, OperationsCommandInput, OperationsSummary,
  PerformanceOverview, ReplayDayDetail, ReplayList, ReplayRunDetail, ReplaySessionDetail, StrategyList,
  WorkflowDetail, WorkflowList
} from "@/operationsTypes";

const apiBase = String(import.meta.env.VITE_API_BASE_URL || "/api/v1").replace(/\/+$/, "");
const part = (value: string) => encodeURIComponent(value);

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = init?.method === "POST" ? await getOperatorIdToken() : null;
  const devApiKey = String(import.meta.env.VITE_DESK_API_KEY || "");
  const response = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(devApiKey && init?.method === "POST" ? { "X-Desk-Api-Key": devApiKey } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : devApiKey && init?.method === "POST" ? { Authorization: `Bearer ${devApiKey}` } : {}),
      ...init?.headers
    }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; code?: string } | null;
    throw new Error(payload?.code ? `${payload.code}: ${payload.error || response.statusText}` : payload?.error || `API ${response.status}`);
  }
  return response.json() as Promise<T>;
}

const query = (values: Record<string, string | number | null | undefined>) => {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => value !== null && value !== undefined && value !== "" && params.set(key, String(value)));
  const text = params.toString();
  return text ? `?${text}` : "";
};

const post = <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

export const operationsApi = {
  getSummary: () => request<OperationsSummary>("/operations/summary"),
  listWorkflows: (filters: Record<string, string | number | null | undefined> = {}) => request<WorkflowList>(`/workflows${query(filters)}`),
  getWorkflow: (id: string) => request<WorkflowDetail>(`/workflows/${part(id)}`),
  executeWorkflowAction: (id: string, input: OperationsCommandInput) => post(`/workflows/${part(id)}/actions`, input),
  listReplays: (filters: Record<string, string | number | null | undefined> = {}) => request<ReplayList>(`/replays${query(filters)}`),
  createReplay: (input: Record<string, unknown>) => post<Record<string, unknown>>("/replays", input),
  getReplay: (id: string) => request<ReplayRunDetail>(`/replays/${part(id)}`),
  getReplayDay: (id: string, date: string) => request<ReplayDayDetail>(`/replays/${part(id)}/days/${part(date)}`),
  getReplaySession: (id: string, sessionExecutionId: string) => request<ReplaySessionDetail>(`/replays/${part(id)}/sessions/${part(sessionExecutionId)}`),
  listGptProcesses: (runId?: string) => request<GptProcessList>(`/gpt-processes${query({ run_id: runId })}`),
  getGptProcess: (id: string) => request<GptProcessDetail>(`/gpt-processes/${part(id)}`),
  getPerformance: (filters: Record<string, string | null | undefined> = {}) => request<PerformanceOverview>(`/performance/overview${query(filters)}`),
  compareReplays: (ids: string[]) => request<Record<string, unknown>>(`/replays/compare${query({ ids: ids.join(",") })}`),
  listIncidents: () => request<IncidentList>("/incidents"),
  executeIncidentAction: (id: string, input: OperationsCommandInput) => post(`/incidents/${part(id)}/actions`, input),
  getHistory: () => request<DeskHistory>("/history/sessions"),
  listStrategies: () => request<StrategyList>("/strategies"),
  compareStrategyVersions: (id: string, left: string, right: string) => request<Record<string, unknown>>(`/strategies/${part(id)}/versions/compare${query({ left, right })}`),
  eventsUrl: `${apiBase}/events`
};
