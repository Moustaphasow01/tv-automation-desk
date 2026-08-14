import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SIMULATION_METRIC_DEFINITION_ID_V2,
  SIMULATION_METRIC_VERSION_V2,
  buildVersionedSimulationMetricsV1,
} from "../index.js";

describe("simulation metrics V2", () => {
  it("computes versioned R metrics and deterministic segmentations", () => {
    const metrics = buildVersionedSimulationMetricsV1(positions(), { rows: rows() });

    assert.equal(metrics.metric_definition_id, SIMULATION_METRIC_DEFINITION_ID_V2);
    assert.equal(metrics.metric_version, SIMULATION_METRIC_VERSION_V2);
    assert.equal(metrics.trade_count, 3);
    assert.equal(metrics.open_position_count, 1);
    assert.equal(metrics.total_r, 1.5);
    assert.equal(metrics.gross_r, 1.8);
    assert.equal(metrics.execution_cost_r, 0.3);
    assert.equal(metrics.win_rate, 0.6667);
    assert.equal(metrics.profit_factor, 2.5);
    assert.equal(metrics.expectancy_r, 0.5);
    assert.equal(metrics.max_drawdown_r, -1);
    assert.equal(metrics.mae_r, -0.3333);
    assert.equal(metrics.mfe_r, 1.1667);
    assert.equal(metrics.max_adverse_excursion_r, -0.4);
    assert.equal(metrics.max_favorable_excursion_r, 2.4);
    assert.equal(metrics.segmentations.by_instrument.MNQ.trade_count, 2);
    assert.equal(metrics.segmentations.by_instrument.MNQ.total_r, 1);
    assert.equal(metrics.segmentations.by_direction.long.total_r, 2.5);
    assert.equal(metrics.segmentations.by_exit_reason.STOP_LOSS.total_r, -1);
    assert.equal(metrics.exposure.bars, 5);
  });

  it("returns neutral ratios for empty metric inputs", () => {
    const metrics = buildVersionedSimulationMetricsV1([]);

    assert.equal(metrics.trade_count, 0);
    assert.equal(metrics.total_r, 0);
    assert.equal(metrics.win_rate, 0);
    assert.equal(metrics.profit_factor, 0);
    assert.equal(metrics.expectancy_r, null);
    assert.deepEqual(metrics.segmentations.by_instrument, {});
  });
});

function positions() {
  return [
    {
      position_id: "p1",
      instrument: "MNQ",
      direction: "long",
      status: "CLOSED",
      entry_price: 100,
      entry_time: "2026-06-11T10:01:00+02:00",
      exit_time: "2026-06-11T10:03:00+02:00",
      stop_loss: 95,
      risk_points: 5,
      exit_reason: "TAKE_PROFIT_1",
      gross_r: 2.1,
      execution_cost_r: 0.1,
      r_result: 2,
    },
    {
      position_id: "p2",
      instrument: "MNQ",
      direction: "short",
      status: "CLOSED",
      entry_price: 110,
      entry_time: "2026-06-11T10:04:00+02:00",
      exit_time: "2026-06-11T10:05:00+02:00",
      risk_points: 5,
      exit_reason: "STOP_LOSS",
      gross_r: -0.9,
      execution_cost_r: 0.1,
      r_result: -1,
      mae_r: -0.3,
      mfe_r: 0.4,
    },
    {
      position_id: "p3",
      instrument: "MES",
      direction: "long",
      status: "CLOSED",
      entry_price: 5000,
      entry_time: "2026-06-11T14:00:00+02:00",
      exit_time: "2026-06-11T14:15:00+02:00",
      risk_points: 10,
      exit_reason: "TAKE_PROFIT_1",
      gross_r: 0.6,
      execution_cost_r: 0.1,
      r_result: 0.5,
      mae_r: -0.3,
      mfe_r: 0.7,
    },
    { position_id: "p4", instrument: "MNQ", direction: "long", status: "OPEN", entry_time: "2026-06-11T15:00:00+02:00" },
  ];
}

function rows() {
  return [
    { instrument: "MNQ", time: "2026-06-11T10:01:00+02:00", high: 101, low: 99 },
    { instrument: "MNQ", time: "2026-06-11T10:02:00+02:00", high: 108, low: 98 },
    { instrument: "MNQ", time: "2026-06-11T10:03:00+02:00", high: 112, low: 100 },
    { instrument: "MNQ", time: "2026-06-11T10:04:00+02:00", high: 111, low: 108 },
    { instrument: "MNQ", time: "2026-06-11T10:05:00+02:00", high: 112, low: 109 },
  ];
}
