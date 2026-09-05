import assert from "node:assert/strict";
import test from "node:test";
import {
  appendGrainsCalendarVersion,
  loadGrainsCalendarVersionAt,
} from "../src/persistence/postgres-grains-calendar-ledger.js";
import { createTheoreticalTestDatabase } from "./support/theoretical-postgres-fixtures.js";

const CUTOFF = "2026-09-04T15:00:00.000Z";

test(
  "calendar ledger preserves the source-version event snapshot and historical gaps fail closed",
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
    assert.ok(
      historical.agriCalendarCoverage[0].reasonCodes.includes(
        "EXTERNAL_HISTORICAL_GAP",
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
      }),
    );
    assert.equal(
      (await load(database.pool, CUTOFF)).agriEvents[0].title,
      "Frozen NASS event",
    );
    const prospective = await load(database.pool, "2026-09-04T15:02:00.000Z");
    assert.equal(prospective.agriCalendarCoverage[0].status, "AVAILABLE");
    assert.ok(
      prospective.agriCalendarCoverage[0].reasonCodes.includes(
        "EXTERNAL_HISTORICAL_GAP",
      ),
    );
    await assert.rejects(
      () =>
        database.pool.query(
          "UPDATE market_agri_calendar_versions SET provider='mutated'",
        ),
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
  "calendar knowledge cannot be backdated and same-cutoff versions fail closed",
  { skip: process.env.RUN_POSTGRES_TESTS !== "1" },
  async (t) => {
    const database = await createTheoreticalTestDatabase();
    t.after(() => database.close());
    await assert.rejects(
      () => appendGrainsCalendarVersion(database.pool, version({
        hash: "d", knownAtUtc: "2026-09-04T14:00:00Z", sourceIds: requiredSources(),
        historicalKnowledgeStatus: "EXTERNAL_HISTORICAL_GAP", retrievedAtUtc: "2026-09-04T14:01:00Z",
      })),
      /CALENDAR_SOURCE_RETRIEVED_AFTER_VERSION_KNOWLEDGE/,
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
  title = "Immutable event",
}) {
  const digest = `sha256:${hash.repeat(64)}`;
  return {
    knownAtUtc,
    status: "AVAILABLE",
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
      metadata: { calendar_evidence_status: "CALENDAR_SCHEDULE" },
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
      },
    ],
  };
}

function requiredSources() {
  return [
    "usda_nass_release_calendar",
    "usda_wasde_release_schedule",
    "usda_fas_export_sales_schedule",
  ];
}
