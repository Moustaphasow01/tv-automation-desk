#!/usr/bin/env node
import { Pool } from "pg";
import { auditMarketDataCapabilities } from "../src/market-data-capability-profiler.js";

const databaseUrl = process.env.DESK_POSTGRES_URL
  || process.env.POSTGRES_URL
  || process.env.DATABASE_URL
  || "";
const asOfUtc = process.env.DESK_CAPABILITY_AS_OF_UTC || new Date().toISOString();
const environment = process.env.DESK_CAPABILITY_ENVIRONMENT || "prod";
const provider = process.env.DESK_CAPABILITY_PROVIDER || "tradingview";
const summaryOnly = process.argv.includes("--summary") || process.env.DESK_CAPABILITY_SUMMARY_ONLY === "1";
const persist = process.argv.includes("--persist") || process.env.DESK_CAPABILITY_PERSIST === "1";
const dryRun = process.argv.includes("--dry-run") || process.env.DESK_CAPABILITY_DRY_RUN === "1";

let pool = null;
try {
  if (databaseUrl) pool = new Pool({ connectionString: databaseUrl });
  const audit = await auditMarketDataCapabilities({
    pool,
    asOfUtc,
    environment,
    provider,
    persist,
    dryRun,
  });
  process.stdout.write(`${JSON.stringify(summaryOnly ? summarize(audit) : audit, null, 2)}\n`);
  if (audit.profile.summary.blocking_count > 0 && process.env.DESK_CAPABILITY_FAIL_ON_BLOCKING === "1") {
    process.exitCode = 2;
  }
} finally {
  await pool?.end?.();
}

function summarize(audit) {
  return {
    schema_version: audit.profile.schema_version,
    database_status: audit.database_status,
    persistence: audit.persistence,
    as_of_utc: audit.profile.as_of_utc,
    profile_ref: audit.profile.profile_ref,
    environment: audit.profile.environment,
    provider: audit.profile.provider,
    summary: audit.profile.summary,
    blocking_profiles: audit.profile.blocking_profiles,
  };
}
