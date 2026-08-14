import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const repoRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const guardPath = path.join(repoRoot, "scripts/quality/check_browser_secret_exposure.mjs");

describe("browser secret exposure guard", () => {
  it("passes on VNext browser source and generated bundle when present", () => {
    const result = spawnGuard(repoRoot);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /"ok": true/);
  });

  it("rejects browser-addressable secret env keys and token literals", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "desk-browser-secrets-"));
    try {
      await writeFixture(fixtureRoot, {
        "apps/desk-control-plane/src/config.ts": "export const key = import.meta.env.VITE_DESK_API_KEY;\n",
        "apps/desk-control-plane/dist/assets/app.js": `const bot='${telegramTokenFixture()}';\n`,
      });
      const result = spawnGuard(fixtureRoot);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /VITE_DESK_API_KEY/);
      assert.match(result.stderr, /possible Telegram bot token/);
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });

  it("allows only public VNext configuration keys", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "desk-browser-safe-"));
    try {
      await writeFixture(fixtureRoot, {
        "apps/desk-control-plane/src/config.ts": [
          "export const mode = import.meta.env.VITE_DATA_MODE;",
          "export const base = import.meta.env.VITE_FRONT_API_BASE_URL;",
          "export const timeout = import.meta.env.VITE_FRONT_API_TIMEOUT_MS;",
        ].join("\n"),
      });
      const result = spawnGuard(fixtureRoot);
      assert.equal(result.status, 0, result.stderr || result.stdout);
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });
});

function spawnGuard(root) {
  return spawnSync(process.execPath, [guardPath], {
    cwd: root,
    env: { ...process.env, DESK_BROWSER_SECRET_ROOT: root },
    encoding: "utf8",
  });
}

function telegramTokenFixture() {
  return ["123456789", ":", "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi"].join("");
}

async function writeFixture(root, files) {
  for (const [file, content] of Object.entries(files)) {
    const absFile = path.join(root, file);
    await mkdir(path.dirname(absFile), { recursive: true });
    await writeFile(absFile, content, "utf8");
  }
}
