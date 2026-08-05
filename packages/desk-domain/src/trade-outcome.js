import { createHash } from "node:crypto";

export const TRADE_OUTCOME_SCHEMA_VERSION = "trade_outcome_v1";
export const TRADE_OUTCOME_ENGINE_VERSION = "1.0.0";

export function calculateTradeOutcome(input = {}) {
  const side = normalizeSide(input.side || input.direction);
  const entryPrice = positiveNumber(input.entryPrice ?? input.avgEntryPrice, "entry_price");
  const initialQuantity = positiveNumber(input.initialQuantity ?? input.quantity, "initial_quantity");
  const pointValue = positiveNumber(input.pointValue ?? 1, "point_value");
  const initialStopPrice = finiteNumber(input.initialStopPrice ?? input.stopPrice, "initial_stop_price");
  const exits = normalizeExitFills(input.exitFills || [], input.exitPrice, initialQuantity);
  const exitQuantity = exits.reduce((total, fill) => total + fill.quantity, 0);
  if (exitQuantity > initialQuantity + 1e-9) throw outcomeError("EXIT_QUANTITY_EXCEEDS_ENTRY", "Exit quantity exceeds the initial position.");

  const sign = side === "long" ? 1 : -1;
  const grossRealizedPnl = exits.reduce(
    (total, fill) => total + sign * (fill.price - entryPrice) * fill.quantity * pointValue,
    0,
  );
  const explicitCommission = [
    ...(Array.isArray(input.entryFills) ? input.entryFills : []),
    ...exits,
  ].reduce((total, fill) => total + nonNegativeNumber(fill.commission, 0), 0);
  const derivedCommission = nonNegativeNumber(input.commissionPerContractSide, 0)
    * (initialQuantity + exitQuantity);
  const totalFees = input.totalFees === undefined || input.totalFees === null
    ? explicitCommission + derivedCommission
    : nonNegativeNumber(input.totalFees, 0);
  const netRealizedPnl = grossRealizedPnl - totalFees;
  const initialRiskAmount = positiveNumber(
    input.initialRiskAmount
      ?? Math.abs(entryPrice - initialStopPrice) * initialQuantity * pointValue,
    "initial_risk_amount",
  );
  const resultR = netRealizedPnl / initialRiskAmount;
  const excursions = calculateExcursions({
    side,
    entryPrice,
    initialQuantity,
    pointValue,
    initialRiskAmount,
    prices: input.priceExcursions || input.candles || [],
  });
  const finalized = input.finalized === true || Math.abs(exitQuantity - initialQuantity) <= 1e-9;
  const calculatedAt = validIso(input.calculatedAt || new Date().toISOString());
  const evidence = {
    side,
    entry_price: entryPrice,
    initial_stop_price: initialStopPrice,
    initial_quantity: initialQuantity,
    exit_quantity: exitQuantity,
    point_value: pointValue,
    exit_fills: exits,
    total_fees: round(totalFees),
  };
  const evidenceHash = createHash("sha256").update(stableJson(evidence)).digest("hex");

  return Object.freeze({
    schema_version: TRADE_OUTCOME_SCHEMA_VERSION,
    engine_version: TRADE_OUTCOME_ENGINE_VERSION,
    status: finalized ? "final" : "partial",
    finalized,
    gross_realized_pnl: round(grossRealizedPnl),
    total_fees: round(totalFees),
    net_realized_pnl: round(netRealizedPnl),
    initial_risk_amount: round(initialRiskAmount),
    result_r: round(resultR),
    mfe_r: excursions.mfe_r,
    mae_r: excursions.mae_r,
    calculated_at_utc: calculatedAt,
    evidence_hash: evidenceHash,
    evidence,
  });
}

function calculateExcursions({ side, entryPrice, initialQuantity, pointValue, initialRiskAmount, prices }) {
  let favorablePnl = 0;
  let adversePnl = 0;
  for (const item of prices || []) {
    const high = nullableNumber(item.high ?? item.max_price ?? item.maxPrice);
    const low = nullableNumber(item.low ?? item.min_price ?? item.minPrice);
    if (high === null || low === null) continue;
    const favorablePrice = side === "long" ? high : low;
    const adversePrice = side === "long" ? low : high;
    const favorable = (side === "long" ? favorablePrice - entryPrice : entryPrice - favorablePrice)
      * initialQuantity * pointValue;
    const adverse = (side === "long" ? adversePrice - entryPrice : entryPrice - adversePrice)
      * initialQuantity * pointValue;
    favorablePnl = Math.max(favorablePnl, favorable);
    adversePnl = Math.min(adversePnl, adverse);
  }
  return {
    mfe_r: round(favorablePnl / initialRiskAmount),
    mae_r: round(adversePnl / initialRiskAmount),
  };
}

function normalizeExitFills(value, fallbackPrice, fallbackQuantity) {
  const items = Array.isArray(value) && value.length
    ? value
    : fallbackPrice === undefined || fallbackPrice === null
      ? []
      : [{ price: fallbackPrice, quantity: fallbackQuantity }];
  return items.map((fill) => ({
    price: positiveNumber(fill.price, "exit_price"),
    quantity: positiveNumber(fill.quantity, "exit_quantity"),
    commission: nonNegativeNumber(fill.commission, 0),
    filled_at: fill.filled_at ? validIso(fill.filled_at) : null,
    fill_ref: fill.fill_ref || fill.broker_fill_ref || null,
  }));
}

function normalizeSide(value) {
  const side = String(value || "").trim().toLowerCase();
  if (["long", "buy", "bull", "bullish"].includes(side)) return "long";
  if (["short", "sell", "bear", "bearish"].includes(side)) return "short";
  throw outcomeError("TRADE_SIDE_INVALID", `Unsupported trade side: ${value || "missing"}.`);
}

function positiveNumber(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw outcomeError("TRADE_OUTCOME_INPUT_INVALID", `${field} must be positive.`);
  return parsed;
}

function finiteNumber(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw outcomeError("TRADE_OUTCOME_INPUT_INVALID", `${field} must be finite.`);
  return parsed;
}

function nullableNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegativeNumber(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw outcomeError("TRADE_OUTCOME_INPUT_INVALID", "Fees and commissions cannot be negative.");
  return parsed;
}

function validIso(value) {
  const parsed = Date.parse(value || "");
  if (!Number.isFinite(parsed)) throw outcomeError("TRADE_OUTCOME_INPUT_INVALID", "calculated_at must be a valid timestamp.");
  return new Date(parsed).toISOString();
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100_000_000) / 100_000_000;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function outcomeError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}
