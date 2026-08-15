import { currentUtc, hasFillId, hasSignalId, rows } from "./front-control-plane-projection-helpers.js";

export function frontTimeSeriesContracts({ view, execution = {}, strategy = {}, risk = {}, nowIso = currentUtc() }) {
  const hasSignals = rows(strategy?.signals).some(hasSignalId);
  const hasOrderIntents = rows(execution?.portfolioOrderIntents).length > 0;
  const hasFills = rows(execution?.fills).some(hasFillId);
  const hasPerformance = Boolean(risk?.performance?.equity_curve || execution?.performance?.equity_curve);
  const hasRiskCenter = risk?.risk_center?.availability === "KNOWN";
  const contracts = [
    seriesContract({ seriesId: "market.ohlcv", label: "OHLCV marché", unit: "price", source: "market_candles", availability: "UNAVAILABLE", reason: "No paged OHLCV BFF series is exposed in this view yet.", schema: "ohlcv_series_v1" }),
    seriesContract({ seriesId: "market.vwap", label: "VWAP déterministe", unit: "price", source: "market_features", availability: "UNAVAILABLE", reason: "VWAP feature source is not paged through this BFF projection yet.", schema: "feature_series_v1" }),
    seriesContract({ seriesId: "trading.signal_markers", label: "Signal markers", unit: "event", source: "strategy_signal_outbox", availability: hasSignals ? "KNOWN" : "UNAVAILABLE", reason: hasSignals ? "" : "No StrategySignal rows in the current source window.", schema: "signal_marker_series_v1" }),
    seriesContract({ seriesId: "trading.order_intent_overlays", label: "OrderIntent overlays", unit: "price", source: "portfolio_order_intent_lineage", availability: hasOrderIntents ? "KNOWN" : "UNAVAILABLE", reason: hasOrderIntents ? "" : "No post-risk OrderIntent rows in the current source window.", schema: "order_intent_overlay_series_v1" }),
    seriesContract({ seriesId: "trading.broker_fills", label: "Broker fills", unit: "fill", source: "broker_provider_events", availability: hasFills ? "KNOWN" : "UNAVAILABLE", reason: hasFills ? "" : "No explicit fill events in the current source window.", schema: "broker_fill_series_v1" }),
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

function seriesContract({ seriesId, label, unit, source, availability, reason = "", schema }) {
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
    cursor: availability === "UNAVAILABLE" ? null : `${seriesId}:cursor`,
    duplicateHandling: "DEDUP_BY_EVENT_ID_OR_TIMESTAMP",
    outOfOrderHandling: "SERVER_SORTED",
    gapHandling: "RESYNC_REQUIRED",
  };
}
