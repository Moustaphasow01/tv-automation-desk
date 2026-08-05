#!/usr/bin/env node
import process from "node:process";
import pg from "pg";
import {
  importTradingViewM1Backfill,
  parseTradingViewM1BackfillArgs,
  safeErrorReceipt,
} from "../src/tradingview-m1-backfill-importer.js";

const { Pool } = pg;
let pool;
try {
  const options = parseTradingViewM1BackfillArgs(process.argv.slice(2), process.env);
  if (!process.env.DATABASE_URL) throw Object.assign(new Error("DATABASE_URL is required."), { code: "BACKFILL_DATABASE_URL_REQUIRED" });
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const receipt = await importTradingViewM1Backfill(pool, options);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify(safeErrorReceipt(null, error), null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await pool?.end();
}
