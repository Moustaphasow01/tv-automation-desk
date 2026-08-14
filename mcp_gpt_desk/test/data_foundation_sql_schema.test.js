import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const migrationPath = path.join(repoRoot, "infra/postgres/init/025_data_source_ingestion_batch_registry.sql");
const policyPath = path.join(repoRoot, "docs/engineering/sql-migration-policy.json");
const dataSourceContractPath = path.join(repoRoot, "docs/trading-desk-target-blueprint/contracts/08-data-source.md");
const ingestionBatchContractPath = path.join(repoRoot, "docs/trading-desk-target-blueprint/contracts/08-ingestion-batch.md");
const engineeringDocPath = path.join(repoRoot, "docs/engineering/data-foundation-registry.md");

const migration = readFileSync(migrationPath, "utf8");
const policy = readFileSync(policyPath, "utf8");

test("TD2-200 creates generic data source and ingestion batch registries", () => {
  assert.match(migration, /CREATE TYPE data_source_status AS ENUM \('ACTIVE', 'DEPRECATED'\)/);
  assert.match(migration, /CREATE TYPE ingestion_batch_status AS ENUM \('RUNNING', 'COMPLETED', 'FAILED'\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS data_sources/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ingestion_batches/);
  assert.match(migration, /data_source_id uuid NOT NULL REFERENCES data_sources\(data_source_id\) ON DELETE RESTRICT/);
  assert.match(migration, /freshness_sla_seconds integer NOT NULL CHECK \(freshness_sla_seconds > 0\)/);
});

test("TD2-200 seals completed ingestion batches with provenance hashes", () => {
  assert.match(migration, /content_hash ~ '\^sha256:\[a-f0-9\]\{64\}\$'/);
  assert.match(migration, /provenance_hash ~ '\^sha256:\[a-f0-9\]\{64\}\$'/);
  assert.match(migration, /CONSTRAINT ingestion_batches_completed_sealed CHECK/);
  assert.match(migration, /AND content_hash IS NOT NULL/);
  assert.match(migration, /AND provenance_hash IS NOT NULL/);
  assert.match(migration, /CONSTRAINT ingestion_batches_failed_explained CHECK/);
});

test("TD2-200 keeps the new registries owned by the market-data boundary", () => {
  assert.match(policy, /"\^data_sources\$"/);
  assert.match(policy, /"\^ingestion_batches\$"/);
});

test("TD2-200 documents the contracts and implementation boundaries", () => {
  const dataSourceContract = readFileSync(dataSourceContractPath, "utf8");
  const ingestionBatchContract = readFileSync(ingestionBatchContractPath, "utf8");
  const engineeringDoc = readFileSync(engineeringDocPath, "utf8");

  assert.match(dataSourceContract, /freshness_sla_seconds/);
  assert.match(dataSourceContract, /`ACTIVE`\\\|`DEPRECATED`/);
  assert.match(ingestionBatchContract, /`RUNNING`\\\|`COMPLETED`\\\|`FAILED`/);
  assert.match(ingestionBatchContract, /provenance_hash/);
  assert.match(engineeringDoc, /ne remplacent pas `market_feeds`/);
  assert.match(engineeringDoc, /Dataset scellé/);
});
