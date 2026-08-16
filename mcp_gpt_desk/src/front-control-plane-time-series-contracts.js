import { currentUtc, hasSignalId, rows } from "./front-control-plane-projection-helpers.js";

export function frontTimeSeriesContracts({ view, execution = {}, strategy = {}, risk = {}, marketSeries = null, performance = null, nowIso = currentUtc() }) {
  const hasSignals = rows(strategy?.signals).some(hasSignalId);
  const hasOrderIntents = rows(execution?.portfolioOrderIntents).length > 0;
  const hasFills = rows(execution?.providerEvents).some(isFillEvent);
  const hasPerformance = Boolean(performance || risk?.performance?.equity_curve || execution?.performance?.equity_curve);
  const hasMarket = marketSeries?.availability === "KNOWN" && rows(marketSeries?.points).length > 0;
  const hasRiskCenter = risk?.risk_center?.availability === "KNOWN";
  const contracts = [
    seriesContract({ seriesId: "market.ohlcv", label: "OHLCV marché", unit: "price", source: "market_candles", availability: hasMarket ? "KNOWN" : marketSeries?.availability || "UNAVAILABLE", reason: hasMarket ? "" : marketSeries?.reason || "No closed market candles exist in the requested window.", schema: "ohlcv_series_v1", cursor: marketSeries?.page?.nextCursor || null }),
    seriesContract({ seriesId: "market.vwap", label: "VWAP déterministe", unit: "price", source: "market_candles.sql_window", availability: hasMarket ? "KNOWN" : marketSeries?.availability || "UNAVAILABLE", reason: hasMarket ? "" : "No market rows are available for deterministic VWAP.", schema: "feature_series_v1", cursor: marketSeries?.page?.nextCursor || null }),
    seriesContract({ seriesId: "trading.signal_markers", label: "Signal markers", unit: "event", source: "strategy_signal_outbox", availability: hasSignals ? "KNOWN" : "CONNECTED_EMPTY", reason: hasSignals ? "" : "No StrategySignal rows in the current source window.", schema: "signal_marker_series_v1" }),
    seriesContract({ seriesId: "trading.order_intent_overlays", label: "OrderIntent overlays", unit: "price", source: "portfolio_order_intent_lineage", availability: hasOrderIntents ? "KNOWN" : "CONNECTED_EMPTY", reason: hasOrderIntents ? "" : "No post-risk OrderIntent rows in the current source window.", schema: "order_intent_overlay_series_v1" }),
    seriesContract({ seriesId: "trading.broker_fills", label: "Broker fills", unit: "fill", source: "broker_provider_events", availability: hasFills ? "KNOWN" : "NOT_APPLICABLE_CURRENT_MODE", reason: hasFills ? "" : "No canonical broker fill is expected while physical execution is disabled.", schema: "broker_fill_series_v1" }),
    seriesContract({ seriesId: "performance.r_equity", label: "R equity", unit: "R", source: "performance_ledger", availability: hasPerformance ? "PARTIAL" : "UNAVAILABLE", reason: hasPerformance ? "Equity source is present but pagination contract is not finalized." : "No performance equity source in the current view.", schema: "r_equity_series_v1" }),
    seriesContract({ seriesId: "risk.open_risk", label: "Open risk", unit: "RISK", source: "portfolio_risk_decisions", availability: hasRiskCenter ? "PARTIAL" : "UNAVAILABLE", reason: hasRiskCenter ? "Risk center exists; historical series endpoint remains pending." : "Global Risk center source unavailable.", schema: "risk_utilization_series_v1" }),
  ];
  return {
    schemaVersion: "front_time_series_contracts_v1",
    view,
    asOf: nowIso,
    series: contracts,
    contracts,
  };
}

function seriesContract({ seriesId, label, unit, source, availability, reason = "", schema, cursor = undefined }) {
  return {
    seriesId,
    label,
    schema,
    unit,
    source,
    availability,
    reason,
    sampling: "SERVER_DEFINED",
    maxPoints: 2000,
    cursor: cursor === undefined ? availability === "UNAVAILABLE" ? null : `${seriesId}:cursor` : cursor,
    duplicateHandling: "DEDUP_BY_EVENT_ID_OR_TIMESTAMP",
    outOfOrderHandling: "SERVER_SORTED",
    gapHandling: "RESYNC_REQUIRED",
  };
}

function isFillEvent(item) {
  const state = String(item?.event_type || item?.status || "").toUpperCase();
  return ["FILL", "FILLED", "ORDER_FILLED", "EXECUTION_FILL"].some((token) => state === token || state.endsWith(`.${token}`));
}
