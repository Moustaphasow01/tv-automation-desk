import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { FixedClock } from "@tv-automation/desk-time";
import {
  canonicalizeMasterStrategyPayload,
} from "../src/canonical-strategy-runtime.js";
import { createTestDeskStore } from "./support/test-desk-store.js";
import {
  normalizeReplayActiveThesis,
  patchReplayThesis,
} from "../src/desk-replay-orchestration-algorithms.js";
import { ACTIVE_STRATEGY_RUNTIME_VERSIONS } from "../src/strategy-runtime-versioning.js";
import { makeNativeMasterV5, makeNativeMonitorV2 } from "./support/native-strategy-fixtures.js";

const LIVE_SAVE_VERSION_PINS = Object.freeze({
  execution_policy_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_policy,
  execution_plan_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.execution_plan,
  monitor_command_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.monitor_command,
  condition_catalog_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_catalog,
  deterministic_compiler_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.deterministic_compiler,
  condition_engine_version: ACTIVE_STRATEGY_RUNTIME_VERSIONS.condition_engine,
});

test("the same native V5 plan compiles identically at Live and Replay save boundaries", () => {
  const analysisOutput = makeNativeMasterV5({
    mode: "PAPER",
    runId: "parity-run",
    analysisId: "analysis-parity",
    bundleId: "bundle-parity",
    packId: "pack-parity",
    packBuildId: "packbuild-parity",
    planId: "plan-parity",
    thesisId: "thesis-parity",
    setupId: "setup-parity",
  });
  const transport = {
    schema_version: "5.4.0",
    execution_policy_version: "4.3.0",
    analysis_output: analysisOutput,
  };

  const live = canonicalizeMasterStrategyPayload(transport, {
    workflow: "LIVE_MASTER",
    sourceMode: "live",
  });
  const replay = canonicalizeMasterStrategyPayload(transport, {
    workflow: "REPLAY_MASTER",
    sourceMode: "replay",
  });

  assert.equal(live.deterministic_execution_plan.valid, true);
  assert.equal(replay.deterministic_execution_plan.valid, true);
  assert.equal(
    live.deterministic_execution_plan.canonical_hash,
    replay.deterministic_execution_plan.canonical_hash,
  );
  const { transport_context: liveTransport, ...livePlan } = live.deterministic_execution_plan;
  const { transport_context: replayTransport, ...replayPlan } = replay.deterministic_execution_plan;
  assert.deepEqual(livePlan, replayPlan);
  assert.equal(liveTransport.source_mode, "LIVE");
  assert.equal(replayTransport.source_mode, "REPLAY");
  assert.deepEqual(live.setups, replay.setups);
  assert.equal(live.setups[0].risk_pct, 0.25);
  assert.equal(live.setups[0].rr_minimum, 2);
  assert.equal(live.setups[0].trigger_policy.min_score, 0.55);
});

test("saving a native Live Master V5 materializes its pinned thesis and canonical setup", async () => {
  const root = await mkdtemp(join(tmpdir(), "desk-master-v5-save-"));
  const cutoffParis = "2026-07-30T09:00:00+02:00";
  const cutoffUtc = "2026-07-30T07:00:00.000Z";
  const analysisId = "analysis-live-v5-persist";
  const bundleId = "bundle-live-v5-persist";
  const packId = "pack-live-v5-persist";
  const packBuildId = "packbuild-live-v5-persist";
  const planId = "plan-live-v5-persist";
  const thesisId = "thesis-live-v5-persist";
  const setupId = "setup-live-v5-persist";
  const runId = "front_live_2026-07-30";
  const { store, persistence } = createTestDeskStore({
    root,
    projectRoot: root,
    clock: new FixedClock(Date.parse(cutoffUtc)),
  });
  let masterBatch = null;
  const writeDocuments = persistence.writeDocuments.bind(persistence);
  persistence.writeDocuments = async (writes) => {
    masterBatch = writes.map((write) => ({ collection: write.collection, documentId: write.documentId }));
    return writeDocuments(writes);
  };
  const analysisOutput = makeNativeMasterV5({
    mode: "LIVE",
    tradingDate: "2026-07-30",
    session: "asia_open",
    runId,
    cutoffParis,
    analysisId,
    bundleId,
    packId,
    packBuildId,
    planId,
    thesisId,
    setupId,
  });
  analysisOutput.execution_plan.setups[0].targets = [
    { target_id: "tp1", price: 105, action: "PARTIAL_CLOSE", close_fraction: 0.25 },
    { target_id: "runner", price: 109, action: "RUNNER", close_fraction: 0.75 },
  ];
  analysisOutput.execution_plan.setups[0].management = {
    break_even_at_r: 0.7,
    tp1_close_fraction: 0.25,
  };

  const saved = await store.saveMasterAnalysis({
    strategy_id: "asia_open",
    session: "asia_open",
    mode: "live",
    date: "2026-07-30",
    trading_date: "2026-07-30",
    run_id: runId,
    as_of_utc: cutoffUtc,
    timezone: "Europe/Paris",
    analysis_id: analysisId,
    bundle_id: bundleId,
    pack_id: packId,
    pack_build_id: packBuildId,
    plan_id: planId,
    thesis_id: thesisId,
    setup_id_candidates: [setupId],
    contract_name: "DeskMasterAnalysisContract",
    schema_version: "5.4.0",
    ...LIVE_SAVE_VERSION_PINS,
    contract_hash: "contract-hash-v5",
    created_at_paris: cutoffParis,
    cutoff_paris: cutoffParis,
    analysis_output: analysisOutput,
  });

  assert.equal(saved.ok, true);
  assert.equal(saved.analysis_id, analysisId);
  assert.equal(saved.active_thesis_id, thesisId);
  assert.equal(saved.setup_count, 1);
  assert.equal(saved.setup_ids.length, 1);
  assert.deepEqual(masterBatch, [
    { collection: DESK_COLLECTIONS.deskMasterAnalyses, documentId: analysisId },
    { collection: DESK_COLLECTIONS.deskSetups, documentId: saved.setup_ids[0] },
    { collection: DESK_COLLECTIONS.deskActiveTheses, documentId: thesisId },
  ]);

  const master = persistence.peek(DESK_COLLECTIONS.deskMasterAnalyses, analysisId);
  const thesis = persistence.peek(DESK_COLLECTIONS.deskActiveTheses, thesisId);
  const setup = persistence.peek(DESK_COLLECTIONS.deskSetups, saved.setup_ids[0]);
  assert.equal(master.analysis_output.execution_plan.plan_id, planId);
  assert.equal(master.active_thesis_id, thesisId);
  assert.equal(thesis.plan_id, planId);
  assert.deepEqual(thesis.pinned_plan, {
    plan_id: planId,
    scope: analysisOutput.execution_plan.scope,
    risk: analysisOutput.execution_plan.risk,
  });
  assert.equal(thesis.primary_setup_id, setupId);
  assert.equal(thesis.linked_setup_id, saved.setup_ids[0]);
  assert.equal(setup.setup_id, setupId);
  assert.equal(setup.analysis_id, analysisId);
  assert.equal(setup.execution_authority, "BACKEND_ONLY");
  assert.equal(setup.execution_policy_version, "4.3.0");
  assert.equal(setup.risk_pct, 0.25);
  assert.equal(setup.rr_minimum, 2);
  assert.equal(setup.trigger_policy.min_score, 0.55);
  assert.equal(setup.gates.length, 12);
  assert.equal(setup.gates.every((gate) => gate.source === "MASTER_EXECUTION_PLAN"), true);
  assert.deepEqual(setup.targets, analysisOutput.execution_plan.setups[0].targets);
  assert.deepEqual(setup.management_policy, {
    break_even_at_r: 0.7,
    tp1_close_fraction: 0.25,
  });
});


test("native Live Monitor V2 enforces atomic thesis revision CAS and idempotent retry", async () => {
  const root = await mkdtemp(join(tmpdir(), "desk-monitor-v2-save-"));
  const masterCutoffParis = "2026-07-30T09:00:00+02:00";
  const masterCutoffUtc = "2026-07-30T07:00:00.000Z";
  const monitorCutoffParis = "2026-07-30T09:05:00+02:00";
  const monitorCutoffUtc = "2026-07-30T07:05:00.000Z";
  const runId = "front_live_2026-07-30_cas";
  const analysisId = "analysis-live-v5-cas";
  const thesisId = "thesis-live-v5-cas";
  const setupId = "setup-live-v5-cas";
  const { store, persistence } = createTestDeskStore({
    root,
    projectRoot: root,
    clock: new FixedClock(Date.parse(monitorCutoffUtc)),
  });
  const masterOutput = makeNativeMasterV5({
    mode: "LIVE",
    tradingDate: "2026-07-30",
    session: "asia_open",
    runId,
    cutoffParis: masterCutoffParis,
    analysisId,
    bundleId: "bundle-live-v5-cas-master",
    packId: "pack-live-v5-cas",
    packBuildId: "packbuild-live-v5-cas",
    planId: "plan-live-v5-cas",
    thesisId,
    setupId,
  });
  await store.saveMasterAnalysis({
    strategy_id: "asia_open",
    session: "asia_open",
    mode: "live",
    date: "2026-07-30",
    trading_date: "2026-07-30",
    run_id: runId,
    as_of_utc: masterCutoffUtc,
    timezone: "Europe/Paris",
    analysis_id: analysisId,
    bundle_id: "bundle-live-v5-cas-master",
    pack_id: "pack-live-v5-cas",
    pack_build_id: "packbuild-live-v5-cas",
    plan_id: "plan-live-v5-cas",
    thesis_id: thesisId,
    setup_id_candidates: [setupId],
    contract_name: "DeskMasterAnalysisContract",
    schema_version: "5.4.0",
    ...LIVE_SAVE_VERSION_PINS,
    contract_hash: "contract-hash-v5",
    created_at_paris: masterCutoffParis,
    cutoff_paris: masterCutoffParis,
    analysis_output: masterOutput,
  });
  const pinnedPlan = persistence.peek(DESK_COLLECTIONS.deskActiveTheses, thesisId).pinned_plan;

  const monitorOutput = makeNativeMonitorV2({
    mode: "LIVE",
    tradingDate: "2026-07-30",
    session: "asia_open",
    runId,
    cutoffParis: monitorCutoffParis,
    monitorId: "monitor-live-v2-cas",
    bundleId: "bundle-live-v2-cas-monitor",
    packId: "pack-live-v5-cas",
    packBuildId: "packbuild-live-v5-cas",
    masterId: analysisId,
    planId: "plan-live-v5-cas",
    thesisId,
    commandId: "command-live-v2-cas",
    expectedRevision: 0,
    setupId,
  });
  const monitorPayload = {
    strategy_id: "asia_open",
    session: "asia_open",
    mode: "live",
    date: "2026-07-30",
    trading_date: "2026-07-30",
    run_id: runId,
    as_of_utc: monitorCutoffUtc,
    timestamp_paris: monitorCutoffParis,
    cutoff_paris: monitorCutoffParis,
    timezone: "Europe/Paris",
    monitor_id: "monitor-live-v2-cas",
    bundle_id: "bundle-live-v2-cas-monitor",
    pack_id: "pack-live-v5-cas",
    pack_build_id: "packbuild-live-v5-cas",
    linked_master_analysis_id: analysisId,
    linked_active_thesis_id: thesisId,
    plan_id: "plan-live-v5-cas",
    expected_revision: 0,
    contract_name: "DeskHourlyThesisMonitorContract",
    schema_version: "2.4.0",
    ...LIVE_SAVE_VERSION_PINS,
    contract_hash: "contract-hash-monitor-v2",
    monitor_output: monitorOutput,
  };

  const saved = await store.saveManualMonitor(monitorPayload);
  assert.equal(saved.ok, true);
  assert.equal(saved.applied_revision, 1);
  assert.equal(persistence.peek(DESK_COLLECTIONS.deskActiveTheses, thesisId).revision, 1);
  assert.deepEqual(persistence.peek(DESK_COLLECTIONS.deskActiveTheses, thesisId).pinned_plan, pinnedPlan);
  assert.equal(persistence.peek(DESK_COLLECTIONS.deskManualMonitors, "monitor-live-v2-cas").applied_revision, 1);

  const retry = await store.saveManualMonitor(monitorPayload);
  assert.equal(retry.idempotent, true);
  assert.equal(retry.applied_revision, 1);
  assert.equal(persistence.peek(DESK_COLLECTIONS.deskActiveTheses, thesisId).revision, 1);
  assert.deepEqual(persistence.peek(DESK_COLLECTIONS.deskActiveTheses, thesisId).pinned_plan, pinnedPlan);

  const staleOutput = makeNativeMonitorV2({
    mode: "LIVE",
    tradingDate: "2026-07-30",
    session: "asia_open",
    runId,
    cutoffParis: "2026-07-30T09:10:00+02:00",
    monitorId: "monitor-live-v2-stale",
    bundleId: "bundle-live-v2-stale-monitor",
    packId: "pack-live-v5-cas",
    packBuildId: "packbuild-live-v5-cas",
    masterId: analysisId,
    planId: "plan-live-v5-cas",
    thesisId,
    commandId: "command-live-v2-stale",
    expectedRevision: 0,
    setupId,
  });
  await assert.rejects(
    () => store.saveManualMonitor({
      ...monitorPayload,
      monitor_id: "monitor-live-v2-stale",
      bundle_id: "bundle-live-v2-stale-monitor",
      as_of_utc: "2026-07-30T07:10:00.000Z",
      timestamp_paris: "2026-07-30T09:10:00+02:00",
      cutoff_paris: "2026-07-30T09:10:00+02:00",
      monitor_output: staleOutput,
    }),
    (error) => error.code === "MONITOR_REVISION_CONFLICT",
  );
  assert.equal(persistence.peek(DESK_COLLECTIONS.deskManualMonitors, "monitor-live-v2-stale"), null);
  assert.equal(persistence.peek(DESK_COLLECTIONS.deskActiveTheses, thesisId).revision, 1);
});


test("WAIT_NO_SETUP pins the immutable Master plan in Live and Replay thesis persistence", async () => {
  const root = await mkdtemp(join(tmpdir(), "desk-wait-no-setup-pinned-plan-"));
  const tradingDate = "2026-07-31";
  const cutoffParis = "2026-07-31T09:00:00+02:00";
  const cutoffUtc = "2026-07-31T07:00:00.000Z";
  const runId = "front_live_2026-07-31_wait";
  const analysisId = "analysis-live-v5-wait";
  const thesisId = "thesis-live-v5-wait";
  const planId = "plan-live-v5-wait";
  const { store, persistence } = createTestDeskStore({
    root,
    projectRoot: root,
    clock: new FixedClock(Date.parse(cutoffUtc)),
  });
  const asWaitNoSetup = (output, suffix) => {
    const waitCondition = makeNativeMasterV5({ setupId: `wait-probe-${suffix}` })
      .execution_plan.setups[0].conditions[0];
    output.execution_plan.disposition = "WAIT_NO_SETUP";
    output.execution_plan.no_setup_proof = {
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
      blocking_reasons: ["No setup satisfies the deterministic geometry yet"],
      wait_to_go_conditions: [waitCondition],
      revalidation_triggers: ["Next closed M5 checkpoint"],
    };
    return output;
  };
  const liveOutput = asWaitNoSetup(makeNativeMasterV5({
    mode: "LIVE",
    tradingDate,
    session: "asia_open",
    runId,
    cutoffParis,
    analysisId,
    bundleId: "bundle-live-v5-wait",
    packId: "pack-live-v5-wait",
    packBuildId: "packbuild-live-v5-wait",
    planId,
    thesisId,
    setupId: null,
  }), "live");
  const liveSaved = await store.saveMasterAnalysis({
    strategy_id: "asia_open",
    session: "asia_open",
    mode: "live",
    date: tradingDate,
    trading_date: tradingDate,
    run_id: runId,
    as_of_utc: cutoffUtc,
    timezone: "Europe/Paris",
    analysis_id: analysisId,
    bundle_id: "bundle-live-v5-wait",
    pack_id: "pack-live-v5-wait",
    pack_build_id: "packbuild-live-v5-wait",
    plan_id: planId,
    thesis_id: thesisId,
    setup_id_candidates: [],
    contract_name: "DeskMasterAnalysisContract",
    schema_version: "5.4.0",
    ...LIVE_SAVE_VERSION_PINS,
    contract_hash: "contract-hash-v5",
    created_at_paris: cutoffParis,
    cutoff_paris: cutoffParis,
    analysis_output: liveOutput,
  });
  assert.equal(liveSaved.setup_count, 0);
  const liveThesis = persistence.peek(DESK_COLLECTIONS.deskActiveTheses, thesisId);
  assert.deepEqual(liveThesis.pinned_plan, {
    plan_id: planId,
    scope: liveOutput.execution_plan.scope,
    risk: liveOutput.execution_plan.risk,
  });

  const replayOutput = asWaitNoSetup(makeNativeMasterV5({
    mode: "REPLAY",
    tradingDate,
    session: "asia_open",
    runId: "replay_2026-07-31_wait",
    cutoffParis,
    analysisId: "analysis-replay-v5-wait",
    bundleId: "bundle-replay-v5-wait",
    packId: "pack-replay-v5-wait",
    packBuildId: "packbuild-replay-v5-wait",
    planId: "plan-replay-v5-wait",
    thesisId: "thesis-replay-v5-wait",
    setupId: null,
  }), "replay");
  const replayCanonical = canonicalizeMasterStrategyPayload({
    schema_version: "5.4.0",
    replay_execution_policy_version: "4.3.0",
    analysis_output: replayOutput,
  }, { workflow: "REPLAY_MASTER", sourceMode: "replay" });
  const replayRun = {
    backtest_id: "replay_2026-07-31_wait",
    replay_run_id: "replay_2026-07-31_wait",
    strategy_id: "asia_open",
    trading_date: tradingDate,
    date: tradingDate,
    session: "asia_open",
    timezone: "Europe/Paris",
    resolved_scope: {},
    scope_hash: "scope-replay-v5-wait",
    pack_id: "pack-replay-v5-wait",
    pack_build_id: "packbuild-replay-v5-wait",
    source_manifest_hash: "manifest-replay-v5-wait",
  };
  const replayStep = { step_id: "step-replay-v5-wait", timestamp_paris: cutoffParis };
  const tick = { utc: cutoffUtc, paris: cutoffParis };
  const replayMaster = { ...replayCanonical, analysis_id: "analysis-replay-v5-wait" };
  const replayThesis = normalizeReplayActiveThesis(
    replayCanonical.active_thesis,
    replayMaster,
    replayRun,
    replayStep,
    tick,
  );
  assert.deepEqual(replayThesis.pinned_plan, {
    plan_id: "plan-replay-v5-wait",
    scope: replayOutput.execution_plan.scope,
    risk: replayOutput.execution_plan.risk,
  });

  const tampered = patchReplayThesis(replayThesis, {
    monitor_id: "monitor-cannot-overwrite-master-plan",
    step_id: "monitor-step",
    thesis_update: {
      plan_id: "monitor-plan-override",
      pinned_plan: {
        plan_id: "monitor-plan-override",
        scope: { ...replayOutput.execution_plan.scope, session: "ny_open" },
        risk: { ...replayOutput.execution_plan.risk, risk_pct_requested: 0.01 },
      },
      summary: "Legitimate narrative update",
    },
  }, tick);
  assert.equal(tampered.summary, "Legitimate narrative update");
  assert.equal(tampered.plan_id, replayThesis.plan_id);
  assert.deepEqual(tampered.pinned_plan, replayThesis.pinned_plan);
});
