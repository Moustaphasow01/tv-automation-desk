import { createHash } from "node:crypto";

const MONTHS = Object.freeze({
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
});

export function parseUsdaGrainsCalendarDocument({
  text,
  source,
  retrievedAtUtc,
  coverageStart,
  coverageEnd,
  hash,
}) {
  if (source.sourceKind === "NASS_ICS" || source.sourceKind === "ICS") {
    return parseNassCalendar({ text, source, retrievedAtUtc, hash });
  }
  if (source.sourceKind === "WASDE_HTML") {
    return parseWasdeSchedule({ text, source, retrievedAtUtc, hash });
  }
  if (source.sourceKind === "FAS_SCHEDULE_HTML") {
    return parseFasSchedule({
      text, source, retrievedAtUtc, coverageStart, coverageEnd, hash,
    });
  }
  return insufficientDocument();
}

function parseNassCalendar({ text, source, retrievedAtUtc, hash }) {
  if (!/^BEGIN:VCALENDAR\s/m.test(text) || !/END:VCALENDAR\s*$/.test(text))
    throw new Error("USDA_ICALENDAR_DOCUMENT_INVALID");
  const blocks = unfolded(text).split("BEGIN:VEVENT").slice(1);
  const timestamps = blocks.map((block) => requiredIcsStart(block, source));
  if (!timestamps.length) throw new Error("USDA_ICALENDAR_EVENTS_REQUIRED");
  const events = blocks
    .map((block) => nassEvent({ block, source, retrievedAtUtc, hash }))
    .filter(Boolean);
  return parsedDocument({
    events,
    timestamps,
    calendarCreatedAtUtc: icsMetadata(text, "CREATED"),
    calendarDtstampUtc: icsMetadata(text, "DTSTAMP"),
    documentYears: years(timestamps),
  });
}

function requiredIcsStart(block, source) {
  const stamp = property(block, "DTSTART");
  if (!stamp) throw new Error("USDA_ICALENDAR_EVENT_TIME_INVALID");
  const tzid = block.match(/(?:^|\n)DTSTART;[^:\r\n]*TZID=([^;:\r\n]+)/)?.[1];
  const timestamp = icsUtc(
    stamp,
    tzid?.replaceAll('"', "") || source.timezone,
  );
  if (!timestamp) throw new Error("USDA_ICALENDAR_EVENT_TIME_INVALID");
  return timestamp;
}

function nassEvent({ block, source, retrievedAtUtc, hash }) {
  const summary = property(block, "SUMMARY");
  if (!summary || !grainRelevant(summary)) return null;
  const timestamp = requiredIcsStart(block, source);
  const uid = property(block, "UID");
  const suffix = uid || digest(`${source.url}|${summary}|${timestamp}`).slice(0, 20);
  const kind = classifyNassEvent(summary);
  return eventRecord({
    id: `usda-nass-${suffix}`,
    kind,
    title: summary,
    timestamp,
    provider: "USDA_NASS",
    source,
    retrievedAtUtc,
    hash,
    importance: ["GRAIN_STOCKS", "ACREAGE"].includes(kind) ? "CRITICAL" : "HIGH",
    canonicalKind: /crop production/i.test(summary) ? "CROP_PRODUCTION" : null,
  });
}

function parseWasdeSchedule({ text, source, retrievedAtUtc, hash }) {
  const visible = htmlText(text);
  const year = expectedYear(source);
  const heading = new RegExp(
    `${year}\\s+WASDE Release Dates\\s*\\(12:00\\s*p\\.?m\\.?\\s*ET\\)`, "i",
  );
  if (!heading.test(visible)) throw new Error("USDA_WASDE_SCHEDULE_YEAR_INVALID");
  const marker = `In ${year} the WASDE report will be released on`;
  const start = visible.indexOf(marker);
  if (start < 0) throw new Error("USDA_WASDE_SCHEDULE_DATES_MISSING");
  const line = visible.slice(start + marker.length).split("\n", 1)[0];
  const timestamps = monthDayTimestamps(line, year, "12:00:00", source.timezone);
  if (new Set(timestamps.map((value) => new Date(value).getUTCMonth())).size !== 12)
    throw new Error("USDA_WASDE_ANNUAL_SCHEDULE_INCOMPLETE");
  const events = timestamps.map((timestamp) => eventRecord({
    id: `usda-wasde-${timestamp.slice(0, 10)}`,
    kind: "WASDE",
    title: "World Agricultural Supply and Demand Estimates (WASDE)",
    timestamp,
    provider: "USDA_WAOB",
    source,
    retrievedAtUtc,
    hash,
    importance: "CRITICAL",
  }));
  return parsedDocument({ events, timestamps, documentYears: [year] });
}

function parseFasSchedule(command) {
  const { text, source, retrievedAtUtc, hash } = command;
  const visible = htmlText(text);
  if (!/Report Release Calendar/i.test(visible) || !/All times in ET/i.test(visible))
    throw new Error("USDA_FAS_RELEASE_CALENDAR_INVALID");
  const timestamps = fasExportSalesTimestamps(text, source.timezone);
  const documentYears = years(timestamps);
  if (!documentYears.includes(expectedYear(source)))
    throw new Error("USDA_FAS_SCHEDULE_YEAR_INVALID");
  const events = timestamps.map((timestamp) => eventRecord({
    id: `usda-fas-export-sales-${timestamp.replace(/[-:.]/g, "")}`,
    kind: "EXPORT_SALES",
    title: "Weekly Export Sales",
    timestamp,
    provider: "USDA_FAS",
    source,
    retrievedAtUtc,
    hash,
    importance: "HIGH",
  }));
  const parsed = parsedDocument({ events, timestamps, documentYears });
  parsed.coverage.start_utc = new Date(Date.parse(retrievedAtUtc)).toISOString();
  return {
    ...parsed,
    paginationDetected: paginationDetected(text),
    requestedWindowCovered: covers(parsed.coverage, command),
  };
}

function fasExportSalesTimestamps(text, timezone) {
  const embedded = [...text.matchAll(
    /DTSTART:(20\d{6}T\d{6}Z)%0D%0ASUMMARY:Weekly Export Sales/gi,
  )].map((match) => icsUtc(match[1], null));
  if (embedded.length) return [...new Set(embedded)].sort();
  const timestamps = [];
  for (const match of text.matchAll(/Weekly Export Sales/gi)) {
    const from = Math.max(0, match.index - 1200);
    const neighborhood = text.slice(from, match.index + 600);
    const candidates = explicitDateTimes(neighborhood, timezone);
    if (candidates.length) timestamps.push(candidates.at(-1));
  }
  const unique = [...new Set(timestamps)].sort();
  if (!unique.length) throw new Error("USDA_FAS_EXPORT_SALES_DATES_MISSING");
  return unique;
}

function explicitDateTimes(value, timezone) {
  const candidates = [];
  for (const match of value.matchAll(/20\d{6}T\d{6}Z/g)) {
    const parsed = icsUtc(match[0], null);
    if (parsed) candidates.push(parsed);
  }
  for (const match of value.matchAll(/20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})/g)) {
    const parsed = Date.parse(match[0]);
    if (Number.isFinite(parsed)) candidates.push(new Date(parsed).toISOString());
  }
  for (const match of htmlText(value).matchAll(
    /([A-Z][a-z]{2,8})\.?\s+(\d{1,2}),\s+(20\d{2})[^\n]{0,100}?(\d{1,2}):(\d{2})\s*(AM|PM)/g,
  )) {
    const month = MONTHS[match[1].slice(0, 3).toLowerCase()];
    const hour = clockHour(+match[4], match[6]);
    const timestamp = zonedUtc(+match[3], month, +match[2], hour, +match[5], 0, timezone);
    if (timestamp) candidates.push(timestamp);
  }
  return candidates;
}

function monthDayTimestamps(value, year, clock, timezone) {
  const timestamps = [];
  for (const match of value.matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s*(\d{1,2})\b/gi)) {
    const month = MONTHS[match[1].toLowerCase()];
    const [hour, minute, second] = clock.split(":").map(Number);
    const timestamp = zonedUtc(year, month, +match[2], hour, minute, second, timezone);
    if (!timestamp) throw new Error("USDA_SCHEDULE_EVENT_TIME_INVALID");
    timestamps.push(timestamp);
  }
  return [...new Set(timestamps)].sort();
}

function eventRecord(command) {
  return {
    market_agri_event_id: command.id,
    universe_key: "US_GRAINS_CBOT",
    event_kind: command.kind,
    title: command.title,
    commodity_codes: [...(command.source.scope?.instruments || ["ZC", "ZW"])],
    event_timestamp_utc: command.timestamp,
    provider: command.provider,
    source_url: command.source.url,
    importance: command.importance,
    source_published_at_utc: command.retrievedAtUtc,
    point_in_time_payload: {
      canonical_kind: command.canonicalKind || null,
      source_manifest_sha256: `sha256:${command.hash}`,
      source_timezone: command.source.timezone,
      knowledge_status: "PROVEN_CURRENT",
      historical_knowledge_status: "EXTERNAL_HISTORICAL_GAP",
    },
  };
}

function parsedDocument({
  events,
  timestamps,
  calendarCreatedAtUtc = null,
  calendarDtstampUtc = null,
  documentYears = [],
}) {
  return {
    events,
    coverage: coverageFrom(timestamps),
    evidenceStatus: "CALENDAR_SCHEDULE",
    calendarCreatedAtUtc,
    calendarDtstampUtc,
    documentYears,
    paginationDetected: false,
    requestedWindowCovered: null,
  };
}

function insufficientDocument() {
  return {
    events: [], coverage: null, evidenceStatus: "INSUFFICIENT",
    calendarCreatedAtUtc: null, calendarDtstampUtc: null,
    documentYears: [], paginationDetected: false, requestedWindowCovered: false,
  };
}

function coverageFrom(timestamps) {
  const ordered = [...new Set(timestamps)].sort();
  if (!ordered.length) return null;
  return {
    start_utc: ordered[0],
    end_utc: ordered.at(-1),
    instruments: ["ZC", "ZW"],
  };
}

function covers(coverage, { coverageStart, coverageEnd }) {
  const start = Date.parse(coverageStart);
  const end = Date.parse(coverageEnd);
  if (!coverage || !Number.isFinite(start) || !Number.isFinite(end)) return false;
  return Date.parse(coverage.start_utc) <= start && Date.parse(coverage.end_utc) >= end;
}

function years(timestamps) {
  return [...new Set(timestamps.map((value) => new Date(value).getUTCFullYear()))].sort();
}

function expectedYear(source) {
  if (!Number.isInteger(source.expectedYear))
    throw new Error("USDA_SOURCE_EXPECTED_YEAR_REQUIRED");
  return source.expectedYear;
}

function paginationDetected(text) {
  return /rel=["']next["']|aria-label=["']Next["']|class=["'][^"']*pager__item--next/i.test(text);
}

function property(block, name) {
  return block.match(new RegExp(`(?:^|\\n)${name}(?:;[^:]*)?:(.+)`))?.[1]?.trim() || null;
}

function unfolded(text) {
  return text.replace(/\r?\n[ \t]/g, "").replaceAll("\r", "");
}

function icsMetadata(text, field) {
  const value = unfolded(text).match(new RegExp(`(?:^|\\n)${field}:(\\d{8}T\\d{6}Z)`))?.[1];
  return value ? icsUtc(value, null) : null;
}

function icsUtc(value, timezone) {
  const match = String(value).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!match) return null;
  const numbers = match.slice(1, 7).map(Number);
  if (match[7]) return validUtc(...numbers);
  return timezone ? zonedUtc(...numbers, timezone) : null;
}

function validUtc(year, month, day, hour, minute, second) {
  const instant = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(instant);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day || date.getUTCHours() !== hour
    || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) return null;
  return date.toISOString();
}

export function zonedUtc(year, month, day, hour, minute, second, timezone) {
  const wallClock = validUtc(year, month, day, hour, minute, second);
  if (!wallClock) return null;
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
  } catch { return null; }
  const target = Date.parse(wallClock);
  let instant = target;
  for (let index = 0; index < 3; index += 1)
    instant += target - localEpoch(formatter, instant);
  if (localEpoch(formatter, instant) !== target) return null;
  if ([-3600000, 3600000].some((delta) => localEpoch(formatter, instant + delta) === target))
    return null;
  return new Date(instant).toISOString();
}

function localEpoch(formatter, instant) {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(instant))
    .map(({ type, value }) => [type, value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day,
    +parts.hour, +parts.minute, +parts.second);
}

function clockHour(hour, meridiem) {
  if (hour < 1 || hour > 12) return Number.NaN;
  return (hour % 12) + (meridiem.toUpperCase() === "PM" ? 12 : 0);
}

function htmlText(value) {
  return value.replace(/<\/(?:p|h\d|li|article|section|div)>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"').replace(/&#0*39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n");
}

function grainRelevant(summary) {
  return /WASDE|CROP PRODUCTION|GRAIN STOCKS|ACREAGE|CROP PROGRESS|PROSPECTIVE PLANTINGS/i.test(summary);
}

function classifyNassEvent(summary) {
  const value = summary.toUpperCase();
  if (value.includes("CROP PROGRESS")) return "CROP_PROGRESS";
  if (value.includes("PROSPECTIVE PLANTINGS")) return "PROSPECTIVE_PLANTINGS";
  if (value.includes("GRAIN STOCKS")) return "GRAIN_STOCKS";
  if (value.includes("ACREAGE")) return "ACREAGE";
  return value.includes("WASDE") ? "WASDE" : "OTHER";
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}
