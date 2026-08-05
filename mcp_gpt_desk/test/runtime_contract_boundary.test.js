import assert from "node:assert/strict";
import test from "node:test";
import {
  RUNTIME_CONTRACT_MATRIX,
  assertRuntimeContractMatrix,
} from "../src/desk-contract-service.js";
import { pinReplaySources } from "../src/desk-replay-orchestration-algorithms.js";
import { ACTIVE_STRATEGY_RUNTIME_VERSIONS } from "../src/strategy-runtime-versioning.js";

function runtimeContracts() {
  return Object.fromEntries(Object.entries(RUNTIME_CONTRACT_MATRIX).map(([slot, expected]) => [
    slot,
    {
      ...expected,
      status: "active",
      is_active: true,
      hash: `hash-${slot}`,
    },
  ]));
}

test("runtime contract matrix accepts only the exact active V5/V2 stack", () => {
  const contracts = runtimeContracts();
  assert.equal(assertRuntimeContractMatrix(contracts), contracts);

  const legacy = runtimeContracts();
  legacy.master_contract = {
    ...legacy.master_contract,
    contract_id: "DeskMasterAnalysisContract_v4_0_0",
    schema_version: "4.0.0",
  };
  assert.throws(
    () => assertRuntimeContractMatrix(legacy, { operation: "test_legacy" }),
    (error) => error?.code === "RUNTIME_CONTRACT_MATRIX_MISMATCH"
      && error.details.mismatches.some((item) => item.slot === "master_contract"),
  );
});

test("new Replay source pin rejects legacy analytical contracts", () => {
  const contracts = runtimeContracts();
  const run = {
    backtest_id: "replay-v5",
    pack_id: "pack-v5",
    pack_build_id: "build-v5",
    strategy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.strategy_version,
    autopilot_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.autopilot_version,
    replay_execution_policy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy,
    execution_plan_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan,
    monitor_command_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command,
    condition_catalog_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog,
    deterministic_compiler_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
    condition_engine_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_engine,
  };
  const pack = {
    pack_id: "pack-v5",
    pack_build_id: "build-v5",
    pack_purpose: "replay_source",
    source_manifest_hash: "manifest-v5",
    source_coverage: {
      mode: "full_replay_range",
      start_utc: "2026-06-11T00:00:00.000Z",
      end_utc: "2026-06-11T23:59:00.000Z",
    },
    datasets: {},
  };
  const tick = {
    utc: "2026-07-30T12:00:00.000Z",
    paris: "2026-07-30T14:00:00+02:00",
  };
  const pinned = pinReplaySources(run, pack, contracts, "creation-hash", tick);
  assert.equal(pinned.pinned_contracts.master_contract.schema_version, "5.4.0");
  assert.equal(pinned.pinned_contracts.monitor_contract.schema_version, "2.4.0");

  const legacy = runtimeContracts();
  legacy.monitor_contract = {
    ...legacy.monitor_contract,
    contract_id: "DeskHourlyThesisMonitorContract_v1_0_0",
    schema_version: "1.0.0",
  };
  assert.throws(
    () => pinReplaySources(run, pack, legacy, "creation-hash", tick),
    (error) => error?.code === "RUNTIME_CONTRACT_MATRIX_MISMATCH",
  );
});
