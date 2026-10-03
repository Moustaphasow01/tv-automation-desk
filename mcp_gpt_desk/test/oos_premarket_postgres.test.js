import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createPremarketOrchestration, batchDays, PostgresOosRegistry } from "../../packages/desk-oos-batch/index.js";
import { PostgresPremarketBatches } from "../../packages/desk-oos-batch/src/adapter/postgres-premarket-batches.js";
import { PostgresOosCommands } from "../../packages/desk-oos-batch/src/adapter/postgres-commands.js";

test("real PostgreSQL: atomic batches, restart, dedup, fairness, exclusive capture, recovery and immutable advanced days", { skip: !process.env.OOS_TEST_DATABASE_URL }, async () => {
  const schema = `oos_preparation_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString: process.env.OOS_TEST_DATABASE_URL });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: process.env.OOS_TEST_DATABASE_URL, options: `-c search_path=${schema}`, max: 12 });
  try {
    for (const name of ["070_oos_batch_mcp_v1.sql", "071_oos_batch_remote_mcp.sql", "072_oos_premarket_orchestration.sql", "074_oos_premarket_capture_repairs.sql"]) {
      const sql = await readFile(new URL(`../../infra/postgres/init/${name}`, import.meta.url), "utf8");
      await pool.query(sql); await pool.query(sql);
    }
    const repository = new PostgresOosRegistry(pool), commands = new PostgresOosCommands(repository), batches = new PostgresPremarketBatches(repository);
    const scope = { batch_id: "SYNTHETIC", symbol: "CME_MINI:MES1!", cutoff_time: "09:00" };
    const api = createPremarketOrchestration({ batches, batchId: scope.batch_id, symbol: scope.symbol, cutoffTime: "09:00", requestedConcurrency: 3 });
    const singles = await Promise.all(Array.from({ length: 8 }, () => api.prepare("2026-07-29")));
    assert.ok(singles.every(r => r.state === "CAPTURING"));
    assert.equal((await pool.query("SELECT count(*) FROM oos_batch_commands")).rows[0].count, "1");
    const range = await api.prepareRange("2026-07-24", "2026-07-30");
    assert.equal(range.total_days, 5); assert.deepEqual(range.skipped_dates, ["2026-07-25", "2026-07-26"]);
    assert.equal(range.concurrency, 1); assert.equal(range.batches[0].requested_concurrency, 3);
    assert.equal((await api.prepareRange("2026-07-24", "2026-07-30")).batch_id, range.batch_id);
    assert.equal((await pool.query("SELECT count(*) FROM oos_batch_days")).rows[0].count, "5");
    const day30 = batchDays({ ...scope, date: "2026-07-30" })[0];
    const original = await repository.save(await repository.get(day30), { state: "COMPLETED", checkpoint: "COMPLETED", capture_count: 8,
      manifest_sha256: "a".repeat(64), plan_sha256: "b".repeat(64), audit: { future_secret: "MUST_NOT_LEAK" } }, new Date().toISOString());
    const calls = new Map(); let active = 0, maxActive = 0, failedOnce = false;
    const workflow = { execute: async (day, action) => repository.withChartLock(async () => {
      active++; maxActive = Math.max(maxActive, active);
      try {
        calls.set(day.date, (calls.get(day.date) || 0) + 1);
        const row = await repository.get(day);
        assert.ok(["capture", "retry-capture"].includes(action));
        if (day.date === "2026-07-28" && !failedOnce) {
          failedOnce = true;
          return repository.save(row, { state: "FAILED_TECHNICAL", error: { code: "SYNTHETIC_CAPTURE_TIMEOUT" } }, new Date().toISOString());
        }
        return repository.save(row, { state: "PREMARKET_READY", checkpoint: "PREMARKET_READY", capture_count: 8,
          manifest_sha256: "c".repeat(64), error: null }, new Date().toISOString());
      } finally { active--; }
    }) };
    const query = pool.query.bind(pool); let interrupt = true;
    pool.query = (text, args) => {
      if (interrupt && text.includes("UPDATE oos_batch_commands SET next_day=")) {
        interrupt = false; throw Object.assign(new Error("TEST_CRASH_AFTER_DURABLE_CAPTURE"), { code: "TEST_CRASH" });
      }
      return query(text, args);
    };
    await assert.rejects(commands.processOne(workflow), { code: "TEST_CRASH" });
    pool.query = query;
    const restarted = new PostgresOosCommands(repository);
    const concurrent = await Promise.allSettled([restarted.processOne(workflow), restarted.processOne(workflow)]);
    assert.equal(concurrent.filter(r => r.status === "fulfilled").length, 1);
    assert.ok(concurrent.some(r => r.status === "rejected" && r.reason.code === "OOS_BUSY"));
    for (let i = 0; i < 12; i++) { if (!await restarted.processOne(workflow)) break; await batches.refresh(); }
    await batches.refresh();
    assert.equal(maxActive, 1); assert.equal(calls.get("2026-07-29"), 1); assert.equal(calls.has("2026-07-30"), false);
    assert.deepEqual(await repository.get(day30), original);
    const partial = await api.status({ batch_id: range.batch_id });
    assert.equal(partial.status, "PARTIAL"); assert.equal(partial.ready, 4); assert.equal(partial.failed, 1);
    assert.equal(JSON.stringify(partial).includes("MUST_NOT_LEAK"), false);
    const retry = await api.prepareRange("2026-07-24", "2026-07-30");
    assert.equal(retry.batch_id, range.batch_id); assert.equal(retry.status, "RUNNING");
    const yielded = await restarted.processOne(workflow);
    assert.equal(yielded.completed_days, 1); assert.equal(yielded.status, "RUNNING");
    for (let i = 0; i < 12; i++) { if (!await restarted.processOne(workflow)) break; await batches.refresh(); }
    await batches.refresh();
    const done = await api.status({ batch_id: range.batch_id });
    assert.equal(done.status, "COMPLETED"); assert.equal(done.ready, 5); assert.equal(done.failed, 0);
    assert.equal(calls.get("2026-07-28"), 2); assert.equal(calls.get("2026-07-29"), 1);
    assert.deepEqual(await repository.get(day30), original);
    const ready = await api.prepare("2026-07-29"); assert.equal(ready.manifest_sha256, "c".repeat(64));
    assert.equal((await pool.query("SELECT count(*) FROM oos_batch_days WHERE plan_sha256 IS NOT NULL")).rows[0].count, "1");
    const empty = await api.prepareRange("2026-07-25", "2026-07-26"); assert.equal(empty.total_days, 0); assert.equal(empty.status, "COMPLETED");
    // Synthetic isolated schema only: narrow repair CAS must not touch a plan/result column.
    const repairDay = batchDays({ ...scope, date: "2026-08-20" })[0];
    const seeded = await repository.save(await repository.ensureDay(repairDay), { state: "PREMARKET_READY", checkpoint: "PREMARKET_READY",
      capture_count: 8, manifest_sha256: "d".repeat(64) }, "2026-10-03T08:00:00Z");
    const previous = await repository.getPreparation(repairDay);
    const receipt = { capture: "4h_zoom.png", journal_sha256: "a".repeat(64) };
    await assert.rejects(pool.query("UPDATE oos_batch_days SET manifest_sha256=$1 WHERE batch_id=$2 AND day=$3",
      ["e".repeat(64), repairDay.batch_id, repairDay.date]), /OOS_IMMUTABLE_IDENTITY/);
    const repaired = await repository.commitCaptureRepair({ day: repairDay, previous, receipt, manifest_sha256: "e".repeat(64) }, "2026-10-03T09:00:00Z");
    assert.equal(repaired.state, "PREMARKET_READY"); assert.equal(repaired.revision, seeded.revision + 1);
    assert.equal(repaired.manifest_sha256, "e".repeat(64)); assert.equal(repaired.plan_sha256, null);
    assert.equal("audit" in repaired, false); assert.equal("run_meta" in repaired, false);
    assert.equal((await pool.query("SELECT count(*) FROM oos_premarket_capture_repairs")).rows[0].count, "1");
    await assert.rejects(pool.query("UPDATE oos_premarket_capture_repairs SET journal_sha256=$1", ["b".repeat(64)]), /OOS_CAPTURE_REPAIR_RECEIPT_IMMUTABLE/);
    await assert.rejects(repository.commitCaptureRepair({ day: repairDay, previous, receipt, manifest_sha256: "f".repeat(64) }, "2026-10-03T10:00:00Z"), /CAPTURE_REPAIR_VERSION_CONFLICT/);
    const frozen = await repository.save(await repository.get(repairDay), { state: "FROZEN", checkpoint: "FROZEN", plan_sha256: "1".repeat(64) }, "2026-10-03T10:00:00Z");
    await assert.rejects(repository.commitCaptureRepair({ day: repairDay, previous: frozen, receipt, manifest_sha256: "f".repeat(64) }, "2026-10-03T11:00:00Z"), /CAPTURE_REPAIR_VERSION_CONFLICT/);
    await assert.rejects(pool.query("UPDATE oos_batch_days SET manifest_sha256=$1 WHERE batch_id=$2 AND day=$3",
      ["f".repeat(64), repairDay.batch_id, repairDay.date]), /OOS_IMMUTABLE_IDENTITY/);
    assert.deepEqual(await repository.get(repairDay), frozen);
  } finally {
    await pool.end();
    assert.match(schema, /^oos_preparation_test_[a-f0-9]{32}$/);
    await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});
