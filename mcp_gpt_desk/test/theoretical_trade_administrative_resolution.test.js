import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveTheoreticalTradeAdministrativeReview }
  from "../src/application/resolve-theoretical-trade-administrative-review.js";

const manifest = JSON.parse(await readFile(new URL(
  "../../reports/research/THEORETICAL_TRADE_ADMINISTRATIVE_RESOLUTION_20260908.json",
  import.meta.url)));

test("dry run verifies the exact trade without appending or inventing market execution", async () => {
  let appends = 0;
  const result = await resolveTheoreticalTradeAdministrativeReview(command(), {
    repository: fixtureRepository({ onAppend: () => { appends += 1; } }),
  });
  assert.equal(result.status, "DRY_RUN_VERIFIED");
  assert.equal(result.item_count, 1);
  assert.equal(result.exposure_effect, "ADMINISTRATIVELY_RELEASED_AS_OF_EFFECTIVE_AND_KNOWN_AT");
  assert.equal(result.historical_outcome_effect, "UNDETERMINED_PRESERVED");
  assert.equal(result.market_execution_effect, "NONE");
  assert.equal(result.items[0].status, "WOULD_APPEND");
  assert.equal(appends, 0);
});

test("manifest mutation, CAS drift, and contradictory evidence are refused", async () => {
  const changed = structuredClone(manifest);
  changed.resolutions[0].expected_quantity_open = 1;
  await assert.rejects(resolveTheoreticalTradeAdministrativeReview({ ...command(), manifest: changed }, {
    repository: fixtureRepository(),
  }), { code: "THEORETICAL_ADMIN_RESOLUTION_ALLOWLIST_MISMATCH" });
  await assert.rejects(resolveTheoreticalTradeAdministrativeReview(command(), {
    repository: fixtureRepository({ candidateOverrides: { current_trade_revision: 1 } }),
  }), { code: "THEORETICAL_ADMIN_RESOLUTION_TRADE_CAS_MISMATCH" });
  await assert.rejects(resolveTheoreticalTradeAdministrativeReview(command(), {
    repository: fixtureRepository({ candidateOverrides: { outcome_count: 1 } }),
  }), { code: "THEORETICAL_ADMIN_RESOLUTION_EXECUTION_CONTRADICTION" });
});

function command() {
  return { mode: "DRY_RUN", manifest, effective_at_utc: "2026-09-08T00:00:00Z",
    actor: "operator-authorized", reason: "No corresponding real order or position remains open.",
    operator_attestation: { schema_version: "operator_no_open_exposure_attestation_v1",
      no_open_orders: true, no_open_positions: true } };
}

function fixtureRepository({ onAppend = () => undefined, candidateOverrides = {} } = {}) {
  return { execute: async (_options, work) => work({ findApplied: async () => null,
    loadCandidate: async () => candidate(candidateOverrides),
    appendResolution: async () => { onAppend(); throw new Error("UNEXPECTED_APPEND"); } }) };
}

function candidate(overrides = {}) {
  const spec = manifest.resolutions[0];
  return { trade_id: spec.trade_id, portfolio_order_intent_id: spec.portfolio_order_intent_id,
    current_trade_revision: 0, current_trade_status: "open", current_quantity_open: 2,
    trade_created_at: "2026-09-07T00:00:00Z", trade_source: "theoretical_execution_engine",
    theoretical_review_required: true, current_lineage_payload_hash: spec.expected_lineage_payload_hash,
    provider_command_count: 0, provider_event_count: 0, broker_order_count: 0,
    broker_order_event_count: 0, manual_execution_event_count: 0, physical_fill_count: 0,
    theoretical_fill_count: 1, theoretical_entry_fill_count: 1, theoretical_review_count: 1,
    other_theoretical_event_count: 0, outcome_count: 0, physical_third_party_reference_count: 0,
    ...overrides };
}
