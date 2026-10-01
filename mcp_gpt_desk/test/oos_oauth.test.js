import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createHash, createHmac } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createOosHttpServer } from "../src/oos-http-server.js";
import { oauthConfig, createAuthorizationRedirect, exchangeAuthorizationCode } from "../src/oauth.js";

const issuer = "https://desk.example.test/oos", resource = `${issuer}/mcp`;
const secret = "TEST_ONLY-oos-oauth-secret-not-a-production-credential";
const pin = "TEST_ONLY-oos-pin", verifier = "TEST_ONLY-pkce-verifier-abcdefghijklmnopqrstuvwxyz-0123456789";
const callback = "https://chatgpt.com/connector_platform_oauth_redirect";
const decode = token => JSON.parse(Buffer.from(token.split(".")[1], "base64url"));

async function fixture(t) {
  const previous = { secret: process.env.DESK_OAUTH_TOKEN_SECRET, pin: process.env.DESK_OAUTH_ADMIN_PIN };
  process.env.DESK_OAUTH_TOKEN_SECRET = secret; process.env.DESK_OAUTH_ADMIN_PIN = pin;
  const codes = new Set();
  const pool = { query: async (sql, args) => {
    assert.match(sql, /INSERT INTO oos_batch_oauth_codes/);
    const rowCount = codes.has(args[0]) ? 0 : 1; codes.add(args[0]); return { rowCount };
  } };
  const logs = [];
  const server = createOosHttpServer({ runtime: {}, pool, config: { public_url: issuer, replay_enabled: false }, log: value => logs.push(JSON.parse(value)) });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    for (const [name, value] of [["DESK_OAUTH_TOKEN_SECRET", previous.secret], ["DESK_OAUTH_ADMIN_PIN", previous.pin]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (path, init) => fetch(`${origin}${path}`, init);
  const post = (path, fields) => request(`/oos/oauth/${path}`, { method: "POST", redirect: "manual", body: new URLSearchParams(fields) });
  const params = { response_type: "code", client_id: "TEST_ONLY-client", redirect_uri: callback,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
    resource, scope: "desk.read desk.write", state: "TEST_ONLY-state" };
  const registration = await request("/oos/oauth/register", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: [callback], scope: params.scope }) });
  params.client_id = (await registration.json()).client_id;
  const authorize = async (extra = {}) => post("authorize", { ...params, pin, ...extra });
  const grant = async () => {
    const res = await authorize(); assert.equal(res.status, 303);
    const location = new URL(res.headers.get("location"));
    assert.equal(location.searchParams.get("iss"), issuer); assert.equal(location.searchParams.get("state"), params.state);
    return { grant_type: "authorization_code", client_id: params.client_id, redirect_uri: callback, resource,
      code: location.searchParams.get("code"), code_verifier: verifier };
  };
  return { request, post, params, authorize, grant, origin, logs };
}

test("OOS standard path-aware metadata and all legacy aliases expose the same identity", async t => {
  const f = await fixture(t);
  const unauth = await f.request("/oos/mcp"); assert.equal(unauth.status, 401);
  assert.equal(unauth.headers.get("www-authenticate"),
    'Bearer resource_metadata="https://desk.example.test/.well-known/oauth-protected-resource/oos/mcp", scope="desk.read desk.write"');
  const resources = ["/.well-known/oauth-protected-resource/oos/mcp", "/.well-known/oauth-protected-resource/oos",
    "/oos/.well-known/oauth-protected-resource", "/oos/.well-known/oauth-protected-resource/mcp"];
  for (const path of resources) {
    const res = await f.request(path); assert.equal(res.status, 200, path);
    const body = await res.json(); assert.equal(body.resource, resource); assert.deepEqual(body.authorization_servers, [issuer]);
    assert.deepEqual(body.scopes_supported, ["desk.read", "desk.write"]);
  }
  for (const path of ["/.well-known/oauth-authorization-server/oos", "/oos/.well-known/oauth-authorization-server"]) {
    const res = await f.request(path); assert.equal(res.status, 200);
    const body = await res.json(); assert.equal(body.issuer, issuer);
    assert.equal(body.authorization_response_iss_parameter_supported, true);
    assert.deepEqual(body.code_challenge_methods_supported, ["S256"]);
    assert.deepEqual(body.token_endpoint_auth_methods_supported, ["none"]);
    assert.equal(body.registration_endpoint, `${issuer}/oauth/register`);
  }
});

test("OOS DCR public client, consent, PKCE, exact iss/resource/aud, tools/list and refresh", async t => {
  const f = await fixture(t);
  const registration = await f.request("/oos/oauth/register", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: [callback], scope: "desk.read desk.write" }) });
  assert.equal(registration.status, 201);
  const registered = await registration.json(); assert.equal(registered.token_endpoint_auth_method, "none");
  f.params.client_id = registered.client_id;
  const consent = await f.request(`/oos/oauth/authorize?${new URLSearchParams(f.params)}`);
  assert.equal(consent.status, 200); assert.match(await consent.text(), /name="resource" value="https:\/\/desk.example.test\/oos\/mcp"/);
  const form = await f.grant();
  assert.equal(decode(form.code).resource, resource);
  const res = await f.post("token", form); assert.equal(res.status, 200);
  const pair = await res.json();
  assert.equal(pair.iss, issuer); assert.equal(pair.resource, resource);
  assert.equal(decode(pair.access_token).iss, issuer); assert.equal(decode(pair.access_token).aud, resource);
  assert.equal(decode(pair.access_token).resource, resource);
  const client = new Client({ name: "TEST_ONLY OAuth MCP", version: "1" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${f.origin}/oos/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${pair.access_token}` } } }));
    assert.equal((await client.listTools()).tools.length, 13);
  } finally { await client.close(); }
  assert.equal((await f.post("token", form)).status, 400);
  const refresh = await f.post("token", { grant_type: "refresh_token", refresh_token: pair.refresh_token,
    client_id: f.params.client_id, resource });
  assert.equal(refresh.status, 200); assert.equal(decode((await refresh.json()).access_token).aud, resource);
});

test("OOS defaults missing resource to MCP endpoint and preserves it when token request omits it", async t => {
  const f = await fixture(t); delete f.params.resource;
  const form = await f.grant(); delete form.resource;
  const res = await f.post("token", form); assert.equal(res.status, 200);
  assert.equal(decode((await res.json()).access_token).aud, resource);
});

test("OOS error authorization response carries iss/state without leaking a code", async t => {
  const f = await fixture(t);
  const denied = await f.authorize({ pin: "TEST_ONLY-wrong" }); assert.equal(denied.status, 303);
  const location = new URL(denied.headers.get("location"));
  assert.equal(location.searchParams.get("iss"), issuer); assert.equal(location.searchParams.get("state"), f.params.state);
  assert.equal(location.searchParams.get("error"), "access_denied"); assert.equal(location.searchParams.has("code"), false);
  const invalid = await f.authorize({ redirect_uri: "https://untrusted.example/callback" });
  assert.equal(invalid.status, 400); assert.equal(invalid.headers.has("location"), false);
  assert.deepEqual(await invalid.json(), { error: "invalid_request", iss: issuer });
});

test("OOS rejects foreign resource in authorize, code exchange and refresh with OAuth errors", async t => {
  const f = await fixture(t);
  for (const foreign of [issuer, `${resource}/`, "https://foreign.example/mcp"]) {
    const auth = await f.authorize({ resource: foreign }); assert.equal(auth.status, 400);
    assert.equal((await auth.json()).error, "invalid_target");
  }
  const form = await f.grant();
  const wrong = await f.post("token", { ...form, resource: issuer }); assert.equal(wrong.status, 400);
  assert.equal((await wrong.json()).error, "invalid_target");
  const pair = await (await f.post("token", form)).json();
  const refresh = await f.post("token", { grant_type: "refresh_token", client_id: f.params.client_id,
    refresh_token: pair.refresh_token, resource: issuer });
  assert.equal(refresh.status, 400); assert.equal((await refresh.json()).error, "invalid_target");
});

test("OOS PKCE failure does not consume the valid code; scope escalation is refused", async t => {
  const f = await fixture(t), form = await f.grant();
  const denied = await f.post("token", { ...form, code_verifier: "wrong" });
  assert.equal(denied.status, 400); assert.equal((await denied.json()).error, "invalid_grant");
  const pair = await (await f.post("token", form)).json(); assert.ok(pair.access_token);
  const escalation = await f.post("token", { grant_type: "refresh_token", refresh_token: pair.refresh_token,
    client_id: f.params.client_id, resource, scope: "admin" });
  assert.equal(escalation.status, 400); assert.equal((await escalation.json()).error, "invalid_scope");
});

test("OOS bad signature, expired token, wrong issuer and mismatched aud all return a discovery challenge", async t => {
  const f = await fixture(t), form = await f.grant();
  const pair = await (await f.post("token", form)).json();
  const resign = patch => {
    const header = pair.access_token.split(".")[0];
    const payload = Buffer.from(JSON.stringify({ ...decode(pair.access_token), ...patch })).toString("base64url");
    const content = `${header}.${payload}`;
    return `${content}.${createHmac("sha256", secret).update(content).digest("base64url")}`;
  };
  for (const token of ["malformed", resign({ exp: 1 }), resign({ iss: `${issuer}/` }),
    resign({ aud: issuer }), resign({ resource: issuer }), `${pair.access_token}invalid`]) {
    const res = await f.request("/oos/mcp", { headers: { authorization: `Bearer ${token}` } });
    assert.equal(res.status, 401); assert.match(res.headers.get("www-authenticate"), /error="invalid_token"/);
    assert.match(res.headers.get("www-authenticate"), /oauth-protected-resource\/oos\/mcp/);
  }
});

test("legacy string OAuth profile retains original issuer/resource/metadata; OOS does not accept its tokens", async t => {
  const f = await fixture(t); assert.equal(oauthConfig(issuer).resource, issuer);
  assert.equal(oauthConfig(issuer).protectedResourceEndpoint, `${issuer}/.well-known/oauth-protected-resource`);
  const code = new URL(createAuthorizationRedirect(issuer, { ...f.params, resource: issuer })).searchParams.get("code");
  const pair = exchangeAuthorizationCode(issuer, { grant_type: "authorization_code", code, client_id: f.params.client_id,
    redirect_uri: callback, code_verifier: verifier, resource: issuer });
  const res = await f.request("/oos/mcp", { headers: { authorization: `Bearer ${pair.access_token}` } });
  assert.equal(res.status, 401);
});

test("OOS binds registered callback/scope and records only sanitized OAuth errors", async t => {
  const f = await fixture(t);
  const invalid = await f.authorize({ redirect_uri: "https://chatgpt.com/connector/oauth/unregistered" });
  assert.equal(invalid.status, 400); assert.equal(invalid.headers.has("location"), false);
  assert.ok(invalid.headers.get("x-request-id"));
  const registration = await f.request("/oos/oauth/register", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: ["http://127.0.0.1:40643/callback"], scope: "desk.read" }) });
  const client = await registration.json();
  const denied = await f.authorize({ client_id: client.client_id, redirect_uri: client.redirect_uris[0] });
  assert.equal(denied.status, 400); assert.equal((await denied.json()).error, "invalid_scope");
  const allowed = await f.authorize({ client_id: client.client_id, redirect_uri: client.redirect_uris[0], scope: "desk.read" });
  assert.equal(allowed.status, 303);
  const badPkce = await f.authorize({ code_challenge: "short" }); assert.equal(badPkce.status, 400);
  const unknown = await f.authorize({ client_id: "unknown" }); assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).error, "invalid_client");
  assert.ok(f.logs.some(x => x.stage === "authorize" && x.error === "invalid_scope"));
  const serialized = JSON.stringify(f.logs);
  for (const sensitive of [pin, verifier, f.params.state, f.params.code_challenge, client.client_id]) assert.ok(!serialized.includes(sensitive));
});
