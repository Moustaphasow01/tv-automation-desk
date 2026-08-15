import { currentUtc, text } from "./front-control-plane-common.js";

export { currentUtc, text };

export function rows(value) {
  return Array.isArray(value?.items) ? value.items : Array.isArray(value) ? value : [];
}

export function firstRow(value) {
  return rows(value)[0] || null;
}

export function countBy(value, predicate) {
  return rows(value).filter(predicate).length;
}

export function average(values) {
  const finite = values.filter((item) => Number.isFinite(item));
  return finite.length ? Math.round(finite.reduce((a, b) => a + b, 0) / finite.length) : 0;
}

export function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function upper(value) {
  return String(value ?? "").toUpperCase();
}

export function stringList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

export function hasSignalId(item) {
  return Boolean(item?.signal_outbox_id || item?.signal_id) && ["LONG", "SHORT"].includes(upper(item?.direction || item?.side));
}

export function hasFillId(item) {
  return Boolean(item?.fill_id);
}

export function hasIncidentId(item) {
  return Boolean(item?.incident_id);
}

export function isActiveExecutionMode(item) {
  return ["LIVE", "PAPER", "SHADOW"].includes(upper(item.execution_mode));
}

export function runtimeState(value) {
  const state = upper(value);
  if (state === "RUNNING") return "RUNNING";
  if (state === "STARTING") return "STARTING";
  if (state === "PAUSED") return "PAUSED";
  if (state === "FAILED") return "FAILED";
  return "STOPPED";
}

export function executionModeState(value) {
  const mode = upper(value);
  if (mode === "LIVE") return "LIVE";
  if (mode === "PAPER") return "PAPER";
  return "SHADOW";
}

export function fact(label, value) {
  return { label, value: value === null || value === undefined || value === "" ? "—" : String(value) };
}

export function objectFacts(source, keys) {
  return keys
    .filter((key) => source?.[key] !== undefined && typeof source[key] !== "object")
    .map((key) => fact(key.replaceAll("_", " "), source[key]));
}

export function latestTimestamp(items, keys) {
  return rows(items)
    .flatMap((item) => keys.map((key) => item?.[key]).filter(Boolean))
    .map(String)
    .sort()
    .at(-1) || null;
}

export function ageMinutes(value, reference = currentUtc()) {
  const at = Date.parse(value);
  const now = Date.parse(reference);
  return Number.isFinite(at) && Number.isFinite(now) ? Math.max(0, Math.round((now - at) / 60_000)) : 0;
}
