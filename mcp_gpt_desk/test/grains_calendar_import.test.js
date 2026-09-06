import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { importGrainsCalendarEvidence } from "../src/adapters/grains-calendar-evidence-import.js";

const bytes = Buffer.from("official document test fixture");
const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const retrievedAtUtc = "2026-09-06T12:00:00Z";

test("reviewed historical schedules use public dates and preserve download dates separately", async () => {
  const result = await run(manifest());
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.knownAtUtc, "2026-02-11T00:00:00.000Z");
  assert.equal(result.sources[0].retrievedAtUtc, "2026-09-06T12:00:00.000Z");
  assert.equal(result.events[0].source_published_at_utc, result.knownAtUtc);
  assert.equal(result.events[0].event_timestamp_utc, "2026-09-03T12:30:00.000Z");
  assert.equal(result.events[0].point_in_time_payload.actual, undefined);
});

test("tampered bytes, future proof and unreviewed or unofficial documents fail closed", async () => {
  const badBytes = manifest();
  await assert.rejects(importGrainsCalendarEvidence({ manifest: badBytes, retrievedAtUtc, readDocument: async () => Buffer.from("tampered") }), /HASH_MISMATCH/);
  const future = manifest(); future.sources[0].historicalEvidence.published_at_utc = "2026-10-01T00:00Z";
  await assert.rejects(run(future), /PUBLICATION_AFTER_COLLECTION/);
  const noReview = manifest(); delete noReview.sources[0].review;
  await assert.rejects(run(noReview), /REVIEW_REQUIRED/);
  const unofficial = manifest(); unofficial.sources[0].sourceUrl = "https://usda.gov.attacker.test/calendar";
  await assert.rejects(run(unofficial), /OFFICIAL_SOURCE_REQUIRED/);
});

test("an unbound historical certificate cannot mark a schedule available", async () => {
  const mismatch = manifest(); mismatch.sources[0].historicalEvidence.document_sha256 = `sha256:${"0".repeat(64)}`;
  const result = await run(mismatch);
  assert.equal(result.status, "UNKNOWN_COVERAGE");
  assert.ok(result.reasonCodes.includes("CALENDAR_HISTORICAL_PROOF_MALFORMED"));
});

test("schedule import rejects actuals instead of making them available before publication", async () => {
  const input = manifest(); input.sources[2].events[0].actual = 123;
  await assert.rejects(run(input), /RESULT_REQUIRES_SEPARATE_PUBLICATION/);
});

test("incomplete scope stays unknown and no event count is fabricated", async () => {
  const input = manifest(); input.sources.pop();
  const result = await run(input);
  assert.equal(result.status, "UNKNOWN_COVERAGE");
  assert.ok(result.reasonCodes.includes("CALENDAR_SOURCE_SET_INCOMPLETE"));
  assert.equal(result.events.length, 0);
});

test("source-declared PDF revision requires hashed headers and metadata bound to those exact bytes", async () => {
  const input = manifest();
  const source = input.sources[0];
  const date = "2026-01-29T20:24:34.000Z";
  const headers = Buffer.from("HTTP/2 200\r\nLast-Modified: Thu, 29 Jan 2026 20:24:34 GMT\r\n");
  const metadata = Buffer.from(JSON.stringify({ schemaVersion: "grains_calendar_pdf_metadata_v1",
    documentSha256: hash, documentModifiedAtUtc: date }));
  const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
  source.historicalEvidence = { ...source.historicalEvidence, kind: "OFFICIAL_VERSION_METADATA",
    document_modified_at_utc: date, server_last_modified_utc: date,
    headers_file: "headers.txt", headers_sha256: digest(headers),
    metadata_file: "metadata.json", metadata_sha256: digest(metadata) };
  const readDocument = async (name) => name === "headers.txt" ? headers : name === "metadata.json" ? metadata : bytes;
  const execute = () => importGrainsCalendarEvidence({ manifest: input, retrievedAtUtc, readDocument });
  assert.equal((await execute()).status, "AVAILABLE");
  source.historicalEvidence.server_last_modified_utc = "2026-01-28T20:24:34Z";
  await assert.rejects(execute(), /SERVER_VERSION_DATE_MISMATCH/);
  source.historicalEvidence.server_last_modified_utc = date;
  source.historicalEvidence.metadata_sha256 = `sha256:${"0".repeat(64)}`;
  await assert.rejects(execute(), /METADATA_HASH_MISMATCH/);
});

function run(manifest) { return importGrainsCalendarEvidence({ manifest, retrievedAtUtc, readDocument: async () => bytes }); }
function manifest() {
  const coverage = { start_utc: "2026-08-31T00:00:00Z", end_utc: "2026-09-04T23:59:59Z", instruments: ["ZC", "ZW"] };
  return { schemaVersion: "grains_calendar_evidence_manifest_v1", coverageStart: coverage.start_utc, coverageEnd: coverage.end_utc,
    sources: ["usda_nass_release_calendar", "usda_wasde_release_schedule", "usda_fas_export_sales_schedule"].map((sourceId, index) => {
      const sourceUrl = `https://www.usda.gov/${sourceId}.pdf`;
      return { sourceId, sourceUrl, documentFile: `${sourceId}.pdf`, documentSha256: hash, coverage,
        review: { citation: "Fixture publication page 1", scope: "Test schedule only" },
        historicalEvidence: { kind: "OFFICIAL_DATED_PUBLICATION", document_sha256: hash, document_url: sourceUrl,
          published_at_utc: "2026-02-11T00:00:00Z", citation: "Fixture dated publication" },
        events: index === 2 ? [{ eventId: "fas-weekly", eventKind: "EXPORT_SALES", title: "Weekly Export Sales",
          scheduledAtUtc: "2026-09-03T12:30:00Z", importance: "HIGH", evidenceCitation: "Fixture weekly schedule" }] : [] };
    }) };
}
