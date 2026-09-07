import assert from "node:assert/strict";
import test from "node:test";
import { MarketContextRepository } from "../src/market-context-repository.js";

const NOW = "2026-09-07T18:30:00.000Z";

test("current keeps its canonical brief when one optional read times out", async () => {
  const database = fakeDatabase({ failPrefilter: true });
  const repository = new MarketContextRepository(database.persistence);

  const current = await repository.current("US_GRAINS_CBOT", NOW, { readBudgetMs: 8_000 });

  assert.equal(current.snapshot.marketContextSnapshotId, "context-1");
  assert.equal(current.brief.marketDeskBriefId, "brief-1");
  assert.equal(current.briefHistory[0].marketDeskBriefId, "brief-1");
  assert.equal(current.prefilterDecisions, null);
  assert.equal(current.workerRuntime.successCount, 7);
  assert.equal(current.readStatus, "PARTIAL");
  assert.deepEqual(current.readDiagnostics, [{
    component: "prefilter-decisions",
    status: "UNAVAILABLE",
    code: "MARKET_CONTEXT_ENRICHMENT_TIMEOUT",
  }]);
  assert.equal(database.connectCount, 1);
  assert.equal(database.releaseCount, 1);
  assert.equal(database.maxConcurrentQueries, 1);
});

test("current distinguishes a successful empty read from an unavailable read", async () => {
  const database = fakeDatabase({ emptyCore: true });
  const repository = new MarketContextRepository(database.persistence);

  const current = await repository.current("US_GRAINS_CBOT", NOW);

  assert.equal(current.snapshot, null);
  assert.equal(current.brief, null);
  assert.equal(current.readStatus, "AVAILABLE");
  assert.deepEqual(current.readDiagnostics, []);
});

test("current sanitizes pool checkout failures", async () => {
  const repository = new MarketContextRepository({
    initialized: Promise.resolve(),
    pool: { async connect() { throw new Error("timeout exceeded when trying to connect"); } },
  });

  await assert.rejects(
    () => repository.current("US_GRAINS_CBOT", NOW),
    { code: "MARKET_CONTEXT_POOL_CHECKOUT_TIMEOUT" },
  );
});

function fakeDatabase({ failPrefilter = false, emptyCore = false } = {}) {
  let activeQueries = 0;
  const state = { connectCount: 0, releaseCount: 0, maxConcurrentQueries: 0 };
  const client = {
    async query(sql) {
      activeQueries += 1;
      state.maxConcurrentQueries = Math.max(state.maxConcurrentQueries, activeQueries);
      try {
        return queryResult(String(sql), { failPrefilter, emptyCore });
      } finally {
        activeQueries -= 1;
      }
    },
    release() { state.releaseCount += 1; },
  };
  return Object.assign(state, {
    persistence: {
      initialized: Promise.resolve(),
      pool: { async connect() { state.connectCount += 1; return client; } },
    },
  });
}

function queryResult(sql, options) {
  if (sql.includes("WITH latest_snapshot")) return { rows: options.emptyCore ? [] : [{
    snapshot: contextRow(), brief: briefRow(),
  }] };
  if (sql.includes("FROM market_desk_briefs") && sql.includes("LIMIT 12")) return { rows: [briefRow()] };
  if (sql.includes("FROM market_source_coverage_manifests")) return { rows: [] };
  if (sql.includes("FROM market_context_prefilter_decisions")) {
    if (options.failPrefilter) throw Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    return { rows: [] };
  }
  if (sql.includes("FROM agent_missions")) return { rows: [{
    model_policy: {}, task_count: 8, success_count: 7, failure_count: 1, active_count: 0,
    retry_count: 1, last_completed_at: "2026-09-07T18:00:00.000Z", average_latency_ms: 500,
    total_tokens: 1000, cost_micros_usd: 12,
  }] };
  if (sql.includes("market_agri_calendar_versions") || sql.includes("market_agri_calendar_events")) return { rows: [] };
  return { rows: [] };
}

function contextRow() {
  return {
    payload: {
      marketContextSnapshotId: "context-1", universe: "US_GRAINS_CBOT", status: "AVAILABLE",
      createdAt: "2026-09-07T18:00:00.000Z", validUntil: "2026-09-07T19:00:00.000Z",
      sourceDataCutoff: "2026-09-07T18:00:00.000Z",
    },
    valid_until_utc: "2026-09-07T19:00:00.000Z",
  };
}

function briefRow() {
  return {
    market_desk_brief_id: "brief-1", revision: 3,
    payload: {
      marketDeskBriefId: "brief-1", marketContextSnapshotId: "context-1", status: "AVAILABLE",
      headline: "Contexte grains valide", operatorSummary: "Brief canonique.",
      createdAt: "2026-09-07T18:01:00.000Z", validUntil: "2026-09-07T19:00:00.000Z",
    },
    valid_until_utc: "2026-09-07T19:00:00.000Z",
    invalidation_reason: null,
  };
}
