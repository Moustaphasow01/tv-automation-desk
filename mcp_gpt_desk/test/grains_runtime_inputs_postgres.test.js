import assert from "node:assert/strict";
import test from "node:test";
import { loadGrainRuntimeMarketInputs } from "../src/persistence/postgres-grains-runtime-inputs.js";
import { createTheoreticalTestDatabase } from "./support/theoretical-postgres-fixtures.js";
import { PostgresDeskPersistence } from "../src/persistence/postgres-desk-persistence.js";
import { ingestTradingViewWebhook } from "../src/tradingview-webhook.js";
import { evaluateGrainsCalendarCoverage } from "../src/grains-calendar-coverage.js";

const AS_OF = "2026-09-04T15:00:00.000Z";

test(
  "TD2-429 real runtime input projection sees only closed bars and already-known schedules",
  {
    skip: process.env.RUN_POSTGRES_TESTS !== "1",
  },
  async (t) => {
    const database = await createTheoreticalTestDatabase();
    t.after(() => database.close());
    const persistence = new PostgresDeskPersistence({
      pool: database.pool,
      schemaMode: "validate",
    });
    await seedCandles(persistence);
    await seedCalendar(database.pool);
    const input = await loadGrainRuntimeMarketInputs(database.pool, {
      tradingDate: "2026-09-04",
      asOfUtc: AS_OF,
    });

    assert.deepEqual(
      input.rowsBySymbol["ZW1!:5"].map((row) => row.timestamp_utc),
      ["2026-09-04T14:55:00.000Z"],
    );
    assert.deepEqual(
      input.rowsBySymbol["ZW1!:1"].map((row) => row.timestamp_utc),
      ["2026-09-04T14:59:00.000Z"],
    );
    const futureKnown = input.agriEvents.find(
      (event) => event.market_agri_event_id === "td429-known-future",
    );
    assert.ok(
      futureKnown,
      "known upcoming release is needed for pre-release blackout",
    );
    assert.equal(futureKnown.event_timestamp_utc, "2026-09-04T15:15:00.000Z");
    assert.equal(
      futureKnown.source_published_at_utc,
      "2026-09-01T12:00:00.000Z",
    );
    assert.equal(
      input.agriEvents.some(
        (event) => event.market_agri_event_id === "td429-learned-later",
      ),
      false,
    );
    assert.equal(
      input.agriEvents.some(
        (event) => event.market_agri_event_id === "td429-legacy-later",
      ),
      false,
    );
    for (const event of input.agriEvents) {
      assert.equal("actual" in event, false);
      assert.equal("point_in_time_payload" in event, false);
    }
  },
);

test(
  "TD2-426 real coverage projection refuses future knowledge and unversioned legacy seeds",
  {
    skip: process.env.RUN_POSTGRES_TESTS !== "1",
  },
  async (t) => {
    const database = await createTheoreticalTestDatabase();
    t.after(() => database.close());
    const query = { tradingDate: "2026-09-04", asOfUtc: AS_OF };
    const load = () => loadGrainRuntimeMarketInputs(database.pool, query);
    const legacy = await load();
    assert.equal(
      evaluateGrainsCalendarCoverage({
        sources: legacy.agriCalendarCoverage,
        cutoff: AS_OF,
      }).admissible,
      false,
    );
    await database.pool.query(
      `INSERT INTO market_source_coverage_manifests
    (source_id,source_type,source_status,coverage_start_utc,coverage_end_utc,as_of_utc,dataset_version,metadata)
    VALUES ('market_agri_events','AGRI_EVENT_CALENDAR','AVAILABLE','2026-09-01','2026-09-30',$1,'test-v1',$2)
    ON CONFLICT (source_id) DO UPDATE SET as_of_utc=EXCLUDED.as_of_utc,metadata=EXCLUDED.metadata,
      dataset_version=EXCLUDED.dataset_version,source_status=EXCLUDED.source_status,
      coverage_start_utc=EXCLUDED.coverage_start_utc,coverage_end_utc=EXCLUDED.coverage_end_utc`,
      [
        "2026-09-04T15:01:00Z",
        { source_version_hash: `sha256:${"a".repeat(64)}` },
      ],
    );
    assert.deepEqual((await load()).agriCalendarCoverage, []);
    await database.pool
      .query(`UPDATE market_source_coverage_manifests SET as_of_utc='2026-09-01T00:00:00Z'
    WHERE source_id='market_agri_events'`);
    const known = await load();
    assert.equal(
      known.agriCalendarCoverage[0].sourceVersionHash,
      `sha256:${"a".repeat(64)}`,
    );
    assert.equal(
      evaluateGrainsCalendarCoverage({
        sources: known.agriCalendarCoverage,
        cutoff: AS_OF,
      }).admissible,
      true,
    );
  },
);

async function seedCandles(persistence) {
  for (const [timeframe, timestamp] of [
    ["5", "14:55"],
    ["5", "15:00"],
    ["1", "14:59"],
    ["1", "15:00"],
  ]) {
    const result = await ingestTradingViewWebhook({
      persistence,
      secret: "local-test",
      now: new Date(AS_OF),
      body: {
        token: "local-test",
        symbol: "CBOT:ZW1!",
        timeframe,
        timestamp_utc: `2026-09-04T${timestamp}:00Z`,
        bar_status: "closed",
        open: 500,
        high: 501,
        low: 499,
        close: 500.5,
        volume: 100,
        alert_id: `td429-${timeframe}-${timestamp}`,
      },
    });
    assert.equal(result.statusCode, 202);
  }
}

async function seedCalendar(pool) {
  for (const [id, publishedAt, createdAt] of [
    ["td429-known-future", "2026-09-01T12:00:00Z", AS_OF],
    ["td429-learned-later", "2026-09-04T15:01:00Z", AS_OF],
    ["td429-legacy-later", null, "2026-09-04T15:01:00Z"],
  ]) {
    await pool.query(
      `INSERT INTO market_agri_events (
      market_agri_event_id,event_kind,title,event_timestamp_utc,importance,source_provider,
      actual_available_at_utc,actual,point_in_time_payload,created_at_utc
    ) VALUES ($1,'WASDE','Local causal fixture','2026-09-04T15:15Z','HIGH','test',
      '2026-09-04T15:16Z','{"futureResult":12345}',$2,$3)`,
      [
        id,
        publishedAt ? { source_published_at_utc: publishedAt } : {},
        createdAt,
      ],
    );
  }
}
