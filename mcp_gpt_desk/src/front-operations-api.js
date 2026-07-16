import { z } from "zod";

export const FRONT_OPERATIONS_PREFIX = "/api/v1";
export const FRONT_OPERATIONS_EVENTS_PATH = "/api/v1/events";

const STATIC_PATHS = new Set([
  "/api/v1/operations/summary",
  "/api/v1/workflows",
  "/api/v1/replays",
  "/api/v1/gpt-processes",
  "/api/v1/performance/overview",
  "/api/v1/replays/compare",
  "/api/v1/incidents",
  "/api/v1/history/sessions",
  "/api/v1/strategies",
  FRONT_OPERATIONS_EVENTS_PATH,
]);

export function isFrontOperationsPath(pathname) {
  return STATIC_PATHS.has(pathname)
    || /^\/api\/v1\/workflows\/[^/]+(?:\/(?:steps|events|actions))?$/.test(pathname)
    || /^\/api\/v1\/replays\/[^/]+(?:\/(?:timeline|price-series|days|actions))?$/.test(pathname)
    || /^\/api\/v1\/replays\/[^/]+\/days\/\d{4}-\d{2}-\d{2}$/.test(pathname)
    || /^\/api\/v1\/replays\/[^/]+\/sessions\/[^/]+$/.test(pathname)
    || /^\/api\/v1\/gpt-processes\/[^/]+$/.test(pathname)
    || /^\/api\/v1\/incidents\/[^/]+\/actions$/.test(pathname)
    || /^\/api\/v1\/strategies\/[^/]+\/versions\/compare$/.test(pathname);
}

export function isFrontOperationsWriteRequest(pathname, method) {
  if (method !== "POST") return false;
  return pathname === "/api/v1/replays"
    || pathname.endsWith("/actions");
}

export function isFrontOperationsMethodAllowed(pathname, method) {
  if (pathname === FRONT_OPERATIONS_EVENTS_PATH) return method === "GET";
  if (pathname === "/api/v1/replays") return method === "GET" || method === "POST";
  if (pathname.endsWith("/actions")) return method === "POST";
  return method === "GET";
}

export async function handleFrontOperations(store, { pathname, method, query = {}, body = {}, actor = {} }) {
  if (pathname === "/api/v1/operations/summary") return store.getOperationsSummary(filters(query));
  if (pathname === "/api/v1/workflows") return store.listOperationsWorkflows(filters(query));

  let match = pathname.match(/^\/api\/v1\/workflows\/([^/]+)(?:\/(steps|events|actions))?$/);
  if (match) {
    const workflowId = decode(match[1]);
    if (match[2] === "actions") return store.executeOperationsWorkflowAction({ workflow_id: workflowId, input: body, actor });
    const detail = await store.getOperationsWorkflow({ workflow_id: workflowId });
    if (match[2] === "steps") return response("DeskWorkflowStepList", { workflowId, count: detail.steps.length, items: detail.steps });
    if (match[2] === "events") return response("DeskWorkflowEventList", { workflowId, count: detail.events.length, items: detail.events });
    return detail;
  }

  if (pathname === "/api/v1/replays") {
    if (method === "POST") return store.createOrchestratedReplayDay(parseReplayCreateInput(body));
    return store.listOperationsReplays(filters(query));
  }
  if (pathname === "/api/v1/replays/compare") return store.compareOperationsReplays({ ids: listQuery(query.ids || query.id) });

  match = pathname.match(/^\/api\/v1\/replays\/([^/]+)\/days\/(\d{4}-\d{2}-\d{2})$/);
  if (match) return store.getOperationsReplayDay({ run_id: decode(match[1]), date: match[2] });
  match = pathname.match(/^\/api\/v1\/replays\/([^/]+)\/sessions\/([^/]+)$/);
  if (match) return store.getOperationsReplaySession({ run_id: decode(match[1]), session_execution_id: decode(match[2]) });
  match = pathname.match(/^\/api\/v1\/replays\/([^/]+)(?:\/(timeline|price-series|days|actions))?$/);
  if (match) {
    const runId = decode(match[1]);
    if (match[2] === "timeline") return store.getOperationsReplayTimeline({ run_id: runId });
    if (match[2] === "price-series") return store.getOperationsReplayPriceSeries({ run_id: runId });
    if (match[2] === "days") return store.getOperationsReplayDays({ run_id: runId });
    if (match[2] === "actions") return store.executeOperationsWorkflowAction({ workflow_id: `replay:${runId}`, input: body, actor });
    return store.getOperationsReplay({ run_id: runId });
  }

  if (pathname === "/api/v1/gpt-processes") return store.listOperationsGptProcesses({ ...filters(query), runId: query.run_id || query.runId || null });
  match = pathname.match(/^\/api\/v1\/gpt-processes\/([^/]+)$/);
  if (match) return store.getOperationsGptProcess({ process_id: decode(match[1]) });

  if (pathname === "/api/v1/performance/overview") return store.getOperationsPerformance(filters(query));
  if (pathname === "/api/v1/incidents") return store.listOperationsIncidents(filters(query));
  match = pathname.match(/^\/api\/v1\/incidents\/([^/]+)\/actions$/);
  if (match) return store.executeOperationsIncidentAction({ incident_id: decode(match[1]), input: body, actor });
  if (pathname === "/api/v1/history/sessions") return store.getOperationsHistory(filters(query));
  if (pathname === "/api/v1/strategies") return store.listOperationsStrategies();
  match = pathname.match(/^\/api\/v1\/strategies\/([^/]+)\/versions\/compare$/);
  if (match) return store.compareOperationsStrategyVersions({ strategy_id: decode(match[1]), left: query.left, right: query.right });
  throw Object.assign(new Error(`Front operations route not found: ${pathname}`), { code: "NOT_FOUND", statusCode: 404 });
}

const replayCreateSchema = z.object({
  backtest_id: z.string().min(3).max(200),
  replay_run_id: z.string().min(3).max(200).optional(),
  run_id: z.string().min(3).max(200).optional(),
  strategy_id: z.string().min(2).max(200),
  trading_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  session: z.enum(["asia_open", "ny_open"]),
  pack_id: z.string().min(3).max(300),
  pack_build_id: z.string().min(3).max(300),
  start_time: z.string().min(5).max(50),
  end_time: z.string().min(5).max(50),
  cutoff_paris: z.string().min(5).max(50).optional(),
  cadence: z.enum(["15m", "30m", "60m"]).default("15m"),
  automation_enabled: z.boolean().default(true),
  idempotency_key: z.string().min(8).max(200),
}).strict();

function parseReplayCreateInput(body) {
  const parsed = replayCreateSchema.safeParse(body);
  if (parsed.success) return { ...parsed.data, date: parsed.data.date || parsed.data.trading_date, cutoff_paris: parsed.data.cutoff_paris || parsed.data.start_time };
  const error = new Error(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  error.code = "INVALID_REPLAY_CREATE_INPUT";
  error.statusCode = 400;
  throw error;
}

export function filters(query = {}) {
  return {
    kind: query.kind || null,
    status: query.status || null,
    session: query.session || null,
    strategyId: query.strategy_id || query.strategyId || null,
    date: query.date || null,
    from: query.from || query.date_from || null,
    to: query.to || query.date_to || null,
    q: query.q || null,
    limit: query.limit ? Number(query.limit) : undefined,
  };
}

function response(contract, payload) {
  return { contract, schemaVersion: "1.0.0", ...payload };
}

function decode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function listQuery(value) {
  if (Array.isArray(value)) return value;
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}
