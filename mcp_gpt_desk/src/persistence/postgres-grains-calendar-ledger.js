import { randomUUID } from "node:crypto";
import { applyGrainsCalendarFreshness } from "../grains-calendar-freshness.js";
import {
  qualifyGrainsCalendarEvidence,
  validateGrainsCalendarHistoricalEvidence,
} from "../grains-calendar-evidence.js";
import {
  GRAINS_CALENDAR_POLICY_V1,
  requireGrainsCalendarSourcePolicy,
} from "../grains-calendar-source-policy.js";

const CALENDAR_SOURCE_ID = "market_agri_events";

// Market-data boundary for immutable calendar knowledge.  Runtime consumers
// receive events from the selected source version, never the mutable current
// event projection.
export async function appendGrainsCalendarVersion(pool, calendar = {}) {
  const version = normalizeCalendarVersion(calendar);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await existingVersion(client, version);
    if (existing) {
      if (existing.contentFingerprint !== calendarContentFingerprint(version))
        throw new Error("CALENDAR_VERSION_HASH_CONFLICT");
      await client.query("COMMIT");
      return { version: existing.identity, inserted: false };
    }
    await insertVersion(client, version);
    await insertSources(client, version);
    await insertEvents(client, version);
    await client.query("COMMIT");
    return { version: versionIdentity(version), inserted: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function loadGrainsCalendarVersionAt(pool, query = {}) {
  const cutoff = requiredTimestamp(query.asOfUtc, "CALENDAR_CUTOFF_REQUIRED");
  const start = requiredTimestamp(query.startUtc, "CALENDAR_START_REQUIRED");
  const version = await selectedVersion(pool, cutoff);
  if (!version) return { agriEvents: [], agriCalendarCoverage: [] };
  if (version.ambiguous) {
    return { agriEvents: [], agriCalendarCoverage: [ambiguousCoverage(version)] };
  }
  const [sources, events] = await Promise.all([
    selectedSources(pool, version.market_agri_calendar_version_id),
    selectedEvents(pool, {
      versionId: version.market_agri_calendar_version_id,
      start,
      cutoff,
    }),
  ]);
  return {
    agriEvents: events.map((event) => mapEvent(event, cutoff)),
    agriCalendarCoverage: [applyGrainsCalendarFreshness(mapQualifiedCoverage(version, sources), {
      metadata: version.metadata, cutoff,
    })],
  };
}

function normalizeCalendarVersion(calendar) {
  const metadata = object(calendar.metadata);
  const policyId = metadata.source_policy_id || GRAINS_CALENDAR_POLICY_V1;
  requireGrainsCalendarSourcePolicy(policyId);
  const sourceVersionHash = requiredHash(
    calendar.sourceVersionHash,
    "CALENDAR_VERSION_HASH_REQUIRED",
  );
  const knownAtUtc = requiredTimestamp(
    calendar.knownAtUtc,
    "CALENDAR_KNOWN_AT_REQUIRED",
  );
  const sources = Array.isArray(calendar.sources)
    ? calendar.sources.map((source) => normalizeSource(source, knownAtUtc))
    : [];
  if (!sources.length) throw new Error("CALENDAR_SOURCES_REQUIRED");
  const normalized = {
    marketAgriCalendarVersionId:
      calendar.marketAgriCalendarVersionId || randomUUID(),
    sourceId: calendar.sourceId || CALENDAR_SOURCE_ID,
    sourceStatus: calendar.status || "UNKNOWN_COVERAGE",
    coverageStart: optionalTimestamp(calendar.coverageStart),
    coverageEnd: optionalTimestamp(calendar.coverageEnd),
    knownAtUtc,
    datasetVersion: requiredHash(
      calendar.datasetVersion || sourceVersionHash,
      "CALENDAR_DATASET_VERSION_REQUIRED",
    ),
    sourceVersionHash,
    provider: calendar.provider || null,
    reasonCodes: arrayOfStrings(calendar.reasonCodes),
    metadata,
    sources,
    events: Array.isArray(calendar.events)
      ? calendar.events.map((event) => normalizeEvent(event, knownAtUtc))
      : [],
  };
  if (normalized.sourceStatus === "AVAILABLE" && policyId !== GRAINS_CALENDAR_POLICY_V1) {
    const evidence = qualifyGrainsCalendarEvidence({
      sources: normalized.sources,
      knownAtUtc: normalized.knownAtUtc,
      coverageStart: normalized.coverageStart,
      coverageEnd: normalized.coverageEnd,
      policyId,
      fallbackEvidence: metadata.fas_failure_evidence,
    });
    if (evidence.status !== "AVAILABLE")
      throw new Error(evidence.reasonCodes[0] || "CALENDAR_EVIDENCE_INVALID");
  }
  return normalized;
}

function normalizeSource(source, knownAtUtc) {
  const retrievedAtUtc = requiredTimestamp(
    source.retrievedAtUtc || source.retrieved_at_utc,
    "CALENDAR_SOURCE_RETRIEVED_AT_REQUIRED",
  );
  const metadata = object(source.metadata);
  const knowledgeStatus = source.knowledgeStatus || source.knowledge_status || "PROVEN_CURRENT";
  const historicalKnowledgeStatus = source.historicalKnowledgeStatus || source.historical_knowledge_status || "EXTERNAL_HISTORICAL_GAP";
  const normalized = {
    sourceId: requiredText(source.sourceId, "CALENDAR_SOURCE_ID_REQUIRED"),
    sourceUrl: requiredText(source.sourceUrl, "CALENDAR_SOURCE_URL_REQUIRED"),
    sourceDocumentSha256: requiredHash(
      source.sourceDocumentSha256 || source.sha256,
      "CALENDAR_SOURCE_HASH_REQUIRED",
    ),
    retrievedAtUtc,
    knowledgeStatus,
    historicalKnowledgeStatus,
    metadata,
  };
  rejectInvalidHistoricalKnowledge(normalized, knownAtUtc);
  return normalized;
}

function rejectInvalidHistoricalKnowledge(source, knownAtUtc) {
  const retrievedAfterKnowledge = Date.parse(source.retrievedAtUtc) > Date.parse(knownAtUtc);
  const claimsHistoricalKnowledge = source.historicalKnowledgeStatus === "PROVEN_HISTORICAL";
  if (!claimsHistoricalKnowledge && retrievedAfterKnowledge)
    throw new Error("CALENDAR_SOURCE_AFTER_KNOWLEDGE_WITHOUT_HISTORICAL_PROOF");
  if (!claimsHistoricalKnowledge) return;
  const proof = validateGrainsCalendarHistoricalEvidence({ source, knownAtUtc });
  if (!proof.valid) throw new Error(proof.reasonCodes[0]);
}

function normalizeEvent(event, knownAtUtc) {
  const sourcePublishedAtUtc = requiredTimestamp(
    event.source_published_at_utc || knownAtUtc,
    "CALENDAR_EVENT_KNOWN_AT_REQUIRED",
  );
  if (Date.parse(sourcePublishedAtUtc) > Date.parse(knownAtUtc)) {
    throw new Error("CALENDAR_EVENT_AFTER_VERSION_KNOWLEDGE");
  }
  return {
    marketAgriEventId: requiredText(
      event.market_agri_event_id,
      "CALENDAR_EVENT_ID_REQUIRED",
    ),
    eventKind: requiredText(event.event_kind, "CALENDAR_EVENT_KIND_REQUIRED"),
    title: requiredText(event.title, "CALENDAR_EVENT_TITLE_REQUIRED"),
    eventTimestampUtc: requiredTimestamp(
      event.event_timestamp_utc,
      "CALENDAR_EVENT_TIME_REQUIRED",
    ),
    importance: requiredText(
      event.importance,
      "CALENDAR_EVENT_IMPORTANCE_REQUIRED",
    ),
    sourceProvider: requiredText(
      event.provider || event.source_provider,
      "CALENDAR_EVENT_PROVIDER_REQUIRED",
    ),
    sourceUrl: event.source_url || null,
    sourcePublishedAtUtc,
    pointInTimePayload: object(event.point_in_time_payload),
  };
}

async function existingVersion(client, version) {
  const result = await client.query(
    `SELECT market_agri_calendar_version_id, source_id, source_status, coverage_start_utc, coverage_end_utc,
            known_at_utc, dataset_version, source_version_hash, provider, reason_codes, metadata
       FROM market_agri_calendar_versions
      WHERE source_id=$1 AND source_version_hash=$2`,
    [version.sourceId, version.sourceVersionHash],
  );
  const row = result.rows[0];
  if (!row) return null;
  const [sources, events] = await Promise.all([
    client.query(`SELECT source_id,source_url,source_document_sha256,retrieved_at_utc,knowledge_status,historical_knowledge_status,metadata
      FROM market_agri_calendar_version_sources WHERE market_agri_calendar_version_id=$1`, [row.market_agri_calendar_version_id]),
    client.query(`SELECT market_agri_event_id,event_kind,title,event_timestamp_utc,importance,source_provider,source_url,source_published_at_utc,point_in_time_payload
      FROM market_agri_calendar_version_events WHERE market_agri_calendar_version_id=$1`, [row.market_agri_calendar_version_id]),
  ]);
  return { identity: mapVersionIdentity(row), contentFingerprint: calendarContentFingerprint({
    sourceId: row.source_id, sourceStatus: row.source_status, coverageStart: row.coverage_start_utc,
    coverageEnd: row.coverage_end_utc, datasetVersion: row.dataset_version, sourceVersionHash: row.source_version_hash,
    provider: row.provider, reasonCodes: row.reason_codes, metadata: row.metadata,
    sources: sources.rows.map(mapStoredSource), events: events.rows.map(mapStoredEvent),
  }) };
}

async function insertVersion(client, version) {
  await client.query(
    `INSERT INTO market_agri_calendar_versions (
      market_agri_calendar_version_id,source_id,source_status,coverage_start_utc,coverage_end_utc,
      known_at_utc,dataset_version,source_version_hash,provider,reason_codes,metadata
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
    [
      version.marketAgriCalendarVersionId,
      version.sourceId,
      version.sourceStatus,
      version.coverageStart,
      version.coverageEnd,
      version.knownAtUtc,
      version.datasetVersion,
      version.sourceVersionHash,
      version.provider,
      version.reasonCodes,
      JSON.stringify(version.metadata),
    ],
  );
}

async function insertSources(client, version) {
  for (const source of version.sources) {
    await client.query(
      `INSERT INTO market_agri_calendar_version_sources (
        market_agri_calendar_version_id,source_id,source_url,source_document_sha256,retrieved_at_utc,
        knowledge_status,historical_knowledge_status,metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [
        version.marketAgriCalendarVersionId,
        source.sourceId,
        source.sourceUrl,
        source.sourceDocumentSha256,
        source.retrievedAtUtc,
        source.knowledgeStatus,
        source.historicalKnowledgeStatus,
        JSON.stringify(source.metadata),
      ],
    );
  }
}

async function insertEvents(client, version) {
  for (const event of version.events) {
    await client.query(
      `INSERT INTO market_agri_calendar_version_events (
        market_agri_calendar_version_id,market_agri_event_id,event_kind,title,event_timestamp_utc,
        importance,source_provider,source_url,source_published_at_utc,point_in_time_payload
      ) VALUES ($1,$2,$3::market_agri_event_kind,$4,$5,$6::market_agri_event_importance,$7,$8,$9,$10::jsonb)`,
      [
        version.marketAgriCalendarVersionId,
        event.marketAgriEventId,
        event.eventKind,
        event.title,
        event.eventTimestampUtc,
        event.importance,
        event.sourceProvider,
        event.sourceUrl,
        event.sourcePublishedAtUtc,
        JSON.stringify(event.pointInTimePayload),
      ],
    );
  }
}

async function selectedVersion(pool, cutoff) {
  const result = await pool.query(
    `WITH eligible AS (
       SELECT market_agri_calendar_version_id,source_id,source_status,coverage_start_utc,coverage_end_utc,
              known_at_utc,dataset_version,source_version_hash,provider,reason_codes,metadata,
              max(known_at_utc) OVER () AS latest_known_at_utc
         FROM market_agri_calendar_versions
        WHERE source_id=$1 AND known_at_utc <= $2::timestamptz
     ) SELECT * FROM eligible WHERE known_at_utc=latest_known_at_utc
       ORDER BY market_agri_calendar_version_id`,
    [CALENDAR_SOURCE_ID, cutoff],
  );
  if (result.rows.length > 1) return { ambiguous: true, knownAtUtc: result.rows[0].known_at_utc };
  return result.rows[0] || null;
}

async function selectedSources(pool, versionId) {
  const result = await pool.query(
    `SELECT source_id,source_url,source_document_sha256,retrieved_at_utc,knowledge_status,historical_knowledge_status,
            metadata
       FROM market_agri_calendar_version_sources
      WHERE market_agri_calendar_version_id=$1 ORDER BY source_id`,
    [versionId],
  );
  return result.rows;
}

async function selectedEvents(pool, { versionId, start, cutoff }) {
  const result = await pool.query(
    `SELECT event.market_agri_event_id,event.event_kind,event.title,event.event_timestamp_utc,event.importance,
            event.source_provider,event.source_url,event.source_published_at_utc,event.point_in_time_payload,
            version.known_at_utc AS calendar_version_known_at_utc
       FROM market_agri_calendar_version_events event
       JOIN market_agri_calendar_versions version
         ON version.market_agri_calendar_version_id=event.market_agri_calendar_version_id
      WHERE event.market_agri_calendar_version_id=$1 AND event.event_timestamp_utc >= $2::timestamptz
        AND event.event_timestamp_utc <= $3::timestamptz + interval '14 days'
        AND event.source_published_at_utc <= $3::timestamptz
      ORDER BY event.event_timestamp_utc,event.market_agri_event_id`,
    [versionId, start, cutoff],
  );
  return result.rows;
}

function mapQualifiedCoverage(version, sources) {
  const policyId = object(version.metadata).source_policy_id || GRAINS_CALENDAR_POLICY_V1;
  const evidence = qualifyGrainsCalendarEvidence({
    sources: sources.map(mapStoredSource),
    knownAtUtc: version.known_at_utc,
    coverageStart: version.coverage_start_utc,
    coverageEnd: version.coverage_end_utc,
    policyId,
    fallbackEvidence: object(version.metadata).fas_failure_evidence,
  });
  const reasons = new Set([...(version.reason_codes || []), ...evidence.reasonCodes]);
  return {
    sourceId: version.source_id,
    sourceType: "AGRI_EVENT_CALENDAR",
    status: persistedCoverageStatus(version.source_status, evidence.status),
    coverageStart: evidence.coverageStart,
    coverageEnd: evidence.coverageEnd,
    asOf: isoOrNull(version.known_at_utc),
    datasetVersion: version.dataset_version,
    sourceVersionHash: version.source_version_hash,
    provider: version.provider,
    reasonCodes: [...reasons].sort(),
  };
}

function ambiguousCoverage(version) {
  return {
    sourceId: CALENDAR_SOURCE_ID, sourceType: "AGRI_EVENT_CALENDAR", status: "UNKNOWN_COVERAGE",
    coverageStart: null, coverageEnd: null, asOf: isoOrNull(version.knownAtUtc),
    datasetVersion: null, sourceVersionHash: null, provider: null,
    reasonCodes: ["CALENDAR_VERSION_AMBIGUOUS"],
  };
}

function mapEvent(row, cutoff) {
  const commodityCodes = publicCommodityCodes(row.point_in_time_payload);
  const event = {
    market_agri_event_id: row.market_agri_event_id,
    event_kind: row.event_kind,
    title: row.title,
    importance: row.importance,
    event_timestamp_utc: isoOrNull(row.event_timestamp_utc),
    source_published_at_utc: isoOrNull(row.source_published_at_utc),
    calendar_version_known_at_utc: isoOrNull(row.calendar_version_known_at_utc),
    provider: row.source_provider,
    source_url: row.source_url || null,
    ...(commodityCodes ? { commodity_codes: commodityCodes } : {}),
  };
  const result = publicResultAtCutoff({
    payload: row.point_in_time_payload,
    eventTimestampUtc: row.event_timestamp_utc,
    versionKnownAtUtc: row.calendar_version_known_at_utc,
    cutoff,
  });
  return result ? { ...event, result } : event;
}

function publicCommodityCodes(payload) {
  const codes = object(payload).commodity_codes;
  if (!Array.isArray(codes) || !codes.every((code) => typeof code === "string" && code.trim()))
    return null;
  return [...new Set(codes.map((code) => code.trim().toUpperCase()))];
}

function persistedCoverageStatus(sourceStatus, evidenceStatus) {
  return sourceStatus === "AVAILABLE" && evidenceStatus === "AVAILABLE"
    ? "AVAILABLE"
    : sourceStatus === "AVAILABLE" ? "UNKNOWN_COVERAGE" : sourceStatus;
}

function publicResultAtCutoff({ payload, eventTimestampUtc, versionKnownAtUtc, cutoff }) {
  const result = object(payload).result;
  const availableAtUtc = safeTimestamp(result?.availableAtUtc);
  if (!availableAtUtc || !isObject(result?.values)) return null;
  const availableAfterEvent = Math.max(
    Date.parse(eventTimestampUtc),
    Date.parse(availableAtUtc),
  );
  if (Date.parse(availableAtUtc) > Date.parse(versionKnownAtUtc)) return null;
  if (Date.parse(cutoff) < availableAfterEvent) return null;
  return { availableAtUtc, values: result.values };
}

function safeTimestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function versionIdentity(version) {
  return {
    marketAgriCalendarVersionId: version.marketAgriCalendarVersionId,
    sourceId: version.sourceId,
    sourceVersionHash: version.sourceVersionHash,
    knownAtUtc: version.knownAtUtc,
  };
}

function mapVersionIdentity(row) {
  return {
    marketAgriCalendarVersionId: row.market_agri_calendar_version_id,
    sourceId: row.source_id,
    sourceVersionHash: row.source_version_hash,
    knownAtUtc: isoOrNull(row.known_at_utc),
  };
}

function mapStoredSource(source) {
  return {
    sourceId: source.source_id, sourceUrl: source.source_url, sourceDocumentSha256: source.source_document_sha256,
    retrievedAtUtc: source.retrieved_at_utc, knowledgeStatus: source.knowledge_status,
    historicalKnowledgeStatus: source.historical_knowledge_status, metadata: source.metadata,
  };
}

function mapStoredEvent(event) {
  return {
    marketAgriEventId: event.market_agri_event_id, eventKind: event.event_kind, title: event.title,
    eventTimestampUtc: event.event_timestamp_utc, importance: event.importance, sourceProvider: event.source_provider,
    sourceUrl: event.source_url, sourcePublishedAtUtc: event.source_published_at_utc,
    pointInTimePayload: event.point_in_time_payload,
  };
}

function calendarContentFingerprint(version) {
  return stableJson({
    sourceId: version.sourceId, sourceStatus: version.sourceStatus, coverageStart: isoOrNull(version.coverageStart),
    coverageEnd: isoOrNull(version.coverageEnd), datasetVersion: version.datasetVersion, sourceVersionHash: version.sourceVersionHash,
    provider: version.provider, reasonCodes: [...(version.reasonCodes || [])].sort(), metadata: version.metadata,
    sources: version.sources.map(contentSource).sort(byJson), events: version.events.map(contentEvent).sort(byJson),
  });
}

function contentSource(source) {
  return {
    sourceId: source.sourceId, sourceUrl: source.sourceUrl, sourceDocumentSha256: source.sourceDocumentSha256,
    knowledgeStatus: source.knowledgeStatus, historicalKnowledgeStatus: source.historicalKnowledgeStatus,
    metadata: source.metadata,
  };
}

function contentEvent(event) {
  return {
    marketAgriEventId: event.marketAgriEventId, eventKind: event.eventKind, title: event.title,
    eventTimestampUtc: isoOrNull(event.eventTimestampUtc), importance: event.importance, sourceProvider: event.sourceProvider,
    sourceUrl: event.sourceUrl, pointInTimePayload: event.pointInTimePayload,
  };
}

function requiredText(value, code) {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}

function requiredHash(value, code) {
  const hash = requiredText(value, code);
  if (!/^sha256:[a-f0-9]{64}$/.test(hash)) throw new Error(code);
  return hash;
}

function requiredTimestamp(value, code) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(code);
  return new Date(parsed).toISOString();
}

function optionalTimestamp(value) {
  return value === null || value === undefined
    ? null
    : requiredTimestamp(value, "CALENDAR_TIMESTAMP_INVALID");
}

function arrayOfStrings(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string")
    : [];
}

function object(value) {
  return isObject(value)
    ? value
    : {};
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

function byJson(left, right) { return stableJson(left).localeCompare(stableJson(right)); }

function isoOrNull(value) {
  return value ? new Date(value).toISOString() : null;
}
