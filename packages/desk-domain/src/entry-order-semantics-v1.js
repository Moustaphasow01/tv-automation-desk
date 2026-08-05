export const CONTRACT_ORDER_TYPES_V1 = Object.freeze(["MARKET", "LIMIT", "STOP", "STOP_LIMIT"]);
export const ENTRY_MODES_V1 = Object.freeze([
  "NEXT_BAR_MARKET_AFTER_CONFIRMATION",
  "RETEST_ZONE_AFTER_CONFIRMATION",
  "STOP_CROSS",
  "LIMIT_TOUCH",
]);

const ORDER_TYPES_BY_ENTRY_MODE_V1 = Object.freeze({
  NEXT_BAR_MARKET_AFTER_CONFIRMATION: Object.freeze(["MARKET"]),
  RETEST_ZONE_AFTER_CONFIRMATION: Object.freeze(["MARKET", "LIMIT"]),
  STOP_CROSS: Object.freeze(["STOP", "STOP_LIMIT"]),
  LIMIT_TOUCH: Object.freeze(["LIMIT"]),
});

const BROKER_ORDER_TYPE_BY_CONTRACT_V1 = Object.freeze({
  MARKET: "market",
  LIMIT: "limit",
  STOP: "stop_market",
  STOP_LIMIT: "stop_limit",
});

export function normalizeContractOrderTypeV1(value) {
  const normalized = normalizedEnum(value);
  const aliases = {
    MARKET_ORDER: "MARKET",
    LIMIT_ORDER: "LIMIT",
    STOP_MARKET: "STOP",
    STOPMARKET: "STOP",
    STOP_ORDER: "STOP",
    STOPLIMIT: "STOP_LIMIT",
  };
  const candidate = aliases[normalized] || normalized;
  return CONTRACT_ORDER_TYPES_V1.includes(candidate) ? candidate : null;
}

export function normalizeEntryModeV1(value) {
  const normalized = normalizedEnum(value);
  return ENTRY_MODES_V1.includes(normalized) ? normalized : null;
}

export function validateEntryOrderSemanticsV1({
  entryMode,
  orderType,
  limitPrice = null,
  stopPrice = null,
  requireExecutablePrices = false,
} = {}) {
  const normalizedEntryMode = normalizeEntryModeV1(entryMode);
  const normalizedOrderType = normalizeContractOrderTypeV1(orderType);
  const normalizedLimitPrice = finite(limitPrice);
  const normalizedStopPrice = finite(stopPrice);
  const errors = [];

  if (!normalizedEntryMode) errors.push({ code: "ENTRY_MODE_REQUIRED", value: entryMode ?? null });
  if (!normalizedOrderType) errors.push({ code: "ORDER_TYPE_REQUIRED", value: orderType ?? null });

  const compatibleOrderTypes = normalizedEntryMode
    ? ORDER_TYPES_BY_ENTRY_MODE_V1[normalizedEntryMode]
    : [];
  if (normalizedEntryMode && normalizedOrderType && !compatibleOrderTypes.includes(normalizedOrderType)) {
    errors.push({
      code: "ENTRY_MODE_ORDER_TYPE_INCOMPATIBLE",
      entry_mode: normalizedEntryMode,
      order_type: normalizedOrderType,
      allowed_order_types: compatibleOrderTypes,
    });
  }

  if (normalizedOrderType === "STOP_LIMIT"
    && (normalizedStopPrice === null || normalizedLimitPrice === null)) {
    errors.push({
      code: "STOP_LIMIT_PARAMETERS_INCOMPLETE",
      stop_price: normalizedStopPrice,
      limit_price: normalizedLimitPrice,
    });
  }
  if (requireExecutablePrices && normalizedOrderType === "LIMIT" && normalizedLimitPrice === null) {
    errors.push({ code: "ORDER_LIMIT_PRICE_REQUIRED", limit_price: normalizedLimitPrice });
  }
  if (requireExecutablePrices && normalizedOrderType === "STOP" && normalizedStopPrice === null) {
    errors.push({ code: "ORDER_STOP_PRICE_REQUIRED", stop_price: normalizedStopPrice });
  }

  return Object.freeze({
    valid: errors.length === 0,
    entry_mode: normalizedEntryMode,
    order_type: normalizedOrderType,
    broker_order_type: normalizedOrderType ? BROKER_ORDER_TYPE_BY_CONTRACT_V1[normalizedOrderType] : null,
    limit_price: normalizedLimitPrice,
    stop_price: normalizedStopPrice,
    compatible_order_types: Object.freeze([...compatibleOrderTypes]),
    errors: Object.freeze(errors.map((error) => Object.freeze(error))),
  });
}

function normalizedEnum(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
