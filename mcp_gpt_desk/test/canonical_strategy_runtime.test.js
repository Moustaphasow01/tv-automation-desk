import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeMasterStrategyPayload,
  canonicalizeMonitorStrategyPayload,
} from "../src/canonical-strategy-runtime.js";
import { evaluateReplaySetupOnRows } from "../src/replay-continuity.js";
import {
  makeNativeMasterV5,
  makeNativeMonitorV2,
} from "./support/native-strategy-fixtures.js";

function masterTransport(overrides = {}) {
  const analysisOutput = makeNativeMasterV5({
    mode: "REPLAY",
    tradingDate: "2026-06-11",
    session: "asia_open",
    runId: "replay_v5_test",
    cutoffParis: "2026-06-11T09:00:00+02:00",
    analysisId: "master_v5_test",
    bundleId: "bundle_v5_test",
    packId: "pack_v5_test",
    packBuildId: "packbuild_v5_test",
    planId: "plan_v5_test",
    thesisId: "thesis_v5_test",
    setupId: "mnq_v5_long",
  });
  return {
    contract_name: "DeskMasterAnalysisContract",
    schema_version: "5.4.0",
    execution_policy_version: "4.3.0",
    analysis_output: analysisOutput,
    ...overrides,
  };
}

test("Master V5 persists only compiled executable fields and keeps raw output for audit", () => {
  const transport = masterTransport();
  transport.analysis_output.active_thesis.level_watchlist = [{
    instrument: "MES",
    label: "raw-only",
    price: 999,
    purpose: "ACTIVATION",
  }];
  const output = canonicalizeMasterStrategyPayload(transport, {
    workflow: "REPLAY_MASTER",
    sourceMode: "replay",
  });

  assert.equal(output.deterministic_execution_plan.valid, true);
  assert.equal(output.plan_id, "plan_v5_test");
  assert.equal(output.active_thesis.plan_id, "plan_v5_test");
  assert.deepEqual(output.active_thesis.pinned_plan, {
    plan_id: "plan_v5_test",
    scope: transport.analysis_output.execution_plan.scope,
    risk: transport.analysis_output.execution_plan.risk,
  });
  assert.equal(output.active_thesis.thesis_id, output.deterministic_execution_plan.thesis_plan.thesis_id);
  assert.equal(output.active_thesis.instrument, output.deterministic_execution_plan.thesis_plan.instrument);
  assert.equal(output.active_thesis.level_watchlist, undefined);
  assert.equal(output.analysis_output.active_thesis.level_watchlist[0].price, 999);
  assert.equal(output.setups.length, 1);
  assert.equal(output.setups[0].trigger_policy.min_score, 0.55);
  assert.equal(output.setups[0].risk_pct, 0.25);
  assert.equal(output.setups[0].rr_minimum, 2);
  assert.match(output.strategy_normalization_audit.canonical_hash, /^[a-f0-9]{64}$/);
});

test("Master V5 canonicalizes an analyst FULL_CLOSE fraction before persistence", () => {
  const transport = masterTransport();
  transport.analysis_output.execution_plan.setups[0].targets = [
    {
      target_id: "tp1",
      price: 103,
      action: "PARTIAL_CLOSE",
      close_fraction: 0.5,
    },
    {
      target_id: "tp2",
      price: 105,
      action: "FULL_CLOSE",
      close_fraction: 0.5,
    },
  ];

  const output = canonicalizeMasterStrategyPayload(transport, {
    workflow: "REPLAY_MASTER",
    sourceMode: "replay",
  });

  assert.equal(output.deterministic_execution_plan.valid, true);
  assert.deepEqual(
    output.setups[0].targets.map((target) => target.close_fraction),
    [0.5, 1],
  );
});

test("Master V5 refuses a top-level raw payload without analysis_output", () => {
  assert.throws(
    () => canonicalizeMasterStrategyPayload({
      schema_version: "5.4.0",
      execution_policy_version: "4.3.0",
    }),
    (error) => error?.code === "MASTER_V5_CANONICAL_SOURCE_REQUIRED",
  );
});

test("Monitor V2 refuses a top-level raw payload without monitor_output", () => {
  assert.throws(
    () => canonicalizeMonitorStrategyPayload({
      schema_version: "2.4.0",
      execution_policy_version: "4.3.0",
    }),
    (error) => error?.code === "MONITOR_V2_CANONICAL_SOURCE_REQUIRED",
  );
});

test("legacy Execution Policy V3 remains untouched", () => {
  const source = { execution_policy_version: "3.0.0", schema_version: "4.0.0", setups: [] };
  assert.equal(canonicalizeMasterStrategyPayload(source), source);
});

test("Monitor V2 materializes its deterministic command and never a fill", () => {
  const source = makeNativeMonitorV2({
    mode: "REPLAY",
    tradingDate: "2026-06-11",
    session: "asia_open",
    runId: "replay_v5_test",
    cutoffParis: "2026-06-11T09:05:00+02:00",
    monitorId: "monitor_v2_test",
    planId: "plan_v5_test",
    thesisId: "thesis_v5_test",
    setupId: "mnq_v5_long",
  });
  const output = canonicalizeMonitorStrategyPayload({
    contract_name: "DeskHourlyThesisMonitorContract",
    schema_version: "2.4.0",
    execution_policy_version: "4.3.0",
    monitor_output: source,
  }, {
    workflow: "REPLAY_MONITOR",
    sourceMode: "replay",
    currentState: {
      thesis: { status: "THESIS_CONDITIONAL" },
      setup: { setup_id: "mnq_v5_long", status: "ARMED_CONDITIONAL" },
      position: null,
      replan: { state: "IDLE" },
    },
  });

  assert.equal(output.deterministic_monitor_command.valid, true);
  assert.equal(output.deterministic_monitor_command.valid, true);
  assert.equal(JSON.stringify(output).includes('"FILLED"'), false);
});

test("Monitor V2 drops only a rejected legacy carrier transition when the orthogonal transition is accepted", () => {
  const source = makeNativeMonitorV2({
    mode: "REPLAY",
    tradingDate: "2026-06-11",
    session: "full_day",
    runId: "replay_v5_carrier_test",
    cutoffParis: "2026-06-11T01:30:00+02:00",
    monitorId: "monitor_v2_carrier_test",
    planId: "plan_v5_carrier_test",
    thesisId: "thesis_v5_carrier_test",
    setupId: "setup_v5_carrier_test",
  });
  source.command.requested_action = "APPLY_ORTHOGONAL_COMMANDS";
  source.command.setup_transition = {
    command: "NOOP",
    setup_id: "setup_v5_carrier_test",
    replaces_setup_id: null,
    reason: "The setup is already terminal.",
    setup: null,
  };
  source.command.transformation = {
    command: "INVALIDATE",
    target_state: "INVALIDATED",
    reason: "The thesis is structurally invalidated.",
    payload: { summary: "Invalidate the thesis.", health_score: 0 },
  };
  source.active_thesis_update.state = "INVALIDATED";
  source.active_thesis_update.health_score = 0;

  const output = canonicalizeMonitorStrategyPayload({
    contract_name: "DeskHourlyThesisMonitorContract",
    schema_version: "2.4.0",
    execution_policy_version: "4.3.0",
    monitor_output: source,
  }, {
    workflow: "REPLAY_MONITOR",
    sourceMode: "replay",
    currentState: {
      thesis: {
        thesis_id: "thesis_v5_carrier_test",
        plan_id: "plan_v5_carrier_test",
        status: "CONDITIONAL",
      },
      setup: {
        setup_id: "setup_v5_carrier_test",
        status: "INVALIDATED",
      },
      position: null,
      replan: { state: "IDLE" },
    },
  });

  assert.equal(output.deterministic_monitor_command.valid, true);
  assert.equal(output.deterministic_monitor_command.thesis_command.type, "INVALIDATE");
  assert.equal(output.deterministic_monitor_command.setup_command.type, "NOOP");
  assert.equal(output.deterministic_monitor_command.transitions.thesis.accepted, true);
  assert.equal(output.deterministic_monitor_command.transitions.setup.accepted, true);
  assert.deepEqual(output.deterministic_monitor_command.diagnostics.errors, []);
  assert.ok(output.deterministic_monitor_command.diagnostics.normalizations.some(
    (entry) => entry.code === "NATIVE_CARRIER_TRANSITION_REJECTION_DROPPED",
  ));
});

test("Condition Engine V1 triggers only on the closed bar after structural confirmation", () => {
  const setup = canonicalizeMasterStrategyPayload(masterTransport(), {
    workflow: "REPLAY_MASTER",
    sourceMode: "replay",
  }).setups[0];
  const rows = [
    candle("2026-06-11T09:01:00+02:00", { open: 100, high: 102, low: 100, close: 101 }),
    candle("2026-06-11T09:02:00+02:00", { open: 101.5, high: 103, low: 101, close: 102 }),
  ];
  const result = evaluateReplaySetupOnRows(setup, rows, {
    tick: {
      paris: "2026-06-11T09:03:00+02:00",
      utc: "2026-06-11T07:03:00.000Z",
    },
    rowsByInstrument: { MNQ: rows },
  });

  assert.equal(result.triggered, true);
  assert.equal(result.trigger_row.timestamp_paris, "2026-06-11T09:02:00+02:00");
  assert.equal(result.setup.trigger_source, "backend_condition_engine_v1");
});

function candle(timestamp, values) {
  return {
    instrument: "MNQ",
    timeframe: "M1",
    timestamp_paris: timestamp,
    closed: true,
    ...values,
  };
}


test("Monitor V2 NO_ACTION refreshes the active setup gate snapshot without a business transition", () => {
  const master = canonicalizeMasterStrategyPayload(masterTransport(), {
    workflow: "REPLAY_MASTER",
    sourceMode: "replay",
  });
  const currentSetup = master.setups[0];
  const source = makeNativeMonitorV2({
    mode: "REPLAY",
    tradingDate: "2026-06-11",
    session: "asia_open",
    runId: "replay_v5_test",
    cutoffParis: "2026-06-11T09:05:00+02:00",
    monitorId: "monitor_v2_gate_refresh",
    planId: "plan_v5_test",
    thesisId: "thesis_v5_test",
    setupId: "mnq_v5_long",
  });
  source.data_quality.status = "DEGRADED";
  source.data_quality.hard_gate_states = source.data_quality.hard_gate_states.map((gate) => (
    gate.code === "MAJOR_EVENT_ENTRY_BLOCK"
      ? { ...gate, state: "UNKNOWN", reason: "event actual pending", evidence_refs: ["calendar:event"] }
      : gate
  ));
  const output = canonicalizeMonitorStrategyPayload({
    contract_name: "DeskHourlyThesisMonitorContract",
    schema_version: "2.4.0",
    execution_policy_version: "4.3.0",
    monitor_output: source,
  }, {
    workflow: "REPLAY_MONITOR",
    sourceMode: "replay",
    currentState: {
      thesis: { thesis_id: "thesis_v5_test", plan_id: "plan_v5_test", status: "CONDITIONAL" },
      setup: currentSetup,
      position: null,
      replan: { state: "IDLE" },
    },
  });

  assert.equal(output.deterministic_monitor_command.transitions.setup.command, "NOOP");
  assert.equal(output.deterministic_monitor_command.transitions.setup.next_state, currentSetup.status);
  assert.equal(output.setup_transition.gate_snapshot_update_only, true);
  assert.equal(output.setup_transition.status, currentSetup.status);
  const gate = output.gates.find((item) => item.code === "MAJOR_EVENT_ENTRY_BLOCK");
  assert.equal(gate.state, "UNKNOWN");
  assert.deepEqual(output.setup_transition.gates, output.gates);
  assert.equal(output.setup_transition.entry_gate_evaluation.eligible, false);
  assert.ok(output.setup_transition.entry_gate_evaluation.hard_failures.some((item) => (
    item.code === "MAJOR_EVENT_ENTRY_BLOCK"
  )));
});
