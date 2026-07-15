import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReplayContinuityState,
  buildReplayEventCheckpoints,
  buildReplayPositionFromTriggeredSetup,
  buildReplaySetupDocsFromMonitor,
  evaluateReplayPositionOnRows,
  evaluateReplaySetupConditions,
  evaluateReplaySetupOnRows,
  normalizeReplayConditionImportance,
  normalizeReplaySetupStatus,
  projectReplayActiveThesis,
  recommendReplayCadenceMinutes,
} from "../src/replay-continuity.js";

const tick = {
  utc: "2026-07-14T13:00:00+00:00",
  paris: "2026-07-14T15:00:00+02:00",
  epochMs: Date.parse("2026-07-14T13:00:00.000Z"),
};

const run = {
  backtest_id: "replay_day",
  replay_run_id: "replay_day",
  strategy_id: "ny_open_1530",
  trading_date: "2026-07-14",
  date: "2026-07-14",
  session: "ny_open",
  pack_id: "pack",
  pack_build_id: "packbuild",
  current_replay_time: "2026-07-14T15:00:00+02:00",
  end_time: "2026-07-14T20:00:00+02:00",
};

const step = {
  step_id: "replay_day__step__0018__monitor__2026_07_14T15_00_00_000_02_00",
  timestamp_paris: "2026-07-14T15:00:00+02:00",
};

test("replay continuity normalizes setup statuses and condition importance", () => {
  assert.equal(normalizeReplaySetupStatus("arm_setup"), "ARMED_CONDITIONAL");
  assert.equal(normalizeReplaySetupStatus("pre-armed"), "PRE_ARMED");
  assert.equal(normalizeReplayConditionImportance("essential"), "MANDATORY");
  assert.equal(normalizeReplayConditionImportance("nice_to_have"), "OPTIONAL");
});

test("replay condition evaluation allows optional misses but blocks mandatory failures", () => {
  const summary = evaluateReplaySetupConditions([
    { label: "NQ > pivot", importance: "MANDATORY", status: "PASSED" },
    { label: "ES confirms", importance: "PRIMARY", status: "PASSED" },
    { label: "VIX improves", importance: "OPTIONAL", status: "PENDING" },
  ], { min_score: 0.6 });
  assert.equal(summary.triggerable, true);

  const blocked = evaluateReplaySetupConditions([
    { label: "NQ > pivot", importance: "MANDATORY", status: "FAILED" },
    { label: "ES confirms", importance: "PRIMARY", status: "PASSED" },
  ]);
  assert.equal(blocked.triggerable, false);
  assert.equal(blocked.reason, "MANDATORY_FAILED");
});

test("latest replay monitor health score projects over stale active thesis", () => {
  const projected = projectReplayActiveThesis(
    { thesis_id: "thesis_1", health_score: 54 },
    [
      { monitor_id: "monitor_15", step_id: "step_15", thesis_health_score: { score: 72 }, saved_at_utc: tick.utc },
      { monitor_id: "monitor_14", thesis_health_score: 35 },
    ],
  );
  assert.equal(projected.health_score, 72);
  assert.equal(projected.health_score_projection.source, "latest_replay_monitor");
});

test("monitor setup transition materializes a classified replay setup", () => {
  const docs = buildReplaySetupDocsFromMonitor({
    monitor: {
      monitor_id: "monitor_15",
      master_id: "master_14",
      thesis_id: "thesis_1",
      monitor_decision: { action: "ARM_SETUP", instrument: "MNQ", direction: "long" },
      armed_setup: {
        setup_id: "post_cpi_long",
        status: "ARMED_CONDITIONAL",
        instrument: "MNQ",
        direction: "long",
        entry_price: 29780,
        stop_loss: 29720,
        take_profit_1: 29920,
        conditions: [
          { label: "MNQ close above trigger", importance: "MANDATORY", operator: "CLOSE_ABOVE", threshold: 29770 },
          { label: "MES confirms", importance: "SECONDARY", status: "PASSED" },
        ],
      },
    },
    run,
    step,
    existingSetups: [],
    tick,
    makeSetupId: (value) => `replay_day__setup__${value}`,
  });
  assert.equal(docs.length, 1);
  assert.equal(docs[0].status, "ARMED_CONDITIONAL");
  assert.equal(docs[0].conditions[0].importance, "MANDATORY");
  assert.equal(docs[0].backend_can_trigger, true);
});

test("monitor setup trigger policy never persists undefined min_score", () => {
  const docs = buildReplaySetupDocsFromMonitor({
    monitor: {
      monitor_id: "monitor_15",
      master_id: "master_14",
      thesis_id: "thesis_1",
      monitor_decision: { action: "ARM_SETUP", instrument: "MNQ", direction: "long" },
      setup_candidate: {
        setup_id: "missing_min_score",
        status: "PRE_ARMED",
        trigger_policy: { backend_can_trigger: true },
        conditions: [
          { label: "MNQ close above trigger", importance: "MANDATORY", operator: "CLOSE_ABOVE", threshold: 29770 },
        ],
      },
    },
    run,
    step,
    existingSetups: [],
    tick,
    makeSetupId: (value) => `replay_day__setup__${value}`,
  });
  assert.equal(docs.length, 1);
  assert.equal(docs[0].trigger_policy.min_score, 0.65);
  assertNoUndefined(docs[0]);
});

function assertNoUndefined(value, path = "value") {
  assert.notEqual(value, undefined, `${path} must not be undefined`);
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoUndefined(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    assertNoUndefined(child, `${path}.${key}`);
  }
}

test("backend interval evaluation can trigger an armed conditional setup", () => {
  const setup = {
    setup_record_id: "setup_record",
    setup_id: "post_cpi_long",
    status: "ARMED_CONDITIONAL",
    instrument: "MNQ",
    direction: "long",
    entry_price: 29780,
    stop_loss: 29720,
    take_profit_1: 29920,
    conditions: [
      { label: "close above", importance: "MANDATORY", operator: "CLOSE_ABOVE", threshold: 29770 },
      { label: "optional VIX", importance: "OPTIONAL", status: "PENDING" },
    ],
    trigger_policy: { min_score: 0.65 },
  };
  const evaluation = evaluateReplaySetupOnRows(setup, [
    { timestamp_paris: "2026-07-14T15:05:00+02:00", open: 29760, high: 29786, low: 29755, close: 29782 },
  ], { tick });
  assert.equal(evaluation.triggered, true);
  assert.equal(evaluation.setup.status, "TRIGGERED");

  const position = buildReplayPositionFromTriggeredSetup({
    setup: evaluation.setup,
    run,
    step,
    monitor: { monitor_id: "monitor_15" },
    trigger: evaluation,
    tick,
    makePositionId: (value) => `replay_day__position__${value}`,
  });
  assert.equal(position.status, "OPEN");
  assert.equal(position.entry_price, 29780);
});

test("position interval evaluation closes on TP or stop without future rows", () => {
  const longPosition = {
    position_id: "position_1",
    status: "OPEN",
    direction: "long",
    entry_price: 29780,
    stop_loss: 29720,
    take_profit_1: 29920,
  };
  const result = evaluateReplayPositionOnRows(longPosition, [
    { timestamp_paris: "2026-07-14T15:10:00+02:00", high: 29925, low: 29770, close: 29910 },
  ], { tick });
  assert.equal(result.changed, true);
  assert.equal(result.position.status, "CLOSED");
  assert.equal(result.position.exit_reason, "TAKE_PROFIT_1_HIT");
});

test("continuity exposes active setup, protected position, cadence and checkpoints", () => {
  const activeThesis = {
    thesis_id: "thesis_1",
    status: "WAIT_MONITORED",
    health_score: 60,
    mandatory_replans: [{ checkpoint_paris: "2026-07-14T15:45:00+02:00", reason: "Fed risk" }],
  };
  const setup = { setup_record_id: "setup_1", status: "ARMED_CONDITIONAL", priority: 1, instrument: "MNQ" };
  const position = { position_id: "pos_1", status: "PROTECTED" };
  const continuity = buildReplayContinuityState({
    run,
    currentStep: step,
    activeThesis,
    setups: [setup],
    positions: [position],
    monitors: [{ monitor_id: "monitor_15", monitor_decision: { action: "WAIT_MORE" } }],
  });
  assert.equal(continuity.setup_status, "ARMED_CONDITIONAL");
  assert.equal(continuity.position_status, "PROTECTED");

  const cadence = recommendReplayCadenceMinutes({ run, activeThesis, setups: [setup], positions: [] });
  assert.equal(cadence.recommended_minutes, 15);

  const checkpoints = buildReplayEventCheckpoints({ activeThesis, latestMonitor: null, run });
  assert.equal(checkpoints[0].checkpoint_paris, "2026-07-14T15:45:00+02:00");
});
