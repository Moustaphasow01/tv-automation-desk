import { z } from "zod";
import { createAgentRuntimeAdminService } from "./agent-runtime-admin-service.js";
import { createAgentRuntimeSchedulerService } from "./agent-runtime-scheduler-service.js";

const READ_PATHS = new Set([
  "/api/v1/agent-runtime/overview",
  "/api/v1/agent-runtime/tasks",
  "/api/v1/agent-runtime/pools",
  "/api/v1/agent-runtime/scheduler-plan",
  "/api/v1/agent-runtime/metrics",
  "/api/v1/agent-runtime/dead-letters",
]);
const mutationSchema = z.object({
  operator_id: z.string().min(3).max(120).optional(),
  reason: z.string().min(8).max(1000),
  idempotency_key: z.string().min(8).max(200),
}).strict();

export function isFrontAgentRuntimePath(pathname) {
  return READ_PATHS.has(pathname)
    || /^\/api\/v1\/agent-runtime\/dead-letters\/[^/]+\/requeue$/.test(pathname)
    || /^\/api\/v1\/agent-runtime\/tasks\/[^/]+\/cancel$/.test(pathname);
}

export function isFrontAgentRuntimeWriteRequest(pathname, method) {
  return method === "POST" && (
    /^\/api\/v1\/agent-runtime\/dead-letters\/[^/]+\/requeue$/.test(pathname)
    || /^\/api\/v1\/agent-runtime\/tasks\/[^/]+\/cancel$/.test(pathname)
  );
}

export function frontAgentRuntimeMethodAllowed(pathname, method) {
  if (READ_PATHS.has(pathname)) return method === "GET";
  if (isFrontAgentRuntimeWriteRequest(pathname, "POST")) return method === "POST";
  return null;
}

export async function handleFrontAgentRuntime(store, context = {}) {
  const { pathname, query = {}, body = {}, actor = {} } = context;
  const admin = agentRuntimeAdmin(store);
  const scheduler = agentRuntimeScheduler(store);
  if (pathname === "/api/v1/agent-runtime/overview") return handled(await call(store, "getAgentRuntimeOverview", admin, "getOverview", queryArgs(query)));
  if (pathname === "/api/v1/agent-runtime/tasks") return handled(await call(store, "listAgentRuntimeTasks", admin, "listTasks", queryArgs(query)));
  if (pathname === "/api/v1/agent-runtime/pools") return handled(await call(store, "getAgentRuntimePoolOverview", admin, "getPoolOverview", queryArgs(query)));
  if (pathname === "/api/v1/agent-runtime/scheduler-plan") return handled(await call(store, "getAgentRuntimeSchedulerPlan", scheduler, "previewSchedule", queryArgs(query)));
  if (pathname === "/api/v1/agent-runtime/metrics") return handled(await call(store, "listAgentRuntimeMetrics", admin, "listMetrics", queryArgs(query)));
  if (pathname === "/api/v1/agent-runtime/dead-letters") return handled(await call(store, "listAgentRuntimeDeadLetters", admin, "listDeadLetters", queryArgs(query)));
  const deadLetter = pathname.match(/^\/api\/v1\/agent-runtime\/dead-letters\/([^/]+)\/requeue$/);
  if (deadLetter) return handled(await requeue(store, admin, decode(deadLetter[1]), body, actor));
  const task = pathname.match(/^\/api\/v1\/agent-runtime\/tasks\/([^/]+)\/cancel$/);
  if (task) return handled(await cancel(store, admin, decode(task[1]), body, actor));
  return { handled: false };
}

function agentRuntimeAdmin(store = {}) {
  return store.agentRuntimeAdmin || createAgentRuntimeAdminService({ persistence: store.persistence, clock: store.clock });
}

function agentRuntimeScheduler(store = {}) {
  return store.agentRuntimeScheduler || createAgentRuntimeSchedulerService({ persistence: store.persistence, clock: store.clock });
}

async function call(store, storeMethod, service, serviceMethod, args) {
  if (typeof store?.[storeMethod] === "function") return store[storeMethod](args);
  return service[serviceMethod](args);
}

async function requeue(store, service, deadLetterId, body, actor) {
  const input = { ...commandBody(body, actor), dead_letter_id: deadLetterId };
  if (typeof store?.requeueAgentRuntimeDeadLetter === "function") return store.requeueAgentRuntimeDeadLetter({ input, actor });
  return service.requeueDeadLetter(input);
}

async function cancel(store, service, taskId, body, actor) {
  const input = { ...commandBody(body, actor), task_id: taskId };
  if (typeof store?.cancelAgentRuntimeTask === "function") return store.cancelAgentRuntimeTask({ input, actor });
  return service.cancelTask(input);
}

function commandBody(body, actor = {}) {
  const parsed = parseBody(mutationSchema, body, "INVALID_AGENT_RUNTIME_COMMAND");
  return {
    ...parsed,
    operator_id: parsed.operator_id || actor.email || actor.uid || actor.kind || "front-operator",
  };
}

function queryArgs(query = {}) {
  return {
    lane: query.lane || null,
    status: query.status || null,
    outcome: query.outcome || null,
    task_id: query.task_id || query.taskId || null,
    mission_id: query.mission_id || query.missionId || null,
    task_key_prefix: query.task_key_prefix || query.taskKeyPrefix || null,
    metrics_window_minutes: query.metrics_window_minutes ? Number(query.metrics_window_minutes) : undefined,
    limit: query.limit ? Number(query.limit) : undefined,
  };
}

function parseBody(schema, body, code) {
  const parsed = schema.safeParse(body || {});
  if (parsed.success) return parsed.data;
  const error = new Error(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  error.code = code;
  error.statusCode = 400;
  throw error;
}

function handled(result) {
  return { handled: true, result };
}

function decode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}
