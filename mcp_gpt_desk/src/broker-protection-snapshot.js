import { firstNumber, isConnectedAddonSnapshot, validTimestamp } from "./broker-execution-normalizers.js";

export function evaluateBrokerProtectionSnapshot({ trade = {}, brokerSnapshot = {}, snapshotId = null, capturedAt = null, now, graceSeconds = 30 } = {}) {
  const checkedAt = validTimestamp(now) || new Date().toISOString();
  const openedAt = validTimestamp(trade.opened_at || trade.opened_at_utc || trade.raw?.opened_at || trade.raw?.filled_at);
  const ageSeconds = openedAt ? Math.max(0, (Date.parse(checkedAt) - Date.parse(openedAt)) / 1_000) : Number.POSITIVE_INFINITY;
  const stopRef = String(trade.raw?.protective_stop_order_ref || trade.protective_stop_order_ref || "").trim();
  const targetRef = String(trade.raw?.profit_target_order_ref || trade.profit_target_order_ref || "").trim();
  const baseEvidence = {
    schema_version: "broker_protection_confirmation_v1",
    snapshot_id: snapshotId,
    captured_at: validTimestamp(capturedAt),
    checked_at: checkedAt,
    trade_id: trade.trade_id || null,
    broker_account_id: trade.broker_account_id || null,
    broker_symbol: trade.broker_symbol || null,
    quantity_open: Number(trade.quantity_open || 0),
    protective_stop_order_ref: stopRef || null,
    profit_target_order_ref: targetRef || null,
    grace_seconds: graceSeconds,
    age_seconds: Number.isFinite(ageSeconds) ? Math.round(ageSeconds) : null,
  };
  if (!isConnectedAddonSnapshot(brokerSnapshot)) return protectionResult("pending", "SNAPSHOT_NOT_CONNECTED", baseEvidence);
  if (!Array.isArray(brokerSnapshot.orders)) return protectionResult("pending", "SNAPSHOT_ORDERS_MISSING", baseEvidence);
  if (!stopRef) return protectionResult(ageSeconds <= graceSeconds ? "pending" : "failed", "PROTECTIVE_STOP_REF_MISSING", baseEvidence);
  const stopOrder = findSnapshotOrder(brokerSnapshot.orders, stopRef);
  if (!stopOrder) return protectionResult(ageSeconds <= graceSeconds ? "pending" : "failed", "PROTECTIVE_STOP_ORDER_MISSING", baseEvidence);
  const stopStatus = normalizeBrokerOrderStatus(stopOrder.status || stopOrder.order_state || stopOrder.state);
  const enrichedEvidence = { ...baseEvidence, stop_order: protectionOrderEvidence(stopOrder, stopStatus) };
  if (["rejected", "cancelled", "expired", "error"].includes(stopStatus)) return protectionResult("failed", `PROTECTIVE_STOP_${stopStatus.toUpperCase()}`, enrichedEvidence);
  if (stopStatus === "filled") return protectionResult("failed", "PROTECTIVE_STOP_FILLED_WHILE_TRADE_OPEN", enrichedEvidence);
  if (!["submitted", "accepted", "working"].includes(stopStatus)) return protectionResult(ageSeconds <= graceSeconds ? "pending" : "failed", "PROTECTIVE_STOP_NOT_ACTIVE", enrichedEvidence);
  const expectedSide = String(trade.side || "").toLowerCase() === "short" ? "BUY" : "SELL";
  const stopSide = String(stopOrder.side || stopOrder.action || "").trim().toUpperCase();
  if (stopSide && stopSide !== expectedSide) return protectionResult("failed", "PROTECTIVE_STOP_SIDE_MISMATCH", { ...enrichedEvidence, expected_stop_side: expectedSide, actual_stop_side: stopSide });
  const expectedQuantity = Math.max(0, Number(trade.quantity_open || 0));
  const stopQuantity = firstNumber(stopOrder.quantity, stopOrder.remaining_quantity, stopOrder.order_quantity, stopOrder.qty);
  if (stopQuantity !== null && stopQuantity < expectedQuantity) return protectionResult("failed", "PROTECTIVE_STOP_QUANTITY_TOO_SMALL", { ...enrichedEvidence, expected_quantity: expectedQuantity, actual_quantity: stopQuantity });
  const expectedStop = firstNumber(trade.current_stop_price, trade.initial_stop_price, trade.raw?.current_stop_price, trade.raw?.protective_stop_price);
  const actualStop = firstNumber(stopOrder.stop_price, stopOrder.stopPrice, stopOrder.price);
  const tick = Math.max(0, firstNumber(trade.tick_size) || 0);
  if (expectedStop !== null && actualStop !== null && Math.abs(expectedStop - actualStop) > Math.max(tick, 1e-9)) {
    return protectionResult("failed", "PROTECTIVE_STOP_PRICE_MISMATCH", { ...enrichedEvidence, expected_stop_price: expectedStop, actual_stop_price: actualStop, tick_size: tick || null });
  }
  const targetOrder = targetRef ? findSnapshotOrder(brokerSnapshot.orders, targetRef) : null;
  const targetStatus = targetOrder ? normalizeBrokerOrderStatus(targetOrder.status || targetOrder.order_state || targetOrder.state) : "missing";
  return protectionResult("confirmed", "PROTECTIVE_STOP_ACTIVE", {
    ...enrichedEvidence,
    expected_stop_side: expectedSide,
    target_order: targetOrder ? protectionOrderEvidence(targetOrder, targetStatus) : null,
    target_status: targetStatus,
  });
}

function protectionResult(status, reason, evidence) {
  return Object.freeze({ status, reason, evidence: Object.freeze(evidence || {}) });
}

function findSnapshotOrder(orders = [], ref) {
  const expected = String(ref || "").trim();
  if (!expected) return null;
  return (orders || []).find((order) => String(order?.broker_order_ref || order?.order_id || order?.id || "").trim() === expected) || null;
}

function normalizeBrokerOrderStatus(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
  if (["pending_submit", "initialized", "submitted"].includes(normalized)) return "submitted";
  if (["accepted"].includes(normalized)) return "accepted";
  if (["working", "trigger_pending", "triggerpending"].includes(normalized)) return "working";
  if (["filled"].includes(normalized)) return "filled";
  if (["cancelled", "canceled"].includes(normalized)) return "cancelled";
  if (["rejected", "expired", "error"].includes(normalized)) return normalized;
  return normalized || "unknown";
}

function protectionOrderEvidence(order = {}, status) {
  return {
    broker_order_ref: String(order.broker_order_ref || order.order_id || order.id || "") || null,
    status,
    side: String(order.side || order.action || "").trim().toUpperCase() || null,
    quantity: firstNumber(order.quantity, order.remaining_quantity, order.order_quantity, order.qty),
    stop_price: firstNumber(order.stop_price, order.stopPrice, order.price),
    limit_price: firstNumber(order.limit_price, order.limitPrice),
  };
}
