import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "desk_operator_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

export function createOperatorSession(pin, baseUrl, env = process.env, nowMs = Date.now()) {
  validateOperatorPin(pin, env);
  const now = Math.floor(nowMs / 1000);
  const payload = {
    typ: "desk_operator_session",
    iss: canonicalBaseUrl(baseUrl),
    sub: "desk-operator",
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
    jti: randomBytes(18).toString("base64url"),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(encoded, env);
  return {
    user: { email: "operator@desk.local", displayName: "Opérateur Desk" },
    cookie: serializeCookie(`${encoded}.${signature}`, baseUrl, SESSION_TTL_SECONDS),
    expiresAt: new Date((now + SESSION_TTL_SECONDS) * 1000).toISOString(),
  };
}

export function verifyOperatorSession(cookieHeader, baseUrl, env = process.env, nowMs = Date.now()) {
  const token = parseCookies(cookieHeader)[COOKIE_NAME];
  if (!token) return { ok: false, error: "operator_session_missing" };
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra || !safeEqual(signature, sign(encoded, env))) {
    return { ok: false, error: "operator_session_invalid" };
  }
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const now = Math.floor(nowMs / 1000);
    if (payload.typ !== "desk_operator_session") return { ok: false, error: "operator_session_invalid" };
    if (payload.iss !== canonicalBaseUrl(baseUrl)) return { ok: false, error: "operator_session_issuer_mismatch" };
    if (!payload.exp || now >= payload.exp) return { ok: false, error: "operator_session_expired" };
    return {
      ok: true,
      kind: "operator_session",
      email: "operator@desk.local",
      uid: payload.sub,
      scopes: ["desk.read", "desk.write"],
    };
  } catch {
    return { ok: false, error: "operator_session_invalid" };
  }
}

export function clearOperatorSessionCookie(baseUrl) {
  return serializeCookie("", baseUrl, 0);
}

function validateOperatorPin(pin, env) {
  const expected = String(env.DESK_OPERATOR_ADMIN_PIN || env.DESK_OAUTH_ADMIN_PIN || "");
  if (!expected) throw operatorError("operator_pin_not_configured", 503);
  if (!safeEqual(String(pin || ""), expected)) throw operatorError("operator_pin_invalid", 401);
}

function sign(encoded, env) {
  const secret = String(env.DESK_OPERATOR_SESSION_SECRET || "");
  if (!secret) throw operatorError("operator_session_secret_not_configured", 503);
  return createHmac("sha256", secret).update(encoded).digest("base64url");
}

function parseCookies(header) {
  const output = {};
  for (const part of String(header || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) output[key] = value;
  }
  return output;
}

function serializeCookie(value, baseUrl, maxAge) {
  const secure = String(baseUrl || "").startsWith("https:") ? "; Secure" : "";
  return `${COOKIE_NAME}=${value}; Path=/api/v1; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function canonicalBaseUrl(value) {
  return String(value || "").replace(/\/+$/g, "");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function operatorError(code, statusCode) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}
