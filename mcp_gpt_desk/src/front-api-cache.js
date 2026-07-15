import { createHash } from "node:crypto";

export function frontApiEtag(payload) {
  const digest = createHash("sha256").update(JSON.stringify(payload)).digest("base64url");
  return `W/\"${digest}\"`;
}

export function requestMatchesEtag(ifNoneMatchValue, etag) {
  const candidates = String(ifNoneMatchValue || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return candidates.includes("*") || candidates.includes(etag);
}

export function frontApiCacheControl(maxAgeSeconds) {
  const maxAge = Math.max(0, Math.trunc(Number(maxAgeSeconds) || 0));
  return `private, max-age=${maxAge}, must-revalidate`;
}
