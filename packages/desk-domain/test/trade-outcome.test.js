import assert from "node:assert/strict";
import test from "node:test";
import { calculateTradeOutcome } from "../index.js";

test("trade outcome calculates net R from immutable initial risk and fees", () => {
  const outcome = calculateTradeOutcome({
    side: "long",
    entryPrice: 20_000,
    initialStopPrice: 19_990,
    initialQuantity: 2,
    pointValue: 2,
    exitFills: [
      { quantity: 1, price: 20_010, commission: 1 },
      { quantity: 1, price: 20_020, commission: 1 },
    ],
    entryFills: [{ quantity: 2, price: 20_000, commission: 2 }],
    candles: [{ high: 20_025, low: 19_995 }],
    calculatedAt: "2026-07-27T10:00:00.000Z",
  });

  assert.equal(outcome.gross_realized_pnl, 60);
  assert.equal(outcome.total_fees, 4);
  assert.equal(outcome.net_realized_pnl, 56);
  assert.equal(outcome.initial_risk_amount, 40);
  assert.equal(outcome.result_r, 1.4);
  assert.equal(outcome.mfe_r, 2.5);
  assert.equal(outcome.mae_r, -0.5);
  assert.equal(outcome.status, "final");
  assert.equal(outcome.evidence_hash.length, 64);
});

test("trade outcome supports partial exits without redefining initial risk", () => {
  const outcome = calculateTradeOutcome({
    side: "short",
    entryPrice: 6_000,
    initialStopPrice: 6_010,
    initialQuantity: 2,
    pointValue: 5,
    exitFills: [{ quantity: 1, price: 5_990 }],
    calculatedAt: "2026-07-27T10:00:00.000Z",
  });

  assert.equal(outcome.initial_risk_amount, 100);
  assert.equal(outcome.net_realized_pnl, 50);
  assert.equal(outcome.result_r, 0.5);
  assert.equal(outcome.status, "partial");
});
