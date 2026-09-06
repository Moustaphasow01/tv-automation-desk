import { createHash } from "node:crypto";
import { qualifyGrainsCalendarEvidence } from "../grains-calendar-evidence.js";

// Market-data adapter for reviewed official documents, not a calendar bypass.
// The review manifest is an operator/research artifact, never a webhook payload.
export async function importGrainsCalendarEvidence({ manifest, retrievedAtUtc, readDocument }) {
  if (manifest?.schemaVersion !== "grains_calendar_evidence_manifest_v1")
    throw new Error("CALENDAR_EVIDENCE_SCHEMA_REQUIRED");
  const retrieved = timestamp(retrievedAtUtc);
  const documents = await Promise.all(manifest.sources.map(async (source) => {
    const bytes = await readDocument(source.documentFile);
    if (!bytes?.length || digest(bytes) !== source.documentSha256)
      throw new Error(`CALENDAR_DOCUMENT_HASH_MISMATCH:${source.sourceId}`);
    await validateVersionMetadata({ source, bytes, readDocument });
    return reviewedSource(source, retrieved);
  }));
  if (new Set(documents.map((item) => item.sourceId)).size !== documents.length)
    throw new Error("CALENDAR_DUPLICATE_SOURCE");
  const knownAtUtc = timestamp(Math.max(...documents.map((source) => Date.parse(source.metadata.schedule_known_at_utc))));
  const coverage = qualifyGrainsCalendarEvidence({
    sources: documents, knownAtUtc,
    coverageStart: manifest.coverageStart, coverageEnd: manifest.coverageEnd,
  });
  const events = reviewedEvents(manifest.sources, documents);
  const content = {
    schemaVersion: manifest.schemaVersion, coverage, knownAtUtc, events,
    sources: documents.map(({ retrievedAtUtc: ignored, ...source }) => source),
  };
  const hash = digest(JSON.stringify(content));
  return {
    knownAtUtc, status: coverage.status,
    coverageStart: coverage.coverageStart, coverageEnd: coverage.coverageEnd,
    sourceId: "market_agri_events", provider: "USDA",
    datasetVersion: hash, sourceVersionHash: hash,
    reasonCodes: coverage.reasonCodes, sources: documents, events,
    metadata: { evidence_schema_version: manifest.schemaVersion, source_diagnostics: coverage.sourceDiagnostics },
  };
}

function reviewedSource(source, retrievedAtUtc) {
  if (!source.documentFile || !source.review?.citation || !source.review?.scope)
    throw new Error("CALENDAR_DOCUMENT_REVIEW_REQUIRED");
  const url = new URL(source.sourceUrl);
  if (url.protocol !== "https:" || !/(^|\.)usda\.gov$/.test(url.hostname))
    throw new Error("CALENDAR_OFFICIAL_SOURCE_REQUIRED");
  const proof = source.historicalEvidence;
  const knownAtUtc = proof ? proofKnowledgeTime(proof) : retrievedAtUtc;
  if (Date.parse(knownAtUtc) > Date.parse(retrievedAtUtc))
    throw new Error("CALENDAR_PUBLICATION_AFTER_COLLECTION");
  return {
    sourceId: source.sourceId, sourceUrl: source.sourceUrl,
    sourceDocumentSha256: source.documentSha256, retrievedAtUtc,
    knowledgeStatus: proof ? "EXTERNAL_HISTORICAL_GAP" : "PROVEN_CURRENT",
    historicalKnowledgeStatus: proof ? "PROVEN_HISTORICAL" : "EXTERNAL_HISTORICAL_GAP",
    metadata: {
      calendar_evidence_status: "CALENDAR_SCHEDULE",
      coverage: source.coverage, historical_evidence: proof || null,
      schedule_known_at_utc: knownAtUtc,
      review: source.review, document_file: source.documentFile,
    },
  };
}

function proofKnowledgeTime(proof) {
  if (proof.kind === "OFFICIAL_VERSION_METADATA") {
    return timestamp(Math.max(Date.parse(proof.document_modified_at_utc), Date.parse(proof.server_last_modified_utc)));
  }
  return timestamp(proof.published_at_utc || proof.observed_at_utc);
}

async function validateVersionMetadata({ source, bytes, readDocument }) {
  const proof = source.historicalEvidence;
  if (proof?.kind !== "OFFICIAL_VERSION_METADATA") return;
  const headers = await readDocument(proof.headers_file);
  if (digest(headers) !== proof.headers_sha256) throw new Error("CALENDAR_HEADERS_HASH_MISMATCH");
  const modified = headers.toString("utf8").match(/^last-modified:\s*(.+)$/im)?.[1]?.trim();
  if (timestamp(modified) !== timestamp(proof.server_last_modified_utc))
    throw new Error("CALENDAR_SERVER_VERSION_DATE_MISMATCH");
  const metadataBytes = await readDocument(proof.metadata_file);
  if (digest(metadataBytes) !== proof.metadata_sha256) throw new Error("CALENDAR_METADATA_HASH_MISMATCH");
  const metadata = JSON.parse(metadataBytes.toString("utf8"));
  if (metadata.schemaVersion !== "grains_calendar_pdf_metadata_v1" || metadata.documentSha256 !== digest(bytes))
    throw new Error("CALENDAR_PDF_METADATA_NOT_BOUND_TO_DOCUMENT");
  if (timestamp(metadata.documentModifiedAtUtc) !== timestamp(proof.document_modified_at_utc))
    throw new Error("CALENDAR_PDF_VERSION_DATE_MISMATCH");
}

function reviewedEvents(sources, documents) {
  const seen = new Map();
  for (const source of sources) {
    const known = documents.find((item) => item.sourceId === source.sourceId).metadata.schedule_known_at_utc;
    for (const event of source.events || []) {
      if (!event.evidenceCitation) throw new Error("CALENDAR_EVENT_CITATION_REQUIRED");
      const row = {
        market_agri_event_id: event.eventId, event_kind: event.eventKind,
        title: event.title, importance: event.importance,
        event_timestamp_utc: timestamp(event.scheduledAtUtc),
        source_published_at_utc: known,
        provider: source.sourceId, source_url: source.sourceUrl,
        point_in_time_payload: {
          commodity_codes: event.instruments || ["ZC", "ZW"],
          evidence_citation: event.evidenceCitation,
          source_manifest_sha256: source.documentSha256,
        },
      };
      if (!row.market_agri_event_id || seen.has(row.market_agri_event_id))
        throw new Error("CALENDAR_EVENT_ID_CONFLICT");
      // Schedule imports cannot smuggle actuals, forecasts or revised values.
      if (event.actual !== undefined || event.result !== undefined || event.forecast !== undefined)
        throw new Error("CALENDAR_RESULT_REQUIRES_SEPARATE_PUBLICATION");
      seen.set(row.market_agri_event_id, row);
    }
  }
  return [...seen.values()].sort((a, b) => a.event_timestamp_utc.localeCompare(b.event_timestamp_utc) || a.market_agri_event_id.localeCompare(b.market_agri_event_id));
}

function timestamp(value) {
  const parsed = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("CALENDAR_EVIDENCE_TIMESTAMP_INVALID");
  return new Date(parsed).toISOString();
}
function digest(value) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
