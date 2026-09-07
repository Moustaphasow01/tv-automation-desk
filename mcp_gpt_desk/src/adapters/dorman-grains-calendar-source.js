import { createHash } from "node:crypto";
import {
  DORMAN_CALENDAR_SOURCE_ID,
  GRAINS_CALENDAR_POLICY_V2,
} from "../grains-calendar-source-policy.js";
import { parseDormanCalendarPdf } from "./dorman-grains-calendar-document-parser.js";

const DORMAN_HOST = "www.dormantrading.com";
const DORMAN_INDEX_URL =
  "https://www.dormantrading.com/trading-resources/market-calendar/";
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 3;
const MONTH_SUFFIXES = Object.freeze([
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]);

export async function collectDormanGrainsCalendar({
  expectedYear,
  coverageStart,
  coverageEnd,
  nowUtc,
  archiveDocument,
  fetchBytes = fetchDormanCalendarBytes,
  parsePdf = parseDormanCalendarPdf,
}) {
  if (!Number.isInteger(expectedYear) || expectedYear < 2020 || expectedYear > 2100)
    throw new Error("CALENDAR_DORMAN_YEAR_INVALID");
  if (typeof nowUtc !== "function" || typeof archiveDocument !== "function")
    throw new Error("CALENDAR_DORMAN_PORTS_REQUIRED");
  const window = requiredWindow(coverageStart, coverageEnd);
  const index = await collectIndex({ expectedYear, fetchBytes, nowUtc, archiveDocument });
  const documents = [];
  for (const monthIndex of coveredMonthIndexes(window, expectedYear))
    documents.push(await collectPdf({
      expectedYear, monthIndex, url: index.links[monthIndex], fetchBytes,
      nowUtc, archiveDocument, parsePdf,
    }));
  if (!documents.length) throw new Error("CALENDAR_DORMAN_DOCUMENTS_REQUIRED");
  return assembledCollection({ expectedYear, window, index, documents });
}

async function collectIndex({ expectedYear, fetchBytes, nowUtc, archiveDocument }) {
  const source = dormanIndexSource(expectedYear);
  const fetched = await fetchBytes(source.url, { kind: "INDEX", expectedYear });
  const receivedAtUtc = receiptTime(nowUtc());
  const hash = digest(fetched.bytes);
  const receiptRef = await archiveDocument({ source, bytes: fetched.bytes, receivedAtUtc });
  const text = decodeUtf8(fetched.bytes, "CALENDAR_DORMAN_INDEX_ENCODING_INVALID");
  return {
    source, hash, receivedAtUtc, receiptRef,
    links: parseDormanAnnualPdfLinks(text, expectedYear),
  };
}

async function collectPdf({ expectedYear, monthIndex, url, fetchBytes,
  nowUtc, archiveDocument, parsePdf }) {
  const source = dormanPdfSource({ expectedYear, monthIndex, url });
  const fetched = await fetchBytes(source.url, { kind: "PDF", expectedYear, monthIndex });
  if (!pdfMagic(fetched.bytes)) throw new Error("CALENDAR_DORMAN_PDF_MAGIC_INVALID");
  // Hash and immutable receipt precede parser transfer. unpdf may detach its input buffer.
  const hash = digest(fetched.bytes);
  const receivedAtUtc = receiptTime(nowUtc());
  const receiptRef = await archiveDocument({ source, bytes: fetched.bytes, receivedAtUtc });
  const parsed = await parsePdf({
    bytes: Uint8Array.from(fetched.bytes), source, retrievedAtUtc: receivedAtUtc, hash,
  });
  return { source, hash, receivedAtUtc, receiptRef, parsed };
}

function assembledCollection({ expectedYear, window, index, documents }) {
  const coverage = mergedCoverage(documents.map((item) => item.parsed.coverage));
  if (Date.parse(coverage.start_utc) > Date.parse(window.start)
    || Date.parse(coverage.end_utc) < Date.parse(window.end))
    throw new Error("CALENDAR_DORMAN_WINDOW_NOT_COVERED");
  const receipts = [receiptRecord(index), ...documents.map((item) => receiptRecord(item))];
  const retrievedAtUtc = receipts.map((item) => item.received_at_utc).sort().at(-1);
  const compositeHash = digest(JSON.stringify(receipts.map((item) => ({
    source_url: item.source_url, document_sha256: item.document_sha256,
  }))));
  return {
    manifest: {
      sourceId: DORMAN_CALENDAR_SOURCE_ID,
      sourceUrl: index.source.url,
      sourceKind: "DORMAN_TRADING_CALENDAR_PDF_SET",
      sha256: `sha256:${compositeHash}`,
      retrieved_at_utc: retrievedAtUtc,
      knowledge_status: "PROVEN_CURRENT",
      historical_knowledge_status: "EXTERNAL_HISTORICAL_GAP",
      calendar_evidence_status: "CALENDAR_SCHEDULE",
      coverage,
      source_scope: index.source.scope,
      expected_year: expectedYear,
      document_years: [expectedYear],
      pagination_detected: false,
      requested_window_covered: true,
      authority_class: "SECONDARY_PUBLISHER",
      provider: "DORMAN_TRADING",
      upstream_claim: "USDA",
      source_policy_id: GRAINS_CALENDAR_POLICY_V2,
      document_receipts: receipts,
    },
    events: documents.flatMap((item) => item.parsed.events),
  };
}

export function parseDormanAnnualPdfLinks(html, expectedYear) {
  if (typeof html !== "string" || !html.trim())
    throw new Error("CALENDAR_DORMAN_INDEX_INVALID");
  const links = new Map();
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const value = match[1].replaceAll("&amp;", "&");
    if (!value.includes(`Dorman-Trading-Calendar-${expectedYear}-`)) continue;
    let url;
    try { url = new URL(value, DORMAN_INDEX_URL); }
    catch { continue; }
    const parsed = permittedDormanUrl(url.href, { kind: "PDF", expectedYear });
    const suffix = parsed.pathname.match(/-([A-Z][a-z]{2})\.pdf$/)?.[1];
    const monthIndex = MONTH_SUFFIXES.indexOf(suffix);
    if (monthIndex < 0) continue;
    if (links.has(monthIndex))
      throw new Error("CALENDAR_DORMAN_MONTH_LINK_AMBIGUOUS");
    links.set(monthIndex, parsed.href);
  }
  if (links.size !== 12 || MONTH_SUFFIXES.some((_, index) => !links.has(index)))
    throw new Error("CALENDAR_DORMAN_ANNUAL_INDEX_INCOMPLETE");
  return MONTH_SUFFIXES.map((_, index) => links.get(index));
}

export async function fetchDormanCalendarBytes(url, scope, fetchImpl = fetch) {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let current = permittedDormanUrl(url, scope);
  for (let count = 0; count <= MAX_REDIRECTS; count += 1) {
    const response = await fetchImpl(current.href, { redirect: "manual", signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || count === MAX_REDIRECTS)
        throw new Error("CALENDAR_DORMAN_REDIRECT_INVALID");
      current = permittedDormanUrl(new URL(location, current).href, scope);
      continue;
    }
    const bytes = await validatedResponseBytes(response, scope);
    return { bytes, finalUrl: current.href };
  }
  throw new Error("CALENDAR_DORMAN_REDIRECT_INVALID");
}

async function validatedResponseBytes(response, scope) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`CALENDAR_DORMAN_HTTP_${response.status}`);
  }
  const mime = response.headers.get("content-type") || "";
  const validPdf = scope.kind !== "PDF" || /application\/pdf/i.test(mime);
  const validIndex = scope.kind !== "INDEX" || !mime || /text\/html/i.test(mime);
  if (!validPdf || !validIndex) {
    await response.body?.cancel();
    throw new Error("CALENDAR_DORMAN_CONTENT_TYPE_INVALID");
  }
  return boundedBody(response);
}

function permittedDormanUrl(value, scope) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password
    || url.hostname !== DORMAN_HOST || url.port || url.search || url.hash)
    throw new Error("CALENDAR_DORMAN_URL_FORBIDDEN");
  if (scope.kind === "INDEX") {
    if (url.href !== DORMAN_INDEX_URL) throw new Error("CALENDAR_DORMAN_URL_FORBIDDEN");
    return url;
  }
  const escapedYear = String(scope.expectedYear).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const suffixes = Number.isInteger(scope.monthIndex)
    ? MONTH_SUFFIXES[scope.monthIndex]
    : MONTH_SUFFIXES.join("|");
  const pattern = new RegExp(
    `^/wp-content/uploads/${escapedYear}/\\d{2}/Dorman-Trading-Calendar-${escapedYear}-(?:${suffixes})\\.pdf$`,
  );
  if (scope.kind !== "PDF" || !pattern.test(url.pathname))
    throw new Error("CALENDAR_DORMAN_URL_FORBIDDEN");
  return url;
}

async function boundedBody(response) {
  const stated = Number(response.headers.get("content-length"));
  if (Number.isFinite(stated) && stated > MAX_DOCUMENT_BYTES) {
    await response.body?.cancel();
    throw new Error("CALENDAR_DORMAN_DOCUMENT_TOO_LARGE");
  }
  if (!response.body) throw new Error("CALENDAR_DORMAN_DOCUMENT_EMPTY");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_DOCUMENT_BYTES) {
      await reader.cancel();
      throw new Error("CALENDAR_DORMAN_DOCUMENT_TOO_LARGE");
    }
    chunks.push(value);
  }
  if (!length) throw new Error("CALENDAR_DORMAN_DOCUMENT_EMPTY");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function dormanIndexSource(expectedYear) {
  return {
    sourceId: DORMAN_CALENDAR_SOURCE_ID,
    sourceKind: "DORMAN_TRADING_CALENDAR_INDEX",
    url: DORMAN_INDEX_URL,
    archiveSuffix: ".html",
    expectedYear,
    timezone: "America/Chicago",
    scope: sourceScope(),
  };
}

function dormanPdfSource({ expectedYear, monthIndex, url }) {
  return {
    sourceId: `${DORMAN_CALENDAR_SOURCE_ID}_${expectedYear}_${String(monthIndex + 1).padStart(2, "0")}`,
    sourceKind: "DORMAN_TRADING_CALENDAR_PDF",
    url,
    archiveSuffix: ".pdf",
    expectedYear,
    monthIndex,
    timezone: "America/Chicago",
    scope: sourceScope(),
  };
}

function sourceScope() {
  return {
    universe: "US_GRAINS_CBOT", instruments: ["ZC", "ZW"],
    reportKind: "WEEKLY_EXPORT_SALES_RELEASES",
  };
}

function coveredMonthIndexes(window, expectedYear) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit",
  });
  const found = new Set();
  for (let timestamp = Date.parse(window.start); timestamp <= Date.parse(window.end); timestamp += 86400000) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp))
      .map(({ type, value }) => [type, value]));
    if (+parts.year !== expectedYear) throw new Error("CALENDAR_DORMAN_CROSS_YEAR_UNSUPPORTED");
    found.add(+parts.month - 1);
  }
  const finalParts = Object.fromEntries(formatter.formatToParts(new Date(window.end))
    .map(({ type, value }) => [type, value]));
  if (+finalParts.year !== expectedYear) throw new Error("CALENDAR_DORMAN_CROSS_YEAR_UNSUPPORTED");
  found.add(+finalParts.month - 1);
  return [...found].sort((left, right) => left - right);
}

function requiredWindow(start, end) {
  const startTime = Date.parse(start);
  const endTime = Date.parse(end);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime > endTime)
    throw new Error("CALENDAR_DORMAN_WINDOW_INVALID");
  return { start: new Date(startTime).toISOString(), end: new Date(endTime).toISOString() };
}

function receiptRecord({ source, hash, receivedAtUtc, receiptRef }) {
  return {
    source_id: source.sourceId,
    source_url: source.url,
    document_sha256: `sha256:${hash}`,
    received_at_utc: receivedAtUtc,
    archive_receipt: receiptRef,
  };
}

function mergedCoverage(coverages) {
  if (!coverages.length || coverages.some((item) => !item))
    throw new Error("CALENDAR_DORMAN_COVERAGE_INVALID");
  return {
    start_utc: coverages.map((item) => item.start_utc).sort()[0],
    end_utc: coverages.map((item) => item.end_utc).sort().at(-1),
    instruments: ["ZC", "ZW"],
  };
}

function decodeUtf8(bytes, code) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch (cause) { throw new Error(code, { cause }); }
}

function pdfMagic(bytes) {
  return new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
}

function receiptTime(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("CALENDAR_DORMAN_RECEIPT_TIME_INVALID");
  return new Date(timestamp).toISOString();
}

function digest(value) { return createHash("sha256").update(value).digest("hex"); }
