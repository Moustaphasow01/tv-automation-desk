import { ACTIVE_STRATEGY_RUNTIME_VERSIONS } from "../../src/strategy-runtime-versioning.js";
import { makeNativeMasterV5, makeNativeMonitorV2 } from "./native-strategy-fixtures.js";

export const LIVE_SAVE_VERSION_PINS = Object.freeze({
  execution_policy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy,
  execution_plan_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan,
  monitor_command_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command,
  condition_catalog_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog,
  deterministic_compiler_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
  condition_engine_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_engine,
});

export function makeActiveLiveMasterSave({
  scope,
  analysisId,
  thesisId = `thesis-${analysisId}`,
  planId = `plan-${analysisId}`,
  setupId = null,
  bundleId = `bundle-${analysisId}`,
  packId = `${scope.trading_date || scope.date}_${scope.session}`,
  packBuildId = `packbuild-${analysisId}`,
  outputMutator = null,
  overrides = {},
} = {}) {
  const cutoffParis = scope.cutoff_paris || scope.created_at_paris;
  const analysisOutput = makeNativeMasterV5({
    mode: "LIVE",
    tradingDate: scope.trading_date || scope.date,
    session: scope.session,
    runId: scope.run_id,
    cutoffParis,
    analysisId,
    bundleId,
    packId,
    packBuildId,
    planId,
    thesisId,
    setupId,
  });
  if (!setupId) {
    const waitProbe = makeNativeMasterV5({ setupId: `wait-probe-${analysisId}` })
      .execution_plan.setups[0].conditions[0];
    analysisOutput.execution_plan.disposition = "WAIT_NO_SETUP";
    analysisOutput.execution_plan.no_setup_proof = {
      best_long: {
        instrument: "MNQ",
        pattern: "PULLBACK",
        rejection_reasons: ["No valid long geometry at this cutoff"],
        revalidation_trigger: "Next closed M5 checkpoint",
      },
      best_short: {
        instrument: "MNQ",
        pattern: "BREAKDOWN_RETEST",
        rejection_reasons: ["No valid short geometry at this cutoff"],
        revalidation_trigger: "Next closed M5 checkpoint",
      },
      blocking_reasons: ["No setup satisfies deterministic geometry yet"],
      wait_to_go_conditions: [waitProbe],
      revalidation_triggers: ["Next closed M5 checkpoint"],
    };
  }
  if (typeof outputMutator === "function") outputMutator(analysisOutput);
  return {
    ...scope,
    analysis_id: analysisId,
    bundle_id: bundleId,
    pack_id: packId,
    pack_build_id: packBuildId,
    plan_id: planId,
    thesis_id: thesisId,
    contract_name: "DeskMasterAnalysisContract",
    schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.master_contract,
    ...LIVE_SAVE_VERSION_PINS,
    contract_hash: "test-master-v5-1-hash",
    created_at_paris: cutoffParis,
    analysis_output: analysisOutput,
    ...overrides,
  };
}

export function makeActiveLiveMonitorSave({
  scope,
  monitorId,
  masterId,
  thesisId,
  planId = `plan-${masterId}`,
  setupId = null,
  expectedRevision = 0,
  bundleId = `bundle-${monitorId}`,
  packId = `${scope.trading_date || scope.date}_${scope.session}`,
  packBuildId = `packbuild-${masterId}`,
  outputMutator = null,
  overrides = {},
} = {}) {
  const cutoffParis = scope.cutoff_paris || scope.timestamp_paris;
  const monitorOutput = makeNativeMonitorV2({
    mode: "LIVE",
    tradingDate: scope.trading_date || scope.date,
    session: scope.session,
    runId: scope.run_id,
    cutoffParis,
    monitorId,
    bundleId,
    packId,
    packBuildId,
    masterId,
    planId,
    thesisId,
    commandId: `command-${monitorId}`,
    expectedRevision,
    setupId,
  });
  if (typeof outputMutator === "function") outputMutator(monitorOutput);
  return {
    ...scope,
    monitor_id: monitorId,
    bundle_id: bundleId,
    pack_id: packId,
    pack_build_id: packBuildId,
    linked_master_analysis_id: masterId,
    linked_active_thesis_id: thesisId,
    plan_id: planId,
    expected_revision: expectedRevision,
    timestamp_paris: cutoffParis,
    contract_name: "DeskHourlyThesisMonitorContract",
    schema_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_contract,
    ...LIVE_SAVE_VERSION_PINS,
    contract_hash: "test-monitor-v2-1-hash",
    monitor_output: monitorOutput,
    ...overrides,
  };
}
