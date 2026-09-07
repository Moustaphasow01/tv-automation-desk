import { createHash } from "node:crypto";
import { qualifyGrainsCalendarEvidence } from "../grains-calendar-evidence.js";
import {
  DORMAN_CALENDAR_SOURCE_ID,
  GRAINS_CALENDAR_POLICY_V1,
  GRAINS_CALENDAR_POLICY_V2,
} from "../grains-calendar-source-policy.js";
import { parseUsdaGrainsCalendarDocument } from "./usda-grains-calendar-document-parser.js";

const FETCH_TIMEOUT_MS = 15000, MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export async function collectUsdaGrainsCalendar({
  sources,
  retrievedAtUtc,
  fetchText,
  coverageStart = null,
  coverageEnd = null,
  policyId = GRAINS_CALENDAR_POLICY_V1,
}) {
  if (!Number.isFinite(Date.parse(retrievedAtUtc)))
    throw new Error("USDA_RETRIEVAL_TIME_REQUIRED");
  if (!Array.isArray(sources) || !sources.length)
    throw new Error("USDA_CALENDAR_SOURCES_REQUIRED");
  if (typeof fetchText !== "function")
    throw new Error("USDA_CALENDAR_FETCH_REQUIRED");
  const results = await Promise.all(sources.map((source) => collectSource({
    source, retrievedAtUtc, fetchText, coverageStart, coverageEnd,
  })));
  return assembleGrainsCalendarCollection({
    manifests: results.map(({ manifest }) => manifest),
    agriEvents: results.flatMap(({ events }) => events),
    retrievedAtUtc, coverageStart, coverageEnd, policyId,
  });
}

export function assembleGrainsCalendarCollection({
  manifests,
  agriEvents,
  retrievedAtUtc,
  coverageStart,
  coverageEnd,
  policyId = GRAINS_CALENDAR_POLICY_V1,
  fallbackEvidence = null,
}) {
  const reconciliation = reconcileEvents({
    events: agriEvents, coverageStart, coverageEnd, policyId,
  });
  const events = uniqueEvents(reconciliation.events);
  const agriCalendarCoverage = calendarCoverage({
    manifests, retrievedAtUtc, coverageStart, coverageEnd, policyId,
    fallbackEvidence,
    reconciliationReasonCodes: reconciliation.reasonCodes,
  });
  return { manifests, agriEvents: events, agriCalendarCoverage,
    calendarVersion: calendarVersionInput({
      manifests,
      agriEvents: events,
      coverage: agriCalendarCoverage[0],
      retrievedAtUtc,
      policyId,
      fallbackEvidence,
    }),
  };
}

async function collectSource(command) {
  const { source, retrievedAtUtc, fetchText, coverageStart, coverageEnd } = command;
  const text = await fetchText(source.url, source);
  if (typeof text !== "string" || !text.trim())
    throw new Error("USDA_SOURCE_DOCUMENT_INVALID");
  const hash = createHash("sha256").update(text).digest("hex");
  const parsed = parseUsdaGrainsCalendarDocument({
    text, source, retrievedAtUtc, coverageStart, coverageEnd, hash,
  });
  return {
    manifest: manifest({ source, text, retrievedAtUtc, hash, parsed }),
    events: parsed.events,
  };
}

function manifest({ source, text, retrievedAtUtc, hash, parsed }) {
  return {
    sourceId: source.sourceId,
    sourceUrl: source.url,
    sourceKind: source.sourceKind,
    sha256: `sha256:${hash}`,
    retrieved_at_utc: retrievedAtUtc,
    knowledge_status: "PROVEN_CURRENT",
    historical_knowledge_status: "EXTERNAL_HISTORICAL_GAP",
    calendar_created_at_utc: parsed.calendarCreatedAtUtc,
    calendar_dtstamp_utc: parsed.calendarDtstampUtc,
    calendar_evidence_status: parsed.evidenceStatus,
    coverage: parsed.coverage,
    source_scope: source.scope || null,
    expected_year: source.expectedYear || null,
    document_years: parsed.documentYears,
    pagination_detected: parsed.paginationDetected,
    requested_window_covered: parsed.requestedWindowCovered,
    source_document: text,
    document_size_bytes: Buffer.byteLength(text),
  };
}

function calendarVersionInput({ manifests, agriEvents, coverage, retrievedAtUtc, policyId,
  fallbackEvidence }) {
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
    metadata: {
      source_policy_id: policyId,
      ...(fallbackEvidence ? { fas_failure_evidence: fallbackEvidence } : {}),
    },
  };
}

function calendarCoverage({ manifests, retrievedAtUtc, coverageStart, coverageEnd,
  policyId, fallbackEvidence, reconciliationReasonCodes }) {
  const qualified = qualifyGrainsCalendarEvidence({
    sources: manifests.map(sourceRecord),
    knownAtUtc: retrievedAtUtc,
    coverageStart,
    coverageEnd,
    policyId,
    fallbackEvidence,
  });
  const reasonCodes = uniqueStrings([
    ...qualified.reasonCodes,
    ...reconciliationReasonCodes,
  ]);
  const sourceVersionHash = versionHash(
    manifests, coverageStart, coverageEnd, policyId, fallbackEvidence,
  );
  return [{
    sourceId: "market_agri_events",
    sourceType: "AGRI_EVENT_CALENDAR",
    status: reasonCodes.length ? "UNKNOWN_COVERAGE" : qualified.status,
    coverageStart: qualified.coverageStart,
    coverageEnd: qualified.coverageEnd,
    asOf: retrievedAtUtc,
    datasetVersion: sourceVersionHash,
    sourceVersionHash,
    provider: collectionProvider(manifests),
    reasonCodes,
    sourceDiagnostics: qualified.sourceDiagnostics,
  }];
}

function versionHash(manifests, coverageStart, coverageEnd, policyId, fallbackEvidence) {
  return `sha256:${createHash("sha256")
    .update(manifests.map((item) =>
      `${item.sourceId}|${item.sha256}|${JSON.stringify(item.coverage)}`)
      .sort().join("|"))
    .update(JSON.stringify({
      coverageStart, coverageEnd, policyId,
      fallbackEvidenceHash: fallbackEvidence?.observation_sha256 || null,
    }))
    .digest("hex")}`;
}

function reconcileEvents({ events, coverageStart, coverageEnd, policyId }) {
  if (policyId !== GRAINS_CALENDAR_POLICY_V2)
    return { events, reasonCodes: [] };
  const direct = events.filter((event) =>
    event.event_kind === "EXPORT_SALES" && event.provider === "USDA_FAS");
  const secondary = events.filter((event) =>
    event.event_kind === "EXPORT_SALES" && event.provider === "DORMAN_TRADING");
  const nonExport = events.filter((event) => event.event_kind !== "EXPORT_SALES");
  if (!direct.length) return { events: [...nonExport, ...secondary], reasonCodes: [] };
  if (!secondary.length) return { events: [...nonExport, ...direct], reasonCodes: [] };
  const timestamps = (values) => values
    .filter((event) => inWindow(event.event_timestamp_utc, coverageStart, coverageEnd))
    .map((event) => event.event_timestamp_utc).sort();
  const matches = JSON.stringify(timestamps(direct)) === JSON.stringify(timestamps(secondary));
  return {
    events: [...nonExport, ...direct],
    reasonCodes: matches ? [] : ["CALENDAR_EXPORT_SALES_SOURCE_CONFLICT"],
  };
}

function inWindow(value, start, end) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    && timestamp >= Date.parse(start) && timestamp <= Date.parse(end);
}

function collectionProvider(manifests) {
  return manifests.some((item) => item.sourceId === DORMAN_CALENDAR_SOURCE_ID)
    ? "USDA+DORMAN_SECONDARY" : "USDA";
}

function uniqueStrings(values) { return [...new Set(values)].sort(); }

function sourceRecord(item) {
  return {
    sourceId: item.sourceId,
    sourceUrl: item.sourceUrl,
    sourceDocumentSha256: item.sha256,
    retrievedAtUtc: item.retrieved_at_utc,
    knowledgeStatus: item.knowledge_status,
    historicalKnowledgeStatus: item.historical_knowledge_status,
    metadata: {
      source_kind: item.sourceKind,
      source_scope: item.source_scope,
      expected_year: item.expected_year,
      document_years: item.document_years,
      pagination_detected: item.pagination_detected,
      requested_window_covered: item.requested_window_covered,
      calendar_created_at_utc: item.calendar_created_at_utc,
      calendar_dtstamp_utc: item.calendar_dtstamp_utc,
      calendar_evidence_status: item.calendar_evidence_status,
      coverage: item.coverage,
      authority_class: item.authority_class,
      provider: item.provider,
      upstream_claim: item.upstream_claim,
      source_policy_id: item.source_policy_id,
      document_receipts: item.document_receipts,
    },
  };
}

function uniqueEvents(events) {
  const seen = new Map();
  for (const event of events) {
    const previous = seen.get(event.market_agri_event_id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(event))
      throw new Error("USDA_EVENT_ID_CONFLICT");
    seen.set(event.market_agri_event_id, event);
  }
  return [...seen.values()].sort((left, right) =>
    left.event_timestamp_utc.localeCompare(right.event_timestamp_utc)
      || left.market_agri_event_id.localeCompare(right.market_agri_event_id));
}

export async function fetchUsdaCalendarText(url, fetchImpl = fetch) {
  return fetchBoundedText({
    url, fetchImpl, errorPrefix: "USDA_CALENDAR",
    validMime: (mime) => !/html|json/i.test(mime),
  });
}

export async function fetchUsdaSourceText(url, fetchImpl = fetch) {
  return fetchBoundedText({
    url, fetchImpl, errorPrefix: "USDA_SOURCE",
    validMime: (mime) => !mime || /text|html|calendar|json|xml/i.test(mime),
  });
}

async function fetchBoundedText({ url, fetchImpl, errorPrefix, validMime }) {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const response = await fetchWithRedirects({ url, fetchImpl, signal });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`${errorPrefix}_HTTP_${response.status}`);
  }
  const mime = response.headers.get("content-type") || "";
  if (!validMime(mime)) {
    await response.body?.cancel();
    throw new Error(`${errorPrefix}_CONTENT_TYPE_INVALID`);
  }
  const statedSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(statedSize) && statedSize > MAX_DOCUMENT_BYTES) {
    await response.body?.cancel();
    throw new Error(`${errorPrefix}_DOCUMENT_TOO_LARGE`);
  }
  const bytes = await readBoundedBody(response, errorPrefix);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new Error(`${errorPrefix}_DOCUMENT_ENCODING_INVALID`, { cause });
  }
  if (!text.trim()) throw new Error(`${errorPrefix}_DOCUMENT_EMPTY`);
  return text;
}

async function fetchWithRedirects({ url, fetchImpl, signal }) {
  let current = httpsUrl(url);
  for (let count = 0; count <= MAX_REDIRECTS; count += 1) {
    const response = await fetchImpl(current.href, { signal, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new Error("USDA_SOURCE_REDIRECT_LOCATION_REQUIRED");
    if (count === MAX_REDIRECTS) throw new Error("USDA_SOURCE_REDIRECT_LIMIT");
    const next = httpsUrl(new URL(location, current).href);
    if (!allowedRedirect(current, next)) throw new Error("USDA_SOURCE_REDIRECT_FORBIDDEN");
    current = next;
  }
  throw new Error("USDA_SOURCE_REDIRECT_LIMIT");
}

async function readBoundedBody(response, errorPrefix) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_DOCUMENT_BYTES) {
      await reader.cancel();
      throw new Error(`${errorPrefix}_DOCUMENT_TOO_LARGE`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function httpsUrl(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") throw new Error("USDA_SOURCE_HTTPS_REQUIRED");
  if (parsed.username || parsed.password) throw new Error("USDA_SOURCE_CREDENTIALS_FORBIDDEN");
  return parsed;
}

function allowedRedirect(current, next) {
  if (current.hostname === next.hostname) return true;
  return usdaHost(current.hostname) && usdaHost(next.hostname);
}

function usdaHost(hostname) {
  return hostname === "usda.gov" || hostname.endsWith(".usda.gov");
}
