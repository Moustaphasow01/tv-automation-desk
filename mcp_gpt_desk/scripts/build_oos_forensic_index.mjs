import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import pg from "pg";
import { buildOosForensicIndex, PostgresOosRegistry } from "@tv-automation/desk-oos-batch";
import { forensicBusinessBaseline } from "./oos_forensic_baseline.mjs";

// Offline operator job only. No assembly of TradingView, workers, builder or trading runtime.
const config = JSON.parse(await readFile(process.env.OOS_BATCH_CONFIG, "utf8"));
const pool = new pg.Pool({ connectionString: process.env.OOS_DATABASE_URL, connectionTimeoutMillis: 10000 });
const indexRoot = path.join(config.archive_root, "forensic-index-v2");
try {
  const queue = await pool.query("SELECT count(*)::int AS pending FROM oos_batch_commands WHERE status IN ('QUEUED','RUNNING')");
  assert.equal(queue.rows[0].pending, 0, "FORBIDDEN_ACTIVE_OOS_COMMANDS");
  const preparation = await pool.query("SELECT count(*)::int AS pending FROM oos_premarket_batches WHERE status IN ('QUEUED','RUNNING')");
  assert.equal(preparation.rows[0].pending, 0, "FORBIDDEN_ACTIVE_PREMARKET_BATCH");
  const before = await forensicBusinessBaseline({ pool, config });
  await mkdir(indexRoot, { recursive: true });
  await writeFile(path.join(indexRoot, "acceptance-baseline.json"), JSON.stringify(before));
  const result = await buildOosForensicIndex({ repository: new PostgresOosRegistry(pool), root: config.archive_root,
    indexRoot, batchId: config.batch_id, smokeDates: config.technical_smoke_dates ?? [], fileInventory: before.files });
  const after = await forensicBusinessBaseline({ pool, config });
  assert.equal(before.business_sha256, after.business_sha256); assert.equal(before.archive_sha256, after.archive_sha256);
  console.log(JSON.stringify({ ...result, read_only_source_test: "PASS", original_files: before.file_count,
    business_sha256: before.business_sha256, archive_sha256: before.archive_sha256 }));
} finally { await pool.end(); }
