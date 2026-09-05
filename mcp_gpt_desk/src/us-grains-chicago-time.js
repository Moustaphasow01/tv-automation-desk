const MAX_CACHED_TIMESTAMPS = 8192;
const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});
const partsByTimestamp = new Map();

export function chicagoPartsAtUtc(timestampUtc) {
  const key = String(timestampUtc);
  const cached = partsByTimestamp.get(key);
  if (cached) return cached;
  const parts = {};
  for (const item of formatter.formatToParts(new Date(timestampUtc))) {
    if (item.type !== "literal") parts[item.type] = item.value;
  }
  const immutable = Object.freeze(parts);
  if (partsByTimestamp.size >= MAX_CACHED_TIMESTAMPS)
    partsByTimestamp.delete(partsByTimestamp.keys().next().value);
  partsByTimestamp.set(key, immutable);
  return immutable;
}

export function chicagoMinuteAtUtc(timestampUtc) {
  const parts = chicagoPartsAtUtc(timestampUtc);
  return Number(parts.hour) * 60 + Number(parts.minute);
}
