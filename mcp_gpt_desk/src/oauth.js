import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const OAUTH_SCOPES = ["desk.read", "desk.write"];
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const AUTH_CODE_TTL_SECONDS = 5 * 60;
const consumedAuthorizationCodes = new Map();

export function oauthConfig(baseUrl) {
  const issuer = canonicalBaseUrl(baseUrl);
  return {
    issuer,
    resource: issuer,
    protectedResourcePath: "/.well-known/oauth-protected-resource",
    authorizationServerPath: "/.well-known/oauth-authorization-server",
    authorizationEndpoint: `${issuer}/oauth/authorize`,
    tokenEndpoint: `${issuer}/oauth/token`,
    registrationEndpoint: `${issuer}/oauth/register`,
    protectedResourceEndpoint: `${issuer}/.well-known/oauth-protected-resource`,
    authorizationServerEndpoint: `${issuer}/.well-known/oauth-authorization-server`,
    scopes: OAUTH_SCOPES,
  };
}

export function protectedResourceMetadata(baseUrl) {
  const cfg = oauthConfig(baseUrl);
  return {
    resource: cfg.resource,
    authorization_servers: [cfg.issuer],
    scopes_supported: cfg.scopes,
    bearer_methods_supported: ["header"],
    resource_documentation: `${cfg.issuer}/`,
  };
}

export function authorizationServerMetadata(baseUrl) {
  const cfg = oauthConfig(baseUrl);
  return {
    issuer: cfg.issuer,
    authorization_endpoint: cfg.authorizationEndpoint,
    token_endpoint: cfg.tokenEndpoint,
    registration_endpoint: cfg.registrationEndpoint,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: cfg.scopes,
    resource_parameter_supported: true,
  };
}

export function createOAuthClientRegistration(baseUrl, metadata = {}) {
  const now = Math.floor(Date.now() / 1000);
  const requestedScopes = normalizeScopes(metadata.scope || metadata.scopes || OAUTH_SCOPES.join(" "));
  return {
    client_id: `desk_dcr_${base64Url(randomBytes(18))}`,
    client_id_issued_at: now,
    redirect_uris: Array.isArray(metadata.redirect_uris) ? metadata.redirect_uris : [],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: requestedScopes.join(" "),
    client_name: metadata.client_name || "ChatGPT Desk Futures Connector",
  };
}

export function renderAuthorizePage(baseUrl, params, { error = "" } = {}) {
  const cfg = oauthConfig(baseUrl);
  const safe = (value) => escapeHtml(String(value || ""));
  const scope = normalizeScopes(params.scope || "desk.read desk.write").join(" ");
  const resource = params.resource || cfg.resource;
  const hidden = [
    "response_type",
    "client_id",
    "redirect_uri",
    "code_challenge",
    "code_challenge_method",
    "state",
    "scope",
    "resource",
  ].map((key) => `<input type="hidden" name="${key}" value="${safe(params[key] || (key === "scope" ? scope : key === "resource" ? resource : ""))}">`).join("\n");

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Autoriser Desk Futures Data</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f6f8fb; color: #172033; margin: 0; padding: 32px; }
    main { max-width: 560px; margin: 0 auto; background: white; border: 1px solid #d9e2ec; border-radius: 8px; padding: 24px; }
    h1 { margin: 0 0 8px; font-size: 22px; color: #1f4e79; }
    p { line-height: 1.45; }
    code { background: #eef3f8; padding: 2px 5px; border-radius: 4px; }
    label { display: block; margin: 18px 0 6px; font-weight: 700; }
    input[type=password] { width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid #b7c4d1; border-radius: 6px; font-size: 16px; }
    button { margin-top: 16px; background: #1f4e79; color: white; border: 0; border-radius: 6px; padding: 10px 14px; font-weight: 700; cursor: pointer; }
    .error { color: #b42318; background: #fff0ed; border: 1px solid #ffdad4; padding: 10px; border-radius: 6px; }
    .muted { color: #52616f; font-size: 14px; }
  </style>
</head>
<body>
  <main>
    <h1>Autoriser Desk Futures Data</h1>
    <p>ChatGPT demande l'acces au serveur MCP <code>${safe(cfg.resource)}</code>.</p>
    <p class="muted">Scopes demandes : <code>${safe(scope)}</code></p>
    ${error ? `<p class="error">${safe(error)}</p>` : ""}
    <form method="post" action="/oauth/authorize">
      ${hidden}
      <label for="pin">PIN OAuth du desk</label>
      <input id="pin" name="pin" type="password" autocomplete="one-time-code" required autofocus>
      <button type="submit">Autoriser ChatGPT</button>
    </form>
  </main>
</body>
</html>`;
}

export function createAuthorizationRedirect(baseUrl, params) {
  const cfg = oauthConfig(baseUrl);
  validateAuthorizeParams(params, cfg);
  const code = signToken({
    typ: "auth_code",
    iss: cfg.issuer,
    aud: "oauth-token",
    client_id: params.client_id,
    redirect_uri: params.redirect_uri,
    code_challenge: params.code_challenge,
    scope: normalizeScopes(params.scope || "desk.read desk.write").join(" "),
    resource: params.resource || cfg.resource,
  }, AUTH_CODE_TTL_SECONDS);
  const redirect = new URL(params.redirect_uri);
  redirect.searchParams.set("code", code);
  if (params.state) {
    redirect.searchParams.set("state", params.state);
  }
  return redirect.toString();
}

export function exchangeAuthorizationCode(baseUrl, form) {
  const cfg = oauthConfig(baseUrl);
  if (form.grant_type !== "authorization_code") {
    throw new OAuthError("unsupported_grant_type", "Only authorization_code is supported here.");
  }
  const payload = verifySignedToken(form.code, { typ: "auth_code", aud: "oauth-token", issuer: cfg.issuer });
  if (form.client_id && form.client_id !== payload.client_id) {
    throw new OAuthError("invalid_grant", "client_id does not match authorization code.");
  }
  if (form.redirect_uri && form.redirect_uri !== payload.redirect_uri) {
    throw new OAuthError("invalid_grant", "redirect_uri does not match authorization code.");
  }
  if (form.resource && form.resource !== payload.resource) {
    throw new OAuthError("invalid_target", "resource does not match authorization code.");
  }
  verifyPkce(form.code_verifier, payload.code_challenge);
  consumeAuthorizationCode(payload);
  return issueTokenPair(cfg, {
    client_id: payload.client_id,
    scope: payload.scope,
    resource: payload.resource,
  });
}

export function exchangeRefreshToken(baseUrl, form) {
  const cfg = oauthConfig(baseUrl);
  if (form.grant_type !== "refresh_token") {
    throw new OAuthError("unsupported_grant_type", "Only refresh_token is supported here.");
  }
  const payload = verifySignedToken(form.refresh_token, { typ: "refresh_token", aud: "oauth-token", issuer: cfg.issuer });
  if (form.client_id && form.client_id !== payload.client_id) {
    throw new OAuthError("invalid_grant", "client_id does not match refresh token.");
  }
  const requestedScopes = form.scope ? normalizeScopes(form.scope) : normalizeScopes(payload.scope);
  const originalScopes = new Set(normalizeScopes(payload.scope));
  for (const scope of requestedScopes) {
    if (!originalScopes.has(scope)) {
      throw new OAuthError("invalid_scope", `Refresh token cannot grant ${scope}.`);
    }
  }
  return issueTokenPair(cfg, {
    client_id: form.client_id || payload.client_id,
    scope: requestedScopes.join(" "),
    resource: form.resource || payload.resource || cfg.resource,
  });
}

export function verifyOAuthAccessToken(baseUrl, token) {
  const cfg = oauthConfig(baseUrl);
  const payload = verifySignedToken(token, { typ: "access_token", issuer: cfg.issuer });
  const resource = payload.resource || payload.aud;
  if (resource !== cfg.resource) {
    throw new OAuthError("invalid_token", "Token audience/resource does not match this MCP server.");
  }
  return {
    kind: "oauth",
    subject: payload.sub || "desk-admin",
    client_id: payload.client_id || null,
    scopes: normalizeScopes(payload.scope),
  };
}

export function buildWwwAuthenticate(baseUrl, scopes = ["desk.read", "desk.write"], error = "invalid_token", description = "OAuth token required") {
  const cfg = oauthConfig(baseUrl);
  return `Bearer resource_metadata="${cfg.protectedResourceEndpoint}", scope="${normalizeScopes(scopes).join(" ")}", error="${escapeHeader(error)}", error_description="${escapeHeader(description)}"`;
}

export function validateDeskPin(pin) {
  const expected = process.env.DESK_OAUTH_ADMIN_PIN || process.env.DESK_MCP_OAUTH_PIN || "";
  if (!expected) {
    throw new OAuthError("server_error", "DESK_OAUTH_ADMIN_PIN is not configured.");
  }
  const left = Buffer.from(String(pin || ""));
  const right = Buffer.from(String(expected));
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new OAuthError("access_denied", "Invalid desk OAuth PIN.");
  }
}

export function hasScopes(auth, requiredScopes = []) {
  if (!requiredScopes.length) {
    return true;
  }
  if (auth?.kind === "api_key") {
    return true;
  }
  const granted = new Set(auth?.scopes || []);
  return requiredScopes.every((scope) => granted.has(scope));
}

export class OAuthError extends Error {
  constructor(code, description, status = 400) {
    super(description);
    this.code = code;
    this.description = description;
    this.status = status;
  }
}

function issueTokenPair(cfg, { client_id, scope, resource }) {
  const normalizedScope = normalizeScopes(scope || "desk.read desk.write").join(" ");
  const access_token = signToken({
    typ: "access_token",
    iss: cfg.issuer,
    aud: resource || cfg.resource,
    resource: resource || cfg.resource,
    sub: "desk-admin",
    client_id,
    scope: normalizedScope,
  }, ACCESS_TOKEN_TTL_SECONDS);
  const refresh_token = signToken({
    typ: "refresh_token",
    iss: cfg.issuer,
    aud: "oauth-token",
    sub: "desk-admin",
    client_id,
    scope: normalizedScope,
    resource: resource || cfg.resource,
  }, REFRESH_TOKEN_TTL_SECONDS);
  return {
    access_token,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token,
    scope: normalizedScope,
  };
}

function validateAuthorizeParams(params, cfg) {
  if (params.response_type !== "code") {
    throw new OAuthError("unsupported_response_type", "Only response_type=code is supported.");
  }
  if (!params.client_id) {
    throw new OAuthError("invalid_request", "client_id is required.");
  }
  if (!params.redirect_uri || !isAllowedRedirectUri(params.redirect_uri)) {
    throw new OAuthError("invalid_request", "redirect_uri is not allowed.");
  }
  if (!params.code_challenge || params.code_challenge_method !== "S256") {
    throw new OAuthError("invalid_request", "PKCE S256 code_challenge is required.");
  }
  const scopes = normalizeScopes(params.scope || "desk.read desk.write");
  for (const scope of scopes) {
    if (!OAUTH_SCOPES.includes(scope)) {
      throw new OAuthError("invalid_scope", `Unsupported scope: ${scope}`);
    }
  }
  const resource = params.resource || cfg.resource;
  if (resource !== cfg.resource) {
    throw new OAuthError("invalid_target", "resource does not match this MCP server.");
  }
}

function verifyPkce(codeVerifier, expectedChallenge) {
  if (!codeVerifier) {
    throw new OAuthError("invalid_grant", "code_verifier is required.");
  }
  const actual = base64Url(createHash("sha256").update(String(codeVerifier)).digest());
  if (actual !== expectedChallenge) {
    throw new OAuthError("invalid_grant", "PKCE verification failed.");
  }
}

function consumeAuthorizationCode(payload) {
  const now = Math.floor(Date.now() / 1000);
  for (const [jti, expiresAt] of consumedAuthorizationCodes) {
    if (expiresAt <= now) consumedAuthorizationCodes.delete(jti);
  }
  if (!payload.jti || consumedAuthorizationCodes.has(payload.jti)) {
    throw new OAuthError("invalid_grant", "Authorization code was already used.");
  }
  consumedAuthorizationCodes.set(payload.jti, Number(payload.exp) || now + AUTH_CODE_TTL_SECONDS);
}

function signToken(payload, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const body = {
    ...payload,
    iat: now,
    exp: now + ttlSeconds,
    jti: base64Url(randomBytes(18)),
  };
  const unsigned = `${base64UrlJson(header)}.${base64UrlJson(body)}`;
  const signature = base64Url(createHmac("sha256", tokenSecret()).update(unsigned).digest());
  return `${unsigned}.${signature}`;
}

function verifySignedToken(token, { typ, aud, issuer } = {}) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) {
    throw new OAuthError("invalid_token", "Malformed token.", 401);
  }
  const [encodedHeader, encodedPayload, signature] = parts;
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const expected = base64Url(createHmac("sha256", tokenSecret()).update(unsigned).digest());
  if (!constantEqual(signature, expected)) {
    throw new OAuthError("invalid_token", "Invalid token signature.", 401);
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new OAuthError("invalid_token", "Invalid token payload.", 401);
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now >= payload.exp) {
    throw new OAuthError("invalid_token", "Token expired.", 401);
  }
  if (typ && payload.typ !== typ) {
    throw new OAuthError("invalid_token", "Unexpected token type.", 401);
  }
  if (aud && payload.aud !== aud) {
    throw new OAuthError("invalid_token", "Unexpected token audience.", 401);
  }
  if (issuer && payload.iss !== issuer) {
    throw new OAuthError("invalid_token", "Unexpected token issuer.", 401);
  }
  return payload;
}

function tokenSecret() {
  const secret = process.env.DESK_OAUTH_TOKEN_SECRET || process.env.DESK_MCP_OAUTH_SECRET || process.env.DESK_MCP_API_KEY || process.env.DESK_GPT_MCP_API_KEY || "";
  if (!secret) {
    throw new OAuthError("server_error", "OAuth token secret is not configured.", 500);
  }
  return secret;
}

function normalizeScopes(scope) {
  const raw = Array.isArray(scope) ? scope.join(" ") : String(scope || "");
  return [...new Set(raw.split(/[,\s]+/).map((value) => value.trim()).filter(Boolean))];
}

function isAllowedRedirectUri(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "chatgpt.com" &&
      (url.pathname.startsWith("/connector/oauth/") || url.pathname === "/connector_platform_oauth_redirect");
  } catch {
    return false;
  }
}

function canonicalBaseUrl(baseUrl) {
  return String(baseUrl || "").replace(/\/+$/g, "");
}

function base64UrlJson(value) {
  return base64Url(Buffer.from(JSON.stringify(value)));
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function constantEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeHeader(value) {
  return String(value || "").replaceAll('"', "'");
}
