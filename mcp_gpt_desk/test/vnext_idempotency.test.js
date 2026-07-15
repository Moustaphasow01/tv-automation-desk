import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { PersistentDeskStore } from "../src/store.js";
import { createTestDeskStore } from "./support/test-desk-store.js";
import { liveScope } from "./fixtures/live_scope.js";

const scope = () => liveScope({ date: "2026-07-02", cutoff_paris: "2026-07-02T10:00:00+02:00", run_id: "run1" });

test("PersistentDeskStore with memory persistence keeps vNext IDs idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpt-desk-mcp-vnext-idempotency-"));
  const { store, persistence } = createTestDeskStore({ root, projectRoot: root, clock: new SequenceClock() });

  const firstMaster = await store.saveMasterAnalysis({
    ...scope(),
    date: "2026-07-02",
    session: "asia_open",
    title: "Initial master analysis",
  });
  const secondMaster = await store.saveMasterAnalysis({
    ...scope(),
    date: "2026-07-02",
    session: "asia_open",
    title: "Updated master analysis",
  });

  assert.equal(firstMaster.analysis_id, "master_2026_07_02_asia_open_run1");
  assert.equal(secondMaster.analysis_id, firstMaster.analysis_id);
  assert.deepEqual(persistence.ids(DESK_COLLECTIONS.deskMasterAnalyses), ["master_2026_07_02_asia_open_run1"]);
  const master = await persistence.getDocument(DESK_COLLECTIONS.deskMasterAnalyses, "master_2026_07_02_asia_open_run1");
  assert.equal(master.title, "Updated master analysis");
  assert.equal(master.created_at_utc, "2026-07-02T08:00:00.000Z");
  assert.equal(master.updated_at_utc, "2026-07-02T08:10:00.000Z");

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

  assert.equal(firstThesis.thesis_id, "thesis_master_2026_07_02_asia_open_run1_MNQ");
  assert.equal(secondThesis.thesis_id, firstThesis.thesis_id);
  assert.deepEqual(persistence.ids(DESK_COLLECTIONS.deskActiveTheses), ["thesis_master_2026_07_02_asia_open_run1_MNQ"]);
  const thesis = await persistence.getDocument(DESK_COLLECTIONS.deskActiveTheses, "thesis_master_2026_07_02_asia_open_run1_MNQ");
  assert.equal(thesis.status, "SETUP_ARMED");
  assert.equal(thesis.created_at_utc, "2026-07-02T08:20:00.000Z");
  assert.equal(thesis.updated_at_utc, "2026-07-02T08:25:00.000Z");

  const firstMonitor = await store.saveHourlyMonitor({
    ...scope(),
    linked_active_thesis_id: firstThesis.thesis_id,
    linked_master_analysis_id: firstMaster.analysis_id,
    timestamp_paris: "2026-07-02T12:00:00+02:00",
    monitor_decision: { action: "maintain" },
  });
  const secondMonitor = await store.saveHourlyMonitor({
    ...scope(),
    linked_active_thesis_id: firstThesis.thesis_id,
    linked_master_analysis_id: firstMaster.analysis_id,
    timestamp_paris: "2026-07-02T12:00:00+02:00",
    monitor_decision: { action: "replan_watch" },
  });

  const expectedMonitorId = "monitor_thesis_master_2026_07_02_asia_open_run1_MNQ_2026_07_02T12_00_00_02_00";
  assert.equal(firstMonitor.monitor_id, expectedMonitorId);
  assert.equal(secondMonitor.monitor_id, firstMonitor.monitor_id);
  assert.deepEqual(persistence.ids(DESK_COLLECTIONS.deskHourlyMonitors), [expectedMonitorId]);
  const monitor = await persistence.getDocument(DESK_COLLECTIONS.deskHourlyMonitors, expectedMonitorId);
  assert.deepEqual(monitor.monitor_decision, { action: "replan_watch" });
  assert.equal(monitor.created_at_utc, "2026-07-02T08:25:00.000Z");
  assert.equal(monitor.updated_at_utc, "2026-07-02T08:25:00.000Z");
});

test("PersistentDeskStore vNext writes reuse deterministic document IDs with merge upserts", async () => {
  const persistence = fakePersistence();
  const store = new PersistentDeskStore(new SequenceClock(), persistence);

  const firstMaster = await store.saveMasterAnalysis({
    ...scope(),
    date: "2026-07-02",
    session: "asia_open",
    title: "Initial master analysis",
  });
  const secondMaster = await store.saveMasterAnalysis({
    ...scope(),
    date: "2026-07-02",
    session: "asia_open",
    title: "Updated master analysis",
  });

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

  const firstMonitor = await store.saveHourlyMonitor({
    ...scope(),
    linked_active_thesis_id: firstThesis.thesis_id,
    linked_master_analysis_id: firstMaster.analysis_id,
    timestamp_paris: "2026-07-02T12:00:00+02:00",
    monitor_decision: { action: "maintain" },
  });
  const secondMonitor = await store.saveHourlyMonitor({
    ...scope(),
    linked_active_thesis_id: firstThesis.thesis_id,
    linked_master_analysis_id: firstMaster.analysis_id,
    timestamp_paris: "2026-07-02T12:00:00+02:00",
    monitor_decision: { action: "replan_watch" },
  });

  assert.equal(secondMaster.analysis_id, firstMaster.analysis_id);
  assert.equal(secondThesis.thesis_id, firstThesis.thesis_id);
  assert.equal(secondMonitor.monitor_id, firstMonitor.monitor_id);
  assert.deepEqual(persistence.documentIds(DESK_COLLECTIONS.deskMasterAnalyses), ["master_2026_07_02_asia_open_run1"]);
  assert.deepEqual(persistence.documentIds(DESK_COLLECTIONS.deskActiveTheses), ["thesis_master_2026_07_02_asia_open_run1_MNQ"]);
  assert.deepEqual(persistence.documentIds(DESK_COLLECTIONS.deskHourlyMonitors), [
    "monitor_thesis_master_2026_07_02_asia_open_run1_MNQ_2026_07_02T12_00_00_02_00",
  ]);

  const master = persistence.document(DESK_COLLECTIONS.deskMasterAnalyses, firstMaster.analysis_id);
  assert.equal(master.title, "Updated master analysis");
  assert.equal(master.created_at_utc, "2026-07-02T08:00:00.000Z");
  assert.equal(master.updated_at_utc, "2026-07-02T08:10:00.000Z");
  assert.equal(persistence.writes.every((write) => write.options?.merge === true), true);
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

function fakePersistence() {
  const collections = new Map();
  const writes = [];
  return {
    writes,
    async getDocument(collection, documentId) {
      const doc = collections.get(collection)?.get(documentId);
      if (!doc) throw new Error(`${collection}_document_not_found:${documentId}`);
      return { ...doc };
    },
    async setDocument(collection, documentId, data, options) {
      if (!collections.has(collection)) collections.set(collection, new Map());
      const existing = collections.get(collection).get(documentId) || {};
      const next = options?.merge ? { ...existing, ...data } : data;
      collections.get(collection).set(documentId, next);
      writes.push({ collection, documentId, data, options });
    },
    documentIds(collection) {
      return [...(collections.get(collection)?.keys() || [])].sort();
    },
    document(collection, documentId) {
      return collections.get(collection)?.get(documentId) || null;
    },
  };
}
