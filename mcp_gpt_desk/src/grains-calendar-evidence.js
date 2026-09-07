import {
  DORMAN_CALENDAR_SOURCE_ID,
  FAS_CALENDAR_SOURCE_ID,
  GRAINS_CALENDAR_POLICY_V1,
  GRAINS_CALENDAR_POLICY_V2,
  grainsCalendarSourcePolicy,
  isKnownCalendarSource,
  requiredCalendarSourceGroups,
} from "./grains-calendar-source-policy.js";

const REQUIRED_INSTRUMENTS = Object.freeze(["ZC", "ZW"]);

// Pure market-data policy. A schedule flag or an empty event list is not a
// coverage certificate: every required USDA document must prove the requested
// window and both traded grains at the requested knowledge cutoff.
export function qualifyGrainsCalendarEvidence({
  sources = [],
  knownAtUtc,
  coverageStart,
  coverageEnd,
  policyId = GRAINS_CALENDAR_POLICY_V1,
  fallbackEvidence = null,
} = {}) {
  const window = normalizeWindow(coverageStart, coverageEnd);
  const knownAt = timestamp(knownAtUtc);
  const policy = grainsCalendarSourcePolicy(policyId);
  if (!policy) return unsupportedPolicy(window, policyId);
  const diagnostics = diagnoseSources(
    sources, knownAt, window, policyId, fallbackEvidence,
  );
  const required = diagnostics.filter((item) => !item.ignored);
  const reasonCodes = qualificationReasons({ window, knownAt, required, policyId });
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

function diagnoseSources(sources, knownAt, window, policyId, fallbackEvidence) {
  const listed = Array.isArray(sources) ? sources : [];
  const diagnostics = listed.map((source) => diagnoseSource(
    source, knownAt, window, policyId, fallbackEvidence,
  ));
  for (const group of requiredCalendarSourceGroups(policyId)) {
    if (!listed.some((source) => group.sourceIds.includes(source?.sourceId))) {
      diagnostics.push({
        sourceId: group.sourceIds[0],
        sourceRole: group.role,
        ignored: false,
        qualified: false,
        reasonCodes: ["CALENDAR_REQUIRED_SOURCE_MISSING"],
      });
    }
  }
  return diagnostics.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}

function diagnoseSource(source, knownAt, window, policyId, fallbackEvidence) {
  const sourceId = text(source?.sourceId) || "unknown";
  const ignored = !isKnownCalendarSource(policyId, sourceId);
  const reasonCodes = ignored ? [] : sourceReasons(source, knownAt, window, policyId);
  return {
    sourceId,
    ignored,
    qualified: !ignored && !reasonCodes.length,
    reasonCodes,
    fallbackEligible: sourceId === DORMAN_CALENDAR_SOURCE_ID
      && validFas403Evidence(fallbackEvidence, knownAt),
  };
}

function sourceReasons(source, knownAt, window, policyId) {
  const reasons = [];
  if (source?.metadata?.calendar_evidence_status !== "CALENDAR_SCHEDULE")
    reasons.push("CALENDAR_EVIDENCE_STATUS_INVALID");
  if (!coversWindow(source?.metadata?.coverage, window))
    reasons.push("CALENDAR_SOURCE_COVERAGE_INSUFFICIENT");
  if (!coversInstruments(source?.metadata?.coverage?.instruments))
    reasons.push("CALENDAR_SOURCE_INSTRUMENTS_INCOMPLETE");
  if (source?.sourceId === DORMAN_CALENDAR_SOURCE_ID)
    reasons.push(...dormanSourceReasons(source, policyId));
  reasons.push(...knowledgeReasons(source, knownAt));
  return [...new Set(reasons)].sort();
}

function dormanSourceReasons(source, policyId) {
  const metadata = object(source?.metadata);
  const reasons = [];
  if (policyId !== GRAINS_CALENDAR_POLICY_V2)
    reasons.push("CALENDAR_SECONDARY_SOURCE_NOT_ALLOWED");
  if (metadata.authority_class !== "SECONDARY_PUBLISHER"
    || metadata.provider !== "DORMAN_TRADING"
    || metadata.upstream_claim !== "USDA")
    reasons.push("CALENDAR_SECONDARY_SOURCE_PROVENANCE_INVALID");
  if (metadata.source_policy_id !== GRAINS_CALENDAR_POLICY_V2)
    reasons.push("CALENDAR_SECONDARY_SOURCE_POLICY_MISMATCH");
  if (!validDormanReceipts(metadata.document_receipts, source?.retrievedAtUtc))
    reasons.push("CALENDAR_SECONDARY_SOURCE_RECEIPTS_REQUIRED");
  return reasons;
}

function validFas403Evidence(evidence, knownAtUtc) {
  const observedAt = timestamp(evidence?.observed_at_utc);
  const knownAt = timestamp(knownAtUtc);
  if (!observedAt || !knownAt) return false;
  const sourceUrl = parsedUrl(evidence?.sourceUrl || evidence?.source_url);
  if (!sourceUrl) return false;
  const age = Date.parse(knownAt) - Date.parse(observedAt);
  return validFas403Identity(evidence, sourceUrl)
    && age >= 0 && age <= 10 * 60 * 1000;
}

function validFas403Identity(evidence, sourceUrl) {
  return evidence?.sourceId === FAS_CALENDAR_SOURCE_ID
    && sourceUrl.href === "https://fas.usda.gov/data/scheduled-reports"
    && evidence?.reasonCode === "USDA_SOURCE_HTTP_403"
    && /^sha256:[a-f0-9]{64}$/.test(evidence?.observation_sha256 || "")
    && text(evidence?.archive_receipt);
}

function validDormanReceipts(receipts, retrievedAtUtc) {
  const retrieved = timestamp(retrievedAtUtc);
  if (!retrieved || !Array.isArray(receipts) || receipts.length < 2) return false;
  const times = receipts.map((receipt) => timestamp(receipt?.received_at_utc));
  return receipts.every((receipt, index) => validDormanReceipt(
    receipt, times[index], retrieved,
  )) && times.sort().at(-1) === retrieved;
}

function validDormanReceipt(receipt, receivedAt, retrievedAt) {
  const sourceUrl = parsedUrl(receipt?.source_url);
  return Boolean(sourceUrl
    && sourceUrl.protocol === "https:"
    && sourceUrl.hostname === "www.dormantrading.com"
    && /^sha256:[a-f0-9]{64}$/.test(receipt?.document_sha256 || "")
    && text(receipt?.archive_receipt)
    && receivedAt
    && Date.parse(receivedAt) <= Date.parse(retrievedAt));
}

function parsedUrl(value) {
  try { return new URL(value); }
  catch { return null; }
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

function qualificationReasons({ window, knownAt, required, policyId }) {
  const reasons = new Set();
  if (!knownAt || !window.valid) reasons.add("CALENDAR_COVERAGE_WINDOW_INVALID");
  for (const group of requiredCalendarSourceGroups(policyId)) {
    const candidates = required.filter((item) => group.sourceIds.includes(item.sourceId));
    if (!candidates.length || candidates.some((item) => item.reasonCodes.includes("CALENDAR_REQUIRED_SOURCE_MISSING"))) {
      reasons.add("CALENDAR_SOURCE_SET_INCOMPLETE");
      continue;
    }
    if (group.role === "EXPORT_SALES_SCHEDULE" && policyId === GRAINS_CALENDAR_POLICY_V2) {
      qualifyV2ExportSales(candidates, reasons);
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

function qualifyV2ExportSales(candidates, reasons) {
  const primary = candidates.filter((item) => item.sourceId === FAS_CALENDAR_SOURCE_ID);
  const secondary = candidates.filter((item) => item.sourceId === DORMAN_CALENDAR_SOURCE_ID);
  if (primary.length > 1 || secondary.length > 1) {
    reasons.add("CALENDAR_REQUIRED_SOURCE_AMBIGUOUS");
    reasons.add("CALENDAR_SOURCE_SET_INCOMPLETE");
    return;
  }
  if (primary.length) {
    qualifyCandidates([...primary, ...secondary], reasons);
    return;
  }
  const selected = primary[0] || secondary[0];
  if (!selected || (!primary.length && !selected.fallbackEligible)) {
    reasons.add("CALENDAR_SOURCE_SET_INCOMPLETE");
    reasons.add("CALENDAR_SECONDARY_FALLBACK_REASON_INVALID");
    return;
  }
  if (!selected.qualified) {
    qualifyCandidates([selected], reasons);
  }
}

function qualifyCandidates(candidates, reasons) {
  for (const candidate of candidates.filter((item) => !item.qualified)) {
    reasons.add("CALENDAR_SOURCE_SET_INCOMPLETE");
    for (const code of candidate.reasonCodes) reasons.add(code);
  }
}

function unsupportedPolicy(window, policyId) {
  return {
    status: "UNKNOWN_COVERAGE",
    reasonCodes: ["CALENDAR_SOURCE_POLICY_UNSUPPORTED"],
    coverageStart: window.start,
    coverageEnd: window.end,
    sourceDiagnostics: [{
      sourceId: "calendar_source_policy",
      ignored: false,
      qualified: false,
      reasonCodes: ["CALENDAR_SOURCE_POLICY_UNSUPPORTED"],
      policyId: text(policyId),
    }],
  };
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
