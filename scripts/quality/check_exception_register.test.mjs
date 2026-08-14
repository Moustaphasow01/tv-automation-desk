import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const repoRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const guardPath = path.join(repoRoot, "scripts/quality/check_exception_register.mjs");

describe("exception register guard", () => {
  it("passes on the current repository register", () => {
    const result = spawnGuard(repoRoot, "2026-08-08");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /"active_exceptions": 3/);
  });

  it("rejects expired or ownerless exceptions", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "desk-exception-guard-"));
    try {
      await writeFixture(fixtureRoot);
      const result = spawnGuard(fixtureRoot, "2026-08-08");
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /EXC-TD-001: owner is required/);
      assert.match(result.stderr, /EXC-TD-001: expired on 2026-01-01/);
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });
});

function spawnGuard(root, today) {
  return spawnSync(process.execPath, [guardPath], {
    cwd: repoRoot,
    env: { ...process.env, DESK_EXCEPTION_GUARD_ROOT: root, DESK_EXCEPTION_GUARD_TODAY: today },
    encoding: "utf8",
  });
}

async function writeFixture(root) {
  await mkdir(path.join(root, "docs/engineering"), { recursive: true });
  await mkdir(path.join(root, "docs/trading-desk-target-blueprint"), { recursive: true });
  await writeFile(path.join(root, "docs/engineering/static-quality-baseline.json"), JSON.stringify({
    schema: "desk_static_quality_baseline_v1",
    aggregate_budgets: {},
  }));
  await writeFile(path.join(root, "docs/trading-desk-target-blueprint/implementation-backlog-v2.yaml"), "gate: zero_active_exceptions\n- TD2-1105\n");
  await writeFile(path.join(root, "docs/engineering/exception-register.md"), [
    "| ID | Règle | Périmètre | Justification | Risque | Mesure compensatoire | Propriétaire | Expiration | ADR/Ticket |",
    "|---|---|---|---|---|---|---|---|---|",
    "| EXC-TD-001 | Rule | Scope | Why | Risk | guard |  | 2026-01-01 | TD2-ARCH-999 |",
    "",
  ].join("\n"));
}
