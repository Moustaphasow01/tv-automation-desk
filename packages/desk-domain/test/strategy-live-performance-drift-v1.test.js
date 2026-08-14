import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  STRATEGY_LIVE_PERFORMANCE_DRIFT_SCHEMA_VERSION_V1,
  buildStrategyLivePerformanceDriftReportV1,
} from "../index.js";

describe("strategy live performance drift v1", () => {
  it("accepts an observed sample aligned with its baseline", () => {
    const report = buildStrategyLivePerformanceDriftReportV1({
      strategy_instance_id: "inst-paper",
      strategy_version_id: "ver-1",
      execution_mode: "PAPER",
      checked_at_utc: "2026-08-09T10:00:00.000Z",
      baseline_metrics: baselineMetrics(),
      observed_metrics: { ...baselineMetrics(), total_r: 11.2, expectancy_r: 0.38, trade_count: 42 },
    });

    assert.equal(report.schema_version, STRATEGY_LIVE_PERFORMANCE_DRIFT_SCHEMA_VERSION_V1);
    assert.equal(report.status, "OK");
    assert.equal(report.gate.promotion_allowed, true);
    assert.equal(report.comparisons.total_r_delta, -1.3);
    assert.match(report.report_hash, /^sha256:[a-f0-9]{64}$/);
  });

  it("returns watch when performance starts degrading without critical breach", () => {
    const report = buildStrategyLivePerformanceDriftReportV1({
      baseline_metrics: baselineMetrics(),
      observed_metrics: { trade_count: 30, total_r: 9.8, expectancy_r: 0.14, win_rate: 0.46, profit_factor: 1.2, max_drawdown_r: -3.2 },
    });

    assert.equal(report.status, "WATCH");
    assert.equal(report.severity, "warning");
    assert.ok(report.reasons.some((item) => item.code === "EXPECTANCY_DROP"));
    assert.equal(report.gate.halt_recommended, false);
  });

  it("returns drift when drawdown and expectancy breach critical thresholds", () => {
    const report = buildStrategyLivePerformanceDriftReportV1({
      baseline_metrics: baselineMetrics(),
      observed_metrics: { trade_count: 12, total_r: 5, expectancy_r: -0.2, win_rate: 0.22, profit_factor: 0.4, max_drawdown_r: -6 },
    });

    assert.equal(report.status, "DRIFT");
    assert.equal(report.severity, "critical");
    assert.equal(report.gate.halt_recommended, true);
    assert.ok(report.reasons.some((item) => item.code === "DRAWDOWN_WORSENED_CRITICAL"));
  });

  it("does not invent drift when baseline or observed metrics are missing", () => {
    const missingBaseline = buildStrategyLivePerformanceDriftReportV1({ observed_metrics: baselineMetrics() });
    const missingObserved = buildStrategyLivePerformanceDriftReportV1({ baseline_metrics: baselineMetrics() });

    assert.equal(missingBaseline.status, "BASELINE_MISSING");
    assert.equal(missingObserved.status, "INSUFFICIENT_DATA");
    assert.equal(missingObserved.gate.needs_more_observation, true);
  });
});

function baselineMetrics() {
  return {
    trade_count: 45,
    total_r: 12.5,
    expectancy_r: 0.42,
    win_rate: 0.58,
    profit_factor: 2.1,
    max_drawdown_r: -2,
  };
}
