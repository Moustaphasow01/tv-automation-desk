import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const repoRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const guardPath = path.join(repoRoot, "scripts/quality/check_architecture_boundaries.mjs");

describe("architecture boundary guard", () => {
  it("passes on the current repository", () => {
    const result = spawnGuard(repoRoot);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /"ok": true/);
  });

  it("rejects direct package access to the legacy MCP host", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "desk-arch-guard-"));
    try {
      await writeFixture(fixtureRoot);
      const result = spawnGuard(fixtureRoot);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /packages cannot reach legacy-mcp-host/);
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });

  it("rejects cycles between package owners", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "desk-arch-cycle-"));
    try {
      await writeCycleFixture(fixtureRoot);
      const result = spawnGuard(fixtureRoot);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /module cycle: @tv-automation\/desk-(domain|audit) -> @tv-automation\/desk-(audit|domain) -> @tv-automation\/desk-(domain|audit)/);
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });
});

function spawnGuard(root) {
  return spawnSync(process.execPath, [guardPath], {
    cwd: repoRoot,
    env: { ...process.env, DESK_ARCHITECTURE_ROOT: root },
    encoding: "utf8",
  });
}

async function writeFixture(root) {
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "mcp_gpt_desk/src"), { recursive: true });
  await mkdir(path.join(root, "packages/desk-domain/src"), { recursive: true });
  await writeFile(path.join(root, "src/App.tsx"), "export const App = null;\n");
  await writeFile(path.join(root, "mcp_gpt_desk/src/server.js"), "export const server = true;\n");
  await writeFile(path.join(root, "packages/desk-domain/package.json"), JSON.stringify({
    name: "@tv-automation/desk-domain",
    type: "module",
    exports: { ".": "./index.js" },
  }));
  await writeFile(path.join(root, "packages/desk-domain/index.js"), "export { bad } from './src/bad.js';\n");
  await writeFile(
    path.join(root, "packages/desk-domain/src/bad.js"),
    "import { server } from '../../../mcp_gpt_desk/src/server.js';\nexport const bad = server;\n",
  );
}

async function writeCycleFixture(root) {
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "mcp_gpt_desk/src"), { recursive: true });
  await writeFile(path.join(root, "src/App.tsx"), "export const App = null;\n");
  await writeFile(path.join(root, "mcp_gpt_desk/src/server.js"), "export const server = true;\n");
  await writePackage(root, "desk-domain", "import { audit } from '@tv-automation/desk-audit';\nexport const domain = audit;\n");
  await writePackage(root, "desk-audit", "import { domain } from '@tv-automation/desk-domain';\nexport const audit = domain;\n");
}

async function writePackage(root, directory, source) {
  const packageRoot = path.join(root, "packages", directory);
  await mkdir(path.join(packageRoot, "src"), { recursive: true });
  await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({
    name: `@tv-automation/${directory}`,
    type: "module",
    exports: { ".": "./index.js" },
  }));
  await writeFile(path.join(packageRoot, "index.js"), "export { value } from './src/value.js';\n");
  await writeFile(path.join(packageRoot, "src/value.js"), source.replace("export const domain", "export const value").replace("export const audit", "export const value"));
}
