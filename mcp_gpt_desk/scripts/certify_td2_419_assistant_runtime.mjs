#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { Client } from "pg";
import { SystemClock } from "../../packages/desk-time/index.js";

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
const report = await certifyTd2419AssistantRuntime(args);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.artifactPath) process.stdout.write(`artifact=${report.artifactPath}\n`);
if (!report.ok) process.exitCode = 1;

export async function certifyTd2419AssistantRuntime({
  baseUrl = DEFAULT_BASE_URL,
  pin = process.env.DESK_OPERATOR_ADMIN_PIN || process.env.DESK_OAUTH_ADMIN_PIN || "",
  databaseUrl = process.env.DATABASE_URL || "",
  artifactDir = process.env.DESK_PROOF_DIR || defaultArtifactDir(),
  workerId = `td2-419-assistant-worker-${randomUUID().slice(0, 8)}`,
} = {}) {
  const clock = new SystemClock();
  const checkedAtUtc = clock.now().utc;
  const normalizedBase = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/g, "");
  const checks = [];
  const blockers = [];
  const artifacts = {};
  const push = (id, ok, detail = {}) => {
    checks.push({ id, ok: Boolean(ok), detail });
    if (!ok) blockers.push({ id, detail });
  };

  if (!String(pin || "").trim()) {
    push("operator.pin", false, { reason: "DESK_OPERATOR_ADMIN_PIN or DESK_OAUTH_ADMIN_PIN required." });
    return writeReport({ checkedAtUtc, normalizedBase, checks, blockers, artifacts, artifactDir });
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
  if (!cookie) return writeReport({ checkedAtUtc, normalizedBase, checks, blockers, artifacts, artifactDir });

  const capabilities = await fetchJson(`${normalizedBase}/front-api/v1/capabilities`, {
    headers: { Accept: "application/json", Cookie: cookie },
  });
  const actionTypes = rows(capabilities.body?.actions).map((item) => item.commandType).sort();
  artifacts.capabilities = { status: capabilities.status, actionTypes };
  push("capabilities.assistant_question", capabilities.status === 200 && actionTypes.includes("assistant.question.submit"), {
    status: capabilities.status,
    actionTypes,
  });

  const db = databaseUrl ? await connectDb(databaseUrl, checks, blockers) : null;
  const beforeCounts = db ? await orderSideEffectCounts(db) : null;
  artifacts.sideEffectsBefore = beforeCounts;

  const assistantId = "assistant_platform_ops";
  const suffix = randomUUID().slice(0, 12);
  const idempotencyKey = `td2_419_assistant_question_${suffix}`;
  const correlationId = `corr_td2_419_assistant_question_${suffix}`;
  const question = "TD2-419 VPS proof: fais un diagnostic read-only de la readiness opérateur sans action sensible.";
  const body = {
    commandType: "assistant.question.submit",
    environment: "PAPER",
    reason: "TD2-419 assistant runtime proof: BFF submit, worker answer, SSE delivery, zero broker side effect.",
    payload: {
      assistantId,
      question,
      sourceRefs: ["front-api.capabilities", "desk.status", "desk.doctor"],
      domainSnapshot: {
        proof: "td2-419-vps",
        release: process.env.DESK_RELEASE_VERSION || "unknown",
        authority: "READ_ONLY",
      },
    },
  };

  const first = await postCommand({ baseUrl: normalizedBase, cookie, idempotencyKey, correlationId, body });
  const replay = await postCommand({ baseUrl: normalizedBase, cookie, idempotencyKey, correlationId, body });
  const commandId = first.body?.commandId || "";
  const terminal = commandId
    ? await fetchJson(`${normalizedBase}/front-api/v1/commands/${encodeURIComponent(commandId)}`, { headers: { Accept: "application/json", Cookie: cookie } })
    : { status: 0, body: null };
  const mutation = terminal.body?.result?.mutation_result || first.body?.mutationResult || {};
  const taskId = mutation.assistant_task_id || "";
  const conversationId = mutation.assistant_conversation_id || "";
  artifacts.command = {
    commandId,
    auditId: first.body?.auditId || null,
    taskId,
    conversationId,
    firstStatus: first.status,
    replayStatus: replay.status,
    terminalStatus: terminal.body?.status || null,
    idempotent: replay.body?.idempotent === true,
  };
  push("assistant_command.accepted_terminal", first.status === 200 && first.body?.status === "ACCEPTED" && terminal.status === 200 && terminal.body?.status === "SUCCEEDED", artifacts.command);
  push("assistant_command.idempotent", replay.status === 200 && replay.body?.idempotent === true && replay.body?.commandId === commandId, {
    replayStatus: replay.status,
    sameCommandId: replay.body?.commandId === commandId,
  });
  push("assistant_command.no_broker_authority", mutation.broker_execution === false && mutation.order_submission_enabled === false, {
    broker_execution: mutation.broker_execution,
    order_submission_enabled: mutation.order_submission_enabled,
  });

  const forbiddenLive = await postCommand({
    baseUrl: normalizedBase,
    cookie,
    idempotencyKey: `td2_419_live_denied_${suffix}`,
    correlationId: `corr_td2_419_live_denied_${suffix}`,
    body: { ...body, environment: "LIVE", reason: "TD2-419 forbidden action proof: assistant command cannot run in LIVE." },
  });
  artifacts.forbiddenLive = { status: forbiddenLive.status, error: forbiddenLive.body?.error || null };
  push("assistant_forbidden.live_rejected", forbiddenLive.status === 403, artifacts.forbiddenLive);

  if (db && taskId && conversationId) {
    const submittedPersistence = await assistantPersistenceProof(db, { taskId, conversationId });
    artifacts.submittedPersistence = submittedPersistence;
    push("assistant_persistence.submitted", submittedPersistence.tasks === 1 && submittedPersistence.operatorMessages >= 1 && submittedPersistence.snapshots === 1 && submittedPersistence.runtimeOutbox >= 1, submittedPersistence);
  }

  const worker = await runAssistantWorker({ assistantId, workerId });
  artifacts.worker = worker.public;
  push("assistant_worker.one_shot", worker.ok === true && worker.body?.status === "ANSWER_PERSISTED" && worker.body?.assistant_task_id === taskId, worker.public);

  if (db && taskId && conversationId) {
    const answeredPersistence = await assistantPersistenceProof(db, { taskId, conversationId });
    artifacts.answeredPersistence = answeredPersistence;
    push("assistant_persistence.answer", answeredPersistence.tasksDone === 1 && answeredPersistence.answers === 1 && answeredPersistence.assistantMessages >= 1 && answeredPersistence.frontRealtimeOutbox >= 1, answeredPersistence);

    const view = await fetchJson(`${normalizedBase}/front-api/v1/views/jarvis-workspace`, {
      headers: { Accept: "application/json", Cookie: cookie },
    });
    const conversation = rows(view.body?.data?.conversation);
    artifacts.frontRecovery = {
      status: view.status,
      messages: conversation.length,
      containsAnswer: conversation.some((message) => String(message.text || "").includes(taskId) || String(message.text || "").includes("lecture seule")),
    };
    push("front_reopen.recovered_answer", view.status === 200 && artifacts.frontRecovery.containsAnswer === true, artifacts.frontRecovery);

    const sse = await fetchSseUntil(`${normalizedBase}/front-api/v1/events`, {
      cookie,
      match: (event) => event.eventType === "jarvis.message.created" && event.payload?.taskId === taskId,
      timeoutMs: 8_000,
    });
    artifacts.sse = sse.public;
    push("front_realtime.sse_delivered", sse.ok === true, sse.public);

    const afterCounts = await orderSideEffectCounts(db);
    artifacts.sideEffectsAfter = afterCounts;
    push("order_side_effects.zero_delta", sameCounts(beforeCounts, afterCounts), { before: beforeCounts, after: afterCounts });
    await db.end();
  } else {
    push("database.assistant_runtime", false, { reason: "DATABASE_URL missing or command did not return task/conversation IDs." });
  }

  return writeReport({ checkedAtUtc, normalizedBase, checks, blockers, artifacts, artifactDir });
}

async function runAssistantWorker({ assistantId, workerId }) {
  const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "run_domain_assistant_worker.mjs");
  const child = spawn(process.execPath, [scriptPath, "--once", "--assistant-id", assistantId, "--worker-id", workerId], {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(String(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  const code = await new Promise((resolve) => child.on("close", resolve));
  const raw = stdout.join("").trim().split(/\r?\n/).filter(Boolean).at(-1) || "{}";
  let body = null;
  try { body = JSON.parse(raw); } catch { body = { raw: raw.slice(0, 500) }; }
  return {
    ok: code === 0 && body?.ok === true,
    body,
    public: {
      exitCode: code,
      status: body?.status || null,
      worker_id: body?.worker_id || workerId,
      assistant_task_id: body?.assistant_task_id || null,
      stderr: stderr.join("").slice(0, 500),
    },
  };
}

async function assistantPersistenceProof(db, { taskId, conversationId }) {
  const [tasks, tasksDone, operatorMessages, assistantMessages, snapshots, answers, events, runtimeOutbox, frontRealtimeOutbox] = await Promise.all([
    scalar(db, "SELECT count(*)::int FROM assistant_tasks WHERE assistant_task_id=$1", [taskId]),
    scalar(db, "SELECT count(*)::int FROM assistant_tasks WHERE assistant_task_id=$1 AND status='DONE'", [taskId]),
    scalar(db, "SELECT count(*)::int FROM assistant_messages WHERE assistant_conversation_id=$1 AND role='operator'", [conversationId]),
    scalar(db, "SELECT count(*)::int FROM assistant_messages WHERE assistant_conversation_id=$1 AND role='assistant'", [conversationId]),
    scalar(db, "SELECT count(*)::int FROM assistant_context_snapshots WHERE assistant_conversation_id=$1", [conversationId]),
    scalar(db, "SELECT count(*)::int FROM assistant_answers WHERE assistant_task_id=$1", [taskId]),
    scalar(db, "SELECT count(*)::int FROM assistant_events WHERE assistant_task_id=$1", [taskId]),
    scalar(db, "SELECT count(*)::int FROM assistant_outbox o JOIN assistant_events e ON e.assistant_event_id=o.assistant_event_id WHERE e.assistant_task_id=$1 AND o.channel='ASSISTANT_RUNTIME'", [taskId]),
    scalar(db, "SELECT count(*)::int FROM assistant_outbox o JOIN assistant_events e ON e.assistant_event_id=o.assistant_event_id WHERE e.assistant_task_id=$1 AND o.channel='FRONT_REALTIME'", [taskId]),
  ]);
  return { tasks, tasksDone, operatorMessages, assistantMessages, snapshots, answers, events, runtimeOutbox, frontRealtimeOutbox };
}

async function fetchSseUntil(url, { cookie, match, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let events = 0;
  let matched = null;
  try {
    const response = await fetch(url, { headers: { Accept: "text/event-stream", Cookie: cookie }, signal: controller.signal });
    if (!response.ok || !response.body) return { ok: false, public: { status: response.status, events, matched: false } };
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const dataLine = frame.split(/\r?\n/).find((line) => line.startsWith("data: "));
        if (!dataLine) continue;
        const event = JSON.parse(dataLine.slice(6));
        events += 1;
        if (match(event)) {
          matched = event;
          controller.abort();
          break;
        }
      }
      if (matched) break;
    }
  } catch (error) {
    if (!matched && error?.name !== "AbortError") {
      return { ok: false, public: { status: "ERROR", error: String(error?.message || error).slice(0, 300), events, matched: false } };
    }
  } finally {
    clearTimeout(timer);
  }
  return {
    ok: Boolean(matched),
    public: {
      status: matched ? "DELIVERED" : "TIMEOUT",
      events,
      matched: Boolean(matched),
      eventId: matched?.eventId || null,
      eventType: matched?.eventType || null,
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
      "X-Desk-Environment": body.environment || "PAPER",
    },
    body: JSON.stringify(body),
  });
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  const raw = await response.text();
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = { raw: raw.slice(0, 500) }; }
  return { status: response.status, ok: response.ok, body, headers: response.headers };
}

function cookieFrom(headers) {
  const value = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie().join("; ")
    : headers.get("set-cookie") || "";
  return String(value || "").split(";")[0];
}

async function connectDb(databaseUrl, checks, blockers) {
  const client = new Client({ connectionString: databaseUrl, application_name: "td2-419-assistant-runtime-proof" });
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
  for (const table of ORDER_SIDE_EFFECT_TABLES) counts[table] = await safeCount(db, table);
  return counts;
}

async function safeCount(db, table) {
  try { return Number((await db.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0]?.count ?? 0); }
  catch { return null; }
}

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Number(Object.values(result.rows[0] || {})[0] ?? 0);
}

function sameCounts(left, right) {
  if (!left || !right) return false;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => left[key] === right[key]);
}

async function writeReport({ checkedAtUtc, normalizedBase, checks, blockers, artifacts, artifactDir }) {
  const ok = blockers.length === 0;
  const report = {
    ok,
    status: ok ? "PASSED" : "FAILED",
    td2: "TD2-419",
    checked_at_utc: checkedAtUtc,
    base_url: normalizedBase,
    checks,
    blockers,
    artifacts,
  };
  await mkdir(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, `td2-419-assistant-runtime-vps-${checkedAtUtc.replaceAll(/[-:.]/g, "").slice(0, 15)}Z.json`);
  await writeFile(artifactPath, JSON.stringify(report, null, 2));
  return { ...report, artifactPath };
}

function defaultArtifactDir() {
  return process.platform === "win32"
    ? "C:\\ProgramData\\DeskFutures\\proofs"
    : join(process.cwd(), ".local", "proofs");
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    const normalized = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    parsed[normalized] = inlineValue !== undefined ? inlineValue : argv[index + 1];
    if (inlineValue === undefined) index += 1;
  }
  return parsed;
}

function rows(value) {
  return Array.isArray(value?.items) ? value.items : Array.isArray(value) ? value : [];
}
