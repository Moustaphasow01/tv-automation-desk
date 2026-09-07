import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { qualifyHistoricalGrainsIntents } from "../src/application/qualify-historical-grains-intents.js";

const manifest = JSON.parse(await readFile(new URL("../../reports/research/GRAINS_HISTORICAL_INTENT_QUALIFICATIONS_20260907.json", import.meta.url)));

test("dry-run qualifies only the exact historical allowlist and retains reservations", async () => {
  let appended = 0;
  const result = await qualifyHistoricalGrainsIntents({ mode: "DRY_RUN", manifest }, {
    repository: fixtureRepository(() => { appended += 1; }),
  });
  assert.equal(result.status, "DRY_RUN_VERIFIED");
  assert.equal(result.item_count, 8);
  assert.equal(result.reservation_effect, "NONE_RETAINED");
  assert.ok(result.items.every((item) => item.status === "WOULD_APPEND"
    && item.origin_classification === "INVALID_ORIGIN_PLAN"
    && item.reconstruction_status === "UNQUALIFIABLE"
    && item.reservation_disposition === "RETAINED"));
  assert.equal(appended, 0);
});

test("qualification fails closed on changed provider or payload evidence", async () => {
  await assert.rejects(qualifyHistoricalGrainsIntents({ mode: "DRY_RUN", manifest }, {
    repository: fixtureRepository(undefined, { provider_command_count: 1 }),
  }), { code: "EXECUTION_EVIDENCE_PRESENT" });
  await assert.rejects(qualifyHistoricalGrainsIntents({ mode: "DRY_RUN", manifest }, {
    repository: fixtureRepository(undefined, { lineage_payload_hash: "sha256:changed" }),
  }), { code: "LINEAGE_HASH_MISMATCH" });
});

test("apply needs current audit fields and rejects a partial allowlist", async () => {
  await assert.rejects(qualifyHistoricalGrainsIntents({ mode: "APPLY", manifest }, {
    repository: fixtureRepository(),
  }), { code: "QUALIFICATION_AUDIT_REQUIRED" });
  await assert.rejects(qualifyHistoricalGrainsIntents({
    mode: "DRY_RUN", manifest: { ...manifest, qualifications: manifest.qualifications.slice(1) },
  }, { repository: fixtureRepository() }), { code: "QUALIFICATION_ALLOWLIST_MISMATCH" });
});

function fixtureRepository(onAppend = () => undefined, overrides = {}) {
  return { execute: async (_options, work) => work({
    findApplied: async () => null,
    loadCandidate: async (specification) => candidate(specification, overrides),
    appendQualification: async () => { onAppend(); throw new Error("unexpected append"); },
  }) };
}

function candidate(specification, overrides) {
  return {
    target_position_id: specification.target_position_id,
    source_signal_id: specification.source_signal_id,
    lineage_status: "EXPIRED",
    lineage_payload_hash: specification.expected_lineage_payload_hash,
    target_payload_hash: specification.expected_target_payload_hash,
    signal_payload_hash: specification.expected_signal_payload_hash,
    previous_revision: 0,
    theoretical_event_count: specification.expected_theoretical_event_count,
    unproven_expiry_count: specification.expected_unproven_expiry_count,
    intent_entry_price: null,
    target_entry_price: null,
    signal_entry_price: null,
    intent_economics_availability: "UNAVAILABLE",
    target_economics_availability: "UNAVAILABLE",
    provider_command_count: 0,
    provider_event_count: 0,
    trade_count: 0,
    fill_count: 0,
    ...overrides,
  };
}
