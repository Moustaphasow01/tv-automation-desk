const CHICAGO_TZ = "America/Chicago";
const dtfCache = new Map();

export function normalizeGrainStrategyRows(rows = []) {
  return array(rows)
    .map((row) => ({
      timestamp_utc: iso(
        row.timestamp_utc || row.timestampUtc || row.time || row.timestamp,
      ),
      open: grainFinite(row.open),
      high: grainFinite(row.high),
      low: grainFinite(row.low),
      close: grainFinite(row.close),
      volume: grainFinite(row.volume, 0),
    }))
    .filter(
      (row) =>
        row.timestamp_utc &&
        row.open > 0 &&
        row.high >= Math.max(row.open, row.close) &&
        row.low <= Math.min(row.open, row.close),
    )
    .sort(compareRows);
}

export function normalizeGrainStrategyRowsBySymbol(source = {}) {
  return Object.fromEntries(
    Object.entries(source).map(([key, rows]) => [
      String(key).toUpperCase(),
      normalizeGrainStrategyRows(rows),
    ]),
  );
}

export function normalizeGrainStrategyEvents(events = []) {
  return array(events)
    .map((event) => ({
      event_kind: String(event.event_kind || event.kind || "").toUpperCase(),
      title: event.title || null,
      event_timestamp_utc: iso(
        event.event_timestamp_utc ||
          event.timestamp_utc ||
          event.scheduled_at_utc,
      ),
      importance: String(event.importance || "MEDIUM").toUpperCase(),
    }))
    .filter((event) => event.event_timestamp_utc);
}

export function chicagoDate(timestampUtc) {
  const parts = zonedParts(timestampUtc);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function chicagoMinute(timestampUtc) {
  const parts = zonedParts(timestampUtc);
  return Number(parts.hour) * 60 + Number(parts.minute);
}

export function chicagoRthEndMs(timestampUtc) {
  const parts = zonedParts(timestampUtc);
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    18,
    20,
    0,
  );
}

export function isGrainStrategyRth(timestampUtc) {
  const minute = chicagoMinute(timestampUtc);
  return minute >= 8 * 60 + 30 && minute <= 13 * 60 + 20;
}

export function grainFinite(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function grainRound(value, digits = 4) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const factor = 10 ** digits;
  return Math.round(parsed * factor) / factor;
}

export function grainUnique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

export function grainRMultiple({ direction, entry, stop, exit }) {
  const risk = Math.abs(entry - stop);
  if (!risk) return 0;
  return direction === "LONG" ? (exit - entry) / risk : (entry - exit) / risk;
}

function zonedParts(timestampUtc) {
  if (!dtfCache.has(CHICAGO_TZ))
    dtfCache.set(
      CHICAGO_TZ,
      new Intl.DateTimeFormat("en-CA", {
        timeZone: CHICAGO_TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }),
    );
  const parts = {};
  for (const item of dtfCache
    .get(CHICAGO_TZ)
    .formatToParts(new Date(timestampUtc)))
    if (item.type !== "literal") parts[item.type] = item.value;
  return parts;
}

function compareRows(left, right) {
  return Date.parse(left.timestamp_utc) - Date.parse(right.timestamp_utc);
}
function iso(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function array(value) {
  return Array.isArray(value) ? value : [];
}
