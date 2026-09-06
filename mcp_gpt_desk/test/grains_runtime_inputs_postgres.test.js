import assert from "node:assert/strict";
import test from "node:test";
import { loadGrainRuntimeMarketInputs } from "../src/persistence/postgres-grains-runtime-inputs.js";
import { createTheoreticalTestDatabase } from "./support/theoretical-postgres-fixtures.js";
import { PostgresDeskPersistence } from "../src/persistence/postgres-desk-persistence.js";
import { ingestTradingViewWebhook } from "../src/tradingview-webhook.js";
import { evaluateGrainsCalendarCoverage } from "../src/grains-calendar-coverage.js";
import { appendGrainsCalendarVersion } from "../src/persistence/postgres-grains-calendar-ledger.js";

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
  "TD2-426 real coverage projection uses only an immutable source version known at the cutoff",
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
    await appendGrainsCalendarVersion(
      database.pool,
      calendarVersion({ knownAtUtc: "2026-09-04T15:01:00Z", hash: "a" }),
    );
    assert.deepEqual((await load()).agriCalendarCoverage, []);
    await appendGrainsCalendarVersion(
      database.pool,
      calendarVersion({ knownAtUtc: "2026-09-04T14:59:00Z", hash: "b" }),
    );
    const known = await load();
    assert.equal(
      known.agriCalendarCoverage[0].sourceVersionHash,
      `sha256:${"b".repeat(64)}`,
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
  await appendGrainsCalendarVersion(
    pool,
    calendarVersion({
      knownAtUtc: "2026-09-01T12:00:00Z",
      hash: "c",
      events: [calendarEvent("td429-known-future", "2026-09-04T15:15Z")],
    }),
  );
  await appendGrainsCalendarVersion(
    pool,
    calendarVersion({
      knownAtUtc: "2026-09-04T15:01:00Z",
      hash: "d",
      events: [calendarEvent("td429-learned-later", "2026-09-04T15:15Z")],
    }),
  );
  await pool.query(
    `INSERT INTO market_agri_events (
      market_agri_event_id,event_kind,title,event_timestamp_utc,importance,source_provider
    ) VALUES ('td429-known-future','WASDE','MUTABLE CURRENT PROJECTION','2026-09-04T15:15Z','HIGH','test')`,
  );
}

function calendarVersion({ knownAtUtc, hash, events = [] }) {
  const sha256 = `sha256:${hash.repeat(64)}`;
  return {
    knownAtUtc,
    status: "AVAILABLE",
    coverageStart: "2026-09-01T00:00:00Z",
    coverageEnd: "2026-09-30T00:00:00Z",
    datasetVersion: sha256,
    sourceVersionHash: sha256,
    provider: "test",
    sources: [
      "usda_nass_release_calendar",
      "usda_wasde_release_schedule",
      "usda_fas_export_sales_schedule",
    ].map((sourceId) => ({
      sourceId,
      sourceUrl: `https://example.test/${sourceId}`,
      sourceDocumentSha256: sha256,
      retrievedAtUtc: knownAtUtc,
      knowledgeStatus: "PROVEN_CURRENT",
      historicalKnowledgeStatus: "EXTERNAL_HISTORICAL_GAP",
      metadata: { calendar_evidence_status: "CALENDAR_SCHEDULE", coverage: {
        start_utc: "2026-09-01T00:00:00Z", end_utc: "2026-09-30T00:00:00Z", instruments: ["ZC", "ZW"],
      } },
    })),
    events,
  };
}

function calendarEvent(market_agri_event_id, event_timestamp_utc) {
  return {
    market_agri_event_id,
    event_kind: "WASDE",
    title: "Immutable causal fixture",
    event_timestamp_utc,
    importance: "HIGH",
    provider: "test",
    source_published_at_utc: "2026-09-01T12:00:00Z",
  };
}
