import { projectDay, aggregateBatch } from "@tv-automation/desk-oos-batch";
import { getOosRuntime } from "./oos-runtime.js";

const PREFIX = "/front-api/v1/oos-batch/";
const READS = new Set(["days", "day", "artifact", "command"]);
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { code, statusCode });
export const isOosPath = pathname => pathname.startsWith(PREFIX);
export const isOosWrite = (pathname, method) => pathname === `${PREFIX}commands` && method === "POST";
export const isOosMethod = (pathname, method) => isOosWrite(pathname, method) || (method === "GET" && READS.has(pathname.slice(PREFIX.length)));

export function requireOosAuth(auth, write) {
  if (!auth?.ok || ["anonymous", "rest_read"].includes(auth.kind) || !auth.kind) throw fail("OOS_AUTH_REQUIRED", 401);
  if (!auth.scopes?.includes(write ? "desk.write" : "desk.read")) throw fail("OOS_SCOPE_REQUIRED", 403);
}

export async function handleOosHttp(context, runtimeProvider = getOosRuntime) {
  const { req, res, pathname, query = {}, auth, store, sendJson, readJsonBody, corsHeaders = {} } = context;
  if (!isOosMethod(pathname, req.method)) throw fail("METHOD_NOT_ALLOWED", 405);
  const write = isOosWrite(pathname, req.method);
  requireOosAuth(auth, write);
  const runtime = await runtimeProvider(store);
  const headers = { ...corsHeaders, "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
  try {
    if (write) {
      const body = await readJsonBody(req, 16000);
      return sendJson(res, 202, await runtime.commands.enqueue(body, body.command_id), headers);
    }
    if (pathname.endsWith("/artifact")) {
      const { bytes, mime } = await readArtifact(runtime, query);
      res.writeHead(200, { ...headers, "content-type": mime, "content-length": bytes.length }); res.end(bytes); return;
    }
    const data = await readView(runtime, pathname.slice(PREFIX.length), query);
    sendJson(res, 200, { ...data, can_write: auth.scopes.includes("desk.write") }, headers);
  } catch (error) {
    const code = error.code || "OOS_REQUEST_FAILED";
    const status = code === "ENOENT" || code.endsWith("NOT_FOUND") ? 404 : code.endsWith("CONFLICT") || code === "OOS_BUSY" ? 409 : error.statusCode || 400;
    sendJson(res, status, { ok: false, code, message: code }, headers);
  }
}

async function readView(runtime, view, query) {
  if (view === "command") {
    return runtime.commands.get(query.command_id);
  }
  if (view === "days") {
    const rows = await runtime.repository.list(query.batch_id);
    return { days: rows.map(projectDay), stats: aggregateBatch(rows), observed_at: new Date().toISOString() };
  }
  const row = await runtime.repository.get({ batch_id: query.batch_id, date: query.date });
  const artifacts = await artifactIndex(runtime, row.definition);
  const plan = artifacts.includes("plan/PLAN_SMC3.txt") ? (await runtime.archive.read(row.definition, "plan/PLAN_SMC3.txt")).toString("utf8") : null;
  return { day: projectDay(row), artifacts, plan_text: plan, timeline: await runtime.repository.timeline(row.definition) };
}

async function artifactIndex(runtime, day) {
  const manifest = await runtime.archive.optionalJson(day, "premarket/manifest.json");
  const plan = await runtime.archive.optionalJson(day, "plan/plan_meta.json");
  const result = await runtime.archive.optionalJson(day, "replay/run_meta.json");
  return [...(manifest ? ["premarket/manifest.json", ...manifest.captures.map(item => `premarket/${item.path}`)] : []),
    ...(plan ? ["plan/PLAN_SMC3.txt", "plan/plan_meta.json"] : []),
    ...(result ? ["replay/run_meta.json", ...result.artifacts.map(item => item.path)] : [])];
}

async function readArtifact(runtime, query) {
  const row = await runtime.repository.get({ batch_id: query.batch_id, date: query.date });
  const allowed = await artifactIndex(runtime, row.definition);
  if (!allowed.includes(query.name)) throw fail("ARTIFACT_NOT_FOUND", 404);
  const bytes = await runtime.archive.read(row.definition, query.name);
  return { bytes, mime: query.name.endsWith(".png") ? "image/png" : query.name.endsWith(".json") ? "application/json" : "text/plain; charset=utf-8" };
}
