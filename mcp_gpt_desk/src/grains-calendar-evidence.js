const REQUIRED_SOURCE_IDS = Object.freeze([
  "usda_nass_release_calendar",
  "usda_wasde_release_schedule",
  "usda_fas_export_sales_schedule",
]);
const REQUIRED_INSTRUMENTS = Object.freeze(["ZC", "ZW"]);

// Pure market-data policy. A schedule flag or an empty event list is not a
// coverage certificate: every required USDA document must prove the requested
// window and both traded grains at the requested knowledge cutoff.
export function qualifyGrainsCalendarEvidence({
  sources = [],
  knownAtUtc,
  coverageStart,
  coverageEnd,
} = {}) {
  const window = normalizeWindow(coverageStart, coverageEnd);
  const knownAt = timestamp(knownAtUtc);
  const diagnostics = diagnoseSources(sources, knownAt, window);
  const required = diagnostics.filter((item) => !item.ignored);
  const reasonCodes = qualificationReasons({ window, knownAt, required });
  return {
    status: reasonCodes.length ? "UNKNOWN_COVERAGE" : "AVAILABLE",
    reasonCodes,
    coverageStart: window.start,
    coverageEnd: window.end,
    sourceDiagnostics: diagnostics,
  };
}

// The ledger uses this to reject a claimed historical proof that cannot prove
// the source document was public at its calendar knowledge cutoff.
export function validateGrainsCalendarHistoricalEvidence({ source, knownAtUtc } = {}) {
  const proof = object(source?.metadata?.historical_evidence);
  const knownAt = timestamp(knownAtUtc);
  if (!knownAt || !Object.keys(proof).length)
    return { valid: false, reasonCodes: ["CALENDAR_HISTORICAL_PROOF_REQUIRED"] };
  const kind = proof.kind;
  if (!isHistoricalKind(kind) || !sameHash(proof.document_sha256, source?.sourceDocumentSha256)
    || !sameUrl(proof.document_url, source?.sourceUrl) || !text(proof.citation)) {
    return { valid: false, reasonCodes: ["CALENDAR_HISTORICAL_PROOF_MALFORMED"] };
  }
  const proofTime = historicalProofTime(kind, proof);
  if (!proofTime)
    return { valid: false, reasonCodes: ["CALENDAR_HISTORICAL_PROOF_MALFORMED"] };
  if (Date.parse(proofTime) > Date.parse(knownAt)) {
    return { valid: false, reasonCodes: ["CALENDAR_HISTORICAL_PROOF_AFTER_KNOWLEDGE"] };
  }
  return { valid: true, reasonCodes: [] };
}

function diagnoseSources(sources, knownAt, window) {
  const listed = Array.isArray(sources) ? sources : [];
  const diagnostics = listed.map((source) => diagnoseSource(source, knownAt, window));
  for (const sourceId of REQUIRED_SOURCE_IDS) {
    if (!listed.some((source) => source?.sourceId === sourceId)) {
      diagnostics.push({
        sourceId,
        ignored: false,
        qualified: false,
        reasonCodes: ["CALENDAR_REQUIRED_SOURCE_MISSING"],
      });
    }
  }
  return diagnostics.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}

function diagnoseSource(source, knownAt, window) {
  const sourceId = text(source?.sourceId) || "unknown";
  const ignored = !REQUIRED_SOURCE_IDS.includes(sourceId);
  const reasonCodes = ignored ? [] : sourceReasons(source, knownAt, window);
  return {
    sourceId,
    ignored,
    qualified: !ignored && !reasonCodes.length,
    reasonCodes,
  };
}

function sourceReasons(source, knownAt, window) {
  const reasons = [];
  if (source?.metadata?.calendar_evidence_status !== "CALENDAR_SCHEDULE")
    reasons.push("CALENDAR_EVIDENCE_STATUS_INVALID");
  if (!coversWindow(source?.metadata?.coverage, window))
    reasons.push("CALENDAR_SOURCE_COVERAGE_INSUFFICIENT");
  if (!coversInstruments(source?.metadata?.coverage?.instruments))
    reasons.push("CALENDAR_SOURCE_INSTRUMENTS_INCOMPLETE");
  reasons.push(...knowledgeReasons(source, knownAt));
  return [...new Set(reasons)].sort();
}

function knowledgeReasons(source, knownAt) {
  const retrievedAt = timestamp(source?.retrievedAtUtc);
  if (!knownAt || !retrievedAt) return ["CALENDAR_SOURCE_KNOWLEDGE_UNPROVEN"];
  const historical = source?.historicalKnowledgeStatus === "PROVEN_HISTORICAL";
  const proof = historical
    ? validateGrainsCalendarHistoricalEvidence({ source, knownAtUtc: knownAt })
    : null;
  if (historical && !proof.valid) return proof.reasonCodes;
  if (Date.parse(retrievedAt) <= Date.parse(knownAt)) {
    return source?.knowledgeStatus === "PROVEN_CURRENT"
      ? []
      : historical && proof.valid ? [] : ["CALENDAR_SOURCE_KNOWLEDGE_UNPROVEN"];
  }
  return historical && proof.valid
    ? []
    : ["CALENDAR_SOURCE_AFTER_KNOWLEDGE_WITHOUT_HISTORICAL_PROOF"];
}

function qualificationReasons({ window, knownAt, required }) {
  const reasons = new Set();
  if (!knownAt || !window.valid) reasons.add("CALENDAR_COVERAGE_WINDOW_INVALID");
  for (const sourceId of REQUIRED_SOURCE_IDS) {
    const candidates = required.filter((item) => item.sourceId === sourceId);
    if (!candidates.length || candidates.some((item) => item.reasonCodes.includes("CALENDAR_REQUIRED_SOURCE_MISSING"))) {
      reasons.add("CALENDAR_SOURCE_SET_INCOMPLETE");
      continue;
    }
    if (candidates.length > 1) {
      reasons.add("CALENDAR_REQUIRED_SOURCE_AMBIGUOUS");
      reasons.add("CALENDAR_SOURCE_SET_INCOMPLETE");
      continue;
    }
    if (!candidates.some((item) => item.qualified)) {
      reasons.add("CALENDAR_SOURCE_SET_INCOMPLETE");
      for (const item of candidates) for (const code of item.reasonCodes) reasons.add(code);
    }
  }
  return [...reasons].sort();
}

function normalizeWindow(start, end) {
  const normalizedStart = timestamp(start);
  const normalizedEnd = timestamp(end);
  return {
    start: normalizedStart,
    end: normalizedEnd,
    valid: Boolean(normalizedStart && normalizedEnd
      && Date.parse(normalizedStart) <= Date.parse(normalizedEnd)),
  };
}

function coversWindow(coverage, window) {
  const start = timestamp(coverage?.start_utc);
  const end = timestamp(coverage?.end_utc);
  return Boolean(window.valid && start && end
    && Date.parse(start) <= Date.parse(window.start)
    && Date.parse(end) >= Date.parse(window.end));
}

function coversInstruments(instruments) {
  const known = new Set(Array.isArray(instruments)
    ? instruments.filter((item) => typeof item === "string").map((item) => item.trim().toUpperCase())
    : []);
  return REQUIRED_INSTRUMENTS.every((instrument) => known.has(instrument));
}

function timestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function isHistoricalKind(value) {
  return value === "OFFICIAL_DATED_PUBLICATION"
    || value === "ARCHIVED_OBSERVATION"
    || value === "OFFICIAL_VERSION_METADATA";
}

function historicalProofTime(kind, proof) {
  if (kind === "OFFICIAL_DATED_PUBLICATION") return timestamp(proof.published_at_utc);
  if (kind === "ARCHIVED_OBSERVATION") return timestamp(proof.observed_at_utc);
  const documentModifiedAt = timestamp(proof.document_modified_at_utc);
  const serverLastModifiedAt = timestamp(proof.server_last_modified_utc);
  if (!documentModifiedAt || !serverLastModifiedAt) return null;
  return new Date(Math.max(Date.parse(documentModifiedAt), Date.parse(serverLastModifiedAt))).toISOString();
}

function sameHash(left, right) {
  return /^sha256:[a-f0-9]{64}$/.test(String(left || "")) && left === right;
}

function sameUrl(left, right) {
  return Boolean(text(left) && text(right) && left === right);
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
