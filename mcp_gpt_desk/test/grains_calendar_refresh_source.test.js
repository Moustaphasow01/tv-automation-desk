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

test("partial source failure waits for other receipts and never calls the calendar parser", async () => {
  const archived = [];
  const collect = createUsdaCalendarCollection({
    nowUtc: () => "2026-09-07T08:00:00Z",
    fetchText: async (url) => { if (url.includes("fas.usda")) throw new Error("USDA_HTTP_403"); return "fixture"; },
    archiveDocument: async (receipt) => { archived.push(receipt); },
    parseCollection: async () => { assert.fail("must not parse incomplete collection"); },
  });
  await assert.rejects(collect({ asOfUtc: "2026-09-07T08:00:00Z" }), /USDA_HTTP_403/);
  assert.equal(archived.length, 2);
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
