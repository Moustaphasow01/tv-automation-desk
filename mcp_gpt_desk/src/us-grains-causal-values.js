export function causalIso(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function causalNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function causalRound(value, digits = 4) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 10 ** digits) / 10 ** digits;
}

export function causalUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

export function causalArray(value) {
  return Array.isArray(value) ? value : [value].filter(Boolean);
}
