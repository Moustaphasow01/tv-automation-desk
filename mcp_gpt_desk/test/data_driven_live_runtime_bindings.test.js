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

test("data-driven live runtime bindings support diversified v2 family catalog", () => {
  const market = marketFixture();
  const result = buildDataDrivenLiveRuntimeBindings({
    version: {
      strategy_version_id: "strategy-version-v2",
      metadata: {
        family_set: "diversified_v2",
        family_id: "previous_day_high_reject_short",
        family_index: 21,
        variant_index: 3,
        dsl_source: diversifiedDslSource(),
      },
    },
    dsl: diversifiedDslSource(),
    instance: { strategy_instance_id: "instance-v2-001" },
    market,
    instrument: "MNQ",
  });

  assert.equal(result.ok, true);
  assert.equal(result.descriptor.family_set, "diversified_v2");
  const setup = result.runtime_bindings.setups[0];
  assert.equal(setup.metadata.anchor_kind, "PREVIOUS_DAY_HIGH");
  assert.equal(setup.metadata.anchor_source, "previous_day_high");
  assert.equal(setup.break_level, 15067);
  assert.equal(setup.direction, "short");
});

test("data-driven live runtime bindings support diversified v3 orthogonal family catalog", () => {
  const market = marketFixture();
  const result = buildDataDrivenLiveRuntimeBindings({
    version: {
      strategy_version_id: "strategy-version-v3",
      metadata: {
        family_set: "diversified_v3",
        family_id: "previous_body_high_reclaim_long",
        family_index: 51,
        variant_index: 4,
        dsl_source: diversifiedV3DslSource(),
      },
    },
    dsl: diversifiedV3DslSource(),
    instance: { strategy_instance_id: "instance-v3-001" },
    market,
    instrument: "MNQ",
  });

  assert.equal(result.ok, true);
  assert.equal(result.descriptor.family_set, "diversified_v3");
  const setup = result.runtime_bindings.setups[0];
  assert.equal(setup.metadata.anchor_kind, "PREVIOUS_DAY_BODY_HIGH");
  assert.equal(setup.metadata.anchor_source, "previous_day_body_high");
  assert.equal(setup.break_level, 15056);
  assert.equal(setup.direction, "long");
});

test("data-driven live runtime bindings support diversified v4 intraday/volatility family catalog", () => {
  const market = marketFixture();
  const result = buildDataDrivenLiveRuntimeBindings({
    version: {
      strategy_version_id: "strategy-version-v4",
      metadata: {
        family_set: "diversified_v4",
        family_id: "previous_atr_upper_reject_short",
        family_index: 84,
        variant_index: 2,
        dsl_source: diversifiedV4DslSource(),
      },
    },
    dsl: diversifiedV4DslSource(),
    instance: { strategy_instance_id: "instance-v4-001" },
    market,
    instrument: "MNQ",
  });

  assert.equal(result.ok, true);
  assert.equal(result.descriptor.family_set, "diversified_v4");
  const setup = result.runtime_bindings.setups[0];
  assert.equal(setup.metadata.anchor_kind, "PREVIOUS_ATR_UPPER");
  assert.equal(setup.metadata.anchor_source, "previous_atr_upper");
  assert.equal(setup.direction, "short");
  assert.ok(setup.break_level > 15050);
});

test("data-driven live runtime bindings anchor live levels on the previous closed cutoff", () => {
  const market = antiLookaheadMarketFixture();
  const result = buildDataDrivenLiveRuntimeBindings({
    version: {
      strategy_version_id: "strategy-version-anti-lookahead",
      metadata: {
        family_id: "opening_range_breakout_long",
        family_index: 1,
        variant_index: 1,
        dsl_source: antiLookaheadDslSource(),
      },
    },
    dsl: antiLookaheadDslSource(),
    instance: { strategy_instance_id: "instance-anti-lookahead" },
    market,
    instrument: "MNQ",
    previousEvaluation: {
      status: "NO_SIGNAL",
      source_data_cutoff_utc: "2026-08-14T07:15:00.000Z",
      payload: { availability: "KNOWN" },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.anchor.anchor_cutoff_utc, "2026-08-14T07:15:00.000Z");
  const setup = result.runtime_bindings.setups[0];
  assert.equal(setup.valid_from_paris, "2026-08-14T09:20:00.000+02:00");
  assert.equal(setup.expires_at_paris, "2026-08-14T09:50:00.000+02:00");
  assert.equal(setup.metadata.anti_lookahead, "ANCHOR_PREVIOUS_CLOSED_CUTOFF");
  assert.equal(setup.metadata.validity_policy, "PUBLICATION_CUTOFF_PLUS_30M");
  assert.equal(result.runtime_bindings.metadata.rows_at_anchor, 1);
  assert.equal(result.runtime_bindings.metadata.rows_at_evaluation, 2);
  assert.ok(setup.break_level < 200, "latest 09:20 spike must not repaint the 09:15 live anchor");
});

test("data-driven live runtime bindings reject stale previous evaluation anchors", () => {
  const market = antiLookaheadMarketFixture();
  const result = buildDataDrivenLiveRuntimeBindings({
    version: {
      strategy_version_id: "strategy-version-stale-anchor",
      metadata: {
        family_id: "opening_range_breakout_long",
        family_index: 1,
        variant_index: 1,
        dsl_source: antiLookaheadDslSource(),
      },
    },
    dsl: antiLookaheadDslSource(),
    instance: { strategy_instance_id: "instance-stale-anchor" },
    market,
    instrument: "MNQ",
    previousEvaluation: {
      status: "NO_SIGNAL",
      source_data_cutoff_utc: "2026-08-14T06:00:00.000Z",
      payload: { availability: "KNOWN" },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.anchor.source, "previous_closed_row");
  assert.equal(result.anchor.anchor_cutoff_utc, "2026-08-14T07:15:00.000Z");
  assert.equal(result.runtime_bindings.setups[0].valid_from_paris, "2026-08-14T09:20:00.000+02:00");
  assert.equal(result.runtime_bindings.setups[0].expires_at_paris, "2026-08-14T09:50:00.000+02:00");
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

function diversifiedDslSource() {
  return {
    schema_version: "strategy_dsl_v1",
    pattern: "BREAKOUT_RETEST",
    metadata: {
      family_set: "diversified_v2",
      family_id: "previous_day_high_reject_short",
      family_index: 21,
      variant_index: 3,
      generator: "data_driven_mega_research_batch_v1",
      anchor_kind: "PREVIOUS_DAY_HIGH",
    },
    setup_templates: [{
      rank: 1,
      max_bars: 36,
      risk_pct: 0.25,
      direction: "short",
      timeframe: "M5",
      instrument: "MNQ",
      order_type: "LIMIT",
      rr_minimum: 2,
      template_id: "previous_day_high_reject_short_short",
      tolerance_points: 4,
      require_rejection_confirmation: false,
    }],
  };
}

function diversifiedV3DslSource() {
  return {
    schema_version: "strategy_dsl_v1",
    pattern: "BREAKOUT_RETEST",
    metadata: {
      family_set: "diversified_v3",
      family_id: "previous_body_high_reclaim_long",
      family_index: 51,
      variant_index: 4,
      generator: "data_driven_mega_research_batch_v1",
      anchor_kind: "PREVIOUS_DAY_BODY_HIGH",
    },
    setup_templates: [{
      rank: 1,
      max_bars: 24,
      risk_pct: 0.25,
      direction: "long",
      timeframe: "M5",
      instrument: "MNQ",
      order_type: "LIMIT",
      rr_minimum: 2,
      template_id: "previous_body_high_reclaim_long_long",
      tolerance_points: 3,
      require_rejection_confirmation: true,
    }],
  };
}

function diversifiedV4DslSource() {
  return {
    schema_version: "strategy_dsl_v1",
    pattern: "BREAKOUT_RETEST",
    metadata: {
      family_set: "diversified_v4",
      family_id: "previous_atr_upper_reject_short",
      family_index: 84,
      variant_index: 2,
      generator: "data_driven_mega_research_batch_v1",
      anchor_kind: "PREVIOUS_ATR_UPPER",
    },
    setup_templates: [{
      rank: 1,
      max_bars: 48,
      risk_pct: 0.25,
      direction: "short",
      timeframe: "M5",
      instrument: "MNQ",
      order_type: "LIMIT",
      rr_minimum: 2,
      template_id: "previous_atr_upper_reject_short_short",
      tolerance_points: 5,
      require_rejection_confirmation: true,
    }],
  };
}

function antiLookaheadDslSource() {
  return {
    schema_version: "strategy_dsl_v1",
    pattern: "BREAKOUT_RETEST",
    metadata: {
      family_id: "opening_range_breakout_long",
      family_index: 1,
      variant_index: 1,
      generator: "data_driven_mega_research_batch_v1",
      anchor_kind: "OPENING_RANGE_HIGH",
    },
    setup_templates: [{
      rank: 1,
      max_bars: 24,
      risk_pct: 0.25,
      direction: "long",
      timeframe: "M5",
      instrument: "MNQ",
      order_type: "LIMIT",
      rr_minimum: 2,
      template_id: "opening_range_breakout_long_long",
      tolerance_points: 3,
      require_rejection_confirmation: false,
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

function antiLookaheadMarketFixture() {
  const todayRows = [
    row("2026-08-14T07:15:00.000Z", "2026-08-14T09:15:00.000+02:00", "2026-08-14", 100, 100, 90, 95),
    row("2026-08-14T07:20:00.000Z", "2026-08-14T09:20:00.000+02:00", "2026-08-14", 95, 1000, 90, 950),
  ];
  return {
    rows: todayRows,
    contextRows: todayRows,
    cutoffUtc: "2026-08-14T07:20:00.000Z",
    tradingDate: "2026-08-14",
    dataset: {
      dataset_id: "runtime_dataset_anti_lookahead",
      dataset_hash: "sha256:anti-lookahead",
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
