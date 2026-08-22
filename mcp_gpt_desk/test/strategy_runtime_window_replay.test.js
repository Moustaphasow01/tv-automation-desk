import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWindowRuntimeBindings,
  deterministicWindowReplayUuid,
  normalizeWindowReplayInput,
  signalsFromWindowPositions,
  windowReplayCutoffSuffix,
} from "../src/strategy-runtime-window-replay.js";

test("window replay creates cutoff-scoped setup identities", () => {
  const config = normalizeWindowReplayInput({
    run_id: "cert-window-test",
    start_utc: "2026-08-21T09:00:00.000Z",
    end_utc: "2026-08-21T09:15:00.000Z",
    instruments: "MNQ,MES",
  });
  const first = buildWindowRuntimeBindings({
    config,
    baseBindings: { setups: [baseSetup()] },
    cutoff: { timestamp_utc: "2026-08-21T09:05:00.000Z" },
    previousCutoff: { timestamp_utc: "2026-08-21T09:00:00.000Z" },
    cutoffIndex: 0,
  });
  const second = buildWindowRuntimeBindings({
    config,
    baseBindings: { setups: [baseSetup()] },
    cutoff: { timestamp_utc: "2026-08-21T09:10:00.000Z" },
    previousCutoff: { timestamp_utc: "2026-08-21T09:05:00.000Z" },
    cutoffIndex: 1,
  });

  assert.notEqual(first.setup_id, second.setup_id);
  assert.equal(first.rank, 1);
  assert.equal(second.rank, 2);
  assert.equal(first.metadata.window_replay_run_id, "cert-window-test");
  assert.equal(first.metadata.window_replay_cutoff_utc, "2026-08-21T09:05:00.000Z");
  assert.equal(first.metadata.window_replay_previous_cutoff_utc, "2026-08-21T09:00:00.000Z");
  assert.match(first.setup_id, /__w20260821t090500000z$/);
});

test("window replay UUID is deterministic and UUID-shaped", () => {
  const one = deterministicWindowReplayUuid({ run_id: "a", signal: 1 });
  const two = deterministicWindowReplayUuid({ run_id: "a", signal: 1 });
  const other = deterministicWindowReplayUuid({ run_id: "a", signal: 2 });

  assert.equal(one, two);
  assert.notEqual(one, other);
  assert.match(one, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("window replay cutoff suffix is stable", () => {
  assert.equal(windowReplayCutoffSuffix("2026-08-21T09:05:00.000Z"), "20260821t090500000z");
});

test("window replay emits the signal at setup cutoff when a later fill occurs within TTL", () => {
  const config = normalizeWindowReplayInput({
    run_id: "cert-window-fill-after-cutoff",
    start_utc: "2026-08-21T09:00:00.000Z",
    end_utc: "2026-08-21T09:30:00.000Z",
    instruments: "MNQ",
  });
  const setup = baseSetup();
  const signals = signalsFromWindowPositions({
    config,
    definition: strategyDefinition(),
    version: strategyVersion(),
    instance: strategyInstance(),
    simulation: {
      positions: [{
        position_id: "position-fill-after-cutoff",
        setup_id: setup.setup_id,
        instrument: "MNQ",
        direction: "long",
        entry_price: 20100,
        entry_time: "2026-08-21T09:10:00.000Z",
        entry_row: { timestamp_utc: "2026-08-21T09:10:00.000Z" },
        entry_order: { order_type: "LIMIT", limit_price: 20100 },
        stop_loss: 20080,
        take_profit_1: 20140,
        quantity: 1,
      }],
    },
    day: { tradingDate: "2026-08-21" },
    instrument: "MNQ",
    timeframe: "5",
    setupById: new Map([[setup.setup_id, {
      setup,
      cutoff: "2026-08-21T09:05:00.000Z",
      previousCutoff: "2026-08-21T09:00:00.000Z",
      market: { cutoffUtc: "2026-08-21T09:05:00.000Z" },
    }]]),
  });

  assert.equal(signals.length, 1);
  assert.equal(signals[0].generated_at_utc, "2026-08-21T09:05:00.000Z");
  assert.equal(signals[0].expires_at_utc, "2026-08-21T09:35:00.000Z");
  assert.equal(signals[0].signal_quality.temporal_alignment, "PUBLICATION_CUTOFF");
  assert.equal(signals[0].signal_quality.simulated_entry_time_utc, "2026-08-21T09:10:00.000Z");
});

test("window replay does not emit a signal for a fill after the signal TTL", () => {
  const config = normalizeWindowReplayInput({
    run_id: "cert-window-fill-after-ttl",
    start_utc: "2026-08-21T09:00:00.000Z",
    end_utc: "2026-08-21T10:00:00.000Z",
    instruments: "MNQ",
  });
  const setup = baseSetup();
  const signals = signalsFromWindowPositions({
    config,
    definition: strategyDefinition(),
    version: strategyVersion(),
    instance: strategyInstance(),
    simulation: {
      positions: [{
        position_id: "position-after-ttl",
        setup_id: setup.setup_id,
        direction: "long",
        entry_time: "2026-08-21T09:35:00.000Z",
        entry_row: { timestamp_utc: "2026-08-21T09:35:00.000Z" },
        entry_order: { order_type: "LIMIT", limit_price: 20100 },
      }],
    },
    day: { tradingDate: "2026-08-21" },
    instrument: "MNQ",
    timeframe: "5",
    setupById: new Map([[setup.setup_id, {
      setup,
      cutoff: "2026-08-21T09:05:00.000Z",
      previousCutoff: "2026-08-21T09:00:00.000Z",
      market: { cutoffUtc: "2026-08-21T09:05:00.000Z" },
    }]]),
  });

  assert.equal(signals.length, 0);
});

function baseSetup() {
  return {
    setup_id: "runtime_prior_close_reject_short_v001_20260821_d001_instance",
    template_id: "prior_close_reject_short_short",
    instrument: "MNQ",
    direction: "short",
    rank: 1,
    trading_date: "2026-08-21",
    valid_from_paris: "2026-08-21T09:00:00.000+02:00",
    expires_at_paris: "2026-08-21T09:05:00.000+02:00",
    break_level: 15000,
    retest_level: 15000,
    entry_zone: { lower: 14999, upper: 15001 },
    stop_loss: 15020,
    take_profit_1: 14960,
    invalidation_level: 15040,
    tolerance_points: 2,
    max_bars: 12,
    order_type: "LIMIT",
    require_rejection_confirmation: false,
    rr_minimum: 2,
    metadata: { source: "test" },
  };
}

function strategyDefinition() {
  return {
    strategy_definition_id: "strategy-definition-window-test",
    external_key: "window-test",
    name: "Window Test",
  };
}

function strategyVersion() {
  return {
    strategy_version_id: "strategy-version-window-test",
  };
}

function strategyInstance() {
  return {
    strategy_instance_id: "strategy-instance-window-test",
    strategy_version_id: "strategy-version-window-test",
    execution_mode: "SHADOW",
    instrument_scope: ["MNQ"],
  };
}
