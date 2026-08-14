import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const repoRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const guardPath = path.join(repoRoot, "scripts/quality/check_pr_governance.mjs");

describe("PR governance guard", () => {
  it("passes on the current repository governance files", () => {
    const result = spawnGuard(repoRoot);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /"ok": true/);
    assert.match(result.stdout, /@trading-desk\/architecture/);
  });

  it("rejects a PR template that omits architectural reporting", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "desk-pr-governance-"));
    try {
      await writeFixture(fixtureRoot);
      const result = spawnGuard(fixtureRoot);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /PR template missing section ## Placement architectural obligatoire/);
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });
});

function spawnGuard(root) {
  return spawnSync(process.execPath, [guardPath], {
    cwd: repoRoot,
    env: { ...process.env, DESK_PR_GOVERNANCE_ROOT: root },
    encoding: "utf8",
  });
}

async function writeFixture(root) {
  await mkdir(path.join(root, ".github"), { recursive: true });
  await mkdir(path.join(root, "scripts/quality"), { recursive: true });
  await writeFile(path.join(root, ".github/CODEOWNERS"), [
    "* @trading-desk/platform",
    "/AGENTS.md @trading-desk/architecture",
    "/docs/engineering/ @trading-desk/architecture",
    "/docs/trading-desk-target-blueprint/ @trading-desk/architecture",
    "/packages/desk-domain/ @trading-desk/execution",
    "/packages/desk-replay-engine/ @trading-desk/simulation",
    "/packages/desk-contracts/ @trading-desk/strategy @trading-desk/agents",
    "/packages/desk-audit/ @trading-desk/audit",
    "/packages/desk-time/ @trading-desk/platform",
    "/mcp_gpt_desk/ @trading-desk/architecture",
    "/src/ @trading-desk/reporting",
    "/scripts/ @trading-desk/operations",
    "/deploy/ @trading-desk/operations",
    "/infra/ @trading-desk/operations",
    "/integrations/ @trading-desk/execution",
    "/tradingview/ @trading-desk/market-data",
  ].join("\n"));
  await writeFile(path.join(root, ".github/pull_request_template.md"), "# PR\n\n## Jira\n");
  await writeFile(path.join(root, "package.json"), JSON.stringify({
    scripts: {
      "guard:pr-governance": "node scripts/quality/check_pr_governance.mjs",
      "guard:pr-governance:test": "node --test scripts/quality/check_pr_governance.test.mjs",
    },
  }));
  await writeFile(path.join(root, "scripts/quality/certify_resilience.mjs"), "guard:pr-governance:test\nguard:pr-governance\n");
}
