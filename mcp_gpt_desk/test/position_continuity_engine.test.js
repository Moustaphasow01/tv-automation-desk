import assert from "node:assert/strict";
import test from "node:test";
import { buildPositionFromTriggeredSetup, evaluatePositionOnRows, markPositionAtPrice, selectOpenPosition } from "../src/position-continuity-engine.js";
import { replayPositionToSimulatedTrade } from "../src/desk-backtest-algorithms.js";
import { buildReplayPositionFromTriggeredSetup, evaluateReplayPositionOnRows, selectOpenReplayPosition } from "../src/replay-continuity.js";
import {
  buildReplayIntervalSimulation,
  buildReplayMonitorApplication,
  canonicalSetupEntryGeometry,
  certifyReplayRunResult,
  evaluateReplayDailyRiskGate,
  filterReplayClosedRows,
  mergeReplayPositionState,
  replayPositionDataset,
} from "../src/desk-replay-orchestration-algorithms.js";
import { selectReplaySimulationPosition } from "../src/desk-replay-service.js";

test("extracted position engine preserves the Replay compatibility facade exactly", () => {
  const position = { position_id: "pos_1", status: "OPEN", direction: "long", entry_price: 100, stop_loss: 98, take_profit_1: 104 };
  const positions = [{ ...position, status: "CLOSED", exit_price: 98 }, position];
  const rows = [{ timestamp_utc: "2026-07-22T14:05:00.000Z", timestamp_paris: "2026-07-22T16:05:00+02:00", high: 104.5, low: 99 }];
  const tick = { utc: "2026-07-22T14:15:00.000Z", paris: "2026-07-22T16:15:00+02:00" };
  assert.deepEqual(selectOpenPosition(positions), selectOpenReplayPosition(positions));
  assert.deepEqual(evaluatePositionOnRows(position, rows, { tick }), evaluateReplayPositionOnRows(position, rows, { tick }));
});

test("Replay interval simulation ignores the latest closed position and can trade again", () => {
  const closed = {
    position_id: "position_closed",
    status: "CLOSED",
    exit_price: 98,
    updated_at: "2026-07-27T12:00:00.000Z",
  };
  const open = {
    position_id: "position_open",
    status: "OPEN",
    updated_at: "2026-07-27T11:00:00.000Z",
  };
  assert.equal(selectReplaySimulationPosition([closed]), null);
  assert.equal(selectReplaySimulationPosition([closed, open]), open);
});

test("Replay interval creates a new position after the previous position is closed", async () => {
  const run = replaySimulationRun();
  const simulation = await buildReplayIntervalSimulation(
    replaySimulationStore(),
    run,
    { step_id: "step_2", sequence: 2, timestamp_paris: "2026-06-12T03:00:00+02:00" },
    null,
    [replaySimulationSetup()],
    {
      from: "2026-06-12T02:55:00+02:00",
      to: "2026-06-12T03:00:00+02:00",
    },
    { utc: "2026-07-29T12:00:00.000Z", paris: "2026-07-29T14:00:00+02:00" },
  );

  assert.equal(simulation.result.status, "SETUP_TRIGGERED");
  assert.equal(simulation.position_update.status, "OPEN");
  assert.equal(simulation.position_update.setup_id, "mes_reentry");
  assert.equal(simulation.setup_updates[0].status, "TRIGGERED");
  assert.equal(simulation.setup_updates[0].linked_position_id, simulation.position_update.position_id);
  assert.equal(simulation.setup_updates[0].status_authority, "backend");
});

test("Replay interval defers another setup instead of terminalizing it while a position is open", async () => {
  const run = replaySimulationRun();
  const open = {
    position_id: "position_open",
    status: "OPEN",
    instrument: "MES",
    direction: "long",
    order_type: "LIMIT",
    entry_mode: "LIMIT_TOUCH",
    entry_price: 100,
    initial_stop_loss: 95,
    stop_loss: 95,
    take_profit_1: 110,
  };
  const simulation = await buildReplayIntervalSimulation(
    replaySimulationStore(),
    run,
    { step_id: "step_3", sequence: 3, timestamp_paris: "2026-06-12T03:00:00+02:00" },
    open,
    [replaySimulationSetup()],
    {
      from: "2026-06-12T02:55:00+02:00",
      to: "2026-06-12T03:00:00+02:00",
    },
    { utc: "2026-07-29T12:00:00.000Z", paris: "2026-07-29T14:00:00+02:00" },
  );

  assert.equal(simulation.position_update.position_id, "position_open");
  assert.equal(simulation.setup_updates[0].status, "ARMED_CONDITIONAL");
  assert.equal(simulation.setup_updates[0].execution_status, "TRIGGER_DEFERRED");
  assert.equal(simulation.setup_evaluations[0].reason, "POSITION_ALREADY_OPEN_TRIGGER_DEFERRED");
});

function replaySimulationRun() {
  return {
    backtest_id: "run_simulation",
    replay_run_id: "run_simulation",
    strategy_id: "asia_open",
    session: "asia_open",
    trading_date: "2026-06-12",
    date: "2026-06-12",
    pack_id: "pack_simulation",
    pack_build_id: "build_simulation",
    source_manifest_hash: "manifest_hash",
    instruments: ["MES"],
    start_time: "2026-06-12T00:15:00+02:00",
    end_time: "2026-06-12T03:00:00+02:00",
    current_replay_time: "2026-06-12T03:00:00+02:00",
  };
}

function replaySimulationStore() {
  const row = {
    timestamp_utc: "2026-06-12T00:55:00.000Z",
    timestamp_paris: "2026-06-12T02:55:00+02:00",
    open: 100,
    high: 102,
    low: 99,
    close: 102,
  };
  return {
    async getDeskPack() {
      return {
        pack_id: "pack_simulation",
        pack_build_id: "build_simulation",
        strategy_id: "asia_open",
        session: "asia_open",
        trading_date: "2026-06-12",
        pack_purpose: "replay_source",
        source_manifest_hash: "manifest_hash",
        source_coverage: {
          start_utc: "2026-06-11T22:15:00.000Z",
          end_utc: "2026-06-12T01:00:00.000Z",
        },
        datasets: {
          MES_M1: {
            max_timestamp_utc: "2026-06-12T01:00:00.000Z",
            object_path: "local://MES_M1.csv",
            sha256: "dataset_hash",
          },
          MES_M5: {
            max_timestamp_utc: "2026-06-12T01:00:00.000Z",
            object_path: "local://MES_M5.csv",
            sha256: "audit_dataset_hash",
          },
        },
      };
    },
    async getDataset() {
      return { rows: [row], integrity: { verified: true } };
    },
  };
}

function replaySimulationSetup() {
  return {
    setup_record_id: "setup_record_mes_reentry",
    setup_id: "mes_reentry",
    status: "ARMED_CONDITIONAL",
    instrument: "MES",
    direction: "long",
    order_type: "LIMIT",
    entry_mode: "LIMIT_TOUCH",
    entry_price: 101,
    stop_loss: 95,
    take_profit_1: 110,
    priority: 1,
    conditions: [
      { label: "MES closes above entry", importance: "MANDATORY", operator: "CLOSE_ABOVE", threshold: 101 },
    ],
    trigger_policy: { min_score: 0.65, backend_can_trigger: true, allow_same_bar_entry: true },
  };
}

test("Replay execution never falls back from canonical M1 to provider M5", () => {
  assert.equal(replayPositionDataset({ datasets: { MES_M1: {}, MES_M5: {} } }, "MES"), "MES_M1");
  assert.throws(
    () => replayPositionDataset({ pack_id: "pack", pack_build_id: "build", datasets: { MES_M5: {} } }, "MES"),
    (error) => error.code === "DATASET_NOT_FOUND" && error.details.attempted_datasets.join(",") === "MES_M1",
  );
});

test("Replay EVENT_BLACKOUT consumes the immutable macro dataset at the historical cutoff", async () => {
  const requestedDatasets = [];
  const store = replaySimulationStore();
  const basePack = await store.getDeskPack();
  store.getDeskPack = async () => ({
    ...basePack,
    datasets: {
      ...basePack.datasets,
      macro_calendar: { object_path: "local://macro_calendar.json", sha256: "macro_hash" },
    },
  });
  store.getDataset = async ({ dataset, as_of_utc }) => {
    requestedDatasets.push({ dataset, as_of_utc });
    if (dataset === "macro_calendar") {
      return {
        rows: [{
          event_id: "cpi_window",
          date: "2026-06-12",
          timestamp_utc: "2026-06-12T00:58:00.000Z",
          timestamp_paris: "2026-06-12T02:58:00+02:00",
          window_start_paris: "2026-06-12T02:55:00+02:00",
          window_end_paris: "2026-06-12T03:05:00+02:00",
          actual: null,
        }],
        integrity: { verified: true },
      };
    }
    return {
      rows: [{
        timestamp_utc: "2026-06-12T00:58:00.000Z",
        timestamp_paris: "2026-06-12T02:58:00+02:00",
        timeframe: "1",
        open: 100, high: 103, low: 99, close: 102, closed: true,
      }],
      integrity: { verified: true },
    };
  };
  const setup = {
    ...replaySimulationSetup(),
    condition_engine_version: "1.2.0",
    conditions: [
      { condition_id: "price", predicate_type: "PRICE_RELATION", operator: "CLOSE_ABOVE", parameters: { threshold: 100.25 }, importance: "MANDATORY", required_for_trigger: true },
      { condition_id: "cpi", predicate_type: "EVENT_BLACKOUT", role: "VETO", effect: "BLOCK_IF_TRUE", operator: "EVENT_ACTIVE", parameters: { event_window_ref: "cpi_window" }, importance: "HARD_BLOCKER", memory_policy: "LATEST_ONLY" },
    ],
  };

  const simulation = await buildReplayIntervalSimulation(
    store,
    replaySimulationRun(),
    { step_id: "step_macro", sequence: 2, timestamp_paris: "2026-06-12T03:00:00+02:00" },
    null,
    [setup],
    { from: "2026-06-12T02:55:00+02:00", to: "2026-06-12T03:00:00+02:00" },
    { utc: "2026-07-29T12:00:00.000Z", paris: "2026-07-29T14:00:00+02:00" },
  );

  assert.equal(simulation.position_update, null);
  assert.equal(simulation.setup_updates[0].status, "ARMED_CONDITIONAL");
  assert.equal(simulation.setup_updates[0].backend_can_trigger, true);
  assert.equal(simulation.setup_updates[0].deterministic_condition_evaluation.hard_blockers_active, 1);
  assert.equal(
    Date.parse(requestedDatasets.find((item) => item.dataset === "macro_calendar").as_of_utc),
    Date.parse("2026-06-12T01:00:00.000Z"),
  );
  assert.equal(requestedDatasets.some((item) => item.dataset === "MES_M5"), false);
});

test("Replay derives missing MNQ M15 from immutable M1 and evaluates ES through canonical MES M1", async () => {
  const store = replaySimulationStore();
  const basePack = await store.getDeskPack();
  store.getDeskPack = async () => ({
    ...basePack,
    datasets: {
      MNQ_M1: {
        object_path: "local://MNQ_M1.csv",
        sha256: "mnq_m1_hash",
        max_timestamp_utc: "2026-06-12T01:00:00.000Z",
      },
      MES_M1: {
        object_path: "local://MES_M1.csv",
        sha256: "mes_m1_hash",
        max_timestamp_utc: "2026-06-12T01:00:00.000Z",
      },
    },
  });
  const mnqRows = runtimeMinuteRows("2026-06-12T00:30:00.000Z", "MNQ1!", 30, 100);
  const mesRows = runtimeMinuteRows("2026-06-12T00:30:00.000Z", "MES1!", 30, 5000);
  store.getDataset = async ({ dataset }) => ({
    rows: dataset === "MNQ_M1" ? mnqRows : mesRows,
    integrity: { verified: true },
  });
  const setup = {
    setup_record_id: "setup_runtime_resampling",
    setup_id: "setup_runtime_resampling",
    status: "ARMED_CONDITIONAL",
    backend_can_trigger: true,
    execution_geometry_ready: true,
    condition_engine_version: "1.2.0",
    execution_policy_version: "4.3.0",
    instrument: "MNQ",
    direction: "long",
    order_type: "MARKET",
    entry_mode: "NEXT_BAR_MARKET_AFTER_CONFIRMATION",
    entry_price: 101,
    stop_loss: 95,
    take_profit_1: 113,
    risk_pct: 0.1,
    valid_from_paris: "2026-06-12T02:30:00+02:00",
    expires_at_paris: "2026-06-12T04:00:00+02:00",
    trigger_policy: { min_score: 0.55, backend_can_trigger: true },
    conditions: [
      {
        condition_id: "mnq_required",
        predicate_type: "PRICE_RELATION",
        instrument: "MNQ",
        timeframe: "M1",
        operator: "CLOSE_ABOVE",
        parameters: { threshold: 100 },
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
  };

  const simulation = await buildReplayIntervalSimulation(
    store,
    {
      ...replaySimulationRun(),
      instruments: ["MNQ", "MES"],
      start_time: "2026-06-12T02:30:00+02:00",
      end_time: "2026-06-12T03:00:00+02:00",
      current_replay_time: "2026-06-12T03:00:00+02:00",
    },
    { step_id: "step_runtime_resampling", sequence: 2, timestamp_paris: "2026-06-12T03:00:00+02:00" },
    null,
    [setup],
    { from: "2026-06-12T02:30:00+02:00", to: "2026-06-12T03:00:00+02:00" },
    { utc: "2026-07-29T12:00:00.000Z", paris: "2026-07-29T14:00:00+02:00" },
  );

  const m15 = simulation.datasets.find((item) => item.instrument === "MNQ" && item.timeframe === "M15");
  const es = simulation.datasets.find((item) => item.instrument === "ES" && item.timeframe === "M1");
  const evaluated = simulation.setup_updates.find((item) => item.setup_id === setup.setup_id);
  assert.equal(m15.source_dataset, "MNQ_M1");
  assert.equal(m15.derived_from_m1, true);
  assert.equal(m15.row_count, 2);
  assert.equal(es.source_dataset, "MES_M1");
  assert.equal(es.row_count, 30);
  assert.equal(
    evaluated.conditions.find((item) => item.condition_id === "es_alignment").state,
    "SATISFIED",
  );
  assert.equal(
    evaluated.conditions.find((item) => item.condition_id === "mnq_m15_invalidation").state,
    "PENDING",
  );
  assert.equal(simulation.setup_evaluations[0].triggered, true);
  assert.ok(["OPEN", "CLOSED"].includes(simulation.position_update.status));
  assert.equal(simulation.position_update.setup_id, setup.setup_id);
});

test("Replay candle windows use closed-bar semantics without reusing a boundary candle", () => {
  const rows = [
    { timestamp_utc: "2026-06-12T00:50:00.000Z", timeframe: "5", close: 100 },
    { timestamp_utc: "2026-06-12T00:55:00.000Z", timeframe: "5", close: 101 },
    { timestamp_utc: "2026-06-12T01:00:00.000Z", timeframe: "5", close: 102 },
  ];
  const first = filterReplayClosedRows(rows, {
    from: "2026-06-12T00:50:00.000Z",
    to: "2026-06-12T01:00:00.000Z",
    timeframe: "M5",
  });
  const second = filterReplayClosedRows(rows, {
    from: "2026-06-12T01:00:00.000Z",
    to: "2026-06-12T01:05:00.000Z",
    timeframe: "M5",
  });

  assert.deepEqual(first.map((row) => row.close), [100, 101]);
  assert.deepEqual(second.map((row) => row.close), [102]);
  assert.equal(new Set([...first, ...second].map((row) => row.timestamp_utc)).size, 3);
});

function runtimeMinuteRows(startUtc, symbolCode, count, base) {
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

test("position engine quarantines a candle that touches stop and target", () => {
  const result = evaluatePositionOnRows({
    position_id: "ambiguous",
    status: "OPEN",
    instrument: "MNQ",
    direction: "long",
    order_type: "LIMIT",
    entry_mode: "LIMIT_TOUCH",
    entry_price: 100,
    initial_stop_loss: 98,
    stop_loss: 98,
    take_profit_1: 104,
  }, [{
    timestamp_utc: "2026-07-22T14:05:00.000Z",
    high: 105,
    low: 97,
    close: 101,
  }], { tick: { utc: "2026-07-22T14:05:00.000Z", paris: "2026-07-22T16:05:00+02:00" } });

  assert.equal(result.changed, true);
  assert.equal(result.ambiguous, true);
  assert.equal(result.reason, "AMBIGUOUS_INTRABAR_PATH");
  assert.equal(result.position.status, "REVIEW_REQUIRED");
  assert.equal(result.position.exit_price, undefined);
});

test("position engine protects at break-even on a later closed candle", () => {
  const position = buildPositionFromTriggeredSetup({
    setup: {
      setup_record_id: "setup_be",
      setup_id: "setup_be",
      instrument: "MNQ",
      direction: "long",
      order_type: "LIMIT",
      entry_mode: "LIMIT_TOUCH",
      entry_price: 100,
      stop_loss: 98,
      take_profit_1: 108,
    },
    run: { backtest_id: "run_be", replay_run_id: "run_be", strategy_id: "v4", trading_date: "2026-07-22" },
    step: { step_id: "step_be" },
    monitor: { monitor_id: "monitor_be" },
    trigger: { trigger_price: 100, trigger_row: { timestamp_utc: "2026-07-22T14:00:00.000Z", timestamp_paris: "2026-07-22T16:00:00+02:00" } },
    tick: { utc: "2026-07-22T14:00:00.000Z", paris: "2026-07-22T16:00:00+02:00" },
    makePositionId: () => "position_be",
  });
  const protectedResult = evaluatePositionOnRows(position, [{
    timestamp_utc: "2026-07-22T14:05:00.000Z",
    timestamp_paris: "2026-07-22T16:05:00+02:00",
    high: 101.5,
    low: 99.5,
    close: 101,
  }], { tick: { utc: "2026-07-22T14:05:00.000Z", paris: "2026-07-22T16:05:00+02:00" } });

  assert.equal(protectedResult.reason, "STOP_MOVED_TO_BREAK_EVEN");
  assert.equal(protectedResult.position.status, "PROTECTED");
  assert.equal(protectedResult.position.stop_loss, 100);
  assert.equal(protectedResult.position.mfe_r, 0.75);

  const closedResult = evaluatePositionOnRows(protectedResult.position, [{
    timestamp_utc: "2026-07-22T14:10:00.000Z",
    timestamp_paris: "2026-07-22T16:10:00+02:00",
    high: 101,
    low: 99.75,
    close: 100,
  }], { tick: { utc: "2026-07-22T14:10:00.000Z", paris: "2026-07-22T16:10:00+02:00" } });

  assert.equal(closedResult.position.status, "CLOSED");
  assert.equal(closedResult.position.exit_reason, "STOP_LOSS_HIT");
  assert.equal(closedResult.position.exit_price, 100);
  assert.equal(closedResult.position.result_r, 0);
  assert.equal(closedResult.position.mfe_r, 0.75);
});

test("TP1 closes an integer partial and protects the remainder at break-even", () => {
  const position = buildPositionFromTriggeredSetup({
    setup: {
      setup_record_id: "setup_partial",
      setup_id: "setup_partial",
      instrument: "MES",
      direction: "long",
      order_type: "LIMIT",
      entry_mode: "LIMIT_TOUCH",
      entry_price: 100,
      stop_loss: 98,
      take_profit_1: 104,
      targets: [104, 108],
      quantity: 2,
      management_policy: { break_even_at_r: 0.7, tp1_close_fraction: 0.5 },
    },
    run: { backtest_id: "run_partial", replay_run_id: "run_partial", strategy_id: "v4", trading_date: "2026-07-22" },
    step: { step_id: "step_partial" },
    monitor: { monitor_id: "monitor_partial" },
    trigger: { trigger_price: 100, trigger_row: { timestamp_utc: "2026-07-22T14:00:00.000Z", timestamp_paris: "2026-07-22T16:00:00+02:00" } },
    tick: { utc: "2026-07-22T14:00:00.000Z", paris: "2026-07-22T16:00:00+02:00" },
    makePositionId: () => "position_partial",
  });
  const partial = evaluatePositionOnRows(position, [{
    timestamp_utc: "2026-07-22T14:05:00.000Z",
    timestamp_paris: "2026-07-22T16:05:00+02:00",
    high: 104.25,
    low: 99.5,
    close: 104,
  }], { tick: { utc: "2026-07-22T14:05:00.000Z", paris: "2026-07-22T16:05:00+02:00" } });

  assert.equal(partial.reason, "TAKE_PROFIT_1_PARTIAL_AND_BREAK_EVEN");
  assert.equal(partial.position.status, "PARTIAL_TAKEN");
  assert.equal(partial.position.remaining_quantity, 1);
  assert.equal(partial.position.exit_fills[0].quantity, 1);
  assert.equal(partial.position.stop_loss, 100);
  assert.equal(partial.position.take_profit_1, 108);

  const final = evaluatePositionOnRows(partial.position, [{
    timestamp_utc: "2026-07-22T14:10:00.000Z",
    timestamp_paris: "2026-07-22T16:10:00+02:00",
    high: 104.5,
    low: 99.75,
    close: 100,
  }], { tick: { utc: "2026-07-22T14:10:00.000Z", paris: "2026-07-22T16:10:00+02:00" } });

  assert.equal(final.position.status, "CLOSED");
  assert.equal(final.position.exit_price, 100);
  assert.equal(final.position.result_r, 1);
  assert.equal(final.position.outcome.evidence.exit_fills.length, 2);
});

test("position engine continues the same batch after TP1 and applies the break-even stop", () => {
  const position = buildPositionFromTriggeredSetup({
    setup: {
      setup_record_id: "setup_partial_batch",
      setup_id: "setup_partial_batch",
      instrument: "MES",
      direction: "long",
      order_type: "LIMIT",
      entry_mode: "LIMIT_TOUCH",
      entry_price: 100,
      stop_loss: 98,
      take_profit_1: 104,
      targets: [104, 108],
      quantity: 2,
      management_policy: { break_even_at_r: 0.7, tp1_close_fraction: 0.5 },
    },
    run: { backtest_id: "run_partial_batch", replay_run_id: "run_partial_batch", strategy_id: "v4", trading_date: "2026-07-22" },
    step: { step_id: "step_partial_batch" },
    monitor: { monitor_id: "monitor_partial_batch" },
    trigger: { trigger_price: 100, trigger_row: { timestamp_utc: "2026-07-22T14:00:00.000Z", timestamp_paris: "2026-07-22T16:00:00+02:00" } },
    tick: { utc: "2026-07-22T14:00:00.000Z", paris: "2026-07-22T16:00:00+02:00" },
    makePositionId: () => "position_partial_batch",
  });
  const result = evaluatePositionOnRows(position, [
    {
      timestamp_utc: "2026-07-22T14:05:00.000Z",
      timestamp_paris: "2026-07-22T16:05:00+02:00",
      high: 104.25,
      low: 100.5,
      close: 104,
    },
    {
      timestamp_utc: "2026-07-22T14:06:00.000Z",
      timestamp_paris: "2026-07-22T16:06:00+02:00",
      high: 104.5,
      low: 99.75,
      close: 100,
    },
  ], { tick: { utc: "2026-07-22T14:06:00.000Z", paris: "2026-07-22T16:06:00+02:00" } });

  assert.equal(result.position.status, "CLOSED");
  assert.equal(result.position.exit_reason, "STOP_LOSS_HIT");
  assert.equal(result.position.exit_price, 100);
  assert.equal(result.position.result_r, 1);
  assert.equal(result.position.outcome.evidence.exit_fills.length, 2);
});

test("daily risk gate blocks new entries after the configured loss limit", () => {
  const positions = [1, 2, 3].map((index) => ({
    position_id: `loss_${index}`,
    status: "CLOSED",
    result_r: -1,
    closed_at_paris: `2026-07-22T1${index}:00:00+02:00`,
  }));
  const gate = evaluateReplayDailyRiskGate(positions, {
    policy: {
      max_daily_loss_r: 3,
      max_consecutive_losses: 3,
      cooldown_after_loss_minutes: 30,
    },
    at: "2026-07-22T14:00:00+02:00",
  });

  assert.equal(gate.blocked, true);
  assert.equal(gate.reason, "MAX_DAILY_LOSS_REACHED");
  assert.equal(gate.realized_r, -3);
  assert.equal(gate.consecutive_losses, 3);
});

test("run result certification rejects ambiguous or still-open positions", () => {
  const rejected = certifyReplayRunResult({
    run: { aggregate_eligible: true },
    positions: [
      { position_id: "open", status: "OPEN" },
      { position_id: "ambiguous", status: "REVIEW_REQUIRED" },
    ],
    simulations: [],
    setups: [],
  });
  assert.equal(rejected.certified, false);
  assert.equal(rejected.result_eligible, false);
  assert.equal(rejected.aggregate_eligible, false);
  assert.deepEqual(
    rejected.findings.map((finding) => finding.code),
    ["AMBIGUOUS_INTRABAR_POSITIONS", "OPEN_POSITIONS_AT_RUN_END"],
  );

  const certified = certifyReplayRunResult({
    run: { aggregate_eligible: true, position_engine_version: "3.0.0" },
    positions: [{ position_id: "closed", status: "CLOSED", result_r: 1 }],
    simulations: [{ future_prices_used: false }],
    setups: [{ status: "TRIGGERED", linked_position_id: "closed" }],
  });
  assert.equal(certified.certified, true);
  assert.equal(certified.status, "CERTIFIED_ENGINE_V3");
  assert.equal(certified.aggregate_eligible, true);
});

test("a structured Master no-setup proof certifies a valid no-opportunity day", () => {
  const certification = certifyReplayRunResult({
    run: {
      aggregate_eligible: true,
      position_engine_version: "3.0.0",
      replay_execution_policy_version: "3.0.0",
    },
    positions: [],
    simulations: [],
    setups: [],
    masterAnalyses: [{
      no_setup_proof: {
        best_long: { status: "REJECTED" },
        best_short: { status: "REJECTED" },
        blocking_reasons: ["No confirmed entry with RR >= 2."],
        wait_to_go_conditions: ["Wait for a closed M5 breakout."],
        revalidation_triggers: ["Re-evaluate at the next Master."],
      },
    }],
  });

  assert.equal(certification.certified, true);
  assert.equal(certification.status, "VALID_NO_OPPORTUNITY");
  assert.equal(certification.no_setup_proof_count, 1);
  assert.deepEqual(certification.findings, []);
});

test("replan requests are debounced unless a hard invalidation is explicit", () => {
  const run = {
    backtest_id: "run_replan",
    risk_policy: { min_replan_interval_minutes: 60 },
    last_replan_at_paris: "2026-06-11T17:30:00+02:00",
  };
  const step = { step_id: "step_replan", timestamp_paris: "2026-06-11T17:45:00+02:00" };
  const tick = { utc: "2026-06-11T15:45:00.000Z", paris: step.timestamp_paris };
  const debounced = buildReplayMonitorApplication(run, step, {
    monitor_id: "monitor_replan",
    monitor_decision: { action: "REPLAN_FULL" },
  }, [], tick, { activeThesis: { thesis_id: "thesis_active", status: "ACTIVE" } });
  assert.equal(debounced.run_status, "WAITING_NEXT_STEP");
  assert.equal(debounced.replan_debounced, true);

  const hard = buildReplayMonitorApplication(run, step, {
    monitor_id: "monitor_hard_replan",
    monitor_decision: { action: "REPLAN_FULL", hard_invalidation: true },
  }, [], tick);
  assert.equal(hard.run_status, "REPLAN_REQUIRED");
});

test("extracted builder preserves Replay IDs, scope and price geometry", () => {
  const args = {
    setup: { setup_record_id: "setup_1", setup_id: "setup", instrument: "MNQ", direction: "long", order_type: "LIMIT", entry_mode: "LIMIT_TOUCH", entry_price: 100, stop_loss: 98, take_profit_1: 104 },
    run: { backtest_id: "run_1", replay_run_id: "run_1", strategy_id: "ny_open_1530", trading_date: "2026-07-22", pack_id: "pack", pack_build_id: "build" },
    step: { step_id: "step_1" },
    monitor: { monitor_id: "monitor_1" },
    trigger: { trigger_price: 100, trigger_row: { timestamp_utc: "2026-07-22T14:05:00.000Z", timestamp_paris: "2026-07-22T16:05:00+02:00" } },
    tick: { utc: "2026-07-22T14:15:00.000Z", paris: "2026-07-22T16:15:00+02:00" },
    makePositionId: () => "position_1",
  };
  assert.deepEqual(buildPositionFromTriggeredSetup(args), buildReplayPositionFromTriggeredSetup(args));
});

test("Replay monitor never erases a terminal position with an incomplete TRIGGER_GO", () => {
  const run = { backtest_id: "run_1", replay_run_id: "run_1", strategy_id: "asia_open", trading_date: "2026-06-11" };
  const step = { step_id: "step_10", timestamp_paris: "2026-06-11T03:00:00+02:00" };
  const tick = { utc: "2026-07-27T12:00:00.000Z", paris: "2026-07-27T14:00:00+02:00" };
  const closed = {
    position_id: "position_1",
    status: "CLOSED",
    instrument: "MNQ",
    direction: "short",
    order_type: "LIMIT",
    entry_mode: "LIMIT_TOUCH",
    entry_price: 28440,
    initial_stop_loss: 28520,
    stop_loss: 28520,
    take_profit_1: 28340,
    exit_price: 28340,
    closed_at_utc: "2026-06-11T01:00:00.000Z",
  };
  const result = buildReplayMonitorApplication(run, step, {
    monitor_id: "monitor_10",
    monitor_decision: { action: "TRIGGER_GO", instrument: null, direction: null, entry_price: null, stop_loss: null },
  }, [closed], tick);

  assert.equal(result.position, closed);
  assert.equal(result.run_status, "WAITING_NEXT_STEP");
  assert.match(result.note, /normalized to ARM_SETUP/);
});

test("Replay monitor never creates a position directly even from complete GPT geometry", () => {
  const run = { backtest_id: "run_1", replay_run_id: "run_1", strategy_id: "asia_open", trading_date: "2026-06-11" };
  const step = { step_id: "step_20", timestamp_paris: "2026-06-11T15:30:00+02:00" };
  const tick = { utc: "2026-07-27T12:00:00.000Z", paris: "2026-07-27T14:00:00+02:00" };
  const closed = { position_id: "position_1", status: "CLOSED", instrument: "MNQ", direction: "short", entry_price: 100, initial_stop_loss: 102, exit_price: 96 };
  const result = buildReplayMonitorApplication(run, step, {
    monitor_id: "monitor_20",
    monitor_decision: { action: "TRIGGER_GO", instrument: "MNQ", direction: "long", entry_price: 105, stop_loss: 103, take_profit_1: 109 },
  }, [closed], tick);

  assert.equal(result.position.position_id, closed.position_id);
  assert.equal(result.position.status, "CLOSED");
  assert.equal(result.action, "ARM_SETUP");
  assert.equal(result.trigger_deferred_to_engine, true);
});

test("Replay monitor manages the open position even when a newer terminal position exists", () => {
  const run = { backtest_id: "run_1", replay_run_id: "run_1", strategy_id: "asia_open", trading_date: "2026-06-11" };
  const step = { step_id: "step_20b", timestamp_paris: "2026-06-11T15:45:00+02:00" };
  const tick = { utc: "2026-07-27T12:00:00.000Z", paris: "2026-07-27T14:00:00+02:00" };
  const closed = {
    position_id: "position_closed",
    status: "CLOSED",
    instrument: "MNQ",
    direction: "short",
    order_type: "LIMIT",
    entry_mode: "LIMIT_TOUCH",
    entry_price: 100,
    exit_price: 98,
    updated_at: "2026-07-27T11:59:00.000Z",
  };
  const open = {
    position_id: "position_open",
    status: "OPEN",
    instrument: "MES",
    direction: "long",
    order_type: "LIMIT",
    entry_mode: "LIMIT_TOUCH",
    entry_price: 7400,
    stop_loss: 7395,
    initial_stop_loss: 7395,
    take_profit_1: 7410,
    initial_quantity: 1,
    remaining_quantity: 1,
    updated_at: "2026-07-27T11:58:00.000Z",
  };
  const result = buildReplayMonitorApplication(run, step, {
    monitor_id: "monitor_20b",
    monitor_decision: { action: "MOVE_STOP_BE" },
  }, [closed, open], tick, {
    simulation: {
      market_marks: [{
        instrument: "MES",
        dataset: "MES_M5",
        timestamp_utc: "2026-06-11T13:45:00.000Z",
        close: 7404,
      }],
    },
  });

  assert.equal(result.position.position_id, "position_open");
  assert.equal(result.position.status, "PROTECTED");
  assert.equal(result.position.stop_loss, 7400);
});

test("Replay monitor partial management creates an integer fill at the immutable mark", () => {
  const open = {
    position_id: "position_partial_monitor",
    status: "OPEN",
    instrument: "MES",
    direction: "long",
    order_type: "LIMIT",
    entry_mode: "LIMIT_TOUCH",
    entry_price: 7400,
    initial_stop_loss: 7395,
    stop_loss: 7395,
    take_profit_1: 7410,
    targets: [7410, 7420],
    initial_quantity: 2,
    remaining_quantity: 2,
    management_policy: { tp1_close_fraction: 0.5, break_even_at_r: 0.7 },
  };
  const result = buildReplayMonitorApplication(
    { backtest_id: "run_partial_monitor" },
    { step_id: "step_partial_monitor", timestamp_paris: "2026-06-11T15:45:00+02:00" },
    {
      monitor_id: "monitor_partial",
      as_of_utc: "2026-06-11T13:45:00.000Z",
      monitor_decision: { action: "TAKE_PARTIAL" },
    },
    [open],
    { utc: "2026-07-27T12:00:00.000Z", paris: "2026-07-27T14:00:00+02:00" },
    {
      simulation: {
        market_marks: [{
          instrument: "MES",
          dataset: "MES_M5",
          timestamp_utc: "2026-06-11T13:45:00.000Z",
          close: 7408,
        }],
      },
    },
  );

  assert.equal(result.position.status, "PARTIAL_TAKEN");
  assert.equal(result.position.remaining_quantity, 1);
  assert.equal(result.position.exit_fills[0].quantity, 1);
  assert.equal(result.position.exit_fills[0].price, 7408);
  assert.equal(result.position.stop_loss, 7400);
  assert.equal(result.position.partial_fill_price_source, "immutable_replay_market_mark");
});

test("Replay Monitor V2 applies REDUCE_RISK and keeps an orthogonal replan request", () => {
  const open = {
    position_id: "position_native_reduce",
    status: "OPEN",
    instrument: "MES",
    direction: "long",
    order_type: "LIMIT",
    entry_mode: "LIMIT_TOUCH",
    entry_price: 7400,
    initial_stop_loss: 7395,
    stop_loss: 7395,
    take_profit_1: 7410,
    initial_quantity: 5,
    remaining_quantity: 5,
    management_policy: { tp1_close_fraction: 0.5 },
  };
  const result = buildReplayMonitorApplication(
    { backtest_id: "run_native_reduce" },
    { step_id: "step_native_reduce", timestamp_paris: "2026-06-11T15:45:00+02:00" },
    {
      monitor_id: "monitor_native_reduce",
      monitor_decision: { action: "ORTHOGONAL_COMMANDS" },
      deterministic_monitor_command: {
        position_request: {
          type: "REDUCE_RISK",
          position_id: "position_native_reduce",
          reduce_fraction: 0.25,
          requested_stop: null,
          reason: "Reduce exposure before event",
          authority: "GPT_REQUEST_ONLY",
        },
        replan_request: {
          type: "REQUEST",
          requested_at_paris: "2026-06-11T15:45:00+02:00",
        },
        thesis_command: { type: "MAINTAIN" },
      },
    },
    [open],
    { utc: "2026-07-27T12:00:00.000Z", paris: "2026-07-27T14:00:00+02:00" },
    {
      simulation: {
        market_marks: [{
          instrument: "MES",
          dataset: "MES_M5",
          timestamp_utc: "2026-06-11T13:45:00.000Z",
          close: 7404,
        }],
      },
    },
  );

  assert.equal(result.action, "REDUCE_RISK");
  assert.equal(result.run_status, "REPLAN_REQUIRED");
  assert.equal(result.position.remaining_quantity, 3);
  assert.equal(result.position.exit_fills[0].quantity, 2);
  assert.equal(result.position.stop_loss, 7395);
  assert.equal(result.position.risk_reduction_count, 1);
  assert.equal(result.position.tp1_taken, undefined);
});

test("Replay TRIGGER_GO with nested geometry remains deferred to the deterministic engine", () => {
  const result = buildReplayMonitorApplication(
    { backtest_id: "run_1", replay_run_id: "run_1", strategy_id: "asia_open", trading_date: "2026-06-12" },
    { step_id: "step_nested", timestamp_paris: "2026-06-12T06:00:00+02:00" },
    {
      monitor_id: "monitor_nested",
      thesis_id: "thesis_1",
      monitor_decision: {
        action: "TRIGGER_GO",
        setup: {
          setup_id: "mes_pullback",
          setup_record_id: "run_1__setup__mes_pullback",
          instrument: "MES",
          direction: "long",
          entry_zone: { min: 7397.75, max: 7402 },
          stop_loss: 7392,
          take_profit_1: 7415,
        },
      },
    },
    [],
    { utc: "2026-07-27T12:00:00.000Z", paris: "2026-07-27T14:00:00+02:00" },
  );

  assert.equal(result.position, null);
  assert.equal(result.action, "ARM_SETUP");
  assert.equal(result.requested_action, "TRIGGER_GO");
  assert.equal(result.trigger_deferred_to_engine, true);
});

test("Replay position merge preserves immutable geometry when a later patch contains nulls", () => {
  const existing = { position_id: "position_1", instrument: "MNQ", direction: "short", order_type: "LIMIT", entry_mode: "LIMIT_TOUCH", entry_price: 28440, initial_stop_loss: 28520, status: "OPEN" };
  const merged = mergeReplayPositionState(existing, { position_id: "position_1", instrument: null, direction: null, entry_price: null, status: "CLOSED", exit_price: 28340 });
  assert.deepEqual(merged, {
    position_id: "position_1",
    instrument: "MNQ",
    direction: "short",
    order_type: "LIMIT",
    entry_mode: "LIMIT_TOUCH",
    entry_price: 28440,
    initial_stop_loss: 28520,
    status: "CLOSED",
    exit_price: 28340,
  });
});

test("Replay EXIT_POSITION ignores GPT touch flags and uses the immutable interval mark", () => {
  const run = { backtest_id: "run_1", replay_run_id: "run_1", strategy_id: "asia_open", trading_date: "2026-06-11" };
  const step = { step_id: "step_21", timestamp_paris: "2026-06-11T02:45:00+02:00" };
  const tick = { utc: "2026-07-27T12:00:00.000Z", paris: "2026-07-27T14:00:00+02:00" };
  const open = {
    position_id: "position_1",
    status: "OPEN",
    instrument: "MES",
    direction: "long",
    order_type: "LIMIT",
    entry_mode: "LIMIT_TOUCH",
    entry_price: 7419.75,
    initial_stop_loss: 7413.5,
    stop_loss: 7413.5,
    take_profit_1: 7432,
    initial_quantity: 1,
    remaining_quantity: 1,
  };
  const result = buildReplayMonitorApplication(run, step, {
    monitor_id: "monitor_21",
    as_of_utc: "2026-06-11T00:45:00.000Z",
    monitor_decision: { action: "EXIT_POSITION" },
    position_check: {
      stop_touched: true,
      stop_loss: 7413.5,
      current_price: 7413.75,
    },
  }, [open], tick, {
    simulation: {
      market_marks: [{
        instrument: "MES",
        dataset: "MES_M5",
        timestamp_utc: "2026-06-11T00:45:00.000Z",
        close: 7413.5,
      }],
    },
  });

  assert.equal(result.position.status, "CLOSED");
  assert.equal(result.position.exit_reason, "MONITOR_EXIT_POSITION");
  assert.equal(result.position.exit_price, 7413.5);
  assert.equal(result.position.result_R, -1);
  assert.equal(result.position.outcome_schema_version, "trade_outcome_v1");
  assert.equal(result.position.exit_price_source, "immutable_replay_market_mark");
});

test("Replay EXIT_POSITION uses the immutable interval mark when GPT provides no price", () => {
  const run = { backtest_id: "run_1", replay_run_id: "run_1", strategy_id: "asia_open", trading_date: "2026-06-11" };
  const step = { step_id: "step_22", timestamp_paris: "2026-06-11T02:45:00+02:00" };
  const tick = { utc: "2026-07-27T12:00:00.000Z", paris: "2026-07-27T14:00:00+02:00" };
  const open = {
    position_id: "position_1",
    status: "OPEN",
    instrument: "MES",
    direction: "long",
    order_type: "LIMIT",
    entry_mode: "LIMIT_TOUCH",
    entry_price: 7419.75,
    initial_stop_loss: 7413.5,
    stop_loss: 7413.5,
    initial_quantity: 1,
    remaining_quantity: 1,
  };
  const result = buildReplayMonitorApplication(run, step, {
    monitor_id: "monitor_22",
    as_of_utc: "2026-06-11T00:45:00.000Z",
    monitor_decision: { action: "EXIT_POSITION" },
  }, [open], tick, {
    simulation: {
      market_marks: [{
        instrument: "MES",
        dataset: "MES_M5",
        timestamp_utc: "2026-06-11T00:45:00.000Z",
        close: 7413.75,
      }],
    },
  });

  assert.equal(result.position.status, "CLOSED");
  assert.equal(result.position.exit_price, 7413.75);
  assert.equal(result.position.result_R, -0.96);
  assert.equal(result.position.exit_price_source, "immutable_replay_market_mark");
  assert.equal(result.position.exit_price_dataset, "MES_M5");
});

test("Replay EXIT_POSITION stays open when neither immutable nor explicit price exists", () => {
  const open = {
    position_id: "position_1",
    status: "OPEN",
    instrument: "MES",
    direction: "long",
    order_type: "LIMIT",
    entry_mode: "LIMIT_TOUCH",
    entry_price: 7419.75,
    initial_stop_loss: 7413.5,
    stop_loss: 7413.5,
    initial_quantity: 1,
    remaining_quantity: 1,
  };
  const result = buildReplayMonitorApplication(
    { backtest_id: "run_1" },
    { step_id: "step_23", timestamp_paris: "2026-06-11T03:00:00+02:00" },
    { monitor_decision: { action: "EXIT_POSITION" } },
    [open],
    { utc: "2026-07-27T12:00:00.000Z", paris: "2026-07-27T14:00:00+02:00" },
  );

  assert.equal(result.position.status, "OPEN");
  assert.equal(result.position.exit_price, undefined);
  assert.match(result.note, /deferred/);
});

test("a closed Replay position without exit price remains unpriced", () => {
  const trade = replayPositionToSimulatedTrade({
    position_id: "position_1",
    status: "CLOSED",
    direction: "long",
    order_type: "LIMIT",
    entry_mode: "LIMIT_TOUCH",
    entry_price: 7419.75,
    initial_stop_loss: 7413.5,
    exit_price: null,
    closed_at_paris: "2026-06-11T02:45:00+02:00",
  });

  assert.equal(trade.exit_price, null);
  assert.equal(trade.r_result, null);
});

test("an open Replay position exposes deterministic mark-to-market R while the run advances", () => {
  const marked = markPositionAtPrice({
    position_id: "position_1",
    status: "OPEN",
    direction: "short",
    order_type: "LIMIT",
    entry_mode: "LIMIT_TOUCH",
    entry_price: 100,
    initial_stop_loss: 102,
  }, 99, {
    tick: { utc: "2026-06-11T08:15:00.000Z", paris: "2026-06-11T10:15:00+02:00" },
  });
  assert.equal(marked.current_price, 99);
  assert.equal(marked.unrealized_R, 0.5);
  assert.equal(marked.result_R, undefined);
});

test("setup entry bounds are persisted in canonical ascending order with the execution rule made explicit", () => {
  assert.deepEqual(canonicalSetupEntryGeometry({
    direction: "short",
    entry_zone: { from: 22455, to: 22445 },
  }), {
    entry_zone: { from: 22445, to: 22455 },
    execution_price: 22445,
    execution_rule: "short_lower_bound",
  });
});

test("structured targets execute once in declared causal order and preserve a runner", () => {
  const tick = { utc: "2026-07-22T14:30:00.000Z", paris: "2026-07-22T16:30:00+02:00" };
  const original = buildPositionFromTriggeredSetup({
    setup: {
      setup_id: "structured_targets",
      instrument: "MES",
      direction: "long",
      order_type: "LIMIT",
      entry_mode: "LIMIT_TOUCH",
      entry_price: 100,
      stop_loss: 98,
      quantity: 4,
      targets: [
        { target_id: "tp_partial", price: 104, action: "PARTIAL_CLOSE", close_fraction: 0.5 },
        { target_id: "protect", price: 105, action: "MOVE_STOP_BE", close_fraction: 0 },
        { target_id: "runner", price: 106, action: "RUNNER", close_fraction: 0 },
        { target_id: "final", price: 108, action: "FULL_CLOSE", close_fraction: 1 },
      ],
    },
    run: { backtest_id: "run_structured", strategy_id: "v5", trading_date: "2026-07-22" },
    step: { step_id: "step_structured" },
    trigger: { trigger_price: 100, trigger_row: { timestamp_utc: tick.utc, timestamp_paris: tick.paris } },
    tick,
    makePositionId: () => "position_structured",
  });

  const partial = evaluatePositionOnRows(original, [{ timestamp_utc: "2026-07-22T14:01:00.000Z", high: 104.25, low: 100, close: 104 }], { tick });
  assert.equal(partial.position.remaining_quantity, 2);
  assert.equal(partial.position.stop_loss, 98);
  assert.deepEqual(partial.position.executed_target_ids, ["tp_partial"]);
  assert.equal(partial.position.next_target_id, "protect");

  const duplicate = evaluatePositionOnRows(partial.position, [{ timestamp_utc: "2026-07-22T14:01:00.000Z", high: 104.25, low: 100, close: 104 }], { tick });
  assert.equal(duplicate.position.exit_fills.length, 1);
  assert.deepEqual(duplicate.position.executed_target_ids, ["tp_partial"]);

  const protectedResult = evaluatePositionOnRows(partial.position, [{ timestamp_utc: "2026-07-22T14:02:00.000Z", high: 105.25, low: 104, close: 105 }], { tick });
  assert.equal(protectedResult.position.stop_loss, 100);
  assert.deepEqual(protectedResult.position.executed_target_ids, ["tp_partial", "protect"]);

  const runner = evaluatePositionOnRows(protectedResult.position, [{ timestamp_utc: "2026-07-22T14:03:00.000Z", high: 106.25, low: 104, close: 106 }], { tick });
  assert.equal(runner.position.runner_active, true);
  assert.equal(runner.position.remaining_quantity, 2);
  assert.deepEqual(runner.position.executed_target_ids, ["tp_partial", "protect", "runner"]);

  const closed = evaluatePositionOnRows(runner.position, [{ timestamp_utc: "2026-07-22T14:04:00.000Z", high: 108.25, low: 106.5, close: 108 }], { tick });
  assert.equal(closed.position.status, "CLOSED");
  assert.equal(closed.position.exit_price, 108);
  assert.equal(closed.position.exit_reason, "TARGET_FULL_CLOSE:final");
  assert.deepEqual(closed.position.executed_target_ids, ["tp_partial", "protect", "runner", "final"]);
  assert.equal(closed.position.outcome.evidence.exit_fills.length, 2);
});

test("structured TRAIL uses only an explicit closed-bar rule and never loosens its stop", () => {
  const tick = { utc: "2026-07-22T14:30:00.000Z", paris: "2026-07-22T16:30:00+02:00" };
  const position = buildPositionFromTriggeredSetup({
    setup: {
      setup_id: "structured_trail",
      instrument: "MES",
      direction: "long",
      order_type: "LIMIT",
      entry_mode: "LIMIT_TOUCH",
      entry_price: 100,
      stop_loss: 98,
      quantity: 1,
      targets: [{ target_id: "trail", price: 104, action: "TRAIL", close_fraction: 0 }],
      management_policy: {
        disable_auto_break_even: true,
        trail_rule: { distance_points: 2, price_source: "CLOSED_BAR_CLOSE" },
      },
    },
    run: { backtest_id: "run_trail", strategy_id: "v5", trading_date: "2026-07-22" },
    step: { step_id: "step_trail" },
    trigger: { trigger_price: 100, trigger_row: { timestamp_utc: tick.utc, timestamp_paris: tick.paris } },
    tick,
    makePositionId: () => "position_trail",
  });
  const activated = evaluatePositionOnRows(position, [{ timestamp_utc: "2026-07-22T14:01:00.000Z", high: 104.25, low: 100, close: 104 }], { tick });
  assert.equal(activated.position.trailing_stop.active, true);
  assert.equal(activated.position.stop_loss, 98);
  const tightened = evaluatePositionOnRows(activated.position, [{ timestamp_utc: "2026-07-22T14:02:00.000Z", high: 105.5, low: 104, close: 105 }], { tick });
  assert.equal(tightened.position.stop_loss, 103);
  const notLoosened = evaluatePositionOnRows(tightened.position, [{ timestamp_utc: "2026-07-22T14:03:00.000Z", high: 104.5, low: 103.5, close: 104 }], { tick });
  assert.equal(notLoosened.position.stop_loss, 103);
});

test("structured TRAIL fails closed when no deterministic rule is available", () => {
  const position = {
    position_id: "position_trail_missing",
    status: "OPEN",
    instrument: "MES",
    direction: "long",
    order_type: "LIMIT",
    entry_mode: "LIMIT_TOUCH",
    entry_price: 100,
    initial_stop_loss: 98,
    stop_loss: 98,
    remaining_quantity: 1,
    initial_quantity: 1,
    targets: [{ target_id: "trail", price: 104, action: "TRAIL", close_fraction: 0 }],
  };
  const result = evaluatePositionOnRows(position, [{ timestamp_utc: "2026-07-22T14:01:00.000Z", high: 104.25, low: 100, close: 104 }]);
  assert.equal(result.position.status, "REVIEW_REQUIRED");
  assert.equal(result.position.target_execution_error.code, "TARGET_TRAIL_RULE_REQUIRED");
  assert.deepEqual(result.position.executed_target_ids, undefined);
});


test("structured target transitions are identical through Live and Replay facades", () => {
  const position = {
    position_id: "position_structured_parity",
    status: "OPEN",
    instrument: "MES",
    direction: "long",
    order_type: "LIMIT",
    entry_mode: "LIMIT_TOUCH",
    entry_price: 100,
    initial_stop_loss: 98,
    stop_loss: 98,
    initial_quantity: 4,
    remaining_quantity: 4,
    targets: [
      { target_id: "partial", price: 104, action: "PARTIAL_CLOSE", close_fraction: 0.5 },
      { target_id: "protect", price: 105, action: "MOVE_STOP_BE", close_fraction: 0 },
      { target_id: "final", price: 108, action: "FULL_CLOSE", close_fraction: 1 },
    ],
  };
  const tick = { utc: "2026-07-22T14:30:00.000Z", paris: "2026-07-22T16:30:00+02:00" };
  const rows = [
    { timestamp_utc: "2026-07-22T14:01:00.000Z", high: 104.25, low: 100, close: 104 },
    { timestamp_utc: "2026-07-22T14:02:00.000Z", high: 105.25, low: 104, close: 105 },
    { timestamp_utc: "2026-07-22T14:03:00.000Z", high: 108.25, low: 106, close: 108 },
  ];

  let live = position;
  let replay = position;
  for (const row of rows) {
    const liveResult = evaluatePositionOnRows(live, [row], { tick });
    const replayResult = evaluateReplayPositionOnRows(replay, [row], { tick });
    assert.deepEqual(liveResult, replayResult);
    live = liveResult.position;
    replay = replayResult.position;
  }
  assert.equal(live.status, "CLOSED");
  assert.deepEqual(live.executed_target_ids, ["partial", "protect", "final"]);
});


test("invalid structured target plans fail closed instead of falling back to legacy target logic", () => {
  const base = {
    position_id: "position_invalid_targets",
    status: "OPEN",
    instrument: "MES",
    direction: "long",
    order_type: "LIMIT",
    entry_mode: "LIMIT_TOUCH",
    entry_price: 100,
    initial_stop_loss: 98,
    stop_loss: 98,
    initial_quantity: 4,
    remaining_quantity: 4,
  };
  const invalidFraction = evaluatePositionOnRows({
    ...base,
    targets: [{ target_id: "partial", price: 104, action: "PARTIAL_CLOSE", close_fraction: 0 }],
  }, [{ timestamp_utc: "2026-07-22T14:01:00.000Z", high: 105, low: 100, close: 104 }]);
  assert.equal(invalidFraction.position.status, "REVIEW_REQUIRED");
  assert.equal(invalidFraction.position.target_execution_error.code, "TARGET_PLAN_INVALID");
  assert.equal(
    invalidFraction.position.target_execution_error.violations.some((item) => item.code === "TARGET_PARTIAL_FRACTION_REQUIRED"),
    true,
  );
  assert.equal(invalidFraction.position.exit_fills, undefined);

  const duplicate = evaluatePositionOnRows({
    ...base,
    targets: [
      { target_id: "same", price: 104, action: "PARTIAL_CLOSE", close_fraction: 0.5 },
      { target_id: "same", price: 108, action: "FULL_CLOSE", close_fraction: 1 },
    ],
  }, [{ timestamp_utc: "2026-07-22T14:01:00.000Z", high: 105, low: 100, close: 104 }]);
  assert.equal(
    duplicate.position.target_execution_error.violations.some((item) => item.code === "TARGET_ID_DUPLICATE"),
    true,
  );
});
