import assert from "node:assert/strict";
import test from "node:test";
import { telegramOrderQualificationReason } from "../src/telegram-order-qualification.js";

test("Telegram qualification preserves validation order and successful null result", () => {
  const valid = qualification();
  assert.equal(telegramOrderQualificationReason(valid), null);
  assert.equal(telegramOrderQualificationReason({ ...valid, telegram_qualification_source: null, risk_decision: "REJECTED" }), "ORDER_INTENT_CANONICAL_QUALIFICATION_UNVERIFIED");
  assert.equal(telegramOrderQualificationReason({ ...valid, risk_decision: "REJECTED", human_gate_status: "REJECTED" }), "ORDER_INTENT_RISK_NOT_AUTHORIZED");
  assert.equal(telegramOrderQualificationReason({ ...valid, human_gate_status: "REJECTED", side: null }), "ORDER_INTENT_HUMAN_GATE_NOT_AWAITING_CONFIRMATION");
  assert.equal(telegramOrderQualificationReason({ ...valid, side: null, order_type: "unknown" }), "ORDER_INTENT_EXECUTION_PLAN_INCOMPLETE");
  assert.equal(telegramOrderQualificationReason({ ...valid, order_type: "unknown" }), "ORDER_INTENT_ORDER_TYPE_UNKNOWN");
  assert.equal(telegramOrderQualificationReason({ ...valid, entry_price: null, limit_price: null, stop_price: null }), "ORDER_INTENT_ENTRY_PRICE_UNAVAILABLE");
  assert.equal(telegramOrderQualificationReason({ ...valid, expires_at: "invalid" }), "ORDER_INTENT_EXPIRY_UNVERIFIED");
});

function qualification() {
  return {
    telegram_qualification_source: "portfolio_risk_human_gate",
    order_intent_id: "intent-1", target_position_id: "target-1", human_execution_gate_id: "gate-1",
    risk_decision: "APPROVED", human_gate_status: "AWAITING_MANUAL_CONFIRMATION",
    side: "buy", instrument: "ZW", quantity: 1, protective_stop: 500, profit_target: 510,
    order_type: "limit", entry_price: 505, expires_at: "2026-09-05T12:00:00.000Z",
  };
}
