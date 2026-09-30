import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { protectedResourceMetadata, authorizationServerMetadata,
  renderAuthorizePage, createAuthorizationRedirect, exchangeAuthorizationCode, exchangeRefreshToken,
  verifyOAuthAccessToken, validateDeskPin, validateOAuthAuthorizationRequest } from "./oauth.js";
import { readBody, readJsonBody, sendJson, sendHtml } from "./oos-http-io.js";
import { OosOAuthClients } from "./oos-oauth-clients.js";

const SCOPES = ["desk.read", "desk.write"];
const fail = (code, field) => Object.assign(new Error(code), { code, field, status: 400 });

/** Reuses authentication primitives only, with a separate audience/secret and no legacy tool profiles. */
export class OosOAuth {
  constructor({ baseUrl, pool, operatorToken, clientsDirectory }) {
    baseUrl = baseUrl.replace(/\/+$/, "");
    Object.assign(this, { baseUrl, pool, operatorToken });
    this.profile = { issuer: baseUrl, resource: `${baseUrl}/mcp` };
    this.clients = new OosOAuthClients({ issuer: baseUrl, directory: clientsDirectory });
    const resource = new URL(this.profile.resource);
    this.metadataUrl = `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}`;
    this.sessions = new Map(); this.attempts = new Map();
  }
  authenticate(req) {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization || "")?.[1];
    if (token && equal(token, this.operatorToken)) return { ok: true, kind: "oos_operator", scopes: SCOPES };
    if (token) {
      const auth = verifyOAuthAccessToken(this.profile, token);
      return { ...auth, ok: true, scopes: auth.scopes.filter(scope => SCOPES.includes(scope)) };
    }
    const session = /(?:^|;\s*)oos_session=([^;]+)/.exec(req.headers.cookie || "")?.[1];
    if (session && this.sessions.get(session) > Date.now()) return { ok: true, kind: "oos_session", scopes: SCOPES };
    return null;
  }
  challenge(error) {
    const challenge = `Bearer resource_metadata="${this.metadataUrl}", scope="${SCOPES.join(" ")}"`;
    return error ? `${challenge}, error="invalid_token", error_description="Invalid or expired OAuth token"` : challenge;
  }
  async route(req, res, pathname, query) {
    const resource = "/.well-known/oauth-protected-resource";
    if (req.method === "GET" && pathname === resource) {
      sendJson(res, 200, { ...protectedResourceMetadata(this.profile), scopes_supported: SCOPES }); return true;
    }
    if (req.method === "GET" && pathname === "/.well-known/oauth-authorization-server") {
      sendJson(res, 200, { ...authorizationServerMetadata(this.profile), scopes_supported: SCOPES,
        authorization_response_iss_parameter_supported: true }); return true;
    }
    if (req.method === "POST" && pathname === "/oauth/register") {
      this.rateLimit(req);
      const metadata = await readJsonBody(req, 16000);
      checkScopes(metadata.scope || SCOPES.join(" "));
      sendJson(res, 201, await this.clients.register(metadata)); return true;
    }
    if (pathname === "/oauth/authorize" && ["GET", "POST"].includes(req.method)) {
      await this.authorize(req, res, query); return true;
    }
    if (pathname === "/oauth/token" && req.method === "POST") {
      await this.token(req, res); return true;
    }
    if (pathname === "/login" && ["GET", "POST"].includes(req.method)) {
      await this.login(req, res); return true;
    }
    return false;
  }
  async authorize(req, res, query) {
    const params = req.method === "POST" ? Object.fromEntries(new URLSearchParams(await readBody(req, 16000))) : query;
    params.resource ||= this.profile.resource;
    const client = await this.clients.get(params.client_id);
    params.scope ||= client.scope; checkScopes(params.scope);
    const profile = { ...this.profile, allowedRedirectUris: client.redirect_uris };
    if (!client.redirect_uris.includes(params.redirect_uri)) throw fail("invalid_request", "redirect_uri");
    if (!String(params.scope).split(/\s+/).every(scope => client.scope.split(/\s+/).includes(scope))) throw fail("invalid_scope");
    if (!/^[A-Za-z0-9_-]{43}$/.test(params.code_challenge || "")) throw fail("invalid_request", "code_challenge");
    validateOAuthAuthorizationRequest(profile, params);
    if (req.method === "GET") {
      const html = renderAuthorizePage(this.profile, params).replaceAll("Desk Futures Data", "Desk OOS")
        .replace('action="/oauth/authorize"', `action="${new URL(this.baseUrl).pathname}/oauth/authorize"`);
      sendHtml(res, html); return;
    }
    this.rateLimit(req);
    let redirect;
    try {
      validateDeskPin(params.pin);
      redirect = new URL(createAuthorizationRedirect(profile, params));
    } catch (error) {
      if (error.code !== "access_denied") throw error;
      // Only a previously validated callback can receive an OAuth error redirect.
      redirect = new URL(params.redirect_uri);
      redirect.searchParams.set("error", "access_denied");
      if (params.state) redirect.searchParams.set("state", params.state);
    }
    redirect.searchParams.set("iss", this.baseUrl);
    res.writeHead(303, { location: redirect.toString(), "cache-control": "no-store" }); res.end();
  }
  async token(req, res) {
    this.rateLimit(req);
    const form = Object.fromEntries(new URLSearchParams(await readBody(req, 16000)));
    if (form.resource && form.resource !== this.profile.resource) throw fail("invalid_target");
    if (form.scope) checkScopes(form.scope);
    const client = await this.clients.get(form.client_id);
    if (form.client_secret) throw fail("invalid_client");
    let tokens;
    if (form.grant_type === "authorization_code") {
      if (!form.client_id || !form.redirect_uri || !form.code_verifier) throw fail("invalid_request");
      if (!client.redirect_uris.includes(form.redirect_uri)) throw fail("invalid_grant", "redirect_uri");
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(form.code_verifier)) throw fail("invalid_grant", "code_verifier");
      tokens = exchangeAuthorizationCode(this.profile, form);
      const consumed = await this.pool.query(`INSERT INTO oos_batch_oauth_codes (code_hash) VALUES ($1)
        ON CONFLICT DO NOTHING RETURNING code_hash`, [createHash("sha256").update(form.code).digest("hex")]);
      if (!consumed.rowCount) throw fail("invalid_grant");
    } else if (form.grant_type === "refresh_token") tokens = exchangeRefreshToken(this.profile, form);
    else throw fail("unsupported_grant_type");
    checkScopes(tokens.scope);
    if (form.scope && !form.scope.split(/\s+/).every(scope => tokens.scope.split(/\s+/).includes(scope))) throw fail("invalid_scope");
    verifyOAuthAccessToken(this.profile, tokens.access_token);
    sendJson(res, 200, { ...tokens, resource: this.profile.resource, iss: this.baseUrl });
  }
  async login(req, res) {
    if (req.method === "GET") { sendHtml(res, loginPage()); return; }
    this.rateLimit(req);
    const form = new URLSearchParams(await readBody(req, 16000)); validateDeskPin(form.get("pin"));
    for (const [id, expiry] of this.sessions) if (expiry <= Date.now()) this.sessions.delete(id);
    const session = randomBytes(32).toString("hex"); this.sessions.set(session, Date.now() + 8 * 3600000);
    res.writeHead(303, { location: "/oos/", "cache-control": "no-store",
      "set-cookie": `oos_session=${session}; HttpOnly; Secure; SameSite=Strict; Path=/oos/; Max-Age=28800` }); res.end();
  }
  rateLimit(req) {
    const key = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    for (const [id, record] of this.attempts) if (record.until < now) this.attempts.delete(id);
    const record = this.attempts.get(key) || { until: now + 60000, count: 0 };
    if (++record.count > 30 || this.attempts.size > 1000) throw Object.assign(fail("RATE_LIMITED"), { status: 429 });
    this.attempts.set(key, record);
  }
}
function checkScopes(value) {
  if (!String(value).split(/\s+/).every(scope => SCOPES.includes(scope))) throw fail("invalid_scope");
}
function equal(left, right) {
  if (!right) return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function loginPage() {
  return `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Desk OOS — Connexion</title><style>body{margin:0;background:#03070e;color:#e8f2ff;font:16px system-ui;padding:24px}
    main{max-width:420px;margin:12vh auto}label,input,button{display:block;box-sizing:border-box;width:100%;margin:16px 0}
    input,button{padding:14px;font:inherit}button{background:#159dc4;color:#03070e;border:0;cursor:pointer}a{color:#8dddff}</style>
    <main><p>DESK OOS</p><h1>Suivi des batchs</h1><p>Captures, plans gelés et simulations. Aucun ordre broker.</p>
    <form method="post" action="/oos/login"><label for="pin">PIN OAuth OOS</label><input id="pin" name="pin" type="password" autocomplete="current-password" required>
    <button>Ouvrir le desk OOS</button></form></main></html>`;
}
