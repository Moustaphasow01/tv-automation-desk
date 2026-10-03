import { readFile } from "node:fs/promises";
import pg from "pg";

if (!process.env.OOS_DATABASE_URL) throw new Error("OOS_DATABASE_REQUIRED");
const pool = new pg.Pool({ connectionString: process.env.OOS_DATABASE_URL, connectionTimeoutMillis: 10000 });
try {
  const migration = await readFile(new URL("../../infra/postgres/init/074_oos_premarket_capture_repairs.sql", import.meta.url), "utf8");
  await pool.query(migration);
  console.log(JSON.stringify({ migration: "074_oos_premarket_capture_repairs", status: "PASS" }));
} finally { await pool.end(); }
