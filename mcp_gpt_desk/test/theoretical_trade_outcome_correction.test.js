import assert from "node:assert/strict";
import { test } from "node:test";
import { correctTheoreticalTradeOutcomes } from "../src/application/correct-theoretical-trade-outcomes.js";

const economicTime = "2026-08-31T17:54:00.000Z";
const correctionTime = "2026-09-07T08:00:00.000Z";

test("dry-run verifies exact lineage and calculates with canonical units without persistence", async () => {
  let appended = 0;
  const candidate = fixtureCandidate();
  const repository = fixtureRepository(candidate, () => { appended += 1; });
  const result = await correctTheoreticalTradeOutcomes({
    mode: "DRY_RUN",
    manifest: fixtureManifest(),
    correction_known_at_utc: correctionTime,
  }, { repository });

  assert.equal(result.status, "DRY_RUN_VERIFIED");
  assert.equal(result.items[0].status, "WOULD_APPLY");
  assert.equal(result.items[0].previous.point_value, 1);
  assert.equal(result.items[0].corrected.point_value, 50);
  assert.equal(result.items[0].corrected.net_realized_pnl, -50);
  assert.equal(appended, 0);
});

test("compare-and-swap refuses a changed evidence hash", async () => {
  const candidate = fixtureCandidate({ evidence_hash: "b".repeat(64) });
  await assert.rejects(
    correctTheoreticalTradeOutcomes({ mode: "DRY_RUN", manifest: fixtureManifest() }, {
      repository: fixtureRepository(candidate),
    }),
    { code: "OUTCOME_EVIDENCE_HASH_MISMATCH" },
  );
});

test("apply requires an actor, reason and explicit correction-known time", async () => {
  await assert.rejects(
    correctTheoreticalTradeOutcomes({ mode: "APPLY", manifest: fixtureManifest() }, {
      repository: fixtureRepository(fixtureCandidate()),
    }),
    { code: "APPLY_AUDIT_FIELDS_REQUIRED" },
  );
});

function fixtureRepository(candidate, onAppend = () => undefined) {
  return {
    execute: async (_options, work) => work({
      findApplied: async () => null,
      loadCandidate: async () => candidate,
      appendCorrection: async () => { onAppend(); throw new Error("unexpected append"); },
    }),
  };
}

function fixtureCandidate(overrides = {}) {
  return {
    trade_id: "trade-1",
    portfolio_order_intent_id: "intent-1",
    trade_status: "closed",
    side: "long",
    quantity_planned: "1",
    avg_entry_price: "100",
    initial_stop_price: "99",
    trade_source: "theoretical_execution_engine",
    execution_point_value: null,
    trade_outcome_id: "outcome-1",
    revision: 1,
    outcome_status: "final",
    evidence_hash: "a".repeat(64),
    evidence: { point_value: 1 },
    finalized_at_utc: economicTime,
    net_realized_pnl: "-1",
    result_r: "-1",
    intent_economics_point_value: "50",
    intent_point_value: null,
    target_economics_point_value: "50",
    target_point_value: null,
    fills: [
      { side: "buy", quantity: "1", price: "100", commission: null, filled_at: "2026-08-31T17:47:00Z", broker_fill_ref: "entry" },
      { side: "sell", quantity: "1", price: "99", commission: null, filled_at: economicTime, broker_fill_ref: "exit" },
    ],
    ...overrides,
  };
}

function fixtureManifest() {
  return {
    schema_version: "trade_outcome_correction_manifest_v1",
    manifest_id: "fixture-manifest",
    corrections: [{
      idempotency_key: "fixture-correction-1",
      trade_id: "trade-1",
      portfolio_order_intent_id: "intent-1",
      expected_trade_outcome_id: "outcome-1",
      expected_revision: 1,
      expected_evidence_hash: "a".repeat(64),
      expected_evidence_point_value: 1,
      canonical_point_value: 50,
      expected_economic_finalized_at_utc: economicTime,
      expected_corrected_net_pnl_usd: -50,
      expected_result_r: -1,
    }],
  };
}
