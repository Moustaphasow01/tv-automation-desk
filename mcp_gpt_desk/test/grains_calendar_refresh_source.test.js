import test from "node:test";
import assert from "node:assert/strict";
import { createUsdaCalendarCollection } from "../src/adapters/usda-grains-calendar-refresh-source.js";

test("collection archives all actual receipts and qualifies coverage only from final receipt", async () => {
  const calls = [];
  let time = Date.parse("2026-09-07T08:00:00Z");
  const collect = createUsdaCalendarCollection({
    nowUtc: () => new Date(time += 1000).toISOString(),
    fetchText: async (url) => { calls.push("fetch"); return url; },
    archiveDocument: async (receipt) => { calls.push(receipt); },
    parseCollection: async (command) => command,
  });
  const result = await collect({ asOfUtc: "2026-09-07T08:00:00Z" });
  assert.equal(result.coverageStart, result.retrievedAtUtc);
  assert.equal(result.retrievedAtUtc, "2026-09-07T08:00:04.000Z");
  assert.equal(calls.filter((item) => typeof item === "object").length, 3);
  for (const source of result.sources) assert.equal(await result.fetchText(source.url), source.url);
});

test("partial source failure archives and parses successful receipts as unavailable evidence", async () => {
  const archived = [];
  let parsed = null;
  const collect = createUsdaCalendarCollection({
    nowUtc: () => "2026-09-07T08:00:00Z",
    fetchText: async (url) => { if (url.includes("fas.usda")) throw new Error("USDA_SOURCE_HTTP_403"); return "fixture"; },
    archiveDocument: async (receipt) => { archived.push(receipt); },
    parseCollection: async (command) => {
      parsed = command;
      return {
        manifests: [], agriEvents: [{ market_agri_event_id: "nass-event" }],
        agriCalendarCoverage: [{
          status: "UNKNOWN_COVERAGE", reasonCodes: ["CALENDAR_SOURCE_SET_INCOMPLETE"],
          sourceDiagnostics: [{
            sourceId: "usda_fas_export_sales_schedule", ignored: false, qualified: false,
            reasonCodes: ["CALENDAR_REQUIRED_SOURCE_MISSING"],
          }],
        }],
        calendarVersion: {
          status: "UNKNOWN_COVERAGE", knownAtUtc: command.retrievedAtUtc,
          reasonCodes: ["CALENDAR_SOURCE_SET_INCOMPLETE"], sources: [{ sourceId: "nass" }],
          events: [{ market_agri_event_id: "nass-event" }],
        },
      };
    },
  });
  const result = await collect({ asOfUtc: "2026-09-07T08:00:00Z" });
  assert.equal(archived.length, 2);
  assert.equal(parsed.sources.length, 2);
  assert.equal(result.calendarVersion.status, "UNAVAILABLE");
  assert.equal(result.agriEvents.length, 1);
  assert.ok(result.calendarVersion.reasonCodes.includes("USDA_SOURCE_HTTP_403"));
  assert.equal(result.calendarVersion.metadata.source_failures[0].source_id,
    "usda_fas_export_sales_schedule");
  assert.equal(result.sourceFailures[0].reasonCode, "USDA_SOURCE_HTTP_403");
  const fasDiagnostic = result.agriCalendarCoverage[0].sourceDiagnostics.filter((item) =>
    item.sourceId === "usda_fas_export_sales_schedule");
  assert.equal(fasDiagnostic.length, 1);
  assert.ok(fasDiagnostic[0].reasonCodes.includes("CALENDAR_REQUIRED_SOURCE_FETCH_FAILED"));
  assert.ok(fasDiagnostic[0].reasonCodes.includes("USDA_SOURCE_HTTP_403"));
});

test("a total source failure remains unavailable without manufacturing a canonical version", async () => {
  const collect = createUsdaCalendarCollection({
    nowUtc: () => "2026-09-07T08:00:00Z",
    fetchText: async () => { throw new Error("USDA_SOURCE_HTTP_503"); },
    archiveDocument: async () => assert.fail("failed bytes cannot be archived"),
    parseCollection: async () => assert.fail("empty evidence cannot be parsed"),
  });
  await assert.rejects(collect({ asOfUtc: "2026-09-07T08:00:00Z" }), /USDA_SOURCE_HTTP_503/);
});

test("an archive failure aborts instead of publishing evidence without an immutable receipt", async () => {
  const collect = createUsdaCalendarCollection({
    nowUtc: () => "2026-09-07T08:00:00Z",
    fetchText: async () => "fixture",
    archiveDocument: async () => { throw new Error("CALENDAR_ARCHIVE_HASH_CONFLICT"); },
    parseCollection: async () => assert.fail("unarchived evidence cannot be parsed"),
  });
  await assert.rejects(collect({ asOfUtc: "2026-09-07T08:00:00Z" }),
    /CALENDAR_ARCHIVE_HASH_CONFLICT/);
});

test("clock regression and new year during receipt cannot backdate a published calendar", async () => {
  for (const [asOfUtc, receivedAtUtc, error] of [
    ["2026-09-07T08:00:00Z", "2026-09-07T07:59:59Z", /CLOCK_REGRESSION/],
    ["2026-12-31T23:59:59Z", "2027-01-01T00:00:01Z", /YEAR_CHANGED/],
  ]) {
    const collect = createUsdaCalendarCollection({
      nowUtc: () => receivedAtUtc, fetchText: async () => "fixture", archiveDocument: async () => {},
      parseCollection: async () => { assert.fail("invalid receipt time"); },
    });
    await assert.rejects(collect({ asOfUtc }), error);
  }
});
