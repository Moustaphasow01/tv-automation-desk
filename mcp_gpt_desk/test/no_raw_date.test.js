import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const storeSource = readFileSync(resolve(__dirname, "../src/store.js"), "utf8");

it("store.js must not contain raw new Date() calls (no-argument form)", () => {
  // Count occurrences of new Date() with no argument — the current-time generator
  // Allow: new Date(anything) — parsing form is fine
  const rawDateMatches = [...storeSource.matchAll(/new Date\(\)/g)];
  assert.strictEqual(
    rawDateMatches.length,
    0,
    `store.js contains ${rawDateMatches.length} raw new Date() call(s) — replace with ClockPort.now()`
  );
});

it("store.js must not contain raw Date.now() calls", () => {
  const rawDateNowMatches = [...storeSource.matchAll(/\bDate\.now\(\)/g)];
  assert.strictEqual(
    rawDateNowMatches.length,
    0,
    `store.js contains ${rawDateNowMatches.length} raw Date.now() call(s) — replace with ClockPort or explicit expiry handling`
  );
});
