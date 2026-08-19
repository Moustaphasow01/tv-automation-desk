import test from "node:test";
import assert from "node:assert/strict";
import { buildDataDrivenLiveRuntimeBindings } from "../src/research/data-driven-live-runtime-bindings.js";

test("data-driven live runtime bindings preserve family-specific previous close anchors", () => {
  const market = marketFixture();
  const result = buildDataDrivenLiveRuntimeBindings({
    version: {
      strategy_version_id: "strategy-version",
      metadata: {
        family_id: "prior_close_reject_short",
        variant_index: 5,
        dsl_source: dslSource(),
      },
    },
    dsl: dslSource(),
    instance: { strategy_instance_id: "instance-001" },
    market,
    instrument: "MNQ",
  });

  assert.equal(result.ok, true);
  const setup = result.runtime_bindings.setups[0];
  assert.equal(setup.metadata.anchor_kind, "PREVIOUS_DAY_CLOSE");
  assert.equal(setup.metadata.anchor_source, "previous_day_close");
  assert.equal(setup.break_level, 15053);
  assert.notEqual(setup.break_level, 15120);
  assert.equal(setup.direction, "short");
  assert.equal(setup.order_type, "MARKET");
});

function dslSource() {
  return {
    schema_version: "strategy_dsl_v1",
    pattern: "BREAKOUT_RETEST",
    metadata: {
      family_id: "prior_close_reject_short",
      generator: "data_driven_mega_research_batch_v1",
      anchor_kind: "PREVIOUS_DAY_CLOSE",
    },
    setup_templates: [{
      rank: 1,
      max_bars: 144,
      risk_pct: 0.25,
      direction: "short",
      timeframe: "M5",
      instrument: "MNQ",
      order_type: "MARKET",
      rr_minimum: 2,
      template_id: "prior_close_reject_short_short",
      tolerance_points: 12,
      require_rejection_confirmation: true,
    }],
  };
}

function marketFixture() {
  const previousRows = [
    row("2026-08-13T09:15:00.000Z", "2026-08-13T11:15:00.000+02:00", "2026-08-13", 15000, 15040, 14980, 15020),
    row("2026-08-13T21:55:00.000Z", "2026-08-13T23:55:00.000+02:00", "2026-08-13", 15020, 15070, 14990, 15050),
  ];
  const todayRows = [
    row("2026-08-14T07:15:00.000Z", "2026-08-14T09:15:00.000+02:00", "2026-08-14", 15060, 15120, 15010, 15090),
    row("2026-08-14T07:20:00.000Z", "2026-08-14T09:20:00.000+02:00", "2026-08-14", 15090, 15110, 15040, 15080),
  ];
  return {
    rows: todayRows,
    contextRows: [...previousRows, ...todayRows],
    cutoffUtc: "2026-08-14T07:20:00.000Z",
    tradingDate: "2026-08-14",
    dataset: {
      dataset_id: "runtime_dataset_test",
      dataset_hash: "sha256:test",
    },
  };
}

function row(timestamp_utc, timestamp_paris, trading_date, open, high, low, close) {
  return {
    instrument: "MNQ",
    symbol: "MNQ1!",
    timeframe: "M5",
    trading_date,
    time: timestamp_paris,
    timestamp_utc,
    timestamp_paris,
    open,
    high,
    low,
    close,
    volume: 1,
    is_closed: true,
  };
}
