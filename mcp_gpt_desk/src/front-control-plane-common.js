import { createHash } from "node:crypto";
import { SystemClock } from "@tv-automation/desk-time";

const CONTROL_PLANE_SYSTEM_CLOCK = new SystemClock();

export function currentUtc(clock) {
  return currentTick(clock).utc;
}

export function currentTick(clock = CONTROL_PLANE_SYSTEM_CLOCK) {
  const value = typeof clock?.now === "function" ? clock.now() : CONTROL_PLANE_SYSTEM_CLOCK.now();
  if (typeof value === "string") return tickFromString(value);
  if (value?.utc) return tickFromClockValue(value);
  return CONTROL_PLANE_SYSTEM_CLOCK.now();
}

export function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function safeIdPart(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_.:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 180) || "unknown";
}

export function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

export function codedError(code, message, statusCode) {
  return Object.assign(new Error(message), { code, statusCode });
}

function tickFromString(value) {
  const epochMs = Date.parse(value);
  if (Number.isFinite(epochMs)) return { epochMs, utc: new Date(epochMs).toISOString() };
  return CONTROL_PLANE_SYSTEM_CLOCK.now();
}

function tickFromClockValue(value) {
  const parsed = Date.parse(value.utc);
  const epochMs = Number.isFinite(value.epochMs) ? value.epochMs : parsed;
  if (!Number.isFinite(epochMs)) return CONTROL_PLANE_SYSTEM_CLOCK.now();
  return { epochMs, utc: new Date(Number.isFinite(parsed) ? parsed : epochMs).toISOString() };
}
