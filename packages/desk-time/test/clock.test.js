import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FixedClock, SystemClock } from "../src/clock.js";
import { toParisIso, toUtcIso, parisOffset } from "../src/paris.js";

describe("parisOffset — DST-aware", () => {
  it("returns +02:00 in summer (2026-07-02)", () => {
    assert.strictEqual(parisOffset(new Date("2026-07-02T12:00:00Z")), "+02:00");
  });

  it("returns +01:00 in winter (2026-01-15)", () => {
    assert.strictEqual(parisOffset(new Date("2026-01-15T12:00:00Z")), "+01:00");
  });
});

describe("FixedClock", () => {
  it("returns deterministic utc and paris from epochMs", () => {
    // 2026-07-02T10:00:00Z = 12:00 Paris (été, +02:00)
    const epochMs = Date.parse("2026-07-02T10:00:00Z");
    const clock = new FixedClock(epochMs);
    const t = clock.now();
    assert.strictEqual(t.epochMs, epochMs);
    assert.strictEqual(t.utc, "2026-07-02T10:00:00.000Z");
    assert.ok(t.paris.startsWith("2026-07-02T12:00:00"), `paris should start with 2026-07-02T12:00:00, got: ${t.paris}`);
    assert.ok(t.paris.endsWith("+02:00"), `paris should end with +02:00, got: ${t.paris}`);
  });

  it("winter: 2026-01-15T09:00:00Z = 10:00 Paris (+01:00)", () => {
    const epochMs = Date.parse("2026-01-15T09:00:00Z");
    const clock = new FixedClock(epochMs);
    const t = clock.now();
    assert.ok(t.paris.startsWith("2026-01-15T10:00:00"), `got: ${t.paris}`);
    assert.ok(t.paris.endsWith("+01:00"), `got: ${t.paris}`);
  });
});

describe("toUtcIso / toParisIso", () => {
  it("round-trips epochMs -> utc -> paris", () => {
    const epochMs = Date.parse("2026-07-02T10:00:00Z");
    const utc = toUtcIso(epochMs);
    assert.strictEqual(utc, "2026-07-02T10:00:00.000Z");
    const paris = toParisIso(epochMs);
    assert.ok(paris.includes("T12:00:00"), `got: ${paris}`);
    assert.ok(paris.endsWith("+02:00"), `got: ${paris}`);
  });
});

describe("SystemClock", () => {
  it("now() returns a valid { epochMs, utc, paris }", () => {
    const t = new SystemClock().now();
    assert.ok(typeof t.epochMs === "number");
    assert.ok(t.utc.endsWith("Z"));
    assert.ok(t.paris.includes("T"));
    assert.ok(t.paris.includes("+0") || t.paris.includes("+1") || t.paris.includes("+2"));
  });
});
