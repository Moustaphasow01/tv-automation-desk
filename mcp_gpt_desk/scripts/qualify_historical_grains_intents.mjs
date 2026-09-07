#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import { qualifyHistoricalGrainsIntents } from "../src/application/qualify-historical-grains-intents.js";
import { createPostgresHistoricalGrainsIntentQualification } from "../src/persistence/postgres-historical-grains-intent-qualification.js";

const APPLY_CONFIRMATION = "APPLY_RETAINED_HISTORICAL_INTENT_QUALIFICATIONS";

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, code: error.code || "HISTORICAL_QUALIFICATION_FAILED" }));
  process.exitCode = 1;
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === "APPLY" && args.confirm !== APPLY_CONFIRMATION) throw cliError("QUALIFICATION_CONFIRMATION_REQUIRED");
  const connectionString = process.env.DESK_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!connectionString) throw cliError("QUALIFICATION_DATABASE_REQUIRED");
  const manifest = JSON.parse(await readFile(args.manifest, "utf8"));
  const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 5000, statement_timeout: 30000, application_name: "desk-historical-grains-qualification" });
  try {
    const result = await qualifyHistoricalGrainsIntents({ mode: args.mode, manifest,
      qualified_at_utc: args.qualifiedAtUtc, qualified_by: args.qualifiedBy, reason: args.reason },
    { repository: createPostgresHistoricalGrainsIntentQualification(pool) });
    await writeFile(args.output, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    console.log(JSON.stringify({ ok: true, status: result.status, item_count: result.item_count, output: args.output }));
  } finally { await pool.end(); }
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--") || parsed[key]) throw cliError("QUALIFICATION_ARGUMENT_INVALID");
    parsed[key] = value;
  }
  const mode = String(parsed["--mode"] || "dry-run").toUpperCase().replace("-", "_");
  if (!["DRY_RUN", "APPLY"].includes(mode)) throw cliError("QUALIFICATION_MODE_INVALID");
  if (!parsed["--manifest"] || !parsed["--output"]) throw cliError("QUALIFICATION_PATHS_REQUIRED");
  if (mode === "APPLY" && (!parsed["--qualified-by"] || !parsed["--reason"] || !parsed["--qualified-at-utc"])) {
    throw cliError("QUALIFICATION_APPLY_AUDIT_REQUIRED");
  }
  return { mode, manifest: path.resolve(parsed["--manifest"]), output: path.resolve(parsed["--output"]),
    qualifiedBy: parsed["--qualified-by"] || null, reason: parsed["--reason"] || null,
    qualifiedAtUtc: parsed["--qualified-at-utc"] || null, confirm: parsed["--confirm"] || null };
}

function cliError(code) { const error = new Error(code); error.code = code; return error; }
