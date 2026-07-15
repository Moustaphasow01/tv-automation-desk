import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLiveMonitorCatchupPlan,
  isLiveMonitorCheckpointInWindow,
  resolveLiveMasterJobInput,
  resolveLiveMonitorJobInput,
} from "../src/live-scope.js";
import {
  ensureLiveRollingPackCoverage,
  prepareDueLiveMasterBundle,
  prepareDueLiveMonitorBundle,
  prepareLiveReplanMasterAfterMonitor,
} from "../src/live-orchestration.js";
import { liveRollingPackScriptArgs } from "../src/live-pack-builder.js";

test("live rolling pack command pins the exact requested checkpoint", () => {
  assert.deepEqual(liveRollingPackScriptArgs({
    date: "2026-07-13",
    session: "asia_open",
    checkpoint_paris: "2026-07-13T12:45:00+02:00",
  }), [
    "--date", "2026-07-13",
    "--session", "asia_open",
    "--purpose", "live_rolling",
    "--end-paris", "2026-07-13T12:45:00+02:00",
  ]);
});

test("late live Master creates one catch-up plan at the latest settled M15 checkpoint", () => {
  const plan = buildLiveMonitorCatchupPlan({
    session: "asia_open",
    tradingDate: "2026-07-13",
    masterCutoffParis: "2026-07-13T00:15:00+02:00",
    masterMaterializedAtParis: "2026-07-13T01:56:00+02:00",
  });
  assert.equal(plan.required, true);
  assert.equal(plan.monitor_checkpoint_paris, "2026-07-13T01:45:00+02:00");
  assert.equal(plan.skipped_checkpoint_count, 5);
  assert.deepEqual(plan.skipped_checkpoints, [
    "2026-07-13T00:30:00+02:00",
    "2026-07-13T00:45:00+02:00",
    "2026-07-13T01:00:00+02:00",
    "2026-07-13T01:15:00+02:00",
    "2026-07-13T01:30:00+02:00",
  ]);
});

test("on-time live Master waits for the first normal M15 checkpoint", () => {
  const plan = buildLiveMonitorCatchupPlan({
    session: "asia_open",
    tradingDate: "2026-07-13",
    masterCutoffParis: "2026-07-13T00:15:00+02:00",
    masterMaterializedAtParis: "2026-07-13T00:22:00+02:00",
  });
  assert.equal(plan.required, false);
  assert.equal(plan.skipped_reason, "no_closed_monitor_checkpoint_after_master");
});

test("catch-up reuses a newer live rolling pack without publishing backwards", async () => {
  let buildCount = 0;
  const result = await ensureLiveRollingPackCoverage({
    async getDeskPack() {
      return liveRollingPack("2026-07-13T13:00:00+02:00", "packbuild-1300");
    },
  }, {
    trading_date: "2026-07-13",
    session: "asia_open",
    timestamp_paris: "2026-07-13T12:45:00+02:00",
    as_of_utc: "2026-07-13T10:45:00.000Z",
  }, {
    buildLiveRollingPack: async () => {
      buildCount += 1;
    },
  });
  assert.equal(buildCount, 0);
  assert.equal(result.reused, true);
  assert.equal(result.pack_build_id, "packbuild-1300");
});

test("stores with live publishing disabled never publish packs during orchestration", async () => {
  let buildCount = 0;
  const result = await ensureLiveRollingPackCoverage({
    livePackPublishingEnabled: false,
    async getDeskPack() {
      return decisionPack("2026-07-13T00:15:00+02:00", "local-packbuild");
    },
  }, {
    trading_date: "2026-07-13",
    session: "asia_open",
    timestamp_paris: "2026-07-13T12:45:00+02:00",
    as_of_utc: "2026-07-13T10:45:00.000Z",
  }, {
    buildLiveRollingPack: async () => {
      buildCount += 1;
    },
  });
  assert.equal(buildCount, 0);
  assert.equal(result.publishing_skipped, true);
  assert.equal(result.coverage_sufficient, false);
});

test("live Master workflows derive a complete deterministic strict scope", () => {
  const asiaReplan = resolveLiveMasterJobInput({ workflow: "london_1130" }, "2026-07-13T09:40:00Z");
  assert.deepEqual({
    strategy_id: asiaReplan.strategy_id,
    session: asiaReplan.session,
    trading_date: asiaReplan.trading_date,
    run_id: asiaReplan.run_id,
    cutoff_paris: asiaReplan.cutoff_paris,
    as_of_utc: asiaReplan.as_of_utc,
  }, {
    strategy_id: "asia_open",
    session: "asia_open",
    trading_date: "2026-07-13",
    run_id: "front_live_2026-07-13_asia_open",
    cutoff_paris: "2026-07-13T11:30:00+02:00",
    as_of_utc: "2026-07-13T09:30:00.000Z",
  });

  const ny = resolveLiveMasterJobInput({ workflow: "ny_open" }, "2026-07-13T13:40:00Z");
  assert.equal(ny.strategy_id, "ny_open_1530");
  assert.equal(ny.run_id, "front_live_2026-07-13_ny_open");
  assert.equal(ny.cutoff_paris, "2026-07-13T15:30:00+02:00");
});

test("live monitor scope floors Paris time and enforces registered windows", () => {
  const asiaMasterCutoff = resolveLiveMonitorJobInput({ session: "asia_open" }, "2026-07-12T22:17:00Z");
  assert.equal(asiaMasterCutoff.timestamp_paris, "2026-07-13T00:15:00+02:00");
  assert.equal(isLiveMonitorCheckpointInWindow(asiaMasterCutoff.session, asiaMasterCutoff.timestamp_paris), false);
  assert.equal(isLiveMonitorCheckpointInWindow("asia_open", "2026-07-13T00:30:00+02:00"), true);

  const ny = resolveLiveMonitorJobInput({ session: "ny_open" }, "2026-07-13T13:52:14Z");
  assert.equal(ny.timestamp_paris, "2026-07-13T15:45:00+02:00");
  assert.equal(ny.as_of_utc, "2026-07-13T13:45:00.000Z");
  assert.equal(isLiveMonitorCheckpointInWindow(ny.session, ny.timestamp_paris), true);

  const tooEarly = resolveLiveMonitorJobInput({ session: "ny_open" }, "2026-07-13T13:37:00Z");
  assert.equal(tooEarly.timestamp_paris, "2026-07-13T15:30:00+02:00");
  assert.equal(isLiveMonitorCheckpointInWindow(tooEarly.session, tooEarly.timestamp_paris), false);
});

test("due Master entry point forwards the derived strict payload", async () => {
  let received = null;
  const store = {
    async prepareMasterCutoffBundleJob(payload) {
      received = payload;
      return { ok: true, status: "completed", bundle_id: "bundle-1" };
    },
  };
  const result = await prepareDueLiveMasterBundle(store, { workflow: "asia_open" }, { now: "2026-07-13T00:15:00+02:00" });
  assert.equal(result.ok, true);
  assert.equal(received.strategy_id, "asia_open");
  assert.equal(received.run_id, "front_live_2026-07-13_asia_open");
  assert.equal(received.as_of_utc, "2026-07-12T22:15:00.000Z");
});

test("a live Monitor requesting REPLAN_FULL prepares a new Master at the exact checkpoint", async () => {
  let received = null;
  const store = {
    async prepareMasterCutoffBundleJob(payload) {
      received = payload;
      return { ok: true, bundle_id: "replan-master-bundle", work_item: { work_item_id: "replan-master-work" } };
    },
  };
  const result = await prepareLiveReplanMasterAfterMonitor(store, {
    strategy_id: "ny_open_1530",
    session: "ny_open",
    mode: "live",
    trading_date: "2026-07-13",
    run_id: "front_live_2026-07-13_ny_open",
    timestamp_paris: "2026-07-13T16:30:00+02:00",
    monitor_decision: { action: "REPLAN_FULL" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, "prepared");
  assert.equal(received.cutoff_paris, "2026-07-13T16:30:00+02:00");
  assert.equal(received.as_of_utc, "2026-07-13T14:30:00.000Z");
  assert.equal(received.run_id, "front_live_2026-07-13_ny_open");
  assert.equal(received.enqueue_agent_work, false);
});

test("due M15 entry point rebuilds continuity when a Master is missing", async () => {
  let monitorPrepared = false;
  let masterPayload = null;
  const store = {
    async getLatestMasterAnalysis() {
      return { analysis: null };
    },
    async prepareMasterCutoffBundleJob(payload) {
      masterPayload = payload;
      return {
        ok: true,
        bundle_id: "recovery-master-bundle",
        cursor_id: "livecur__2026-07-13__ny_open",
      };
    },
    async prepareM15MonitorBundleJob() {
      monitorPrepared = true;
      return { ok: true };
    },
  };
  const result = await prepareDueLiveMonitorBundle(store, { session: "ny_open" }, { now: "2026-07-13T15:52:00+02:00" });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.skipped_reason, "master_not_materialized");
  assert.equal(result.status, "recovery_pending");
  assert.equal(result.continuity_recovery.reason, "master_missing_recovery");
  assert.equal(result.continuity_recovery.cursor_id, "livecur__2026-07-13__ny_open");
  assert.equal(masterPayload.cutoff_paris, "2026-07-13T15:30:00+02:00");
  assert.equal(monitorPrepared, false);
});

test("due M15 entry point recreates the exact replan Master when the active thesis is missing", async () => {
  let masterPayload = null;
  const master = {
    analysis_id: "master-1530",
    as_of_utc: "2026-07-13T13:30:00.000Z",
    cutoff_paris: "2026-07-13T15:30:00+02:00",
  };
  const store = {
    async getLatestMasterAnalysis() {
      return { analysis: master };
    },
    async getActiveThesis() {
      return { active_thesis: null };
    },
    async getLatestManualMonitor() {
      return {
        monitors: [{
          monitor_id: "monitor-1630",
          strategy_id: "ny_open_1530",
          session: "ny_open",
          mode: "live",
          trading_date: "2026-07-13",
          run_id: "front_live_2026-07-13_ny_open",
          timestamp_paris: "2026-07-13T16:30:00+02:00",
          monitor_decision: { action: "REPLAN_FULL" },
        }],
      };
    },
    async prepareMasterCutoffBundleJob(payload) {
      masterPayload = payload;
      return {
        ok: true,
        bundle_id: "replan-recovery-bundle",
        cursor_id: "livecur__2026-07-13__ny_open",
      };
    },
  };

  const result = await prepareDueLiveMonitorBundle(store, { session: "ny_open" }, { now: "2026-07-13T17:07:00+02:00" });
  assert.equal(result.status, "recovery_pending");
  assert.equal(result.continuity_recovery.reason, "replan_monitor_reconciled");
  assert.equal(result.continuity_recovery.trigger_monitor_id, "monitor-1630");
  assert.equal(masterPayload.cutoff_paris, "2026-07-13T16:30:00+02:00");
  assert.equal(masterPayload.as_of_utc, "2026-07-13T14:30:00.000Z");
});

test("due M15 entry point resolves exact Master and thesis before preparation", async () => {
  let received = null;
  let packBuilt = false;
  const store = {
    async getLatestMasterAnalysis(scope) {
      assert.equal(scope.run_id, "front_live_2026-07-13_ny_open");
      return { analysis: { analysis_id: "master-1" } };
    },
    async getActiveThesis(scope) {
      assert.equal(scope.master_id, "master-1");
      return { active_thesis: { thesis_id: "thesis-1" } };
    },
    async getDeskPack() {
      return packBuilt
        ? liveRollingPack("2026-07-13T15:45:00+02:00", "packbuild-1545")
        : decisionPack("2026-07-13T15:30:00+02:00", "packbuild-1530");
    },
    async prepareM15MonitorBundleJob(payload) {
      received = payload;
      return { ok: true, status: "completed", bundle_id: "monitor-bundle-1" };
    },
  };
  const result = await prepareDueLiveMonitorBundle(store, { session: "ny_open" }, {
    now: "2026-07-13T15:52:00+02:00",
    buildLiveRollingPack: async () => {
      packBuilt = true;
      return { ok: true };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(received.master_id, "master-1");
  assert.equal(received.thesis_id, "thesis-1");
  assert.equal(received.timestamp_paris, "2026-07-13T15:45:00+02:00");
  assert.equal(received.pack_id, undefined);
  assert.equal(result.live_pack.pack_build_id, "packbuild-1545");
});

test("live cursor roll-forward can prepare a Monitor from the latest expired thesis", async () => {
  let thesisStatus = null;
  let received = null;
  const store = {
    async getLatestMasterAnalysis() {
      return { analysis: { analysis_id: "late-master-1" } };
    },
    async getActiveThesis(scope) {
      thesisStatus = scope.status;
      return {
        active_thesis: {
          thesis_id: "expired-thesis-1",
          status: "EXPIRED",
          valid_until_paris: "2026-07-13T15:45:00+02:00",
        },
      };
    },
    async getDeskPack() {
      return liveRollingPack("2026-07-13T15:45:00+02:00", "packbuild-1545");
    },
    async prepareM15MonitorBundleJob(payload) {
      received = payload;
      return { ok: true, status: "completed", bundle_id: "catchup-monitor-bundle-1" };
    },
  };

  const result = await prepareDueLiveMonitorBundle(store, {
    session: "ny_open",
    catchup_mode: true,
  }, { now: "2026-07-13T15:52:00+02:00" });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(thesisStatus, "any");
  assert.equal(received.master_id, "late-master-1");
  assert.equal(received.thesis_id, "expired-thesis-1");
  assert.equal(received.timestamp_paris, "2026-07-13T15:45:00+02:00");
});

function liveRollingPack(endParis, buildId) {
  return {
    pack_id: "2026-07-13_asia_open",
    pack_build_id: buildId,
    pack_purpose: "live_rolling",
    source_coverage: {
      mode: "live_rolling_checkpoint",
      end_paris: endParis,
      end_utc: new Date(endParis).toISOString(),
    },
  };
}

function decisionPack(endParis, buildId) {
  return {
    pack_id: "2026-07-13_asia_open",
    pack_build_id: buildId,
    pack_purpose: "decision_cutoff",
    source_coverage: {
      mode: "decision_cutoff",
      end_paris: endParis,
      end_utc: new Date(endParis).toISOString(),
    },
  };
}
