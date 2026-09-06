import { createHash } from "node:crypto";
import { qualifyGrainsCalendarEvidence } from "../grains-calendar-evidence.js";

export async function collectUsdaGrainsCalendar({
  sources,
  retrievedAtUtc,
  fetchText,
  coverageStart = null,
  coverageEnd = null,
}) {
  if (!Number.isFinite(Date.parse(retrievedAtUtc)))
    throw new Error("USDA_RETRIEVAL_TIME_REQUIRED");
  const results = await Promise.all(
    sources.map((source) =>
      collectSource({ source, retrievedAtUtc, fetchText }),
    ),
  );
  const manifests = results.map((result) => result.manifest);
  const agriEvents = uniqueEvents(results.flatMap((result) => result.events));
  const agriCalendarCoverage = coverage({ manifests, retrievedAtUtc, coverageStart, coverageEnd });
  return {
    manifests,
    agriEvents,
    agriCalendarCoverage,
    calendarVersion: calendarVersionInput({
      manifests,
      agriEvents,
      coverage: agriCalendarCoverage[0],
      retrievedAtUtc,
    }),
  };
}

function calendarVersionInput({
  manifests,
  agriEvents,
  coverage,
  retrievedAtUtc,
}) {
  return {
    sourceId: "market_agri_events",
    status: coverage.status,
    coverageStart: coverage.coverageStart,
    coverageEnd: coverage.coverageEnd,
    knownAtUtc: retrievedAtUtc,
    datasetVersion: coverage.datasetVersion,
    sourceVersionHash: coverage.sourceVersionHash,
    provider: coverage.provider,
    reasonCodes: coverage.reasonCodes,
    sources: manifests.map(sourceRecord),
    events: agriEvents,
  };
}

async function collectSource({ source, retrievedAtUtc, fetchText }) {
  const text = await fetchText(source.url, source);
  if (source.sourceKind === "ICS" && !isIcalendar(text)) {
    throw new Error("USDA_ICALENDAR_DOCUMENT_INVALID");
  }
  if (source.sourceKind !== "ICS" && !hasDocumentText(text))
    throw new Error("USDA_SOURCE_DOCUMENT_INVALID");
  const hash = createHash("sha256").update(text).digest("hex");
  const manifest = {
    sourceId: source.sourceId,
    sourceUrl: source.url,
    sourceKind: source.sourceKind,
    sha256: `sha256:${hash}`,
    retrieved_at_utc: retrievedAtUtc,
    knowledge_status: "PROVEN_CURRENT",
    historical_knowledge_status: "EXTERNAL_HISTORICAL_GAP",
    calendar_created_at_utc: icsMetadata(text, "CREATED"),
    calendar_dtstamp_utc: icsMetadata(text, "DTSTAMP"),
    calendar_evidence_status:
      source.calendarEvidenceStatus || defaultEvidenceStatus(source),
    coverage: source.coverage || null,
    source_document: source.sourceKind === "ICS" ? text : null,
    document_size_bytes: Buffer.byteLength(text),
  };
  return {
    manifest,
    events:
      source.sourceKind === "ICS"
        ? parseNassIcs({ text, source, retrievedAtUtc, hash })
        : [],
  };
}

function isIcalendar(text) {
  return /^BEGIN:VCALENDAR\s/m.test(text) && /END:VCALENDAR\s*$/.test(text);
}

function hasDocumentText(text) {
  return typeof text === "string" && text.trim().length > 0;
}

function defaultEvidenceStatus(source) {
  return source.sourceKind === "ICS" ? "CALENDAR_SCHEDULE" : "INSUFFICIENT";
}

function parseNassIcs({ text, source, retrievedAtUtc, hash }) {
  return text
    .replace(/\r?\n[ \t]/g, "")
    .split("BEGIN:VEVENT")
    .slice(1)
    .map((block) => eventFromBlock({ block, source, retrievedAtUtc, hash }))
    .filter(Boolean);
}

function eventFromBlock({ block, source, retrievedAtUtc, hash }) {
  const value = (name) =>
    block.match(new RegExp(`(?:^|\\n)${name}(?:;[^:]*)?:(.+)`))?.[1]?.trim() ||
    null;
  const summary = value("SUMMARY");
  const stamp = value("DTSTART");
  const uid = value("UID");
  if (!summary || !stamp || !grainRelevant(summary)) return null;
  const eventKind = classifyEventKind(summary);
  const tzid = block.match(/(?:^|\n)DTSTART;[^:\r\n]*TZID=([^;:\r\n]+)/)?.[1];
  const eventTime = icsUtc(stamp, tzid?.replaceAll('"', "") || source.timezone);
  if (!eventTime) throw new Error("USDA_ICALENDAR_EVENT_TIME_INVALID");
  return {
    market_agri_event_id: `usda-nass-${uid || createHash("sha256").update(`${source.url}|${summary}|${eventTime}`).digest("hex").slice(0, 20)}`,
    universe_key: "US_GRAINS_CBOT",
    event_kind: eventKind,
    title: summary,
    commodity_codes: ["ZC", "ZW"],
    event_timestamp_utc: eventTime,
    provider: "USDA_NASS",
    source_url: source.url,
    importance: ["WASDE", "GRAIN_STOCKS", "ACREAGE"].includes(eventKind)
      ? "CRITICAL"
      : "HIGH",
    source_published_at_utc: retrievedAtUtc,
    point_in_time_payload: {
      canonical_kind: /crop production/i.test(summary)
        ? "CROP_PRODUCTION"
        : null,
      source_manifest_sha256: `sha256:${hash}`,
      source_timezone: stamp.endsWith("Z") ? "UTC" : tzid || source.timezone,
      knowledge_status: "PROVEN_CURRENT",
      historical_knowledge_status: "EXTERNAL_HISTORICAL_GAP",
    },
  };
}

function classifyEventKind(summary) {
  const value = summary.toUpperCase();
  if (value.includes("CROP PROGRESS")) return "CROP_PROGRESS";
  if (value.includes("PROSPECTIVE PLANTINGS")) return "PROSPECTIVE_PLANTINGS";
  return value.includes("WASDE")
    ? "WASDE"
    : value.includes("GRAIN STOCKS")
      ? "GRAIN_STOCKS"
      : value.includes("ACREAGE")
        ? "ACREAGE"
        : "OTHER";
}

function coverage({ manifests, retrievedAtUtc, coverageStart, coverageEnd }) {
  const qualified = qualifyGrainsCalendarEvidence({
    sources: manifests.map(sourceRecord), knownAtUtc: retrievedAtUtc,
    coverageStart, coverageEnd,
  });
  const sourceVersionHash = `sha256:${createHash("sha256")
    .update(
      manifests
        .map((item) => `${item.sourceId}|${item.sha256}|${JSON.stringify(item.coverage)}`)
        .sort()
        .join("|"),
    )
    .update(JSON.stringify({ coverageStart, coverageEnd }))
    .digest("hex")}`;
  return [
    {
      sourceId: "market_agri_events",
      sourceType: "AGRI_EVENT_CALENDAR",
      status: qualified.status,
      coverageStart: qualified.coverageStart,
      coverageEnd: qualified.coverageEnd,
      asOf: retrievedAtUtc,
      datasetVersion: sourceVersionHash,
      sourceVersionHash,
      provider: "USDA",
      reasonCodes: qualified.reasonCodes,
      sourceDiagnostics: qualified.sourceDiagnostics,
    },
  ];
}

function sourceRecord(manifest) {
  return {
    sourceId: manifest.sourceId,
    sourceUrl: manifest.sourceUrl,
    sourceDocumentSha256: manifest.sha256,
    retrievedAtUtc: manifest.retrieved_at_utc,
    knowledgeStatus: manifest.knowledge_status,
    historicalKnowledgeStatus: manifest.historical_knowledge_status,
    metadata: {
      source_kind: manifest.sourceKind,
      calendar_created_at_utc: manifest.calendar_created_at_utc,
      calendar_dtstamp_utc: manifest.calendar_dtstamp_utc,
      calendar_evidence_status: manifest.calendar_evidence_status,
      coverage: manifest.coverage,
    },
  };
}

function grainRelevant(summary) {
  return /WASDE|CROP PRODUCTION|GRAIN STOCKS|ACREAGE|CROP PROGRESS|PROSPECTIVE PLANTINGS/i.test(
    summary,
  );
}
function icsMetadata(text, field) {
  const value = text.match(
    new RegExp(`(?:^|\\n)${field}:(\\d{8}T\\d{6}Z)`),
  )?.[1];
  return value ? icsUtc(value, null) : null;
}
function icsUtc(value, timezone) {
  const match = String(value).match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/,
  );
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match
    .slice(1, 7)
    .map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  if (
    new Date(target).toISOString().replace(/[-:]/g, "").slice(0, 15) !==
    value.slice(0, 15)
  )
    return null;
  if (match[7]) return new Date(target).toISOString();
  if (!timezone) return null;
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    return null;
  }
  let instant = target;
  for (let index = 0; index < 3; index += 1) {
    instant += target - localEpoch(formatter, instant);
  }
  // A missing or repeated wall-clock time cannot be resolved silently.
  if (localEpoch(formatter, instant) !== target) return null;
  if (
    [-3600000, 3600000].some(
      (delta) => localEpoch(formatter, instant + delta) === target,
    )
  )
    return null;
  return new Date(instant).toISOString();
}

function localEpoch(formatter, instant) {
  const p = Object.fromEntries(
    formatter
      .formatToParts(new Date(instant))
      .map(({ type, value }) => [type, value]),
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}

function uniqueEvents(events) {
  const seen = new Map();
  for (const event of events) {
    const previous = seen.get(event.market_agri_event_id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(event))
      throw new Error("USDA_EVENT_ID_CONFLICT");
    seen.set(event.market_agri_event_id, event);
  }
  return [...seen.values()];
}

export async function fetchUsdaCalendarText(url, fetchImpl = fetch) {
  const response = await fetchResponse(url, fetchImpl);
  if (!response.ok) throw new Error(`USDA_CALENDAR_HTTP_${response.status}`);
  const mime = response.headers.get("content-type") || "";
  if (/html|json/i.test(mime))
    throw new Error("USDA_CALENDAR_CONTENT_TYPE_INVALID");
  return response.text();
}

export async function fetchUsdaSourceText(url, fetchImpl = fetch) {
  const response = await fetchResponse(url, fetchImpl);
  if (!response.ok) throw new Error(`USDA_SOURCE_HTTP_${response.status}`);
  const text = await response.text();
  if (!hasDocumentText(text)) throw new Error("USDA_SOURCE_DOCUMENT_EMPTY");
  return text;
}

function fetchResponse(url, fetchImpl) {
  return fetchImpl(url, { signal: AbortSignal.timeout(15000) });
}
