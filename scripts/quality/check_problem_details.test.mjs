import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";

const repoRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const guardPath = path.join(repoRoot, "scripts/quality/check_problem_details.mjs");

describe("Problem Details guard", () => {
  it("passes on the current registry", () => {
    const result = spawnSync(process.execPath, [guardPath], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /"schema_version": "desk_problem_details_v1"/);
    assert.match(result.stdout, /DESK_DEPENDENCY_UNAVAILABLE/);
  });
});
