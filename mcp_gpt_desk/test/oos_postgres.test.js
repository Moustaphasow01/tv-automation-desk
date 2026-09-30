import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresOosRegistry } from "../../packages/desk-oos-batch/src/adapter/postgres-registry.js";
import { PostgresOosCommands } from "../../packages/desk-oos-batch/src/adapter/postgres-commands.js";
import { PostgresOosProbe } from "../../packages/desk-oos-batch/src/adapter/postgres-probe.js";
import { DAY } from "../../packages/desk-oos-batch/test/support.js";

test("PostgreSQL migration, CAS, immutable identity, locks, durable queue and idempotence", { skip: !process.env.OOS_TEST_DATABASE_URL }, async () => {
  const schema = `oos_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString: process.env.OOS_TEST_DATABASE_URL });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: process.env.OOS_TEST_DATABASE_URL, options: `-c search_path=${schema}`, max: 8 });
  try {
    const migration = await readFile(new URL("../../infra/postgres/init/070_oos_batch_mcp_v1.sql", import.meta.url), "utf8");
    await pool.query(migration); await pool.query(migration);
    const remoteMigration = await readFile(new URL("../../infra/postgres/init/071_oos_batch_remote_mcp.sql", import.meta.url), "utf8");
    await pool.query(remoteMigration); await pool.query(remoteMigration);
    const probe = new PostgresOosProbe(pool);
    const probeWrite = await probe.write("SYNTHETIC_ISOLATED_PROBE");
    assert.deepEqual(await probe.write("SYNTHETIC_ISOLATED_PROBE"), probeWrite);
    assert.deepEqual(await probe.read(), probeWrite);
    assert.equal((await pool.query("SELECT count(*) FROM oos_batch_write_probe")).rows[0].count, "1");
    const repository = new PostgresOosRegistry(pool), commands = new PostgresOosCommands(repository);
    const row = await repository.ensureDay(DAY);
    const saved = await repository.save(row, { state: "CAPTURING", checkpoint: "CAPTURING" }, new Date().toISOString());
    assert.equal(saved.revision, 1);
    await assert.rejects(() => repository.save(row, {}, new Date().toISOString()), { code: "OOS_VERSION_CONFLICT" });
    await assert.rejects(() => pool.query("UPDATE oos_batch_days SET definition='{}'::jsonb"), /OOS_IMMUTABLE_IDENTITY/);
    await repository.withChartLock(async () => { await assert.rejects(() => repository.withChartLock(async () => {}), { code: "OOS_BUSY" }); });
    const input = { batch_id: DAY.batch_id, date: DAY.date, symbol: DAY.symbol, cutoff_time: "09:00", action: "capture" };
    const first = await commands.enqueue(input, "synthetic-1");
    assert.deepEqual(await commands.enqueue(input, "synthetic-1"), first);
    await assert.rejects(() => commands.enqueue({ ...input, cutoff_time: "08:00" }, "synthetic-1"), { code: "COMMAND_ID_CONFLICT" });
    let executions = 0;
    const workflow = { execute: async () => { executions++; return { state: "PREMARKET_READY", error: null }; } };
    const done = await commands.processOne(workflow);
    assert.equal(done.status, "COMPLETED"); assert.equal(done.completed_days, 1);
    assert.equal(await commands.processOne(workflow), null); assert.equal(executions, 1);
    assert.equal((await commands.get("synthetic-1")).status, "COMPLETED");
  } finally {
    await pool.end();
    // Only the generated, test-owned schema is removed; never a supplied database or public schema.
    assert.match(schema, /^oos_test_[a-f0-9]{32}$/);
    await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});
