import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const repoRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const guardPath = path.join(repoRoot, "scripts/quality/check_runtime_safety.mjs");

describe("runtime safety guard", () => {
  it("passes on the current repository runtime safety policy", () => {
    const result = spawnGuard(repoRoot);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /"idempotency_guards": 7/);
    assert.match(result.stdout, /"lease_guards": 3/);
  });

  it("rejects missing idempotency uniqueness and lease fields", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "desk-runtime-safety-"));
    try {
      await writeFixture(fixtureRoot);
      const result = spawnGuard(fixtureRoot);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /orders: idempotency_key is not unique/);
      assert.match(result.stderr, /queue: missing lease guard field lease_expires_at/);
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });

  it("accepts multiline ALTER columns and partial unique indexes", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "desk-runtime-safety-ok-"));
    try {
      await writeAlterFixture(fixtureRoot);
      const result = spawnGuard(fixtureRoot);
      assert.equal(result.status, 0, result.stderr || result.stdout);
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });

  it("counts only implicit clocks and ignores deterministic timestamp conversions", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "desk-runtime-safety-clock-"));
    try {
      await writeClockFixture(fixtureRoot, {
        budget: 0,
        source: "export function normalize(value) { return new Date(value).toISOString(); }\n",
      });
      const conversionOnly = spawnGuard(fixtureRoot);
      assert.equal(conversionOnly.status, 0, conversionOnly.stderr || conversionOnly.stdout);

      await writeClockFixture(fixtureRoot, {
        budget: 0,
        source: "export function now() { return new Date().toISOString() + Date.now(); }\n",
      });
      const implicitClock = spawnGuard(fixtureRoot);
      assert.notEqual(implicitClock.status, 0);
      assert.match(implicitClock.stderr, /direct clock usages increased: 1 > 0/);
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });
});

function spawnGuard(root) {
  return spawnSync(process.execPath, [guardPath], {
    cwd: repoRoot,
    env: { ...process.env, DESK_RUNTIME_SAFETY_ROOT: root },
    encoding: "utf8",
  });
}

async function writeFixture(root) {
  await mkdir(path.join(root, "docs/engineering"), { recursive: true });
  await mkdir(path.join(root, "infra/postgres/init"), { recursive: true });
  await mkdir(path.join(root, "packages/desk-time"), { recursive: true });
  await writeFile(path.join(root, "packages/desk-time/index.js"), "export const ClockPort=1, SystemClock=1, FixedClock=1, toUtcIso=1, toParisIso=1, parisOffset=1;\n");
  await writeFile(path.join(root, "docs/engineering/runtime-safety-policy.json"), JSON.stringify({
    schema: "desk_runtime_safety_policy_v1",
    clock: {
      package: "packages/desk-time",
      required_exports: ["ClockPort", "SystemClock", "FixedClock", "toUtcIso", "toParisIso", "parisOffset"],
      direct_clock_usage_budget: 0,
    },
    sql: {
      migration_directory: "infra/postgres/init",
      idempotency_guards: [{ table: "orders", field: "idempotency_key" }],
      lease_guards: [{ table: "queue", lease_field: "lease_token", expires_field: "lease_expires_at", attempt_field: "attempt_count" }],
      optimistic_lock_guards: [],
    },
  }));
  await writeFile(path.join(root, "infra/postgres/init/001_schema.sql"), [
    "CREATE TABLE IF NOT EXISTS orders (",
    "  order_id text PRIMARY KEY,",
    "  idempotency_key text NOT NULL",
    ");",
    "CREATE TABLE IF NOT EXISTS queue (",
    "  queue_id text PRIMARY KEY,",
    "  lease_token text,",
    "  attempt_count integer NOT NULL DEFAULT 0",
    ");",
  ].join("\n"));
}

async function writeAlterFixture(root) {
  await mkdir(path.join(root, "docs/engineering"), { recursive: true });
  await mkdir(path.join(root, "infra/postgres/init"), { recursive: true });
  await mkdir(path.join(root, "packages/desk-time"), { recursive: true });
  await writeFile(path.join(root, "packages/desk-time/index.js"), "export const ClockPort=1, SystemClock=1, FixedClock=1, toUtcIso=1, toParisIso=1, parisOffset=1;\n");
  await writeFile(path.join(root, "docs/engineering/runtime-safety-policy.json"), JSON.stringify({
    schema: "desk_runtime_safety_policy_v1",
    clock: {
      package: "packages/desk-time",
      required_exports: ["ClockPort", "SystemClock", "FixedClock", "toUtcIso", "toParisIso", "parisOffset"],
      direct_clock_usage_budget: 0,
    },
    sql: {
      migration_directory: "infra/postgres/init",
      idempotency_guards: [{ table: "approvals", field: "idempotency_key" }],
      lease_guards: [],
      optimistic_lock_guards: [{ table: "profiles", fields: ["revision"] }],
    },
  }));
  await writeFile(path.join(root, "infra/postgres/init/001_schema.sql"), [
    "CREATE TABLE IF NOT EXISTS approvals (",
    "  approval_id text PRIMARY KEY",
    ");",
    "ALTER TABLE approvals ADD COLUMN IF NOT EXISTS idempotency_key text;",
    "CREATE UNIQUE INDEX IF NOT EXISTS approvals_idempotency_key_idx",
    "  ON approvals(idempotency_key)",
    "  WHERE idempotency_key IS NOT NULL;",
    "CREATE TABLE IF NOT EXISTS profiles (",
    "  profile_id text PRIMARY KEY,",
    "  display_name text NOT NULL",
    ");",
    "ALTER TABLE profiles",
    "  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT false,",
    "  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;",
  ].join("\n"));
}

async function writeClockFixture(root, { budget, source }) {
  await mkdir(path.join(root, "docs/engineering"), { recursive: true });
  await mkdir(path.join(root, "infra/postgres/init"), { recursive: true });
  await mkdir(path.join(root, "packages/desk-time"), { recursive: true });
  await mkdir(path.join(root, "mcp_gpt_desk/src"), { recursive: true });
  await writeFile(path.join(root, "packages/desk-time/index.js"), "export const ClockPort=1, SystemClock=1, FixedClock=1, toUtcIso=1, toParisIso=1, parisOffset=1;\n");
  await writeFile(path.join(root, "docs/engineering/runtime-safety-policy.json"), JSON.stringify({
    schema: "desk_runtime_safety_policy_v1",
    clock: {
      package: "packages/desk-time",
      required_exports: ["ClockPort", "SystemClock", "FixedClock", "toUtcIso", "toParisIso", "parisOffset"],
      direct_clock_usage_budget: budget,
    },
    sql: {
      migration_directory: "infra/postgres/init",
      idempotency_guards: [],
      lease_guards: [],
      optimistic_lock_guards: [],
    },
  }));
  await writeFile(path.join(root, "infra/postgres/init/001_schema.sql"), "-- no guarded tables\n");
  await writeFile(path.join(root, "mcp_gpt_desk/src/clock.js"), source);
}
