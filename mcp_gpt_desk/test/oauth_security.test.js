import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createAuthorizationRedirect,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
} from "../src/oauth.js";

const baseUrl = "https://desk.example.test";
const originalSecret = process.env.DESK_OAUTH_TOKEN_SECRET;
process.env.DESK_OAUTH_TOKEN_SECRET = "0123456789abcdefghijklmnopqrstuvwxyz";

test.after(() => {
  if (originalSecret === undefined) delete process.env.DESK_OAUTH_TOKEN_SECRET;
  else process.env.DESK_OAUTH_TOKEN_SECRET = originalSecret;
});

test("OAuth authorization codes are PKCE-bound and single-use", () => {
  const verifier = "verifier-0123456789-abcdefghijklmnopqrstuvwxyz";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirect = createAuthorizationRedirect(baseUrl, {
    response_type: "code",
    client_id: "desk-test-client",
    redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "desk.read desk.write",
    resource: baseUrl,
  });
  const code = new URL(redirect).searchParams.get("code");
  const tokens = exchangeAuthorizationCode(baseUrl, {
    grant_type: "authorization_code",
    code,
    client_id: "desk-test-client",
    redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
    code_verifier: verifier,
    resource: baseUrl,
  });
  assert.ok(tokens.access_token);
  assert.ok(tokens.refresh_token);
  assert.throws(() => exchangeAuthorizationCode(baseUrl, {
    grant_type: "authorization_code",
    code,
    client_id: "desk-test-client",
    redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
    code_verifier: verifier,
    resource: baseUrl,
  }), /already used/);
});

test("OAuth refresh token cannot be rebound to another client", () => {
  const verifier = "verifier-refresh-0123456789-abcdefghijklmnopqrstuvwxyz";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirect = createAuthorizationRedirect(baseUrl, {
    response_type: "code",
    client_id: "desk-refresh-client",
    redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "desk.read",
    resource: baseUrl,
  });
  const pair = exchangeAuthorizationCode(baseUrl, {
    grant_type: "authorization_code",
    code: new URL(redirect).searchParams.get("code"),
    client_id: "desk-refresh-client",
    redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect",
    code_verifier: verifier,
    resource: baseUrl,
  });
  assert.throws(() => exchangeRefreshToken(baseUrl, {
    grant_type: "refresh_token",
    refresh_token: pair.refresh_token,
    client_id: "another-client",
  }), /client_id does not match/);
});
