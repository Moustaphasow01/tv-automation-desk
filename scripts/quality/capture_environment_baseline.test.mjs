#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const repoRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const scriptPath = path.join(repoRoot, "scripts/quality/capture_environment_baseline.mjs");

describe("environment baseline capture", () => {
  it("captures a local baseline without requiring VPS credentials", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "desk-baseline-"));
    const output = path.join(root, "baseline.json");
    try {
      const result = spawnSync("node", [scriptPath, "--output", output], {
        cwd: repoRoot,
        env: {
          ...process.env,
          DESK_BASELINE_VPS_TARGET: "",
          DESK_BASELINE_VPS_KEY: "",
        },
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const report = JSON.parse(await readFile(output, "utf8"));
      assert.equal(report.schema, "desk_environment_baseline_v1");
      assert.equal(report.safety.read_only, true);
      assert.equal(report.vps.status, "not_requested");
      assert.equal(report.local.package_scripts["certify:resilience"], true);
      assert.equal(report.local.package_scripts["guard:front-architecture"], true);
      assert.equal(report.local.package_scripts["baseline:environment"], true);
      assert.ok(report.local.postgres.static_schema.table_count >= 50);
      assert.ok(report.local.postgres.static_schema.tables.includes("desk_documents"));
      assert.equal(report.local.postgres.runtime.status, "not_configured");
      assert.doesNotMatch(JSON.stringify(report), /example-real-secret-fragment|authorization=/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
