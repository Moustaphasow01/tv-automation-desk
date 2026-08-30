import type { LiveTradingModel } from "./model";
import { recordValue } from "./mapper";

export type SignalDecisionSupport = {
  currentPrice: number | null;
  entryLow: number | null;
  entryHigh: number | null;
  distanceToEntryPoints: number | null;
  rewardRisk: number | null;
  averageWindowMinutes: number | null;
  setupHistory: {
    occurrences: number;
    wins: number;
    losses: number;
    unresolved: number;
    hitRatePct: number | null;
    averageResultR: number | null;
    scopeLabel: string;
  };
  confidenceFactors: readonly { label: string; value: number | null; status: string }[];
  conflict: { status: "CLEAR" | "CORRELATED" | "CONFLICT" | "NOT_PUBLISHED"; detail: string };
};

export function buildSignalDecisionSupport(model: LiveTradingModel): SignalDecisionSupport {
  const signal = model.latestSignal;
  const points = model.marketSeries.points;
  const currentPrice = finite(points.at(-1)?.close);
  const entry = entryRange(signal?.proposedTradePlan, signal?.tradePlanEconomics, signal?.setup);
  const distanceToEntryPoints = distanceToRange(currentPrice, entry.low, entry.high);
  const relatedSignals = signal
    ? uniqueSignals(model).filter((item) => item.strategyId === signal.strategyId)
    : [];
  const outcomes = relatedSignals.map((item) => model.theoreticalExecution?.rows.find((row) => row.strategySignalId === item.signalId) ?? null);
  const closed = outcomes.filter((item) => item && typeof item.resultR === "number" && Number.isFinite(item.resultR));
  const wins = closed.filter((item) => Number(item?.resultR) > 0).length;
  const losses = closed.filter((item) => Number(item?.resultR) < 0).length;
  const durations = relatedSignals
    .map((item) => elapsedMinutes(item.createdAt, item.expiresAt))
    .filter((value): value is number => value !== null);
  const confidenceFactors = confidenceRows(signal?.confidenceBreakdown ?? signal?.signalQuality);
  const arbitration = signal ? model.source.arbitrations.find((item) => item.signalId === signal.signalId) : null;
  const positionConflict = signal ? model.source.positions.find((position) => (
    position.symbol === signal.symbol && position.side !== "FLAT"
  )) : null;

  return {
    currentPrice,
    entryLow: entry.low,
    entryHigh: entry.high,
    distanceToEntryPoints,
    rewardRisk: finite(signal?.rewardRisk),
    averageWindowMinutes: average(durations),
    setupHistory: {
      occurrences: relatedSignals.length,
      wins,
      losses,
      unresolved: Math.max(0, relatedSignals.length - closed.length),
      hitRatePct: closed.length ? round((wins / closed.length) * 100) : null,
      averageResultR: closed.length ? round(closed.reduce((sum, item) => sum + Number(item?.resultR), 0) / closed.length) : null,
      scopeLabel: "Signaux de cette stratégie présents dans la projection Live",
    },
    confidenceFactors,
    conflict: positionConflict
      ? {
          status: positionConflict.side === signal?.direction ? "CORRELATED" : "CONFLICT",
          detail: positionConflict.side === signal?.direction
            ? `Une position ${positionConflict.side} ${positionConflict.symbol} est déjà publiée.`
            : `Le signal ${signal?.direction} contredit la position ${positionConflict.side} publiée.`,
        }
      : arbitration?.conflictStatus
        ? { status: arbitration.conflictStatus, detail: `État publié par l’arbitrage portefeuille : ${arbitration.conflictStatus}.` }
        : { status: "NOT_PUBLISHED", detail: "Aucune évaluation de conflit n’est publiée pour ce signal." },
  };
}

function uniqueSignals(model: LiveTradingModel) {
  const byId = new Map<string, LiveTradingModel["source"]["signals"][number]>();
  for (const signal of [...model.source.signals, ...model.source.canonicalRuntime.latestSignals]) {
    if (signal.signalId) byId.set(signal.signalId, signal);
  }
  return [...byId.values()];
}

function entryRange(...sources: unknown[]): { low: number | null; high: number | null } {
  for (const source of sources) {
    const record = asRecord(source);
    if (!record) continue;
    const entry = recordValue(record, ["entry", "entry_price", "entryPrice", "entry_zone", "entryZone"]);
    const parsed = numericRange(entry);
    if (parsed.low !== null || parsed.high !== null) return parsed;
  }
  return { low: null, high: null };
}

function numericRange(value: unknown): { low: number | null; high: number | null } {
  const direct = finite(value);
  if (direct !== null) return { low: direct, high: direct };
  if (Array.isArray(value)) {
    const values = value.map((item) => finite(item)).filter((item): item is number => item !== null);
    return values.length ? { low: Math.min(...values), high: Math.max(...values) } : { low: null, high: null };
  }
  const record = asRecord(value);
  if (!record) return { low: null, high: null };
  const price = finite(record.price ?? record.value ?? record.level ?? record.mid ?? record.center);
  if (price !== null) return { low: price, high: price };
  const low = finite(record.low ?? record.min ?? record.minPrice ?? record.min_price ?? record.lower ?? record.from);
  const high = finite(record.high ?? record.max ?? record.maxPrice ?? record.max_price ?? record.upper ?? record.to);
  return { low: low ?? high, high: high ?? low };
}

function distanceToRange(price: number | null, low: number | null, high: number | null): number | null {
  if (price === null || low === null || high === null) return null;
  if (price < low) return round(low - price);
  if (price > high) return round(price - high);
  return 0;
}

function confidenceRows(value: unknown): SignalDecisionSupport["confidenceFactors"] {
  if (Array.isArray(value)) return confidenceCandidates(value);
  const quality = asRecord(value);
  if (!quality) return [];
  const candidates = recordValue(quality, ["components", "factors", "breakdown", "scores"]);
  if (Array.isArray(candidates)) return confidenceCandidates(candidates);
  return Object.entries(quality)
    .filter(([, item]) => typeof item === "number")
    .map(([label, item]) => ({ label, value: finite(item), status: "PUBLISHED" }));
}

function confidenceCandidates(candidates: readonly unknown[]): SignalDecisionSupport["confidenceFactors"] {
  return candidates.flatMap((item, index) => {
    const row = asRecord(item);
    if (!row) return [];
    return [{
      label: String(row.label ?? row.name ?? row.code ?? `Facteur ${index + 1}`),
      value: finite(row.value ?? row.score ?? row.weight),
      status: String(row.status ?? row.state ?? "PUBLISHED"),
    }];
  });
}

function elapsedMinutes(start: string, end: string): number | null {
  const startAt = Date.parse(start);
  const endAt = Date.parse(end);
  return Number.isFinite(startAt) && Number.isFinite(endAt) && endAt >= startAt
    ? Math.round((endAt - startAt) / 60_000)
    : null;
}

function average(values: readonly number[]): number | null {
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
