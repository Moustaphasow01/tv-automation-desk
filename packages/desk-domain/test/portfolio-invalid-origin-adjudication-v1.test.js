import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INVALID_ORIGIN_ADJUDICATION_SCHEMA_VERSION_V1,
  adjudicateInvalidOriginReservationV1,
} from "../index.js";

describe("invalid-origin reservation adjudication V1", () => {
  it("releases only a retained unqualifiable reservation prospectively", () => {
    const result = adjudicateInvalidOriginReservationV1(fixture());
    assert.equal(result.schema_version, INVALID_ORIGIN_ADJUDICATION_SCHEMA_VERSION_V1);
    assert.equal(result.status, "CANCELLED_INVALID_ORIGIN");
    assert.equal(result.reservation_disposition, "ADMINISTRATIVELY_RELEASED");
    assert.equal(result.market_execution_effect, "NONE");
  });

  it("refuses execution evidence, contradictory lifecycle, and third-party references", () => {
    assert.throws(() => adjudicateInvalidOriginReservationV1(fixture({
      execution_evidence: { ...evidence(), manual_execution_event_count: 1 },
    })), { code: "ADJUDICATION_EXECUTION_EVIDENCE_PRESENT" });
    assert.throws(() => adjudicateInvalidOriginReservationV1(fixture({
      execution_evidence: { ...evidence(), lifecycle_status: "UNKNOWN" },
    })), { code: "ADJUDICATION_EXECUTION_STATE_CONTRADICTS_ATTESTATION" });
    assert.throws(() => adjudicateInvalidOriginReservationV1(fixture({
      execution_evidence: { ...evidence(), lifecycle_status: "FUTURE_PROVIDER_STATE" },
    })), { code: "ADJUDICATION_EXECUTION_STATE_CONTRADICTS_ATTESTATION" });
    assert.throws(() => adjudicateInvalidOriginReservationV1(fixture({
      operator_attestation: { ...attestation(), third_party_execution_reference: "broker-123" },
    })), { code: "ADJUDICATION_THIRD_PARTY_REFERENCE_REFUSED" });
  });

  it("refuses revision, source hash, lineage hash, and retroactive effect changes", () => {
    assert.throws(() => adjudicateInvalidOriginReservationV1(fixture({ expectation: { revision: 2, manifest_hash: "a".repeat(64) } })),
      { code: "ADJUDICATION_QUALIFICATION_REVISION_MISMATCH" });
    assert.throws(() => adjudicateInvalidOriginReservationV1(fixture({ expectation: { revision: 1, manifest_hash: "b".repeat(64) } })),
      { code: "ADJUDICATION_QUALIFICATION_HASH_MISMATCH" });
    assert.throws(() => adjudicateInvalidOriginReservationV1(fixture({ qualification: { ...qualification(), lineage_payload_hash: "sha256:changed" } })),
      { code: "ADJUDICATION_LINEAGE_HASH_MISMATCH" });
    for (const revision of [null, undefined, 0, 1.5]) {
      assert.throws(() => adjudicateInvalidOriginReservationV1(fixture({
        qualification: { ...qualification(), revision },
      })), { code: "ADJUDICATION_QUALIFICATION_REVISION_MISMATCH" });
    }
    for (const manifest_hash of [null, undefined, "", "a".repeat(63)]) {
      assert.throws(() => adjudicateInvalidOriginReservationV1(fixture({
        qualification: { ...qualification(), manifest_hash },
      })), { code: "ADJUDICATION_QUALIFICATION_HASH_MISMATCH" });
    }
    assert.throws(() => adjudicateInvalidOriginReservationV1(fixture({ effective_at_utc: "2026-09-07T08:59:59Z" })),
      { code: "ADJUDICATION_PRECEDES_QUALIFICATION" });
  });
});

function fixture(overrides = {}) {
  return {
    portfolio_order_intent_id: "intent-1",
    qualification: qualification(),
    expectation: { revision: 1, manifest_hash: "a".repeat(64) },
    execution_evidence: evidence(),
    operator_attestation: attestation(),
    effective_at_utc: "2026-09-07T10:00:00Z",
    ...overrides,
  };
}

function qualification() {
  return { revision: 1, manifest_hash: "a".repeat(64), lineage_payload_hash: `sha256:${"c".repeat(64)}`,
    expected_lineage_payload_hash: `sha256:${"c".repeat(64)}`, current_lineage_status: "EXPIRED",
    origin_classification: "INVALID_ORIGIN_PLAN",
    reconstruction_status: "UNQUALIFIABLE", provider_evidence_status: "ABSENT",
    reservation_disposition: "RETAINED", qualified_at_utc: "2026-09-07T09:00:00Z" };
}

function evidence() {
  return { provider_command_count: 0, provider_event_count: 0, trade_count: 0, fill_count: 0,
    manual_execution_event_count: 0, third_party_reference_count: 0, filled_quantity: 0,
    lifecycle_status: "AWAITING_MANUAL_CONFIRMATION" };
}

function attestation() {
  return { schema_version: "operator_no_open_exposure_attestation_v1", no_open_orders: true,
    no_open_positions: true };
}
