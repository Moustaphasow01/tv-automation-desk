import assert from "node:assert/strict";
import test from "node:test";
import { resolveTheoreticalTradeAdministrativeReviewV1 }
  from "../src/theoretical-trade-administrative-resolution-v1.js";

test("ambiguous theoretical review can release current exposure without producing an outcome", () => {
  const result = resolveTheoreticalTradeAdministrativeReviewV1(input());
  assert.equal(result.status, "ADMINISTRATIVELY_RESOLVED_NO_REAL_EXPOSURE");
  assert.equal(result.exposure_disposition, "ADMINISTRATIVELY_RELEASED");
  assert.equal(result.historical_outcome_disposition, "UNDETERMINED_PRESERVED");
  assert.equal(result.market_execution_effect, "NONE");
});

test("physical, manual, outcome, or extra theoretical evidence fails closed", () => {
  for (const evidence of [{ provider_event_count: 1 }, { manual_execution_event_count: 1 },
    { physical_fill_count: 1 }, { outcome_count: 1 }, { other_theoretical_event_count: 1 }]) {
    assert.throws(() => resolveTheoreticalTradeAdministrativeReviewV1(input({ evidence })),
      { code: "THEORETICAL_ADMIN_RESOLUTION_EXECUTION_CONTRADICTION" });
  }
});

test("trade identity, CAS, review state and exact theoretical evidence are mandatory", () => {
  assert.throws(() => resolveTheoreticalTradeAdministrativeReviewV1(input({
    trade: { revision: 1 },
  })), { code: "THEORETICAL_ADMIN_RESOLUTION_TRADE_CAS_MISMATCH" });
  assert.throws(() => resolveTheoreticalTradeAdministrativeReviewV1(input({
    trade: { theoretical_review_required: false },
  })), { code: "THEORETICAL_ADMIN_RESOLUTION_NOT_REVIEW_REQUIRED" });
  assert.throws(() => resolveTheoreticalTradeAdministrativeReviewV1(input({
    evidence: { theoretical_review_count: 0 },
  })), { code: "THEORETICAL_ADMIN_RESOLUTION_EVIDENCE_MISMATCH" });
});

function input(overrides = {}) {
  const tradeId = "trade-1";
  const intentId = "intent-1";
  return { trade_id: tradeId, portfolio_order_intent_id: intentId,
    trade: { trade_id: tradeId, portfolio_order_intent_id: intentId, revision: 0,
      status: "open", quantity_open: 2, source: "theoretical_execution_engine",
      theoretical_review_required: true, created_at: "2026-09-07T00:00:00Z",
      ...overrides.trade },
    expectation: { revision: 0, status: "open", quantity_open: 2 },
    execution_evidence: { provider_command_count: 0, provider_event_count: 0,
      broker_order_count: 0, broker_order_event_count: 0, manual_execution_event_count: 0,
      physical_fill_count: 0, theoretical_fill_count: 1, theoretical_entry_fill_count: 1,
      theoretical_review_count: 1, other_theoretical_event_count: 0, outcome_count: 0,
      physical_third_party_reference_count: 0, ...overrides.evidence },
    operator_attestation: { schema_version: "operator_no_open_exposure_attestation_v1",
      no_open_orders: true, no_open_positions: true },
    effective_at_utc: "2026-09-08T00:00:00Z" };
}
