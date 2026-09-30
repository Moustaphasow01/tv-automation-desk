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
  const refresh = await fetch(`${base}/oauth/token`, { method: "POST", body: new URLSearchParams({
    grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id, resource }) });
  assert.equal(refresh.status, 200);
  assert.equal(JSON.parse(Buffer.from((await refresh.json()).access_token.split(".")[1], "base64url")).aud, resource);
  console.log(JSON.stringify({ discovery: "PASS", oauth_pkce: "PASS", issuer_exact: "PASS", resource_audience: "PASS",
    code_reuse_denied: "PASS", tools_list: "10/10", refresh: "PASS", tool_calls: 0, chatgpt_account_test: "NOT_RUN" }));
  if (process.argv.includes("--inspector")) await inspectTools(tokens.access_token);
} finally { await client.close(); }

async function inspectTools(token) {
  const directory = await mkdtemp(path.join(tmpdir(), "oos-oauth-inspector-"));
  const file = path.join(directory, "config.json");
  try {
    await writeFile(file, JSON.stringify({ mcpServers: { "Desk OOS": { type: "http", url: resource,
      headers: { Authorization: `Bearer ${token}` } } } }), { mode: 0o600 });
    const { stdout, stderr } = await promisify(execFile)("npx", ["--yes", "@modelcontextprotocol/inspector@2.8.0", "--cli",
      "--config", file, "--server", "Desk OOS", "--method", "tools/list", "--format", "json", "--stored-auth-only"],
    { timeout: 60000, maxBuffer: 1024 * 1024, env: { ...process.env, MCP_INSPECTOR_SECRET_STORE: "memory" } });
    assert.equal(stdout.includes(token) || stderr.includes(token), false, "Inspector output must not contain credentials");
    const result = JSON.parse(stdout); assert.equal(result.result.tools.length, 10);
    console.log("MCP_INSPECTOR_VERSION=2.8.0\nMCP_INSPECTOR_EXIT_CODE=0\nMCP_INSPECTOR_STDOUT=");
    console.log(stdout.trim());
    if (stderr.trim()) console.log(`MCP_INSPECTOR_STDERR=\n${stderr.trim()}`);
  } catch (error) {
    // Child errors may contain request details; never dump the raw error object.
    throw new Error(`OOS_INSPECTOR_FAILED (${error.code || error.name})`);
  } finally { await unlink(file).catch(() => {}); await rmdir(directory); }
}
