import {
  DEFAULT_ORDER_SIMULATION_POLICY_V1,
  simulateEntryOrderV1,
  simulateExitOrderV1,
} from "@tv-automation/desk-replay-engine";

export const THEORETICAL_EXECUTION_ENGINE_VERSION = "theoretical_execution_engine_v1";

export const THEORETICAL_ORDER_POLICY = Object.freeze({
  ...DEFAULT_ORDER_SIMULATION_POLICY_V1,
  gap_policy: "FILL_AT_TRIGGER_PRICE",
  ambiguous_intrabar_policy: "REVIEW_REQUIRED",
  partial_fill_enabled: false,
});

export function evaluateTheoreticalEntryIntent({ intent = {}, decision = {}, contract = {}, candle = null, now = new Date().toISOString(), policy = THEORETICAL_ORDER_POLICY } = {}) {
  if (!intent?.order_intent_id) return noAction("ENTRY_INTENT_MISSING");
  const candleTime = timestamp(candle?.timestamp_utc || candle?.time || now);
  const expiresAt = timestamp(intent.expires_at);
  if (expiresAt && candleTime && expiresAt <= candleTime) {
    return {
      action: "expire_entry",
      status: "EXPIRED",
      reason: "ORDER_INTENT_EXPIRED",
      event_at_utc: expiresAt.toISOString(),
      order_intent_id: intent.order_intent_id,
      engine_version: THEORETICAL_EXECUTION_ENGINE_VERSION,
    };
  }
  if (!candle) return noAction("CANDLE_MISSING", { order_intent_id: intent.order_intent_id });
  const setup = entryIntentAsSimulatorSetup({ intent, decision, contract });
  const outcome = simulateEntryOrderV1({
    setup,
    row: candleAsSimulationRow(candle),
    policy,
  });
  if (outcome.status === "FILLED" || outcome.status === "PARTIALLY_FILLED") {
    return {
      action: "fill_entry",
      status: outcome.status,
      reason: outcome.reason,
      order_intent_id: intent.order_intent_id,
      trade_decision_id: intent.trade_decision_id || decision.trade_decision_id || null,
      instrument_code: contract.instrument_code || decision.instrument_code || null,
      side: intent.side === "sell" ? "short" : "long",
      order_side: intent.side || null,
      order_type: intent.order_type || null,
      quantity: Number(outcome.fill.quantity || intent.quantity || 0),
      requested_quantity: Number(outcome.fill.requested_quantity || intent.quantity || 0),
      price: Number(outcome.fill.price),
      raw_price: Number(outcome.fill.raw_price),
      event_at_utc: candleTime?.toISOString() || now,
      candle: projectCandle(candle),
      simulator_outcome: outcome,
      engine_version: THEORETICAL_EXECUTION_ENGINE_VERSION,
    };
  }
  return noAction(outcome.reason || "ENTRY_NOT_FILLED", {
    order_intent_id: intent.order_intent_id,
    status: "WORKING",
    candle: projectCandle(candle),
    simulator_outcome: outcome,
  });
}

export function evaluateTheoreticalTradeExit({ trade = {}, candle = null, policy = THEORETICAL_ORDER_POLICY } = {}) {
  if (!trade?.trade_id) return noAction("TRADE_MISSING");
  if (!candle) return noAction("CANDLE_MISSING", { trade_id: trade.trade_id });
  const position = tradeAsSimulatorPosition(trade);
  const outcome = simulateExitOrderV1({
    position,
    row: candleAsSimulationRow(candle),
    policy,
  });
  if (outcome.review_required === true) {
    return {
      action: "review_exit",
      status: "REVIEW_REQUIRED",
      reason: outcome.reason || "EXIT_REVIEW_REQUIRED",
      trade_id: trade.trade_id,
      event_at_utc: timestamp(candle.timestamp_utc || candle.time)?.toISOString() || null,
      candle: projectCandle(candle),
      simulator_outcome: outcome,
      engine_version: THEORETICAL_EXECUTION_ENGINE_VERSION,
    };
  }
  if (outcome.status === "FILLED" || outcome.status === "PARTIALLY_FILLED") {
    return {
      action: "fill_exit",
      status: outcome.status,
      reason: outcome.reason,
      trade_id: trade.trade_id,
      exit_reason: outcome.reason === "TAKE_PROFIT_1" ? "target" : "stop",
      order_side: outcome.order?.side === "BUY" ? "buy" : "sell",
      quantity: Number(outcome.fill.quantity || trade.quantity_open || 0),
      requested_quantity: Number(outcome.fill.requested_quantity || trade.quantity_open || 0),
      price: Number(outcome.fill.price),
      raw_price: Number(outcome.fill.raw_price),
      event_at_utc: timestamp(candle.timestamp_utc || candle.time)?.toISOString() || null,
      candle: projectCandle(candle),
      simulator_outcome: outcome,
      engine_version: THEORETICAL_EXECUTION_ENGINE_VERSION,
    };
  }
  return noAction(outcome.reason || "NO_EXIT_TOUCHED", {
    trade_id: trade.trade_id,
    status: "OPEN",
    candle: projectCandle(candle),
    simulator_outcome: outcome,
  });
}

function entryIntentAsSimulatorSetup({ intent, decision, contract }) {
  const orderType = brokerOrderTypeToSimulator(intent.order_type);
  const direction = intent.side === "sell" ? "short" : "long";
  const entryPrice = firstFinite([
    intent.limit_price,
    intent.stop_price,
    decision?.entry_plan?.entry_price,
    intent.payload?.entry_price,
  ]);
  return {
    setup_id: intent.order_intent_id,
    instrument: contract.instrument_code || decision.instrument_code || intent.payload?.instrument || null,
    direction,
    quantity: positiveNumber(intent.quantity, 1),
    order_type: orderType,
    entry_price: entryPrice,
    order_limit_price: firstFinite([intent.limit_price, intent.payload?.limit_price]),
    order_stop_price: firstFinite([intent.stop_price, intent.payload?.stop_price]),
    stop_limit_price: firstFinite([intent.limit_price, intent.payload?.limit_price]),
    stop_trigger_price: firstFinite([intent.stop_price, intent.payload?.stop_price]),
  };
}

function tradeAsSimulatorPosition(trade) {
  return {
    position_id: trade.trade_id,
    setup_id: trade.raw?.setup_id || trade.raw?.source_position_id || trade.order_intent_id || null,
    instrument: trade.instrument_code || trade.raw?.instrument || null,
    direction: trade.side === "short" ? "short" : "long",
    quantity: positiveNumber(trade.quantity_open, 1),
    stop_loss: firstFinite([trade.current_stop_price, trade.initial_stop_price, trade.raw?.current_stop_price, trade.raw?.protective_stop_price]),
    take_profit_1: firstFinite([trade.current_target_price, trade.raw?.current_target_price, trade.raw?.profit_target]),
  };
}

function brokerOrderTypeToSimulator(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "market") return "MARKET";
  if (normalized === "limit") return "LIMIT";
  if (normalized === "stop_market") return "STOP";
  if (normalized === "stop_limit") return "STOP_LIMIT";
  return "LIMIT";
}

function candleAsSimulationRow(candle = {}) {
  return {
    time: candle.timestamp_utc || candle.time || candle.timestamp || null,
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
  };
}

function projectCandle(candle = {}) {
  return {
    feed_id: candle.feed_id || null,
    symbol_code: candle.symbol_code || null,
    timeframe: candle.timeframe || null,
    timestamp_utc: timestamp(candle.timestamp_utc || candle.time || candle.timestamp)?.toISOString() || null,
    open: finite(candle.open),
    high: finite(candle.high),
    low: finite(candle.low),
    close: finite(candle.close),
  };
}

function noAction(reason, extra = {}) {
  return {
    action: "none",
    status: extra.status || "NO_ACTION",
    reason,
    engine_version: THEORETICAL_EXECUTION_ENGINE_VERSION,
    ...extra,
  };
}

function timestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstFinite(values) {
  for (const value of values) {
    const parsed = finite(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
