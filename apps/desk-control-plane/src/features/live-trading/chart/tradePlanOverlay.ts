import { recordValue } from "../mapper";
import type { LiveTradingModel } from "../model";

export type TradeOverlayTarget = {
  label: string;
  price: number;
  ratioR?: number | null;
};

export type TradeOverlay = {
  source: "ORDER_INTENT" | "THEORETICAL_EXECUTION" | "SIGNAL";
  label: string;
  instrument: string | null;
  side: "LONG" | "SHORT";
  entry: number;
  stop: number | null;
  targets: readonly TradeOverlayTarget[];
  createdAt?: string | null;
  expiresAt?: string | null;
  status?: string | null;
};

export type VisibleTradeOverlay = {
  overlay: TradeOverlay | null;
  hiddenLevelCount: number;
};

export function visibleTradeOverlay(
  overlay: TradeOverlay | null | undefined,
  candleMin: number,
  candleMax: number,
  maximumSpanDistance = 2,
): VisibleTradeOverlay {
  if (!overlay) return { overlay: null, hiddenLevelCount: 0 };
  const span = Math.max(candleMax - candleMin, 0.0001);
  const lower = candleMin - span * maximumSpanDistance;
  const upper = candleMax + span * maximumSpanDistance;
  const inEnvelope = (price: number | null) => price === null || (price >= lower && price <= upper);
  if (!inEnvelope(overlay.entry)) {
    return { overlay: null, hiddenLevelCount: 1 + Number(overlay.stop !== null) + overlay.targets.length };
  }
  const visibleStop = inEnvelope(overlay.stop) ? overlay.stop : null;
  const visibleTargets = overlay.targets.filter((target) => inEnvelope(target.price));
  return {
    overlay: { ...overlay, stop: visibleStop, targets: visibleTargets },
    hiddenLevelCount: Number(overlay.stop !== null && visibleStop === null) + overlay.targets.length - visibleTargets.length,
  };
}

export function tradePlanOverlayFromIntent(intent: LiveTradingModel["orderIntent"]): TradeOverlay | null {
  if (!intent) return null;
  const terms = intent.executionTerms;
  const side = normalizeTradeSide(intent.side);
  const entry = finitePrice(priceValue(recordValue(terms, ["entry"]))
    ?? recordValue(terms, ["entry_price", "entryPrice"])
    ?? intent.limitPrice);
  if (entry === null || side === null) return null;
  const stop = finitePrice(priceValue(recordValue(terms, ["stop"]))
    ?? recordValue(terms, ["stop_price", "stopPrice"])
    ?? intent.stopPrice);
  const targets = tradeTargetsFrom(recordValue(terms, ["targets"]));
  const directTarget = finitePrice(intent.targetPrice);
  return {
    source: "ORDER_INTENT",
    label: "OrderIntent post-risk",
    instrument: instrumentCode(intent),
    side,
    entry,
    stop,
    targets: targets.length || directTarget === null ? targets : [{ label: "T1", price: directTarget }],
    createdAt: intent.createdAt ?? null,
    expiresAt: intent.allowedActions.expiresAt,
    status: intent.humanGate.status,
  };
}

export function tradePlanOverlayFromTheoretical(row: LiveTradingModel["selectedTheoreticalExecution"]): TradeOverlay | null {
  if (!row) return null;
  const side = normalizeTradeSide(row.side);
  const entry = finitePrice(row.entry);
  if (entry === null || side === null) return null;
  return {
    source: "THEORETICAL_EXECUTION",
    label: "Suivi théorique backend",
    instrument: normalizeInstrument(row.instrument),
    side,
    entry,
    stop: finitePrice(row.stop),
    targets: tradeTargetsFrom(row.targets),
    createdAt: row.sourceCandleAt || row.latestEventAt,
    expiresAt: null,
    status: row.status,
  };
}

export function tradePlanOverlayFromSignal(signal: LiveTradingModel["latestSignal"]): TradeOverlay | null {
  if (!signal) return null;
  const plan = signal.proposedTradePlan ?? {};
  const setup = signal.setup ?? {};
  const economics = signal.tradePlanEconomics ?? {};
  const side = normalizeTradeSide(signal.direction);
  const entry = finitePrice(priceValue(recordValue(plan, ["entry"]))
    ?? recordValue(economics, ["entry_price", "entryPrice"])
    ?? recordValue(setup, ["entry_price", "entryPrice", "entry"]));
  if (entry === null || side === null) return null;
  const stop = finitePrice(priceValue(recordValue(plan, ["stop"]))
    ?? recordValue(economics, ["stop_price", "stopPrice"])
    ?? recordValue(setup, ["stop_price", "stopPrice", "stop", "stop_loss", "stopLoss"]));
  const targets = tradeTargetsFrom(recordValue(plan, ["targets"]))
    .concat(tradeTargetsFrom(recordValue(setup, ["targets", "take_profit_targets", "takeProfitTargets", "target_prices", "targetPrices"])))
    .concat(tradeTargetsFrom(recordValue(economics, ["targets"])));
  return {
    source: "SIGNAL",
    label: "Dernier signal détecté",
    instrument: normalizeInstrument(signal.symbol),
    side,
    entry,
    stop,
    targets: uniqueTargets(targets),
    createdAt: signal.sourceDataCutoffAt ?? signal.createdAt,
    expiresAt: signal.expiresAt,
    status: signal.availability ?? signal.state,
  };
}

export function instrumentCode(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const terms = record.executionTerms && typeof record.executionTerms === "object"
    ? record.executionTerms as Record<string, unknown>
    : null;
  return normalizeInstrument(record.symbol ?? record.instrument ?? recordValue(terms, ["instrument", "instrument_code", "symbol"]));
}

function normalizeTradeSide(value: unknown): "LONG" | "SHORT" | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (["SELL", "SHORT"].includes(normalized)) return "SHORT";
  if (["BUY", "LONG"].includes(normalized)) return "LONG";
  return null;
}

function tradeTargetsFrom(value: unknown): TradeOverlayTarget[] {
  const items = Array.isArray(value) ? value : value == null ? [] : [value];
  return items.map((item, index): TradeOverlayTarget | null => {
    const record: Record<string, unknown> = item && typeof item === "object" ? item as Record<string, unknown> : { price: item };
    const price = finitePrice(priceValue(record) ?? record.target_price ?? record.targetPrice ?? record.value);
    if (price === null) return null;
    const ratioValue = record.ratioR ?? record.reward_risk ?? record.rewardRisk ?? record.expected_r ?? record.expectedR;
    return {
      label: String(record.label ?? record.name ?? `T${index + 1}`),
      price,
      ratioR: Number.isFinite(Number(ratioValue)) ? Number(ratioValue) : null,
    };
  }).filter((item): item is TradeOverlayTarget => Boolean(item));
}

function uniqueTargets(targets: readonly TradeOverlayTarget[]): TradeOverlayTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.label}:${target.price}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeInstrument(value: unknown): string | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!normalized) return null;
  return ({ "MNQ1!": "MNQ", "MES1!": "MES", "NQ1!": "NQ", "ES1!": "ES", "ZC1!": "ZC", "ZW1!": "ZW" } as Record<string, string>)[normalized] ?? normalized;
}

function priceValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return record.price ?? record.value ?? record.mid ?? record.center ?? record.level;
}

function finitePrice(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
