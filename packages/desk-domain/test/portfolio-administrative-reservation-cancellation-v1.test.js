import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADMINISTRATIVE_RESERVATION_CANCELLATION_SCHEMA_VERSION_V1,
  cancelAdministrativeReservationV1,
} from "../index.js";

describe("administrative reservation cancellation V1", () => {
  it("releases an expired reservation without assigning a historical outcome", () => {
    const result = cancelAdministrativeReservationV1(fixture());
    assert.equal(result.schema_version, ADMINISTRATIVE_RESERVATION_CANCELLATION_SCHEMA_VERSION_V1);
    assert.equal(result.status, "CANCELLED_ADMINISTRATIVE_NO_OPEN_EXPOSURE");
    assert.equal(result.reservation_disposition, "ADMINISTRATIVELY_RELEASED");
    assert.equal(result.historical_outcome_disposition, "UNDETERMINED_PRESERVED");
    assert.equal(result.market_execution_effect, "NONE");
  });

  it("requires exact lineage state and hash", () => {
    assert.throws(() => cancelAdministrativeReservationV1(fixture({
      lineage: { ...lineage(), status: "READY" },
    })), { code: "ADMIN_CANCELLATION_LINEAGE_STATUS_MISMATCH" });
    assert.throws(() => cancelAdministrativeReservationV1(fixture({
      expectation: { status: "EXPIRED", payload_hash: `sha256:${"b".repeat(64)}` },
    })), { code: "ADMIN_CANCELLATION_LINEAGE_HASH_MISMATCH" });
    for (const payload_hash of [null, undefined, "", `sha256:${"a".repeat(63)}`]) {
      assert.throws(() => cancelAdministrativeReservationV1(fixture({
        expectation: { status: "EXPIRED", payload_hash },
      })), { code: "ADMIN_CANCELLATION_LINEAGE_HASH_MISMATCH" });
    }
  });

  it("fails closed on every execution signal and unknown lifecycle", () => {
    for (const field of ["provider_command_count", "provider_event_count", "broker_order_count",
      "broker_order_event_count", "trade_count", "fill_count", "manual_execution_event_count",
      "theoretical_entry_fill_count", "unexpected_theoretical_event_count", "third_party_reference_count"]) {
      assert.throws(() => cancelAdministrativeReservationV1(fixture({
        execution_evidence: { ...evidence(), [field]: 1 },
      })), { code: "ADMIN_CANCELLATION_EXECUTION_EVIDENCE_PRESENT" });
    }
    for (const lifecycle_status of ["FILLED", "UNKNOWN", "FUTURE_STATE"]) {
      assert.throws(() => cancelAdministrativeReservationV1(fixture({
        execution_evidence: { ...evidence(), lifecycle_status },
      })), { code: "ADMIN_CANCELLATION_EXECUTION_STATE_CONTRADICTS_ATTESTATION" });
    }
  });

  it("requires a strict no-open attestation and prospective effective time", () => {
    for (const operator_attestation of [{}, { ...attestation(), no_open_orders: false },
      { ...attestation(), no_provider_execution: true }]) {
      assert.throws(() => cancelAdministrativeReservationV1(fixture({ operator_attestation })),
        { code: "ADMIN_CANCELLATION_ATTESTATION_INVALID" });
    }
    assert.throws(() => cancelAdministrativeReservationV1(fixture({ effective_at_utc: "2026-06-10T23:59:59Z" })),
      { code: "ADMIN_CANCELLATION_PRECEDES_INTENT" });
  });
});

function fixture(overrides = {}) {
  return { portfolio_order_intent_id: "intent-1", lineage: lineage(),
    expectation: { status: "EXPIRED", payload_hash: `sha256:${"a".repeat(64)}` },
    execution_evidence: evidence(), operator_attestation: attestation(),
    effective_at_utc: "2026-09-07T12:00:00Z", ...overrides };
}
function lineage() {
  return { status: "EXPIRED", payload_hash: `sha256:${"a".repeat(64)}`,
    created_at_utc: "2026-06-11T00:00:00Z" };
}
function evidence() {
  return { provider_command_count: 0, provider_event_count: 0, broker_order_count: 0,
    broker_order_event_count: 0, trade_count: 0, fill_count: 0, manual_execution_event_count: 0,
    theoretical_entry_fill_count: 0, unexpected_theoretical_event_count: 0,
    third_party_reference_count: 0, filled_quantity: 0, lifecycle_status: "EXPIRED" };
}
function attestation() {
  return { schema_version: "operator_no_open_exposure_attestation_v1", no_open_orders: true,
    no_open_positions: true };
}
