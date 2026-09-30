import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, writeFile, rename, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import pg from "pg";
import { PostgresOosRegistry } from "../../packages/desk-oos-batch/src/adapter/postgres-registry.js";

// Bounded repair for the first, test-owned premarket capture only; not a public tool.
// The original immutable files and registry history remain recoverable in quarantine.
const config = JSON.parse(await readFile(process.env.OOS_BATCH_CONFIG, "utf8"));
assert.equal(config.replay_enabled, false); assert.equal(config.batch_id, "OOS");
const expected = "c63804ccf650220c7bf749451b27192860ca8609002c33470ede84851e7997cc";
const day = { batch_id: "OOS", date: "2026-07-30" };
const source = path.join(config.archive_root, "OOS/2026-07/2026-07-30");
const target = path.join(config.archive_root, "quarantine/2026-07-30-" + expected.slice(0, 12));
const pool = new pg.Pool({ connectionString: process.env.OOS_DATABASE_URL, max: 4 });
const registry = new PostgresOosRegistry(pool);
try {
  await registry.withDayLock(day, async () => {
    const row = await registry.get(day); assert.equal(row.plan_sha256, null); assert.equal(row.manifest_sha256, expected);
    const manifest = JSON.parse(await readFile(path.join(source, "premarket/manifest.json"), "utf8"));
    assert.equal(manifest.manifest_sha256, expected);
    try { await access(path.join(source, "plan/PLAN_SMC3.txt")); throw new Error("PLAN_EXISTS_REPAIR_FORBIDDEN"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await mkdir(path.dirname(target), { recursive: true });
    await mkdir(target, { recursive: false });
    const snapshot = JSON.stringify({ row, events: await registry.timeline(day), reason: "CAPTURE_PARTIAL_BAR_UNPROVEN" }, null, 2);
    await writeFile(path.join(target, "registry.json"), snapshot, { flag: "wx", flush: true });
    await writeFile(path.join(target, "registry.sha256"), createHash("sha256").update(snapshot).digest("hex") + "\n", { flag: "wx", flush: true });
    await registry.save(row, { state: "FAILED_TECHNICAL", error: { code: "CAPTURE_PARTIAL_BAR_UNPROVEN" } }, new Date().toISOString());
    await rename(source, path.join(target, "artifacts"));
    await registry.retireUnfrozenCapture(day, expected);
    await registry.ensureDay(row.definition);
    console.log(JSON.stringify({ quarantined: true, date: day.date, original_manifest: expected, files_deleted: 0, reset: "NEW", replay_started: false }));
  });
} finally { await pool.end(); }
