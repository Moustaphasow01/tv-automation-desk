import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Real HTTPS OAuth/PKCE acceptance; never print codes, PINs, cookies or tokens.
const config = JSON.parse(await readFile(process.env.OOS_BATCH_CONFIG, "utf8"));
const base = config.public_url, redirect = "https://chatgpt.com/connector/oauth/callback";
const verifier = randomBytes(48).toString("base64url"), state = randomBytes(16).toString("hex");
const registration = await fetch(`${base}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ redirect_uris: [redirect], client_name: "OOS SDK acceptance, not ChatGPT", scope: "desk.read desk.write" }) });
assert.equal(registration.status, 201);
const { client_id } = await registration.json();
const params = { response_type: "code", client_id, redirect_uri: redirect, scope: "desk.read desk.write", resource: base,
  code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state };
const consent = await fetch(`${base}/oauth/authorize?${new URLSearchParams(params)}`);
assert.equal(consent.status, 200); assert.match(await consent.text(), /action="\/oos\/oauth\/authorize"/);
const authorization = await fetch(`${base}/oauth/authorize`, { method: "POST", redirect: "manual",
  body: new URLSearchParams({ ...params, pin: process.env.DESK_OAUTH_ADMIN_PIN }) });
assert.equal(authorization.status, 303);
const location = new URL(authorization.headers.get("location")); assert.equal(location.searchParams.get("state"), state);
const form = { grant_type: "authorization_code", client_id, redirect_uri: redirect, resource: base,
  code: location.searchParams.get("code"), code_verifier: verifier };
const exchange = await fetch(`${base}/oauth/token`, { method: "POST", body: new URLSearchParams(form) });
assert.equal(exchange.status, 200); const tokens = await exchange.json(); assert.ok(tokens.access_token);
const duplicate = await fetch(`${base}/oauth/token`, { method: "POST", body: new URLSearchParams(form) });
assert.notEqual(duplicate.status, 200);
const client = new Client({ name: "OOS OAuth acceptance", version: "1" });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } } }));
  assert.equal((await client.listTools()).tools.length, 10);
  const probe = await client.callTool({ name: "write_probe", arguments: { value: "deployment-oauth-probe-001" } });
  assert.equal(probe.isError, undefined); assert.equal(probe.structuredContent.source, "mcp");
  const refresh = await fetch(`${base}/oauth/token`, { method: "POST", body: new URLSearchParams({
    grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id, resource: base }) });
  assert.equal(refresh.status, 200);
  console.log(JSON.stringify({ oauth_pkce: "PASS", code_reuse_denied: "PASS", oauth_mcp_write: "PASS", refresh: "PASS", chatgpt_account_test: "NOT_RUN" }));
} finally { await client.close(); }
