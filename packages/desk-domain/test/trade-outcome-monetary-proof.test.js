import test from "node:test";
import assert from "node:assert/strict";
import { calculateTradeOutcome, isTradeOutcomeMonetaryProofValid } from "../src/trade-outcome.js";

const calculate = overrides => calculateTradeOutcome({ side: "long", entryPrice: 100, initialStopPrice: 90,
  initialQuantity: 2, pointValue: 50, exitFills: [{ price: 99, quantity: 1 }, { price: 98, quantity: 1 }],
  calculatedAt: "2026-09-05T14:04:00Z", ...overrides });

test("monetary proof validates the existing canonical engine, including SQL numeric strings", () => {
  const outcome = calculate();
  assert.equal(outcome.net_realized_pnl, -150);
  assert.equal(isTradeOutcomeMonetaryProofValid(outcome), true);
  assert.equal(isTradeOutcomeMonetaryProofValid({ ...outcome, net_realized_pnl: "-150" }), true);
});

test("changing units or monetary projection without a coherent revision is refused", () => {
  const original = calculate();
  for (const point_value of [1, null, "50", {}, -50]) {
    assert.equal(isTradeOutcomeMonetaryProofValid({ ...original, evidence: { ...original.evidence, point_value } }), false);
  }
  for (const field of ["gross_realized_pnl", "net_realized_pnl", "total_fees"]) {
    for (const value of [null, "", undefined, 987]) {
      assert.equal(isTradeOutcomeMonetaryProofValid({ ...original, [field]: value }), false);
    }
  }
  assert.equal(isTradeOutcomeMonetaryProofValid({ ...original, evidence_hash: "not-the-hash" }), false);
  assert.equal(isTradeOutcomeMonetaryProofValid({ ...calculate({ pointValue: 1 }), evidence: original.evidence }), false);
});

test("unknown evidence versions, missing proof and malformed fills fail closed without throwing", () => {
  const original = calculate();
  assert.equal(isTradeOutcomeMonetaryProofValid(null), false);
  assert.equal(isTradeOutcomeMonetaryProofValid(), false);
  for (const patch of [{ schema_version: "future" }, { engine_version: "future" }, { status: "partial" },
    { evidence: null }, { evidence: {} }, { calculated_at_utc: "invalid" },
    { evidence: { ...original.evidence, exit_fills: [{ price: -1, quantity: 2 }] } }]) {
    assert.equal(isTradeOutcomeMonetaryProofValid({ ...original, ...patch }), false);
  }
});
