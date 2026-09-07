#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import { correctTheoreticalTradeOutcomes } from "../src/application/correct-theoretical-trade-outcomes.js";
import { createPostgresTradeOutcomeCorrection } from "../src/persistence/postgres-trade-outcome-correction.js";

const APPLY_CONFIRMATION = "APPLY_VERSIONED_TRADE_OUTCOME_CORRECTIONS";

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, code: error.code || "OUTCOME_CORRECTION_FAILED" }));
  process.exitCode = 1;
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === "APPLY" && args.confirm !== APPLY_CONFIRMATION) {
    throw cliError("OUTCOME_CORRECTION_CONFIRMATION_REQUIRED");
  }
  const connectionString = process.env.DESK_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!connectionString) throw cliError("OUTCOME_CORRECTION_DATABASE_REQUIRED");
  const manifest = JSON.parse(await readFile(args.manifest, "utf8"));
  const pool = new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 5000,
    statement_timeout: 30000,
    application_name: "desk-trade-outcome-correction",
  });
  try {
    const result = await correctTheoreticalTradeOutcomes({
      mode: args.mode,
      manifest,
      correction_known_at_utc: args.correctionKnownAtUtc,
      corrected_by: args.correctedBy,
      reason: args.reason,
    }, { repository: createPostgresTradeOutcomeCorrection(pool) });
    await writeFile(args.output, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    console.log(JSON.stringify({ ok: true, status: result.status, mode: result.mode, item_count: result.item_count, output: args.output }));
  } finally {
    await pool.end();
  }
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--") || parsed[key]) throw cliError("OUTCOME_CORRECTION_ARGUMENT_INVALID");
    parsed[key] = value;
  }
  const mode = String(parsed["--mode"] || "dry-run").toUpperCase().replace("-", "_");
  if (!['DRY_RUN', 'APPLY'].includes(mode)) throw cliError("OUTCOME_CORRECTION_MODE_INVALID");
  if (!parsed["--manifest"] || !parsed["--output"]) throw cliError("OUTCOME_CORRECTION_PATHS_REQUIRED");
  if (mode === "APPLY" && (!parsed["--corrected-by"] || !parsed["--reason"] || !parsed["--correction-known-at-utc"])) {
    throw cliError("OUTCOME_CORRECTION_APPLY_AUDIT_REQUIRED");
  }
  return {
    mode,
    manifest: path.resolve(parsed["--manifest"]),
    output: path.resolve(parsed["--output"]),
    correctedBy: parsed["--corrected-by"] || null,
    reason: parsed["--reason"] || null,
    correctionKnownAtUtc: parsed["--correction-known-at-utc"] || null,
    confirm: parsed["--confirm"] || null,
  };
}

function cliError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
