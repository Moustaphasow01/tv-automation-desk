import assert from "node:assert/strict";
import test from "node:test";

import { readySelectorForRoute } from "./audit-readiness.mjs";

test("waits for the final Strategy Center projection instead of its transient shell", () => {
  assert.equal(readySelectorForRoute("strategies"), '[data-testid="strategy-center-golden-master"]');
});

test("preserves dedicated readiness selectors and leaves unknown routes generic", () => {
  assert.equal(readySelectorForRoute("command-center"), ".cc-page");
  assert.equal(readySelectorForRoute("live"), ".lt-page");
  assert.equal(readySelectorForRoute("settings"), null);
});
