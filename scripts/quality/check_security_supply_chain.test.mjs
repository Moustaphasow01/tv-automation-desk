import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const guardPath = path.join(repoRoot, "scripts/quality/check_security_supply_chain.mjs");

describe("security supply-chain guard", () => {
  it("passes on the current repository supply chain", () => {
    const result = spawnGuard(repoRoot);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /"ok": true/);
    assert.match(result.stdout, /supply-chain-sbom\.json/);
  });

  it("rejects committed secrets and Docker latest images", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "desk-security-"));
    try {
      await writeFixture(fixtureRoot);
      const result = spawnGuard(fixtureRoot);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /possible OpenAI API key/);
      assert.match(result.stderr, /Docker image must not use latest/);
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });

  for (const filename of ["package-lock.json", "mcp_gpt_desk/package-lock.json",
    "apps/desk-control-plane/package-lock.json"]) {
    it(`rejects missing registry integrity in ${filename}`, async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "desk-lock-integrity-"));
      try {
        await writeFixture(root);
        const broken = lockfile("MIT");
        delete broken.packages["node_modules/a"].integrity;
        await writeFile(path.join(root, filename), JSON.stringify(broken));
        const result = spawnGuard(root);
        assert.notEqual(result.status, 0);
        assert.ok(result.stderr.includes(`${filename}: registry dependency without integrity: a`));
      } finally { await rm(root, { recursive: true, force: true }); }
    });
  }

  it("allows local workspace links without pretending they are registry packages", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "desk-workspace-lock-"));
    try {
      await writeFixture(root);
      await writeFile(path.join(root, "leaked.env"), "EXAMPLE=fixture\n");
      await writeFile(path.join(root, "infra/docker/api.Dockerfile"), "FROM node:22-bookworm-slim\n");
      const linked = lockfile("MIT");
      linked.packages["node_modules/@desk/local"] = { link: true, resolved: "../packages/local" };
      await writeFile(path.join(root, "package-lock.json"), JSON.stringify(linked));
      const result = spawnGuard(root);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /"ok": true/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

function spawnGuard(root) {
  return spawnSync(process.execPath, [guardPath], {
    cwd: root,
    env: { ...process.env, DESK_SECURITY_SUPPLY_CHAIN_ROOT: root },
    encoding: "utf8",
  });
}

async function writeFixture(root) {
  await mkdir(path.join(root, "infra/docker"), { recursive: true });
  await mkdir(path.join(root, "mcp_gpt_desk"), { recursive: true });
  await mkdir(path.join(root, "apps/desk-control-plane"), { recursive: true });
  await writeFile(path.join(root, "package-lock.json"), JSON.stringify(lockfile("MIT")));
  await writeFile(path.join(root, "mcp_gpt_desk/package-lock.json"), JSON.stringify(lockfile("MIT")));
  await writeFile(path.join(root, "apps/desk-control-plane/package-lock.json"), JSON.stringify(lockfile("MIT")));
  await writeFile(path.join(root, "infra/docker/api.Dockerfile"), "FROM node:latest\n");
  await writeFile(path.join(root, "leaked.env"), `OPENAI_API_KEY=${openAiKeyFixture()}\n`);
  spawnSync("git", ["init"], { cwd: root, stdio: "ignore" });
  spawnSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
}

function openAiKeyFixture() {
  return ["sk", "-1234567890abcdefghijklmnopqrstuvwxyz"].join("");
}

function lockfile(license) {
  return {
    lockfileVersion: 3,
    packages: {
      "": { name: "fixture" },
      "node_modules/a": {
        version: "1.0.0",
        license,
        integrity: "sha512-test",
      },
    },
  };
}
