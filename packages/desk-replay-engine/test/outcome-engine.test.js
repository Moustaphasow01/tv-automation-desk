import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertReplayOutcomeWritable,
  buildReplayOutcomeRecord,
  replaySetupOutcome,
} from "../index.js";

const clock = {
  now() {
    return {
      utc: "2026-07-06T08:00:00.000Z",
      paris: "2026-07-06T10:00:00+02:00",
      epochMs: Date.parse("2026-07-06T08:00:00.000Z"),
    };
  },
};

const longSetup = {
  setup_id: "setup_long",
  setup_record_id: "setup_long",
  executable: true,
  direction: "long",
  entry: 100,
  stop_loss: 95,
  take_profits: [{ name: "TP1", target: 110 }],
};

function candle(timestamp, high, low, close = 100, open = 100) {
  return { timestamp_paris: timestamp, open, high, low, close };
}

describe("desk-replay-engine", () => {
  it("resolves stop loss as an immutable SL outcome", () => {
    const replay = replaySetupOutcome({
      setup: longSetup,
      candles: [
        candle("2026-07-06T10:05:00+02:00", 102, 99, 101),
        candle("2026-07-06T10:10:00+02:00", 101, 94, 95),
      ],
      cutoff: "2026-07-06T10:15:00+02:00",
      clock,
    });

    assert.equal(replay.replay_status, "loss");
    assert.equal(replay.outcome_status, "sl_touched");
    assert.equal(replay.r_result, -1);
    assert.equal(replay.finalized, true);
    assert.match(replay.content_hash, /^[a-f0-9]{64}$/);
  });

  it("resolves TP1 and R result through the domain OutcomeReplayer", () => {
    const replay = replaySetupOutcome({
      setup: longSetup,
      candles: [
        candle("2026-07-06T10:05:00+02:00", 102, 99, 101),
        candle("2026-07-06T10:10:00+02:00", 111, 100, 110),
      ],
      cutoff: "2026-07-06T10:15:00+02:00",
      clock,
    });

    assert.equal(replay.replay_status, "win");
    assert.equal(replay.outcome, "tp1_hit");
    assert.equal(replay.outcome_status, "tp_touched");
    assert.equal(replay.r_result, 2);
    assert.equal(replay.evidence.outcome, "TP1");
  });

  it("keeps replaying after TP1 and records the best touched target", () => {
    const replay = replaySetupOutcome({
      setup: {
        ...longSetup,
        take_profits: [
          { name: "TP1", target: 105 },
          { name: "TP2", target: 110 },
          { name: "TP3", target: 115 },
        ],
      },
      candles: [
        candle("2026-07-06T10:05:00+02:00", 106, 99, 105),
        candle("2026-07-06T10:10:00+02:00", 112, 104, 110),
        candle("2026-07-06T10:15:00+02:00", 116, 108, 115),
      ],
      cutoff: "2026-07-06T10:15:00+02:00",
      clock,
    });

    assert.equal(replay.replay_status, "win");
    assert.equal(replay.outcome, "tp3_hit");
    assert.equal(replay.r_result, 3);
    assert.equal(replay.best_target_hit.name, "TP3");
    assert.equal(replay.evidence.targets_hit.length, 3);
  });

  it("prices ranged entries and targets by conservative, middle and optimistic modes", () => {
    const setup = {
      setup_id: "setup_modes",
      setup_record_id: "setup_modes",
      executable: true,
      direction: "long",
      entry_zone: { from: 100, to: 110 },
      stop_loss: 90,
      take_profits: [{ name: "TP1", target: { from: 120, to: 130 } }],
    };
    const candles = [
      candle("2026-07-06T10:05:00+02:00", 111, 99, 105),
      candle("2026-07-06T10:10:00+02:00", 131, 104, 130),
    ];

    const conservative = replaySetupOutcome({ setup, candles, cutoff: "2026-07-06T10:10:00+02:00", meta: { pricing_mode: "conservative" }, clock });
    const middle = replaySetupOutcome({ setup, candles, cutoff: "2026-07-06T10:10:00+02:00", meta: { pricing_mode: "middle" }, clock });
    const optimistic = replaySetupOutcome({ setup, candles, cutoff: "2026-07-06T10:10:00+02:00", meta: { pricing_mode: "optimistic" }, clock });

    assert.equal(conservative.plan.entry_price, 110);
    assert.equal(conservative.best_target_hit.price, 120);
    assert.equal(conservative.r_result, 0.5);
    assert.equal(middle.plan.entry_price, 105);
    assert.equal(middle.best_target_hit.price, 125);
    assert.equal(middle.r_result, 1.33);
    assert.equal(optimistic.plan.entry_price, 100);
    assert.equal(optimistic.best_target_hit.price, 130);
    assert.equal(optimistic.r_result, 3);
  });

  it("requires review for ambiguous same-candle SL and TP", () => {
    const replay = replaySetupOutcome({
      setup: longSetup,
      candles: [candle("2026-07-06T10:05:00+02:00", 111, 94, 100)],
      cutoff: "2026-07-06T10:15:00+02:00",
      clock,
    });

    assert.equal(replay.replay_status, "review_required");
    assert.equal(replay.outcome_status, "ambiguous");
    assert.equal(replay.finalized, false);
    assert.ok(replay.reasons.includes("ambiguous_candle_path"));
  });

  it("records no outcome when entry never fills", () => {
    const replay = replaySetupOutcome({
      setup: longSetup,
      candles: [candle("2026-07-06T10:05:00+02:00", 99, 96, 98)],
      cutoff: "2026-07-06T10:15:00+02:00",
      clock,
    });

    assert.equal(replay.replay_status, "no_fill");
    assert.equal(replay.outcome_status, "no_outcome");
    assert.equal(replay.r_result, 0);
    assert.equal(replay.finalized, true);
  });

  it("keeps MCP short setup compatibility while using the shared engine", () => {
    const replay = replaySetupOutcome({
      setup: {
        setup_id: "setup_short",
        setup_record_id: "setup_short",
        executable: true,
        direction: "short",
        entry_zone: { from: 30140, to: 30170 },
        stop_loss: 30235,
        take_profits: [{ name: "TP1", target: { from: 30020, to: 30050 } }],
      },
      candles: [
        candle("2026-06-25T10:05:00+02:00", 30155, 30120, 30145),
        candle("2026-06-25T10:10:00+02:00", 30145, 30040, 30050),
      ],
      cutoff: "2026-06-25T10:15:00+02:00",
      clock,
    });

    assert.equal(replay.replay_status, "win");
    assert.equal(replay.outcome, "tp1_hit");
    assert.equal(replay.r_result, 0.95);
  });

  it("builds immutable replay_outcome_v2 records and blocks unaudited rewrites", () => {
    const outcome = buildReplayOutcomeRecord({
      outcome_id: "outcome_1",
      simulation_id: "simulation_1",
      step_id: "step_1",
      setup: longSetup,
      candles: [candle("2026-07-06T10:05:00+02:00", 111, 99, 110)],
      cutoff: "2026-07-06T10:15:00+02:00",
      clock,
    });

    assert.equal(outcome.schema_version, "replay_outcome_v2");
    assert.equal(outcome.finalized, true);
    assert.equal(outcome.immutable, true);
    assert.equal(outcome.simulation_id, "simulation_1");
    assert.equal(outcome.step_id, "step_1");
    assert.throws(() => assertReplayOutcomeWritable(outcome), /simulation_outcome_immutable/);

    const corrected = buildReplayOutcomeRecord({
      outcome_id: "outcome_1",
      simulation_id: "simulation_1",
      step_id: "step_1",
      setup: longSetup,
      candles: [candle("2026-07-06T10:05:00+02:00", 111, 99, 110)],
      cutoff: "2026-07-06T10:15:00+02:00",
      existing: outcome,
      correction_audit_id: "audit_correction_1",
      clock,
    });

    assert.equal(corrected.revision, 2);
    assert.equal(corrected.correction_audit_id, "audit_correction_1");
    assert.equal(corrected.correction_of_outcome_id, "outcome_1");
  });

});
