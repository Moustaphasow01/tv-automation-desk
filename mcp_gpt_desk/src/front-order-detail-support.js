import { text } from "./front-control-plane-common.js";
import { nullableNumber, rows, upper } from "./front-control-plane-projection-helpers.js";

export function executionAuthorityMode(safety = {}) {
  const authority = upper(safety.executionAuthorityMode || safety.execution_authority_mode);
  return authority.includes("SEMI") ? "SEMI_MANUAL" : authority || "UNKNOWN";
}

export function orderIntentReconciliation({ execution, portfolioIntent, fills }) {
  const portfolioOrderIntentId = text(portfolioIntent?.portfolio_order_intent_id, "");
  const state = rows(execution?.portfolioExecutionStates)
    .find((item) => text(item.portfolio_order_intent_id, "") === portfolioOrderIntentId) || {};
  const payload = portfolioIntent.order_intent_payload || portfolioIntent.payload || {};
  if (reconciliationDisabled(state, execution)) return disabledReconciliation();
  const quantities = reconciliationQuantities({ state, payload, portfolioIntent, fills });
  return knownReconciliation({ state, payload, portfolioIntent, portfolioOrderIntentId, ...quantities });
}

function reconciliationDisabled(state, execution) {
  return !state.portfolio_order_intent_id && execution?.safety?.submissionPossible !== true;
}

function reconciliationQuantities({ state, payload, portfolioIntent, fills }) {
  const expectedQuantity = nullableNumber(payload.quantity ?? portfolioIntent.quantity);
  const fallbackFilled = fills.length ? fills.reduce((sum, item) => sum + item.quantity, 0) : null;
  const filledQuantity = nullableNumber(state.filled_quantity ?? fallbackFilled);
  return { expectedQuantity, filledQuantity };
}

function knownReconciliation({ state, payload, portfolioIntent, portfolioOrderIntentId, expectedQuantity, filledQuantity }) {
  const lifecycleStatus = text(state.lifecycle_status, "AWAITING_MANUAL_CONFIRMATION");
  const mismatch = quantityMismatch({ lifecycleStatus, filledQuantity, expectedQuantity });
  const mismatches = mismatch
    ? [{ field: "quantity", expected: String(expectedQuantity), actual: String(filledQuantity), reason: "FILLED_QUANTITY_MISMATCH" }]
    : [];
  return {
    status: mismatches.length ? "MISMATCH" : lifecycleStatus,
    availability: "KNOWN",
    checkedAt: text(state.updated_at_utc || portfolioIntent.created_at_utc, ""),
    expected: [
      { label: "portfolioOrderIntentId", value: portfolioOrderIntentId },
      { label: "quantity", value: expectedQuantity },
      { label: "targetPositionId", value: text(portfolioIntent.target_position_id || payload.target_position_id, "") },
    ],
    broker: [
      { label: "filledQuantity", value: filledQuantity },
      { label: "providerOrderRef", value: text(state.provider_order_ref, "") },
      { label: "lifecycleStatus", value: lifecycleStatus },
    ],
    mismatches,
    mismatchCount: mismatches.length,
  };
}

function quantityMismatch({ lifecycleStatus, filledQuantity, expectedQuantity }) {
  return lifecycleStatus === "FILLED"
    && filledQuantity !== null
    && expectedQuantity !== null
    && filledQuantity !== expectedQuantity;
}

function disabledReconciliation() {
  return {
    status: "NOT_APPLICABLE_CURRENT_MODE",
    availability: "NOT_APPLICABLE_CURRENT_MODE",
    checkedAt: null,
    expected: null,
    broker: null,
    mismatches: null,
    mismatchCount: null,
  };
}
