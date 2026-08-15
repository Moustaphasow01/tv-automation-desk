#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { SystemClock } from "../../packages/desk-time/index.js";

const root = resolve(import.meta.dirname, "../..");
const clock = new SystemClock();
const timeoutMs = numberArg("--timeout-ms", Number(process.env.DESK_FRONT_PROBE_TIMEOUT_MS || 12_000));
const baseUrl = stringArg("--base-url", process.env.DESK_FRONT_PROBE_BASE_URL || process.env.DESK_FRONT_API_BASE_URL || "http://127.0.0.1:8080").replace(/\/+$/, "");
const outputPath = stringArg("--output", process.env.DESK_FRONT_PROBE_OUTPUT || "");
const generatedAt = clock.now().utc;
const requiredViews = [
  "command-center",
  "live-trading",
  "portfolio",
  "risk",
  "orders",
  "events-audit",
  "research-lab",
  "strategy-center",
  "jarvis-workspace",
];
const endpoints = [
  { id: "healthz", path: "/healthz", kind: "json_or_text" },
  { id: "readyz", path: "/readyz", kind: "json_or_text" },
  { id: "status", path: "/status", kind: "json" },
  { id: "capabilities", path: "/front-api/v1/capabilities", kind: "json" },
  ...requiredViews.map((view) => ({ id: `view:${view}`, path: `/front-api/v1/views/${view}`, kind: "front_view", view })),
];

const results = [];
for (const endpoint of endpoints) results.push(await probe(endpoint));
const failures = results.filter((item) => !item.ok);
const report = {
  schemaVersion: "front_contract_runtime_probe_v1",
  generatorVersion: "front_contract_probe_v1.0.0",
  generatedAt,
  repositoryBranch: git(["branch", "--show-current"]) || "unknown",
  repositoryCommit: git(["rev-parse", "HEAD"]) || "unknown",
  baseUrl,
  timeoutMs,
  counts: {
    total: results.length,
    ok: results.filter((item) => item.ok).length,
    fail: failures.length,
  },
  results,
};

if (outputPath) await writeFile(resolve(root, outputPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;

async function probe(endpoint) {
  const started = clock.now().epochMs;
  try {
    const response = await fetchWithTimeout(`${baseUrl}${endpoint.path}`);
    const body = await readResponseBody(response);
    const validation = validateEndpoint(endpoint, response, body);
    return {
      id: endpoint.id,
      path: endpoint.path,
      status: response.status,
      ok: response.ok && validation.ok,
      durationMs: clock.now().epochMs - started,
      contentType: response.headers.get("content-type") || "",
      ...validation,
    };
  } catch (error) {
    return {
      id: endpoint.id,
      path: endpoint.path,
      ok: false,
      durationMs: clock.now().epochMs - started,
      error: String(error?.message || error),
    };
  }
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "GET",
      headers: { accept: "application/json,text/event-stream,text/plain;q=0.8" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readResponseBody(response) {
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  if (!/json/i.test(contentType)) return { raw: text.slice(0, 2_000), json: null };
  try {
    return { raw: text.slice(0, 2_000), json: JSON.parse(text) };
  } catch {
    return { raw: text.slice(0, 2_000), json: null, parseError: true };
  }
}

function validateEndpoint(endpoint, response, body) {
  const issues = [];
  if (!response.ok) issues.push(`HTTP_${response.status}`);
  if (endpoint.kind === "json" && !body.json) issues.push("JSON_REQUIRED");
  if (endpoint.kind === "front_view") validateFrontView(body.json, endpoint.view, issues);
  if (endpoint.id === "capabilities") validateCapabilities(body.json, issues);
  if (body.json && secretFindings(body.json).length) issues.push("SECRET_LIKE_FIELD_OR_VALUE");
  if (body.parseError) issues.push("JSON_PARSE_ERROR");
  return {
    ok: issues.length === 0,
    issues,
    schemaVersion: body.json?.schemaVersion || body.json?.meta?.schemaVersion || null,
    source: body.json?.source || body.json?.meta?.source || null,
    asOf: body.json?.asOf || body.json?.meta?.asOf || null,
    revision: body.json?.revision || body.json?.meta?.revision || null,
  };
}

function validateFrontView(json, view, issues) {
  if (!json || typeof json !== "object") {
    issues.push("FRONT_VIEW_JSON_REQUIRED");
    return;
  }
  if (!json.meta || typeof json.meta !== "object") issues.push("FRONT_VIEW_META_REQUIRED");
  if (!Object.prototype.hasOwnProperty.call(json, "data")) issues.push("FRONT_VIEW_DATA_REQUIRED");
  if (!json.permissions || typeof json.permissions !== "object") issues.push("FRONT_VIEW_PERMISSIONS_REQUIRED");
  const actualView = json.meta?.view || json.view || json.viewName;
  if (actualView && actualView !== view) issues.push(`FRONT_VIEW_SCOPE_MISMATCH:${actualView}`);
}

function validateCapabilities(json, issues) {
  if (!json || typeof json !== "object") {
    issues.push("CAPABILITIES_JSON_REQUIRED");
    return;
  }
  if (!Array.isArray(json.capabilities)) issues.push("CAPABILITIES_LIST_REQUIRED");
  if (!Array.isArray(json.actions)) issues.push("ACTIONS_LIST_REQUIRED");
  for (const action of json.actions || []) {
    if (action?.brokerExecution === true) issues.push(`BROKER_ACTION_EXPOSED:${action.commandType || action.actionId || "unknown"}`);
  }
}

function secretFindings(value, path = "$", findings = []) {
  if (findings.length > 20) return findings;
  if (Array.isArray(value)) {
    value.forEach((item, index) => secretFindings(item, `${path}[${index}]`, findings));
    return findings;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && secretValuePattern().test(value)) findings.push(path);
    return findings;
  }
  for (const [key, child] of Object.entries(value)) {
    if (secretKeyPattern().test(key)) findings.push(`${path}.${key}`);
    secretFindings(child, `${path}.${key}`, findings);
  }
  return findings;
}

function secretKeyPattern() {
  return /\b(secret|password|passwd|token|api[_-]?key|private[_-]?key|client[_-]?secret|credential)\b/i;
}

function secretValuePattern() {
  return /(-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|xox[baprs]-|sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,})/;
}

function stringArg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : fallback;
}

function numberArg(name, fallback) {
  const value = Number(stringArg(name, ""));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}
