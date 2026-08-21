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
  const reconciliationNotApplicable = ["NOT_APPLICABLE_CURRENT_MODE", "DISABLED_BY_POLICY"]
    .includes(String(data.reconciliation?.availability ?? "").toUpperCase());

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
      availability: data.marketSeries?.availability ?? marketContract?.availability ?? "UNAVAILABLE",
      source: data.marketSeries?.source ?? marketContract?.source ?? "market.ohlcv",
      reason: data.marketSeries?.reason || marketContract?.reason || (data.marketSeries?.points.length ? "" : "Aucune bougie clôturée publiée pour la fenêtre."),
      asOf: data.marketSeries?.asOf ?? data.timeSeriesContracts.asOf ?? meta.asOf,
      instrument: data.marketSeries?.instrument ?? null,
      timeframe: data.marketSeries?.timeframe ?? null,
      supportedInstruments: data.marketSeries?.supportedInstruments ?? [],
      supportedTimeframes: data.marketSeries?.supportedTimeframes ?? [],
      points: data.marketSeries?.points ?? [],
    },
    watchlist: data.watchlist ?? [],
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
      status: reconciliationNotApplicable ? "EXÉCUTION PHYSIQUE DÉSACTIVÉE" : data.reconciliation?.status ?? "UNAVAILABLE",
      detail: reconciliationNotApplicable
        ? "Aucun snapshot broker n'est attendu dans le mode d'exécution courant."
        : data.reconciliation?.reason || `${data.reconciliation?.mismatchCount ?? "—"} divergence(s) autoritaire(s).`,
      asOf: data.reconciliation?.asOf ?? meta.asOf,
      expected: data.reconciliation?.expected ?? null,
      broker: reconciliationNotApplicable ? null : data.reconciliation?.broker ?? null,
      mismatchCount: data.reconciliation?.mismatchCount ?? null,
    },
    performance: {
      availability: data.performanceR?.availability ?? performanceContract?.availability ?? "UNAVAILABLE",
      totalR: data.performanceR?.totalR ?? null,
      drawdownR: data.performanceR?.drawdownR ?? null,
      reason: performanceContract?.reason || "Aucune série de performance live officielle n'est disponible.",
      sourceType: data.performanceR?.sourceType ?? "NONE",
      sampleSize: data.performanceR?.sampleSize ?? null,
      hitRatePct: data.performanceR?.hitRatePct ?? null,
      series: data.performanceR?.series ?? [],
    },
  };
}

export function liveTone(value: string): LiveTone {
  const status = value.trim().toUpperCase();
  if (["OK", "READY", "KNOWN", "LIVE", "FRESH", "PASS", "FILLED", "ACTIVE"].includes(status)) return "success";
  if (["REJECTED", "FAILED", "BLOCKED", "DOWN", "BREACH", "OPEN", "DISCONNECTED", "UNAVAILABLE"].includes(status)) return "danger";
  if (["CONNECTED_EMPTY", "DISABLED_BY_POLICY", "NOT_APPLICABLE_CURRENT_MODE", "MARKET_CLOSED", "LAST_KNOWN", "CLOSED"].includes(status)) return "info";
  if (["WATCH", "WAITING", "WAITING_OPERATOR", "PARTIAL", "STALE", "DEGRADED", "UNKNOWN", "HALF_OPEN"].some((item) => status.includes(item))) return "warning";
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
