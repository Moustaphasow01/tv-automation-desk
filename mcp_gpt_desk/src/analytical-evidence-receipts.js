import { createHash } from "node:crypto";
import { deskError } from "./desk-errors.js";
import {
  ANALYTICAL_EVIDENCE_AVAILABILITIES,
  analyticalPhaseDefinition,
} from "./analytical-journey-catalog.js";

export const ANALYTICAL_EVIDENCE_RECEIPT_SCHEMA_VERSION =
  "desk_analytical_evidence_receipt_v1";
export const ANALYTICAL_EVIDENCE_ISSUER = "DESK_BACKEND";

const FORBIDDEN_CALLER_RECEIPT_FIELDS = Object.freeze([
  "receipt_id",
  "receipt_hash",
  "issuer",
  "issued_at_utc",
  "schema_version",
]);

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SYMBOLIC_NAME_PATTERN = /^[A-Z][A-Z0-9_]{1,79}$/;

export function issueAnalyticalEvidenceReceipt({
  journeyId,
  phase,
  journeyCutoffUtc,
  evidence = {},
  issuedAtUtc = new Date().toISOString(),
} = {}) {
  assertNonEmptyString(journeyId, "journeyId");
  const definition = analyticalPhaseDefinition(phase);
  if (!definition) {
    throw analyticalEvidenceError(
      "ANALYTICAL_EVIDENCE_PHASE_INVALID",
      "Evidence must target a phase from the analytical journey catalog.",
      { phase: phase ?? null },
    );
  }
  assertNoCallerReceiptFields(evidence);

  const cutoffUtc = normalizeTimestamp(journeyCutoffUtc, "journeyCutoffUtc");
  const effectiveAtUtc = normalizeTimestamp(
    evidence.effective_at_utc || evidence.effectiveAtUtc || cutoffUtc,
    "evidence.effective_at_utc",
  );
  const normalizedIssuedAtUtc = normalizeTimestamp(issuedAtUtc, "issuedAtUtc");
  if (Date.parse(effectiveAtUtc) > Date.parse(cutoffUtc)) {
    throw analyticalEvidenceError(
      "ANALYTICAL_EVIDENCE_LOOKAHEAD",
      "Evidence effective time exceeds the backend-pinned analytical cutoff.",
      {
        phase: definition.phase,
        effective_at_utc: effectiveAtUtc,
        cutoff_utc: cutoffUtc,
      },
    );
  }

  const evidenceKind = normalizeSymbolicName(evidence.evidence_kind, "evidence.evidence_kind");
  const availability = normalizeAvailability(evidence.availability);
  const source = normalizeSource(evidence.source);
  const qualityFlags = normalizeCodeList(evidence.quality_flags);
  const reasonCodes = normalizeCodeList(evidence.reason_codes);
  if (availability !== "AVAILABLE" && reasonCodes.length === 0) {
    throw analyticalEvidenceError(
      "ANALYTICAL_EVIDENCE_REASON_REQUIRED",
      "Degraded, unavailable or blocked evidence requires a backend reason code.",
      { phase: definition.phase, evidence_kind: evidenceKind, availability },
    );
  }

  const content = resolveEvidenceContent({
    payload: evidence.payload,
    sourceHash: evidence.source_hash || evidence.sourceHash,
    availability,
    source,
    evidenceKind,
    effectiveAtUtc,
    reasonCodes,
  });

  const receiptCore = {
    schema_version: ANALYTICAL_EVIDENCE_RECEIPT_SCHEMA_VERSION,
    issuer: ANALYTICAL_EVIDENCE_ISSUER,
    journey_id: journeyId,
    phase: definition.phase,
    phase_ordinal: definition.ordinal,
    evidence_kind: evidenceKind,
    source,
    availability,
    effective_at_utc: effectiveAtUtc,
    cutoff_utc: cutoffUtc,
    content_hash: content.content_hash,
    content_hash_origin: content.content_hash_origin,
    quality_flags: qualityFlags,
    reason_codes: reasonCodes,
    metadata: normalizeJsonObject(evidence.metadata),
    issued_at_utc: normalizedIssuedAtUtc,
  };
  const receiptHash = hashAnalyticalPayload(receiptCore);
  return deepFreeze({
    ...receiptCore,
    receipt_id: `analytical_evidence_${receiptHash.slice(0, 32)}`,
    receipt_hash: receiptHash,
  });
}

export function verifyAnalyticalEvidenceReceipt(receipt, {
  journeyId,
  phase,
  cutoffUtc,
} = {}) {
  const violations = [];
  if (!isPlainObject(receipt)) {
    return {
      valid: false,
      violations: [{ code: "ANALYTICAL_EVIDENCE_RECEIPT_REQUIRED" }],
    };
  }
  if (receipt.schema_version !== ANALYTICAL_EVIDENCE_RECEIPT_SCHEMA_VERSION) {
    violations.push({ code: "ANALYTICAL_EVIDENCE_SCHEMA_MISMATCH" });
  }
  if (receipt.issuer !== ANALYTICAL_EVIDENCE_ISSUER) {
    violations.push({ code: "ANALYTICAL_EVIDENCE_ISSUER_MISMATCH" });
  }
  const definition = analyticalPhaseDefinition(receipt.phase);
  if (!definition || Number(receipt.phase_ordinal) !== definition.ordinal) {
    violations.push({ code: "ANALYTICAL_EVIDENCE_PHASE_MISMATCH" });
  }
  if (journeyId && receipt.journey_id !== journeyId) {
    violations.push({ code: "ANALYTICAL_EVIDENCE_JOURNEY_MISMATCH" });
  }
  if (phase && receipt.phase !== String(phase).toUpperCase()) {
    violations.push({ code: "ANALYTICAL_EVIDENCE_PHASE_SCOPE_MISMATCH" });
  }
  if (cutoffUtc && receipt.cutoff_utc !== normalizeTimestamp(cutoffUtc, "cutoffUtc")) {
    violations.push({ code: "ANALYTICAL_EVIDENCE_CUTOFF_MISMATCH" });
  }
  if (!ANALYTICAL_EVIDENCE_AVAILABILITIES.includes(receipt.availability)) {
    violations.push({ code: "ANALYTICAL_EVIDENCE_AVAILABILITY_INVALID" });
  }
  if (!SHA256_PATTERN.test(String(receipt.content_hash || ""))) {
    violations.push({ code: "ANALYTICAL_EVIDENCE_CONTENT_HASH_INVALID" });
  }
  if (!SYMBOLIC_NAME_PATTERN.test(String(receipt.evidence_kind || ""))) {
    violations.push({ code: "ANALYTICAL_EVIDENCE_KIND_INVALID" });
  }
  if (!Array.isArray(receipt.reason_codes) || !Array.isArray(receipt.quality_flags)) {
    violations.push({ code: "ANALYTICAL_EVIDENCE_FLAGS_INVALID" });
  }
  if (receipt.availability !== "AVAILABLE" && !receipt.reason_codes?.length) {
    violations.push({ code: "ANALYTICAL_EVIDENCE_REASON_REQUIRED" });
  }
  if (Number.isFinite(Date.parse(receipt.effective_at_utc))
    && Number.isFinite(Date.parse(receipt.cutoff_utc))
    && Date.parse(receipt.effective_at_utc) > Date.parse(receipt.cutoff_utc)) {
    violations.push({ code: "ANALYTICAL_EVIDENCE_LOOKAHEAD" });
  }

  const receiptCore = {
    schema_version: receipt.schema_version,
    issuer: receipt.issuer,
    journey_id: receipt.journey_id,
    phase: receipt.phase,
    phase_ordinal: receipt.phase_ordinal,
    evidence_kind: receipt.evidence_kind,
    source: receipt.source,
    availability: receipt.availability,
    effective_at_utc: receipt.effective_at_utc,
    cutoff_utc: receipt.cutoff_utc,
    content_hash: receipt.content_hash,
    content_hash_origin: receipt.content_hash_origin,
    quality_flags: receipt.quality_flags,
    reason_codes: receipt.reason_codes,
    metadata: receipt.metadata,
    issued_at_utc: receipt.issued_at_utc,
  };
  const expectedHash = hashAnalyticalPayload(receiptCore);
  if (receipt.receipt_hash !== expectedHash) {
    violations.push({ code: "ANALYTICAL_EVIDENCE_RECEIPT_HASH_MISMATCH" });
  }
  if (receipt.receipt_id !== `analytical_evidence_${expectedHash.slice(0, 32)}`) {
    violations.push({ code: "ANALYTICAL_EVIDENCE_RECEIPT_ID_MISMATCH" });
  }
  return {
    valid: violations.length === 0,
    violations,
    receipt_hash: expectedHash,
  };
}

export function assertAnalyticalEvidenceReceipt(receipt, expected = {}) {
  const verification = verifyAnalyticalEvidenceReceipt(receipt, expected);
  if (verification.valid) return receipt;
  throw analyticalEvidenceError(
    "ANALYTICAL_EVIDENCE_RECEIPT_INVALID",
    "The analytical evidence receipt is not a valid backend-issued proof.",
    verification,
  );
}

export function hashAnalyticalPayload(value) {
  return createHash("sha256").update(stableAnalyticalStringify(value)).digest("hex");
}

export function stableAnalyticalStringify(value) {
  return JSON.stringify(canonicalizeJson(value));
}

function resolveEvidenceContent({
  payload,
  sourceHash,
  availability,
  source,
  evidenceKind,
  effectiveAtUtc,
  reasonCodes,
}) {
  const normalizedSourceHash = sourceHash
    ? String(sourceHash).trim().toLowerCase()
    : null;
  if (normalizedSourceHash && !SHA256_PATTERN.test(normalizedSourceHash)) {
    throw analyticalEvidenceError(
      "ANALYTICAL_EVIDENCE_SOURCE_HASH_INVALID",
      "Immutable source hashes must be lowercase SHA-256 values.",
    );
  }
  if (payload !== undefined) {
    const payloadHash = hashAnalyticalPayload(payload);
    if (normalizedSourceHash && normalizedSourceHash !== payloadHash) {
      throw analyticalEvidenceError(
        "ANALYTICAL_EVIDENCE_SOURCE_HASH_MISMATCH",
        "The backend-computed payload hash differs from the pinned source hash.",
        { expected: normalizedSourceHash, actual: payloadHash },
      );
    }
    return {
      content_hash: payloadHash,
      content_hash_origin: "BACKEND_HASHED_PAYLOAD",
    };
  }
  if (normalizedSourceHash) {
    return {
      content_hash: normalizedSourceHash,
      content_hash_origin: "IMMUTABLE_SOURCE_HASH",
    };
  }
  if (availability === "AVAILABLE") {
    throw analyticalEvidenceError(
      "ANALYTICAL_EVIDENCE_CONTENT_REQUIRED",
      "Available evidence requires either a payload hashed by the backend or an immutable source hash.",
    );
  }
  return {
    content_hash: hashAnalyticalPayload({
      evidence_kind: evidenceKind,
      source,
      availability,
      effective_at_utc: effectiveAtUtc,
      reason_codes: reasonCodes,
    }),
    content_hash_origin: "BACKEND_ABSENCE_ASSERTION",
  };
}

function normalizeSource(source) {
  if (!isPlainObject(source)) {
    throw analyticalEvidenceError(
      "ANALYTICAL_EVIDENCE_SOURCE_REQUIRED",
      "Evidence requires a backend source descriptor.",
    );
  }
  const normalized = {
    source_type: normalizeSymbolicName(source.source_type, "source.source_type"),
    source_id: String(source.source_id || "").trim(),
    source_version: source.source_version === undefined || source.source_version === null
      ? null
      : String(source.source_version).trim() || null,
    source_ref: source.source_ref === undefined || source.source_ref === null
      ? null
      : String(source.source_ref).trim() || null,
  };
  assertNonEmptyString(normalized.source_id, "source.source_id");
  return normalized;
}

function normalizeAvailability(value) {
  const normalized = String(value || "AVAILABLE").trim().toUpperCase();
  if (!ANALYTICAL_EVIDENCE_AVAILABILITIES.includes(normalized)) {
    throw analyticalEvidenceError(
      "ANALYTICAL_EVIDENCE_AVAILABILITY_INVALID",
      "Evidence availability is not supported.",
      { availability: value ?? null },
    );
  }
  return normalized;
}

function normalizeSymbolicName(value, field) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!SYMBOLIC_NAME_PATTERN.test(normalized)) {
    throw analyticalEvidenceError(
      "ANALYTICAL_EVIDENCE_SYMBOL_INVALID",
      `${field} must be an uppercase symbolic name.`,
      { field, value: value ?? null },
    );
  }
  return normalized;
}

function normalizeCodeList(values) {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values)) {
    throw analyticalEvidenceError(
      "ANALYTICAL_EVIDENCE_CODE_LIST_INVALID",
      "Evidence quality flags and reason codes must be arrays.",
    );
  }
  return [...new Set(values.map((value) => normalizeSymbolicName(value, "code")))].sort();
}

function normalizeJsonObject(value) {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) {
    throw analyticalEvidenceError(
      "ANALYTICAL_EVIDENCE_METADATA_INVALID",
      "Evidence metadata must be a plain JSON object.",
    );
  }
  return canonicalizeJson(value);
}

function canonicalizeJson(value, ancestors = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw analyticalEvidenceError(
        "ANALYTICAL_EVIDENCE_JSON_INVALID",
        "Evidence JSON cannot contain non-finite numbers.",
      );
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw circularJsonError();
    const nextAncestors = new Set(ancestors).add(value);
    return value.map((item) => canonicalizeJson(item, nextAncestors));
  }
  if (isPlainObject(value)) {
    if (ancestors.has(value)) throw circularJsonError();
    const nextAncestors = new Set(ancestors).add(value);
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => {
        const item = value[key];
        if (item === undefined || typeof item === "function" || typeof item === "symbol") {
          throw analyticalEvidenceError(
            "ANALYTICAL_EVIDENCE_JSON_INVALID",
            "Evidence JSON cannot contain undefined, functions or symbols.",
            { key },
          );
        }
        return [key, canonicalizeJson(item, nextAncestors)];
      }),
    );
  }
  throw analyticalEvidenceError(
    "ANALYTICAL_EVIDENCE_JSON_INVALID",
    "Evidence must be JSON-compatible.",
  );
}

function assertNoCallerReceiptFields(evidence) {
  if (!isPlainObject(evidence)) {
    throw analyticalEvidenceError(
      "ANALYTICAL_EVIDENCE_INPUT_REQUIRED",
      "Evidence input must be a plain object.",
    );
  }
  const forbidden = FORBIDDEN_CALLER_RECEIPT_FIELDS.filter((field) => (
    Object.prototype.hasOwnProperty.call(evidence, field)
  ));
  if (forbidden.length) {
    throw analyticalEvidenceError(
      "ANALYTICAL_EVIDENCE_RECEIPT_FORGERY_ATTEMPT",
      "Receipt identity, issuer, timestamps and hashes are generated only by the backend.",
      { forbidden_fields: forbidden },
    );
  }
}

function normalizeTimestamp(value, field) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    throw analyticalEvidenceError(
      "ANALYTICAL_EVIDENCE_TIMESTAMP_INVALID",
      `${field} must be an ISO-8601 timestamp.`,
      { field, value: value ?? null },
    );
  }
  return new Date(parsed).toISOString();
}

function assertNonEmptyString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw analyticalEvidenceError(
      "ANALYTICAL_EVIDENCE_FIELD_REQUIRED",
      `${field} is required.`,
      { field },
    );
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function circularJsonError() {
  return analyticalEvidenceError(
    "ANALYTICAL_EVIDENCE_JSON_INVALID",
    "Evidence JSON cannot contain circular references.",
  );
}

function analyticalEvidenceError(code, message, details = {}) {
  return deskError(code, message, details);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}
