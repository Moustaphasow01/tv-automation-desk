import { INVALID_ORIGIN_ATTESTATION_SCHEMA_VERSION_V1 } from "./portfolio-invalid-origin-adjudication-v1.js";

export const ADMINISTRATIVE_RESERVATION_CANCELLATION_SCHEMA_VERSION_V1 =
  "portfolio_administrative_reservation_cancellation_v1";

export function cancelAdministrativeReservationV1(input = {}) {
  const intentId = requiredText(input.portfolio_order_intent_id, "ADMIN_CANCELLATION_INTENT_REQUIRED");
  assertAttestation(input.operator_attestation);
  assertLineage(input.lineage, input.expectation, intentId);
  assertNoExecutionContradiction(input.execution_evidence, intentId);
  const effectiveAtUtc = requiredIso(input.effective_at_utc, "ADMIN_CANCELLATION_EFFECTIVE_AT_REQUIRED");
  const lineageCreatedAtUtc = requiredIso(input.lineage?.created_at_utc, "ADMIN_CANCELLATION_LINEAGE_CREATED_AT_REQUIRED");
  if (effectiveAtUtc < lineageCreatedAtUtc) fail("ADMIN_CANCELLATION_PRECEDES_INTENT", intentId);
  return Object.freeze({
    schema_version: ADMINISTRATIVE_RESERVATION_CANCELLATION_SCHEMA_VERSION_V1,
    portfolio_order_intent_id: intentId,
    status: "CANCELLED_ADMINISTRATIVE_NO_OPEN_EXPOSURE",
    reservation_disposition: "ADMINISTRATIVELY_RELEASED",
    historical_outcome_disposition: "UNDETERMINED_PRESERVED",
    effective_at_utc: effectiveAtUtc,
    market_execution_effect: "NONE",
  });
}

function assertAttestation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("ADMIN_CANCELLATION_ATTESTATION_REQUIRED");
  const allowed = new Set(["schema_version", "no_open_orders", "no_open_positions"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) fail("ADMIN_CANCELLATION_ATTESTATION_INVALID");
  if (value.schema_version !== INVALID_ORIGIN_ATTESTATION_SCHEMA_VERSION_V1
    || value.no_open_orders !== true || value.no_open_positions !== true) {
    fail("ADMIN_CANCELLATION_ATTESTATION_INVALID");
  }
}

function assertLineage(value = {}, expectation = {}, intentId) {
  if (!prefixedHash(value.payload_hash) || !prefixedHash(expectation.payload_hash)
    || value.payload_hash !== expectation.payload_hash) fail("ADMIN_CANCELLATION_LINEAGE_HASH_MISMATCH", intentId);
  if (value.status !== "EXPIRED" || expectation.status !== "EXPIRED") {
    fail("ADMIN_CANCELLATION_LINEAGE_STATUS_MISMATCH", intentId);
  }
}

function assertNoExecutionContradiction(value = {}, intentId) {
  const countFields = [
    "provider_command_count", "provider_event_count", "broker_order_count", "broker_order_event_count",
    "trade_count", "fill_count", "manual_execution_event_count", "theoretical_entry_fill_count",
    "unexpected_theoretical_event_count", "third_party_reference_count",
  ];
  for (const field of countFields) {
    if (!nonnegativeInteger(value[field]) || Number(value[field]) !== 0) {
      fail("ADMIN_CANCELLATION_EXECUTION_EVIDENCE_PRESENT", intentId);
    }
  }
  if (!nonnegativeNumber(value.filled_quantity) || Number(value.filled_quantity) !== 0) {
    fail("ADMIN_CANCELLATION_EXECUTION_EVIDENCE_PRESENT", intentId);
  }
  const lifecycle = value.lifecycle_status === null || value.lifecycle_status === undefined
    ? "" : String(value.lifecycle_status).toUpperCase();
  if (!["", "EXPIRED"].includes(lifecycle)) {
    fail("ADMIN_CANCELLATION_EXECUTION_STATE_CONTRADICTS_ATTESTATION", intentId);
  }
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

function nonnegativeInteger(value) {
  return value !== null && value !== undefined && value !== ""
    && Number.isInteger(Number(value)) && Number(value) >= 0;
}
function nonnegativeNumber(value) {
  return value !== null && value !== undefined && value !== ""
    && Number.isFinite(Number(value)) && Number(value) >= 0;
}
function prefixedHash(value) { return /^sha256:[a-f0-9]{64}$/.test(String(value || "")); }

function fail(code, intentId = null) {
  const error = new Error(intentId ? `${code}:${intentId}` : code);
  error.code = code;
  throw error;
}
