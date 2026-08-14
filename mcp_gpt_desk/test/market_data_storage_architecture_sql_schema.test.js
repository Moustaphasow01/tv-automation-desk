import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const migrationPath = path.join(repoRoot, "infra/postgres/init/030_market_data_storage_architecture.sql");
const policyPath = path.join(repoRoot, "docs/engineering/sql-migration-policy.json");
const engineeringDocPath = path.join(repoRoot, "docs/engineering/market-data-storage-architecture.md");
const registryDocPath = path.join(repoRoot, "docs/engineering/data-foundation-registry.md");

const migration = readFileSync(migrationPath, "utf8");
const policy = readFileSync(policyPath, "utf8");

test("TD2-207 declares hot/cold market data storage enums and tables", () => {
  assert.match(migration, /CREATE TYPE market_data_storage_tier AS ENUM \('HOT_SERIES', 'COLD_PARQUET', 'RAW_ARCHIVE', 'HOT_AND_COLD', 'IGNORE'\)/);
  assert.match(migration, /CREATE TYPE market_data_storage_format AS ENUM \('POSTGRES_SERIES', 'PARQUET', 'JSONL', 'CSV'\)/);
  assert.match(migration, /CREATE TYPE market_data_storage_object_status AS ENUM \('PLANNED', 'ACTIVE', 'ARCHIVED', 'MISSING', 'FAILED'\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS market_data_storage_objects/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS market_data_hot_series_windows/);
});

test("TD2-207 separates immutable raw objects from hot PostgreSQL series windows", () => {
  assert.match(migration, /storage_tier market_data_storage_tier NOT NULL/);
  assert.match(migration, /storage_format market_data_storage_format NOT NULL/);
  assert.match(migration, /uri text NOT NULL/);
  assert.match(migration, /partition_spec jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(migration, /hot_table text NOT NULL DEFAULT 'market_candles'/);
  assert.match(migration, /market_data_storage_object_id uuid REFERENCES market_data_storage_objects/);
  assert.match(migration, /retention_days integer NOT NULL CHECK \(retention_days > 0\)/);
});

test("TD2-207 enforces sealed active objects and reconstruction hashes", () => {
  assert.match(migration, /CONSTRAINT market_storage_active_is_sealed CHECK/);
  assert.match(migration, /record_count > 0/);
  assert.match(migration, /content_hash IS NOT NULL/);
  assert.match(migration, /provenance_hash IS NOT NULL/);
  assert.match(migration, /content_hash ~ '\^sha256:\[a-f0-9\]\{64\}\$'/);
  assert.match(migration, /provenance_hash ~ '\^sha256:\[a-f0-9\]\{64\}\$'/);
});

test("TD2-207 keeps storage tables in the market-data boundary and documents the policy", () => {
  const engineeringDoc = readFileSync(engineeringDocPath, "utf8");
  const registryDoc = readFileSync(registryDocPath, "utf8");

  assert.match(policy, /"\^market_"/);
  assert.match(engineeringDoc, /npm run plan:market-storage/);
  assert.match(engineeringDoc, /Parquet froid/);
  assert.match(engineeringDoc, /séries chaudes PostgreSQL/);
  assert.match(registryDoc, /Addendum TD2-207/);
  assert.match(registryDoc, /market_data_storage_objects/);
});
