import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const repoRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const guardPath = path.join(repoRoot, "scripts/quality/check_sql_migrations.mjs");

describe("SQL migration guard", () => {
  it("passes on the current repository migrations", () => {
    const result = spawnGuard(repoRoot);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true);
    assert.ok(report.migration_files >= 45);
    assert.ok(report.owners.execution >= 29);
  });

  it("rejects unowned tables and destructive statements", async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "desk-sql-migrations-"));
    try {
      await writeFixture(fixtureRoot);
      const result = spawnGuard(fixtureRoot);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /table random_table has no owner rule/);
      assert.match(result.stderr, /destructive statement is not allowlisted/);
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });
});

function spawnGuard(root) {
  return spawnSync(process.execPath, [guardPath], {
    cwd: repoRoot,
    env: { ...process.env, DESK_SQL_MIGRATION_ROOT: root },
    encoding: "utf8",
  });
}

async function writeFixture(root) {
  await mkdir(path.join(root, "docs/engineering"), { recursive: true });
  await mkdir(path.join(root, "infra/postgres/init"), { recursive: true });
  await writeFile(path.join(root, "docs/engineering/sql-migration-policy.json"), JSON.stringify({
    schema: "desk_sql_migration_policy_v1",
    migration_directory: "infra/postgres/init",
    filename_pattern: "^\\d{3}_[a-z0-9_]+\\.sql$",
    owner_rules: [{ owner: "market-data", patterns: ["^market_"] }],
    allowed_destructive_statements: [],
    destructive_operations: ["DROP TABLE", "DROP COLUMN", "TRUNCATE", "DELETE FROM"],
  }));
  await writeFile(path.join(root, "infra/postgres/init/001_schema.sql"), [
    "CREATE TABLE IF NOT EXISTS random_table (",
    "  id text PRIMARY KEY",
    ");",
    "DELETE FROM market_legacy;",
  ].join("\n"));
}
