#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { SystemClock } from "../../packages/desk-time/index.js";

import { isCliEntrypoint } from "../runtime/cli-entrypoint.mjs";

const DEFAULT_BASE_URL = "http://127.0.0.1:8090";

export function parseVNextOperatorE2EArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    baseUrl: env.DESK_VNEXT_BASE_URL || DEFAULT_BASE_URL,
    pin: env.DESK_OPERATOR_ADMIN_PIN || env.DESK_OAUTH_ADMIN_PIN || "",
    output: "pretty",
    exitZero: false,
  };

  for (const arg of argv) {
    if (arg === "--json") {
      options.output = "json";
    } else if (arg === "--exit-zero") {
      options.exitZero = true;
    } else if (arg.startsWith("--base-url=")) {
      options.baseUrl = arg.slice("--base-url=".length);
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export async function runVNextOperatorE2E({ baseUrl = DEFAULT_BASE_URL, pin = "", fetchImpl = fetch } = {}) {
  const checkedAt = new SystemClock().now().utc;
  const normalizedBaseUrl = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/g, "");
  const checks = [];
  const blockers = [];
  const pushCheck = (id, ok, detail = null) => {
    const check = { id, ok: Boolean(ok), detail };
    checks.push(check);
    if (!ok) blockers.push({ id, detail });
    return check.ok;
  };

  if (!String(pin || "").trim()) {
    pushCheck("operator.pin_configured", false, "DESK_OPERATOR_ADMIN_PIN or DESK_OAUTH_ADMIN_PIN is required in the caller environment.");
    return result({ checkedAt, baseUrl: normalizedBaseUrl, checks, blockers });
  }
  pushCheck("operator.pin_configured", true, "PIN read from environment; value intentionally not displayed.");

  let cookieHeader = "";
  try {
    const login = await fetchJson(fetchImpl, `${normalizedBaseUrl}/api/v1/auth/operator/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ pin }),
    });
    cookieHeader = cookieFromHeaders(login.headers);
    pushCheck("operator.login", login.status === 200 && login.body?.ok === true && login.body?.authenticated === true, {
      status: login.status,
      authenticated: login.body?.authenticated === true,
      has_cookie: Boolean(cookieHeader),
      has_expiry: Boolean(login.body?.expires_at),
    });
    pushCheck("operator.cookie_path_front_api", /(?:^|;\s*)Path=\//i.test(String(login.setCookie || "")), {
      has_set_cookie: Boolean(login.setCookie),
      path_root: /(?:^|;\s*)Path=\//i.test(String(login.setCookie || "")),
      http_only: /HttpOnly/i.test(String(login.setCookie || "")),
    });
  } catch (error) {
    pushCheck("operator.login", false, error.message || String(error));
    return result({ checkedAt, baseUrl: normalizedBaseUrl, checks, blockers });
  }

  try {
    const auth = await fetchJson(fetchImpl, `${normalizedBaseUrl}/front-api/v1/views/auth-session`, {
      headers: { Accept: "application/json", Cookie: cookieHeader },
    });
    const data = auth.body?.data || {};
    const frontCommand = Array.isArray(data.permissions)
      ? data.permissions.find((permission) => permission?.capability === "front.command")
      : null;
    pushCheck("operator.auth_projection_active", auth.status === 200
      && data.summary?.authenticated === true
      && data.summary?.readOnly === false
      && frontCommand?.decision === "ALLOW", {
      status: auth.status,
      authenticated: data.summary?.authenticated === true,
      read_only: data.summary?.readOnly === true,
      front_command: frontCommand?.decision || null,
    });
  } catch (error) {
    pushCheck("operator.auth_projection_active", false, error.message || String(error));
    return result({ checkedAt, baseUrl: normalizedBaseUrl, checks, blockers });
  }

  const suffix = randomUUID().slice(0, 12);
  const idempotencyKey = `idem_vnext_operator_e2e_${suffix}`;
  const correlationId = `corr_vnext_operator_e2e_${suffix}`;
  const commandBody = {
    commandType: "control_plane.verify",
    environment: "PAPER",
    payload: { probeId: `e2e-${suffix}` },
    reason: "Automated VNext operator E2E smoke: persisted control-plane verification.",
  };

  try {
    const first = await postCommand(fetchImpl, normalizedBaseUrl, cookieHeader, idempotencyKey, correlationId, commandBody);
    pushCheck("operator.command_accepted_persisted", first.status === 200
      && first.body?.status === "ACCEPTED"
      && first.body?.persisted === true
      && first.body?.commandId, {
      status: first.status,
      command_status: first.body?.status || null,
      persisted: first.body?.persisted === true,
      idempotent: first.body?.idempotent === true,
      has_audit_id: Boolean(first.body?.auditId),
    });

    const replay = await postCommand(fetchImpl, normalizedBaseUrl, cookieHeader, idempotencyKey, correlationId, commandBody);
    pushCheck("operator.command_idempotent_replay", replay.status === 200
      && replay.body?.status === "ACCEPTED"
      && replay.body?.persisted === true
      && replay.body?.idempotent === true
      && replay.body?.commandId === first.body?.commandId, {
      status: replay.status,
      command_status: replay.body?.status || null,
      persisted: replay.body?.persisted === true,
      idempotent: replay.body?.idempotent === true,
      same_command_id: replay.body?.commandId === first.body?.commandId,
    });

    const terminal = await fetchJson(fetchImpl, `${normalizedBaseUrl}/front-api/v1/commands/${encodeURIComponent(first.body?.commandId || "")}`, {
      headers: { Accept: "application/json", Cookie: cookieHeader },
    });
    pushCheck("operator.command_terminal_audited", terminal.status === 200
      && terminal.body?.status === "SUCCEEDED"
      && terminal.body?.commandId === first.body?.commandId
      && Boolean(terminal.body?.auditId), {
      status: terminal.status,
      command_status: terminal.body?.status || null,
      same_command_id: terminal.body?.commandId === first.body?.commandId,
      has_audit_id: Boolean(terminal.body?.auditId),
    });
  } catch (error) {
    pushCheck("operator.command_accepted_persisted", false, error.message || String(error));
  }

  return result({ checkedAt, baseUrl: normalizedBaseUrl, checks, blockers });
}

function result({ checkedAt, baseUrl, checks, blockers }) {
  return {
    ok: blockers.length === 0,
    status: blockers.length === 0 ? "READY" : "BLOCKED",
    checked_at_utc: checkedAt,
    base_url: baseUrl,
    checks,
    blockers,
  };
}

async function postCommand(fetchImpl, baseUrl, cookieHeader, idempotencyKey, correlationId, body) {
  return fetchJson(fetchImpl, `${baseUrl}/front-api/v1/commands`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Cookie: cookieHeader,
      "Idempotency-Key": idempotencyKey,
      "X-Correlation-ID": correlationId,
      "X-Desk-Environment": "PAPER",
    },
    body: JSON.stringify(body),
  });
}

async function fetchJson(fetchImpl, url, init = {}) {
  const response = await fetchImpl(url, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return {
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    setCookie: getSetCookie(response.headers),
    body,
  };
}

function cookieFromHeaders(headers) {
  const setCookie = getSetCookie(headers);
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return String(first || "").split(";")[0];
}

function getSetCookie(headers) {
  if (typeof headers?.getSetCookie === "function") {
    return headers.getSetCookie().join("; ");
  }
  return headers?.get?.("set-cookie") || "";
}

function printPretty(result) {
  const icon = result.ok ? "OK" : "BLOCKED";
  console.log(`VNext operator E2E: ${icon}`);
  for (const check of result.checks) {
    console.log(`- ${check.ok ? "OK" : "FAIL"} ${check.id}`);
  }
  if (result.blockers.length) {
    console.log("Blockers:");
    for (const blocker of result.blockers) console.log(`- ${blocker.id}`);
  }
}

async function main() {
  const options = parseVNextOperatorE2EArgs();
  if (options.help) {
    console.log("Usage: node scripts/stack/check_vnext_operator_e2e.mjs [--base-url=http://127.0.0.1:8090] [--json] [--exit-zero]");
    return;
  }
  const e2e = await runVNextOperatorE2E(options);
  if (options.output === "json") {
    console.log(JSON.stringify(e2e, null, 2));
  } else {
    printPretty(e2e);
  }
  if (!e2e.ok && !options.exitZero) process.exitCode = 1;
}

if (isCliEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message || String(error));
    process.exitCode = 1;
  });
}
