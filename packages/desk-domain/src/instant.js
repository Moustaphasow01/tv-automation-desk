export function parseInstant(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isAfterInstant(left, right) {
  const leftMs = parseInstant(left);
  const rightMs = parseInstant(right);
  if (leftMs === null || rightMs === null) return false;
  return leftMs > rightMs;
}

export function isWithinTimeWindow(timestamp, window = {}) {
  const timestampMs = parseInstant(timestamp);
  const startMs = parseInstant(firstPresent(window.start, window.start_paris, window.start_at_paris));
  const endMs = parseInstant(firstPresent(window.end, window.end_paris, window.end_at_paris));
  if (timestampMs === null) {
    return startMs === null && endMs === null;
  }
  if (startMs !== null && timestampMs < startMs) return false;
  if (endMs !== null && timestampMs > endMs) return false;
  return true;
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}
