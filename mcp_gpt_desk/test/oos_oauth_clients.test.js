import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { OosOAuthClients } from "../src/oos-oauth-clients.js";

test("OOS DCR survives restart and binds exact redirects and requested scopes", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "oos-dcr-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = { issuer: "https://desk.test/oos", directory };
  const registry = new OosOAuthClients(config);
  const record = await registry.register({ redirect_uris: ["http://127.0.0.1:40643/callback"], scope: "desk.read" });
  assert.equal(record.scope, "desk.read"); assert.equal(record.token_endpoint_auth_method, "none");
  assert.deepEqual(await new OosOAuthClients(config).get(record.client_id), record);
  await assert.rejects(registry.get("../../not-a-client"), { code: "invalid_client" });
});

test("OOS DCR rejects unsafe callbacks, credentials, fragments, unsupported scopes and client auth", async () => {
  const registry = new OosOAuthClients({ issuer: "https://desk.test/oos" });
  for (const redirect of ["https://attacker.test/callback", "http://localhost/callback", "https://chatgpt.com.evil.test/connector/oauth/x",
    "https://user:password@chatgpt.com/connector/oauth/x", "https://chatgpt.com/connector/oauth/x#fragment"]) {
    await assert.rejects(registry.register({ redirect_uris: [redirect] }), { code: "invalid_redirect_uri" });
  }
  await assert.rejects(registry.register({ redirect_uris: [] }), { code: "invalid_redirect_uri" });
  const valid = { redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"] };
  await assert.rejects(registry.register({ ...valid, scope: "admin" }), { code: "invalid_scope" });
  await assert.rejects(registry.register({ ...valid, token_endpoint_auth_method: "client_secret_basic" }), { code: "invalid_client_metadata" });
});
