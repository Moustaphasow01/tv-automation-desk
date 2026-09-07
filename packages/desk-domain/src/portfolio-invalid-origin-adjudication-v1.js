export const INVALID_ORIGIN_ADJUDICATION_SCHEMA_VERSION_V1 = "portfolio_invalid_origin_adjudication_v1";
export const INVALID_ORIGIN_ATTESTATION_SCHEMA_VERSION_V1 = "operator_no_open_exposure_attestation_v1";

const EXPECTED_QUALIFICATION = Object.freeze({
  origin_classification: "INVALID_ORIGIN_PLAN",
  reconstruction_status: "UNQUALIFIABLE",
  provider_evidence_status: "ABSENT",
  reservation_disposition: "RETAINED",
});

export function adjudicateInvalidOriginReservationV1(input = {}) {
  const intentId = requiredText(input.portfolio_order_intent_id, "ADJUDICATION_INTENT_REQUIRED");
  assertAttestation(input.operator_attestation);
  assertQualification(input.qualification, input.expectation, intentId);
  assertNoExecutionContradiction(input.execution_evidence, intentId);
  const effectiveAtUtc = requiredIso(input.effective_at_utc, "ADJUDICATION_EFFECTIVE_AT_REQUIRED");
  const qualifiedAtUtc = requiredIso(input.qualification?.qualified_at_utc, "ADJUDICATION_QUALIFIED_AT_REQUIRED");
  if (effectiveAtUtc < qualifiedAtUtc) fail("ADJUDICATION_PRECEDES_QUALIFICATION", intentId);
  return Object.freeze({
    schema_version: INVALID_ORIGIN_ADJUDICATION_SCHEMA_VERSION_V1,
    portfolio_order_intent_id: intentId,
    status: "CANCELLED_INVALID_ORIGIN",
    reservation_disposition: "ADMINISTRATIVELY_RELEASED",
    effective_at_utc: effectiveAtUtc,
    market_execution_effect: "NONE",
  });
}

function assertAttestation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("ADJUDICATION_ATTESTATION_REQUIRED");
  if (Object.hasOwn(value, "third_party_execution_reference")) fail("ADJUDICATION_THIRD_PARTY_REFERENCE_REFUSED");
  if (value.schema_version !== INVALID_ORIGIN_ATTESTATION_SCHEMA_VERSION_V1
    || value.no_open_orders !== true || value.no_open_positions !== true) fail("ADJUDICATION_ATTESTATION_INVALID");
  const allowed = new Set(["schema_version", "no_open_orders", "no_open_positions"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) fail("ADJUDICATION_ATTESTATION_INVALID");
}

function assertQualification(value = {}, expectation = {}, intentId) {
  if (!positiveInteger(value.revision) || !positiveInteger(expectation.revision)) {
    fail("ADJUDICATION_QUALIFICATION_REVISION_MISMATCH", intentId);
  }
  if (!hash(value.manifest_hash) || !hash(expectation.manifest_hash)) {
    fail("ADJUDICATION_QUALIFICATION_HASH_MISMATCH", intentId);
  }
  if (!prefixedHash(value.lineage_payload_hash) || !prefixedHash(value.expected_lineage_payload_hash)) {
    fail("ADJUDICATION_LINEAGE_HASH_MISMATCH", intentId);
  }
  const exact = [
    [number(value.revision), number(expectation.revision), "ADJUDICATION_QUALIFICATION_REVISION_MISMATCH"],
    [value.manifest_hash, expectation.manifest_hash, "ADJUDICATION_QUALIFICATION_HASH_MISMATCH"],
    [value.lineage_payload_hash, value.expected_lineage_payload_hash, "ADJUDICATION_LINEAGE_HASH_MISMATCH"],
    ...Object.entries(EXPECTED_QUALIFICATION).map(([field, expected]) => [value[field], expected,
      `ADJUDICATION_QUALIFICATION_${field.toUpperCase()}_MISMATCH`]),
    [value.current_lineage_status, "EXPIRED", "ADJUDICATION_LINEAGE_STATUS_MISMATCH"],
  ];
  for (const [actual, expected, code] of exact) if (actual !== expected) fail(code, intentId);
}

function assertNoExecutionContradiction(value = {}, intentId) {
  if (number(value.third_party_reference_count) !== 0) fail("ADJUDICATION_THIRD_PARTY_REFERENCE_REFUSED", intentId);
  const countFields = ["provider_command_count", "provider_event_count", "trade_count", "fill_count",
    "manual_execution_event_count"];
  for (const field of countFields) if (number(value[field]) !== 0) fail("ADJUDICATION_EXECUTION_EVIDENCE_PRESENT", intentId);
  if (number(value.filled_quantity) !== 0) fail("ADJUDICATION_EXECUTION_EVIDENCE_PRESENT", intentId);
  const lifecycle = String(value.lifecycle_status || "").toUpperCase();
  const allowed = ["", "AWAITING_MANUAL_CONFIRMATION", "REJECTED", "CANCELLED", "EXPIRED", "BLOCKED"];
  if (!allowed.includes(lifecycle)) fail("ADJUDICATION_EXECUTION_STATE_CONTRADICTS_ATTESTATION", intentId);
}

function requiredText(value, code) {
  const normalized = String(value || "").trim();
  if (!normalized) fail(code);
  return normalized;
}

function requiredIso(value, code) {
  const parsed = Date.parse(value || "");
  if (!Number.isFinite(parsed)) fail(code);
  return new Date(parsed).toISOString();
}

function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function positiveInteger(value) { return Number.isInteger(Number(value)) && Number(value) > 0; }
function hash(value) { return /^[a-f0-9]{64}$/.test(String(value || "")); }
function prefixedHash(value) { return /^sha256:[a-f0-9]{64}$/.test(String(value || "")); }

function fail(code, intentId = null) {
  const error = new Error(intentId ? `${code}:${intentId}` : code);
  error.code = code;
  throw error;
}
