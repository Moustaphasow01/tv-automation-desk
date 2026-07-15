/**
 * Returns the Europe/Paris UTC offset string for a given Date.
 * Uses Intl.DateTimeFormat — DST-aware, no external lib.
 * @param {Date} date
 * @returns {string} e.g. "+02:00" or "+01:00"
 */
export function parisOffset(date) {
  const fmt = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Paris",
    timeZoneName: "shortOffset",
  });
  const parts = fmt.formatToParts(date);
  const tzPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  // "GMT+2" -> "+02:00" ; "GMT+1" -> "+01:00"
  const match = tzPart.match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!match) throw new Error(`Cannot parse Paris offset from: ${tzPart}`);
  const sign = match[1];
  const hours = match[2].padStart(2, "0");
  const mins = (match[3] ?? "00").padStart(2, "0");
  return `${sign}${hours}:${mins}`;
}

/**
 * Returns an ISO 8601 string in UTC (ends with Z).
 * @param {number} epochMs
 * @returns {string}
 */
export function toUtcIso(epochMs) {
  if (typeof epochMs !== "number" || !Number.isFinite(epochMs)) {
    throw new TypeError(`toUtcIso: epochMs must be a finite number, got ${epochMs}`);
  }
  return new Date(epochMs).toISOString();
}

/**
 * Returns an ISO 8601 string with Europe/Paris offset (DST-aware).
 * Format: "YYYY-MM-DDTHH:mm:ss.sss+HH:MM"
 * @param {number} epochMs
 * @returns {string}
 */
export function toParisIso(epochMs) {
  if (typeof epochMs !== "number" || !Number.isFinite(epochMs)) {
    throw new TypeError(`toParisIso: epochMs must be a finite number, got ${epochMs}`);
  }
  const date = new Date(epochMs);
  const offset = parisOffset(date);
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hour12: false,
  });
  // "sv-SE" gives "YYYY-MM-DD HH:mm:ss.sss" — replace space with T
  let local = fmt.format(date).replace(" ", "T");
  // Safety: replace any comma decimal separator with dot
  local = local.replace(/,/g, ".");
  return `${local}${offset}`;
}
