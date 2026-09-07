import test from "node:test";
import assert from "node:assert/strict";
import { refreshGrainsCalendar } from "../src/application/refresh-grains-calendar.js";

function fixture(overrides = {}) {
  const calls = [];
  const version = { status: "AVAILABLE", knownAtUtc: "2026-09-07T08:01:00Z", datasetVersion: `sha256:${"a".repeat(64)}`, sources: [1, 2, 3], events: [1] };
  const ports = {
    nowUtc: () => "2026-09-07T08:02:00Z",
    exclusive: async (run) => { calls.push("lock"); return run(); },
    collect: async () => { calls.push("collect"); return { calendarVersion: version, agriCalendarCoverage: [{}] }; },
    archive: async () => { calls.push("archive"); return "collections/hash.json"; },
    append: async (calendar) => { calls.push(calendar); return { version: { sourceVersionHash: calendar.sourceVersionHash }, inserted: true }; },
    writeStatus: async (status) => { calls.push("status"); return status; },
    ...overrides,
  };
  return { calls, ports, version };
}

test("refresh archives before publication and uses actual observation time for immutable version", async () => {
  const { calls, ports } = fixture();
  const result = await refreshGrainsCalendar({ mode: "ENABLED" }, ports);
  assert.equal(result.status, "AVAILABLE");
  assert.deepEqual(calls.slice(0, 3), ["lock", "collect", "archive"]);
  assert.equal(calls[3].knownAtUtc, "2026-09-07T08:01:00Z");
  assert.equal(result.freshUntilUtc, "2026-09-07T14:01:00.000Z");
  assert.match(calls[3].sourceVersionHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(calls[3].metadata.freshness_max_age_seconds, 21600);
});

test("incomplete coverage and archival failure never publish or refresh last good knowledge", async () => {
  const incomplete = fixture();
  incomplete.version.status = "UNKNOWN_COVERAGE";
  incomplete.version.reasonCodes = ["CALENDAR_SOURCE_SET_INCOMPLETE"];
  assert.equal((await refreshGrainsCalendar({ mode: "ENABLED" }, incomplete.ports)).status, "UNKNOWN_COVERAGE");
  assert.ok(incomplete.calls.every((call) => typeof call === "string"));
  const failed = fixture({ archive: async () => { throw new Error("CALENDAR_ARCHIVE_HASH_CONFLICT"); } });
  const result = await refreshGrainsCalendar({ mode: "ENABLED" }, failed.ports);
  assert.deepEqual(result.reasonCodes, ["CALENDAR_ARCHIVE_HASH_CONFLICT"]);
  assert.ok(failed.calls.every((call) => typeof call === "string"));
});

test("disabled and already-running refresh do not perform network or database publication", async () => {
  const disabled = fixture();
  assert.equal((await refreshGrainsCalendar({ mode: "DISABLED" }, disabled.ports)).status, "DISABLED_BY_POLICY");
  assert.deepEqual(disabled.calls, ["status"]);
  const busy = fixture({ exclusive: async () => ({ status: "ALREADY_RUNNING" }) });
  assert.equal((await refreshGrainsCalendar({ mode: "ENABLED" }, busy.ports)).status, "ALREADY_RUNNING");
  assert.deepEqual(busy.calls, []);
});

test("provider/database errors cannot leak secrets through maintenance status", async () => {
  const { ports } = fixture({ collect: async () => { throw new Error("postgres://secret@host/db"); } });
  const result = await refreshGrainsCalendar({ mode: "ENABLED" }, ports);
  assert.deepEqual(result.reasonCodes, ["CALENDAR_REFRESH_FAILED"]);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("database lease failure records unavailable without leaking connection details", async () => {
  const { calls, ports } = fixture({ exclusive: async () => { throw new Error("postgres://secret@host/db"); } });
  const result = await refreshGrainsCalendar({ mode: "ENABLED" }, ports);
  assert.equal(result.status, "UNAVAILABLE");
  assert.deepEqual(result.reasonCodes, ["CALENDAR_REFRESH_LEASE_FAILED"]);
  assert.deepEqual(calls, ["status"]);
});

test("same receipt is idempotent; a genuinely later observation gets a distinct version", async () => {
  const first = fixture();
  const second = fixture();
  const later = fixture();
  later.version.knownAtUtc = "2026-09-07T09:01:00Z";
  for (const item of [first, second, later]) await refreshGrainsCalendar({ mode: "ENABLED" }, item.ports);
  assert.equal(first.calls[3].sourceVersionHash, second.calls[3].sourceVersionHash);
  assert.notEqual(first.calls[3].sourceVersionHash, later.calls[3].sourceVersionHash);
});
