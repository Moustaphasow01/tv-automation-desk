import assert from "node:assert/strict";
import test from "node:test";
import { buildBacktestRunDoc } from "../src/desk-backtest-algorithms.js";
import {
  ACTIVE_STRATEGY_RUNTIME_VERSIONS,
  assertActiveStrategyContractContext,
  assertActiveStrategyRuntimePins,
  assertActiveStrategySaveTarget,
  isActiveStrategyContractContext,
  isActiveStrategyRuntimePins,
  isHistoricalStrategyContractVersion,
} from "../src/strategy-runtime-versioning.js";

const RUN_PINS = Object.freeze({
  strategy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.strategy_version,
  autopilot_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.autopilot_version,
  replay_execution_policy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy,
  execution_plan_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan,
  monitor_command_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command,
  condition_catalog_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog,
  deterministic_compiler_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
  condition_engine_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_engine,
});

test("active runtime pins are exact and mixed historical pins cannot execute", () => {
  assert.equal(assertActiveStrategyRuntimePins(RUN_PINS), RUN_PINS);
  assert.equal(isActiveStrategyRuntimePins(RUN_PINS), true);

  const mixed = { ...RUN_PINS, replay_execution_policy_version: "4.0.0" };
  assert.equal(isActiveStrategyRuntimePins(mixed), false);
  assert.throws(
    () => assertActiveStrategyRuntimePins(mixed, { operation: "test_mixed_runtime" }),
    (error) => error?.code === "STRATEGY_RUNTIME_VERSION_MISMATCH"
      && error.details.repin_forbidden === true
      && error.details.mismatches.some(
        (entry) => entry.field === "replay_execution_policy_version"
          && entry.expected === "4.3.0"
          && entry.actual === "4.0.0",
      ),
  );
});

test("active contract context rejects historical or partially upgraded graphs", () => {
  const active = activeContractContext("REPLAY_MASTER");
  assert.equal(
    assertActiveStrategyContractContext(active, { workflow: "REPLAY_MASTER" }),
    active,
  );
  assert.equal(
    isActiveStrategyContractContext(active, { workflow: "REPLAY_MASTER" }),
    true,
  );

  const historical = {
    ...active,
    schema_version: "5.0.0",
    execution_policy: { schema_version: "4.0.0" },
  };
  assert.equal(
    isActiveStrategyContractContext(historical, { workflow: "REPLAY_MASTER" }),
    false,
  );
  assert.throws(
    () => assertActiveStrategyContractContext(historical, {
      workflow: "REPLAY_MASTER",
      operation: "test_historical_contract_context",
    }),
    (error) => error?.code === "STRATEGY_CONTRACT_VERSION_MISMATCH"
      && error.details.historical_read_remains_available === true,
  );
});

test("save targets require the complete active deterministic version graph", () => {
  const active = activeSaveTarget("LIVE_M15_MONITOR");
  assert.equal(
    assertActiveStrategySaveTarget(active, {
      workflow: "LIVE_M15_MONITOR",
      mode: "live",
    }),
    active,
  );

  assert.throws(
    () => assertActiveStrategySaveTarget({
      ...active,
      condition_engine_version: "1.0.0",
    }, {
      workflow: "LIVE_M15_MONITOR",
      mode: "live",
    }),
    (error) => error?.code === "STRATEGY_SAVE_VERSION_MISMATCH"
      && error.details.repin_forbidden === true,
  );
});

test("new backtests are pinned to V5.2 and refuse historical contract overrides", () => {
  const tick = {
    utc: "2026-08-01T12:00:00.000Z",
    paris: "2026-08-01T14:00:00+02:00",
  };
  const args = {
    date_from: "2026-06-11",
    date_to: "2026-06-11",
    session: "asia_open",
  };
  const run = buildBacktestRunDoc(args, [], tick);

  assert.equal(run.master_contract, "5.4.0");
  assert.equal(run.monitor_contract, "2.4.0");
  assert.equal(run.autopilot_version, "5.4.0");
  assert.equal(run.replay_execution_policy_version, "4.3.0");
  assert.equal(run.deterministic_compiler_version, "1.4.0");
  assert.equal(run.condition_engine_version, "1.2.0");

  assert.throws(
    () => buildBacktestRunDoc({
      ...args,
      master_contract: "5.0.0",
      monitor_contract: "2.0.0",
    }, [], tick),
    (error) => error?.code === "BACKTEST_CONTRACT_VERSION_MISMATCH"
      && error.details.historical_read_remains_available === true,
  );
});

test("historical analytical versions remain explicitly recognizable for reads", () => {
  assert.equal(
    isHistoricalStrategyContractVersion("DeskMasterAnalysisContract", "5.0.0"),
    true,
  );
  assert.equal(
    isHistoricalStrategyContractVersion("DeskHourlyThesisMonitorContract", "2.0.0"),
    true,
  );
  assert.equal(
    isHistoricalStrategyContractVersion("DeskMasterAnalysisContract", "5.1.0"),
    true,
  );
});

function activeContractContext(workflow) {
  const master = workflow.endsWith("MASTER");
  return {
    contract_name: master
      ? "DeskMasterAnalysisContract"
      : "DeskHourlyThesisMonitorContract",
    schema_version: master
      ? ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract
      : ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract,
    contract_hash: `contract-hash-${workflow}`,
    execution_policy: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy },
    execution_plan: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan },
    monitor_command: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command },
    condition_catalog: { schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog },
  };
}

function activeSaveTarget(workflow) {
  const master = workflow.endsWith("MASTER");
  return {
    contract_name: master
      ? "DeskMasterAnalysisContract"
      : "DeskHourlyThesisMonitorContract",
    schema_version: master
      ? ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract
      : ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract,
    execution_policy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy,
    execution_plan_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan,
    monitor_command_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command,
    condition_catalog_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog,
    deterministic_compiler_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
    condition_engine_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_engine,
  };
}
