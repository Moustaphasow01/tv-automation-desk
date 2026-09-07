import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { adjudicateHistoricalInvalidOriginIntents } from "../src/application/adjudicate-historical-invalid-origin-intents.js";

const manifest = JSON.parse(await readFile(new URL(
  "../../reports/research/GRAINS_HISTORICAL_INVALID_ORIGIN_ADJUDICATIONS_20260907.json", import.meta.url)));
const EFFECTIVE_AT = "2026-09-07T10:00:00.000Z";

test("dry-run verifies the exact retained allowlist without appending", async () => {
  let appends = 0;
  const result = await adjudicateHistoricalInvalidOriginIntents(command(), {
    repository: fixtureRepository({ onAppend: () => { appends += 1; } }),
  });
  assert.equal(result.status, "DRY_RUN_VERIFIED");
  assert.equal(result.item_count, 8);
  assert.equal(result.reservation_effect, "ADMINISTRATIVELY_RELEASED_AS_OF_EFFECTIVE_AT");
  assert.equal(result.market_execution_effect, "NONE");
  assert.ok(result.items.every((item) => item.status === "WOULD_APPEND"
    && item.adjudication_status === "CANCELLED_INVALID_ORIGIN"));
  assert.equal(appends, 0);
});

test("audit, full allowlist, qualification revision and hash are mandatory", async () => {
  await assert.rejects(adjudicateHistoricalInvalidOriginIntents({ mode: "DRY_RUN", manifest }, {
    repository: fixtureRepository(),
  }), { code: "ADJUDICATION_AUDIT_REQUIRED" });
  await assert.rejects(adjudicateHistoricalInvalidOriginIntents({
    ...command(), manifest: { ...manifest, adjudications: manifest.adjudications.slice(1) },
  }, { repository: fixtureRepository() }), { code: "ADJUDICATION_ALLOWLIST_MISMATCH" });
  await assert.rejects(adjudicateHistoricalInvalidOriginIntents(command(), {
    repository: fixtureRepository({ candidateOverrides: { qualification_revision: 2 } }),
  }), { code: "ADJUDICATION_QUALIFICATION_REVISION_MISMATCH" });
  await assert.rejects(adjudicateHistoricalInvalidOriginIntents(command(), {
    repository: fixtureRepository({ candidateOverrides: { qualification_manifest_hash: "b".repeat(64) } }),
  }), { code: "ADJUDICATION_QUALIFICATION_HASH_MISMATCH" });
});

test("operator attestation refuses any third-party execution reference", async () => {
  await assert.rejects(adjudicateHistoricalInvalidOriginIntents({ ...command(), operator_attestation: {
    ...attestation(), third_party_execution_reference: "provider-order-42",
  } }, { repository: fixtureRepository() }), { code: "ADJUDICATION_THIRD_PARTY_REFERENCE_REFUSED" });
});

function command() {
  return { mode: "DRY_RUN", manifest, effective_at_utc: EFFECTIVE_AT, actor: "operator-test",
    reason: "Explicit administrative closure; no open order or position.", operator_attestation: attestation() };
}

function attestation() {
  return { schema_version: "operator_no_open_exposure_attestation_v1", no_open_orders: true,
    no_open_positions: true };
}

function fixtureRepository({ onAppend = () => undefined, candidateOverrides = {} } = {}) {
  return { execute: async (_options, work) => work({
    findApplied: async () => null,
    loadCandidate: async (specification) => candidate(specification, candidateOverrides),
    appendAdjudication: async () => { onAppend(); throw new Error("UNEXPECTED_APPEND"); },
  }) };
}

function candidate(specification, overrides) {
  return { historical_intent_qualification_id: `qualification:${specification.portfolio_order_intent_id}`,
    qualification_revision: 1, qualification_manifest_hash: specification.expected_qualification_manifest_hash,
    current_lineage_payload_hash: `sha256:${"c".repeat(64)}`,
    expected_lineage_payload_hash: `sha256:${"c".repeat(64)}`, current_lineage_status: "EXPIRED",
    origin_classification: "INVALID_ORIGIN_PLAN", reconstruction_status: "UNQUALIFIABLE",
    provider_evidence_status: "ABSENT", qualification_reservation_disposition: "RETAINED",
    qualified_at_utc: "2026-09-07T09:00:00Z", previous_revision: 0,
    provider_command_count: 0, provider_event_count: 0, trade_count: 0, fill_count: 0,
    manual_execution_event_count: 0, third_party_reference_count: 0, filled_quantity: 0,
    lifecycle_status: "AWAITING_MANUAL_CONFIRMATION", ...overrides };
}
