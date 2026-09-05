import assert from "node:assert/strict";
import test from "node:test";
import {
  collectUsdaGrainsCalendar,
  fetchUsdaCalendarText,
  fetchUsdaSourceText,
} from "../src/adapters/usda-grains-calendar-collector.js";

test("collector keeps retrieval knowledge current and historical coverage unknown", async () => {
  const text =
    "BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20260911T160000Z\nSUMMARY:WASDE and Crop Production\nEND:VEVENT\nEND:VCALENDAR";
  const result = await collectUsdaGrainsCalendar({
    sources: [
      {
        sourceId: "usda_nass_2026_ics",
        sourceKind: "ICS",
        url: "https://example.test/calendar.ics",
      },
    ],
    retrievedAtUtc: "2026-09-05T12:00:00.000Z",
    fetchText: async () => text,
  });
  assert.equal(result.agriEvents.length, 1);
  assert.equal(
    result.agriEvents[0].source_published_at_utc,
    "2026-09-05T12:00:00.000Z",
  );
  assert.equal(result.agriCalendarCoverage[0].status, "UNKNOWN_COVERAGE");
  assert.ok(result.manifests[0].sha256.startsWith("sha256:"));
  assert.equal(result.calendarVersion.knownAtUtc, "2026-09-05T12:00:00.000Z");
  assert.equal(
    result.calendarVersion.sources[0].historicalKnowledgeStatus,
    "EXTERNAL_HISTORICAL_GAP",
  );
});

test("NASS floating noon is Eastern per source, honoring winter and summer", async () => {
  for (const [stamp, expected] of [
    ["20260112T120000", "2026-01-12T17:00:00.000Z"],
    ["20260911T120000", "2026-09-11T16:00:00.000Z"],
  ]) {
    const result = await collect([
      event(`DTSTART:${stamp}`, "Crop Production"),
    ]);
    assert.equal(result.agriEvents[0].event_timestamp_utc, expected);
    assert.equal(result.agriEvents[0].event_kind, "OTHER");
    assert.equal(
      result.agriEvents[0].point_in_time_payload.canonical_kind,
      "CROP_PRODUCTION",
    );
  }
});

test("explicit TZID overrides source timezone; unfolded names preserve semantics", async () => {
  const result = await collect([
    event("DTSTART;TZID=America/Chicago:20260112T120000", "Crop\r\n  Progress"),
  ]);
  assert.equal(
    result.agriEvents[0].event_timestamp_utc,
    "2026-01-12T18:00:00.000Z",
  );
  assert.equal(result.agriEvents[0].event_kind, "CROP_PROGRESS");
});

test("malformed dates, missing timezone and ambiguous/nonexistent DST are refused", async () => {
  for (const start of [
    "DTSTART:20260230T120000Z",
    "DTSTART:20260911T250000Z",
    "DTSTART;TZID=America/New_York:20260308T023000",
    "DTSTART;TZID=America/New_York:20261101T013000",
  ]) {
    await assert.rejects(() => collect([event(start)]), /EVENT_TIME_INVALID/);
  }
  await assert.rejects(
    () => collect([event("DTSTART:20260911T120000")], undefined),
    /EVENT_TIME_INVALID/,
  );
});

test("different titles remain unique, identical repeated UID is deduped and conflicting UID fails", async () => {
  const result = await collect(
    ["Crop Production", "Crop Production - Ann.", "Grain Stocks"].map((name) =>
      event("DTSTART:20260112T170000Z", name),
    ),
  );
  assert.equal(
    new Set(result.agriEvents.map((row) => row.market_agri_event_id)).size,
    3,
  );
  const one = event("DTSTART:20260112T170000Z", "Grain Stocks", "one");
  assert.equal((await collect([one, one])).agriEvents.length, 1);
  await assert.rejects(
    () =>
      collect([one, event("DTSTART:20260113T170000Z", "Grain Stocks", "one")]),
    /ID_CONFLICT/,
  );
});

test("HTTP, HTML and document errors fail closed; timeout is explicit", async () => {
  const fetcher = async (_url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    return new Response("bad", { status: 503 });
  };
  await assert.rejects(
    () => fetchUsdaCalendarText("https://example.test", fetcher),
    /HTTP_503/,
  );
  await assert.rejects(
    () =>
      fetchUsdaCalendarText(
        "https://example.test",
        async () =>
          new Response("<html>", { headers: { "content-type": "text/html" } }),
      ),
    /CONTENT_TYPE/,
  );
  await assert.rejects(
    () =>
      collectUsdaGrainsCalendar({
        sources: [source()],
        retrievedAtUtc: "2026-09-05T12:00Z",
        fetchText: async () => "<html>blocked</html>",
      }),
    /DOCUMENT_INVALID/,
  );
});

test("calendar metadata never backdates knowledge and source bytes can be reverified", async () => {
  const result = await collect([
    event("DTSTART:20260112T170000Z") +
      "\nCREATED:20250101T000000Z\nDTSTAMP:20260101T000000Z",
  ]);
  assert.equal(
    result.manifests[0].calendar_created_at_utc,
    "2025-01-01T00:00:00.000Z",
  );
  assert.equal(
    result.agriEvents[0].source_published_at_utc,
    "2026-09-05T12:00:00.000Z",
  );
  assert.match(
    result.agriCalendarCoverage[0].sourceVersionHash,
    /^sha256:[a-f0-9]{64}$/,
  );
  assert.ok(result.manifests[0].source_document.startsWith("BEGIN:VCALENDAR"));
});

test("dated FAS and WASDE evidence is hashed but cannot certify historical calendar coverage", async () => {
  const result = await collectUsdaGrainsCalendar({
    sources: [
      source(),
      {
        sourceId: "usda_wasde_release_schedule",
        sourceKind: "SCHEDULE_EVIDENCE",
        calendarEvidenceStatus: "INSUFFICIENT",
        url: "https://example.test/wasde",
      },
      {
        sourceId: "usda_fas_export_sales_schedule",
        sourceKind: "SCHEDULE_EVIDENCE",
        calendarEvidenceStatus: "INSUFFICIENT",
        url: "https://example.test/fas",
      },
    ],
    retrievedAtUtc: "2026-09-05T12:00:00.000Z",
    fetchText: async (url) =>
      url.endsWith("wasde") || url.endsWith("fas")
        ? "official dated source evidence"
        : "BEGIN:VCALENDAR\nEND:VCALENDAR",
  });
  assert.equal(result.manifests.length, 3);
  assert.equal(result.calendarVersion.sources.length, 3);
  assert.equal(result.manifests[1].source_document, null);
  assert.equal(result.agriCalendarCoverage[0].status, "UNKNOWN_COVERAGE");
  assert.ok(
    result.agriCalendarCoverage[0].reasonCodes.includes(
      "EXTERNAL_HISTORICAL_GAP",
    ),
  );
  assert.ok(
    result.agriCalendarCoverage[0].reasonCodes.includes(
      "CALENDAR_SOURCE_SET_INCOMPLETE",
    ),
  );
});

test("generic official source reader is bounded and rejects empty and HTTP responses", async () => {
  await assert.rejects(
    () =>
      fetchUsdaSourceText(
        "https://example.test",
        async () => new Response("", { status: 200 }),
      ),
    /DOCUMENT_EMPTY/,
  );
  await assert.rejects(
    () =>
      fetchUsdaSourceText(
        "https://example.test",
        async () => new Response("no", { status: 502 }),
      ),
    /HTTP_502/,
  );
});

function event(start, title = "Grain Stocks", uid = null) {
  return `BEGIN:VEVENT\n${start}\nSUMMARY:${title}\n${uid ? `UID:${uid}\n` : ""}END:VEVENT`;
}
function source(timezone) {
  return {
    sourceId: "test",
    sourceKind: "ICS",
    url: "https://example.test/calendar.ics",
    timezone,
  };
}
function collect(blocks, ...zone) {
  const timezone = zone.length ? zone[0] : "America/New_York";
  return collectUsdaGrainsCalendar({
    sources: [source(timezone)],
    retrievedAtUtc: "2026-09-05T12:00:00.000Z",
    fetchText: async () =>
      `BEGIN:VCALENDAR\n${blocks.join("\n")}\nEND:VCALENDAR`,
  });
}
