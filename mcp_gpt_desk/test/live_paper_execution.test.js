import assert from "node:assert/strict";
import test from "node:test";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import {
  buildLiveSetupDocsFromMonitor,
  buildLiveSetupMutationDocsFromMonitor,
  materializeTriggeredLiveMonitor,
  reconcileLivePaperExecution,
} from "../src/live-paper-execution.js";
import { buildMasterSetupDocs } from "../src/desk-replay-orchestration-algorithms.js";

const scope = {
  strategy_id: "ny_open_1530",
  trading_date: "2026-07-20",
  session: "ny_open",
  run_id: "front_live_2026-07-20_ny_open",
  mode: "live",
  master_id: "master_live_1530",
  thesis_id: "thesis_live_1530",
  timestamp_paris: "2026-07-20T16:00:00+02:00",
};

const tick = {
  utc: "2026-07-20T14:00:00.000Z",
  paris: "2026-07-20T16:00:00+02:00",
  epochMs: Date.parse("2026-07-20T14:00:00.000Z"),
};

test("LIVE Master setup is terminal when GPT materializes it after the thesis expiry", () => {
  const lateTick = {
    utc: "2026-07-20T07:51:35.000Z",
    paris: "2026-07-20T09:51:35+02:00",
    epochMs: Date.parse("2026-07-20T07:51:35.000Z"),
  };
  const setups = buildMasterSetupDocs({
    strategy_id: "asia_open",
    trading_date: "2026-07-20",
    session: "asia_open",
    run_id: "front_live_2026-07-20",
    mode: "live",
    cutoff_paris: "2026-07-20T08:45:00+02:00",
    full_analysis: {
      active_thesis: {
        linked_setup_id: "setup_1",
        valid_from: "2026-07-20T08:45:00+02:00",
        valid_until: "2026-07-20T09:45:00+02:00",
        setup_expiry_time: "2026-07-20T09:45:00+02:00",
      },
      setups: [{
        setup_id: "setup_1",
        status: "ARMED_CONDITIONAL",
        instrument: "MNQ",
        direction: "short",
        entry_zone: { low: 27940, high: 27952 },
        stop_loss: 27985,
        take_profit_1: 27840,
        conditions: [{ operator: "REJECT_ABOVE", threshold: 27940 }],
      }],
    },
  }, { analysis_id: "master_late_live" }, lateTick);

  assert.equal(setups.length, 1);
  assert.equal(setups[0].status, "EXPIRED");
  assert.equal(setups[0].lifecycle_status, "EXPIRED");
  assert.equal(setups[0].setup_status, "EXPIRED");
  assert.equal(setups[0].valid_from_paris, "2026-07-20T09:51:35+02:00");
  assert.equal(setups[0].expires_at_paris, "2026-07-20T09:45:00+02:00");
  assert.equal(setups[0].backend_can_trigger, false);
  assert.equal(setups[0].activation_rejected, true);
  assert.equal(setups[0].lifecycle_integrity_status, "SAFE_EXPIRED_BEFORE_ACTIVATION");
  assert.equal(setups[0].lifecycle_integrity.valid, true);
});

test("Replay Master setup uses the historical cutoff instead of the wall-clock materialization time", () => {
  const replayMaterializationTick = {
    utc: "2026-07-29T11:52:05.949Z",
    paris: "2026-07-29T13:52:05.949+02:00",
    epochMs: Date.parse("2026-07-29T11:52:05.949Z"),
  };
  const setups = buildMasterSetupDocs({
    backtest_id: "replay_2026-06-11_full_day_15m_clock_fix",
    replay_run_id: "replay_2026-06-11_full_day_15m_clock_fix",
    strategy_id: "asia_open",
    trading_date: "2026-06-11",
    session: "asia_open",
    mode: "replay",
    cutoff_paris: "2026-06-11T00:15:00+02:00",
    full_analysis: {
      active_thesis: {
        linked_setup_id: "setup_1",
        valid_from: "2026-06-11T00:15:00+02:00",
        valid_until: "2026-06-11T14:00:00+02:00",
        setup_expiry_time: "2026-06-11T14:00:00+02:00",
      },
      setups: [{
        setup_id: "setup_1",
        status: "ARMED_CONDITIONAL",
        instrument: "MES",
        direction: "long",
        entry_zone: { low: 7266.25, high: 7270 },
        stop_loss: 7247,
        take_profit_1: 7333.25,
      }],
    },
  }, { analysis_id: "replay_master_clock_fix" }, replayMaterializationTick);

  assert.equal(setups.length, 1);
  assert.equal(setups[0].status, "ARMED_CONDITIONAL");
  assert.equal(setups[0].valid_from_paris, "2026-06-11T00:15:00+02:00");
  assert.equal(setups[0].materialized_at_paris, "2026-07-29T13:52:05.949+02:00");
  assert.equal(setups[0].expires_at_paris, "2026-06-11T14:00:00+02:00");
  assert.equal(setups[0].activation_eligible, true);
  assert.equal(setups[0].activation_rejected, false);
  assert.equal(setups[0].activation_rejected_reason, null);
  assert.equal(setups[0].lifecycle_integrity_status, "VALID");
});

test("LIVE Master materializes setups stored at the contract top level", () => {
  const setups = buildMasterSetupDocs({
    strategy_id: "ny_open",
    trading_date: "2026-07-20",
    session: "ny_open",
    run_id: "front_live_2026-07-20",
    mode: "live",
    cutoff_paris: "2026-07-20T15:30:00+02:00",
    active_thesis: {
      linked_setup_id: "ny_retest_short",
      valid_from: "2026-07-20T15:30:00+02:00",
      valid_until: "2026-07-20T18:30:00+02:00",
    },
    setups: [{
      setup_id: "ny_retest_short",
      status: "ARMED_CONDITIONAL",
      instrument: "MNQ",
      direction: "short",
      entry_zone: { low: 27840, high: 27848 },
      stop_loss: 27870,
      take_profit_1: 27780,
      conditions: [{ operator: "REJECT_ABOVE", threshold: 27848 }],
      expires_at_paris: "2026-07-20T18:30:00+02:00",
    }],
    full_analysis: {
      executive_summary: { primary_setup_id: "ny_retest_short" },
    },
  }, { analysis_id: "master_top_level_live" }, tick);

  assert.equal(setups.length, 1);
  assert.equal(setups[0].setup_id, "ny_retest_short");
  assert.equal(setups[0].instrument, "MNQ");
  assert.equal(setups[0].stop_loss, 27870);
  assert.equal(setups[0].take_profit_1, 27780);
});

test("LIVE Monitor setup uses the Replay V4 classifications and safe trigger defaults", () => {
  const setups = buildLiveSetupDocsFromMonitor({
    monitor: {
      ...scope,
      monitor_id: "monitor_live_1545",
      timestamp_paris: "2026-07-20T15:45:00+02:00",
      linked_master_analysis_id: scope.master_id,
      linked_active_thesis_id: scope.thesis_id,
      monitor_decision: { action: "ARM_SETUP", instrument: "MNQ", direction: "long" },
      armed_setup: {
        setup_id: "live_breakout_retest",
        status: "PRE_ARMED",
        instrument: "MNQ",
        direction: "long",
        entry_price: 101,
        stop_loss: 98,
        take_profit_1: 108,
        conditions: [
          { label: "MNQ confirmation", importance: "MANDATORY", operator: "CLOSE_ABOVE", threshold: 100.25 },
          { label: "VIX bonus", importance: "OPTIONAL", status: "PENDING" },
        ],
      },
    },
    existingSetups: [],
    tick,
  });

  assert.equal(setups.length, 1);
  assert.equal(setups[0].status, "ARMED_CONDITIONAL");
  assert.equal(setups[0].trigger_policy.min_score, 0.65);
  assert.equal(setups[0].trigger_policy.threshold_tolerance_points, 0.25);
  assert.equal(setups[0].conditions[0].importance, "MANDATORY");
  assert.equal(setups[0].mode, "live");
  assert.equal(setups[0].paper_execution_enabled, true);
  assert.equal(setups[0].broker_execution, false);
});

test("LIVE Monitor defers an old production PRENDRE payload to the deterministic engine", async () => {
  const monitor = {
    ...scope,
    monitor_id: "monitor_live_0045",
    timestamp_paris: "2026-07-20T16:00:00+02:00",
    as_of_utc: "2026-07-20T14:00:00.000Z",
    linked_master_analysis_id: scope.master_id,
    linked_active_thesis_id: scope.thesis_id,
    monitor_decision: {
      action: "TRIGGER_SHORT_SETUP",
      instrument: "MNQ",
      direction: "short",
      take_trade: true,
      executable: true,
      entry_reference: 28134,
      confidence_pct: 67,
      risk_pct: 0.25,
      rationale: "Rejet confirmé sous la zone d'invalidation.",
      setup: {
        setup_id: "mnq_short_0045",
        instrument: "MNQ",
        direction: "short",
        entry_zone: [28130, 28138],
        stop_loss: 28182,
        take_profits: [28020, 27960],
        valid_until: "2026-07-20T17:00:00+02:00",
      },
    },
  };
  const persistence = new FakeLivePaperPersistence();
  const setups = buildLiveSetupDocsFromMonitor({ monitor, existingSetups: [], tick });

  assert.equal(setups.length, 1);
  assert.equal(setups[0].status, "PRE_ARMED");
  assert.deepEqual(setups[0].entry_zone, { low: 28130, high: 28138 });
  assert.equal(setups[0].stop_loss, 28182);
  assert.equal(setups[0].take_profit_1, 28020);
  assert.equal(setups[0].expires_at_paris, "2026-07-20T17:00:00+02:00");

  const result = await materializeTriggeredLiveMonitor({
    persistence,
    monitor,
    setups,
    tick,
  });
  const positions = persistence.values(DESK_COLLECTIONS.deskPositions);

  assert.equal(result.status, "DEFERRED_TO_DETERMINISTIC_ENGINE");
  assert.equal(result.reason, "GPT_MONITOR_CANNOT_CREATE_POSITION");
  assert.equal(positions.length, 0);
});

test("LIVE Monitor never materializes an old explicit trigger retroactively", async () => {
  const monitor = {
    ...scope,
    monitor_id: "monitor_live_stale",
    timestamp_paris: "2026-07-20T15:00:00+02:00",
    as_of_utc: "2026-07-20T13:00:00.000Z",
    linked_master_analysis_id: scope.master_id,
    linked_active_thesis_id: scope.thesis_id,
    monitor_decision: {
      action: "TRIGGER_SHORT_SETUP",
      instrument: "MNQ",
      direction: "short",
      take_trade: true,
      executable: true,
      entry_reference: 28134,
      setup: {
        setup_id: "mnq_short_stale",
        instrument: "MNQ",
        direction: "short",
        entry_zone: [28130, 28138],
        stop_loss: 28182,
        take_profits: [28020],
      },
    },
  };
  const persistence = new FakeLivePaperPersistence();
  const setups = buildLiveSetupDocsFromMonitor({ monitor, existingSetups: [], tick });
  const result = await materializeTriggeredLiveMonitor({
    persistence,
    monitor,
    setups,
    tick,
  });

  assert.equal(result.status, "DEFERRED_TO_DETERMINISTIC_ENGINE");
  assert.equal(result.reason, "GPT_MONITOR_CANNOT_CREATE_POSITION");
  assert.equal(persistence.values(DESK_COLLECTIONS.deskPositions).length, 0);
});

test("LIVE paper engine triggers an armed setup between Monitors and creates a paper position", async () => {
  const persistence = new FakeLivePaperPersistence();
  persistence.put("desk_live_run_cursor", "livecur__2026-07-20", {
    cursor_id: "livecur__2026-07-20",
    last_completed_checkpoint: "2026-07-20T15:45:00+02:00",
  });
  persistence.put(DESK_COLLECTIONS.deskSetups, "setup_live_1", liveSetup());
  persistence.rows = [
    {
      symbol_code: "MNQ1!",
      timeframe: "1",
      timestamp_utc: "2026-07-20T13:50:00.000Z",
      timestamp_paris: "2026-07-20T15:50:00+02:00",
      open: 100,
      high: 102,
      low: 100.5,
      close: 101.5,
      is_closed: true,
    },
    {
      symbol_code: "MNQ1!",
      timeframe: "1",
      timestamp_utc: "2026-07-20T13:55:00.000Z",
      timestamp_paris: "2026-07-20T15:55:00+02:00",
      open: 101.5,
      high: 103,
      low: 100.75,
      close: 102,
      is_closed: true,
    },
  ];

  const result = await reconcileLivePaperExecution({ persistence, args: scope, tick });
  const setups = persistence.values(DESK_COLLECTIONS.deskSetups);
  const positions = persistence.values(DESK_COLLECTIONS.deskPositions);

  assert.equal(result.status, "UPDATED");
  assert.equal(result.execution_mode, "paper");
  assert.equal(result.broker_execution, false);
  assert.equal(setups[0].status, "TRIGGERED");
  assert.equal(positions.length, 1);
  assert.equal(positions[0].status, "OPEN");
  assert.equal(positions[0].entry_price, 101);
  assert.equal(positions[0].execution_mode, "paper");
  assert.equal(positions[0].paper_simulated, true);
  assert.equal(positions[0].broker_execution, false);
  assert.equal(
    persistence.values(DESK_COLLECTIONS.deskDecisionJournal)[0].event_type,
    "PAPER_SETUP_TRIGGERED",
  );
});

test("LIVE paper engine repairs a setup triggered after its contractual expiry without creating a position", async () => {
  const persistence = new FakeLivePaperPersistence();
  persistence.put("desk_live_run_cursor", "livecur__2026-07-20", {
    cursor_id: "livecur__2026-07-20",
    last_completed_checkpoint: "2026-07-20T15:45:00+02:00",
  });
  persistence.put(DESK_COLLECTIONS.deskSetups, "setup_live_retroactive", {
    ...liveSetup(),
    setup_record_id: "setup_live_retroactive",
    setup_id: "setup_live_retroactive",
    status: "TRIGGERED",
    lifecycle_status: "TRIGGERED",
    setup_status: "TRIGGERED",
    valid_from_paris: "2026-07-20T15:51:35+02:00",
    triggered_at_paris: "2026-07-20T15:55:00+02:00",
  });
  persistence.put(DESK_COLLECTIONS.deskActiveTheses, scope.thesis_id, {
    ...scope,
    thesis_id: scope.thesis_id,
    master_id: scope.master_id,
    linked_setup_id: "setup_live_retroactive",
    valid_from: "2026-07-20T15:30:00+02:00",
    setup_expiry_time: "2026-07-20T15:45:00+02:00",
    valid_until: "2026-07-20T15:45:00+02:00",
  });

  const result = await reconcileLivePaperExecution({ persistence, args: scope, tick });
  const repaired = persistence.values(DESK_COLLECTIONS.deskSetups)[0];
  const positions = persistence.values(DESK_COLLECTIONS.deskPositions);
  const events = persistence.values(DESK_COLLECTIONS.deskDecisionJournal);

  assert.equal(result.status, "UPDATED");
  assert.equal(repaired.status, "EXPIRED");
  assert.equal(repaired.lifecycle_status, "EXPIRED");
  assert.equal(repaired.setup_status, "EXPIRED");
  assert.equal(repaired.expires_at_paris, "2026-07-20T15:45:00+02:00");
  assert.equal(repaired.validity_inherited_from_thesis, true);
  assert.equal(repaired.backend_can_trigger, false);
  assert.equal(repaired.lifecycle_integrity_status, "SAFE_TERMINAL_REPAIR");
  assert.equal(repaired.lifecycle_integrity.valid, true);
  assert.equal(repaired.lifecycle_integrity.historical_violation_repaired, true);
  assert.equal(repaired.lifecycle_integrity.activation_rejected_reason, "SETUP_EXPIRED_BEFORE_LIVE_ACTIVATION");
  assert.equal(repaired.triggered_at_paris, null);
  assert.equal(repaired.historical_triggered_at_paris, "2026-07-20T15:55:00+02:00");
  assert.equal(positions.length, 0);
  assert.equal(events[0].event_type, "PAPER_SETUP_RETROACTIVE_TRIGGER_REJECTED");
});

test("LIVE paper engine follows an open position on closed candles and records its exit", async () => {
  const persistence = new FakeLivePaperPersistence();
  persistence.put("desk_live_run_cursor", "livecur__2026-07-20", {
    cursor_id: "livecur__2026-07-20",
    last_completed_checkpoint: "2026-07-20T15:45:00+02:00",
  });
  persistence.put(DESK_COLLECTIONS.deskPositions, "position_live_1", {
    ...scope,
    position_id: "position_live_1",
    status: "OPEN",
    instrument: "MNQ",
    direction: "long",
    entry_price: 101,
    stop_loss: 98,
    take_profit_1: 108,
    execution_mode: "paper",
    opened_at_paris: "2026-07-20T15:50:00+02:00",
  });
  persistence.rows = [
    {
      symbol_code: "MNQ1!",
      timeframe: "1",
      timestamp_utc: "2026-07-20T13:45:00.000Z",
      timestamp_paris: "2026-07-20T15:45:00+02:00",
      open: 100,
      high: 101,
      low: 90,
      close: 99,
      is_closed: true,
    },
    {
      symbol_code: "MNQ1!",
      timeframe: "1",
      timestamp_utc: "2026-07-20T13:55:00.000Z",
      timestamp_paris: "2026-07-20T15:55:00+02:00",
      open: 104,
      high: 109,
      low: 103,
      close: 108.5,
      is_closed: true,
    },
  ];

  const result = await reconcileLivePaperExecution({ persistence, args: scope, tick });
  const position = persistence.values(DESK_COLLECTIONS.deskPositions)[0];

  assert.equal(result.status, "UPDATED");
  assert.equal(position.status, "CLOSED");
  assert.equal(position.exit_reason, "TAKE_PROFIT_1_HIT");
  assert.equal(position.exit_price, 108);
  assert.equal(position.result_r, 2.33333333);
  assert.equal(position.outcome_schema_version, "trade_outcome_v1");
  assert.equal(position.outcome.finalized, true);
  assert.equal(
    persistence.values(DESK_COLLECTIONS.deskDecisionJournal)[0].event_type,
    "PAPER_POSITION_CLOSED",
  );
});

test("LIVE paper engine gives closed M1 candles priority over M5 compatibility data", async () => {
  const persistence = new FakeLivePaperPersistence();
  persistence.put("desk_live_run_cursor", "livecur__2026-07-20", {
    cursor_id: "livecur__2026-07-20",
    last_completed_checkpoint: "2026-07-20T15:45:00+02:00",
  });
  persistence.put(DESK_COLLECTIONS.deskPositions, "position_live_m1", {
    ...scope,
    position_id: "position_live_m1",
    status: "OPEN",
    instrument: "MNQ",
    direction: "long",
    entry_price: 101,
    stop_loss: 98,
    take_profit_1: 108,
    execution_mode: "paper",
    opened_at_paris: "2026-07-20T15:45:00+02:00",
  });
  persistence.rows = [
    {
      symbol_code: "MNQ1!",
      timeframe: "1",
      timestamp_utc: "2026-07-20T13:51:00.000Z",
      timestamp_paris: "2026-07-20T15:51:00+02:00",
      open: 101,
      high: 102,
      low: 97,
      close: 99,
      is_closed: true,
    },
    {
      symbol_code: "MNQ1!",
      timeframe: "5",
      timestamp_utc: "2026-07-20T13:55:00.000Z",
      timestamp_paris: "2026-07-20T15:55:00+02:00",
      open: 101,
      high: 109,
      low: 100,
      close: 108.5,
      is_closed: true,
    },
  ];

  await reconcileLivePaperExecution({ persistence, args: scope, tick });
  const position = persistence.values(DESK_COLLECTIONS.deskPositions)[0];

  assert.equal(position.exit_reason, "STOP_LOSS_HIT");
  assert.equal(position.exit_price, 98);
  assert.deepEqual(persistence.queryTimeframes, ["1"]);
});

test("LIVE derives missing MNQ M15 from canonical M1 and evaluates logical ES through MES M1", async () => {
  const persistence = new FakeLivePaperPersistence();
  persistence.put("desk_live_run_cursor", "livecur__2026-07-20", {
    cursor_id: "livecur__2026-07-20",
    last_completed_checkpoint: "2026-07-20T15:45:00+02:00",
  });
  persistence.put(DESK_COLLECTIONS.deskSetups, "setup_live_runtime_resampling", {
    ...liveSetup(),
    setup_record_id: "setup_live_runtime_resampling",
    setup_id: "setup_live_runtime_resampling",
    condition_engine_version: "1.2.0",
    execution_policy_version: "4.3.0",
    order_type: "MARKET",
    entry_mode: "NEXT_BAR_MARKET_AFTER_CONFIRMATION",
    entry_price: 101,
    stop_loss: 95,
    take_profit_1: 150,
    expires_at_paris: "2026-07-20T17:00:00+02:00",
    trigger_policy: { min_score: 0.55, backend_can_trigger: true },
    conditions: [
      {
        condition_id: "mnq_required",
        predicate_type: "PRICE_RELATION",
        instrument: "MNQ",
        timeframe: "M1",
        operator: "CLOSE_ABOVE",
        parameters: { threshold: 112 },
        role: "ACTIVATION",
        effect: "REQUIRE_TRUE",
        importance: "MANDATORY",
        required_for_trigger: true,
        memory_policy: "LATCH_UNTIL_TRIGGER",
        weight: 0,
      },
      {
        condition_id: "es_alignment",
        predicate_type: "INTERMARKET_CONFIRMATION",
        instrument: "ES",
        reference_instrument: "ES",
        timeframe: "M1",
        operator: "ALIGNS_WITH",
        parameters: { reference_instrument: "ES" },
        role: "CONFIRMATION",
        effect: "REQUIRE_TRUE",
        importance: "SECONDARY",
        required_for_trigger: false,
        memory_policy: "LATEST_ONLY",
        weight: 1,
      },
      {
        condition_id: "mnq_m15_invalidation",
        predicate_type: "BREAKOUT_CLOSE",
        instrument: "MNQ",
        timeframe: "M15",
        operator: "CLOSE_BELOW",
        parameters: { threshold: 90 },
        role: "INVALIDATION",
        effect: "BLOCK_IF_TRUE",
        importance: "HARD_BLOCKER",
        required_for_trigger: false,
        memory_policy: "INVALIDATE_TERMINAL",
        weight: 0,
      },
    ],
  });
  persistence.rows = [
    ...runtimeLiveMinuteRows("2026-07-20T13:45:00.000Z", "MNQ1!", 15, 100),
    ...runtimeLiveMinuteRows("2026-07-20T13:45:00.000Z", "MES1!", 15, 5_000),
  ];

  const result = await reconcileLivePaperExecution({ persistence, args: scope, tick });
  const evaluated = persistence.values(DESK_COLLECTIONS.deskSetups)[0];
  const positions = persistence.values(DESK_COLLECTIONS.deskPositions);

  assert.equal(result.status, "UPDATED");
  assert.equal(persistence.queryTimeframes.includes("15"), true);
  assert.equal(
    persistence.queryFeedIds.some((ids) => ids.includes("prod__tradingview__MES1!__1")),
    true,
  );
  assert.equal(
    evaluated.conditions.find((item) => item.condition_id === "es_alignment").status,
    "PASSED",
  );
  assert.equal(
    evaluated.conditions.find((item) => item.condition_id === "mnq_m15_invalidation").status,
    "PENDING",
  );
  assert.equal(positions.length, 0);
});

test("LIVE V5 never falls back to M5 when canonical M1 is absent", async () => {
  const persistence = new FakeLivePaperPersistence();
  persistence.put("desk_live_run_cursor", "livecur__2026-07-20", {
    cursor_id: "livecur__2026-07-20",
    last_completed_checkpoint: "2026-07-20T15:45:00+02:00",
  });
  persistence.put(DESK_COLLECTIONS.deskSetups, "setup_live_1", liveSetup());
  persistence.rows = [{
    symbol_code: "MNQ1!",
    timeframe: "5",
    timestamp_utc: "2026-07-20T13:55:00.000Z",
    timestamp_paris: "2026-07-20T15:55:00+02:00",
    open: 100, high: 103, low: 99, close: 102, is_closed: true,
  }];

  const result = await reconcileLivePaperExecution({ persistence, args: scope, tick });
  const evaluated = persistence.values(DESK_COLLECTIONS.deskSetups)[0];
  assert.deepEqual(persistence.queryTimeframes, ["1"]);
  assert.deepEqual(persistence.queryFeedIds, [["prod__tradingview__MNQ1!__1"]]);
  assert.equal(persistence.values(DESK_COLLECTIONS.deskPositions).length, 0);
  assert.equal(evaluated.conditions[0].status, "UNKNOWN");
  assert.equal(evaluated.conditions[0].backend_data_status, "UNAVAILABLE");
  assert.equal(result.execution_data_sources[0].timeframe, null);
  assert.equal(result.execution_data_sources[0].fallback, false);
});

test("LIVE paper shadow never mutates a broker-authoritative position before ACK", async () => {
  const persistence = new FakeLivePaperPersistence();
  persistence.put("desk_live_run_cursor", "livecur__2026-07-20", {
    cursor_id: "livecur__2026-07-20",
    last_completed_checkpoint: "2026-07-20T15:45:00+02:00",
  });
  persistence.put(DESK_COLLECTIONS.deskPositions, "position_broker", {
    ...scope,
    position_id: "position_broker",
    status: "OPEN",
    instrument: "MNQ",
    direction: "long",
    entry_price: 101,
    stop_loss: 98,
    take_profit_1: 108,
    execution_mode: "NINJATRADER",
    broker_execution: true,
    opened_at_paris: "2026-07-20T15:45:00+02:00",
  });
  persistence.rows = [{
    symbol_code: "MNQ1!", timeframe: "1",
    timestamp_utc: "2026-07-20T13:55:00.000Z",
    timestamp_paris: "2026-07-20T15:55:00+02:00",
    open: 101, high: 102, low: 97, close: 99, is_closed: true,
  }];

  const result = await reconcileLivePaperExecution({ persistence, args: scope, tick });
  const position = persistence.values(DESK_COLLECTIONS.deskPositions)[0];
  assert.equal(result.status, "UNCHANGED");
  assert.equal(position.status, "OPEN");
  assert.equal(position.exit_price, undefined);
  assert.deepEqual(persistence.queryTimeframes, []);
});

test("LIVE EVENT_BLACKOUT reads the exact cutoff-safe macro window and blocks entry", async () => {
  const persistence = new FakeLivePaperPersistence();
  persistence.put("desk_live_run_cursor", "livecur__2026-07-20", {
    cursor_id: "livecur__2026-07-20",
    last_completed_checkpoint: "2026-07-20T15:45:00+02:00",
  });
  persistence.put(DESK_COLLECTIONS.deskSetups, "setup_live_macro", {
    ...liveSetup(),
    setup_record_id: "setup_live_macro",
    setup_id: "setup_live_macro",
    condition_engine_version: "1.2.0",
    conditions: [
      { condition_id: "price", predicate_type: "PRICE_RELATION", operator: "CLOSE_ABOVE", parameters: { threshold: 100.25 }, importance: "MANDATORY", required_for_trigger: true },
      { condition_id: "cpi", predicate_type: "EVENT_BLACKOUT", role: "VETO", effect: "BLOCK_IF_TRUE", operator: "EVENT_ACTIVE", parameters: { event_window_ref: "cpi_window" }, importance: "HARD_BLOCKER", required_for_trigger: false, memory_policy: "LATEST_ONLY" },
    ],
  });
  persistence.put(DESK_COLLECTIONS.macroCalendarEvents, "cpi_window", {
    event_id: "cpi_window", date: "2026-07-20",
    timestamp_utc: "2026-07-20T13:55:00.000Z",
    timestamp_paris: "2026-07-20T15:55:00+02:00",
    window_start_paris: "2026-07-20T15:50:00+02:00",
    window_end_paris: "2026-07-20T16:05:00+02:00",
    created_at_utc: "2026-07-20T10:00:00.000Z",
  });
  persistence.rows = [{
    symbol_code: "MNQ1!", timeframe: "1",
    timestamp_utc: "2026-07-20T13:55:00.000Z",
    timestamp_paris: "2026-07-20T15:55:00+02:00",
    open: 100, high: 103, low: 100, close: 102, is_closed: true,
  }];

  await reconcileLivePaperExecution({ persistence, args: scope, tick });
  const evaluated = persistence.values(DESK_COLLECTIONS.deskSetups)[0];
  assert.equal(persistence.values(DESK_COLLECTIONS.deskPositions).length, 0);
  assert.equal(evaluated.status, "ARMED_CONDITIONAL");
  assert.equal(evaluated.backend_can_trigger, true);
  assert.equal(evaluated.conditions.find((condition) => condition.condition_id === "cpi").status, "FAILED");
});

test("LIVE hides macro events first known after the decision cutoff", async () => {
  const persistence = new FakeLivePaperPersistence();
  persistence.put("desk_live_run_cursor", "livecur__2026-07-20", {
    cursor_id: "livecur__2026-07-20",
    last_completed_checkpoint: "2026-07-20T15:45:00+02:00",
  });
  persistence.put(DESK_COLLECTIONS.deskSetups, "setup_live_future_macro", {
    ...liveSetup(),
    setup_record_id: "setup_live_future_macro",
    setup_id: "setup_live_future_macro",
    condition_engine_version: "1.2.0",
    conditions: [{ condition_id: "future_event", predicate_type: "EVENT_BLACKOUT", role: "VETO", effect: "BLOCK_IF_TRUE", operator: "EVENT_ACTIVE", parameters: { event_window_ref: "future_event" }, importance: "HARD_BLOCKER" }],
  });
  persistence.put(DESK_COLLECTIONS.macroCalendarEvents, "future_event", {
    event_id: "future_event", date: "2026-07-20",
    timestamp_utc: "2026-07-20T13:55:00.000Z",
    timestamp_paris: "2026-07-20T15:55:00+02:00",
    window_start_paris: "2026-07-20T15:50:00+02:00",
    window_end_paris: "2026-07-20T16:05:00+02:00",
    created_at_utc: "2026-07-20T14:01:00.000Z",
  });
  persistence.rows = [{ symbol_code: "MNQ1!", timeframe: "1", timestamp_utc: "2026-07-20T13:55:00.000Z", timestamp_paris: "2026-07-20T15:55:00+02:00", open: 100, high: 103, low: 100, close: 102, is_closed: true }];

  await reconcileLivePaperExecution({ persistence, args: scope, tick });
  const evaluated = persistence.values(DESK_COLLECTIONS.deskSetups)[0];
  assert.equal(persistence.values(DESK_COLLECTIONS.deskPositions).length, 0);
  assert.equal(evaluated.conditions.find((condition) => condition.condition_id === "future_event").status, "UNKNOWN");
});

function liveSetup() {
  return {
    ...scope,
    setup_record_id: "setup_live_1",
    setup_id: "live_breakout_retest",
    status: "ARMED_CONDITIONAL",
    lifecycle_status: "ARMED_CONDITIONAL",
    setup_status: "ARMED_CONDITIONAL",
    instrument: "MNQ",
    direction: "long",
    entry_price: 101,
    stop_loss: 98,
    order_type: "LIMIT",
    entry_mode: "LIMIT_TOUCH",
    take_profit_1: 108,
    backend_can_trigger: true,
    conditions: [
      { label: "MNQ confirmation", importance: "MANDATORY", operator: "CLOSE_ABOVE", threshold: 100.25 },
    ],
    trigger_policy: {
      min_score: 0.65,
      threshold_tolerance_points: 0.25,
      backend_can_trigger: true,
    },
    valid_from_paris: "2026-07-20T15:45:00+02:00",
    linked_master_analysis_id: scope.master_id,
    linked_active_thesis_id: scope.thesis_id,
  };
}

function runtimeLiveMinuteRows(startUtc, symbolCode, count, base) {
  const startMs = Date.parse(startUtc);
  return Array.from({ length: count }, (_, index) => ({
    symbol_code: symbolCode,
    timeframe: "1",
    timestamp_utc: new Date(startMs + index * 60_000).toISOString(),
    bar_close_utc: new Date(startMs + (index + 1) * 60_000).toISOString(),
    timestamp_paris: new Date(startMs + index * 60_000 + 2 * 60 * 60_000)
      .toISOString()
      .replace("Z", "+02:00"),
    open: base + index,
    high: base + index + 1,
    low: base + index - 0.5,
    close: base + index + 0.5,
    volume: 10,
    is_closed: true,
  }));
}

class FakeLivePaperPersistence {
  constructor() {
    this.documents = new Map();
    this.rows = [];
    this.queryTimeframes = [];
    this.queryFeedIds = [];
  }

  key(collection, documentId) {
    return `${collection}/${documentId}`;
  }

  put(collection, documentId, data) {
    this.documents.set(this.key(collection, documentId), structuredClone(data));
  }

  values(collection) {
    const prefix = `${collection}/`;
    return [...this.documents.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, value]) => structuredClone(value));
  }

  async getDocument(collection, documentId) {
    return structuredClone(this.documents.get(this.key(collection, documentId)) || null);
  }

  async listDocuments(collection) {
    return this.values(collection);
  }

  async queryCollectionDocuments({ collection, filters = [], orderBy = [], limit = 5_000 }) {
    let rows = this.values(collection);
    for (const filter of filters) {
      rows = rows.filter((row) => {
        const value = row[filter.field];
        if (filter.operator === "==") return value === filter.value;
        if (filter.operator === ">=") return value >= filter.value;
        if (filter.operator === "<=") return value <= filter.value;
        return true;
      });
    }
    for (const order of [...orderBy].reverse()) {
      rows.sort((left, right) => String(left[order.field] || "").localeCompare(String(right[order.field] || ""))
        * (order.direction === "desc" ? -1 : 1));
    }
    return rows.slice(0, limit);
  }

  async queryMarketCandles({ symbolCodes, feedIds = [], timeframe, fromUtc, toUtc }) {
    this.queryTimeframes.push(String(timeframe));
    this.queryFeedIds.push([...feedIds]);
    const accepted = new Set(symbolCodes.map((value) => String(value).toUpperCase()));
    return this.rows
      .filter((row) => accepted.has(String(row.symbol_code).toUpperCase()))
      .filter((row) => String(row.timeframe) === String(timeframe))
      .filter((row) => Date.parse(row.timestamp_utc) >= Date.parse(fromUtc))
      .filter((row) => Date.parse(row.timestamp_utc) <= Date.parse(toUtc))
      .map((row) => structuredClone(row));
  }

  async writeDocuments(writes) {
    for (const write of writes) {
      const previous = this.documents.get(this.key(write.collection, write.documentId)) || {};
      this.put(
        write.collection,
        write.documentId,
        write.merge ? { ...previous, ...write.data } : write.data,
      );
    }
    return { ok: true, write_count: writes.length };
  }
}

test("LIVE replacement projects the terminal old setup and the linked new setup", () => {
  const oldSetup = {
    setup_id: "live_mnq_v1",
    setup_record_id: "live_setup_old",
    strategy_id: scope.strategy_id,
    trading_date: scope.trading_date,
    session: scope.session,
    run_id: scope.run_id,
    mode: "live",
    thesis_id: scope.thesis_id,
    instrument: "MNQ",
    direction: "short",
    status: "ARMED_CONDITIONAL",
    lifecycle_status: "ARMED_CONDITIONAL",
    setup_status: "ARMED_CONDITIONAL",
    backend_can_trigger: true,
    trigger_policy: { backend_can_trigger: true },
    entry_zone: { low: 28000, high: 28005 },
    stop_loss: 28015,
    take_profit_1: 27970,
    conditions: [{ operator: "CLOSE_BELOW", threshold: 28000, importance: "PRIMARY" }],
  };
  const mutation = buildLiveSetupMutationDocsFromMonitor({
    monitor: {
      ...scope,
      monitor_id: "live_monitor_replace",
      linked_active_thesis_id: scope.thesis_id,
      monitor_decision: { action: "ARM_SETUP" },
      setup_transition: {
        setup_id: "live_mnq_v2",
        replaces_setup_id: "live_mnq_v1",
        status: "ARMED_CONDITIONAL",
        instrument: "MNQ",
        direction: "short",
        entry_zone: { low: 27995, high: 28000 },
        stop_loss: 28010,
        take_profit_1: 27965,
        conditions: [{ operator: "CLOSE_BELOW", threshold: 27995, importance: "PRIMARY" }],
      },
    },
    existingSetups: [oldSetup],
    tick,
  });

  assert.equal(mutation.materializedSetups.length, 1);
  assert.equal(mutation.replacedSetups.length, 1);
  assert.equal(mutation.materializedSetups[0].run_id, scope.run_id);
  assert.equal(mutation.materializedSetups[0].replaces_setup_record_id, oldSetup.setup_record_id);
  assert.equal(mutation.replacedSetups[0].setup_record_id, oldSetup.setup_record_id);
  assert.equal(mutation.replacedSetups[0].status, "REPLACED");
  assert.equal(mutation.replacedSetups[0].backend_can_trigger, false);
  assert.equal(mutation.replacedSetups[0].replaced_by_setup_id, "live_mnq_v2");
  assert.equal(mutation.replacedSetups[0].source_collection, DESK_COLLECTIONS.deskSetups);
});
