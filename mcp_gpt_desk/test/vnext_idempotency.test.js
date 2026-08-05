import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { createTestDeskStore } from "./support/test-desk-store.js";
import { liveScope } from "./fixtures/live_scope.js";
import {
  makeActiveLiveMasterSave,
  makeActiveLiveMonitorSave,
} from "./support/active-strategy-save-fixtures.js";

const scope = () => liveScope({ date: "2026-07-02", cutoff_paris: "2026-07-02T10:00:00+02:00", run_id: "run1" });
const expectedMasterId = "master_2026_07_02_asia_open_run1_1000";
const expectedThesisId = `thesis_${expectedMasterId}_MNQ`;

test("PersistentDeskStore with memory persistence keeps vNext IDs idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpt-desk-mcp-vnext-idempotency-"));
  const { store, persistence } = createTestDeskStore({ root, projectRoot: root, clock: new SequenceClock() });

  const firstMaster = await store.saveMasterAnalysis(makeActiveLiveMasterSave({
    scope: scope(),
    analysisId: expectedMasterId,
    thesisId: expectedThesisId,
    planId: "plan-run1-1000",
    overrides: { title: "Initial master analysis" },
  }));
  const secondMaster = await store.saveMasterAnalysis(makeActiveLiveMasterSave({
    scope: scope(),
    analysisId: expectedMasterId,
    thesisId: expectedThesisId,
    planId: "plan-run1-1000",
    overrides: { title: "Updated master analysis" },
  }));

  assert.equal(firstMaster.analysis_id, expectedMasterId);
  assert.equal(secondMaster.analysis_id, firstMaster.analysis_id);
  assert.deepEqual(persistence.ids(DESK_COLLECTIONS.deskMasterAnalyses), [expectedMasterId]);
  const master = await persistence.getDocument(DESK_COLLECTIONS.deskMasterAnalyses, expectedMasterId);
  assert.equal(master.title, "Updated master analysis");
  assert.equal(master.created_at_utc, "2026-07-02T08:00:00.000Z");
  assert.equal(master.updated_at_utc, "2026-07-02T08:15:00.000Z");

  const firstThesis = await store.saveActiveThesis({
    ...scope(),
    linked_master_analysis_id: firstMaster.analysis_id,
    instrument: "MNQ",
    status: "THESIS_ACTIVE",
    valid_from: "2026-07-02T10:15:00+02:00",
  });
  const secondThesis = await store.saveActiveThesis({
    ...scope(),
    linked_master_analysis_id: firstMaster.analysis_id,
    instrument: "MNQ",
    status: "SETUP_ARMED",
    valid_from: "2026-07-02T11:15:00+02:00",
  });

  assert.equal(firstThesis.thesis_id, expectedThesisId);
  assert.equal(secondThesis.thesis_id, firstThesis.thesis_id);
  assert.deepEqual(persistence.ids(DESK_COLLECTIONS.deskActiveTheses), [expectedThesisId]);
  const thesis = await persistence.getDocument(DESK_COLLECTIONS.deskActiveTheses, expectedThesisId);
  assert.equal(thesis.status, "SETUP_ARMED");
  assert.equal(thesis.created_at_utc, "2026-07-02T08:15:00.000Z");
  assert.equal(thesis.updated_at_utc, "2026-07-02T08:25:00.000Z");

  const expectedMonitorId = `monitor_${expectedThesisId}_2026_07_02T12_00_00_02_00`;
  const monitorScope = liveScope({
    date: "2026-07-02",
    cutoff_paris: "2026-07-02T12:00:00+02:00",
    run_id: "run1",
  });
  const monitorPayload = makeActiveLiveMonitorSave({
    scope: monitorScope,
    monitorId: expectedMonitorId,
    masterId: firstMaster.analysis_id,
    thesisId: firstThesis.thesis_id,
    planId: "plan-run1-1000",
    expectedRevision: 0,
  });
  const firstMonitor = await store.saveManualMonitor(monitorPayload);
  const secondMonitor = await store.saveManualMonitor(monitorPayload);

  assert.equal(firstMonitor.monitor_id, expectedMonitorId);
  assert.equal(secondMonitor.monitor_id, firstMonitor.monitor_id);
  assert.equal(secondMonitor.idempotent, true);
  assert.deepEqual(persistence.ids(DESK_COLLECTIONS.deskManualMonitors), [expectedMonitorId]);
  const monitor = await persistence.getDocument(DESK_COLLECTIONS.deskManualMonitors, expectedMonitorId);
  assert.equal(monitor.applied_revision, 1);
  assert.equal(monitor.monitor_output.command.requested_action, "NO_ACTION");
  assert.equal(monitor.created_at_utc, "2026-07-02T08:25:00.000Z");
  assert.equal(monitor.updated_at_utc, "2026-07-02T08:25:00.000Z");
});

test("PersistentDeskStore V5.2 writes reuse canonical IDs and preserve native version pins", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpt-desk-mcp-vnext-native-upsert-"));
  const { store, persistence } = createTestDeskStore({ root, projectRoot: root, clock: new SequenceClock() });
  const first = await store.saveMasterAnalysis(makeActiveLiveMasterSave({
    scope: scope(),
    analysisId: expectedMasterId,
    thesisId: expectedThesisId,
    planId: "plan-run1-1000",
    overrides: { title: "Initial master analysis" },
  }));
  const second = await store.saveMasterAnalysis(makeActiveLiveMasterSave({
    scope: scope(),
    analysisId: expectedMasterId,
    thesisId: expectedThesisId,
    planId: "plan-run1-1000",
    overrides: { title: "Updated master analysis" },
  }));

  assert.equal(second.analysis_id, first.analysis_id);
  assert.deepEqual(persistence.ids(DESK_COLLECTIONS.deskMasterAnalyses), [expectedMasterId]);
  assert.deepEqual(persistence.ids(DESK_COLLECTIONS.deskActiveTheses), [expectedThesisId]);
  const master = await persistence.getDocument(DESK_COLLECTIONS.deskMasterAnalyses, expectedMasterId);
  assert.equal(master.title, "Updated master analysis");
  assert.equal(master.schema_version, "5.4.0");
  assert.equal(master.execution_policy_version, "4.3.0");
  assert.equal(master.execution_plan_version, "1.4.0");
  assert.equal(master.condition_catalog_version, "1.2.0");
  assert.equal(master.deterministic_compiler_version, "1.4.0");
  assert.equal(master.condition_engine_version, "1.2.0");
});

test("distinct LIVE Master cutoffs create distinct immutable lineages in the same daily run", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpt-desk-mcp-live-lineage-"));
  const { store, persistence } = createTestDeskStore({ root, projectRoot: root, clock: new SequenceClock() });
  const firstScope = scope();
  const replanScope = liveScope({
    date: "2026-07-02",
    cutoff_paris: "2026-07-02T10:15:00+02:00",
    run_id: "run1",
  });

  const firstMaster = await store.saveMasterAnalysis(makeActiveLiveMasterSave({
    scope: firstScope,
    analysisId: expectedMasterId,
    thesisId: expectedThesisId,
    planId: "plan-run1-1000",
    overrides: { title: "Initial Master" },
  }));
  const replanMasterId = "master_2026_07_02_asia_open_run1_1015";
  const replanThesisId = `thesis_${replanMasterId}_MNQ`;
  const replanMaster = await store.saveMasterAnalysis(makeActiveLiveMasterSave({
    scope: replanScope,
    analysisId: replanMasterId,
    thesisId: replanThesisId,
    planId: "plan-run1-1015",
    overrides: { title: "Replan Master" },
  }));
  assert.equal(firstMaster.analysis_id, expectedMasterId);
  assert.equal(replanMaster.analysis_id, replanMasterId);
  assert.notEqual(replanMaster.analysis_id, firstMaster.analysis_id);

  assert.notEqual(replanMaster.active_thesis_id, firstMaster.active_thesis_id);
  assert.equal(persistence.ids(DESK_COLLECTIONS.deskMasterAnalyses).length, 2);
  assert.equal(persistence.ids(DESK_COLLECTIONS.deskActiveTheses).length, 2);
});


class SequenceClock {
  constructor() {
    this.index = 0;
    this.ticks = [
      tick("2026-07-02T08:00:00.000Z", "2026-07-02T10:00:00+02:00"),
      tick("2026-07-02T08:05:00.000Z", "2026-07-02T10:05:00+02:00"),
      tick("2026-07-02T08:10:00.000Z", "2026-07-02T10:10:00+02:00"),
      tick("2026-07-02T08:15:00.000Z", "2026-07-02T10:15:00+02:00"),
      tick("2026-07-02T08:20:00.000Z", "2026-07-02T10:20:00+02:00"),
      tick("2026-07-02T08:25:00.000Z", "2026-07-02T10:25:00+02:00"),
    ];
  }

  now() {
    const value = this.ticks[Math.min(this.index, this.ticks.length - 1)];
    this.index += 1;
    return { ...value };
  }
}

function tick(utc, paris) {
  return { utc, paris, epochMs: Date.parse(utc) };
}
