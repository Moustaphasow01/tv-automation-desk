import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const migrationPath = path.join(repoRoot, "infra/postgres/init/029_market_data_capability_profiles.sql");
const policyPath = path.join(repoRoot, "docs/engineering/sql-migration-policy.json");
const engineeringDocPath = path.join(repoRoot, "docs/engineering/market-data-capability-profiling.md");
const registryDocPath = path.join(repoRoot, "docs/engineering/data-foundation-registry.md");

const migration = readFileSync(migrationPath, "utf8");
const policy = readFileSync(policyPath, "utf8");

test("TD2-206 declares market data capability profile enums and tables", () => {
  assert.match(migration, /CREATE TYPE market_data_capability_status AS ENUM \('MEASURED', 'PARTIAL', 'MISSING', 'UNAVAILABLE'\)/);
  assert.match(migration, /CREATE TYPE market_data_blocking_classification AS ENUM \('BLOCKING', 'NON_BLOCKING', 'UNKNOWN'\)/);
  assert.match(migration, /CREATE TYPE market_data_storage_recommendation AS ENUM \('HOT_SERIES', 'COLD_RAW', 'HOT_AND_COLD', 'IGNORE'\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS market_data_capability_profile_runs/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS market_data_capability_profiles/);
  assert.match(migration, /capability_profile_run_id uuid REFERENCES market_data_capability_profile_runs/);
});

test("TD2-206 stores historical depth, missing capabilities and storage recommendations", () => {
  assert.match(migration, /historical_start_utc timestamptz/);
  assert.match(migration, /historical_end_utc timestamptz/);
  assert.match(migration, /has_tick boolean NOT NULL DEFAULT false/);
  assert.match(migration, /has_bid boolean NOT NULL DEFAULT false/);
  assert.match(migration, /has_ask boolean NOT NULL DEFAULT false/);
  assert.match(migration, /has_open_interest boolean NOT NULL DEFAULT false/);
  assert.match(migration, /missing_capabilities text\[\] NOT NULL DEFAULT '\{\}'::text\[\]/);
  assert.match(migration, /blocking_missing_capabilities text\[\] NOT NULL DEFAULT '\{\}'::text\[\]/);
  assert.match(migration, /cost_profile jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(migration, /storage_recommendation market_data_storage_recommendation NOT NULL/);
});

test("TD2-206 keeps capability profiling in the market-data boundary", () => {
  assert.match(policy, /"\^market_"/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS market_capability_profiles_missing_gin_idx/);
});

test("TD2-206 documents CLI usage and blocking semantics", () => {
  const engineeringDoc = readFileSync(engineeringDocPath, "utf8");
  const registryDoc = readFileSync(registryDocPath, "utf8");

  assert.match(engineeringDoc, /npm run profile:market-data/);
  assert.match(engineeringDoc, /tick\/bid\/ask\/open interest/);
  assert.match(engineeringDoc, /non bloquants pour V5/);
  assert.match(registryDoc, /Addendum TD2-206/);
  assert.match(registryDoc, /market_data_capability_profiles/);
});
