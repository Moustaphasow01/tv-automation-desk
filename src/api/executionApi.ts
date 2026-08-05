import { getOperatorIdToken } from "@/api/operatorAuth";
import { fetchJsonWithTimeout } from "@/api/request";
import type { ExecutionAction, ExecutionOverview } from "@/executionTypes";

const apiBase = String(import.meta.env.VITE_API_BASE_URL || "/api/v1").replace(/\/+$/, "");

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
      ...init?.headers,
    },
  }, { label: path, timeoutMs: init?.method === "POST" ? 15_000 : 12_000 });
}

export const executionApi = {
  overview: () => request<ExecutionOverview>("/execution/overview"),
  action: (input: ExecutionAction) => request<Record<string, unknown>>("/execution/actions", { method: "POST", body: JSON.stringify(input) }),
};
