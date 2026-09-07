#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import { resolveTheoreticalTradeAdministrativeReview }
  from "../src/application/resolve-theoretical-trade-administrative-review.js";
import { createPostgresTheoreticalTradeAdministrativeResolution }
  from "../src/persistence/postgres-theoretical-trade-administrative-resolution.js";

const APPLY_CONFIRMATION = "APPLY_THEORETICAL_TRADE_NO_REAL_EXPOSURE_RESOLUTION";

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, code: error.code || "THEORETICAL_ADMIN_RESOLUTION_FAILED" }));
  process.exitCode = 1;
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === "APPLY" && args.confirm !== APPLY_CONFIRMATION) {
    throw cliError("THEORETICAL_ADMIN_RESOLUTION_CONFIRMATION_REQUIRED");
  }
  const connectionString = process.env.DESK_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!connectionString) throw cliError("THEORETICAL_ADMIN_RESOLUTION_DATABASE_REQUIRED");
  const manifest = JSON.parse(await readFile(args.manifest, "utf8"));
  const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 5000, statement_timeout: 30000,
    application_name: "desk-theoretical-trade-administrative-resolution" });
  try {
    const result = await resolveTheoreticalTradeAdministrativeReview({ mode: args.mode, manifest,
      effective_at_utc: args.effectiveAtUtc, actor: args.actor, reason: args.reason,
      operator_attestation: { schema_version: "operator_no_open_exposure_attestation_v1",
        no_open_orders: true, no_open_positions: true } },
    { repository: createPostgresTheoreticalTradeAdministrativeResolution(pool) });
    await writeFile(args.output, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    console.log(JSON.stringify({ ok: true, status: result.status, mode: result.mode,
      item_count: result.item_count, output: args.output }));
  } finally { await pool.end(); }
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--") || parsed[key]) {
      throw cliError("THEORETICAL_ADMIN_RESOLUTION_ARGUMENT_INVALID");
    }
    parsed[key] = value;
  }
  const mode = String(parsed["--mode"] || "dry-run").toUpperCase().replace("-", "_");
  if (!["DRY_RUN", "APPLY"].includes(mode)) throw cliError("THEORETICAL_ADMIN_RESOLUTION_MODE_INVALID");
  const required = ["--manifest", "--output", "--effective-at-utc", "--actor", "--reason"];
  if (required.some((field) => !parsed[field])) throw cliError("THEORETICAL_ADMIN_RESOLUTION_AUDIT_REQUIRED");
  return { mode, manifest: path.resolve(parsed["--manifest"]), output: path.resolve(parsed["--output"]),
    effectiveAtUtc: parsed["--effective-at-utc"], actor: parsed["--actor"], reason: parsed["--reason"],
    confirm: parsed["--confirm"] || null };
}

function cliError(code) { const error = new Error(code); error.code = code; return error; }
