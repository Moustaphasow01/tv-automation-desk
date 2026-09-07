import { countBy, firstValue, nested, number, rows, upper } from "./front-control-plane-projection-helpers.js";
import { hasTradeId, side } from "./front-control-plane-view-values.js";
import { text } from "./front-control-plane-common.js";
import { frontTimeSeriesContracts } from "./front-control-plane-time-series-contracts.js";

export function portfolio({ execution, risk, nowIso, warnings }) {
  warnings.push("portfolio-attribution:NOT_IMPLEMENTED", "portfolio-correlation:NOT_IMPLEMENTED", "portfolio-equity-curve:NOT_IMPLEMENTED", "portfolio-reconciliation:PARTIAL", "portfolio-virtual-attribution:NOT_IMPLEMENTED");
  const sourceExposureRows = rows(nested(risk, ["exposures"])).filter(hasExposureIdentity);
  const exposureRows = sourceExposureRows.filter(hasExposureValue);
  if (sourceExposureRows.length && !exposureRows.length) warnings.push("portfolio-exposure-values:UNAVAILABLE");
  const trades = rows(nested(execution, ["trades"])).filter(hasTradeId).filter(isOpenPortfolioTrade);
  const summary = portfolioSummary(execution, risk, nowIso);
  if (summary.accountSnapshotStale) warnings.push("portfolio-account-snapshot:STALE");
  const positionsLong = countBy(trades, (item) => side(item.side) === "LONG");
  const positionsShort = countBy(trades, (item) => side(item.side) === "SHORT");
  const strategyIdsWithPositions = new Set(trades.map((item) => text(item.strategy_instance_id, "")).filter(Boolean));
  const humanGates = rows(nested(execution, ["humanExecutionGates"]));
  const humanGatePending = countBy(humanGates, (item) => !["CONFIRMED", "REJECTED", "EXPIRED", "CANCELLED"].includes(upper(item.status)));
  const portfolioIntents = rows(nested(execution, ["portfolioOrderIntents"]));
  const pendingOrders = countBy(portfolioIntents, (item) => ["READY", "WORKING", "PENDING", "AWAITING_MANUAL_CONFIRMATION"].includes(upper(item.status)));
  return {
    summary: { ...summary.values, positionsLong, positionsShort, strategiesWithPositions: strategyIdsWithPositions.size, humanGatePending, pendingOrders },
    summaryTruth: summary.truth,
    authoritativeState: firstValue(nested(risk, ["portfolio_state"]), null),
    accountsSummary: portfolioAccountsSummary(execution),
    equityCurve: [],
    positions: trades.map(portfolioPositionRow),
    exposureTree: exposureRows.map(portfolioExposureTreeRow),
    brokerPositions: trades.map(portfolioBrokerPositionRow),
    correlationMatrix: { instruments: exposureRows.map((item) => text(item.instrument_code, "—")).slice(0, 4), cells: [], topPair: "—", portfolioCorrelation: 0, diversificationScore: 0 },
    virtualAllocations: [],
    reconciliation: portfolioReconciliationSummary({ execution, risk, nowIso }),
    attribution: { bestContributor: "—", top3RiskPct: 0, diversificationScore: 0, items: [] },
    timeline: [],
    timeSeriesContracts: frontTimeSeriesContracts({ view: "portfolio", execution, risk, nowIso }),
  };
}

function portfolioSummary(execution = {}, risk = {}, nowIso) {
  const snapshot = latestAccountSnapshot(nested(execution, ["accountSnapshots"]));
  const equity = finiteNumber(firstValue(nested(snapshot, ["payload", "net_liquidation_value"]), nested(snapshot, ["cash_value"])));
  const unrealizedPnl = finiteNumber(firstValue(nested(snapshot, ["unrealized_pnl"]), nested(snapshot, ["payload", "unrealized_pnl"])));
  const riskPct = finiteNumber(firstValue(nested(risk, ["summary", "risk_percent"]), nested(execution, ["safety", "riskPercent"])));
  const correlatedExposurePct = finiteNumber(nested(risk, ["summary", "correlated_exposure_pct"]));
  // risk_center.{grossExposure,netExposure,dailyLoss,trailingDrawdown} are the real
  // (schema-correct) locations for these figures, but the projection that builds
  // risk_center (front-portfolio-risk-projection.js) hardcodes all four to
  // availability:"UNAVAILABLE" today - the underlying computation was never written.
  // Read the real path (so this starts working the day that gap is closed) rather
  // than a field that never existed; today it still resolves to null/unavailable.
  const grossExposureUsd = finiteNumber(nested(risk, ["risk_center", "grossExposure", "value"]));
  const netExposureUsd = finiteNumber(nested(risk, ["risk_center", "netExposure", "value"]));
  const dailyLossR = finiteNumber(nested(risk, ["risk_center", "dailyLoss", "value"]));
  const maxDrawdownR = finiteNumber(nested(risk, ["risk_center", "trailingDrawdown", "value"]));
  const openRiskUsd = finiteNumber(nested(risk, ["risk_center", "openRisk", "value"]));
  const sourceAt = isoTimestamp(nested(snapshot, ["captured_at"]), nowIso);
  const accountSnapshotStale = Boolean(snapshot) && isOlderThanSeconds(sourceAt, nowIso, number(nested(execution, ["safety", "accountSnapshotMaxAgeSeconds"]), 60));
  const values = {
    equity: equity ?? 0,
    grossExposureUsd: grossExposureUsd ?? 0,
    netExposureUsd: netExposureUsd ?? 0,
    unrealizedPnl: unrealizedPnl ?? 0,
    riskUsedPct: riskPct ?? 0,
    correlatedExposurePct: correlatedExposurePct ?? 0,
    netLiquidation: equity ?? 0,
    dailyR: dailyLossR ?? 0,
    exposureUsd: openRiskUsd ?? grossExposureUsd ?? 0,
    maxDrawdownR: maxDrawdownR ?? 0,
    openPositions: number(nested(execution, ["summary", "openTrades"]), 0),
    riskUsagePct: riskPct ?? 0,
  };
  return {
    values,
    truth: {
      equity: equity == null ? unavailableValue("Aucun snapshot de capital exploitable", "execution.accountSnapshots") : metricValue(equity, sourceAt, "execution.accountSnapshots", accountSnapshotStale),
      grossExposureUsd: grossExposureUsd == null ? unavailableValue("Exposition brute absente de l’état du risk engine", "portfolio-risk") : knownValue(grossExposureUsd, nowIso, "portfolio-risk"),
      netExposureUsd: netExposureUsd == null ? unavailableValue("Exposition nette absente de l’état du risk engine", "portfolio-risk") : knownValue(netExposureUsd, nowIso, "portfolio-risk"),
      unrealizedPnl: unrealizedPnl == null ? unavailableValue("PnL latent absent du dernier snapshot", "execution.accountSnapshots") : metricValue(unrealizedPnl, sourceAt, "execution.accountSnapshots", accountSnapshotStale),
      riskUsedPct: riskPct == null ? unavailableValue("Pourcentage de risque absent", "portfolio-risk") : knownValue(riskPct, nowIso, "portfolio-risk"),
      correlatedExposurePct: correlatedExposurePct == null ? notImplementedValue("Exposition corrélée non publiée", "portfolio.correlation") : knownValue(correlatedExposurePct, nowIso, "portfolio-risk"),
    },
    accountSnapshotStale,
  };
}

function hasExposureIdentity(item) { return Boolean(item?.exposure_id || item?.instrument_code); }

function hasExposureValue(item) { return finiteNumber(nested(item, ["value_usd"])) !== null; }

function portfolioExposureTreeRow(item) {
  return {
    id: text(firstValue(item.exposure_id, item.instrument_code), ""),
    label: text(item.instrument_code, "Instrument"),
    group: "Index",
    side: "NET",
    valueUsd: number(item.value_usd, 0),
    weightPct: number(item.weight_pct, 0),
  };
}

function portfolioAccountsSummary(execution = {}) {
  const accounts = rows(nested(execution, ["accounts"]));
  const snapshotsByAccount = new Map();
  for (const snapshot of rows(nested(execution, ["accountSnapshots"]))) {
    const accountId = text(snapshot.broker_account_id, "");
    if (!accountId) continue;
    const existing = snapshotsByAccount.get(accountId);
    if (!existing || Date.parse(snapshot.captured_at || 0) > Date.parse(existing.captured_at || 0)) snapshotsByAccount.set(accountId, snapshot);
  }
  const trades = rows(nested(execution, ["trades"])).filter(hasTradeId).filter(isOpenPortfolioTrade);
  return accounts.filter((account) => account?.broker_account_id).map((account) => {
    const accountId = text(account.broker_account_id, "");
    const snapshot = snapshotsByAccount.get(accountId) || null;
    const equity = finiteNumber(firstValue(nested(snapshot, ["payload", "net_liquidation_value"]), nested(snapshot, ["cash_value"])));
    const openPnl = finiteNumber(firstValue(nested(snapshot, ["unrealized_pnl"]), nested(snapshot, ["payload", "unrealized_pnl"])));
    return {
      accountId,
      label: text(account.account_label, accountId),
      mode: text(account.mode, "unavailable").toUpperCase(),
      equity,
      openPnl,
      openPositions: countBy(trades, (item) => text(item.broker_account_id, "") === accountId),
      asOf: snapshot ? isoTimestamp(snapshot.captured_at, null) : null,
    };
  });
}

function portfolioReconciliationSummary({ execution, risk, nowIso }) {
  return {
    status: nested(risk, ["summary", "reconciliationDivergences"]) ? "MISMATCH" : "PENDING",
    targetDeskQuantity: 0,
    brokerRealQuantity: 0,
    deltaQuantity: 0,
    asOf: nowIso,
    ordersInFlight: number(nested(execution, ["summary", "activeOrders"]), 0),
  };
}

function isOpenPortfolioTrade(item = {}) {
  return !item.administrative_resolution_status
    && (upper(item.status) === "OPEN" || number(item.quantity_open, 0) > 0);
}

function latestAccountSnapshot(value) {
  return rows(value).slice().sort((left, right) => Date.parse(right?.captured_at || 0) - Date.parse(left?.captured_at || 0))[0] || null;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoTimestamp(value, fallback) {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function isOlderThanSeconds(value, reference, seconds) {
  const timestamp = Date.parse(value);
  const now = Date.parse(reference);
  return Number.isFinite(timestamp) && Number.isFinite(now) && now - timestamp > seconds * 1000;
}

function metricValue(value, asOf, source, stale) {
  return stale ? { state: "STALE", value, asOf, source, reason: "Dernier snapshot compte au-delà de la fenêtre de fraîcheur" } : knownValue(value, asOf, source);
}

function knownValue(value, asOf, source) { return { state: "KNOWN", value, asOf, source }; }

function unavailableValue(reason, source) { return { state: "UNAVAILABLE", reason, source }; }

function notImplementedValue(reason, capability) { return { state: "NOT_IMPLEMENTED", reason, capability }; }

function portfolioPositionRow(item = {}) {
  return {
    positionId: text(item.trade_id || item.position_id, ""),
    strategyInstanceId: text(item.strategy_instance_id, "unknown"),
    symbol: text(firstValue(item.instrument_code, item.broker_symbol, item.instrument, item.symbol), "—"),
    side: side(item.side),
    quantity: number(item.quantity_open, 0),
    virtualR: 0,
    brokerQuantity: number(item.quantity_open, 0),
    reconciliation: "PENDING",
  };
}

function portfolioBrokerPositionRow(item = {}) {
  return {
    positionId: text(item.trade_id || item.position_id, ""),
    account: text(firstValue(item.broker_account_id, item.account_id), "—"),
    instrument: text(firstValue(item.instrument_code, item.broker_symbol, item.instrument, item.symbol), "—"),
    side: side(item.side),
    quantity: number(item.quantity_open, 0),
    averagePrice: number(firstValue(item.avg_entry_price, item.entry_price), 0),
    markPrice: number(firstValue(item.mark_price, item.current_price, item.last_price), 0),
    unrealizedPnl: number(firstValue(item.unrealized_pnl, item.unrealizedPnl), 0),
    riskR: number(firstValue(item.risk_R, item.risk_r), 0),
    protectionStatus: item.current_stop_price || item.initial_stop_price ? "PROTECTED" : "PENDING",
    reconciliationStatus: "PENDING",
  };
}
