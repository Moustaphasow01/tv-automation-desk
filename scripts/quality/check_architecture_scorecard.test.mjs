import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const repoRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const guardPath = path.join(repoRoot, "scripts/quality/check_architecture_scorecard.mjs");

describe("architecture scorecard guard", () => {
  it("passes on the current repository scorecard", () => {
    const result = spawnGuard(repoRoot);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /"done_tickets": 16/);
  });

  it("rejects a stale scorecard", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "desk-scorecard-"));
    try {
      await writeFixture(fixtureRoot);
      const result = spawnGuard(fixtureRoot);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /p_minus_1.done_tickets: expected 1, received 0/);
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });
});

function spawnGuard(root) {
  return spawnSync(process.execPath, [guardPath], {
    cwd: repoRoot,
    env: { ...process.env, DESK_SCORECARD_ROOT: root },
    encoding: "utf8",
  });
}

async function writeFixture(root) {
  await mkdir(path.join(root, "docs/engineering"), { recursive: true });
  await mkdir(path.join(root, "docs/trading-desk-target-blueprint"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { "guard:architecture": "x" } }));
  await writeFile(path.join(root, "docs/trading-desk-target-blueprint/implementation-backlog-v2.yaml"), "- { external_id: TD2-ARCH-001, status: Done }\n");
  await writeFile(path.join(root, "docs/engineering/exception-register.md"), "| ID | R |\n|---|---|\n");
  await writeFile(path.join(root, "docs/engineering/static-quality-baseline.json"), JSON.stringify({ aggregate_budgets: { duplicate_block_count: 0 } }));
  await writeFile(path.join(root, "docs/engineering/architecture-scorecard.json"), JSON.stringify({
    schema: "desk_architecture_scorecard_v1",
    p_minus_1: { total_tickets: 1, done_tickets: 0 },
    exceptions: { active: 0 },
    static_quality: { aggregate_budgets: { duplicate_block_count: 0 } },
    required_scripts: ["guard:architecture"],
  }));
}
