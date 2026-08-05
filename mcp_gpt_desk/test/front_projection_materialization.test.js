import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FixedClock } from "@tv-automation/desk-time";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { PersistentDeskStore } from "../src/store.js";
import { DeskFrontService } from "../src/desk-front-service.js";
import { createTestDeskStore } from "./support/test-desk-store.js";
import {
  makeActiveLiveMasterSave,
  makeActiveLiveMonitorSave,
} from "./support/active-strategy-save-fixtures.js";

const tickUtc = "2026-07-14T06:15:00.000Z";
const scope = {
  strategy_id: "asia_open",
  session: "asia_open",
  mode: "live",
  date: "2026-07-14",
  trading_date: "2026-07-14",
  run_id: "front_live_2026-07-14_asia_open",
  as_of_utc: tickUtc,
  cutoff_paris: "2026-07-14T08:15:00+02:00",
  timezone: "Europe/Paris",
};

test("PersistentDeskStore materializes Master and Monitor front projections with monotonic current state", async () => {
  const root = await mkdtemp(join(tmpdir(), "desk-front-projection-"));
  const { store, persistence } = createTestDeskStore({ root, projectRoot: root, clock: new FixedClock(Date.parse(tickUtc)) });

  const master = await store.saveMasterAnalysis(makeActiveLiveMasterSave({
    scope,
    analysisId: "master-1",
    thesisId: "thesis-1",
    planId: "plan-master-1",
    overrides: {
      front_projection: projection({ sourceType: "MASTER", sourceId: "master-1", monitorId: null, sequence: 1, revision: 1 }),
    },
  }));
  assert.equal(master.front_projection.status, "materialized");
  assert.equal(persistence.count(DESK_COLLECTIONS.deskFrontSnapshots), 1);
  assert.equal(persistence.count(DESK_COLLECTIONS.deskFrontEvents), 1);

  const monitorPayload = makeActiveLiveMonitorSave({
    scope,
    monitorId: "monitor-2",
    masterId: "master-1",
    thesisId: "thesis-1",
    planId: "plan-master-1",
    expectedRevision: 0,
    overrides: {
      front_projection: projection({ sourceType: "MONITOR", sourceId: "monitor-2", monitorId: "monitor-2", sequence: 2, revision: 2 }),
    },
  });
  const monitor = await store.saveManualMonitor(monitorPayload);
  assert.equal(monitor.front_projection.status, "materialized");

  const current = await store.getFrontProjectionCurrent(scope);
  assert.equal(current.source_id, "monitor-2");
  assert.equal(current.revision, 2);
  assert.equal(current.sequence, 2);
  assert.equal(current.projection.briefs.headline, "Projection MONITOR");
  assert.equal(persistence.count(DESK_COLLECTIONS.deskFrontSnapshots), 2);
  assert.equal(persistence.count(DESK_COLLECTIONS.deskFrontEvents), 2);

  const retry = await store.saveManualMonitor(monitorPayload);
  assert.equal(retry.idempotent, true);
  assert.equal(persistence.count(DESK_COLLECTIONS.deskFrontSnapshots), 2);
});

test("stale or invalid projections are recorded without replacing the canonical current state", async () => {
  const root = await mkdtemp(join(tmpdir(), "desk-front-projection-error-"));
  const { store, persistence } = createTestDeskStore({ root, projectRoot: root, clock: new FixedClock(Date.parse(tickUtc)) });
  await store.saveMasterAnalysis(makeActiveLiveMasterSave({
    scope,
    analysisId: "master-1",
    thesisId: "thesis-1",
    planId: "plan-master-1",
    overrides: {
      front_projection: projection({ sourceType: "MASTER", sourceId: "master-1", monitorId: null, sequence: 2, revision: 2 }),
    },
  }));

  const stale = await store.saveManualMonitor(makeActiveLiveMonitorSave({
    scope,
    monitorId: "monitor-stale",
    masterId: "master-1",
    thesisId: "thesis-1",
    planId: "plan-master-1",
    expectedRevision: 0,
    overrides: {
      front_projection: projection({ sourceType: "MONITOR", sourceId: "monitor-stale", monitorId: "monitor-stale", sequence: 1, revision: 1 }),
    },
  }));
  assert.equal(stale.front_projection.status, "rejected");
  assert.equal(stale.front_projection.error_code, "FRONT_PROJECTION_STALE_REVISION");

  const current = await store.getFrontProjectionCurrent(scope);
  assert.equal(current.source_id, "master-1");
  assert.equal(current.revision, 2);
  assert.equal(persistence.count(DESK_COLLECTIONS.deskFrontProjectionErrors), 1);
  const savedCanonicalMonitor = persistence.peek(DESK_COLLECTIONS.deskManualMonitors, "monitor-stale");
  assert.equal(savedCanonicalMonitor.monitor_id, "monitor-stale");
});

test("PersistentDeskStore delegates canonical source and projection writes to one persistence transaction", async () => {
  const persistence = fakeFrontPersistence();
  const store = new PersistentDeskStore(new FixedClock(Date.parse(tickUtc)), persistence);
  const saved = await store.saveMasterAnalysis(makeActiveLiveMasterSave({
    scope,
    analysisId: "master-1",
    thesisId: "thesis-1",
    planId: "plan-master-1",
    overrides: {
      front_projection: projection({ sourceType: "MASTER", sourceId: "master-1", monitorId: null, sequence: 1, revision: 1 }),
    },
  }));

  assert.equal(saved.front_projection.status, "materialized");
  assert.equal(persistence.transactionCalls, 1);
  assert.equal(persistence.has(DESK_COLLECTIONS.deskMasterAnalyses, "master-1"), true);
  assert.equal(persistence.count(DESK_COLLECTIONS.deskFrontCurrentStates), 1);
  assert.equal(persistence.count(DESK_COLLECTIONS.deskFrontSnapshots), 1);
  assert.equal(persistence.count(DESK_COLLECTIONS.deskFrontEvents), 1);
});

function projection({ sourceType, sourceId, monitorId, sequence, revision }) {
  return {
    contractName: "DeskFrontProjectionContract",
    schemaVersion: "1.0.0",
    source: {
      sourceType,
      sourceId,
      masterId: "master-1",
      monitorId,
      thesisId: "thesis-1",
      strategyId: scope.strategy_id,
      session: scope.session,
      mode: scope.mode,
      tradingDate: scope.trading_date,
      runId: scope.run_id,
      timestampParis: "2026-07-14T08:15:00+02:00",
      asOfUtc: scope.as_of_utc,
      sequence,
      revision,
    },
    status: {
      deskStatus: "THESIS_ACTIVE",
      decision: "MAINTAIN",
      actionCode: "WATCH",
      alertLevel: "watch",
      thesisStatus: "THESIS_ACTIVE",
      setupStatus: "ARMED",
      positionStatus: "NO_POSITION",
      confidencePct: 68,
      healthScore: 72,
      riskPct: 0.5,
    },
    briefs: {
      headline: `Projection ${sourceType}`,
      oneLiner: "Support tenu.",
      marketBrief: "Marché stable.",
      thesisBrief: "Thèse active.",
      deltaBrief: "Score stable.",
      whyNow: "Le support tient.",
      actionNow: "Surveiller.",
      nextFocus: "Résistance M15.",
    },
    latestChange: {
      stateTransition: { from: "WATCH", to: "WATCH" },
      scoreTransition: { from: 70, to: 72, delta: 2 },
      validatedElements: ["Support"],
      weakenedElements: [],
      invalidatedElements: [],
    },
    expectedVsRealized: [],
    conditions: { go: [], invalidations: [] },
    setup: { status: "ARMED" },
    position: { status: "NO_POSITION" },
    marketContext: {},
    timelineEvent: { type: sourceType, title: sourceType, summary: "Projection matérialisée", severity: "watch" },
    drilldownRefs: { masterId: "master-1", monitorId },
  };
}


function fakeFrontPersistence() {
  const collections = new Map();
  return {
    transactionCalls: 0,
    async getDocument(collection, documentId) {
      const document = collections.get(collection)?.get(documentId);
      if (!document) throw new Error("not_found");
      return document;
    },
    async setDocument(collection, documentId, data, options = {}) {
      if (!collections.has(collection)) collections.set(collection, new Map());
      const previous = collections.get(collection).get(documentId) || {};
      collections.get(collection).set(documentId, options.merge ? { ...previous, ...data } : data);
    },
    async commitFrontProjectionMutation({ sourceWrite, projectionWrites }) {
      this.transactionCalls += 1;
      await this.setDocument(sourceWrite.collection, sourceWrite.documentId, sourceWrite.data, { merge: sourceWrite.merge });
      for (const write of projectionWrites) await this.setDocument(write.collection, write.documentId, write.data, { merge: write.merge });
    },
    has(collection, documentId) { return collections.get(collection)?.has(documentId) || false; },
    count(collection) { return collections.get(collection)?.size || 0; },
  };
}

test("DeskFrontService commits projection and additional setup writes in one transaction", async () => {
  let committed = null;
  const front = new DeskFrontService({
    persistence: {
      async commitFrontProjectionMutation(input) {
        committed = input;
        return { ok: true };
      },
    },
    clock: new FixedClock(Date.parse(tickUtc)),
    marketFeedCandidates: () => [],
    canonicalTimeframe: (value) => value,
  });
  const sourceWrite = {
    collection: DESK_COLLECTIONS.deskManualMonitors,
    documentId: "monitor-replace",
    data: { monitor_id: "monitor-replace" },
    merge: true,
  };
  const projectionWrite = {
    collection: DESK_COLLECTIONS.deskFrontEvents,
    documentId: "event-replace",
    data: { event_id: "event-replace" },
  };
  const setupWrites = ["old", "new"].map((id) => ({
    collection: DESK_COLLECTIONS.deskSetups,
    documentId: `setup-${id}`,
    data: { setup_record_id: `setup-${id}` },
    merge: true,
  }));

  await front.commitProjection({
    sourceWrite,
    plan: { writes: [projectionWrite], currentStatePrecondition: null },
    additionalWrites: setupWrites,
  });

  assert.equal(committed.sourceWrite, sourceWrite);
  assert.deepEqual(committed.projectionWrites, [projectionWrite, ...setupWrites]);
});
