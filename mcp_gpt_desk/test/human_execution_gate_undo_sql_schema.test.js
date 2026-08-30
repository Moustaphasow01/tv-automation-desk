import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../../infra/postgres/init/059_human_gate_undo_window.sql", import.meta.url);

test("Human Gate undo migration is additive, audited and indexed", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /ADD COLUMN IF NOT EXISTS undo_expires_at_utc timestamptz/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS undone_at_utc timestamptz/i);
  assert.match(migration, /'REVERTED'/i);
  assert.match(migration, /human_execution_gates_undo_window_idx/i);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE/i);
});
