import assert from "node:assert/strict";
import test from "node:test";
import { createNinjaAddonAuthenticator, signNinjaAddonRequest } from "../src/ninja-addon-auth.js";

const secret = "desk-addon-test-secret-32-characters-minimum";
const now = 1_753_193_600_000;

function request(overrides = {}) {
  const rawBody = overrides.rawBody || '{"bridgeId":"addon_1"}';
  const timestamp = String(overrides.timestamp || now);
  const nonce = overrides.nonce || "nonce_1234567890123456";
  const method = "POST";
  const pathname = "/api/v1/execution/addon/heartbeat";
  const signature = signNinjaAddonRequest({ secret, method, pathname, timestamp, nonce, rawBody });
  return { method, pathname, rawBody, headers: { "x-desk-addon-id": "addon_local_1", "x-desk-addon-timestamp": timestamp, "x-desk-addon-nonce": nonce, "x-desk-addon-signature": overrides.signature || signature } };
}

test("signed AddOn request is accepted once", () => {
  const auth = createNinjaAddonAuthenticator({ secret, now: () => now });
  assert.equal(auth.verify(request()).ok, true);
  assert.equal(auth.verify(request()).code, "ADDON_AUTH_REPLAYED");
});

test("tampered AddOn body and stale timestamp fail closed", () => {
  const auth = createNinjaAddonAuthenticator({ secret, now: () => now });
  const signed = request();
  assert.equal(auth.verify({ ...signed, rawBody: '{"bridgeId":"tampered"}' }).code, "ADDON_AUTH_SIGNATURE_INVALID");
  assert.equal(auth.verify(request({ timestamp: now - 31_000, nonce: "nonce_abcdefghijklmnop" })).code, "ADDON_AUTH_TIMESTAMP_INVALID");
});

test("missing AddOn secret never enables the endpoint", () => {
  const auth = createNinjaAddonAuthenticator({ secret: "short", now: () => now });
  assert.equal(auth.configured, false);
  assert.equal(auth.verify(request()).code, "ADDON_AUTH_NOT_CONFIGURED");
});
