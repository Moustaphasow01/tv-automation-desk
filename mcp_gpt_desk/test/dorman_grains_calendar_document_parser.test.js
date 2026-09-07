import assert from "node:assert/strict";
import test from "node:test";
import {
  parseDormanCalendarItems,
  parseDormanCalendarPdf,
} from "../src/adapters/dorman-grains-calendar-document-parser.js";

const SOURCE = {
  expectedYear: 2026,
  monthIndex: 8,
  timezone: "America/Chicago",
  url: "https://www.dormantrading.com/wp-content/uploads/2026/01/Dorman-Trading-Calendar-2026-Sep.pdf",
  scope: { instruments: ["ZC", "ZW"] },
};

test("positioned Dorman facts map the explicit September holiday exception without a weekly rule", () => {
  const result = parseDormanCalendarItems({
    items: septemberItems(), source: SOURCE,
    retrievedAtUtc: "2026-09-07T12:00:00.000Z", hash: "a".repeat(64),
  });
  assert.deepEqual(result.events.map((item) => item.event_timestamp_utc), [
    "2026-09-03T12:30:00.000Z",
    "2026-09-11T12:30:00.000Z",
    "2026-09-17T12:30:00.000Z",
    "2026-09-24T12:30:00.000Z",
  ]);
  assert.equal(result.events.some((item) => item.event_timestamp_utc.startsWith("2026-09-10")), false);
  assert.equal(result.events[0].provider, "DORMAN_TRADING");
  assert.equal(result.events[0].source_published_at_utc, "2026-09-07T12:00:00.000Z");
  assert.deepEqual(result.events[0].commodity_codes, ["ZC", "ZW"]);
  assert.equal(result.events[0].point_in_time_payload.received_at_utc,
    "2026-09-07T12:00:00.000Z");
  assert.equal(result.events[0].point_in_time_payload.provider_publication_time_status,
    "UNKNOWN");
  assert.equal(result.dateCellCount, 26);
});

test("ambiguous time form and positional drift fail closed", () => {
  const ambiguous = septemberItems().map((item) => item.str === "Export Sales 7:30"
    ? { ...item, str: "Export Sales 7:30 AM" } : item);
  assert.throws(() => parseDormanCalendarItems({
    items: ambiguous, source: SOURCE,
    retrievedAtUtc: "2026-09-07T12:00:00Z", hash: "b".repeat(64),
  }), /FORM_AMBIGUOUS/);

  const drifted = septemberItems().map((item) => item.str === "Export Sales 7:30"
    ? { ...item, x: item.x + 30 } : item);
  assert.throws(() => parseDormanCalendarItems({
    items: drifted, source: SOURCE,
    retrievedAtUtc: "2026-09-07T12:00:00Z", hash: "b".repeat(64),
  }), /COLUMN_AMBIGUOUS/);
});

test("malformed PDF bytes fail inside the isolated parser worker", async () => {
  await assert.rejects(() => parseDormanCalendarPdf({
    bytes: new TextEncoder().encode("%PDF-not-a-document"),
    source: SOURCE,
    retrievedAtUtc: "2026-09-07T12:00:00Z",
    hash: "c".repeat(64),
  }), /CALENDAR_DORMAN_PDF_PARSE_FAILED/);
});

function septemberItems() {
  const items = [
    item("SEPTEMBER 2026", 100, 800, 12),
    ...["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"]
      .map((name, index) => item(name, 100 + index * 100, 760, 8)),
    item("ALL REPORT TIMES ARE CENTRAL", 100, 60, 8),
    item("Source: USDA.", 100, 40, 8),
    item("Report and exchange dates can change without notice; please verify.", 100, 20, 8),
  ];
  const positions = new Map();
  for (let day = 1; day <= 30; day += 1) {
    const weekday = new Date(Date.UTC(2026, 8, day)).getUTCDay();
    if (weekday === 0) continue;
    const column = weekday - 1;
    const week = Math.floor((day + 1) / 7);
    const date = item(String(day), 100 + column * 100, 700 - week * 100, 10);
    positions.set(day, date);
    items.push(date);
  }
  for (const day of [3, 11, 17, 24]) {
    const date = positions.get(day);
    items.push(item("Export Sales 7:30", date.x, date.y - 40, 7));
  }
  return items;
}

function item(str, x, y, height) { return { str, x, y, width: 60, height }; }
