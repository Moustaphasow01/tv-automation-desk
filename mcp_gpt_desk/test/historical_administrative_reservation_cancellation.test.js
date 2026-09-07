import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { cancelHistoricalAdministrativeReservations }
  from "../src/application/cancel-historical-administrative-reservations.js";

const manifest = JSON.parse(await readFile(new URL(
  "../../reports/research/GRAINS_HISTORICAL_ADMINISTRATIVE_RESERVATION_CANCELLATIONS_20260907.json",
  import.meta.url)));

test("dry-run verifies the exact 49 reservation allowlist without appending", async () => {
  let appends = 0;
  const result = await cancelHistoricalAdministrativeReservations(command(), {
    repository: fixtureRepository({ onAppend: () => { appends += 1; } }),
  });
  assert.equal(result.status, "DRY_RUN_VERIFIED");
  assert.equal(result.item_count, 49);
  assert.equal(result.historical_outcome_effect, "UNDETERMINED_PRESERVED");
  assert.equal(result.market_execution_effect, "NONE");
  assert.ok(result.items.every((item) => item.status === "WOULD_APPEND"
    && item.cancellation_status === "CANCELLED_ADMINISTRATIVE_NO_OPEN_EXPOSURE"));
  assert.equal(appends, 0);
});

test("audit, exact allowlist, revision, and lineage CAS are mandatory", async () => {
  await assert.rejects(cancelHistoricalAdministrativeReservations({ mode: "DRY_RUN", manifest }, {
    repository: fixtureRepository(),
  }), { code: "ADMIN_CANCELLATION_AUDIT_REQUIRED" });
  await assert.rejects(cancelHistoricalAdministrativeReservations({
    ...command(), manifest: { ...manifest, cancellations: manifest.cancellations.slice(1) },
  }, { repository: fixtureRepository() }), { code: "ADMIN_CANCELLATION_ALLOWLIST_MISMATCH" });
  const changedHashManifest = structuredClone(manifest);
  changedHashManifest.cancellations[0].expected_lineage_payload_hash = `sha256:${"f".repeat(64)}`;
  await assert.rejects(cancelHistoricalAdministrativeReservations({
    ...command(), manifest: changedHashManifest,
  }, { repository: fixtureRepository() }), { code: "ADMIN_CANCELLATION_MANIFEST_HASH_MISMATCH" });
  await assert.rejects(cancelHistoricalAdministrativeReservations(command(), {
    repository: fixtureRepository({ candidateOverrides: { previous_revision: 1 } }),
  }), { code: "ADMIN_CANCELLATION_REVISION_MISMATCH" });
  await assert.rejects(cancelHistoricalAdministrativeReservations(command(), {
    repository: fixtureRepository({ candidateOverrides: { current_lineage_payload_hash: `sha256:${"b".repeat(64)}` } }),
  }), { code: "ADMIN_CANCELLATION_LINEAGE_HASH_MISMATCH" });
});

test("provider, fill, manual, theoretical, and unknown state evidence fail closed", async () => {
  for (const candidateOverrides of [{ provider_event_count: 1 }, { fill_count: 1 },
    { manual_execution_event_count: 1 }, { theoretical_entry_fill_count: 1 },
    { unexpected_theoretical_event_count: 1 }, { lifecycle_status: "UNKNOWN" }]) {
    await assert.rejects(cancelHistoricalAdministrativeReservations(command(), {
      repository: fixtureRepository({ candidateOverrides }),
    }), { code: candidateOverrides.lifecycle_status
      ? "ADMIN_CANCELLATION_EXECUTION_STATE_CONTRADICTS_ATTESTATION"
      : "ADMIN_CANCELLATION_EXECUTION_EVIDENCE_PRESENT" });
  }
});

function command() {
  return { mode: "DRY_RUN", manifest, effective_at_utc: "2026-09-07T12:00:00Z",
    actor: "operator-test", reason: "Explicit administrative closure; no corresponding order or position is open.",
    operator_attestation: { schema_version: "operator_no_open_exposure_attestation_v1",
      no_open_orders: true, no_open_positions: true } };
}

function fixtureRepository({ onAppend = () => undefined, candidateOverrides = {} } = {}) {
  return { execute: async (_options, work) => work({
    findApplied: async () => null,
    loadCandidate: async (specification) => candidate(specification, candidateOverrides),
    appendCancellation: async () => { onAppend(); throw new Error("UNEXPECTED_APPEND"); },
  }) };
}

function candidate(specification, overrides) {
  return { previous_revision: 0, current_lineage_status: "EXPIRED",
    current_lineage_payload_hash: specification.expected_lineage_payload_hash,
    lineage_created_at_utc: "2026-06-11T00:00:00Z", provider_command_count: 0,
    provider_event_count: 0, broker_order_count: 0, broker_order_event_count: 0, trade_count: 0,
    fill_count: 0, manual_execution_event_count: 0, theoretical_entry_fill_count: 0,
    unexpected_theoretical_event_count: 0, third_party_reference_count: 0,
    filled_quantity: 0, lifecycle_status: "EXPIRED", ...overrides };
}
