#!/usr/bin/env node
import { Pool } from "pg";
import { auditMarketDataCapabilities } from "../src/market-data-capability-profiler.js";
import { planMarketDataStorage } from "../src/market-data-storage-planner.js";

const databaseUrl = process.env.DESK_POSTGRES_URL
  || process.env.POSTGRES_URL
  || process.env.DATABASE_URL
  || "";
const asOfUtc = process.env.DESK_STORAGE_PLAN_AS_OF_UTC || process.env.DESK_CAPABILITY_AS_OF_UTC || new Date().toISOString();
const environment = process.env.DESK_STORAGE_PLAN_ENVIRONMENT || process.env.DESK_CAPABILITY_ENVIRONMENT || "prod";
const provider = process.env.DESK_STORAGE_PLAN_PROVIDER || process.env.DESK_CAPABILITY_PROVIDER || "tradingview";
const objectStorageBaseUri = process.env.DESK_OBJECT_STORAGE_BASE_URI || "file://./data/object-storage/market-data";
const summaryOnly = process.argv.includes("--summary") || process.env.DESK_STORAGE_PLAN_SUMMARY_ONLY === "1";

let pool = null;
try {
  if (databaseUrl) pool = new Pool({ connectionString: databaseUrl });
  const audit = await auditMarketDataCapabilities({ pool, asOfUtc, environment, provider, persist: false });
  const plan = planMarketDataStorage({
    capabilityReport: audit.profile,
    asOfUtc,
    objectStorageBaseUri,
    hotRetentionDays: process.env.DESK_HOT_SERIES_RETENTION_DAYS || 45,
    coldRetentionDays: process.env.DESK_COLD_OBJECT_RETENTION_DAYS || 1825,
  });
  process.stdout.write(`${JSON.stringify(summaryOnly ? summarize({ audit, plan }) : { audit_status: audit.database_status, plan }, null, 2)}\n`);
} finally {
  await pool?.end?.();
}

function summarize({ audit, plan }) {
  return {
    schema_version: plan.schema_version,
    database_status: audit.database_status,
    planned_at_utc: plan.planned_at_utc,
    source_profile_ref: plan.source_profile_ref,
    object_storage_base_uri: plan.object_storage_base_uri,
    summary: plan.summary,
  };
}
