import type { LiveTimeSeriesContract } from "@/domains/front-api/viewModels";
import type { HumanGateAction } from "@/features/order-intent/model";
import type { LiveTone, LiveTradingEnvelope, LiveTradingModel } from "./model";

export function toLiveTradingModel(envelope: LiveTradingEnvelope): LiveTradingModel {
  const { data, meta } = envelope;
  const runtime = data.canonicalRuntime;
  const latestSignal = runtime.latestSignals[0] ?? data.signals[0] ?? null;
  const orderIntent = runtime.pendingOrderIntents[0] ?? data.portfolioOrderIntents[0] ?? null;
  const marketContract = seriesContracts(data).find((item) => item.seriesId === "market.ohlcv");
  const performanceContract = seriesContracts(data).find((item) => item.seriesId === "performance.r_equity");
  const resourceActions = new Set(orderIntent?.allowedActions.allowedActions ?? []);
  const gateActions = orderIntent?.humanGate.allowedActions.filter((action) => resourceActions.has(action.action)) ?? [];
  const degraded = meta.stale || meta.availability !== "AVAILABLE";

  return {
    meta,
    source: data,
    truth: {
      label: degraded ? meta.stale ? "STALE" : meta.availability ?? "PARTIAL" : "LIVE",
      tone: degraded ? "warning" : "success",
      detail: meta.warnings?.join(" · ") || "Projection BFF autoritaire disponible",
    },
    mode: runtime.mode,
    freshness: runtime.freshness,
    marketSeries: {
      availability: marketContract?.availability ?? "UNAVAILABLE",
      source: marketContract?.source ?? "market.ohlcv",
      reason: marketContract?.reason || "Le BFF ne publie pas de série OHLCV paginée.",
      asOf: data.timeSeriesContracts.asOf || meta.asOf,
    },
    strategyInstances: runtime.activeStrategyInstances,
    latestSignal,
    latestContextDecision: runtime.aiContextGate[0] ?? null,
    orderIntent,
    gateActions: degraded ? [] : gateActions as readonly HumanGateAction[],
    gateBlockedReason: degraded
      ? `Projection ${meta.stale ? "stale" : meta.availability ?? "partielle"} : les actions sensibles restent fermées.`
      : orderIntent?.allowedActions.denialReasons.length
        ? orderIntent.allowedActions.denialReasons.join(" · ")
        : orderIntent?.humanGate.allowedActions.length
          ? "Le backend ne publie pas simultanément la capability ressource et l'action Human Gate."
          : "Aucun OrderIntent en attente de confirmation.",
    provider: data.providers[0] ?? null,
    reconciliation: {
      status: "UNAVAILABLE",
      detail: "La vue Live ne publie pas encore l'état expected vs broker. Aucune synchronisation n'est supposée.",
      asOf: meta.asOf,
    },
    performance: {
      availability: performanceContract?.availability ?? "UNAVAILABLE",
      totalR: null,
      drawdownR: performanceContract?.availability === "KNOWN" || performanceContract?.availability === "PARTIAL" ? data.summary.liveDrawdownR : null,
      reason: performanceContract?.reason || "Aucune série de performance live officielle n'est disponible.",
    },
  };
}

export function liveTone(value: string): LiveTone {
  const status = value.trim().toUpperCase();
  if (["OK", "READY", "KNOWN", "LIVE", "FRESH", "PASS", "FILLED", "CLOSED", "ACTIVE"].includes(status)) return "success";
  if (["REJECTED", "FAILED", "BLOCKED", "DOWN", "BREACH", "OPEN", "DISCONNECTED"].includes(status)) return "danger";
  if (["WATCH", "WAITING", "WAITING_OPERATOR", "PARTIAL", "STALE", "DEGRADED", "UNAVAILABLE", "UNKNOWN", "HALF_OPEN"].some((item) => status.includes(item))) return "warning";
  return "info";
}

export function displayValue(value: unknown, fallback = "—"): string {
  if (value === null || value === undefined || value === "" || String(value).toLowerCase() === "unavailable") return fallback;
  if (typeof value === "number") return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 4 }).format(value);
  return String(value);
}

export function displayTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}

export function recordValue(record: Record<string, unknown> | null | undefined, keys: readonly string[]): unknown {
  if (!record) return undefined;
  for (const key of keys) if (record[key] !== undefined && record[key] !== null && record[key] !== "") return record[key];
  return undefined;
}

function seriesContracts(data: LiveTradingModel["source"]): readonly LiveTimeSeriesContract[] {
  return data.timeSeriesContracts.series ?? data.timeSeriesContracts.contracts ?? [];
}
