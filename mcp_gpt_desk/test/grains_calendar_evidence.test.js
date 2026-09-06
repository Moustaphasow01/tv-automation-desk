import assert from "node:assert/strict";
import test from "node:test";
import { qualifyGrainsCalendarEvidence } from "../src/grains-calendar-evidence.js";

const KNOWN_AT = "2026-09-04T15:00:00.000Z";
const WINDOW = {
  coverageStart: "2026-08-01T00:00:00.000Z",
  coverageEnd: "2026-09-30T00:00:00.000Z",
};

test("current USDA schedule evidence qualifies without a historical archive claim", () => {
  const result = qualify({ sources: requiredSources() });
  assert.equal(result.status, "AVAILABLE");
  assert.deepEqual(result.reasonCodes, []);
  assert.equal(result.coverageStart, WINDOW.coverageStart);
  assert.equal(result.coverageEnd, WINDOW.coverageEnd);
});

test("a later retrieval qualifies with matching official publication or version metadata evidence", () => {
  const result = qualify({
    sources: requiredSources({
      retrievedAtUtc: "2026-09-05T12:00:00.000Z",
      knowledgeStatus: "EXTERNAL_HISTORICAL_GAP",
      historicalKnowledgeStatus: "PROVEN_HISTORICAL",
      historicalEvidence: { kind: "OFFICIAL_DATED_PUBLICATION", published_at_utc: KNOWN_AT },
    }),
  });
  assert.equal(result.status, "AVAILABLE");

  const officialRevision = qualify({
    sources: requiredSources({
      retrievedAtUtc: "2026-09-05T12:00:00.000Z",
      knowledgeStatus: "EXTERNAL_HISTORICAL_GAP",
      historicalKnowledgeStatus: "PROVEN_HISTORICAL",
      historicalEvidence: {
        kind: "OFFICIAL_VERSION_METADATA",
        document_modified_at_utc: "2026-09-04T14:00:00.000Z",
        server_last_modified_utc: KNOWN_AT,
      },
    }),
  });
  assert.equal(officialRevision.status, "AVAILABLE");
});

test("future, malformed, or mismatched historical evidence fails closed", () => {
  for (const historicalEvidence of [
    { kind: "OFFICIAL_DATED_PUBLICATION", published_at_utc: "2026-09-04T15:00:01.000Z" },
    { kind: "ARCHIVED_OBSERVATION", observed_at_utc: KNOWN_AT, document_sha256: `sha256:${"b".repeat(64)}` },
    { kind: "ARCHIVED_OBSERVATION", observed_at_utc: KNOWN_AT, document_url: "https://example.test/other" },
    { kind: "ARCHIVED_OBSERVATION", observed_at_utc: KNOWN_AT, citation: "" },
    {
      kind: "OFFICIAL_VERSION_METADATA",
      document_modified_at_utc: KNOWN_AT,
      server_last_modified_utc: "2026-09-04T15:00:01.000Z",
    },
  ]) {
    const result = qualify({
      sources: requiredSources({
        retrievedAtUtc: "2026-09-05T12:00:00.000Z",
        knowledgeStatus: "EXTERNAL_HISTORICAL_GAP",
        historicalKnowledgeStatus: "PROVEN_HISTORICAL",
        historicalEvidence,
      }),
    });
    assert.equal(result.status, "UNKNOWN_COVERAGE");
    assert.ok(result.reasonCodes.includes("CALENDAR_SOURCE_SET_INCOMPLETE"));
  }
});

test("coverage bounds, missing sources, gaps, and legacy claims cannot become available", () => {
  const outside = qualify({
    sources: requiredSources({ coverage: coverage("2026-08-02T00:00:00Z", "2026-09-30T00:00:00Z") }),
  });
  assert.equal(outside.status, "UNKNOWN_COVERAGE");
  assert.ok(outside.reasonCodes.includes("CALENDAR_SOURCE_COVERAGE_INSUFFICIENT"));

  const missing = qualify({ sources: requiredSources().slice(0, 2) });
  assert.equal(missing.status, "UNKNOWN_COVERAGE");
  assert.ok(missing.reasonCodes.includes("CALENDAR_SOURCE_SET_INCOMPLETE"));

  const gap = qualify({ sources: requiredSources({ knowledgeStatus: "EXTERNAL_HISTORICAL_GAP" }) });
  assert.equal(gap.status, "UNKNOWN_COVERAGE");

  const legacy = qualify({
    sources: requiredSources({ metadata: { calendar_evidence_status: "CALENDAR_SCHEDULE", coverage: null } }),
  });
  assert.equal(legacy.status, "UNKNOWN_COVERAGE");
});

test("optional sources do not weaken a complete required source set", () => {
  const optional = source("optional_usda_notice", {
    knowledgeStatus: "EXTERNAL_HISTORICAL_GAP",
    metadata: {},
  });
  const result = qualify({ sources: [...requiredSources(), optional] });
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.sourceDiagnostics.find((item) => item.sourceId === optional.sourceId).ignored, true);
});

test("conflicting duplicate required source evidence fails closed", () => {
  const sources = requiredSources();
  sources.push(source("usda_nass_release_calendar", {
    coverage: coverage("2026-08-02T00:00:00Z", "2026-09-30T00:00:00Z"),
  }));
  const result = qualify({ sources });
  assert.equal(result.status, "UNKNOWN_COVERAGE");
  assert.ok(result.reasonCodes.includes("CALENDAR_REQUIRED_SOURCE_AMBIGUOUS"));
});

function qualify({ sources }) {
  return qualifyGrainsCalendarEvidence({ sources, knownAtUtc: KNOWN_AT, ...WINDOW });
}

function requiredSources(overrides = {}) {
  return [
    "usda_nass_release_calendar",
    "usda_wasde_release_schedule",
    "usda_fas_export_sales_schedule",
  ].map((sourceId) => source(sourceId, overrides));
}

function source(sourceId, overrides = {}) {
  const hash = `sha256:${"a".repeat(64)}`;
  const sourceUrl = `https://example.test/${sourceId}`;
  const {
    historicalEvidence,
    coverage: sourceCoverage,
    metadata: metadataOverrides,
    ...sourceOverrides
  } = overrides;
  return {
    sourceId,
    sourceUrl,
    sourceDocumentSha256: hash,
    retrievedAtUtc: KNOWN_AT,
    knowledgeStatus: "PROVEN_CURRENT",
    historicalKnowledgeStatus: "EXTERNAL_HISTORICAL_GAP",
    metadata: {
      calendar_evidence_status: "CALENDAR_SCHEDULE",
      coverage: sourceCoverage || coverage(),
      ...metadataOverrides,
      ...(historicalEvidence === undefined ? {} : {
        historical_evidence: {
          document_sha256: hash,
          document_url: sourceUrl,
          citation: "USDA dated schedule",
          ...historicalEvidence,
        },
      }),
    },
    ...sourceOverrides,
  };
}

function coverage(start_utc = "2026-08-01T00:00:00.000Z", end_utc = "2026-09-30T00:00:00.000Z") {
  return { start_utc, end_utc, instruments: ["ZC", "ZW"] };
}
