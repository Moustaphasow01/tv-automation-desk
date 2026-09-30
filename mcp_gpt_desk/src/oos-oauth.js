import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { protectedResourceMetadata, authorizationServerMetadata, createOAuthClientRegistration,
  renderAuthorizePage, createAuthorizationRedirect, exchangeAuthorizationCode, exchangeRefreshToken,
  verifyOAuthAccessToken, validateDeskPin, buildWwwAuthenticate } from "./oauth.js";
import { readBody, readJsonBody, sendJson, sendHtml } from "./oos-http-io.js";

const SCOPES = ["desk.read", "desk.write"];
const fail = code => Object.assign(new Error(code), { code, status: 400 });

/** Reuses authentication primitives only, with a separate audience/secret and no legacy tool profiles. */
export class OosOAuth {
  constructor({ baseUrl, pool, operatorToken }) {
    Object.assign(this, { baseUrl, pool, operatorToken });
    this.sessions = new Map(); this.attempts = new Map();
  }
  authenticate(req) {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization || "")?.[1];
    if (token && equal(token, this.operatorToken)) return { ok: true, kind: "oos_operator", scopes: SCOPES };
    if (token) {
      const auth = verifyOAuthAccessToken(this.baseUrl, token);
      return { ...auth, ok: true, scopes: auth.scopes.filter(scope => SCOPES.includes(scope)) };
    }
    const session = /(?:^|;\s*)oos_session=([^;]+)/.exec(req.headers.cookie || "")?.[1];
    if (session && this.sessions.get(session) > Date.now()) return { ok: true, kind: "oos_session", scopes: SCOPES };
    return null;
  }
  challenge() { return buildWwwAuthenticate(this.baseUrl, SCOPES); }
  async route(req, res, pathname, query) {
    const resource = "/.well-known/oauth-protected-resource";
    if (req.method === "GET" && pathname === resource) {
      sendJson(res, 200, { ...protectedResourceMetadata(this.baseUrl), scopes_supported: SCOPES }); return true;
    }
    if (req.method === "GET" && pathname === "/.well-known/oauth-authorization-server") {
      sendJson(res, 200, { ...authorizationServerMetadata(this.baseUrl), scopes_supported: SCOPES }); return true;
    }
    if (req.method === "POST" && pathname === "/oauth/register") {
      this.rateLimit(req);
      const metadata = await readJsonBody(req, 16000);
      checkScopes(metadata.scope || SCOPES.join(" "));
      sendJson(res, 201, createOAuthClientRegistration(this.baseUrl, { ...metadata, scope: SCOPES.join(" ") })); return true;
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
    params.scope ||= SCOPES.join(" "); checkScopes(params.scope);
    if (req.method === "GET") {
      const html = renderAuthorizePage(this.baseUrl, params).replaceAll("Desk Futures Data", "Desk OOS")
        .replace('action="/oauth/authorize"', `action="${new URL(this.baseUrl).pathname}/oauth/authorize"`);
      sendHtml(res, html); return;
    }
    this.rateLimit(req); validateDeskPin(params.pin);
    res.writeHead(303, { location: createAuthorizationRedirect(this.baseUrl, params), "cache-control": "no-store" }); res.end();
  }
  async token(req, res) {
    this.rateLimit(req);
    const form = Object.fromEntries(new URLSearchParams(await readBody(req, 16000)));
    if (form.resource && form.resource !== this.baseUrl) throw fail("invalid_target");
    if (form.scope) checkScopes(form.scope);
    let tokens;
    if (form.grant_type === "authorization_code") {
      if (!form.client_id || !form.redirect_uri || !form.code_verifier) throw fail("invalid_request");
      tokens = exchangeAuthorizationCode(this.baseUrl, form);
      const consumed = await this.pool.query(`INSERT INTO oos_batch_oauth_codes (code_hash) VALUES ($1)
        ON CONFLICT DO NOTHING RETURNING code_hash`, [createHash("sha256").update(form.code).digest("hex")]);
      if (!consumed.rowCount) throw fail("invalid_grant");
    } else if (form.grant_type === "refresh_token") tokens = exchangeRefreshToken(this.baseUrl, form);
    else throw fail("unsupported_grant_type");
    checkScopes(tokens.scope); sendJson(res, 200, tokens);
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
