import assert from "node:assert/strict";
import test from "node:test";
import {
  clearOperatorSessionCookie,
  createOperatorSession,
  verifyOperatorSession,
} from "../src/operator-session-auth.js";

const env = {
  DESK_OPERATOR_ADMIN_PIN: "operator-123456",
  DESK_OPERATOR_LOGIN: "MSO",
  DESK_OPERATOR_PASSWORD: "2018",
  DESK_OPERATOR_SESSION_SECRET: "0123456789abcdefghijklmnopqrstuvwxyz",
};

test("operator session uses a signed HttpOnly cookie and validates its issuer", () => {
  const session = createOperatorSession("operator-123456", "https://desk.example.test", env, 1_000);
  assert.match(session.cookie, /HttpOnly/);
  assert.match(session.cookie, /Path=\//);
  assert.match(session.cookie, /SameSite=Strict/);
  assert.match(session.cookie, /Secure/);
  const auth = verifyOperatorSession(session.cookie, "https://desk.example.test", env, 2_000);
  assert.equal(auth.ok, true);
  assert.deepEqual(auth.scopes, ["desk.read", "desk.write"]);
  assert.equal(verifyOperatorSession(session.cookie, "https://other.example.test", env, 2_000).ok, false);
});

test("operator session rejects a wrong pin, tampering and expiry", () => {
  assert.throws(() => createOperatorSession("wrong", "http://localhost:8080", env), /operator_pin_invalid/);
  const session = createOperatorSession("operator-123456", "http://localhost:8080", env, 1_000);
  const tampered = session.cookie.replace("desk_operator_session=", "desk_operator_session=x");
  assert.equal(verifyOperatorSession(tampered, "http://localhost:8080", env, 2_000).ok, false);
  assert.equal(verifyOperatorSession(session.cookie, "http://localhost:8080", env, 30_000_000).error, "operator_session_expired");
  assert.match(clearOperatorSessionCookie("https://desk.example.test"), /Max-Age=0/);
});

test("operator session accepts login/password credentials without disabling legacy pin", () => {
  const session = createOperatorSession({ login: "MSO", password: "2018" }, "https://desk.example.test", env, 1_000);
  const auth = verifyOperatorSession(session.cookie, "https://desk.example.test", env, 2_000);

  assert.equal(auth.ok, true);
  assert.equal(auth.displayName, "Opérateur MSO");
  assert.equal(auth.uid, "desk-operator:mso");
  assert.throws(() => createOperatorSession({ login: "MSO", password: "wrong" }, "https://desk.example.test", env), /operator_credentials_invalid/);
  assert.doesNotThrow(() => createOperatorSession("operator-123456", "https://desk.example.test", env, 1_000));
});
