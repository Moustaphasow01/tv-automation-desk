import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const NINJA_ADDON_HEADER_NAMES = Object.freeze({
  addonId: "x-desk-addon-id",
  timestamp: "x-desk-addon-timestamp",
  nonce: "x-desk-addon-nonce",
  signature: "x-desk-addon-signature",
});

export function createNinjaAddonAuthenticator({ secret = process.env.DESK_NINJA_ADDON_SHARED_SECRET || "", maxClockSkewMs = 30_000, now = () => Date.now() } = {}) {
  const normalizedSecret = String(secret || "");
  const nonces = new Map();
  return {
    configured: normalizedSecret.length >= 32,
    verify({ method, pathname, rawBody = "", headers = {} } = {}) {
      if (normalizedSecret.length < 32) return failure("ADDON_AUTH_NOT_CONFIGURED", "The AddOn shared secret is missing or shorter than 32 characters.");
      const addonId = header(headers, NINJA_ADDON_HEADER_NAMES.addonId);
      const timestamp = header(headers, NINJA_ADDON_HEADER_NAMES.timestamp);
      const nonce = header(headers, NINJA_ADDON_HEADER_NAMES.nonce);
      const signature = header(headers, NINJA_ADDON_HEADER_NAMES.signature).toLowerCase();
      if (!addonId || !timestamp || !nonce || !signature) return failure("ADDON_AUTH_HEADERS_REQUIRED", "All signed AddOn headers are required.");
      if (!/^[A-Za-z0-9_.:-]{3,200}$/.test(addonId) || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature)) {
        return failure("ADDON_AUTH_HEADERS_INVALID", "One or more signed AddOn headers are malformed.");
      }
      const requestMs = Number(timestamp);
      const nowMs = Number(now());
      if (!Number.isFinite(requestMs) || Math.abs(nowMs - requestMs) > maxClockSkewMs) return failure("ADDON_AUTH_TIMESTAMP_INVALID", "The AddOn request timestamp is outside the accepted window.");
      cleanupNonces(nonces, nowMs, maxClockSkewMs);
      const nonceKey = `${addonId}:${nonce}`;
      if (nonces.has(nonceKey)) return failure("ADDON_AUTH_REPLAYED", "The AddOn nonce was already used.");
      const expected = signNinjaAddonRequest({ secret: normalizedSecret, method, pathname, timestamp, nonce, rawBody });
      const valid = timingSafeHexEqual(expected, signature);
      if (!valid) return failure("ADDON_AUTH_SIGNATURE_INVALID", "The AddOn request signature is invalid.");
      nonces.set(nonceKey, requestMs);
      return { ok: true, kind: "ninja_addon", uid: addonId, addonId, scopes: ["desk.read", "desk.write"] };
    },
  };
}

export function signNinjaAddonRequest({ secret, method, pathname, timestamp, nonce, rawBody = "" } = {}) {
  if (String(secret || "").length < 32) throw authError("ADDON_AUTH_SECRET_INVALID", "The AddOn shared secret must contain at least 32 characters.");
  const canonical = [
    String(timestamp || ""),
    String(nonce || ""),
    String(method || "POST").toUpperCase(),
    String(pathname || ""),
    createHash("sha256").update(String(rawBody || ""), "utf8").digest("hex"),
  ].join("\n");
  return createHmac("sha256", String(secret)).update(canonical, "utf8").digest("hex");
}

function cleanupNonces(nonces, nowMs, maxClockSkewMs) {
  for (const [key, timestamp] of nonces) if (nowMs - Number(timestamp) > maxClockSkewMs * 2) nonces.delete(key);
}
function timingSafeHexEqual(left, right) {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
function header(headers, name) {
  const value = typeof headers.get === "function" ? headers.get(name) : headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? String(value[0] || "").trim() : String(value || "").trim();
}
function failure(code, message) { return { ok: false, code, error: message }; }
function authError(code, message) { const error = new Error(message); error.code = code; return error; }
