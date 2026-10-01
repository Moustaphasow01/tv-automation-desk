import { readFile } from "node:fs/promises";
import pg from "pg";

// Runs against the dedicated OOS database only. No secrets or trading data are printed.
const url = new URL(process.env.OOS_DATABASE_URL || "");
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== "5434" || url.pathname !== "/desk_oos") {
  throw new Error("ISOLATED_OOS_DATABASE_REQUIRED");
}
const pool = new pg.Pool({ connectionString: process.env.OOS_DATABASE_URL, max: 1 });
try {
  const identity = (await pool.query("SELECT current_database() AS database, current_user AS role")).rows[0];
  if (identity.database !== "desk_oos" || identity.role !== "desk_oos") throw new Error("OOS_DATABASE_IDENTITY_REQUIRED");
  await pool.query(await readFile(new URL("../../infra/postgres/init/072_oos_premarket_orchestration.sql", import.meta.url), "utf8"));
  console.log(JSON.stringify({ migration: "072_oos_premarket_orchestration", status: "PASS", database: identity.database }));
} finally { await pool.end(); }
