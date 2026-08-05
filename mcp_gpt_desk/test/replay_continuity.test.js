import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReplayContinuityState,
  buildReplayEventCheckpoints,
  buildReplayPositionFromTriggeredSetup,
  buildReplaySetupDocsFromMonitor,
  buildReplaySetupMutationDocsFromMonitor,
  evaluateReplayPositionOnRows,
  evaluateReplaySetupConditions,
  evaluateReplaySetupOnRows,
  selectOpenReplayPosition,
  normalizeReplayConditionImportance,
  normalizeReplaySetupStatus,
  projectReplayActiveThesis,
  recommendReplayCadenceMinutes,
  selectActiveReplaySetups,
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

function conditionEngineNextBarSetup(overrides = {}) {
  return {
    setup_record_id: "setup_structural_confirmation",
    setup_id: "setup_structural_confirmation",
    status: "ARMED_CONDITIONAL",
    backend_can_trigger: true,
    condition_engine_version: "1.2.0",
    execution_policy_version: "4.2.0",
    instrument: "MNQ",
    direction: "long",
    entry_mode: "NEXT_BAR_MARKET_AFTER_CONFIRMATION",
    order_type: "MARKET",
    entry_price: 106,
    stop_loss: 104,
    take_profit_1: 110,
    risk_pct: 0.25,
    valid_from_paris: "2026-07-14T15:00:00+02:00",
    expires_at_paris: "2026-07-14T16:00:00+02:00",
    conditions: [{
      condition_id: "mandatory_close_above",
      predicate_type: "PRICE_RELATION",
      importance: "MANDATORY",
      role: "ACTIVATION",
      effect: "REQUIRE_TRUE",
      instrument: "MNQ",
      timeframe: "M5",
      operator: "CLOSE_ABOVE",
      threshold: 105,
      required_for_trigger: true,
      memory_policy: "LATCH_UNTIL_TRIGGER",
    }],
    trigger_policy: { min_score: 0.55 },
    ...overrides,
  };
}

test("replay continuity normalizes setup statuses and condition importance", () => {
  assert.equal(normalizeReplaySetupStatus("arm_setup"), "ARMED_CONDITIONAL");
  assert.equal(normalizeReplaySetupStatus("pre-armed"), "PRE_ARMED");
  assert.equal(normalizeReplayConditionImportance("essential"), "MANDATORY");
  assert.equal(normalizeReplayConditionImportance("important"), "PRIMARY");
  assert.equal(normalizeReplayConditionImportance("nice_to_have"), "OPTIONAL");
  assert.equal(normalizeReplayConditionImportance("bonus"), "OPTIONAL");
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

test("legacy percentage trigger scores are normalized to the canonical 0..1 scale", () => {
  const summary = evaluateReplaySetupConditions([
    { importance: "MANDATORY", status: "PASSED", weight: 7 },
    { importance: "PRIMARY", status: "PENDING", weight: 3 },
  ], { min_score: 70 });

  assert.equal(summary.min_score, 0.7);
  assert.equal(summary.score, 0.7);
  assert.equal(summary.triggerable, true);
});

test("an observed hard blocker terminally invalidates an armed setup", () => {
  const localTick = {
    utc: "2026-07-14T13:15:00.000Z",
    paris: "2026-07-14T15:15:00+02:00",
  };
  const evaluation = evaluateReplaySetupOnRows({
    setup_record_id: "setup_blocked",
    setup_id: "setup_blocked",
    status: "ARMED_CONDITIONAL",
    backend_can_trigger: true,
    instrument: "MNQ",
    direction: "short",
    entry_mode: "RETEST_ZONE_AFTER_CONFIRMATION",
    order_type: "LIMIT",
    entry_price: 100,
    stop_loss: 105,
    take_profit_1: 90,
    valid_from_paris: "2026-07-14T15:00:00+02:00",
    expires_at_paris: "2026-07-14T16:00:00+02:00",
    conditions: [
      {
        condition_id: "activation",
        importance: "MANDATORY",
        role: "ACTIVATION",
        effect: "REQUIRE_TRUE",
        instrument: "MNQ",
        timeframe: "M5",
        operator: "CLOSE_BELOW",
        threshold: 101,
        required_for_trigger: true,
        memory_policy: "LATCH_UNTIL_TRIGGER",
      },
      {
        condition_id: "invalidation",
        importance: "HARD_BLOCKER",
        role: "INVALIDATION",
        effect: "BLOCK_IF_TRUE",
        instrument: "MNQ",
        timeframe: "M5",
        operator: "CLOSE_ABOVE",
        threshold: 104,
        required_for_trigger: false,
        memory_policy: "INVALIDATE_TERMINAL",
      },
    ],
    trigger_policy: { min_score: 0.65 },
  }, [
    { timestamp_paris: "2026-07-14T15:05:00+02:00", open: 101, high: 102, low: 99, close: 100 },
    { timestamp_paris: "2026-07-14T15:10:00+02:00", open: 103, high: 105, low: 102, close: 104.5 },
  ], { tick: localTick });

  assert.equal(evaluation.triggered, false);
  assert.equal(evaluation.status, "INVALIDATED");
  assert.equal(evaluation.reason, "HARD_BLOCKER_ACTIVE");
  assert.equal(evaluation.setup.backend_can_trigger, false);
  assert.equal(evaluation.setup.invalidation_condition_id, "invalidation");
});

test("a missing cross-instrument source stays UNKNOWN and never falls back to MNQ", () => {
  const rows = [
    { timestamp_paris: "2026-07-14T15:05:00+02:00", open: 100, high: 103, low: 99, close: 102 },
    { timestamp_paris: "2026-07-14T15:10:00+02:00", open: 102, high: 104, low: 101, close: 103 },
  ];
  const evaluation = evaluateReplaySetupOnRows({
    setup_record_id: "setup_cross_missing",
    setup_id: "setup_cross_missing",
    status: "ARMED_CONDITIONAL",
    backend_can_trigger: true,
    instrument: "MNQ",
    direction: "long",
    entry_mode: "LIMIT_TOUCH",
    order_type: "LIMIT",
    entry_price: 103,
    stop_loss: 99,
    take_profit_1: 111,
    conditions: [{
      condition_id: "mes_confirmation",
      importance: "MANDATORY",
      role: "CONFIRMATION",
      effect: "REQUIRE_TRUE",
      instrument: "MES",
      timeframe: "M5",
      operator: "CLOSE_ABOVE",
      threshold: 100,
      required_for_trigger: true,
      memory_policy: "LATCH_UNTIL_TRIGGER",
    }],
    trigger_policy: { min_score: 0.65 },
  }, rows, {
    tick: { ...tick, paris: "2026-07-14T15:15:00+02:00" },
    rowsByInstrument: new Map([["MNQ", rows]]),
  });

  assert.equal(evaluation.triggered, false);
  assert.equal(evaluation.setup.conditions[0].status, "UNKNOWN");
  assert.equal(evaluation.setup.conditions[0].backend_data_status, "UNAVAILABLE");
  assert.equal(evaluation.reason, "MANDATORY_PENDING");
});

test("NEXT_BAR_MARKET_AFTER_CONFIRMATION fills only on the following closed candle", () => {
  const evaluation = evaluateReplaySetupOnRows({
    setup_record_id: "setup_next_bar",
    setup_id: "setup_next_bar",
    status: "ARMED_CONDITIONAL",
    backend_can_trigger: true,
    instrument: "MNQ",
    direction: "long",
    entry_mode: "NEXT_BAR_MARKET_AFTER_CONFIRMATION",
    order_type: "MARKET",
    entry_price: 101,
    stop_loss: 98,
    take_profit_1: 107,
    conditions: [{
      condition_id: "activation",
      importance: "MANDATORY",
      role: "ACTIVATION",
      effect: "REQUIRE_TRUE",
      instrument: "MNQ",
      timeframe: "M5",
      operator: "CLOSE_ABOVE",
      threshold: 100,
      required_for_trigger: true,
      memory_policy: "LATCH_UNTIL_TRIGGER",
    }],
    trigger_policy: { min_score: 0.65 },
  }, [
    { timestamp_paris: "2026-07-14T15:05:00+02:00", open: 99.5, high: 101, low: 99, close: 100.5 },
    { timestamp_paris: "2026-07-14T15:10:00+02:00", open: 101.25, high: 102, low: 101, close: 101.75 },
  ], {
    tick: { ...tick, paris: "2026-07-14T15:15:00+02:00" },
  });

  assert.equal(evaluation.triggered, true);
  assert.equal(evaluation.trigger_price, 101.25);
  assert.equal(evaluation.trigger_row.timestamp_paris, "2026-07-14T15:10:00+02:00");
});

test("condition engine never triggers or materializes a position while a mandatory close stays pending", () => {
  const localTick = {
    utc: "2026-07-14T13:15:00.000Z",
    paris: "2026-07-14T15:15:00+02:00",
  };
  const evaluation = evaluateReplaySetupOnRows(conditionEngineNextBarSetup(), [
    { timestamp_paris: "2026-07-14T15:05:00+02:00", timeframe: "M5", open: 103.5, high: 104.75, low: 103, close: 104 },
    { timestamp_paris: "2026-07-14T15:10:00+02:00", timeframe: "M5", open: 104, high: 104.9, low: 103.75, close: 104.5 },
  ], { tick: localTick });
  const position = evaluation.triggered
    ? buildReplayPositionFromTriggeredSetup({
      setup: evaluation.setup,
      run,
      step,
      monitor: null,
      trigger: evaluation,
      tick: localTick,
      makePositionId: (value) => `position__${value}`,
    })
    : null;

  assert.equal(evaluation.setup.opportunity_evaluation.eligible, true);
  assert.equal(evaluation.setup.opportunity_evaluation.trigger_eligible, false);
  assert.equal(evaluation.setup.deterministic_condition_evaluation.required_pending, 1);
  assert.equal(evaluation.setup.condition_summary.triggerable, false);
  assert.equal(evaluation.triggered, false);
  assert.equal(evaluation.status, "ARMED_CONDITIONAL");
  assert.equal(position, null);
});

test("condition engine confirms a mandatory close then enters only on the following candle", () => {
  const localTick = {
    utc: "2026-07-14T13:20:00.000Z",
    paris: "2026-07-14T15:20:00+02:00",
  };
  const evaluation = evaluateReplaySetupOnRows(conditionEngineNextBarSetup(), [
    { timestamp_paris: "2026-07-14T15:05:00+02:00", timeframe: "M5", open: 103.5, high: 104.75, low: 103, close: 104 },
    { timestamp_paris: "2026-07-14T15:10:00+02:00", timeframe: "M5", open: 104.5, high: 106, low: 104.25, close: 105.5 },
    { timestamp_paris: "2026-07-14T15:15:00+02:00", timeframe: "M5", open: 105.75, high: 107, low: 105.5, close: 106.5 },
  ], { tick: localTick });
  const position = evaluation.triggered
    ? buildReplayPositionFromTriggeredSetup({
      setup: evaluation.setup,
      run,
      step,
      monitor: null,
      trigger: evaluation,
      tick: localTick,
      makePositionId: (value) => `position__${value}`,
    })
    : null;

  assert.equal(evaluation.setup.opportunity_evaluation.trigger_eligible, true);
  assert.equal(evaluation.setup.deterministic_condition_evaluation.required_pending, 0);
  assert.equal(evaluation.setup.condition_summary.triggerable, true);
  assert.equal(evaluation.triggered, true);
  assert.equal(evaluation.trigger_row.timestamp_paris, "2026-07-14T15:15:00+02:00");
  assert.equal(evaluation.trigger_price, 105.75);
  assert.equal(position?.status, "OPEN");
  assert.equal(position?.opened_at_paris, "2026-07-14T15:15:00+02:00");
});

test("LATEST_ONLY reacquisition resets confirmation and preserves LIVE Replay parity", () => {
  const rows = [
    { timestamp_paris: "2026-07-14T15:01:00+02:00", timeframe: "M1", open: 105.1, high: 106, low: 105, close: 105.5, closed: true },
    { timestamp_paris: "2026-07-14T15:02:00+02:00", timeframe: "M1", open: 105.5, high: 105.75, low: 104.25, close: 104.5, closed: true },
    { timestamp_paris: "2026-07-14T15:03:00+02:00", timeframe: "M1", open: 104.8, high: 106, low: 104.75, close: 105.75, closed: true },
    { timestamp_paris: "2026-07-14T15:04:00+02:00", timeframe: "M1", open: 106, high: 106.5, low: 105.75, close: 106.25, closed: true },
  ];
  const latestOnlyCondition = {
    condition_id: "latest_only_close_above",
    predicate_type: "PRICE_RELATION",
    importance: "MANDATORY",
    role: "ACTIVATION",
    effect: "REQUIRE_TRUE",
    instrument: "MNQ",
    timeframe: "M1",
    operator: "CLOSE_ABOVE",
    threshold: 105,
    required_for_trigger: true,
    memory_policy: "LATEST_ONLY",
  };
  const evaluateStages = (transportMode) => [1, 2, 3, 4].map((rowCount) => {
    const cutoff = rows[rowCount - 1].timestamp_paris;
    return evaluateReplaySetupOnRows(conditionEngineNextBarSetup({
      mode: transportMode,
      source_mode: transportMode,
      conditions: [latestOnlyCondition],
    }), rows.slice(0, rowCount), {
      tick: {
        utc: new Date(cutoff).toISOString(),
        paris: cutoff,
      },
    });
  });
  const replayStages = evaluateStages("replay");
  const liveStages = evaluateStages("live");

  for (const stages of [replayStages, liveStages]) {
    assert.equal(stages[0].setup.opportunity_evaluation.trigger_eligible, true);
    assert.equal(stages[0].triggered, false);
    assert.equal(stages[1].setup.opportunity_evaluation.trigger_eligible, false);
    assert.equal(stages[1].setup.deterministic_condition_evaluation.required_pending, 1);
    assert.equal(stages[1].triggered, false);
    assert.equal(stages[2].setup.opportunity_evaluation.trigger_eligible, true);
    assert.equal(stages[2].triggered, false);
    assert.equal(stages[3].triggered, true);
    assert.equal(stages[3].trigger_row.timestamp_paris, "2026-07-14T15:04:00+02:00");
    assert.equal(stages[3].trigger_row.timeframe, "M1");
    assert.equal(stages[3].trigger_row.closed, true);
    assert.equal(stages[3].trigger_price, 106);
  }

  const parityProjection = (evaluation) => ({
    triggered: evaluation.triggered,
    status: evaluation.status,
    trigger_at_paris: evaluation.trigger_row?.timestamp_paris || null,
    trigger_price: evaluation.trigger_price,
    predicate_state: evaluation.setup.predicate_states.latest_only_close_above.state,
    required_pending: evaluation.setup.deterministic_condition_evaluation.required_pending,
    trigger_eligible: evaluation.setup.opportunity_evaluation.trigger_eligible,
  });
  assert.deepEqual(parityProjection(liveStages[3]), parityProjection(replayStages[3]));
});

test("a temporary LATEST_ONLY veto clears without killing the setup and requires M1 reconfirmation", () => {
  const rows = [
    { timestamp_paris: "2026-07-14T15:01:00+02:00", timeframe: "M1", open: 105.1, high: 106, low: 105, close: 105.5, closed: true },
    { timestamp_paris: "2026-07-14T15:02:00+02:00", timeframe: "M1", open: 105.5, high: 105.75, low: 104.25, close: 104.5, closed: true },
    { timestamp_paris: "2026-07-14T15:03:00+02:00", timeframe: "M1", open: 104.8, high: 106, low: 104.75, close: 105.75, closed: true },
    { timestamp_paris: "2026-07-14T15:04:00+02:00", timeframe: "M1", open: 106, high: 106.5, low: 105.75, close: 106.25, closed: true },
  ];
  const setup = conditionEngineNextBarSetup({
    conditions: [
      {
        condition_id: "activation_latched",
        predicate_type: "PRICE_RELATION",
        role: "ACTIVATION",
        effect: "REQUIRE_TRUE",
        instrument: "MNQ",
        timeframe: "M1",
        operator: "CLOSE_ABOVE",
        threshold: 104,
        importance: "MANDATORY",
        required_for_trigger: true,
        memory_policy: "LATCH_UNTIL_TRIGGER",
      },
      {
        condition_id: "temporary_veto",
        predicate_type: "PRICE_RELATION",
        role: "VETO",
        effect: "BLOCK_IF_TRUE",
        instrument: "MNQ",
        timeframe: "M1",
        operator: "CLOSE_BELOW",
        threshold: 105,
        importance: "HARD_BLOCKER",
        required_for_trigger: false,
        memory_policy: "LATEST_ONLY",
      },
    ],
  });
  const stages = [1, 2, 3, 4].map((rowCount) => {
    const cutoff = rows[rowCount - 1].timestamp_paris;
    return evaluateReplaySetupOnRows(setup, rows.slice(0, rowCount), {
      tick: { utc: new Date(cutoff).toISOString(), paris: cutoff },
    });
  });

  assert.equal(stages[0].setup.opportunity_evaluation.trigger_eligible, true);
  assert.equal(stages[0].triggered, false);
  assert.equal(stages[1].setup.opportunity_evaluation.trigger_eligible, false);
  assert.equal(stages[1].setup.deterministic_condition_evaluation.hard_blockers_active, 1);
  assert.equal(stages[1].status, "ARMED_CONDITIONAL");
  assert.equal(stages[2].setup.opportunity_evaluation.trigger_eligible, true);
  assert.equal(stages[2].triggered, false);
  assert.equal(stages[2].setup.predicate_states.temporary_veto.state, "PENDING");
  assert.equal(stages[3].triggered, true);
  assert.equal(stages[3].trigger_row.timestamp_paris, "2026-07-14T15:04:00+02:00");
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
        order_type: "LIMIT",
        entry_mode: "LIMIT_TOUCH",
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

test("monitor transform scenario rejects a prose-only placeholder", () => {
  const docs = buildReplaySetupDocsFromMonitor({
    monitor: {
      monitor_id: "monitor_transform",
      master_id: "master_14",
      thesis_id: "thesis_1",
      monitor_decision: {
        action: "TRANSFORM_SCENARIO",
        instrument: "MNQ",
        direction: "long",
        reason_summary: "Long idea exists but execution geometry still needs to be defined.",
      },
    },
    run,
    step,
    existingSetups: [],
    tick,
    makeSetupId: (value) => `replay_day__setup__${value}`,
  });

  assert.equal(docs.length, 0);
});

test("monitor setup candidate is not silently promoted without an explicit ARM action", () => {
  const docs = buildReplaySetupDocsFromMonitor({
    monitor: {
      monitor_id: "monitor_geometry",
      master_id: "master_14",
      thesis_id: "thesis_1",
      monitor_decision: { action: "SETUP_CANDIDATE", instrument: "MNQ", direction: "long" },
      setup_candidate: {
        setup_id: "geometry_candidate",
        status: "SETUP_CANDIDATE",
        instrument: "MNQ",
        direction: "long",
        order_type: "LIMIT",
        entry_mode: "LIMIT_TOUCH",
        entry_price: 29780,
        stop_loss: 29720,
        take_profit_1: 29920,
        conditions: [
          { label: "MNQ trigger", importance: "MANDATORY", operator: "CLOSE_ABOVE", threshold: 29770 },
          { label: "MES confirms", importance: "SECONDARY", status: "PENDING" },
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
  assert.equal(docs[0].status, "SETUP_CANDIDATE");
  assert.equal(docs[0].backend_can_trigger, false);
  assert.equal(docs[0].execution_geometry_ready, true);
});

test("monitor reuses the active setup identity when GPT omits setup_id", () => {
  const first = buildReplaySetupDocsFromMonitor({
    monitor: {
      monitor_id: "monitor_identity_1",
      thesis_id: "thesis_1",
      monitor_decision: {
        action: "ARM_SETUP",
        setup: {
          instrument: "MES",
          direction: "long",
          status: "ARMED_CONDITIONAL",
          entry_zone: { min: 7397.75, max: 7402 },
          stop_loss: 7392,
          take_profit_1: 7415,
        },
      },
    },
    run,
    step,
    existingSetups: [],
    tick,
    makeSetupId: (value) => `replay_day__setup__${value}`,
  });
  const second = buildReplaySetupDocsFromMonitor({
    monitor: {
      monitor_id: "monitor_identity_2",
      thesis_id: "thesis_1",
      monitor_decision: {
        action: "MAINTAIN_THESIS",
        setup: {
          instrument: "MES",
          direction: "long",
          status: "ARMED_CONDITIONAL",
          entry_zone: { min: 7397.75, max: 7402 },
          stop_loss: 7392,
          take_profit_1: 7415,
        },
      },
    },
    run,
    step: { ...step, step_id: "step_identity_2" },
    existingSetups: first,
    tick,
    makeSetupId: (value) => `replay_day__setup__${value}`,
  });

  assert.equal(second[0].setup_id, first[0].setup_id);
  assert.equal(second[0].setup_record_id, first[0].setup_record_id);
  assert.equal(second[0].status, "PRE_ARMED");
});

test("monitor cancellation closes the existing canonical setup instead of creating a duplicate", () => {
  const existing = {
    setup_id: "mes_pullback",
    setup_record_id: "replay_day__setup__mes_pullback",
    thesis_id: "thesis_1",
    instrument: "MES",
    direction: "long",
    status: "ARMED_CONDITIONAL",
    priority: 1,
    entry_zone: { min: 7397.75, max: 7402 },
    stop_loss: 7392,
    take_profit_1: 7415,
    backend_can_trigger: true,
    execution_geometry_ready: true,
  };
  const docs = buildReplaySetupDocsFromMonitor({
    monitor: {
      monitor_id: "monitor_cancel",
      thesis_id: "thesis_1",
      monitor_decision: { action: "CANCEL_SETUP" },
      setup_transition: {
        setup_id: "mes_pullback",
        reason: "Scenario invalidated.",
      },
    },
    run,
    step,
    existingSetups: [existing],
    tick,
    makeSetupId: (value) => `replay_day__setup__${value}`,
  });

  assert.equal(docs.length, 1);
  assert.equal(docs[0].setup_id, "mes_pullback");
  assert.equal(docs[0].setup_record_id, "replay_day__setup__mes_pullback");
  assert.equal(docs[0].status, "CANCELLED");
  assert.equal(docs[0].backend_can_trigger, false);
});

test("GPT cannot terminalize a setup as TRIGGERED without a backend-created position", () => {
  const existing = {
    setup_id: "mes_pullback",
    setup_record_id: "replay_day__setup__mes_pullback",
    thesis_id: "thesis_1",
    instrument: "MES",
    direction: "long",
    status: "ARMED_CONDITIONAL",
    priority: 1,
    entry_zone: { min: 7397.75, max: 7402 },
    stop_loss: 7392,
    take_profit_1: 7415,
    backend_can_trigger: true,
    execution_geometry_ready: true,
  };
  const docs = buildReplaySetupDocsFromMonitor({
    monitor: {
      monitor_id: "monitor_false_trigger",
      thesis_id: "thesis_1",
      monitor_decision: {
        action: "MAINTAIN_THESIS",
        reason_summary: "Conserver la géométrie sans exécution.",
        setup: {
          instrument: "MES",
          direction: "long",
          status: "TRIGGERED",
          entry_zone: { min: 7397.75, max: 7402 },
          stop_loss: 7392,
          take_profit_1: 7415,
        },
      },
    },
    run,
    step,
    existingSetups: [existing],
    tick,
    makeSetupId: (value) => `replay_day__setup__${value}`,
  });

  assert.equal(docs[0].setup_id, "mes_pullback");
  assert.equal(docs[0].status, "PRE_ARMED");
  assert.equal(docs[0].requested_status, "TRIGGERED");
  assert.equal(docs[0].status_normalization.reason, "GPT_TRIGGERED_REQUIRES_BACKEND_POSITION");
});

test("a backend-triggered setup remains terminal when a later monitor carries it forward", () => {
  const existing = {
    setup_id: "mes_executed",
    setup_record_id: "replay_day__setup__mes_executed",
    thesis_id: "thesis_1",
    instrument: "MES",
    direction: "long",
    status: "TRIGGERED",
    status_authority: "backend",
    trigger_source: "backend_immutable_interval",
    execution_status: "POSITION_CREATED",
    linked_position_id: "position_1",
    priority: 1,
    entry_price: 7400,
    stop_loss: 7395,
    take_profit_1: 7410,
  };
  const docs = buildReplaySetupDocsFromMonitor({
    monitor: {
      monitor_id: "monitor_backend_trigger",
      thesis_id: "thesis_1",
      monitor_decision: {
        action: "MAINTAIN_THESIS",
        setup: {
          instrument: "MES",
          direction: "long",
          status: "TRIGGERED",
          entry_price: 7400,
          stop_loss: 7395,
          take_profit_1: 7410,
        },
      },
    },
    run,
    step,
    existingSetups: [existing],
    tick,
    makeSetupId: (value) => `replay_day__setup__${value}`,
  });

  assert.equal(docs[0].setup_id, "mes_executed");
  assert.equal(docs[0].status, "TRIGGERED");
  assert.equal(docs[0].status_authority, "backend");
  assert.equal(docs[0].linked_position_id, "position_1");
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
    order_type: "LIMIT",
    entry_mode: "LIMIT_TOUCH",
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
    { timestamp_paris: "2026-07-14T15:10:00+02:00", open: 29781, high: 29790, low: 29775, close: 29784 },
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

test("backend interval evaluation supports tolerance and cross-instrument confirmations", () => {
  const setup = {
    setup_record_id: "setup_record_cross",
    setup_id: "mnq_long_with_mes_filter",
    status: "ARMED_CONDITIONAL",
    instrument: "MNQ",
    direction: "long",
    order_type: "LIMIT",
    entry_mode: "LIMIT_TOUCH",
    entry_price: 29670.5,
    stop_loss: 29620,
    take_profit_1: 29790,
    conditions: [
      { label: "MNQ breakout", importance: "MANDATORY", instrument: "MNQ", operator: "CLOSE_ABOVE", threshold: 29670.5 },
      { label: "MES confirmation with tick tolerance", importance: "IMPORTANT", instrument: "MES", operator: "CLOSE_ABOVE", threshold: 7574 },
      { label: "VIX supportive", importance: "BONUS", status: "PENDING" },
    ],
    trigger_policy: { min_score: 0.8 },
  };
  const mnqRows = [
    { timestamp_paris: "2026-07-14T15:05:00+02:00", open: 29660, high: 29678, low: 29658, close: 29672 },
    { timestamp_paris: "2026-07-14T15:10:00+02:00", open: 29671, high: 29676, low: 29669, close: 29674 },
  ];
  const rowsByInstrument = new Map([
    ["MNQ", mnqRows],
    ["MES", [
      { timestamp_paris: "2026-07-14T15:05:00+02:00", open: 7568, high: 7574, low: 7566, close: 7573.75 },
      { timestamp_paris: "2026-07-14T15:10:00+02:00", open: 7573.75, high: 7575, low: 7572, close: 7574.5 },
    ]],
  ]);
  const evaluation = evaluateReplaySetupOnRows(setup, mnqRows, { tick, rowsByInstrument });

  assert.equal(evaluation.triggered, true);
  assert.equal(evaluation.setup.status, "TRIGGERED");
  assert.equal(evaluation.setup.conditions[1].importance, "PRIMARY");
  assert.equal(evaluation.setup.conditions[1].status, "PASSED");
  assert.equal(evaluation.setup.condition_summary.score, 1);
});

test("backend reads nested trigger_policy conditions and fails closed when none exist", () => {
  const base = {
    setup_record_id: "setup_nested",
    setup_id: "setup_nested",
    status: "ARMED_CONDITIONAL",
    instrument: "MNQ",
    direction: "long",
    order_type: "LIMIT",
    entry_mode: "LIMIT_TOUCH",
    entry_price: 101,
    stop_loss: 98,
    take_profit_1: 108,
    backend_can_trigger: true,
  };
  const rows = [
    { timestamp_paris: "2026-07-14T15:05:00+02:00", high: 102, low: 99, close: 101.5 },
    { timestamp_paris: "2026-07-14T15:10:00+02:00", high: 103, low: 100.5, close: 102 },
  ];
  const missing = evaluateReplaySetupOnRows(base, rows, { tick });
  assert.equal(missing.triggered, false);
  assert.equal(missing.reason, "CONDITIONS_REQUIRED");

  const nested = evaluateReplaySetupOnRows({
    ...base,
    trigger_policy: {
      min_score: 1,
      conditions: [{
        instrument: "MNQ",
        operator: "CLOSE_ABOVE",
        threshold: 100,
        importance: "MANDATORY",
      }],
    },
  }, rows, { tick });
  assert.equal(nested.triggered, true);
  assert.equal(nested.setup.conditions.length, 1);
});

test("backend expires a setup before evaluating a later candle", () => {
  const evaluation = evaluateReplaySetupOnRows({
    setup_record_id: "setup_expired",
    status: "ARMED_CONDITIONAL",
    instrument: "MES",
    direction: "short",
    order_type: "LIMIT",
    entry_mode: "LIMIT_TOUCH",
    entry_price: 100,
    stop_loss: 102,
    take_profit_1: 96,
    backend_can_trigger: true,
    conditions: [{ operator: "CLOSE_BELOW", threshold: 101, importance: "MANDATORY" }],
    valid_from_paris: "2026-07-14T14:00:00+02:00",
    expires_at_paris: "2026-07-14T14:45:00+02:00",
  }, [
    { timestamp_paris: "2026-07-14T14:50:00+02:00", high: 101, low: 99, close: 99.5 },
  ], { tick });

  assert.equal(evaluation.triggered, false);
  assert.equal(evaluation.reason, "SETUP_EXPIRED");
  assert.equal(evaluation.setup.status, "EXPIRED");
  assert.equal(evaluation.setup.backend_can_trigger, false);
});

test("zone execution price is always an observed candle price", () => {
  const evaluation = evaluateReplaySetupOnRows({
    setup_record_id: "setup_gap",
    status: "ARMED_CONDITIONAL",
    instrument: "MES",
    direction: "long",
    entry_zone: { low: 100, high: 105 },
    stop_loss: 95,
    take_profit_1: 115,
    backend_can_trigger: true,
    conditions: [{ operator: "CLOSE_ABOVE", threshold: 99, importance: "MANDATORY" }],
    trigger_policy: { min_score: 1, allow_same_bar_entry: true },
  }, [
    { timestamp_paris: "2026-07-14T15:05:00+02:00", high: 102, low: 99, close: 101 },
  ], { tick });

  assert.equal(evaluation.triggered, true);
  assert.equal(evaluation.trigger_price, 102);
  assert.ok(evaluation.trigger_price <= evaluation.trigger_row.high);
  assert.ok(evaluation.trigger_price >= evaluation.trigger_row.low);
});

test("mandatory close confirmation cannot retroactively enter on the same candle by default", () => {
  const evaluation = evaluateReplaySetupOnRows({
    setup_record_id: "setup_same_bar",
    status: "ARMED_CONDITIONAL",
    instrument: "MNQ",
    direction: "long",
    order_type: "LIMIT",
    entry_mode: "LIMIT_TOUCH",
    entry_price: 101,
    stop_loss: 98,
    take_profit_1: 108,
    backend_can_trigger: true,
    conditions: [{ operator: "CLOSE_ABOVE", threshold: 100, importance: "MANDATORY" }],
  }, [
    { timestamp_paris: "2026-07-14T15:05:00+02:00", high: 102, low: 99, close: 101.5 },
  ], { tick });

  assert.equal(evaluation.triggered, false);
  assert.equal(evaluation.reason, "TRIGGERABLE");
});

test("June 11 atomic long enters causally after break-retest instead of waiting for duplicate fresh proofs", () => {
  const setup = {
    setup_record_id: "june11_atomic_long",
    setup_id: "june11_atomic_long",
    status: "ARMED_CONDITIONAL",
    backend_can_trigger: true,
    condition_engine_version: "1.2.0",
    execution_policy_version: "4.2.0",
    instrument: "MNQ",
    direction: "long",
    entry_mode: "RETEST_ZONE_AFTER_CONFIRMATION",
    order_type: "LIMIT",
    entry_zone: { from: 28462, to: 28472 },
    entry_price: 28472,
    stop_loss: 28392,
    take_profit_1: 28632,
    risk_pct: 0.25,
    valid_from_paris: "2026-06-11T02:00:00+02:00",
    expires_at_paris: "2026-06-11T05:00:00+02:00",
    conditions: [
      {
        condition_id: "break",
        predicate_type: "BREAKOUT_CLOSE",
        role: "ACTIVATION",
        effect: "REQUIRE_TRUE",
        instrument: "MNQ",
        timeframe: "M1",
        operator: "CLOSE_ABOVE",
        threshold: 28470,
        importance: "MANDATORY",
        required_for_trigger: true,
        memory_policy: "LATCH_UNTIL_TRIGGER",
      },
      {
        condition_id: "break_retest",
        predicate_type: "BREAK_RETEST_SEQUENCE",
        role: "ACTIVATION",
        effect: "REQUIRE_TRUE",
        instrument: "MNQ",
        timeframe: "M1",
        operator: "CLOSE_ABOVE",
        threshold: 28470,
        importance: "MANDATORY",
        required_for_trigger: true,
        memory_policy: "LATCH_UNTIL_TRIGGER",
        parameters: {
          break_condition_id: "break",
          retest_level: 28470,
          tolerance_points: 8,
          max_bars: 30,
          require_rejection_confirmation: true,
        },
      },
      {
        condition_id: "zone_touch",
        predicate_type: "ZONE_TOUCH",
        role: "CONFIRMATION",
        effect: "REQUIRE_TRUE",
        instrument: "MNQ",
        timeframe: "M1",
        operator: "TOUCH_BELOW",
        threshold: 28470,
        importance: "MANDATORY",
        required_for_trigger: true,
        memory_policy: "LATEST_ONLY",
        parameters: { zone_lower: 28462, zone_upper: 28472 },
      },
      {
        condition_id: "rejection",
        predicate_type: "REJECTION_PATTERN",
        role: "CONFIRMATION",
        effect: "REQUIRE_TRUE",
        instrument: "MNQ",
        timeframe: "M1",
        operator: "REJECT_SUPPORT",
        threshold: 28470,
        importance: "MANDATORY",
        required_for_trigger: true,
        memory_policy: "LATEST_ONLY",
        parameters: { threshold: 28470, tolerance_points: 8 },
      },
    ],
  };
  const rows = [
    { timestamp_paris: "2026-06-11T02:16:00+02:00", timeframe: "M1", open: 28466, high: 28480, low: 28464, close: 28476, closed: true },
    { timestamp_paris: "2026-06-11T02:26:00+02:00", timeframe: "M1", open: 28475, high: 28478, low: 28466, close: 28474, closed: true },
    { timestamp_paris: "2026-06-11T02:27:00+02:00", timeframe: "M1", open: 28473, high: 28475, low: 28470, close: 28474, closed: true },
  ];
  const evaluation = evaluateReplaySetupOnRows(setup, rows, {
    tick: {
      utc: "2026-06-11T00:28:00.000Z",
      paris: "2026-06-11T02:28:00+02:00",
    },
  });

  assert.equal(evaluation.triggered, true);
  assert.equal(evaluation.trigger_row.timestamp_paris, "2026-06-11T02:27:00+02:00");
  assert.equal(evaluation.trigger_price, 28472);
  assert.equal(evaluation.setup.predicate_states.break_retest.state, "SATISFIED");
  assert.equal(evaluation.setup.predicate_states.zone_touch.state, "SATISFIED");
  assert.equal(evaluation.setup.predicate_states.zone_touch.subsumed_by_condition_id, "break_retest");
});

test("a confirmation at expiry never creates a same-candle or post-expiry position", () => {
  const setup = conditionEngineNextBarSetup({
    setup_record_id: "june11_expiry_boundary",
    setup_id: "june11_expiry_boundary",
    valid_from_paris: "2026-06-11T01:00:00+02:00",
    expires_at_paris: "2026-06-11T02:00:00+02:00",
    conditions: [{
      condition_id: "confirmation_before_expiry",
      predicate_type: "PRICE_RELATION",
      role: "ACTIVATION",
      effect: "REQUIRE_TRUE",
      instrument: "MNQ",
      timeframe: "M1",
      operator: "CLOSE_ABOVE",
      threshold: 105,
      importance: "MANDATORY",
      required_for_trigger: true,
      memory_policy: "LATCH_UNTIL_TRIGGER",
    }],
  });
  const evaluation = evaluateReplaySetupOnRows(setup, [
    { timestamp_paris: "2026-06-11T01:59:00+02:00", timeframe: "M1", open: 104, high: 106, low: 103.5, close: 105.5, closed: true },
    { timestamp_paris: "2026-06-11T02:00:00+02:00", timeframe: "M1", open: 106, high: 108, low: 105, close: 107, closed: true },
  ], {
    tick: {
      utc: "2026-06-11T00:00:00.000Z",
      paris: "2026-06-11T02:00:00+02:00",
    },
  });

  assert.equal(evaluation.triggered, false);
  assert.equal(evaluation.status, "EXPIRED");
  assert.equal(evaluation.setup.backend_can_trigger, false);
});

test("runtime M5 evidence reconciles stale GPT data gates before M1 entry", () => {
  const setup = conditionEngineNextBarSetup({
    setup_record_id: "m5_runtime_gate_reconciliation",
    setup_id: "m5_runtime_gate_reconciliation",
    conditions: [{
      condition_id: "m5_close_above",
      predicate_type: "PRICE_RELATION",
      role: "ACTIVATION",
      effect: "REQUIRE_TRUE",
      instrument: "MNQ",
      timeframe: "M5",
      operator: "CLOSE_ABOVE",
      threshold: 105,
      importance: "MANDATORY",
      required_for_trigger: true,
      memory_policy: "LATCH_UNTIL_TRIGGER",
    }],
    gates: [
      { code: "CANONICAL_TRIGGER_DATA_MISSING", state: "UNKNOWN" },
      { code: "MAJOR_EVENT_ENTRY_BLOCK", state: "UNKNOWN" },
      { code: "MANDATORY_INDICATOR_MISSING", state: "UNKNOWN" },
    ],
  });
  const m1Rows = [
    { timestamp_paris: "2026-07-14T15:00:00+02:00", timeframe: "M1", open: 105.25, high: 106, low: 105, close: 105.5, closed: true },
    { timestamp_paris: "2026-07-14T15:01:00+02:00", timeframe: "M1", open: 105.75, high: 107, low: 105.5, close: 106.5, closed: true },
  ];
  const rowsByInstrument = new Map([[
    "MNQ",
    [
      ...m1Rows,
      { timestamp_paris: "2026-07-14T15:00:00+02:00", timeframe: "M5", open: 104, high: 106, low: 103.5, close: 105.5, closed: true },
    ],
  ]]);
  const evaluation = evaluateReplaySetupOnRows(setup, m1Rows, {
    tick: {
      utc: "2026-07-14T13:02:00.000Z",
      paris: "2026-07-14T15:02:00+02:00",
    },
    rowsByInstrument,
  });
  const gates = Object.fromEntries(evaluation.setup.gates.map((gate) => [gate.code, gate.state]));

  assert.equal(evaluation.triggered, true);
  assert.equal(gates.CANONICAL_TRIGGER_DATA_MISSING, "PASS");
  assert.equal(gates.MAJOR_EVENT_ENTRY_BLOCK, "NOT_APPLICABLE");
  assert.equal(gates.MANDATORY_INDICATOR_MISSING, "NOT_APPLICABLE");
});

test("backend refuses to trigger conditional setup without execution geometry", () => {
  const docs = buildReplaySetupDocsFromMonitor({
    monitor: {
      monitor_id: "monitor_missing_geometry",
      master_id: "master_14",
      thesis_id: "thesis_1",
      monitor_decision: { action: "ARM_SETUP", instrument: "MNQ", direction: "long" },
      armed_setup: {
        setup_id: "no_stop_or_target",
        status: "ARMED_CONDITIONAL",
        instrument: "MNQ",
        direction: "long",
        order_type: "LIMIT",
        entry_mode: "LIMIT_TOUCH",
        entry_price: 29780,
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
  assert.equal(docs[0].execution_geometry_ready, false);
  assert.equal(docs[0].backend_can_trigger, false);

  const directEvaluation = evaluateReplaySetupOnRows({
    ...docs[0],
    status: "ARMED_CONDITIONAL",
    lifecycle_status: "ARMED_CONDITIONAL",
    setup_status: "ARMED_CONDITIONAL",
    backend_can_trigger: true,
  }, [
    { timestamp_paris: "2026-07-14T15:05:00+02:00", open: 29760, high: 29786, low: 29755, close: 29782 },
  ], { tick });
  assert.equal(directEvaluation.triggered, false);
  assert.equal(directEvaluation.reason, "EXECUTION_GEOMETRY_INCOMPLETE");
});

test("backend refuses to arm geometry below its explicit minimum RR", () => {
  const docs = buildReplaySetupDocsFromMonitor({
    monitor: {
      monitor_id: "monitor_bad_rr",
      thesis_id: "thesis_1",
      monitor_decision: { action: "ARM_SETUP" },
      setup_transition: {
        setup_id: "mnq_bad_rr",
        status: "ARMED_CONDITIONAL",
        instrument: "MNQ",
        direction: "short",
        entry_zone: { low: 27844.75, high: 27856 },
        stop_loss: 27882,
        take_profit_1: 27790,
        rr_minimum: 2,
        conditions: [{ operator: "REJECT_ABOVE", threshold: 27844.75 }],
      },
    },
    run,
    step,
    existingSetups: [],
    tick,
    makeSetupId: (value) => `replay_day__setup__${value}`,
  });

  assert.equal(docs[0].status, "PRE_ARMED");
  assert.equal(docs[0].execution_geometry_ready, false);
  assert.equal(docs[0].backend_can_trigger, false);
});

test("position interval evaluation closes on TP or stop without future rows", () => {
  const longPosition = {
    position_id: "position_1",
    status: "OPEN",
    direction: "long",
    order_type: "LIMIT",
    entry_mode: "LIMIT_TOUCH",
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

test("replay cadence recommendation stays M15 across the full day", () => {
  const waitCadence = recommendReplayCadenceMinutes({
    run: { ...run, cadence: "60m", monitor_cadence: "60m" },
    activeThesis: { thesis_id: "thesis_1", status: "WAIT_MONITORED" },
    setups: [],
    positions: [],
    monitors: [{ monitor_id: "monitor_wait", monitor_decision: { action: "WAIT_MORE" } }],
  });
  assert.equal(waitCadence.recommended_minutes, 15);
  assert.equal(waitCadence.reason, "HYBRID_M15_M1_REPLAY");

  const candidateCadence = recommendReplayCadenceMinutes({
    run: { ...run, cadence: "60m", monitor_cadence: "60m" },
    activeThesis: { thesis_id: "thesis_1", status: "WAIT_MONITORED" },
    setups: [{ setup_record_id: "setup_candidate", status: "SETUP_CANDIDATE" }],
    positions: [],
  });
  assert.equal(candidateCadence.recommended_minutes, 15);
});

test("closed replay position is not projected as active or protected", () => {
  const closedButCorrupted = {
    position_id: "pos_closed",
    status: "PROTECTED",
    entry_price: 29782.75,
    stop_loss: 29782.75,
    exit_reason: "STOP_LOSS_HIT",
    exit_price: 29782.75,
    closed_at_paris: "2026-07-14T18:45:00+02:00",
  };
  const open = selectOpenReplayPosition([closedButCorrupted]);
  assert.equal(open, null);

  const continuity = buildReplayContinuityState({
    run,
    currentStep: step,
    activeThesis: { thesis_id: "thesis_1", status: "WAIT_MONITORED" },
    setups: [],
    positions: [closedButCorrupted],
    monitors: [],
  });
  assert.equal(continuity.position_status, "NO_POSITION");
  assert.equal(continuity.active_position, null);
  assert.equal(continuity.protected_position, null);
});

test("replay continuity excludes and terminalizes setups at the exact expiry cutoff", () => {
  const expired = {
    setup_id: "expired_candidate",
    setup_record_id: "setup_expired_candidate",
    status: "PRE_ARMED",
    lifecycle_status: "PRE_ARMED",
    setup_status: "PRE_ARMED",
    backend_can_trigger: false,
    priority: 1,
    valid_from_paris: "2026-07-14T14:00:00+02:00",
    expires_at_paris: "2026-07-14T15:00:00+02:00",
  };
  const valid = {
    setup_id: "valid_candidate",
    setup_record_id: "setup_valid_candidate",
    status: "PRE_ARMED",
    lifecycle_status: "PRE_ARMED",
    setup_status: "PRE_ARMED",
    backend_can_trigger: false,
    priority: 2,
    valid_from_paris: "2026-07-14T15:00:00+02:00",
    expires_at_paris: "2026-07-14T16:00:00+02:00",
  };

  assert.deepEqual(
    selectActiveReplaySetups([expired, valid], {
      asOfParis: "2026-07-14T15:00:00+02:00",
    }).map((setup) => setup.setup_id),
    ["valid_candidate"],
  );

  const continuity = buildReplayContinuityState({
    run: {
      ...run,
      current_replay_time: "2026-07-14T15:00:00+02:00",
    },
    currentStep: step,
    activeThesis: { thesis_id: "thesis_1", status: "CONDITIONAL" },
    setups: [expired, valid],
    positions: [],
    monitors: [],
  });
  assert.equal(continuity.active_setup_count, 1);
  assert.equal(continuity.terminal_setup_count, 1);
  assert.equal(continuity.active_setup.setup_id, "valid_candidate");
});

test("setup replacement atomically terminalizes the old setup and preserves the replacement link", () => {
  const existing = {
    setup_id: "mnq_breakout_v1",
    setup_record_id: "replay_day__setup__mnq_breakout_v1",
    thesis_id: "thesis_1",
    instrument: "MNQ",
    direction: "long",
    status: "ARMED_CONDITIONAL",
    lifecycle_status: "ARMED_CONDITIONAL",
    setup_status: "ARMED_CONDITIONAL",
    backend_can_trigger: true,
    trigger_policy: { backend_can_trigger: true },
    entry_zone: { low: 100, high: 101 },
    stop_loss: 98,
    take_profit_1: 106,
    conditions: [{ operator: "CLOSE_ABOVE", threshold: 101, importance: "PRIMARY" }],
  };
  const input = {
    monitor: {
      monitor_id: "monitor_replace",
      thesis_id: "thesis_1",
      monitor_decision: { action: "ARM_SETUP" },
      setup_transition: {
        setup_id: "mnq_breakout_v2",
        replaces_setup_id: "mnq_breakout_v1",
        status: "ARMED_CONDITIONAL",
        instrument: "MNQ",
        direction: "long",
        entry_zone: { low: 101, high: 102 },
        stop_loss: 99,
        take_profit_1: 108,
        conditions: [{ operator: "CLOSE_ABOVE", threshold: 102, importance: "PRIMARY" }],
      },
    },
    run,
    step,
    existingSetups: [existing],
    tick,
    makeSetupId: (value) => `replay_day__setup__${value}`,
  };

  const mutation = buildReplaySetupMutationDocsFromMonitor(input);

  assert.equal(mutation.materializedSetups.length, 1);
  assert.equal(mutation.replacedSetups.length, 1);
  assert.equal(mutation.allSetups.length, 2);
  const replacement = mutation.materializedSetups[0];
  const replaced = mutation.replacedSetups[0];
  assert.equal(replacement.setup_id, "mnq_breakout_v2");
  assert.equal(replacement.replaces_setup_id, "mnq_breakout_v1");
  assert.equal(replacement.replaces_setup_record_id, existing.setup_record_id);
  assert.equal(replacement.replacement_integrity_status, "SOURCE_FOUND");
  assert.equal(replaced.setup_record_id, existing.setup_record_id);
  assert.equal(replaced.status, "REPLACED");
  assert.equal(replaced.lifecycle_status, "REPLACED");
  assert.equal(replaced.setup_status, "REPLACED");
  assert.equal(replaced.backend_can_trigger, false);
  assert.equal(replaced.trigger_policy.backend_can_trigger, false);
  assert.equal(replaced.replaced_by_setup_id, replacement.setup_id);
  assert.equal(replaced.replaced_by_setup_record_id, replacement.setup_record_id);
  assert.equal(replaced.replacement_monitor_id, "monitor_replace");
  assert.equal(normalizeReplaySetupStatus("REPLACED"), "REPLACED");

  const missingSource = buildReplaySetupMutationDocsFromMonitor({
    ...input,
    existingSetups: [],
  });
  assert.equal(missingSource.replacedSetups.length, 0);
  assert.equal(missingSource.materializedSetups[0].replacement_integrity_status, "REPLACED_SETUP_NOT_FOUND");
  assert.equal(missingSource.materializedSetups[0].backend_can_trigger, false);
  assert.equal(missingSource.materializedSetups[0].trigger_policy.backend_can_trigger, false);
});

test("replacement never reuses the old canonical record when GPT echoes it", () => {
  const existing = {
    setup_id: "mnq_breakout_v1",
    setup_record_id: "replay_day__setup__mnq_breakout_v1",
    thesis_id: "thesis_1",
    instrument: "MNQ",
    direction: "long",
    status: "PRE_ARMED",
    lifecycle_status: "PRE_ARMED",
    setup_status: "PRE_ARMED",
    backend_can_trigger: false,
    trigger_policy: { backend_can_trigger: false },
  };
  const mutation = buildReplaySetupMutationDocsFromMonitor({
    monitor: {
      monitor_id: "monitor_replace_echoed_record",
      thesis_id: "thesis_1",
      monitor_decision: { action: "REPLACE" },
      setup_transition: {
        setup_id: "mnq_breakout_v2",
        setup_record_id: existing.setup_record_id,
        replaces_setup_id: existing.setup_id,
        status: "PRE_ARMED",
        instrument: "MNQ",
        direction: "long",
        entry_mode: "RETEST_ZONE_AFTER_CONFIRMATION",
        entry_zone: { low: 101, high: 102 },
        stop_loss: 99,
        take_profit_1: 108,
        valid_from_paris: "2026-07-14T15:00:00+02:00",
        expires_at_paris: "2026-07-14T16:00:00+02:00",
        conditions: [{ operator: "CLOSE_ABOVE", threshold: 102, importance: "PRIMARY" }],
      },
    },
    run,
    step,
    existingSetups: [existing],
    tick,
    makeSetupId: (value) => `replay_day__setup__${value}`,
  });

  const replacement = mutation.materializedSetups[0];
  assert.equal(replacement.setup_id, "mnq_breakout_v2");
  assert.equal(replacement.setup_record_id, "replay_day__setup__mnq_breakout_v2");
  assert.notEqual(replacement.setup_record_id, existing.setup_record_id);
  assert.equal(replacement.replaces_setup_id, existing.setup_id);
  assert.equal(replacement.identity_normalization.reason, "REPLACEMENT_RECORD_ID_REBUILT");
  assert.equal(mutation.replacedSetups[0].setup_record_id, existing.setup_record_id);
  assert.equal(mutation.replacedSetups[0].status, "REPLACED");
});

test("monitor persistence expires stale setups and atomically caps the active portfolio at five", () => {
  const activeCandidates = Array.from({ length: 6 }, (_, index) => ({
    setup_id: `candidate_${index + 1}`,
    setup_record_id: `replay_day__setup__candidate_${index + 1}`,
    thesis_id: "thesis_1",
    instrument: "MNQ",
    direction: index % 2 ? "short" : "long",
    priority: index + 1,
    status: "PRE_ARMED",
    lifecycle_status: "PRE_ARMED",
    setup_status: "PRE_ARMED",
    backend_can_trigger: false,
    valid_from_paris: "2026-07-14T14:00:00+02:00",
    expires_at_paris: "2026-07-14T16:00:00+02:00",
  }));
  const expiredCandidate = {
    ...activeCandidates[0],
    setup_id: "already_expired",
    setup_record_id: "replay_day__setup__already_expired",
    priority: 7,
    expires_at_paris: "2026-07-14T15:00:00+02:00",
  };
  const mutation = buildReplaySetupMutationDocsFromMonitor({
    monitor: {
      monitor_id: "monitor_portfolio_reconcile",
      thesis_id: "thesis_1",
      monitor_decision: { action: "KEEP" },
    },
    run,
    step,
    existingSetups: [...activeCandidates, expiredCandidate],
    tick,
    makeSetupId: (value) => `replay_day__setup__${value}`,
  });

  assert.equal(mutation.activePortfolioCount, 5);
  assert.equal(mutation.portfolioClosedSetups.length, 1);
  assert.equal(mutation.portfolioClosedSetups[0].setup_id, "candidate_6");
  assert.equal(mutation.portfolioClosedSetups[0].status, "CANCELLED");
  assert.equal(
    mutation.portfolioClosedSetups[0].activation_rejected_reason,
    "PORTFOLIO_ACTIVE_SETUP_CAP_EXCEEDED",
  );
  const expiredWrite = mutation.allSetups.find((setup) => setup.setup_id === "already_expired");
  assert.equal(expiredWrite.status, "EXPIRED");
  assert.equal(expiredWrite.activation_rejected_reason, "SETUP_EXPIRED_AT_CUTOFF");
});
