import assert from "node:assert/strict";
import test from "node:test";
import {
  appendGrainsCalendarVersion,
  loadGrainsCalendarVersionAt,
} from "../src/persistence/postgres-grains-calendar-ledger.js";
import { createTheoreticalTestDatabase } from "./support/theoretical-postgres-fixtures.js";
import { MarketContextRepository } from "../src/market-context-repository.js";
import { withGrainsCalendarRefreshLease } from "../src/persistence/postgres-grains-calendar-refresh-lease.js";
import { loadCurrentGrainsCalendar } from "../src/persistence/postgres-grains-calendar-current-state.js";

const CUTOFF = "2026-09-04T15:00:00.000Z";

test(
  "calendar ledger preserves the source-version event snapshot and incomplete sources fail closed",
  { skip: process.env.RUN_POSTGRES_TESTS !== "1" },
  async (t) => {
    const database = await createTheoreticalTestDatabase();
    t.after(() => database.close());
    const frozen = await appendGrainsCalendarVersion(
      database.pool,
      version({
        hash: "a",
        knownAtUtc: "2026-09-04T14:00:00Z",
        sourceIds: ["usda_nass_release_calendar"],
        historicalKnowledgeStatus: "EXTERNAL_HISTORICAL_GAP",
        title: "Frozen NASS event",
      }),
    );
    await database.pool.query(
      `INSERT INTO market_agri_calendar_version_events (
        market_agri_calendar_version_id,market_agri_event_id,event_kind,title,event_timestamp_utc,
        importance,source_provider,source_published_at_utc,point_in_time_payload
      ) VALUES ($1,'future-embedded','WASDE','Unpublished event','2026-09-05T12:00:00Z','HIGH','test',
        '2026-09-04T15:01:00Z',$2::jsonb)`,
      [frozen.version.marketAgriCalendarVersionId, JSON.stringify({ actual: "must-not-leak" })],
    );
    await database.pool.query(
      `INSERT INTO market_agri_events (
        market_agri_event_id,event_kind,title,event_timestamp_utc,importance,source_provider
      ) VALUES ('calendar-fixture','WASDE','MUTATED CURRENT EVENT','2026-09-05T12:00:00Z','HIGH','test')`,
    );
    const historical = await load(database.pool, CUTOFF);
    assert.equal(historical.agriEvents[0].title, "Frozen NASS event");
    assert.equal(historical.agriEvents.some((event) => event.title === "Unpublished event"), false);
    assert.equal(historical.agriCalendarCoverage[0].status, "UNKNOWN_COVERAGE");
    assert.ok(
      historical.agriCalendarCoverage[0].reasonCodes.includes(
        "CALENDAR_SOURCE_SET_INCOMPLETE",
      ),
    );

    await appendGrainsCalendarVersion(
      database.pool,
      version({
        hash: "b",
        knownAtUtc: "2026-09-04T15:01:00Z",
        sourceIds: requiredSources(),
        historicalKnowledgeStatus: "EXTERNAL_HISTORICAL_GAP",
        title: "Future version",
        pointInTimePayload: { commodity_codes: ["ZC"] },
      }),
    );
    assert.equal(
      (await load(database.pool, CUTOFF)).agriEvents[0].title,
      "Frozen NASS event",
    );
    const prospective = await load(database.pool, "2026-09-04T15:02:00.000Z");
    assert.equal(prospective.agriCalendarCoverage[0].status, "AVAILABLE");
    assert.deepEqual(prospective.agriEvents[0].commodity_codes, ["ZC"]);
    const beforeResult = await load(database.pool, "2026-09-05T12:15:00.000Z");
    assert.equal(beforeResult.agriEvents[0].result, undefined);
    await appendGrainsCalendarVersion(database.pool, version({
      hash: "7", knownAtUtc: "2026-09-05T12:31:00Z", sourceIds: requiredSources(),
      historicalKnowledgeStatus: "EXTERNAL_HISTORICAL_GAP",
      sourcePublishedAtUtc: "2026-09-04T15:01:00Z",
      pointInTimePayload: {
        result: { availableAtUtc: "2026-09-05T12:30:00Z", values: { actual: 42 } },
      },
    }));
    const afterResult = await load(database.pool, "2026-09-05T12:31:00.000Z");
    assert.deepEqual(afterResult.agriEvents[0].result, {
      availableAtUtc: "2026-09-05T12:30:00.000Z", values: { actual: 42 },
    });
    await appendGrainsCalendarVersion(database.pool, version({
      hash: "6", knownAtUtc: "2026-09-05T12:32:00Z", sourceIds: requiredSources(),
      historicalKnowledgeStatus: "EXTERNAL_HISTORICAL_GAP", status: "STALE",
    }));
    assert.equal(
      (await load(database.pool, "2026-09-05T12:32:00.000Z")).agriCalendarCoverage[0].status,
      "STALE",
    );
    await assert.rejects(
      () =>
        database.pool.query(
          "UPDATE market_agri_calendar_versions SET provider='mutated'",
        ),
      /append-only/,
    );
    await assert.rejects(
      () => database.pool.query("UPDATE market_agri_calendar_version_sources SET source_url='mutated'"),
      /append-only/,
    );
    await assert.rejects(
      () => database.pool.query("UPDATE market_agri_calendar_version_events SET title='mutated'"),
      /append-only/,
    );
    await assert.rejects(
      () => appendGrainsCalendarVersion(database.pool, version({
        hash: "f", knownAtUtc: "2026-09-04T14:00:00Z", sourceIds: requiredSources(),
        historicalKnowledgeStatus: "EXTERNAL_HISTORICAL_GAP", sourcePublishedAtUtc: "2026-09-04T14:01:00Z",
      })),
      /CALENDAR_EVENT_AFTER_VERSION_KNOWLEDGE/,
    );
  },
);

test(
  "calendar ledger is idempotent by source hash without rewriting original knowledge time",
  { skip: process.env.RUN_POSTGRES_TESTS !== "1" },
  async (t) => {
    const database = await createTheoreticalTestDatabase();
    t.after(() => database.close());
    const first = await appendGrainsCalendarVersion(
      database.pool,
      version({
        hash: "c",
        knownAtUtc: "2026-09-01T12:00:00Z",
        sourceIds: requiredSources(),
        historicalKnowledgeStatus: "EXTERNAL_HISTORICAL_GAP",
      }),
    );
    const duplicate = await appendGrainsCalendarVersion(
      database.pool,
      version({
        hash: "c",
        knownAtUtc: "2026-09-04T14:59:00Z",
        sourceIds: requiredSources(),
        historicalKnowledgeStatus: "EXTERNAL_HISTORICAL_GAP",
      }),
    );
    assert.equal(first.inserted, true);
    assert.equal(duplicate.inserted, false);
    assert.equal(duplicate.version.knownAtUtc, "2026-09-01T12:00:00.000Z");
  },
);

test(
  "partial source events remain visible while unavailable coverage stays inadmissible",
  { skip: process.env.RUN_POSTGRES_TESTS !== "1" },
  async (t) => {
    const database = await createTheoreticalTestDatabase();
    t.after(() => database.close());
    const partial = version({
      hash: "5", knownAtUtc: "2026-09-04T14:00:00Z",
      sourceIds: ["usda_nass_release_calendar", "usda_wasde_release_schedule"],
      historicalKnowledgeStatus: "EXTERNAL_HISTORICAL_GAP",
      status: "UNAVAILABLE", title: "Received NASS event",
    });
    partial.reasonCodes = ["CALENDAR_REQUIRED_SOURCE_FETCH_FAILED", "USDA_SOURCE_HTTP_403"];
    partial.metadata = { source_failures: [{
      source_id: "usda_fas_export_sales_schedule",
      source_url: "https://www.fas.usda.gov/data/scheduled-reports",
      reason_code: "USDA_SOURCE_HTTP_403",
    }] };
    await appendGrainsCalendarVersion(database.pool, partial);
    const loaded = await load(database.pool, "2026-09-04T14:00:00Z");
    assert.equal(loaded.agriEvents[0].title, "Received NASS event");
    assert.equal(loaded.agriCalendarCoverage[0].status, "UNAVAILABLE");
    assert.ok(loaded.agriCalendarCoverage[0].reasonCodes.includes("USDA_SOURCE_HTTP_403"));
    assert.ok(loaded.agriCalendarCoverage[0].reasonCodes.includes("CALENDAR_SOURCE_SET_INCOMPLETE"));
    const current = await loadCurrentGrainsCalendar(database.pool, "2026-09-04T14:00:00Z");
    assert.equal(current.events[0].title, "Received NASS event");
    assert.equal(current.sourceState.status, "UNAVAILABLE");
    assert.equal(current.sourceState.lastSuccessfulAt, null);
  },
);

test(
  "a dated official source collected after the cutoff remains available when its proof matches",
  { skip: process.env.RUN_POSTGRES_TESTS !== "1" },
  async (t) => {
    const database = await createTheoreticalTestDatabase();
    t.after(() => database.close());
    const knownAtUtc = "2026-09-04T14:00:00Z";
    const archived = version({
      hash: "8", knownAtUtc, sourceIds: requiredSources(),
      retrievedAtUtc: "2026-09-05T10:00:00Z", historicalKnowledgeStatus: "PROVEN_HISTORICAL",
    });
    archived.sources.forEach((source) => {
      source.knowledgeStatus = "EXTERNAL_HISTORICAL_GAP";
      source.metadata.historical_evidence = historicalEvidence(source, knownAtUtc);
    });
    await appendGrainsCalendarVersion(database.pool, archived);
    const loaded = await load(database.pool, knownAtUtc);
    assert.equal(loaded.agriCalendarCoverage[0].status, "AVAILABLE");
  },
);

test(
  "calendar knowledge cannot be backdated and same-cutoff versions fail closed",
  { skip: process.env.RUN_POSTGRES_TESTS !== "1" },
  async (t) => {
    const database = await createTheoreticalTestDatabase();
    t.after(() => database.close());
    const futureHistoricalProof = version({
      hash: "d", knownAtUtc: "2026-09-04T14:00:00Z", sourceIds: requiredSources(),
      historicalKnowledgeStatus: "PROVEN_HISTORICAL", retrievedAtUtc: "2026-09-04T14:01:00Z",
    });
    futureHistoricalProof.sources.forEach((source) => {
      source.knowledgeStatus = "EXTERNAL_HISTORICAL_GAP";
      source.metadata.historical_evidence = historicalEvidence(source, "2026-09-04T14:00:01Z");
    });
    await assert.rejects(
      () => appendGrainsCalendarVersion(database.pool, futureHistoricalProof),
      /CALENDAR_HISTORICAL_PROOF_AFTER_KNOWLEDGE/,
    );
    await assert.rejects(
      () => appendGrainsCalendarVersion(database.pool, version({
        hash: "e", knownAtUtc: "2026-09-04T14:00:00Z", sourceIds: requiredSources(),
        historicalKnowledgeStatus: "PROVEN_HISTORICAL",
      })),
      /CALENDAR_HISTORICAL_PROOF_REQUIRED/,
    );
    const unknownKnowledge = version({ hash: "9", knownAtUtc: "2026-09-04T14:00:00Z",
      retrievedAtUtc: "2026-09-04T14:01:00Z", sourceIds: requiredSources(),
      historicalKnowledgeStatus: "EXTERNAL_HISTORICAL_GAP" });
    unknownKnowledge.sources.forEach((source) => { source.knowledgeStatus = "EXTERNAL_HISTORICAL_GAP"; });
    await assert.rejects(() => appendGrainsCalendarVersion(database.pool, unknownKnowledge),
      /CALENDAR_SOURCE_AFTER_KNOWLEDGE_WITHOUT_HISTORICAL_PROOF/);
    unknownKnowledge.sources.forEach((source) => { source.retrievedAtUtc = unknownKnowledge.knownAtUtc; });
    await appendGrainsCalendarVersion(database.pool, unknownKnowledge);
    const unknown = await load(database.pool, "2026-09-04T14:00:00.000Z");
    assert.equal(unknown.agriCalendarCoverage[0].status, "UNKNOWN_COVERAGE");
    await appendGrainsCalendarVersion(database.pool, version({
      hash: "1", knownAtUtc: "2026-09-04T14:00:00Z", sourceIds: requiredSources(),
      historicalKnowledgeStatus: "EXTERNAL_HISTORICAL_GAP", title: "Version one",
    }));
    await appendGrainsCalendarVersion(database.pool, version({
      hash: "2", knownAtUtc: "2026-09-04T14:00:00Z", sourceIds: requiredSources(),
      historicalKnowledgeStatus: "EXTERNAL_HISTORICAL_GAP", title: "Version two",
    }));
    const ambiguous = await load(database.pool, CUTOFF);
    assert.deepEqual(ambiguous.agriEvents, []);
    assert.equal(ambiguous.agriCalendarCoverage[0].status, "UNKNOWN_COVERAGE");
    assert.deepEqual(ambiguous.agriCalendarCoverage[0].reasonCodes, ["CALENDAR_VERSION_AMBIGUOUS"]);
  },
);

test(
  "same source hash rejects contradictory calendar content instead of accepting a false duplicate",
  { skip: process.env.RUN_POSTGRES_TESTS !== "1" },
  async (t) => {
    const database = await createTheoreticalTestDatabase();
    t.after(() => database.close());
    await appendGrainsCalendarVersion(database.pool, version({
      hash: "f", knownAtUtc: "2026-09-04T14:00:00Z", sourceIds: requiredSources(),
      historicalKnowledgeStatus: "EXTERNAL_HISTORICAL_GAP", title: "Original content",
    }));
    await assert.rejects(
      () => appendGrainsCalendarVersion(database.pool, version({
        hash: "f", knownAtUtc: "2026-09-04T14:30:00Z", sourceIds: requiredSources(),
        historicalKnowledgeStatus: "EXTERNAL_HISTORICAL_GAP", title: "Contradictory content",
      })),
      /CALENDAR_VERSION_HASH_CONFLICT/,
    );
  },
);

test("automated freshness is shared by runtime and operator projection and excludes concurrent refreshes", {
  skip: process.env.RUN_POSTGRES_TESTS !== "1",
}, async (t) => {
  const database = await createTheoreticalTestDatabase();
  t.after(() => database.close());
  const input = version({ hash: "8", knownAtUtc: "2026-09-04T08:00:00Z",
    sourceIds: requiredSources(), historicalKnowledgeStatus: "EXTERNAL_HISTORICAL_GAP" });
  input.metadata = { ingestion_mode: "AUTOMATED_USDA_V1", freshness_max_age_seconds: 21600 };
  await appendGrainsCalendarVersion(database.pool, input);
  const context = new MarketContextRepository({ pool: database.pool, initialized: Promise.resolve() });
  await context.upsertSourceCoverage({
    sourceId: "market_agri_events", sourceType: "AGRI_EVENT_CALENDAR", status: "AVAILABLE",
    asOf: "2026-09-04T18:00:00Z", coverageStart: "2026-08-01T00:00:00Z",
    coverageEnd: "2026-12-31T00:00:00Z", datasetVersion: "test-legacy-must-not-win",
  });
  const fresh = await context.current("US_GRAINS_CBOT", "2026-09-04T13:59:59Z");
  assert.equal(fresh.sourceStates.find((source) => source.sourceId === "market_agri_events").status, "AVAILABLE");
  const stale = await context.current("US_GRAINS_CBOT", "2026-09-04T14:00:00Z");
  const staleSource = stale.sourceStates.find((source) => source.sourceId === "market_agri_events");
  assert.equal(staleSource.status, "STALE");
  assert.equal(staleSource.datasetVersion, input.datasetVersion);
  assert.equal((await load(database.pool, "2026-09-04T14:00:00Z")).agriCalendarCoverage[0].status, "STALE");
  assert.equal((await context.calendarAt("2026-09-04T07:59:59Z")).sourceState.status, "UNKNOWN_COVERAGE");
  await withGrainsCalendarRefreshLease(database.pool, async () => {
    const competing = await withGrainsCalendarRefreshLease(database.pool, () => assert.fail("concurrent refresh"));
    assert.equal(competing.status, "ALREADY_RUNNING");
  });
  await assert.rejects(withGrainsCalendarRefreshLease(database.pool, () => { throw new Error("fixture failure"); }), /fixture failure/);
  assert.equal(await withGrainsCalendarRefreshLease(database.pool, async () => "recovered"), "recovered");
});

function load(pool, asOfUtc) {
  return loadGrainsCalendarVersionAt(pool, {
    startUtc: "2026-08-27T00:00:00.000Z",
    asOfUtc,
  });
}

function version({
  hash,
  knownAtUtc,
  sourceIds,
  historicalKnowledgeStatus,
  sourcePublishedAtUtc = knownAtUtc,
  retrievedAtUtc = knownAtUtc,
  status = "AVAILABLE",
  title = "Immutable event",
  pointInTimePayload = {},
}) {
  const digest = `sha256:${hash.repeat(64)}`;
  return {
    knownAtUtc,
    status,
    coverageStart: "2026-08-01T00:00:00Z",
    coverageEnd: "2026-09-30T00:00:00Z",
    datasetVersion: digest,
    sourceVersionHash: digest,
    provider: "USDA",
    sources: sourceIds.map((sourceId) => ({
      sourceId,
      sourceUrl: `https://example.test/${sourceId}`,
      sourceDocumentSha256: digest,
      retrievedAtUtc,
      knowledgeStatus: "PROVEN_CURRENT",
      historicalKnowledgeStatus,
      metadata: {
        calendar_evidence_status: "CALENDAR_SCHEDULE",
        coverage: {
          start_utc: "2026-08-01T00:00:00Z",
          end_utc: "2026-09-30T00:00:00Z",
          instruments: ["ZC", "ZW"],
        },
      },
    })),
    events: [
      {
        market_agri_event_id: "calendar-fixture",
        event_kind: "WASDE",
        title,
        event_timestamp_utc: "2026-09-05T12:00:00.000Z",
        importance: "HIGH",
        provider: "USDA",
        source_published_at_utc: sourcePublishedAtUtc,
        point_in_time_payload: pointInTimePayload,
      },
    ],
  };
}

function historicalEvidence(source, published_at_utc) {
  return {
    kind: "OFFICIAL_DATED_PUBLICATION",
    document_sha256: source.sourceDocumentSha256,
    document_url: source.sourceUrl,
    published_at_utc,
    citation: "Official dated USDA publication",
  };
}

function requiredSources() {
  return [
    "usda_nass_release_calendar",
    "usda_wasde_release_schedule",
    "usda_fas_export_sales_schedule",
  ];
}
