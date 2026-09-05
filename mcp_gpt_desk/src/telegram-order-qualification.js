/** Presentation eligibility only. This grants no execution permission and never changes Risk. */
export function telegramOrderQualificationReason(payload = {}) {
  return canonicalQualificationReason(payload)
    || riskQualificationReason(payload)
    || gateQualificationReason(payload)
    || executionPlanReason(payload)
    || orderTypeReason(payload)
    || expiryReason(payload);
}

function canonicalQualificationReason(payload) {
  if (payload.telegram_qualification_source === "portfolio_risk_human_gate"
      && payload.order_intent_id && payload.target_position_id && payload.human_execution_gate_id) return null;
  return "ORDER_INTENT_CANONICAL_QUALIFICATION_UNVERIFIED";
}

function riskQualificationReason(payload) {
  return ["APPROVED", "REDUCED"].includes(String(payload.risk_decision).toUpperCase())
    ? null : "ORDER_INTENT_RISK_NOT_AUTHORIZED";
}

function gateQualificationReason(payload) {
  return String(payload.human_gate_status).toUpperCase() === "AWAITING_MANUAL_CONFIRMATION"
    ? null : "ORDER_INTENT_HUMAN_GATE_NOT_AWAITING_CONFIRMATION";
}

function executionPlanReason(payload) {
  const validSide = ["buy", "sell", "long", "short"].includes(String(payload.side).toLowerCase());
  if (validSide && payload.instrument && positive(payload.quantity)
      && positive(payload.protective_stop) && positive(payload.profit_target)) return null;
  return "ORDER_INTENT_EXECUTION_PLAN_INCOMPLETE";
}

function orderTypeReason(payload) {
  const type = String(payload.order_type).toLowerCase();
  if (!["market", "limit", "stop_market", "stop_limit"].includes(type)) return "ORDER_INTENT_ORDER_TYPE_UNKNOWN";
  if (type === "market" || positive(payload.entry_price ?? payload.limit_price ?? payload.stop_price)) return null;
  return "ORDER_INTENT_ENTRY_PRICE_UNAVAILABLE";
}

function expiryReason(payload) {
  return Number.isFinite(Date.parse(String(payload.expires_at || "")))
    ? null : "ORDER_INTENT_EXPIRY_UNVERIFIED";
}

function positive(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value) > 0;
}
