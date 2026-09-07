export const THEORETICAL_TRADE_ADMINISTRATIVE_RESOLUTION_SCHEMA_VERSION_V1 =
  "theoretical_trade_administrative_resolution_v1";

export function resolveTheoreticalTradeAdministrativeReviewV1(input = {}) {
  const tradeId = requiredText(input.trade_id, "THEORETICAL_ADMIN_RESOLUTION_TRADE_REQUIRED");
  const intentId = requiredText(input.portfolio_order_intent_id,
    "THEORETICAL_ADMIN_RESOLUTION_INTENT_REQUIRED");
  assertAttestation(input.operator_attestation);
  assertTrade(input.trade, input.expectation, tradeId, intentId);
  assertEvidence(input.execution_evidence, tradeId);
  const effectiveAtUtc = requiredIso(input.effective_at_utc,
    "THEORETICAL_ADMIN_RESOLUTION_EFFECTIVE_AT_REQUIRED");
  const tradeCreatedAtUtc = requiredIso(input.trade?.created_at,
    "THEORETICAL_ADMIN_RESOLUTION_TRADE_CREATED_AT_REQUIRED");
  if (effectiveAtUtc < tradeCreatedAtUtc) fail("THEORETICAL_ADMIN_RESOLUTION_PRECEDES_TRADE", tradeId);
  return Object.freeze({
    schema_version: THEORETICAL_TRADE_ADMINISTRATIVE_RESOLUTION_SCHEMA_VERSION_V1,
    trade_id: tradeId,
    portfolio_order_intent_id: intentId,
    status: "ADMINISTRATIVELY_RESOLVED_NO_REAL_EXPOSURE",
    exposure_disposition: "ADMINISTRATIVELY_RELEASED",
    historical_outcome_disposition: "UNDETERMINED_PRESERVED",
    effective_at_utc: effectiveAtUtc,
    market_execution_effect: "NONE",
  });
}

function assertAttestation(value) {
  const allowed = new Set(["schema_version", "no_open_orders", "no_open_positions"]);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.has(key))
    || value.schema_version !== "operator_no_open_exposure_attestation_v1"
    || value.no_open_orders !== true || value.no_open_positions !== true) {
    fail("THEORETICAL_ADMIN_RESOLUTION_ATTESTATION_INVALID");
  }
}

function assertTrade(trade = {}, expectation = {}, tradeId, intentId) {
  if (trade.trade_id !== tradeId || trade.portfolio_order_intent_id !== intentId) {
    fail("THEORETICAL_ADMIN_RESOLUTION_IDENTITY_MISMATCH", tradeId);
  }
  if (String(trade.source || "") !== "theoretical_execution_engine"
    || trade.theoretical_review_required !== true) {
    fail("THEORETICAL_ADMIN_RESOLUTION_NOT_REVIEW_REQUIRED", tradeId);
  }
  if (String(trade.status || "").toLowerCase() !== String(expectation.status || "").toLowerCase()
    || Number(trade.revision) !== Number(expectation.revision)
    || Number(trade.quantity_open) !== Number(expectation.quantity_open)) {
    fail("THEORETICAL_ADMIN_RESOLUTION_TRADE_CAS_MISMATCH", tradeId);
  }
  if (!Number.isInteger(Number(trade.revision)) || Number(trade.revision) < 0
    || !positiveNumber(trade.quantity_open)) {
    fail("THEORETICAL_ADMIN_RESOLUTION_TRADE_STATE_INVALID", tradeId);
  }
}

function assertEvidence(value = {}, tradeId) {
  const zeroCounts = ["provider_command_count", "provider_event_count", "broker_order_count",
    "broker_order_event_count", "manual_execution_event_count", "physical_fill_count",
    "other_theoretical_event_count", "outcome_count", "physical_third_party_reference_count"];
  for (const field of zeroCounts) {
    if (!nonnegativeInteger(value[field]) || Number(value[field]) !== 0) {
      fail("THEORETICAL_ADMIN_RESOLUTION_EXECUTION_CONTRADICTION", tradeId);
    }
  }
  if (Number(value.theoretical_fill_count) !== 1
    || Number(value.theoretical_entry_fill_count) !== 1
    || Number(value.theoretical_review_count) !== 1) {
    fail("THEORETICAL_ADMIN_RESOLUTION_EVIDENCE_MISMATCH", tradeId);
  }
}

function requiredText(value, code) {
  const result = String(value || "").trim();
  if (!result) fail(code);
  return result;
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
function positiveNumber(value) { return Number.isFinite(Number(value)) && Number(value) > 0; }
function fail(code, id = null) {
  const error = new Error(id ? `${code}:${id}` : code);
  error.code = code;
  throw error;
}
