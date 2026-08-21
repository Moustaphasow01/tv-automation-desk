import type { LiveTimeSeriesContract } from "@/domains/front-api/viewModels";
import type { HumanGateAction } from "@/features/order-intent/model";
import type { LiveTone, LiveTradingEnvelope, LiveTradingModel } from "./model";

export function toLiveTradingModel(envelope: LiveTradingEnvelope): LiveTradingModel {
  const { data, meta } = envelope;
  const runtime = data.canonicalRuntime;
  const latestSignal = runtime.latestSignals[0] ?? data.signals[0] ?? null;
  const selectedInstrument = normalizeInstrument(data.marketSeries?.instrument ?? latestSignal?.symbol ?? null);
  const orderIntent = selectOrderIntent([...runtime.pendingOrderIntents, ...data.portfolioOrderIntents], selectedInstrument);
  const targetPosition = selectTargetPosition(runtime.pendingTargetPositions ?? [], orderIntent, selectedInstrument);
  const marketContract = seriesContracts(data).find((item) => item.seriesId === "market.ohlcv");
  const performanceContract = seriesContracts(data).find((item) => item.seriesId === "performance.r_equity");
  const resourceActions = new Set((orderIntent?.allowedActions.allowedActions ?? []).map((action) => String(action).trim().toUpperCase()));
  const gateActions = orderIntent?.humanGate.allowedActions
    .map(normalizeHumanGateAction)
    .filter((action) => resourceActions.has(action.action)) ?? [];
  const degraded = meta.stale || meta.availability !== "AVAILABLE";
  const actionsUnavailable = meta.stale || meta.availability === "UNAVAILABLE";
  const reconciliationNotApplicable = ["NOT_APPLICABLE_CURRENT_MODE", "DISABLED_BY_POLICY"]
    .includes(String(data.reconciliation?.availability ?? "").toUpperCase());
  const selectedTheoreticalExecution = selectTheoreticalExecution(data.theoreticalExecution?.rows ?? [], orderIntent, selectedInstrument);
  const theoreticalExpected = data.reconciliation?.expected ?? selectedTheoreticalExecution;

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
    targetPosition,
    theoreticalExecution: data.theoreticalExecution ?? null,
    selectedTheoreticalExecution,
    gateActions: actionsUnavailable ? [] : gateActions as readonly HumanGateAction[],
    gateBlockedReason: actionsUnavailable
      ? `Projection ${meta.stale ? "stale" : meta.availability ?? "indisponible"} : les actions sensibles restent fermées.`
      : orderIntent?.allowedActions.denialReasons.length
        ? orderIntent.allowedActions.denialReasons.join(" · ")
        : orderIntent?.humanGate.allowedActions.length
          ? meta.availability !== "AVAILABLE"
            ? `Projection ${meta.availability ?? "partielle"} : actions autorisées seulement si elles sont publiées explicitement par le backend.`
            : "Le backend ne publie pas simultanément la capability ressource et l'action Human Gate."
          : "Aucun OrderIntent en attente de confirmation.",
    provider: data.providers[0] ?? null,
    reconciliation: {
      status: reconciliationNotApplicable ? "EXÉCUTION PHYSIQUE DÉSACTIVÉE" : data.reconciliation?.status ?? "UNAVAILABLE",
      detail: reconciliationNotApplicable
        ? theoreticalExpected
          ? "Exécution physique désactivée : le broker est non applicable, mais le suivi théorique backend est publié."
          : "Aucun snapshot broker n'est attendu dans le mode d'exécution courant ; aucun suivi théorique backend n'est encore publié."
        : data.reconciliation?.reason || `${data.reconciliation?.mismatchCount ?? "—"} divergence(s) autoritaire(s).`,
      asOf: data.reconciliation?.asOf ?? meta.asOf,
      expected: theoreticalExpected,
      broker: reconciliationNotApplicable ? null : data.reconciliation?.broker ?? null,
      mismatchCount: data.reconciliation?.mismatchCount ?? null,
    },
    timeline: deriveAuditTimeline(data),
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

function normalizeHumanGateAction(action: HumanGateAction): HumanGateAction {
  return {
    ...action,
    action: String(action.action).trim().toUpperCase() as HumanGateAction["action"],
    permission: String(action.permission).trim().toUpperCase() as HumanGateAction["permission"],
    environment: String(action.environment).trim().toUpperCase() as HumanGateAction["environment"],
  };
}

function selectOrderIntent(
  intents: readonly NonNullable<LiveTradingEnvelope["data"]["canonicalRuntime"]["pendingOrderIntents"]>[number][],
  selectedInstrument: string | null,
) {
  const unique = uniqueBy(intents, (item) => item.portfolioOrderIntentId || item.orderIntentId);
  if (!unique.length) return null;
  const awaiting = unique.filter((item) => normalizeInstrument(item.humanGate.status) === "AWAITING_MANUAL_CONFIRMATION" || item.humanGate.allowedActions.length);
  const pool = awaiting.length ? awaiting : unique;
  if (selectedInstrument) {
    const sameInstrument = pool.find((item) => normalizeInstrument(intentInstrument(item)) === selectedInstrument);
    if (sameInstrument) return sameInstrument;
  }
  return pool[0] ?? null;
}

function selectTargetPosition(
  targetPositions: readonly Record<string, unknown>[],
  orderIntent: LiveTradingModel["orderIntent"],
  selectedInstrument: string | null,
) {
  if (!targetPositions.length) return null;
  const targetId = normalizeText(orderIntent?.targetPositionId);
  const byId = targetId
    ? targetPositions.find((item) => normalizeText(recordValue(item, ["targetPositionId", "target_position_id", "target_position_id"])) === targetId)
    : null;
  if (byId) return byId;
  const intentSymbol = normalizeInstrument(intentInstrument(orderIntent));
  const wantedInstrument = intentSymbol || selectedInstrument;
  if (wantedInstrument) {
    const byInstrument = targetPositions.find((item) => normalizeInstrument(recordValue(item, ["instrument", "targetInstrument", "target_instrument", "symbol"])) === wantedInstrument);
    if (byInstrument) return byInstrument;
  }
  return targetPositions[0] ?? null;
}

function selectTheoreticalExecution(
  rows: readonly NonNullable<LiveTradingModel["theoreticalExecution"]>["rows"][number][],
  orderIntent: LiveTradingModel["orderIntent"],
  selectedInstrument: string | null,
): NonNullable<LiveTradingModel["theoreticalExecution"]>["rows"][number] | null {
  if (!rows.length) return null;
  const intentId = normalizeText(orderIntent?.portfolioOrderIntentId ?? orderIntent?.orderIntentId);
  if (intentId) {
    const byIntent = rows.find((item) => normalizeText(item.portfolioOrderIntentId) === intentId);
    if (byIntent) return byIntent;
  }
  if (selectedInstrument) {
    const byInstrument = rows.find((item) => normalizeInstrument(item.instrument) === selectedInstrument);
    if (byInstrument) return byInstrument;
  }
  return rows[0] ?? null;
}

function deriveAuditTimeline(data: LiveTradingEnvelope["data"]): LiveTradingEnvelope["data"]["timeline"] {
  if ((data.timeline ?? []).length) return data.timeline;
  const events: Array<LiveTradingEnvelope["data"]["timeline"][number]> = [];
  for (const signal of (data.canonicalRuntime.latestSignals ?? []).slice(0, 4)) {
    events.push({
      eventId: `signal:${signal.signalId}`,
      at: signal.createdAt,
      step: "STRATEGY_SIGNAL",
      title: `${signal.direction} ${signal.symbol}`,
      detail: `${signal.strategyInstanceId} · confiance ${signal.confidence}%`,
      tone: "INFO",
    });
  }
  for (const decision of (data.canonicalRuntime.aiContextGate ?? []).slice(0, 4)) {
    events.push({
      eventId: `context:${decision.decisionId}`,
      at: decision.decidedAt,
      step: "AI_CONTEXT_GATE",
      title: decision.recommendation || decision.status,
      detail: decision.reasonCodes.join(", ") || "Décision contextuelle publiée",
      tone: decision.status === "PASS" ? "INFO" : "WATCH",
    });
  }
  for (const intent of (data.canonicalRuntime.pendingOrderIntents ?? []).slice(0, 6)) {
    events.push({
      eventId: `intent:${intent.portfolioOrderIntentId}`,
      at: intent.createdAt ?? data.canonicalRuntime.freshness.orderIntentAt ?? data.canonicalRuntime.freshness.asOf,
      step: "ORDER_INTENT",
      title: `${intent.side} ${intentInstrument(intent)}`,
      detail: `${intent.humanGate.status} · qty ${intent.quantity}`,
      tone: intent.humanGate.allowedActions.length ? "WATCH" : "INFO",
    });
    if (intent.humanGate.gateId) {
      events.push({
        eventId: `human_gate:${intent.humanGate.gateId}`,
        at: intent.createdAt ?? data.canonicalRuntime.freshness.orderIntentAt ?? data.canonicalRuntime.freshness.asOf,
        step: "HUMAN_GATE",
        title: "Confirmation opérateur requise",
        detail: intent.allowedActions.allowedActions.join(", ") || "Aucune action autorisée",
        tone: "WATCH",
      });
    }
  }
  for (const row of (data.theoreticalExecution?.rows ?? []).slice(0, 8)) {
    if (!row.latestEventAt) continue;
    events.push({
      eventId: `theoretical:${row.portfolioOrderIntentId}:${row.latestEventType}`,
      at: row.latestEventAt,
      step: "THEORETICAL_EXECUTION",
      title: `${row.status} · ${row.instrument}`,
      detail: `${row.side} ${row.quantity ?? "—"} · R ${row.resultR ?? "—"}`,
      tone: ["TARGET_HIT", "ENTRY_FILLED"].includes(row.status) ? "INFO" : row.status === "STOP_HIT" ? "HIGH" : "WATCH",
    });
  }
  return uniqueBy(events.filter((event) => event.at && event.at !== "unavailable"), (event) => event.eventId)
    .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime())
    .slice(0, 24);
}

function intentInstrument(intent: LiveTradingModel["orderIntent"]): unknown {
  if (!intent) return null;
  return intent.symbol ?? (intent as { instrument?: string }).instrument ?? recordValue(intent.executionTerms, ["instrument", "instrument_code", "symbol"]);
}

function normalizeInstrument(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized ? normalized.toUpperCase() : null;
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function uniqueBy<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
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
