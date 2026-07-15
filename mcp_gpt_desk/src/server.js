import { randomUUID } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ErrorCode, isInitializeRequest, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  authorizationServerMetadata,
  buildWwwAuthenticate,
  createAuthorizationRedirect,
  createOAuthClientRegistration,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  hasScopes,
  OAuthError,
  protectedResourceMetadata,
  renderAuthorizePage,
  validateDeskPin,
  verifyOAuthAccessToken,
} from "./oauth.js";
import { toolResult } from "./result.js";
import { frontApiCacheControl, frontApiEtag, requestMatchesEtag } from "./front-api-cache.js";
import {
  frontDetailCacheSeconds,
  isFrontDetailPath,
  loadFrontDetailResource,
} from "./front-api-details.js";
import { FRONT_OPENAPI_PATH, frontApiOpenApiDocument } from "./front-api-openapi.js";
import {
  executeFrontOperatorCommand,
  FRONT_OPERATOR_COMMANDS_PATH,
  FRONT_OPERATOR_STATE_PATH,
  loadFrontOperatorState,
} from "./front-operator-commands.js";
import {
  FRONT_RESOURCE_CACHE_SECONDS,
  FRONT_RESOURCE_PATHS,
  loadFrontApiResource,
} from "./front-api-resources.js";
import { loadFrontDeskSession, normalizeFrontApiScope, sessionSummary } from "./front-session-projection.js";
import { createDeskStoreFromEnv } from "./store.js";
import { callDeskTool, createDeskToolRegistry, getToolRequiredScopes, listDeskTools } from "./tools.js";

const PORT = Number(process.env.PORT || process.env.DESK_GPT_MCP_PORT || 8787);
const SERVICE_ROLE = normalizeServiceRole(process.env.DESK_SERVICE_ROLE);
const FRONT_API_ENABLED = SERVICE_ROLE !== "mcp";
const MCP_API_ENABLED = SERVICE_ROLE !== "front";
const API_KEY = process.env.DESK_MCP_API_KEY || process.env.DESK_GPT_MCP_API_KEY || "";
const REST_ALLOWED_ORIGINS = parseAllowedOrigins(process.env.DESK_REST_ALLOWED_ORIGINS);
const MCP_ONLY_GPT_WRITE_TOOLS = new Set([
  "claim_next_desk_work",
  "claim_next_live",
  "claim_next_replay",
  "get_desk_work_item",
  "heartbeat_live",
  "complete_live",
  "fail_live",
  "heartbeat_replay",
  "complete_replay",
  "fail_replay",
  "heartbeat_desk_work",
  "complete_desk_work",
  "fail_desk_work",
  "upsert_replay_autopilot_config",
  "start_or_resume_replay_autopilot",
  "save_master_analysis",
  "save_manual_monitor",
  "save_replay_master_analysis",
  "save_replay_monitor",
]);
const store = createDeskStoreFromEnv();
const deskTools = createDeskToolRegistry(store);
const sessions = new Map();

function createServer(authRef) {
  const server = new Server(
    {
      name: "tv-automation-desk-mcp",
      version: "0.1.1",
    },
    {
      capabilities: {
        logging: {},
        tools: { listChanged: true },
      },
      instructions: `Desk Futures MCP.

The normal LIVE scheduled worker has one entry point: call claim_next_desk_work with worker_id. The backend automatically selects the current Paris LIVE session, claims only the fresh cursor checkpoint, and falls back to the next sequential REPLAY step when no LIVE work is due. Then use the returned handle with heartbeat_desk_work, complete_desk_work, or fail_desk_work. The specialized *_live and *_replay tools remain available for diagnostics and explicit recovery only. If a claim returns NO_WORK, stop cleanly without inventing work.
For GPT replay autopilot scheduled tasks, first call start_or_resume_replay_autopilot with config_id or mode=latest_ready_config. This tool may create/resume the configured replay and drive deterministic backend transitions, but it never writes GPT analysis. If it returns WAITING_GPT, claim exactly one REPLAY work item with claim_next_desk_work using the returned gpt_claim args, perform that one analysis, save through the declared replay save tool, complete_desk_work, optionally drive_replay_automation once, then stop. If it returns CONFIG_MISSING, CONFIG_DISABLED, WORK_BUSY, WORK_FAILED_REQUIRES_OPERATOR or TERMINAL, stop and report that status.
The scheduled claim cadence is hourly. For LIVE, the latest closed M15 checkpoint is only the freshness anchor: analyze the session, the delta since the prior materialized output, the last hour and the four-hour context; prefer H4/H1-led intraday setups over micro-scalping.

For a vNext Master/Monitor workflow, first call get_active_contracts with view=summary, then read only the relevant full contract version with get_contract.
For replay, read get_replay_master_bundle or get_replay_monitor_bundle with view=compact and include_raw_refs=false. Use get_replay_bundle_manifest, get_replay_bundle_section, or get_replay_snapshot only for evidence that needs deeper inspection.
For every live or replay data-readiness decision, only availability=missing_unexpected is a source failure. stale_market_closed and not_yet_open are expected market-session states: use last_known for context only and never turn them into DATA_NOT_READY by themselves.
Before every live or replay save, verify the immutable source pack covers the exact cutoff/checkpoint. A tech gap is not applicable before a current-session quote exists, and cash VIX is not a mandatory fresh confirmation while its market is closed.
For live M15 and replan workflows, use the active live_rolling pack build returned by the bundle. Never reuse the initial decision-cutoff build for a later checkpoint, and preserve bundle.save_target.suggested_payload including run_id, as_of_utc and pack_build_id.
Treat a bundle response budget fallback as a request for scoped deep reads, not as MCP_REQUIRED. Never replace replay-scoped reads with live data.
When a workflow requires a save, call the declared save_* tool directly through MCP. The operator must never copy a model JSON response back into the dashboard.
If a required MCP read or write tool is unavailable, stop the workflow and report MCP_REQUIRED. Do not emit a fallback save payload for manual import.
For legacy backforward/backtest/replay Asia Open pack analysis, call get_desk_methodology first and follow its market-funnel prompt before reading packs.
Read-only tools expose active contracts, ready Asia Open packs, context bundles, datasets, market levels, macro calendar, and news digest.
Write tools persist structured desk decisions, reports, Master Analyses, active theses, hourly monitors, context transmissions, alerts, and position management records.
Never use this MCP to execute broker orders. Market/limit/stop instructions are advisory only until a human validates them.`,
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listDeskTools(deskTools),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const requiredScopes = getToolRequiredScopes(deskTools, request.params.name);
      if (!hasScopes(authRef?.current, requiredScopes)) {
        return toolResult(
          { ok: false, error: "insufficient_oauth_scope", required_scopes: requiredScopes },
          true,
          {
            "mcp/www_authenticate": [
              buildWwwAuthenticate(
                authRef?.current?.baseUrl,
                requiredScopes,
                "insufficient_scope",
                "This tool requires additional OAuth scopes.",
              ),
            ],
          },
        );
      }
      return await callDeskTool(deskTools, request.params.name, request.params.arguments || {});
    } catch (error) {
      throw new McpError(ErrorCode.InvalidParams, error.message || String(error));
    }
  });
  return server;
}

const httpServer = createHttpServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const baseUrl = publicBaseUrl(req);

  if (url.pathname === "/" && req.method === "GET") {
    sendJson(res, 200, {
      ok: true,
      service: SERVICE_ROLE === "front" ? "tv-automation-desk-api" : "tv-automation-desk-mcp",
      service_role: SERVICE_ROLE,
      endpoints: {
        ...(MCP_API_ENABLED ? {
          streamable_http: "/mcp",
          rest_tools: "/tools/:toolName",
          rest_actions: "/actions/:actionName",
          sse: "/sse",
          oauth_protected_resource: "/.well-known/oauth-protected-resource",
          oauth_authorization_server: "/.well-known/oauth-authorization-server",
        } : {}),
        ...(FRONT_API_ENABLED ? {
          front_live_desk: "/api/v1/live-desk/current",
          front_sessions: "/api/v1/sessions",
          front_market: "/api/v1/market/snapshot",
          front_position: "/api/v1/positions/current",
          front_macro: "/api/v1/macro/calendar",
          front_news: "/api/v1/news/digest",
          front_activity: "/api/v1/desk/activity",
          front_alerts: "/api/v1/alerts",
          front_audit: "/api/v1/audit",
          front_details: "/api/v1/masters/:masterId, /api/v1/monitors/:monitorId, /api/v1/theses/:thesisId, /api/v1/setups/:setupId",
          front_operator_state: FRONT_OPERATOR_STATE_PATH,
          front_operator_commands: FRONT_OPERATOR_COMMANDS_PATH,
          front_openapi: FRONT_OPENAPI_PATH,
        } : {}),
        health: "/status",
      },
    });
    return;
  }

  if (MCP_API_ENABLED && url.pathname === "/.well-known/oauth-protected-resource" && req.method === "GET") {
    sendJson(res, 200, protectedResourceMetadata(baseUrl));
    return;
  }

  if (MCP_API_ENABLED && url.pathname === "/.well-known/oauth-authorization-server" && req.method === "GET") {
    sendJson(res, 200, authorizationServerMetadata(baseUrl));
    return;
  }

  if (MCP_API_ENABLED && url.pathname === "/oauth/register" && req.method === "POST") {
    await handleOAuthRegister(req, res, baseUrl);
    return;
  }

  if (MCP_API_ENABLED && url.pathname === "/oauth/authorize" && req.method === "GET") {
    sendHtml(res, 200, renderAuthorizePage(baseUrl, Object.fromEntries(url.searchParams.entries())));
    return;
  }

  if (MCP_API_ENABLED && url.pathname === "/oauth/authorize" && req.method === "POST") {
    await handleOAuthAuthorize(req, res, baseUrl);
    return;
  }

  if (MCP_API_ENABLED && url.pathname === "/oauth/token" && req.method === "POST") {
    await handleOAuthToken(req, res, baseUrl);
    return;
  }

  if ((url.pathname === "/healthz" || url.pathname === "/status") && req.method === "GET") {
    try {
      sendJson(res, 200, { ...await store.health(), service_role: SERVICE_ROLE });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) });
    }
    return;
  }

  if (url.pathname === "/api/v1/webhooks/tradingview" && req.method === "POST") {
    if (typeof store.ingestTradingViewWebhook !== "function") {
      sendJson(res, 503, { ok: false, error: "persistent_store_required" });
      return;
    }
    try {
      const body = await readJsonBody(req);
      const result = await store.ingestTradingViewWebhook({
        body: {
          ...(body || {}),
          token: url.searchParams.get("token") || url.searchParams.get("secret") || body?.token || body?.secret,
        },
        secret: process.env.TRADINGVIEW_WEBHOOK_SECRET || "",
        requestIp: req.headers["x-forwarded-for"] || req.socket.remoteAddress || null,
      });
      sendJson(res, result.statusCode, result.body);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) });
    }
    return;
  }

  if (FRONT_API_ENABLED && isFrontApiPath(url.pathname)) {
    await handleFrontApiRequest(req, res, url, baseUrl);
    return;
  }

  if (MCP_API_ENABLED && isRestBridgePath(url.pathname)) {
    await handleRestBridgeRequest(req, res, url, baseUrl);
    return;
  }

  if (MCP_API_ENABLED && url.pathname === "/mcp") {
    await handleMcpRequest(req, res);
    return;
  }

  if (MCP_API_ENABLED && url.pathname === "/sse" && req.method === "GET") {
    await handleSseRequest(req, res);
    return;
  }

  if (MCP_API_ENABLED && url.pathname === "/messages" && req.method === "POST") {
    await handleSseMessage(req, res, url);
    return;
  }

  sendJson(res, 404, { ok: false, error: "not_found" });
});

async function handleMcpRequest(req, res) {
  const baseUrl = publicBaseUrl(req);
  const auth = authorizeRequest(req, baseUrl);
  if (!auth.ok) {
    sendUnauthorized(res, baseUrl, ["desk.read", "desk.write"], auth.error || "invalid_token");
    return;
  }

  try {
    const body = req.method === "POST" ? await readJsonBody(req) : undefined;
    const sessionId = req.headers["mcp-session-id"];
    let entry = sessionId ? sessions.get(String(sessionId)) : undefined;

    if (entry && entry.type !== "streamable") {
      sendJson(res, 400, jsonRpcError("Session exists with another transport"));
      return;
    }

    if (!entry && req.method === "POST" && isInitializeRequest(body)) {
      const authRef = { current: auth };
      const server = createServer(authRef);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { type: "streamable", server, transport, authRef });
        },
      });
      transport.onclose = async () => {
        const id = transport.sessionId;
        if (id && sessions.has(id)) {
          sessions.delete(id);
        }
      };
      await server.connect(transport);
      entry = { type: "streamable", server, transport, authRef };
    }

    if (!entry) {
      sendJson(res, 400, jsonRpcError("No valid MCP session. Initialize with POST /mcp first."));
      return;
    }

    entry.authRef.current = auth;
    await entry.transport.handleRequest(req, res, body);
  } catch (error) {
    console.error("MCP /mcp error", error);
    if (!res.headersSent) {
      sendJson(res, 500, jsonRpcError("Internal server error", -32603));
    }
  }
}

async function handleSseRequest(req, res) {
  const baseUrl = publicBaseUrl(req);
  const auth = authorizeRequest(req, baseUrl);
  if (!auth.ok) {
    sendUnauthorized(res, baseUrl, ["desk.read", "desk.write"], auth.error || "invalid_token");
    return;
  }
  const authRef = { current: auth };
  const server = createServer(authRef);
  const transport = new SSEServerTransport("/messages", res);
  sessions.set(transport.sessionId, { type: "sse", server, transport, authRef });
  transport.onclose = () => {
    sessions.delete(transport.sessionId);
  };
  await server.connect(transport);
}

async function handleSseMessage(req, res, url) {
  const baseUrl = publicBaseUrl(req);
  const auth = authorizeRequest(req, baseUrl);
  if (!auth.ok) {
    sendUnauthorized(res, baseUrl, ["desk.read", "desk.write"], auth.error || "invalid_token");
    return;
  }
  const body = await readJsonBody(req);
  const sessionId = String(url.searchParams.get("sessionId") || "");
  const entry = sessions.get(sessionId);
  if (!entry || entry.type !== "sse") {
    sendJson(res, 400, jsonRpcError("No SSE transport found for sessionId"));
    return;
  }
  entry.authRef.current = auth;
  await entry.transport.handlePostMessage(req, res, body);
}

async function handleOAuthRegister(req, res, baseUrl) {
  try {
    const body = await readJsonBody(req);
    sendJson(res, 201, createOAuthClientRegistration(baseUrl, body || {}));
  } catch (error) {
    sendOAuthError(res, error);
  }
}

async function handleOAuthAuthorize(req, res, baseUrl) {
  let params = {};
  try {
    params = Object.fromEntries(new URLSearchParams(await readTextBody(req)).entries());
    validateDeskPin(params.pin);
    const redirect = createAuthorizationRedirect(baseUrl, params);
    res.writeHead(302, { location: redirect, "cache-control": "no-store" });
    res.end();
  } catch (error) {
    if (error instanceof OAuthError && error.code === "access_denied") {
      sendHtml(res, 401, renderAuthorizePage(baseUrl, params, { error: error.description }));
      return;
    }
    sendOAuthError(res, error);
  }
}

async function handleOAuthToken(req, res, baseUrl) {
  try {
    const form = Object.fromEntries(new URLSearchParams(await readTextBody(req)).entries());
    const payload = form.grant_type === "refresh_token"
      ? exchangeRefreshToken(baseUrl, form)
      : exchangeAuthorizationCode(baseUrl, form);
    sendJson(res, 200, payload, { "cache-control": "no-store" });
  } catch (error) {
    sendOAuthError(res, error);
  }
}

async function handleFrontApiRequest(req, res, url, baseUrl) {
  const corsHeaders = restCorsHeaders(req);
  if (!isOriginAllowed(String(req.headers.origin || ""))) {
    sendJson(res, 403, { ok: false, error: "cors_origin_not_allowed" }, corsHeaders);
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  const operatorWrite = url.pathname === FRONT_OPERATOR_COMMANDS_PATH;
  const expectedMethod = operatorWrite ? "POST" : "GET";
  if (req.method !== expectedMethod) {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" }, corsHeaders);
    return;
  }

  const requiredScopes = operatorWrite ? ["desk.write"] : ["desk.read"];
  const auth = await authorizeRestBridgeRequest(req, baseUrl, requiredScopes);
  if (!auth.ok) {
    sendJson(res, 401, { ok: false, error: "unauthorized" }, {
      ...corsHeaders,
      "www-authenticate": buildWwwAuthenticate(baseUrl, requiredScopes, "invalid_token", auth.error || "invalid_token"),
    });
    return;
  }
  if (!hasScopes(auth, requiredScopes)) {
    sendJson(res, 403, { ok: false, error: "insufficient_oauth_scope", required_scopes: requiredScopes }, corsHeaders);
    return;
  }

  const input = Object.fromEntries(url.searchParams.entries());
  try {
    if (url.pathname === FRONT_OPERATOR_STATE_PATH) {
      const payload = await loadFrontOperatorState(store, input);
      sendJson(res, 200, payload, { ...corsHeaders, "cache-control": "no-store" });
      return;
    }

    if (url.pathname === FRONT_OPERATOR_COMMANDS_PATH) {
      const body = await readJsonBody(req);
      const payload = await executeFrontOperatorCommand(store, body || {}, {
        kind: auth.kind,
        email: auth.email || null,
        uid: auth.uid || null,
        clientIp: clientIpFromRequest(req),
      });
      sendJson(res, 200, payload, { ...corsHeaders, "cache-control": "no-store" });
      return;
    }

    if (url.pathname === "/api/v1/live-desk/current") {
      const session = await loadFrontDeskSession(store, normalizeFrontApiScope(input));
      sendJson(res, 200, session, { ...corsHeaders, "cache-control": "no-store" });
      return;
    }

    if (url.pathname === "/api/v1/sessions") {
      const scopes = ["asia_open", "ny_open"].map((session) => normalizeFrontApiScope({ ...input, session }));
      const sessions = await Promise.all(scopes.map((scope) => loadFrontDeskSession(store, scope)));
      sendJson(res, 200, sessions.map(sessionSummary), { ...corsHeaders, "cache-control": "no-store" });
      return;
    }

    if (url.pathname === FRONT_OPENAPI_PATH) {
      sendFrontResource(req, res, frontApiOpenApiDocument(), corsHeaders, 300);
      return;
    }

    if (FRONT_RESOURCE_PATHS.has(url.pathname)) {
      const payload = await loadFrontApiResource(store, url.pathname, input);
      sendFrontResource(req, res, payload, corsHeaders, FRONT_RESOURCE_CACHE_SECONDS[url.pathname]);
      return;
    }

    if (isFrontDetailPath(url.pathname)) {
      const payload = await loadFrontDetailResource(store, url.pathname, input);
      sendFrontResource(req, res, payload, corsHeaders, frontDetailCacheSeconds(url.pathname));
      return;
    }
  } catch (error) {
    const status = Number(error.statusCode) || frontOperatorErrorStatus(error.code) || 500;
    sendJson(res, status, {
      ok: false,
      error: error.message || String(error),
      ...(error.code ? { code: error.code } : {}),
    }, { ...corsHeaders, "cache-control": "no-store" });
    return;
  }

  sendJson(res, 404, { ok: false, error: "not_found" }, corsHeaders);
}

async function handleRestBridgeRequest(req, res, url, baseUrl) {
  const corsHeaders = restCorsHeaders(req);
  if (!isOriginAllowed(String(req.headers.origin || ""))) {
    sendJson(res, 403, { ok: false, error: "cors_origin_not_allowed" }, corsHeaders);
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed" }, corsHeaders);
    return;
  }

  const toolName = normalizeRestToolName(restToolNameFromPath(url.pathname));
  if (!toolName) {
    sendJson(res, 404, { ok: false, error: "tool_not_found" }, corsHeaders);
    return;
  }

  const requiredScopes = getToolRequiredScopes(deskTools, toolName);
  const auth = await authorizeRestBridgeRequest(req, baseUrl, requiredScopes);
  if (!auth.ok) {
    sendJson(
      res,
      401,
      { ok: false, error: "unauthorized" },
      {
        ...corsHeaders,
        "www-authenticate": buildWwwAuthenticate(baseUrl, ["desk.read", "desk.write"], "invalid_token", auth.error || "invalid_token"),
      },
    );
    return;
  }

  if (!hasScopes(auth, requiredScopes)) {
    sendJson(res, 403, { ok: false, error: "insufficient_oauth_scope", required_scopes: requiredScopes }, corsHeaders);
    return;
  }

  if (MCP_ONLY_GPT_WRITE_TOOLS.has(toolName)) {
    sendJson(res, 409, {
      ok: false,
      tool: toolName,
      error: "mcp_transport_required",
      required_endpoint: "/mcp",
    }, corsHeaders);
    return;
  }

  try {
    const body = await readJsonBody(req);
    const result = await callDeskTool(deskTools, toolName, body || {});
    sendJson(res, result.isError ? 400 : 200, {
      ok: !result.isError,
      tool: toolName,
      isError: Boolean(result.isError),
      structuredContent: result.structuredContent,
      content: result.content,
    }, corsHeaders);
  } catch (error) {
    const message = error.message || String(error);
    const status = message.includes("not found") ? 404 : 500;
    sendJson(res, status, { ok: false, tool: toolName, error: message }, corsHeaders);
  }
}

httpServer.listen(PORT, () => {
  console.log(`GPT desk MCP listening on http://localhost:${PORT}/mcp`);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function shutdown() {
  console.log("Shutting down GPT desk MCP server...");
  const entries = [...sessions.values()];
  sessions.clear();
  for (const entry of entries) {
    entry.transport.onclose = undefined;
    await closeQuietly(entry.server);
  }
  httpServer.close(() => process.exit(0));
}

function authorizeRequest(req, baseUrl) {
  const auth = String(req.headers.authorization || "");
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  if (!API_KEY) {
    if (!bearer) {
      return { ok: true, kind: "anonymous", scopes: ["desk.read", "desk.write"], baseUrl };
    }
  }
  const headerKey = String(req.headers["x-desk-api-key"] || "");
  if (API_KEY && (headerKey === API_KEY || bearer === API_KEY)) {
    return { ok: true, kind: "api_key", scopes: ["desk.read", "desk.write"], baseUrl };
  }
  if (bearer) {
    try {
      return { ok: true, ...verifyOAuthAccessToken(baseUrl, bearer), baseUrl };
    } catch (error) {
      return { ok: false, error: error.description || error.message || "invalid_token" };
    }
  }
  return { ok: false, error: "missing_bearer_token" };
}

async function authorizeRestBridgeRequest(req, baseUrl, requiredScopes) {
  const auth = String(req.headers.authorization || "");
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  const headerKey = String(req.headers["x-desk-api-key"] || "");

  if (API_KEY && (headerKey === API_KEY || bearer === API_KEY)) {
    return authorizeRequest(req, baseUrl);
  }

  if (bearer) {
    const oauthAuth = authorizeRequest(req, baseUrl);
    if (oauthAuth.ok) {
      return oauthAuth;
    }
    return { ok: false, error: "local_operator_api_key_required" };
  }

  if (headerKey) {
    return authorizeRequest(req, baseUrl);
  }

  if (requiredScopes.length === 1 && requiredScopes[0] === "desk.read") {
    return { ok: true, kind: "rest_read", scopes: ["desk.read"], baseUrl };
  }
  return { ok: false, error: "missing_write_authorization" };
}

function jsonRpcError(message, code = -32000) {
  return { jsonrpc: "2.0", error: { code, message }, id: null };
}

function sendJson(res, status, payload, headers = {}) {
  if (res.headersSent) {
    return;
  }
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(payload));
}

function sendFrontResource(req, res, payload, headers = {}, maxAgeSeconds = 0) {
  const etag = frontApiEtag(payload);
  const responseHeaders = {
    ...headers,
    etag,
    "cache-control": frontApiCacheControl(maxAgeSeconds),
  };
  if (requestMatchesEtag(req.headers["if-none-match"], etag)) {
    res.writeHead(304, responseHeaders);
    res.end();
    return;
  }
  sendJson(res, 200, payload, responseHeaders);
}

function sendHtml(res, status, html, headers = {}) {
  if (res.headersSent) {
    return;
  }
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
  res.end(html);
}

function sendUnauthorized(res, baseUrl, scopes, description) {
  sendJson(
    res,
    401,
    { ok: false, error: "unauthorized" },
    { "www-authenticate": buildWwwAuthenticate(baseUrl, scopes, "invalid_token", description) },
  );
}

function sendOAuthError(res, error) {
  const status = error instanceof OAuthError ? error.status : 400;
  sendJson(res, status, {
    error: error instanceof OAuthError ? error.code : "invalid_request",
    error_description: error.description || error.message || String(error),
  }, { "cache-control": "no-store" });
}

function parseAllowedOrigins(raw) {
  if (raw) {
    return raw.split(",").map((origin) => origin.trim()).filter(Boolean);
  }
  return [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:4173",
    "http://localhost:4173",
    "http://127.0.0.1:8080",
    "http://localhost:8080",
  ];
}

function normalizeServiceRole(value) {
  const normalized = String(value || "all").trim().toLowerCase();
  return ["all", "front", "mcp"].includes(normalized) ? normalized : "all";
}

function isRestBridgePath(pathname) {
  return /^\/(?:api\/)?(?:tools|actions)\/[^/]+$/.test(pathname);
}

function isFrontApiPath(pathname) {
  return pathname === "/api/v1/live-desk/current" ||
    pathname === "/api/v1/sessions" ||
    pathname === FRONT_OPERATOR_STATE_PATH ||
    pathname === FRONT_OPERATOR_COMMANDS_PATH ||
    pathname === FRONT_OPENAPI_PATH ||
    FRONT_RESOURCE_PATHS.has(pathname) ||
    isFrontDetailPath(pathname);
}

function frontOperatorErrorStatus(code) {
  if (["IDEMPOTENCY_CONFLICT", "REVISION_CONFLICT", "TARGET_CONFLICT", "COMMAND_NOT_ALLOWED"].includes(code)) return 409;
  if (code === "INVALID_OPERATOR_COMMAND") return 400;
  return 0;
}

function clientIpFromRequest(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "")
    .split(",")[0]
    .trim() || null;
}

function restToolNameFromPath(pathname) {
  const match = pathname.match(/^\/(?:api\/)?(?:tools|actions)\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function normalizeRestToolName(toolName) {
  const aliases = {
    get_controlled_replay_state: "get_replay_state",
    prepare_m15_monitor_bundle: "prepare_m15_monitor_bundle_job",
    save_manual_monitor_result: "save_manual_monitor",
    reset_replay_day: "cancel_backtest_run",
    create_controlled_replay_day: "create_orchestrated_replay_day",
    prepare_replay_master_step: "prepare_replay_master_bundle",
    prepare_replay_monitor_step: "prepare_replay_monitor_bundle",
    run_replay_master: "save_replay_master_analysis",
    run_replay_monitor: "save_replay_monitor",
    import_replay_monitor_result: "save_replay_monitor",
    prepare_nyopen_master_bundle_action: "prepare_nyopen_master_bundle",
    mark_setup_triggered: "mark_nyopen_strategy_event",
    mark_tp1: "mark_nyopen_strategy_event",
    mark_tp2: "mark_nyopen_strategy_event",
    mark_tp3: "mark_nyopen_strategy_event",
    mark_stopped: "mark_nyopen_strategy_event",
    mark_expired: "mark_nyopen_strategy_event",
    replay_strict_setup: "mark_nyopen_strategy_event",
    recompute_nyopen_performance: "recompute_strategy_performance",
  };
  return aliases[toolName] || toolName;
}

function isOriginAllowed(origin) {
  if (!origin) {
    return true;
  }
  return REST_ALLOWED_ORIGINS.includes("*") || REST_ALLOWED_ORIGINS.includes(origin);
}

function restCorsHeaders(req) {
  const origin = String(req.headers.origin || "");
  const headers = {
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization, x-desk-api-key, if-none-match",
    "access-control-expose-headers": "etag, cache-control",
    "access-control-allow-credentials": "true",
    "access-control-max-age": "3600",
  };
  if (origin && isOriginAllowed(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "origin";
  }
  return headers;
}

async function readJsonBody(req) {
  const text = await readTextBody(req);
  return text ? JSON.parse(text) : undefined;
}

async function readTextBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 2_000_000) {
      throw new Error("request_body_too_large");
    }
    chunks.push(chunk);
  }
  if (!chunks.length) {
    return "";
  }
  return Buffer.concat(chunks).toString("utf8");
}

function publicBaseUrl(req) {
  if (process.env.DESK_MCP_PUBLIC_BASE_URL) {
    return process.env.DESK_MCP_PUBLIC_BASE_URL.replace(/\/+$/g, "");
  }
  const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`;
  const proto = req.headers["x-forwarded-proto"] || (String(host).startsWith("localhost") ? "http" : "https");
  return `${String(proto).split(",")[0]}://${String(host).split(",")[0]}`.replace(/\/+$/g, "");
}

async function closeQuietly(target) {
  try {
    await target.close();
  } catch {
    // Ignore shutdown cleanup errors.
  }
}
