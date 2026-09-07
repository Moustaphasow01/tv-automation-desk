import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import { isUsGrainsMarketContextRunnerEntrypoint } from "../scripts/run_us_grains_market_context_task_runner.mjs";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const testFile = fileURLToPath(import.meta.url);

test("runner entrypoint resolves a symlink or Windows junction to the loaded module", () => {
  withAliasedPackage((aliasRoot) => {
    const aliasScript = join(aliasRoot, "scripts", "run_us_grains_market_context_task_runner.mjs");
    const moduleUrl = new URL("../scripts/run_us_grains_market_context_task_runner.mjs", import.meta.url).href;
    assert.equal(isUsGrainsMarketContextRunnerEntrypoint(aliasScript, moduleUrl), true);
    assert.equal(isUsGrainsMarketContextRunnerEntrypoint(testFile, moduleUrl), false);
  });
});

test("runner CLI invoked through an alias returns a structured legacy-contract rejection before LLM or database use", () => {
  withAliasedPackage((aliasRoot) => {
    const aliasScript = join(aliasRoot, "scripts", "run_us_grains_market_context_task_runner.mjs");
    const result = spawnSync(process.execPath, [aliasScript], {
      cwd: packageRoot,
      encoding: "utf8",
      input: `${JSON.stringify(legacyTaskInput())}\n`,
      env: { ...process.env, DATABASE_URL: "postgresql://must-not-be-used.invalid/desk" },
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout.trim());
    assert.deepEqual(output, {
      ok: false,
      status: "FAILED",
      error_code: "US_GRAINS_CONTEXT_TIME_CONTRACT_VERSION_UNSUPPORTED",
      error_message: "US_GRAINS_CONTEXT_TIME_CONTRACT_VERSION_UNSUPPORTED",
      retryable: false,
    });
  });
});

test("importing the runner through an alias is inert", () => {
  withAliasedPackage((aliasRoot) => {
    const aliasScript = join(aliasRoot, "scripts", "run_us_grains_market_context_task_runner.mjs");
    const source = `await import(${JSON.stringify(pathToFileURL(aliasScript).href)}); process.stdout.write("IMPORTED\\n"); process.exit(0);`;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
      cwd: dirname(testFile),
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "IMPORTED\n");
  });
});

function withAliasedPackage(run) {
  const temporaryRoot = mkdtempSync(join(dirname(packageRoot), ".runner-alias-test-"));
  const aliasRoot = join(temporaryRoot, "current");
  try {
    symlinkSync(packageRoot, aliasRoot, process.platform === "win32" ? "junction" : "dir");
    run(aliasRoot);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function legacyTaskInput() {
  return {
    task: {
      task_type: "LIVE_US_GRAINS_MARKET_CONTEXT_REFRESH",
      payload: {
        bundle: {
          schemaVersion: "us_grains_market_context_bundle_v1",
          universe: "US_GRAINS_CBOT",
          cutoff: "2026-09-07T15:30:00.000Z",
          canonicalMarketSession: { marketState: "HOLIDAY" },
          sourceStates: [],
        },
      },
    },
  };
}
