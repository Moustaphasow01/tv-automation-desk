#!/usr/bin/env node
import { Pool } from "pg";
import { auditMarketDataCoverage } from "../src/market-data-coverage-service.js";

const databaseUrl = process.env.DESK_POSTGRES_URL
  || process.env.POSTGRES_URL
  || process.env.DATABASE_URL
  || "";
const asOfUtc = process.env.DESK_COVERAGE_AS_OF_UTC || new Date().toISOString();
const summaryOnly = process.argv.includes("--summary") || process.env.DESK_COVERAGE_SUMMARY_ONLY === "1";

let pool = null;
try {
  if (databaseUrl) pool = new Pool({ connectionString: databaseUrl });
  const report = await auditMarketDataCoverage({ pool, asOfUtc });
  process.stdout.write(`${JSON.stringify(summaryOnly ? summarize(report) : report, null, 2)}\n`);
  if (report.coverage.execution_allowed === false && process.env.DESK_COVERAGE_FAIL_ON_BLOCKING === "1") {
    process.exitCode = 2;
  }
} finally {
  await pool?.end?.();
}

function summarize(report) {
  return {
    schema_version: report.coverage.schema_version,
    database_status: report.database_status,
    as_of_utc: report.coverage.as_of_utc,
    profile_id: report.coverage.profile_id,
    profile_version: report.coverage.profile_version,
    execution_allowed: report.coverage.execution_allowed,
    status: report.coverage.status,
    summary: report.coverage.summary,
    blocking_datasets: report.coverage.blocking_datasets,
    degraded_datasets: report.coverage.degraded_datasets,
    expected_source_count: report.inventory.sources.length,
  };
}
