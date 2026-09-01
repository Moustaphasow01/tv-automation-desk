import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../../infra/postgres/init/061_theoretical_execution_progress_cursor.sql", import.meta.url);
const repositoryUrl = new URL("../src/broker-theoretical-execution-repository.js", import.meta.url);
const workerUrl = new URL("../scripts/run_broker_management_worker.mjs", import.meta.url);

test("theoretical exit tracking persists monotone progress and uses a fair queue", async () => {
  const [migration, repository, worker] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(repositoryUrl, "utf8"),
    readFile(workerUrl, "utf8"),
  ]);

  assert.match(migration, /ADD COLUMN IF NOT EXISTS theoretical_cursor_at_utc timestamptz/);
  assert.match(migration, /trades_theoretical_exit_progress_idx/);
  assert.match(repository, /SET theoretical_cursor_at_utc = GREATEST/);
  assert.match(repository, /ORDER BY COALESCE\(t\.theoretical_cursor_at_utc, t\.opened_at\) ASC NULLS FIRST,[\s\S]*t\.opened_at ASC NULLS FIRST/);
  assert.match(repository, /AS due_open_trades/);
  assert.match(repository, /pending_candle\.timestamp_utc > COALESCE\(t\.theoretical_cursor_at_utc, t\.opened_at\)/);
  assert.doesNotMatch(repository, /ORDER BY t\.updated_at ASC\s+LIMIT \$1/);
  assert.match(worker, /DESK_THEORETICAL_EXIT_LIMIT/);
  assert.match(worker, /boundedLimit\(process\.env\.DESK_THEORETICAL_EXIT_LIMIT, 500\)/);
});
