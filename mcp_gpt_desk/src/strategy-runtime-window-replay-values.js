export function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

export function bool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export function bounded(value, fallback, min, max) {
  const parsed = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? Math.trunc(parsed) : fallback));
}

export function upperList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim().toUpperCase()).filter(Boolean);
  return String(value || "").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
}

export function stringSet(value) {
  return new Set((Array.isArray(value) ? value : String(value || "").split(",")).map((item) => String(item).trim()).filter(Boolean));
}

export function iso(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function requiredIso(value, field) {
  const normalized = iso(value);
  if (!normalized) throw coded("STRATEGY_RUNTIME_WINDOW_REPLAY_TIMESTAMP_INVALID", `Invalid timestamp: ${field}.`);
  return normalized;
}

export function coded(code, message) {
  const error = new Error(message || code);
  error.code = code;
  error.retryable = false;
  return error;
}
