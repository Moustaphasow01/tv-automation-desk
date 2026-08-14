import { createHash } from "node:crypto";

export const STRATEGY_LIVE_PERFORMANCE_DRIFT_SCHEMA_VERSION_V1 = "strategy_live_performance_drift_v1";
export const STRATEGY_LIVE_PERFORMANCE_DRIFT_STATUSES = Object.freeze({
  OK: "OK",
  WATCH: "WATCH",
  DRIFT: "DRIFT",
  BASELINE_MISSING: "BASELINE_MISSING",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA",
});
export const DEFAULT_STRATEGY_PERFORMANCE_DRIFT_POLICY_V1 = Object.freeze({
  min_observed_trades: 10,
  warn_total_r_drop: 2,
  critical_total_r_drop: 4,
  warn_expectancy_drop_r: 0.25,
  critical_expectancy_drop_r: 0.5,
  warn_win_rate_drop: 0.15,
  critical_win_rate_drop: 0.25,
  warn_profit_factor_ratio: 0.65,
  critical_profit_factor_ratio: 0.4,
  warn_drawdown_worsening_r: 1.5,
  critical_drawdown_worsening_r: 3,
  warn_trade_count_ratio: 0.5,
  critical_trade_count_ratio: 0.25,
});

export function buildStrategyLivePerformanceDriftReportV1(input = {}) {
  const policy = normalizePolicy(input.policy || input.drift_policy);
  const baseline = normalizeMetrics(input.baseline_metrics || input.baselineMetrics || input.baseline);
  const observed = normalizeMetrics(input.observed_metrics || input.observedMetrics || input.observed);
  const base = reportBase(input, policy, baseline, observed);
  if (!baseline.available) return finalizeReport(base, "BASELINE_MISSING", [reason("BASELINE_METRICS_MISSING", "critical", "No baseline metrics are attached to this Strategy Version or Instance.")]);
  if (!observed.available) return finalizeReport(base, "INSUFFICIENT_DATA", [reason("OBSERVED_METRICS_MISSING", "warning", "No observed live/paper/shadow metrics are attached to this Strategy Instance.")]);
  const reasons = [
    ...sampleReasons(baseline, observed, policy),
    ...metricReasons(baseline, observed, policy),
  ];
  return finalizeReport(base, reportStatus(reasons), reasons);
}

function reportBase(input, policy, baseline, observed) {
  const comparisons = compareMetrics(baseline, observed);
  return {
    schema_version: STRATEGY_LIVE_PERFORMANCE_DRIFT_SCHEMA_VERSION_V1,
    strategy_instance_id: text(input.strategy_instance_id || input.strategyInstanceId),
    strategy_version_id: text(input.strategy_version_id || input.strategyVersionId),
    execution_mode: upper(input.execution_mode || input.executionMode || "UNKNOWN"),
    checked_at_utc: iso(input.checked_at_utc || input.checkedAtUtc || new Date().toISOString()),
    policy,
    baseline: baseline.metrics,
    observed: observed.metrics,
    comparisons,
    source: input.source || {},
  };
}

function finalizeReport(base, status, reasons) {
  const severity = reasons.some((item) => item.severity === "critical") ? "critical" : reasons.some((item) => item.severity === "warning") ? "warning" : "info";
  const report = {
    ...base,
    status,
    severity: status === "OK" ? "none" : severity,
    reasons,
    gate: {
      halt_recommended: status === "DRIFT",
      promotion_allowed: status === "OK",
      needs_more_observation: status === "INSUFFICIENT_DATA",
    },
  };
  return { ...report, report_hash: sha256(stableJson({ ...report, report_hash: undefined })) };
}

function sampleReasons(baseline, observed, policy) {
  const observedTrades = observed.metrics.trade_count ?? 0;
  const baselineTrades = baseline.metrics.trade_count ?? 0;
  const reasons = [];
  if (observedTrades < policy.min_observed_trades) reasons.push(reason("OBSERVED_SAMPLE_BELOW_MIN_TRADES", "info", "Observed sample is too small to certify drift.", { observed: observedTrades, minimum: policy.min_observed_trades }));
  if (baselineTrades > 0 && observedTrades / baselineTrades <= policy.critical_trade_count_ratio) reasons.push(reason("TRADE_FREQUENCY_COLLAPSED_CRITICAL", "critical", "Observed trade frequency collapsed versus baseline.", { ratio: ratio(observedTrades, baselineTrades) }));
  else if (baselineTrades > 0 && observedTrades / baselineTrades <= policy.warn_trade_count_ratio) reasons.push(reason("TRADE_FREQUENCY_COLLAPSED", "warning", "Observed trade frequency is materially below baseline.", { ratio: ratio(observedTrades, baselineTrades) }));
  return reasons;
}

function metricReasons(baseline, observed, policy) {
  return [
    thresholdReason("TOTAL_R_DROP", metricDrop(baseline, observed, "total_r"), policy.warn_total_r_drop, policy.critical_total_r_drop, "Total R dropped versus baseline."),
    thresholdReason("EXPECTANCY_DROP", metricDrop(baseline, observed, "expectancy_r"), policy.warn_expectancy_drop_r, policy.critical_expectancy_drop_r, "Expectancy R dropped versus baseline."),
    thresholdReason("WIN_RATE_DROP", metricDrop(baseline, observed, "win_rate"), policy.warn_win_rate_drop, policy.critical_win_rate_drop, "Win rate dropped versus baseline."),
    ratioReason("PROFIT_FACTOR_DROP", baseline.metrics.profit_factor, observed.metrics.profit_factor, policy.warn_profit_factor_ratio, policy.critical_profit_factor_ratio),
    thresholdReason("DRAWDOWN_WORSENED", drawdownWorsening(baseline, observed), policy.warn_drawdown_worsening_r, policy.critical_drawdown_worsening_r, "Max drawdown worsened versus baseline."),
  ].filter(Boolean);
}

function thresholdReason(code, value, warn, critical, message) {
  if (value === null || value <= 0) return null;
  if (value >= critical) return reason(`${code}_CRITICAL`, "critical", message, { value, threshold: critical });
  if (value >= warn) return reason(code, "warning", message, { value, threshold: warn });
  return null;
}

function ratioReason(code, baseline, observed, warnRatio, criticalRatio) {
  if (baseline === null || baseline <= 0 || observed === null) return null;
  const value = ratio(observed, baseline);
  if (value <= criticalRatio) return reason(`${code}_CRITICAL`, "critical", "Profit factor ratio is critically below baseline.", { value, threshold: criticalRatio });
  if (value <= warnRatio) return reason(code, "warning", "Profit factor ratio is below baseline.", { value, threshold: warnRatio });
  return null;
}

function compareMetrics(baseline, observed) {
  const b = baseline.metrics;
  const o = observed.metrics;
  return {
    total_r_delta: delta(o.total_r, b.total_r),
    expectancy_r_delta: delta(o.expectancy_r, b.expectancy_r),
    win_rate_delta: delta(o.win_rate, b.win_rate),
    profit_factor_ratio: ratio(o.profit_factor, b.profit_factor),
    trade_count_ratio: ratio(o.trade_count, b.trade_count),
    drawdown_worsening_r: drawdownWorsening(baseline, observed),
  };
}

function normalizeMetrics(metrics = {}) {
  const source = record(metrics);
  const normalized = {
    trade_count: metricNumber(source.trade_count ?? source.trades),
    total_r: metricNumber(source.total_r ?? source.totalR),
    expectancy_r: metricNumber(source.expectancy_r ?? source.expectancyR),
    win_rate: normalizeWinRate(source.win_rate ?? source.winRate),
    profit_factor: metricNumber(source.profit_factor ?? source.profitFactor),
    max_drawdown_r: metricNumber(source.max_drawdown_r ?? source.maxDrawdownR),
  };
  return { available: Object.values(normalized).some((value) => value !== null), metrics: normalized };
}

function normalizePolicy(policy = {}) {
  const source = record(policy);
  return Object.fromEntries(Object.entries(DEFAULT_STRATEGY_PERFORMANCE_DRIFT_POLICY_V1).map(([key, fallback]) => [key, positive(source[key], fallback)]));
}

function reportStatus(reasons) {
  if (reasons.some((item) => item.severity === "critical")) return "DRIFT";
  if (reasons.some((item) => item.severity === "warning")) return "WATCH";
  if (reasons.some((item) => item.code === "OBSERVED_SAMPLE_BELOW_MIN_TRADES")) return "INSUFFICIENT_DATA";
  return "OK";
}

function metricDrop(baseline, observed, key) {
  const b = baseline.metrics[key];
  const o = observed.metrics[key];
  return b === null || o === null ? null : round(b - o);
}

function drawdownWorsening(baseline, observed) {
  const b = baseline.metrics.max_drawdown_r;
  const o = observed.metrics.max_drawdown_r;
  return b === null || o === null ? null : round(Math.abs(o) - Math.abs(b));
}

function delta(left, right) { return left === null || right === null ? null : round(left - right); }
function ratio(left, right) { return left === null || right === null || right === 0 ? null : round(left / right); }
function reason(code, severity, message, evidence = {}) { return { code, severity, message, evidence }; }
function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function metricNumber(value) { const parsed = Number(value); return Number.isFinite(parsed) ? round(parsed) : null; }
function normalizeWinRate(value) { const parsed = metricNumber(value); return parsed === null ? null : parsed > 1 ? round(parsed / 100) : parsed; }
function positive(value, fallback) { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback; }
function text(value) { return value === null || value === undefined ? null : String(value); }
function upper(value) { return String(value || "").toUpperCase(); }
function iso(value) { const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null; }
function round(value) { return Math.round(Number(value || 0) * 10000) / 10000; }
function sha256(value) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
