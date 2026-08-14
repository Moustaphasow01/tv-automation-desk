import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const repoRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const guardPath = path.join(repoRoot, "scripts/quality/check_static_quality_guard.mjs");

describe("static quality guard", () => {
  it("passes on the current repository baseline", () => {
    const result = spawnGuard(repoRoot, path.join(repoRoot, "docs/engineering/static-quality-baseline.json"));
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /"ok": true/);
  });

  it("rejects a new non-exempt oversized file", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "desk-static-quality-"));
    try {
      await writeFixture(fixtureRoot, { oversized: true });
      const result = spawnGuard(fixtureRoot, path.join(fixtureRoot, "docs/engineering/static-quality-baseline.json"));
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /src\/oversized\.js has 610 lines; allowed 600/);
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });
});

function spawnGuard(root, baseline) {
  return spawnSync(process.execPath, [guardPath], {
    cwd: repoRoot,
    env: { ...process.env, DESK_STATIC_QUALITY_ROOT: root, DESK_STATIC_QUALITY_BASELINE: baseline },
    encoding: "utf8",
  });
}

async function writeFixture(root, { oversized }) {
  await mkdir(path.join(root, "docs/engineering"), { recursive: true });
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "mcp_gpt_desk/src"), { recursive: true });
  await mkdir(path.join(root, "packages/desk-domain/src"), { recursive: true });
  await writeFile(path.join(root, "docs/engineering/static-quality-baseline.json"), JSON.stringify({
    schema: "desk_static_quality_baseline_v1",
    standards: { max_file_lines: 600, max_function_lines: 60, max_cyclomatic_complexity: 15, duplicate_window_lines: 12 },
    aggregate_budgets: { oversized_function_count: 0, high_complexity_function_count: 0, duplicate_block_count: 0, possibly_dead_file_count: 2 },
    file_line_budgets: {},
  }));
  await writeFile(path.join(root, "src/main.tsx"), "import './small.js';\n");
  await writeFile(path.join(root, "src/small.js"), "export const ok = true;\n");
  await writeFile(path.join(root, "mcp_gpt_desk/src/server.js"), "export const server = true;\n");
  await writeFile(path.join(root, "packages/desk-domain/package.json"), JSON.stringify({
    name: "@tv-automation/desk-domain",
    type: "module",
    exports: { ".": "./index.js" },
  }));
  await writeFile(path.join(root, "packages/desk-domain/index.js"), "export { value } from './src/value.js';\n");
  await writeFile(path.join(root, "packages/desk-domain/src/value.js"), "export const value = true;\n");
  if (oversized) await writeFile(path.join(root, "src/oversized.js"), `${Array.from({ length: 610 }, (_, index) => `export const v${index} = ${index};`).join("\n")}\n`);
}
