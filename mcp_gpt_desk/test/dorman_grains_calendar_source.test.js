import assert from "node:assert/strict";
import test from "node:test";
import {
  collectDormanGrainsCalendar,
  fetchDormanCalendarBytes,
  parseDormanAnnualPdfLinks,
} from "../src/adapters/dorman-grains-calendar-source.js";

test("annual index requires one exact PDF link for every month", () => {
  const links = parseDormanAnnualPdfLinks(indexFixture(), 2026);
  assert.equal(links.length, 12);
  assert.match(links[8], /Calendar-2026-Sep\.pdf$/);
  assert.throws(() => parseDormanAnnualPdfLinks(indexFixture().replace(/[^\n]*-Nov\.pdf[^\n]*\n/, ""), 2026),
    /ANNUAL_INDEX_INCOMPLETE/);
});

test("collection hashes and archives current bytes before parser transfer", async () => {
  const steps = [];
  let clock = Date.parse("2026-09-07T12:00:00Z");
  const result = await collectDormanGrainsCalendar({
    expectedYear: 2026,
    coverageStart: "2026-09-07T12:00:00Z",
    coverageEnd: "2026-09-14T11:59:59Z",
    nowUtc: () => new Date(clock += 1000).toISOString(),
    fetchBytes: async (_url, scope) => ({
      bytes: new TextEncoder().encode(scope.kind === "INDEX" ? indexFixture() : "%PDF-fixture"),
    }),
    archiveDocument: async ({ source }) => {
      steps.push(`archive:${source.sourceKind}`);
      return `receipts/${steps.length}.json`;
    },
    parsePdf: async ({ source, retrievedAtUtc, hash }) => {
      steps.push("parse");
      assert.equal(steps.at(-2), "archive:DORMAN_TRADING_CALENDAR_PDF");
      assert.match(hash, /^[a-f0-9]{64}$/);
      return {
        coverage: {
          start_utc: "2026-09-01T05:00:00.000Z",
          end_utc: "2026-10-01T04:59:59.999Z",
          instruments: ["ZC", "ZW"],
        },
        events: [{
          market_agri_event_id: "dorman-export-sales-2026-09-11",
          event_kind: "EXPORT_SALES", provider: "DORMAN_TRADING",
          event_timestamp_utc: "2026-09-11T12:30:00.000Z",
          source_published_at_utc: retrievedAtUtc, source_url: source.url,
        }],
      };
    },
  });
  assert.deepEqual(steps, [
    "archive:DORMAN_TRADING_CALENDAR_INDEX",
    "archive:DORMAN_TRADING_CALENDAR_PDF",
    "parse",
  ]);
  assert.equal(result.manifest.document_receipts.length, 2);
  assert.equal(result.manifest.authority_class, "SECONDARY_PUBLISHER");
  assert.equal(result.manifest.fallback_reason_code, undefined);
  assert.equal(result.events.length, 1);
});

test("network reader permits only the pinned Dorman index/PDF paths", async () => {
  await assert.rejects(() => fetchDormanCalendarBytes(
    "https://example.test/Dorman-Trading-Calendar-2026-Sep.pdf",
    { kind: "PDF", expectedYear: 2026 }, async () => assert.fail("must not fetch"),
  ), /URL_FORBIDDEN/);
  await assert.rejects(() => fetchDormanCalendarBytes(
    "https://www.dormantrading.com/wp-content/uploads/2026/01/Dorman-Trading-Calendar-2026-Sep.pdf",
    { kind: "PDF", expectedYear: 2026 },
    async () => new Response("html", { headers: { "content-type": "text/html" } }),
  ), /CONTENT_TYPE_INVALID/);
});

test("Dorman reader cancels bodies rejected before parsing", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("blocked")); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(() => fetchDormanCalendarBytes(
    "https://www.dormantrading.com/trading-resources/market-calendar/",
    { kind: "INDEX", expectedYear: 2026 },
    async () => new Response(body, { status: 503 }),
  ), /HTTP_503/);
  assert.equal(cancelled, true);

  cancelled = false;
  const redirectBody = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("redirect")); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(() => fetchDormanCalendarBytes(
    "https://www.dormantrading.com/trading-resources/market-calendar/",
    { kind: "INDEX", expectedYear: 2026 },
    async () => new Response(redirectBody, { status: 302 }),
  ), /REDIRECT_INVALID/);
  assert.equal(cancelled, true);
});

function indexFixture() {
  return [
    '<a href="/about-us/">navigation</a>',
    '<a href="https://example.test/">external navigation</a>',
    '<a href="https://www.dormantrading.com/wp-content/uploads/2025/01/Dorman-Trading-Calendar-2025-Jan.pdf">prior year</a>',
    ...Array.from({ length: 12 }, (_, index) => {
    const suffix = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][index];
    return `<a href="https://www.dormantrading.com/wp-content/uploads/2026/01/Dorman-Trading-Calendar-2026-${suffix}.pdf">${suffix}</a>`;
    }),
  ].join("\n");
}
