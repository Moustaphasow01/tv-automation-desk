import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { discoverOAuthProtectedResourceMetadata, discoverAuthorizationServerMetadata } from "@modelcontextprotocol/sdk/client/auth.js";

// Real HTTPS OAuth/PKCE acceptance; never print codes, PINs, cookies or tokens.
const config = process.env.OOS_PUBLIC_URL ? { public_url: process.env.OOS_PUBLIC_URL }
  : JSON.parse(await readFile(process.env.OOS_BATCH_CONFIG, "utf8"));
const base = config.public_url, resource = `${base}/mcp`, redirect = "https://chatgpt.com/connector_platform_oauth_redirect";
const unauth = await fetch(resource);
assert.equal(unauth.status, 401);
const metadataUrl = /resource_metadata="([^"]+)"/.exec(unauth.headers.get("www-authenticate"))?.[1];
assert.equal(metadataUrl, `${new URL(base).origin}/.well-known/oauth-protected-resource/oos/mcp`);
const protectedMetadata = await discoverOAuthProtectedResourceMetadata(new URL(resource), { resourceMetadataUrl: new URL(metadataUrl) });
assert.equal(protectedMetadata.resource, resource); assert.deepEqual(protectedMetadata.authorization_servers, [base]);
const metadata = await discoverAuthorizationServerMetadata(new URL(base));
assert.equal(metadata.issuer, base); assert.equal(metadata.authorization_response_iss_parameter_supported, true);
const verifier = randomBytes(48).toString("base64url"), state = randomBytes(16).toString("hex");
const registration = await fetch(metadata.registration_endpoint, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ redirect_uris: [redirect], client_name: "OOS SDK acceptance, not ChatGPT", scope: "desk.read desk.write" }) });
assert.equal(registration.status, 201);
const { client_id } = await registration.json();
const params = { response_type: "code", client_id, redirect_uri: redirect, scope: "desk.read desk.write", resource,
  code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state };
const consent = await fetch(`${base}/oauth/authorize?${new URLSearchParams(params)}`);
assert.equal(consent.status, 200); assert.match(await consent.text(), /action="\/oos\/oauth\/authorize"/);
const authorization = await fetch(`${base}/oauth/authorize`, { method: "POST", redirect: "manual",
  body: new URLSearchParams({ ...params, pin: process.env.DESK_OAUTH_ADMIN_PIN }) });
assert.equal(authorization.status, 303);
const location = new URL(authorization.headers.get("location")); assert.equal(location.searchParams.get("state"), state);
assert.equal(location.searchParams.get("iss"), base);
const form = { grant_type: "authorization_code", client_id, redirect_uri: redirect, resource,
  code: location.searchParams.get("code"), code_verifier: verifier };
const exchange = await fetch(`${base}/oauth/token`, { method: "POST", body: new URLSearchParams(form) });
assert.equal(exchange.status, 200); const tokens = await exchange.json(); assert.ok(tokens.access_token);
const claims = JSON.parse(Buffer.from(tokens.access_token.split(".")[1], "base64url"));
assert.equal(claims.iss, base); assert.equal(claims.aud, resource); assert.equal(claims.resource, resource);
assert.equal(tokens.iss, base); assert.equal(tokens.resource, resource);
const duplicate = await fetch(`${base}/oauth/token`, { method: "POST", body: new URLSearchParams(form) });
assert.notEqual(duplicate.status, 200);
const client = new Client({ name: "OOS OAuth acceptance", version: "1" });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } } }));
  assert.equal((await client.listTools()).tools.length, 10);
  await verifyProbeAndPremarket(client);
  await verifyReadOnlyGrant();
  const refresh = await fetch(`${base}/oauth/token`, { method: "POST", body: new URLSearchParams({
    grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id, resource }) });
  assert.equal(refresh.status, 200);
  assert.equal(JSON.parse(Buffer.from((await refresh.json()).access_token.split(".")[1], "base64url")).aud, resource);
  console.log(JSON.stringify({ discovery: "PASS", oauth_pkce: "PASS", issuer_exact: "PASS", resource_audience: "PASS",
    code_reuse_denied: "PASS", tools_list: "10/10", refresh: "PASS", desk_read: "PASS", desk_write: "PASS",
    write_probe: "PASS", premarket_bundle: "PASS", readonly_write_denied: "PASS", chatgpt_account_test: "NOT_RUN" }));
  if (process.argv.includes("--inspector")) await inspectTools(tokens.access_token);
} finally { await client.close(); }

async function inspectTools(token) {
  const directory = await mkdtemp(path.join(tmpdir(), "oos-oauth-inspector-"));
  const file = path.join(directory, "config.json");
  try {
    await writeFile(file, JSON.stringify({ mcpServers: { "Desk OOS": { type: "http", url: resource,
      headers: { Authorization: `Bearer ${token}` } } } }), { mode: 0o600 });
    const env = { ...process.env, MCP_INSPECTOR_SECRET_STORE: "memory" };
    if (process.env.OOS_INSPECTOR_NPM_CACHE) env.npm_config_cache = process.env.OOS_INSPECTOR_NPM_CACHE;
    for (const name of ["DESK_OAUTH_ADMIN_PIN", "OOS_OPERATOR_TOKEN", "DESK_OAUTH_TOKEN_SECRET"]) delete env[name];
    const args = ["--yes", "@modelcontextprotocol/inspector@2.8.0", "--cli",
      "--config", file, "--server", "Desk OOS", "--method", "tools/list", "--format", "json", "--stored-auth-only"];
    const entry = process.env.OOS_INSPECTOR_ENTRYPOINT;
    if (entry) assert.equal(JSON.parse(await readFile(path.resolve(path.dirname(entry), "../../../package.json"), "utf8")).version, "2.8.0");
    const executable = entry || process.platform === "win32" ? process.execPath : "npx";
    const command = entry ? [entry, ...args.slice(2)] : process.platform === "win32"
      ? [path.join(path.dirname(process.execPath), "node_modules/npm/bin/npx-cli.js"), ...args] : args;
    const { stdout, stderr } = await promisify(execFile)(executable, command,
    { timeout: 120000, maxBuffer: 1024 * 1024, env });
    assert.equal(stdout.includes(token) || stderr.includes(token), false, "Inspector output must not contain credentials");
    const result = JSON.parse(stdout); assert.equal(result.result.tools.length, 10);
    console.log("MCP_INSPECTOR_VERSION=2.8.0\nMCP_INSPECTOR_EXIT_CODE=0\nMCP_INSPECTOR_STDOUT=");
    console.log(stdout.trim());
    if (stderr.trim()) console.log(`MCP_INSPECTOR_STDERR=\n${stderr.trim()}`);
  } catch (error) {
    // Child errors may contain request details; never dump the raw error object.
    const diagnostic = String(error.stderr || error.stdout || "").replaceAll(token, "[REDACTED]")
      .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]");
    console.error(JSON.stringify({ inspector_error: error.code || error.name, killed: error.killed || false,
      signal: error.signal || null, diagnostic: diagnostic.slice(0, 4000) }));
    throw new Error(`OOS_INSPECTOR_FAILED (${error.code || error.name})`);
  } finally { await unlink(file).catch(() => {}); await rmdir(directory); }
}

async function verifyProbeAndPremarket(client) {
  const value = "chatgpt-write-test-001";
  const before = await client.callTool({ name: "get_write_probe", arguments: {} }); assert.ok(!before.isError);
  const write = await client.callTool({ name: "write_probe", arguments: { value } }); assert.ok(!write.isError);
  const after = await client.callTool({ name: "get_write_probe", arguments: {} }); assert.ok(!after.isError);
  assert.equal(after.structuredContent.value, value);
  const repeat = await client.callTool({ name: "write_probe", arguments: { value } }); assert.ok(!repeat.isError);
  assert.equal(repeat.structuredContent.written_at, after.structuredContent.written_at);
  const bundle = await client.callTool({ name: "get_premarket_bundle", arguments: { date: "2026-07-30" } });
  assert.ok(!bundle.isError); assert.equal(bundle.content.filter(x => x.type === "image").length, 8);
  for (let i = 0; i < bundle.content.length; i++) {
    if (bundle.content[i].type !== "image") continue;
    const metadata = JSON.parse(bundle.content[i - 1].text);
    assert.equal(createHash("sha256").update(Buffer.from(bundle.content[i].data, "base64")).digest("hex"), metadata.sha256);
  }
  console.log(JSON.stringify({ probe_sequence: "PASS", probe_idempotence: "PASS", date: "2026-07-30",
    captures: "8/8", capture_hashes: "PASS", replay_requested: false }));
}

async function verifyReadOnlyGrant() {
  const redirect_uri = "http://127.0.0.1:40643/callback";
  const registration = await fetch(metadata.registration_endpoint, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: [redirect_uri], scope: "desk.read", token_endpoint_auth_method: "none" }) });
  assert.equal(registration.status, 201); const registered = await registration.json(); assert.equal(registered.scope, "desk.read");
  const authorization = await fetch(metadata.authorization_endpoint, { method: "POST", redirect: "manual",
    body: new URLSearchParams({ ...params, client_id: registered.client_id, redirect_uri, scope: "desk.read", pin: process.env.DESK_OAUTH_ADMIN_PIN }) });
  assert.equal(authorization.status, 303); const callback = new URL(authorization.headers.get("location"));
  assert.equal(callback.searchParams.get("iss"), base); assert.equal(callback.searchParams.get("state"), state);
  const exchanged = await fetch(metadata.token_endpoint, { method: "POST", body: new URLSearchParams({ ...form,
    client_id: registered.client_id, redirect_uri, code: callback.searchParams.get("code") }) });
  assert.equal(exchanged.status, 200); const readTokens = await exchanged.json(); assert.equal(readTokens.scope, "desk.read");
  const reader = new Client({ name: "OOS external read-only client", version: "1" });
  try {
    await reader.connect(new StreamableHTTPClientTransport(new URL(resource), {
      requestInit: { headers: { authorization: `Bearer ${readTokens.access_token}` } } }));
    assert.ok(!(await reader.callTool({ name: "get_write_probe", arguments: {} })).isError);
    const denied = await reader.callTool({ name: "write_probe", arguments: { value: "MUST_NOT_BE_WRITTEN" } });
    assert.equal(denied.isError, true); assert.match(denied.content[0].text, /OOS_SCOPE_REQUIRED/);
  } finally { await reader.close(); }
}
