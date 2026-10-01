import http from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { OosPortal } from "@tv-automation/desk-oos-batch";
import { createOosMcpServer } from "./oos-mcp-server.js";
import { OosOAuth } from "./oos-oauth.js";
import { handleOosHttp, isOosPath } from "./front-oos-batch.js";
import { sendJson, readJsonBody } from "./oos-http-io.js";

export function createOosHttpServer({ runtime, pool, config, log = console.log }) {
  runtime.allowedActions = config.replay_enabled === true ? ["capture", "retry-capture", "replay", "retry"] : ["capture", "retry-capture"];
  runtime.technicalSmokeDates = config.technical_smoke_dates || [];
  const auth = new OosOAuth({ baseUrl: config.public_url, pool, operatorToken: process.env.OOS_OPERATOR_TOKEN,
    clientsDirectory: config.archive_root ? path.join(config.archive_root, "auth", "oauth-clients") : undefined });
  const portal = new OosPortal({ runtime, batchId: config.batch_id, symbol: config.symbol, cutoffTime: config.cutoff_time });
  const server = http.createServer(async (req, res) => {
    const start = Date.now();
    const correlationId = randomUUID(); res.setHeader("x-request-id", correlationId);
    const endpoint = new URL(req.url, config.public_url).pathname;
    const stage = /^\/oos\/oauth\/(authorize|token|register)$/.exec(endpoint)?.[1] || (endpoint === "/oos/mcp" ? "resource" : "http");
    let errorCode, errorField;
    res.on("finish", () => log(JSON.stringify({ event: "oos.http", correlation_id: correlationId, stage,
      method: req.method, status: res.statusCode, error: errorCode, error_field: errorField, duration_ms: Date.now() - start })));
    try { await route({ req, res, runtime, pool, config, auth, portal }); }
    catch (error) {
      errorCode = /^[A-Za-z0-9_]{1,80}$/.test(error.code || "") ? error.code : "server_error";
      errorField = ["redirect_uri", "code_challenge", "code_verifier"].includes(error.field) ? error.field
        : ({ invalid_scope: "scope", invalid_target: "resource", invalid_client: "client_id", invalid_redirect_uri: "redirect_uri" })[errorCode];
      if (!res.headersSent) sendRequestError({ req, res, error, auth });
      else res.end();
    }
  });
  server.requestTimeout = 180000; server.headersTimeout = 15000;
  return server;
}

async function route(context) {
  const { req, res, pool, config, auth } = context;
  const url = new URL(req.url, config.public_url);
  const pathname = url.pathname.replace(/^\/oos(?=\/|$)/, "") || "/";
  if (req.method === "GET" && ["/health", "/healthz"].includes(pathname)) {
    await pool.query("SELECT 1");
    sendJson(res, 200, { ok: true, service: "Desk OOS", postgres: "ready", version: config.release || "unknown",
      syntax_validator_configured: !!config.syntax_validator, tradingview_configured: !!config.tradingview,
      replay_enabled: config.replay_enabled === true }); return;
  }
  const metadataPath = pathname
    .replace(/^(\/\.well-known\/oauth-protected-resource)(?:\/oos(?:\/mcp)?|\/mcp)$/, "$1")
    .replace(/^(\/\.well-known\/oauth-authorization-server)\/oos$/, "$1");
  if (await auth.route(req, res, metadataPath, Object.fromEntries(url.searchParams))) return;
  const identity = auth.authenticate(req);
  if (pathname === "/mcp") {
    // Browser session cookies are never an MCP credential.
    if (!identity || identity.kind === "oos_session") {
      sendJson(res, 401, { error: "OOS_AUTH_REQUIRED" }, { "www-authenticate": auth.challenge() }); return;
    }
    await mcp({ ...context, identity }); return;
  }
  if (!identity) {
    if (pathname === "/") { res.writeHead(303, { location: "/oos/login" }); res.end(); return; }
    sendJson(res, 401, { code: "OOS_AUTH_REQUIRED" }); return;
  }
  if (isOosPath(pathname)) { await front({ ...context, pathname, identity, url }); return; }
  await serveUi(req, res, config.front_root, pathname);
}

function sendRequestError({ req, res, error, auth }) {
  const pathname = new URL(req.url, auth.baseUrl).pathname;
  if (pathname === "/oos/mcp" && error.code === "invalid_token") {
    sendJson(res, 401, { error: "invalid_token" }, { "www-authenticate": auth.challenge(error) }); return;
  }
  if (pathname.startsWith("/oos/oauth/")) {
    sendJson(res, error.status || 400, { error: error.code || "server_error",
      ...(pathname === "/oos/oauth/authorize" ? { iss: auth.baseUrl } : {}) }); return;
  }
  sendJson(res, error.status || error.statusCode || 400, { ok: false, code: error.code || "OOS_REQUEST_FAILED" });
}

async function mcp({ req, res, portal, runtime, identity, config }) {
  if (req.method !== "POST") { res.writeHead(405, { allow: "POST" }); res.end(); return; }
  const body = await readJsonBody(req);
  if (body?.method === "tools/call" && body.params?.name === "request_replay" && config.replay_enabled !== true) {
    sendJson(res, 200, { jsonrpc: "2.0", id: body.id, result: { isError: true,
      content: [{ type: "text", text: '{"code":"OOS_REPLAY_DISABLED"}' }] } }); return;
  }
  const server = createOosMcpServer({ portal, probe: runtime.probe, contracts: runtime.contracts, auth: identity });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => { void transport.close(); void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

async function front(context) {
  const { req, res, config, runtime, identity, pathname, url } = context;
  if (req.method === "POST" && req.headers.origin !== new URL(config.public_url).origin && identity.kind === "oos_session") {
    sendJson(res, 403, { code: "OOS_ORIGIN_REQUIRED" }); return;
  }
  const readCommand = async (request, limit) => {
    const body = await readJsonBody(request, limit);
    const preparation = ["/front-api/v1/oos-batch/prepare-premarket", "/front-api/v1/oos-batch/prepare-range"].includes(pathname);
    if (!preparation && config.replay_enabled !== true && !["capture", "retry-capture"].includes(body.action)) {
      throw Object.assign(new Error("OOS_CAPTURE_ONLY"), { code: "OOS_CAPTURE_ONLY", statusCode: 403 });
    }
    return body;
  };
  await handleOosHttp({ req, res, pathname, query: Object.fromEntries(url.searchParams), auth: identity,
    store: {}, sendJson, readJsonBody: readCommand }, async () => runtime);
}

async function serveUi(req, res, root, pathname) {
  if (req.method !== "GET") { res.writeHead(405); res.end(); return; }
  const name = pathname === "/" ? "oos.html" : pathname.replace(/^\//, "");
  if (!/^(?:oos\.html|assets\/[A-Za-z0-9_.-]+)$/.test(name)) { sendJson(res, 404, { code: "NOT_FOUND" }); return; }
  const bytes = await readFile(path.join(root, name));
  const mime = name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html; charset=utf-8";
  res.writeHead(200, { "content-type": mime, "x-content-type-options": "nosniff", "cache-control": "private, no-store" }); res.end(bytes);
}
