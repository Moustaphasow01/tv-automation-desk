import assert from "node:assert/strict";
import test from "node:test";
import { MarketContextRepository } from "../src/market-context-repository.js";
import { createTheoreticalTestDatabase } from "./support/theoretical-postgres-fixtures.js";

test("context PostgreSQL round trip preserves separate clocks and millisecond expiry without provider effects",
  { skip: process.env.RUN_POSTGRES_TESTS !== "1" }, async (t) => {
    const database = await createTheoreticalTestDatabase();
    t.after(() => database.close());
    const repository = new MarketContextRepository({ pool: database.pool, initialized: Promise.resolve() });
    const before = await providerCount(database.pool);
    const snapshot = testContext();
    await repository.upsertSourceCoverage({ ...snapshot.sourceStates[0], dataCutoff: snapshot.marketDataCutoffUtc });
    const brief = { ...snapshot, marketDeskBriefId: "brief-time-test",
      headline: "Test de contrat temporel", operatorSummary: "Fixture locale uniquement." };
    const stored = await repository.persistAnalysis({ snapshot, brief });
    assert.equal(stored.snapshot.status, "AVAILABLE");
    const result = await repository.current("US_GRAINS_CBOT", "2026-09-07T16:00:00.533Z");
    const priceCoverage = result.sourceStates.find(source => source.sourceId === "ZC_1");
    assert.equal(priceCoverage.dataCutoff, snapshot.marketDataCutoffUtc);
    assert.equal(priceCoverage.covered, true);
    assert.equal(priceCoverage.asOf, snapshot.analysisAsOfUtc);
    for (const value of [result.snapshot, result.brief]) {
      assert.equal(value.status, "AVAILABLE");
      assert.equal(value.sourceDataCutoff, snapshot.analysisAsOfUtc);
      assert.equal(value.analysisAsOfUtc, snapshot.analysisAsOfUtc);
      assert.equal(value.marketDataCutoffUtc, snapshot.marketDataCutoffUtc);
      assert.equal(value.sourceStates[0].coverageEnd, snapshot.marketDataCutoffUtc);
      assert.equal(value.sourceStates[0].dataCutoff, snapshot.marketDataCutoffUtc);
      assert.equal(value.sourceStates[1].dataCutoff, snapshot.analysisAsOfUtc);
    }
    const expired = await repository.current("US_GRAINS_CBOT", "2026-09-07T16:00:00.535Z");
    assert.equal(expired.snapshot.status, "STALE");
    assert.equal(expired.brief.status, "STALE");
    assert.equal(await providerCount(database.pool), before);
    const row = (await database.pool.query("SELECT source_data_cutoff_utc FROM market_context_snapshots WHERE market_context_snapshot_id=$1",
      [snapshot.marketContextSnapshotId])).rows[0];
    assert.equal(row.source_data_cutoff_utc.toISOString(), snapshot.analysisAsOfUtc);
  });

async function providerCount(pool) {
  return Number((await pool.query("SELECT count(*)::int AS count FROM broker_provider_commands")).rows[0].count);
}

function testContext() {
  const analysis = "2026-09-07T15:00:00.534Z";
  const market = "2026-09-04T18:20:00.000Z";
  return {
    marketContextSnapshotId: "context-time-test", universe: "US_GRAINS_CBOT",
    sourceDataCutoff: analysis, analysisAsOfUtc: analysis, marketDataCutoffUtc: market,
    createdAt: "2026-09-07T15:01:00.000Z", validFrom: "2026-09-07T15:01:00.000Z",
    validUntil: "2026-09-07T16:00:00.534Z", marketState: "HOLIDAY", marketSession: "CBOT_GRAINS_CLOSED",
    marketRegime: "UNKNOWN", volatilityRegime: "UNKNOWN", globalBias: "NEUTRAL", status: "AVAILABLE",
    sourceStates: [
      { sourceId: "ZC_1", sourceType: "OHLCV", status: "AVAILABLE", asOf: analysis,
        requiredFor: ["MARKET_CONTEXT_SNAPSHOT"], coverageStart: "2026-09-04T13:30:00Z", coverageEnd: market },
      { sourceId: "market_agri_events", sourceType: "AGRI_EVENT_CALENDAR", status: "AVAILABLE", asOf: analysis,
        requiredFor: ["MARKET_CONTEXT_SNAPSHOT"], coverageStart: "2026-09-07T00:00:00Z", coverageEnd: "2026-09-08T00:00:00Z" },
    ],
  };
}
