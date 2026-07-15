import test from "node:test";
import assert from "node:assert/strict";
import { PersistentDeskStore } from "../src/store.js";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { liveScope } from "./fixtures/live_scope.js";

const scope = () => liveScope({ date: "2026-07-06", cutoff_paris: "2026-07-06T10:00:00+02:00", run_id: "indexed_run" });

test("PersistentDeskStore gets active theses through indexed collection queries", async () => {
  const persistence = fakePersistence([
    {
      thesis_id: "thesis-1",
      ...scope(),
      linked_master_analysis_id: "master-1",
      session: "asia_open",
      instrument: "MNQ",
      status: "THESIS_ACTIVE",
      updated_at: "2026-07-06T08:00:00Z",
    },
  ]);
  const store = new PersistentDeskStore(undefined, persistence);

  const result = await store.getActiveThesis({ ...scope(), master_id: "master-1", instrument: "MNQ", status: "active" });

  assert.equal(result.active_thesis.thesis_id, "thesis-1");
  assert.deepEqual(persistence.queries, [
    {
      collection: DESK_COLLECTIONS.deskActiveTheses,
      filters: [
        { field: "linked_master_analysis_id", operator: "==", value: "master-1" },
      ],
      orderBy: [],
      limit: 200,
    },
  ]);
  assert.equal(persistence.listCalls.length, 0);
});

test("PersistentDeskStore gets latest master analysis through indexed collection queries", async () => {
  const persistence = fakePersistence([
    {
      analysis_id: "analysis-1",
      ...scope(),
      session: "asia_open",
      date: "2026-07-06",
      instrument: "MNQ",
    },
  ]);
  const store = new PersistentDeskStore(undefined, persistence);

  const result = await store.getLatestMasterAnalysis({
    ...scope(),
    instrument: "MNQ",
  });

  assert.equal(result.analysis.analysis_id, "analysis-1");
  assert.deepEqual(persistence.queries, [
    {
      collection: DESK_COLLECTIONS.deskMasterAnalyses,
      filters: [
        { field: "run_id", operator: "==", value: "indexed_run" },
      ],
      orderBy: [],
      limit: 200,
    },
  ]);
  assert.equal(persistence.listCalls.length, 0);
});

test("PersistentDeskStore resolves an exact master parent by document id", async () => {
  const master = {
    analysis_id: "analysis-exact",
    ...scope(),
    session: "asia_open",
    date: "2026-07-06",
  };
  const persistence = fakePersistence([], {
    documents: { [DESK_COLLECTIONS.deskMasterAnalyses]: { "analysis-exact": master } },
  });
  const store = new PersistentDeskStore(undefined, persistence);

  const result = await store.getLatestMasterAnalysis({ ...scope(), master_id: "analysis-exact" });

  assert.equal(result.analysis.analysis_id, "analysis-exact");
  assert.deepEqual(persistence.queries, []);
  assert.deepEqual(persistence.getCalls, [
    { collection: DESK_COLLECTIONS.deskMasterAnalyses, documentId: "analysis-exact" },
  ]);
});

test("PersistentDeskStore gets latest hourly monitor through indexed collection queries", async () => {
  const thesis = {
    thesis_id: "thesis-1",
    ...scope(),
    linked_master_analysis_id: "master-1",
    status: "THESIS_ACTIVE",
  };
  const persistence = fakePersistence([
    {
      monitor_id: "monitor-1",
      ...scope(),
      linked_master_analysis_id: "master-1",
      linked_active_thesis_id: "thesis-1",
      timestamp_paris: "2026-07-06T10:00:00+02:00",
    },
  ], { documents: { [DESK_COLLECTIONS.deskActiveTheses]: { "thesis-1": thesis } } });
  const store = new PersistentDeskStore(undefined, persistence);

  const result = await store.getLatestHourlyMonitor({ ...scope(), master_id: "master-1", thesis_id: "thesis-1", limit: 2 });

  assert.equal(result.latest_monitor.monitor_id, "monitor-1");
  assert.deepEqual(persistence.queries, [
    {
      collection: DESK_COLLECTIONS.deskHourlyMonitors,
      filters: [
        { field: "linked_active_thesis_id", operator: "==", value: "thesis-1" },
      ],
      orderBy: [],
      limit: 200,
    },
  ]);
  assert.equal(persistence.listCalls.length, 0);
});

test("PersistentDeskStore gets latest manual monitor without a composite index", async () => {
  const persistence = fakePersistence([
    {
      monitor_id: "manual-monitor-1",
      ...scope(),
      linked_master_analysis_id: "master-1",
      linked_active_thesis_id: "thesis-1",
      timestamp_paris: "2026-07-06T10:00:00+02:00",
      monitor_decision: { decision: "WAIT_MORE", reason_summary: "No GO yet." },
      thesis_update: { health_score: 62 },
    },
  ]);
  const store = new PersistentDeskStore(undefined, persistence);

  const result = await store.getLatestManualMonitor({
    ...scope(),
    master_id: "master-1",
    thesis_id: "thesis-1",
    limit: 2,
  });

  assert.equal(result.latest_monitor.monitor_id, "manual-monitor-1");
  assert.deepEqual(persistence.queries, [
    {
      collection: DESK_COLLECTIONS.deskManualMonitors,
      filters: [
        { field: "linked_active_thesis_id", operator: "==", value: "thesis-1" },
      ],
      orderBy: [],
      limit: 200,
    },
  ]);
  assert.equal(persistence.listCalls.length, 0);
});

test("PersistentDeskStore raw windows fail closed without an immutable pack", async () => {
  const persistence = fakePersistence([], {
    queryDocuments(query) {
      if (query.parentPath === `${DESK_COLLECTIONS.marketFeeds}/prod__tradingview__MNQ1!__5`) {
        return [
          {
            symbol: "MNQ1!",
            instrument: "MNQ",
            timeframe: "5",
            timestamp_utc: "2026-07-09T13:30:00+00:00",
            open: 100,
            high: 105,
            low: 99,
            close: 104,
            volume: 10,
          },
        ];
      }
      return [];
    },
  });
  const store = new PersistentDeskStore(undefined, persistence);

  await assert.rejects(store.getRawWindow({
    ...scope(),
    instrument: "MNQ",
    timeframe: "M5",
    from: "2026-07-06T09:45:00+02:00",
    to: "2026-07-06T10:00:00+02:00",
  }), (error) => error.code === "SCOPE_REQUIRED" || /document_not_found/.test(error.message));
  assert.equal(persistence.windowQueries.length, 0);
});

function fakePersistence(docs, options = {}) {
  return {
    queries: [],
    getCalls: [],
    listCalls: [],
    windowQueries: [],
    async queryDocuments(query) {
      this.windowQueries.push(query);
      return options.queryDocuments ? options.queryDocuments(query) : [];
    },
    async getDocument(collection, documentId) {
      this.getCalls.push({ collection, documentId });
      const value = options.documents?.[collection]?.[documentId];
      if (!value) throw new Error("document_not_found");
      return value;
    },
    async queryCollectionDocuments(query) {
      this.queries.push(query);
      return docs;
    },
    async listDocuments(collection, pageSize) {
      this.listCalls.push({ collection, pageSize });
      throw new Error("listDocuments_should_not_be_used_for_indexed_paths");
    },
  };
}
