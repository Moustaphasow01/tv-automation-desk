import { deskEndpoints } from "@/api/endpoints";
import { getOperatorIdToken } from "@/api/operatorAuth";
import type {
  DeskApi,
  DeskDetailScope,
  DeskOperatorCommandResult,
  DeskOperatorScope,
  DeskOperatorState,
  DeskSession,
  SessionId,
  SessionSummary
} from "@/types";

const apiBase = String(import.meta.env.VITE_API_BASE_URL || "/api/v1").replace(/\/+$/, "");

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || `API ${response.status}: ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

async function postOperatorJson<T>(path: string, body: unknown): Promise<T> {
  const token = await getOperatorIdToken();
  const devApiKey = String(import.meta.env.VITE_DESK_API_KEY || "");
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(devApiKey ? { "X-Desk-Api-Key": devApiKey } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : devApiKey ? { Authorization: `Bearer ${devApiKey}` } : {})
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; code?: string } | null;
    throw new Error(payload?.code ? `${payload.code}: ${payload.error || response.statusText}` : payload?.error || `API ${response.status}: ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

const sessionPath = (path: string, id: SessionId) => `${path}?session=${encodeURIComponent(id)}`;
const detailPath = (path: string, scope: DeskDetailScope) => {
  const query = new URLSearchParams({
    session: scope.session,
    strategy_id: scope.strategyId,
    trading_date: scope.date
  });
  return `${path}?${query.toString()}`;
};

const operatorPath = (scope: DeskOperatorScope) => {
  const query = new URLSearchParams({
    session: scope.session,
    strategy_id: scope.strategyId,
    trading_date: scope.tradingDate,
    mode: scope.mode
  });
  return `${deskEndpoints.operatorState}?${query.toString()}`;
};

const performancePath = (path: string, id: SessionId, values: Record<string, string | number>) => {
  const query = new URLSearchParams({ session: id, strategy_id: "ny_open_1530" });
  Object.entries(values).forEach(([key, value]) => query.set(key, String(value)));
  return `${path}?${query.toString()}`;
};

const restApi: DeskApi = {
  getSession: id => getJson<DeskSession>(sessionPath(deskEndpoints.liveDesk, id)),
  getSessionSummaries: () => getJson<SessionSummary[]>(deskEndpoints.sessions),
  getMarketSnapshot: id => getJson(sessionPath(deskEndpoints.marketSnapshot, id)),
  getPosition: id => getJson(sessionPath(deskEndpoints.position, id)),
  getMacroCalendar: id => getJson(sessionPath(deskEndpoints.macroCalendar, id)),
  getNewsDigest: id => getJson(sessionPath(deskEndpoints.newsDigest, id)),
  getNewsHeadlines: id => getJson(sessionPath(deskEndpoints.newsHeadlines, id)),
  getDeskActivity: id => getJson(sessionPath(deskEndpoints.deskActivity, id)),
  getAlerts: id => getJson(sessionPath(deskEndpoints.alerts, id)),
  getAudit: id => getJson(sessionPath(deskEndpoints.audit, id)),
  getPerformanceCalendar: (id, year, month, pricingMode) => getJson(performancePath(deskEndpoints.performanceCalendar, id, { year, month, pricing_mode: pricingMode })),
  getPerformanceDay: (id, date, pricingMode) => getJson(performancePath(deskEndpoints.performanceDay, id, { date, pricing_mode: pricingMode })),
  getSessionOverview: scope => getJson(detailPath(deskEndpoints.sessionOverview(scope.strategyId, scope.date), scope)),
  getTimeline: scope => getJson(detailPath(deskEndpoints.timeline(scope.strategyId, scope.date), scope)),
  getMaster: (masterId, scope) => getJson(detailPath(deskEndpoints.master(masterId), scope)),
  getMonitor: (monitorId, scope) => getJson(detailPath(deskEndpoints.monitor(monitorId), scope)),
  getThesis: (thesisId, scope) => getJson(detailPath(deskEndpoints.thesis(thesisId), scope)),
  getThesisConditions: (thesisId, scope) => getJson(detailPath(deskEndpoints.thesisConditions(thesisId), scope)),
  getSetup: (setupId, scope) => getJson(detailPath(deskEndpoints.setup(setupId), scope)),
  getOperatorState: scope => getJson<DeskOperatorState>(operatorPath(scope)),
  executeOperatorCommand: input => postOperatorJson<DeskOperatorCommandResult>(deskEndpoints.operatorCommands, input)
};

export const deskApi = restApi;
