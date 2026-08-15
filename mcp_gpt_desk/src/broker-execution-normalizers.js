export function firstNumber(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (value !== null && value !== undefined && value !== "" && Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function validTimestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function positionKey(value) {
  const normalized = String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
  const named = normalized.match(/^([A-Z0-9]+)\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2}|\d{4})$/);
  const numeric = normalized.match(/^([A-Z0-9]+)\s+(\d{1,2})-(\d{2}|\d{4})$/);
  if (!named && !numeric) return normalized;
  const months = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  const root = (named || numeric)[1];
  const month = named ? months[named[2]] : Number(numeric[2]);
  const rawYear = named ? named[3] : numeric[3];
  const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
  return `${root}:${year}-${String(month).padStart(2, "0")}`;
}

export function isConnectedAddonSnapshot(snapshot = {}) {
  const connection = String(snapshot.connection?.status || snapshot.connection?.connection_status || "").toLowerCase();
  return connection === "connected";
}
