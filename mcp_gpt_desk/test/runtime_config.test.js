import assert from "node:assert/strict";
import test from "node:test";
import { validateRuntimeConfiguration } from "../src/runtime-config.js";

test("local runtime keeps the existing development defaults", () => {
  const config = validateRuntimeConfiguration({});
  assert.equal(config.publicMode, false);
  assert.equal(config.bindHost, "0.0.0.0");
  assert.equal(config.port, 8787);
});

test("public runtime rejects placeholders and a non-loopback listener", () => {
  assert.throws(() => validateRuntimeConfiguration({
    DESK_PUBLIC_MODE: "true",
    DESK_BIND_HOST: "0.0.0.0",
    DESK_MCP_PUBLIC_BASE_URL: "http://desk.example.test",
    DESK_MCP_API_KEY: "local-preprod-key",
    DESK_OAUTH_ADMIN_PIN: "12345678",
    DESK_OAUTH_TOKEN_SECRET: "change-me",
    DESK_OPERATOR_SESSION_SECRET: "change-me",
    TRADINGVIEW_WEBHOOK_SECRET: "local-tradingview-secret",
    DESK_REST_ALLOWED_ORIGINS: "*",
    DATABASE_URL: "postgresql://desk:desk_local_only@localhost:5432/desk",
  }), (error) => {
    assert.equal(error.code, "DESK_RUNTIME_CONFIG_INVALID");
    assert.match(error.message, /loopback/);
    assert.match(error.message, /absolute HTTPS URL/);
    assert.match(error.message, /unsafe origin/);
    return true;
  });
});

test("public runtime accepts a domain-neutral hardened configuration", () => {
  const config = validateRuntimeConfiguration({
    DESK_PUBLIC_MODE: "true",
    DESK_BIND_HOST: "127.0.0.1",
    DESK_MCP_PUBLIC_BASE_URL: "https://desk.example.test",
    DESK_MCP_API_KEY: "api_0123456789abcdefghijklmnopqrstuvwxyz",
    DESK_OAUTH_ADMIN_PIN: "oauth-826194-strong",
    DESK_OAUTH_TOKEN_SECRET: "oauth_0123456789abcdefghijklmnopqrstuvwxyz",
    DESK_OPERATOR_ADMIN_PIN: "operator-572084-strong",
    DESK_OPERATOR_SESSION_SECRET: "session_0123456789abcdefghijklmnopqrstuvwxyz",
    TRADINGVIEW_WEBHOOK_SECRET: "tv_0123456789abcdefghijklmnopqrstuvwxyz",
    DESK_REST_ALLOWED_ORIGINS: "https://desk.example.test",
    DATABASE_URL: "postgresql://desk_runtime:strong-password@127.0.0.1:5432/desk",
    DESK_NINJA_ALLOW_LIVE_ACCOUNT: "false",
  });
  assert.equal(config.publicMode, true);
  assert.equal(config.bindHost, "127.0.0.1");
  assert.equal(config.trustProxy, true);
});
