import assert from "node:assert/strict";
import test from "node:test";
import { checkApiCompatibility } from "./check_api_compatibility.mjs";

test("API compatibility guard validates Front v2 catalog, SSE resume, scopes and MCP surfaces", () => {
  const result = checkApiCompatibility();
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
  assert.equal(result.critical_operations, 11);
  assert.ok(result.catalog_operations > 90);
  assert.match(result.compatibility_fingerprint, /^[a-f0-9]{64}$/);
});
