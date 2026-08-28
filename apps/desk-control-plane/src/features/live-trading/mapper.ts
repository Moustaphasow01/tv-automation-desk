import type { LiveTimeSeriesContract } from "@/domains/front-api/viewModels";
import type { HumanGateAction } from "@/features/order-intent/model";
import type { LiveTone, LiveTradingEnvelope, LiveTradingModel } from "./model";
import { resolveSignalTemporalState } from "./signalTemporalState";

export type LiveTradingSelection = {
  signalId?: string | null;
};

export function toLiveTradingModel(
  envelope: LiveTradingEnvelope,
  selection: LiveTradingSelection = {},
): LiveTradingModel {
  const { data, meta } = envelope;
  const runtime = data.canonicalRuntime;
  const signalPool = uniqueBy([...(runtime.latestSignals ?? []), ...(data.signals ?? [])], (item) => item.signalId);
  const explicitlySelectedSignalId = normalizeText(selection.signalId) || null;
  const orderIntent = selectOrderIntent(
    [...runtime.pendingOrderIntents, ...data.portfolioOrderIntents],
    explicitlySelectedSignalId,
  );
  const requiredSignalId = explicitlySelectedSignalId || normalizeText(orderIntent?.signalId) || null;
  const latestSignal = orderIntent && !requiredSignalId
    ? null
    : selectLatestSignal(signalPool, requiredSignalId);
  const latestContextDecision = selectContextDecision(runtime.aiContextGate, latestSignal?.signalId ?? null);
  const riskCheck = selectRiskCheck(data.riskChecks ?? [], latestSignal?.signalId ?? null);
  const targetPosition = selectTargetPosition(
    runtime.pendingTargetPositions ?? [],
    orderIntent,
    latestSignal?.signalId ?? null,
    latestSignal?.symbol ?? null,
    Boolean(explicitlySelectedSignalId),
  );
  const marketContract = seriesContracts(data).find((item) => item.seriesId === "market.ohlcv");
  const performanceContract = seriesContracts(data).find((item) => item.seriesId === "performance.r_equity");
  const resourceActions = new Set((orderIntent?.allowedActions.allowedActions ?? []).map((action) => String(action).trim().toUpperCase()));
  const gateActions = orderIntent?.humanGate.allowedActions
    .map(normalizeHumanGateAction)
    .filter((action) => resourceActions.has(action.action)) ?? [];
  const degraded = meta.stale || meta.availability !== "AVAILABLE";
  // Sensitive actions fail closed unless the complete authoritative projection is
  // available. A fresh PARTIAL response can still omit a decisive policy, risk,
  // revision, or capability field and must therefore remain read-only.
  const actionsUnavailable = meta.stale || meta.availability !== "AVAILABLE";
  const reconciliationNotApplicable = ["NOT_APPLICABLE_CURRENT_MODE", "DISABLED_BY_POLICY"]
    .includes(String(data.reconciliation?.availability ?? "").toUpperCase());
  const selectedTheoreticalExecution = selectTheoreticalExecution(
    data.theoreticalExecution?.rows ?? [],
    orderIntent,
    latestSignal?.signalId ?? null,
    latestSignal?.symbol ?? null,
    Boolean(explicitlySelectedSignalId),
  );
  const theoreticalExpected = data.reconciliation?.expected
    ?? selectedTheoreticalExecution;
  const signalFunnel = buildSignalFunnel(data, signalPool);

  return {
    meta,
    source: data,
    truth: {
      label: degraded ? meta.stale ? "STALE" : meta.availability ?? "PARTIAL" : "LIVE",
      tone: degraded ? "warning" : "success",
      detail: meta.warnings?.join(" · ") || "Projection BFF autoritaire disponible",
    },
    operator: buildOperatorState(meta.availability ?? "UNAVAILABLE", meta.stale, latestSignal, orderIntent, selectedTheoreticalExecution, meta.asOf),
    signalFunnel,
    marketIntelligence: buildMarketIntelligence(data, latestSignal, latestContextDecision),
    selectedSignalPlan: buildSignalPlanSummary(latestSignal),
    dataQuality: buildDataQuality(data, meta.asOf),
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
    latestContextDecision,
    riskCheck,
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
    timeline: data.timeline ?? [],
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

function buildOperatorState(
  availability: string,
  stale: boolean,
  latestSignal: LiveTradingModel["latestSignal"],
  orderIntent: LiveTradingModel["orderIntent"],
  theoretical: LiveTradingModel["selectedTheoreticalExecution"],
  asOf: string,
): LiveTradingModel["operator"] {
  if (stale || availability === "UNAVAILABLE") {
    return {
      status: "DEGRADED",
      label: "Lecture dégradée",
      detail: stale ? "Projection ancienne : aucune action sensible ne doit être interprétée comme fraîche." : "La projection Live Trading n'est pas disponible.",
      tone: "warning",
    };
  }
  if (orderIntent) {
    const gateStatus = String(orderIntent.humanGate.status ?? "").trim().toUpperCase();
    const awaitingHumanDecision = orderIntent.humanGate.allowedActions.length > 0
      || ["AWAITING", "PENDING", "REQUIRED", "READY"].some((token) => gateStatus.includes(token));
    if (!awaitingHumanDecision) {
      const expired = gateStatus.includes("EXPIRED");
      const rejected = gateStatus.includes("REJECT");
      const confirmed = ["CONFIRM", "APPROV"].some((token) => gateStatus.includes(token));
      return {
        status: "ORDER_INTENT_RECORDED",
        label: expired ? "Dossier expiré" : rejected ? "Dossier rejeté" : confirmed ? "Dossier confirmé" : "Dossier enregistré",
        detail: `${orderIntent.side} ${intentInstrument(orderIntent) ?? "instrument"} · qty ${orderIntent.quantity} · ${gateStatus || "état non publié"}`,
        tone: expired || rejected ? "warning" : "info",
      };
    }
    return {
      status: "AWAITING_HUMAN_GATE",
      label: "Dossier à confirmer",
      detail: `${orderIntent.side} ${intentInstrument(orderIntent) ?? "instrument"} · qty ${orderIntent.quantity} · ${orderIntent.humanGate.status}`,
      tone: orderIntent.humanGate.allowedActions.length ? "warning" : "info",
    };
  }
  if (theoretical) {
    return {
      status: "THEORETICAL_TRACKING",
      label: "Suivi théorique actif",
      detail: `${theoretical.instrument} · ${theoretical.status} · R ${displayValue(theoretical.resultR)}`,
      tone: theoretical.status === "STOP_HIT" ? "danger" : theoretical.status === "TARGET_HIT" ? "success" : "info",
    };
  }
  if (latestSignal) {
    const temporal = resolveSignalTemporalState(latestSignal, asOf);
    return {
      status: "SIGNAL_DETECTED",
      label: temporal.effectiveState === "EXPIRED" ? "Dernier signal expiré" : "Signal détecté",
      detail: `${latestSignal.symbol} ${latestSignal.direction} · ${temporal.label} · ${temporal.effectiveState === "EXPIRED" ? "expiré" : "expire"} ${displayTime(latestSignal.expiresAt)}`,
      tone: temporal.effectiveState === "REJECTED" || temporal.effectiveState === "EXPIRED" ? "warning" : "info",
    };
  }
  return {
    status: "NO_OPPORTUNITY",
    label: "Aucune opportunité active",
    detail: "Les moteurs peuvent tourner sans publier de signal exploitable sur la fenêtre courante.",
    tone: "neutral",
  };
}

function buildSignalFunnel(
  data: LiveTradingEnvelope["data"],
  signalPool: readonly LiveTradingEnvelope["data"]["signals"][number][],
): LiveTradingModel["signalFunnel"] {
  const contextDecisions = data.canonicalRuntime.aiContextGate ?? [];
  const contextTake = contextDecisions.filter((item) => semanticIncludes(item.status, item.recommendation, ["TAKE", "ACCEPT", "PASS"])).length;
  const contextWait = contextDecisions.filter((item) => semanticIncludes(item.status, item.recommendation, ["WAIT", "WATCH"])).length;
  const contextReject = contextDecisions.filter((item) => semanticIncludes(item.status, item.recommendation, ["REJECT", "BLOCK"])).length;
  const arbitrations = data.arbitrations ?? [];
  const riskChecks = data.riskChecks ?? [];
  const portfolioAccepted = arbitrations.filter((item) => item.decision === "ACCEPTED" || item.decision === "SCALED").length;
  const portfolioRejected = arbitrations.filter((item) => item.decision === "REJECTED").length;
  const riskPass = riskChecks.filter((item) => item.status === "PASS").length;
  const riskWatch = riskChecks.filter((item) => item.status === "WATCH").length;
  const riskBlock = riskChecks.filter((item) => item.status === "BLOCK").length;
  const intents = uniqueBy([...(data.canonicalRuntime.pendingOrderIntents ?? []), ...(data.portfolioOrderIntents ?? [])], (item) => item.portfolioOrderIntentId || item.orderIntentId);
  const pendingHumanGates = intents.filter((item) => item.humanGate.allowedActions.length || semanticIncludes(item.humanGate.status, "", ["AWAITING", "PENDING"])).length;
  const theoreticalSummary = data.theoreticalExecution?.summary;
  const theoreticalTracked = theoreticalSummary?.trackedIntents ?? data.theoreticalExecution?.rows.length ?? 0;
  const rawSignals = signalPool.length;
  return {
    rawSignals,
    contextTake,
    contextWait,
    contextReject,
    portfolioAccepted,
    portfolioRejected,
    riskPass,
    riskWatch,
    riskBlock,
    orderIntents: intents.length,
    pendingHumanGates,
    theoreticalTracked,
    theoreticalOpen: theoreticalSummary?.openTrades ?? 0,
    targetHit: theoreticalSummary?.targetHit ?? 0,
    stopHit: theoreticalSummary?.stopHit ?? 0,
    expired: theoreticalSummary?.expired ?? 0,
    totalClosedR: theoreticalSummary?.totalClosedR ?? null,
    stages: [
      { key: "signals", label: "Signaux", value: rawSignals, tone: rawSignals ? "info" : "neutral", detail: "Signaux StrategySignal publiés par les moteurs." },
      { key: "context", label: "Contexte OK", value: contextTake, tone: contextTake ? "success" : contextWait || contextReject ? "warning" : "neutral", detail: `${contextWait} attente · ${contextReject} rejet contexte` },
      { key: "portfolio", label: "Portfolio", value: portfolioAccepted, tone: portfolioAccepted ? "success" : portfolioRejected ? "warning" : "neutral", detail: `${portfolioRejected} rejet portfolio` },
      { key: "risk", label: "Risk PASS", value: riskPass, tone: riskPass ? "success" : riskBlock ? "danger" : riskWatch ? "warning" : "neutral", detail: `${riskWatch} watch · ${riskBlock} block` },
      { key: "intent", label: "OrderIntent", value: intents.length, tone: intents.length ? "warning" : "neutral", detail: `${pendingHumanGates} Human Gate en attente` },
      { key: "tracking", label: "Suivis", value: theoreticalTracked, tone: theoreticalTracked ? "info" : "neutral", detail: `${theoreticalSummary?.closedTrades ?? 0} clos · R ${displayValue(theoreticalSummary?.totalClosedR)}` },
    ],
  };
}

function buildMarketIntelligence(
  data: LiveTradingEnvelope["data"],
  latestSignal: LiveTradingModel["latestSignal"],
  contextDecision: LiveTradingModel["latestContextDecision"],
): LiveTradingModel["marketIntelligence"] {
  const setup = asRecord(latestSignal?.setup);
  const macro = asRecord(data.macroSession);
  const decision = asRecord(contextDecision);
  const context = asRecord(recordValue(setup, ["context", "marketContext", "market_context", "contextSnapshot"])) ?? {};
  const preferredFamilies = uniqueText([
    ...stringArray(recordValue(context, ["preferredStrategyFamilies", "preferred_strategy_families", "preferredFamilies"])),
    ...stringArray(recordValue(setup, ["preferredStrategyFamilies", "preferred_strategy_families"])),
  ]);
  const discouragedFamilies = uniqueText([
    ...stringArray(recordValue(context, ["discouragedStrategyFamilies", "discouraged_strategy_families", "discouragedFamilies"])),
    ...stringArray(recordValue(setup, ["discouragedStrategyFamilies", "discouraged_strategy_families"])),
  ]);
  const reasonCodes = uniqueText([
    ...(contextDecision?.reasonCodes ?? []),
    ...stringArray(recordValue(context, ["reasonCodes", "reason_codes"])),
  ]).slice(0, 10);
  const zones = [
    ...zoneRows(recordValue(context, ["opportunityZones", "opportunity_zones", "zones"]), "Zone opportunité", "info"),
    ...zoneRows(recordValue(context, ["noTradeZones", "no_trade_zones"]), "Zone no-trade", "warning"),
    ...zoneRows(recordValue(setup, ["entry_zone", "entryZone"]), "Zone d'entrée signal", "success"),
  ].slice(0, 6);
  return {
    bias: displayValue(recordValue(context, ["globalBias", "global_bias", "bias", "marketBias", "market_bias"]) ?? recordValue(macro, ["bias", "marketBias", "globalBias"]), "NON PUBLIÉ"),
    regime: displayValue(recordValue(context, ["marketRegime", "market_regime", "regime"]) ?? recordValue(macro, ["regime", "marketRegime"]), "NON PUBLIÉ"),
    volatility: displayValue(recordValue(context, ["volatilityRegime", "volatility_regime", "volatility"]) ?? recordValue(macro, ["volatilityRegime", "volatility_regime", "volatility"]), "NON PUBLIÉ"),
    macroRisk: displayValue(recordValue(context, ["macroRisk", "macro_risk", "newsRisk"]) ?? recordValue(macro, ["macroRisk", "macro_risk", "newsRisk"]), "NON PUBLIÉ"),
    confidence: numberOrNull(recordValue(context, ["confidence"]) ?? contextDecision?.confidence),
    riskMultiplier: numberOrNull(recordValue(context, ["riskMultiplier", "risk_multiplier"]) ?? contextDecision?.riskMultiplier),
    validUntil: normalizeText(recordValue(context, ["validUntil", "valid_until"]) ?? recordValue(decision, ["validUntil", "valid_until"])) || null,
    reasonCodes,
    preferredFamilies,
    discouragedFamilies,
    zones,
  };
}

function buildSignalPlanSummary(signal: LiveTradingModel["latestSignal"]): LiveTradingModel["selectedSignalPlan"] {
  if (!signal) return null;
  const plan = asRecord(signal.proposedTradePlan) ?? {};
  const setup = asRecord(signal.setup) ?? {};
  const economics = asRecord(signal.tradePlanEconomics) ?? {};
  const entry = priceValue(recordValue(plan, ["entry"]))
    ?? recordValue(economics, ["entry_price", "entryPrice"])
    ?? recordValue(setup, ["entry_price", "entryPrice", "entry"])
    ?? recordValue(setup, ["entry_zone", "entryZone"]);
  const stop = priceValue(recordValue(plan, ["stop"]))
    ?? recordValue(economics, ["stop_price", "stopPrice"])
    ?? recordValue(setup, ["stop_price", "stopPrice", "stop", "stop_loss", "stopLoss"]);
  return {
    source: signal.sourceClass || signal.availability || "StrategySignal",
    orderType: displayValue(recordValue(plan, ["orderType", "order_type"]) ?? recordValue(setup, ["orderType", "order_type"]), "NON PUBLIÉ"),
    entry: displayValue(formatPriceOrRange(entry), "NON PUBLIÉ"),
    stop: displayValue(formatPriceOrRange(stop), "NON PUBLIÉ"),
    targets: targetStrings(recordValue(plan, ["targets"]) ?? recordValue(setup, ["targets", "take_profit_targets", "takeProfitTargets", "target_prices", "targetPrices"])),
    expectedR: `${displayValue(signal.expectancyR)} R`,
    rewardRisk: displayValue(signal.rewardRisk),
    expiresAt: signal.expiresAt,
    sourceCutoffAt: signal.sourceDataCutoffAt ?? signal.createdAt,
  };
}

function buildDataQuality(data: LiveTradingEnvelope["data"], generatedAt: string): LiveTradingModel["dataQuality"] {
  const contracts = seriesContracts(data);
  const telegram = data.telegramDrilldown ?? {
    availability: "UNAVAILABLE",
    enabled: false,
    healthy: false,
    lastDeliveryAt: null,
    deliveryStatus: "UNAVAILABLE",
    reason: "Telegram non publié dans cette projection.",
  };
  return {
    availability: data.marketSeries?.availability ?? "UNAVAILABLE",
    generatedAt,
    marketAsOf: data.marketSeries?.asOf ?? data.timeSeriesContracts.asOf ?? null,
    marketAgeLabel: ageLabel(generatedAt, data.marketSeries?.asOf ?? data.timeSeriesContracts.asOf),
    candleCount: data.marketSeries?.points.length ?? 0,
    sources: (data.canonicalRuntime.authoritativeSources ?? []).map((item) => ({
      source: item.source,
      rows: item.rows,
      latestAt: item.latestAt,
      tone: item.latestAt ? "success" : item.rows ? "info" : "neutral",
    })),
    timeSeries: contracts.map((item) => ({
      seriesId: item.seriesId,
      label: item.label,
      source: item.source,
      availability: item.availability,
      reason: item.reason || "",
      tone: liveTone(item.availability),
    })),
    telegram: {
      availability: telegram.availability,
      enabled: telegram.enabled,
      healthy: telegram.healthy,
      lastDeliveryAt: telegram.lastDeliveryAt ?? null,
      status: telegram.deliveryStatus || telegram.reason || (telegram.enabled ? "ENABLED" : "DISABLED"),
      tone: telegram.healthy ? "success" : telegram.enabled ? "warning" : "info",
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
  selectedSignalId: string | null,
) {
  const unique = uniqueBy(intents, (item) => item.portfolioOrderIntentId || item.orderIntentId);
  if (!unique.length) return null;
  if (selectedSignalId) {
    // A pinned signal owns its complete dossier, including a CONFIRMED, REJECTED
    // or otherwise non-awaiting OrderIntent. An unrelated pending gate must never
    // replace that canonical lineage merely because it remains actionable.
    return unique.find((item) => normalizeText(item.signalId) === selectedSignalId) ?? null;
  }
  const awaiting = unique.filter((item) => normalizeInstrument(item.humanGate.status) === "AWAITING_MANUAL_CONFIRMATION" || item.humanGate.allowedActions.length);
  const pool = awaiting.length ? awaiting : unique;
  return pool[0] ?? null;
}

function selectRiskCheck(
  riskChecks: LiveTradingEnvelope["data"]["riskChecks"],
  signalId: string | null,
): LiveTradingModel["riskCheck"] {
  if (!signalId) return null;
  const risk = riskChecks.find((item) => normalizeText(item.signalId) === signalId);
  if (!risk) return null;
  return {
    ...risk,
    // PostgreSQL/BFF may honestly publish null when no utilization percentage
    // was computed. Preserve that absence instead of coercing it to zero.
    usedPct: typeof risk.usedPct === "number" && Number.isFinite(risk.usedPct) ? risk.usedPct : null,
  };
}

function selectLatestSignal(
  signals: readonly NonNullable<LiveTradingEnvelope["data"]["canonicalRuntime"]["latestSignals"]>[number][],
  requiredSignalId: string | null,
) {
  if (!signals.length) return null;
  const sorted = [...signals].sort((left, right) => new Date(right.createdAt ?? "").getTime() - new Date(left.createdAt ?? "").getTime());
  if (requiredSignalId) {
    return sorted.find((item) => normalizeText(item.signalId) === requiredSignalId) ?? null;
  }
  return sorted[0] ?? null;
}

function selectContextDecision(
  decisions: LiveTradingEnvelope["data"]["canonicalRuntime"]["aiContextGate"],
  signalId: string | null,
) {
  if (!signalId) return null;
  return decisions.find((item) => normalizeText(item.signalId) === signalId) ?? null;
}

function selectTargetPosition(
  targetPositions: readonly Record<string, unknown>[],
  orderIntent: LiveTradingModel["orderIntent"],
  selectedSignalId: string | null,
  selectedInstrument: string | null,
  strictSignalSelection: boolean,
) {
  if (!targetPositions.length) return null;
  const targetId = normalizeText(orderIntent?.targetPositionId);
  const byId = targetId
    ? targetPositions.find((item) => normalizeText(recordValue(item, ["targetPositionId", "target_position_id", "target_position_id"])) === targetId)
    : null;
  if (byId) return byId;
  if (selectedSignalId) {
    const bySignal = targetPositions.find((item) => normalizeText(recordValue(item, ["signalId", "signal_id", "strategySignalId", "strategy_signal_id"])) === selectedSignalId);
    if (bySignal) return bySignal;
    if (strictSignalSelection) return null;
  }
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
  selectedSignalId: string | null,
  selectedInstrument: string | null,
  strictSignalSelection: boolean,
): NonNullable<LiveTradingModel["theoreticalExecution"]>["rows"][number] | null {
  if (!rows.length) return null;
  const intentId = normalizeText(orderIntent?.portfolioOrderIntentId ?? orderIntent?.orderIntentId);
  if (intentId) {
    const byIntent = rows.find((item) => normalizeText(item.portfolioOrderIntentId) === intentId);
    if (byIntent) return byIntent;
  }
  if (selectedSignalId) {
    const bySignal = rows.find((item) => normalizeText(item.strategySignalId) === selectedSignalId);
    if (bySignal) return bySignal;
    if (strictSignalSelection) return null;
  }
  if (selectedInstrument) {
    const byInstrument = rows.find((item) => normalizeInstrument(item.instrument) === selectedInstrument);
    if (byInstrument) return byInstrument;
  }
  return rows[0] ?? null;
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

function semanticIncludes(left: unknown, right: unknown, needles: readonly string[]): boolean {
  const value = `${String(left ?? "")} ${String(right ?? "")}`.toUpperCase();
  return needles.some((needle) => value.includes(needle));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => normalizeText(item)).filter(Boolean);
  const text = normalizeText(value);
  return text ? [text] : [];
}

function uniqueText(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.trim();
    if (!key || seen.has(key.toUpperCase())) continue;
    seen.add(key.toUpperCase());
    result.push(key);
  }
  return result;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function zoneRows(value: unknown, fallbackLabel: string, tone: LiveTone): LiveTradingModel["marketIntelligence"]["zones"] {
  const rows = Array.isArray(value) ? value : value == null ? [] : [value];
  return rows.map((item, index) => {
    const record = asRecord(item);
    const range = record ? formatZoneRange(record) : formatPriceOrRange(item);
    if (!range) return null;
    return {
      label: displayValue(recordValue(record, ["label", "name", "zoneType", "zone_type"]) ?? `${fallbackLabel} ${index + 1}`),
      direction: displayValue(recordValue(record, ["direction", "side", "bias"]), "—"),
      range,
      detail: displayValue(recordValue(record, ["detail", "reason", "description"]) ?? recordValue(record, ["priority"]), ""),
      tone,
    };
  }).filter((item): item is LiveTradingModel["marketIntelligence"]["zones"][number] => Boolean(item));
}

function formatZoneRange(record: Record<string, unknown>): string {
  const low = recordValue(record, ["minPrice", "min_price", "low", "from", "lower", "start"]);
  const high = recordValue(record, ["maxPrice", "max_price", "high", "to", "upper", "end"]);
  const direct = recordValue(record, ["price", "level", "value"]);
  if (low !== undefined && high !== undefined) return `${displayValue(low)} → ${displayValue(high)}`;
  if (direct !== undefined) return displayValue(direct);
  return "";
}

function priceValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return record.price ?? record.value ?? record.mid ?? record.center ?? record.level;
}

function formatPriceOrRange(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => displayValue(priceValue(item))).join(" → ");
  const record = asRecord(value);
  if (!record) return displayValue(value, "");
  const direct = priceValue(record);
  if (direct !== record && direct !== undefined) return displayValue(direct, "");
  return formatZoneRange(record);
}

function targetStrings(value: unknown): string[] {
  const rows = Array.isArray(value) ? value : value == null ? [] : [value];
  return rows.map((item, index) => {
    const record = asRecord(item);
    const price = record ? priceValue(record) ?? recordValue(record, ["targetPrice", "target_price"]) : item;
    const label = displayValue(recordValue(record, ["label", "name"]) ?? `T${index + 1}`);
    const formatted = displayValue(price, "");
    return formatted ? `${label} ${formatted}` : "";
  }).filter(Boolean).slice(0, 4);
}

function ageLabel(referenceIso: string, valueIso: string | null | undefined): string {
  if (!valueIso) return "non publié";
  const reference = Date.parse(referenceIso);
  const value = Date.parse(valueIso);
  if (!Number.isFinite(reference) || !Number.isFinite(value)) return "horodatage illisible";
  const deltaSeconds = Math.max(0, Math.round((reference - value) / 1000));
  if (deltaSeconds < 60) return `${deltaSeconds}s`;
  const minutes = Math.round(deltaSeconds / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.round(minutes / 60);
  return `${hours}h`;
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
