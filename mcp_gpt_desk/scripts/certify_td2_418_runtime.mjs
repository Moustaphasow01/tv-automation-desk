#!/usr/bin/env node
import process from "node:process";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { SystemClock } from "../../packages/desk-time/index.js";

import { executeWindowsServiceActuator } from "../src/desk-windows-service-actuator.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:8787";
const ORDER_SIDE_EFFECT_TABLES = Object.freeze([
  "broker_provider_commands",
  "broker_provider_events",
  "broker_execution_outbox",
  "broker_management_outbox",
  "broker_orders",
  "trade_order_intents",
  "portfolio_order_intent_lineage",
]);

const args = parseArgs(process.argv.slice(2));
const report = await certifyTd2418Runtime(args);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;

export async function certifyTd2418Runtime({
  baseUrl = DEFAULT_BASE_URL,
  pin = process.env.DESK_OPERATOR_ADMIN_PIN || process.env.DESK_OAUTH_ADMIN_PIN || "",
  databaseUrl = process.env.DATABASE_URL || "",
  includeWindowsDryRun = true,
} = {}) {
  const checkedAtUtc = new SystemClock().now().utc;
  const normalizedBase = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/g, "");
  const checks = [];
  const artifacts = {};
  const blockers = [];
  const push = (id, ok, detail = {}) => {
    checks.push({ id, ok: Boolean(ok), detail });
    if (!ok) blockers.push({ id, detail });
  };

  if (!String(pin || "").trim()) {
    push("operator.pin", false, { reason: "DESK_OPERATOR_ADMIN_PIN or DESK_OAUTH_ADMIN_PIN required in process environment." });
    return finalReport({ checkedAtUtc, normalizedBase, checks, blockers, artifacts });
  }
  push("operator.pin", true, { source: "process_environment", value_redacted: true });

  const login = await fetchJson(`${normalizedBase}/api/v1/auth/operator/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ pin }),
  });
  const cookie = cookieFrom(login.headers);
  push("operator.login", login.status === 200 && login.body?.authenticated === true && Boolean(cookie), {
    status: login.status,
    authenticated: login.body?.authenticated === true,
    has_cookie: Boolean(cookie),
  });
  if (!cookie) return finalReport({ checkedAtUtc, normalizedBase, checks, blockers, artifacts });

  const capabilities = await fetchJson(`${normalizedBase}/front-api/v1/capabilities`, {
    headers: { Accept: "application/json", Cookie: cookie },
  });
  const actionTypes = rows(capabilities.body?.actions).map((item) => item.commandType).sort();
  artifacts.capabilities = { status: capabilities.status, actionTypes };
  const expectedActions = ["desk.doctor", "desk.restart", "desk.start", "desk.status", "desk.stop"];
  push("capabilities.desk_actions", capabilities.status === 200 && expectedActions.every((action) => actionTypes.includes(action)), {
    status: capabilities.status,
    expectedActions,
    actionTypes,
  });

  const db = databaseUrl ? await connectDb(databaseUrl, checks, blockers) : null;
  const beforeCounts = db ? await orderSideEffectCounts(db) : null;
  artifacts.sideEffectsBefore = beforeCounts;

  const commandResults = [];
  for (const commandType of ["desk.status", "desk.doctor", "desk.start", "desk.stop", "desk.restart"]) {
    const commandProof = await executeAuditedCommand({ baseUrl: normalizedBase, cookie, commandType });
    commandResults.push(commandProof);
    push(`${commandType}.accepted_terminal`, commandProof.accepted && commandProof.terminal, commandProof.publicDetail);
    push(`${commandType}.idempotent`, commandProof.idempotent, commandProof.idempotentDetail);
  }
  artifacts.commands = commandResults.map(redactCommandProof);

  for (const controlCommand of ["desk.start", "desk.stop", "desk.restart"]) {
    const result = commandResults.find((item) => item.commandType === controlCommand);
    const planOnly = result?.terminalBody?.result?.mutation_result?.plan?.outcome === "PLAN_ONLY_FAIL_CLOSED"
      && result?.terminalBody?.result?.mutation_result?.broker_execution === false
      && result?.terminalBody?.result?.mutation_result?.live_execution === false
      && result?.terminalBody?.result?.mutation_result?.auto_execution === false;
    push(`${controlCommand}.plan_only_fail_closed`, planOnly, {
      outcome: result?.terminalBody?.result?.mutation_result?.plan?.outcome || null,
      broker_execution: result?.terminalBody?.result?.mutation_result?.broker_execution ?? null,
      live_execution: result?.terminalBody?.result?.mutation_result?.live_execution ?? null,
      auto_execution: result?.terminalBody?.result?.mutation_result?.auto_execution ?? null,
    });
  }

  if (db) {
    const persisted = await commandPersistenceProof(db, commandResults);
    artifacts.persistence = persisted;
    push("commands.persistence", persisted.commands === commandResults.length && persisted.audits === commandResults.length && persisted.events === commandResults.length, persisted);
    const afterCounts = await orderSideEffectCounts(db);
    artifacts.sideEffectsAfter = afterCounts;
    const unchanged = sameCounts(beforeCounts, afterCounts);
    push("order_side_effects.zero_delta", unchanged, { before: beforeCounts, after: afterCounts });
    await db.end();
  } else {
    push("database.runtime_counts", false, { reason: "DATABASE_URL missing; cannot prove persistence/audit/provider counters." });
  }

  if (includeWindowsDryRun) {
    const dryRun = await runWindowsDryRunProof();
    artifacts.windowsActuatorDryRun = dryRun;
    push("windows_actuator.dry_run", dryRun.ok === true && dryRun.mutated === false, dryRun.publicDetail);
  }

  return finalReport({ checkedAtUtc, normalizedBase, checks, blockers, artifacts });
}

async function executeAuditedCommand({ baseUrl, cookie, commandType }) {
  const suffix = randomUUID().slice(0, 12);
  const idempotencyKey = `td2_418_${commandType.replaceAll(".", "_")}_${suffix}`;
  const correlationId = `corr_td2_418_${commandType.replaceAll(".", "_")}_${suffix}`;
  const body = {
    commandType,
    environment: "PAPER",
    payload: { proof: "td2-418-runtime", commandType },
    reason: "TD2-418 runtime proof: audited command, no broker/provider side effect.",
  };
  const first = await postCommand({ baseUrl, cookie, idempotencyKey, correlationId, body });
  const replay = await postCommand({ baseUrl, cookie, idempotencyKey, correlationId, body });
  const commandId = first.body?.commandId || "";
  const terminalResponse = commandId
    ? await fetchJson(`${baseUrl}/front-api/v1/commands/${encodeURIComponent(commandId)}`, { headers: { Accept: "application/json", Cookie: cookie } })
    : { status: 0, body: null };
  return {
    commandType,
    commandId,
    auditId: first.body?.auditId || terminalResponse.body?.auditId || "",
    accepted: first.status === 200 && first.body?.status === "ACCEPTED" && first.body?.persisted === true,
    terminal: terminalResponse.status === 200 && terminalResponse.body?.status === "SUCCEEDED",
    idempotent: replay.status === 200 && replay.body?.idempotent === true && replay.body?.commandId === commandId,
    terminalBody: terminalResponse.body,
    publicDetail: {
      firstStatus: first.status,
      commandId,
      receiptStatus: first.body?.status || null,
      terminalStatus: terminalResponse.body?.status || null,
      persisted: first.body?.persisted === true,
      auditId: first.body?.auditId || null,
    },
    idempotentDetail: {
      replayStatus: replay.status,
      idempotent: replay.body?.idempotent === true,
      sameCommandId: replay.body?.commandId === commandId,
    },
  };
}

async function postCommand({ baseUrl, cookie, idempotencyKey, correlationId, body }) {
  return fetchJson(`${baseUrl}/front-api/v1/commands`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Cookie: cookie,
      "Idempotency-Key": idempotencyKey,
      "X-Correlation-ID": correlationId,
      "X-Desk-Environment": "PAPER",
    },
    body: JSON.stringify(body),
  });
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = { raw: raw.slice(0, 500) };
  }
  return { status: response.status, ok: response.ok, body, headers: response.headers };
}

function cookieFrom(headers) {
  const value = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie().join("; ")
    : headers.get("set-cookie") || "";
  return String(value || "").split(";")[0];
}

async function connectDb(databaseUrl, checks, blockers) {
  const client = new Client({ connectionString: databaseUrl, application_name: "td2-418-runtime-proof" });
  try {
    await client.connect();
    checks.push({ id: "database.connect", ok: true, detail: { connected: true } });
    return client;
  } catch (error) {
    const detail = { reason: String(error?.message || error).slice(0, 300) };
    checks.push({ id: "database.connect", ok: false, detail });
    blockers.push({ id: "database.connect", detail });
    return null;
  }
}

async function orderSideEffectCounts(db) {
  const counts = {};
  for (const table of ORDER_SIDE_EFFECT_TABLES) {
    counts[table] = await safeCount(db, table);
  }
  return counts;
}

async function safeCount(db, table) {
  try {
    const result = await db.query(`SELECT count(*)::int AS count FROM ${table}`);
    return result.rows[0]?.count ?? null;
  } catch {
    return null;
  }
}

async function commandPersistenceProof(db, commandResults) {
  const commandIds = commandResults.map((item) => item.commandId).filter(Boolean);
  const auditIds = commandResults.map((item) => item.auditId).filter(Boolean);
  const eventIds = commandIds.map((id) => `${id}_accepted`);
  const commands = await countDeskDocuments(db, "dashboard_commands", commandIds);
  const audits = await countDeskDocuments(db, "desk_audit_logs", auditIds);
  const events = await countDeskDocuments(db, "dashboard_command_events", eventIds);
  return { commands, audits, events, commandIds, auditIds, eventIds };
}

async function countDeskDocuments(db, collection, ids) {
  if (!ids.length) return 0;
  const result = await db.query(
    "SELECT count(*)::int AS count FROM desk_documents WHERE collection = $1 AND document_id = ANY($2::text[])",
    [collection, ids],
  );
  return result.rows[0]?.count ?? 0;
}

function sameCounts(before, after) {
  if (!before || !after) return false;
  return Object.keys(before).every((key) => before[key] === after[key]);
}

async function runWindowsDryRunProof() {
  try {
    const result = await executeWindowsServiceActuator({ action: "restart", dryRun: true });
    return {
      ok: result.ok === true,
      mutated: result.operations.some((item) => item.mutated === true),
      publicDetail: {
        status: result.status,
        dry_run: result.dry_run,
        service_count: result.plan.allowlist.length,
        operation_count: result.operations.length,
        missing_services: result.validation.missing_services,
        broker_execution: result.broker_execution,
        live_execution: result.live_execution,
        auto_execution: result.auto_execution,
      },
    };
  } catch (error) {
    return {
      ok: false,
      mutated: false,
      publicDetail: { error: String(error?.message || error).slice(0, 300) },
    };
  }
}

function redactCommandProof(item) {
  return {
    commandType: item.commandType,
    commandId: item.commandId,
    auditId: item.auditId,
    accepted: item.accepted,
    terminal: item.terminal,
    idempotent: item.idempotent,
    mutationStatus: item.terminalBody?.result?.mutation_result?.status || null,
    mutationOutcome: item.terminalBody?.result?.mutation_result?.plan?.outcome || null,
  };
}

function rows(value) {
  return Array.isArray(value?.items) ? value.items : Array.isArray(value) ? value : [];
}

function finalReport({ checkedAtUtc, normalizedBase, checks, blockers, artifacts }) {
  return {
    schema: "td2_418_runtime_certification_v1",
    ok: blockers.length === 0,
    status: blockers.length === 0 ? "PASSED" : "FAILED",
    checked_at_utc: checkedAtUtc,
    base_url: normalizedBase,
    checks,
    blockers,
    artifacts,
    safety: {
      secrets_redacted: true,
      broker_provider_side_effect_expected: "ZERO",
      live_auto_execution_expected: "DISABLED",
    },
  };
}

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.DESK_TD2_418_BASE_URL || DEFAULT_BASE_URL,
    includeWindowsDryRun: true,
  };
  for (const arg of argv) {
    if (arg.startsWith("--base-url=")) options.baseUrl = arg.slice("--base-url=".length);
    else if (arg === "--skip-windows-dry-run") options.includeWindowsDryRun = false;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write("Usage: node scripts/certify_td2_418_runtime.mjs [--base-url=http://127.0.0.1:8787] [--skip-windows-dry-run]\n");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}
