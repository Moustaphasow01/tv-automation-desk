import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const migrationPath = path.join(repoRoot, "infra/postgres/init/026_dataset_registry.sql");
const policyPath = path.join(repoRoot, "docs/engineering/sql-migration-policy.json");
const datasetContractPath = path.join(repoRoot, "docs/trading-desk-target-blueprint/contracts/04-dataset.md");
const engineeringDocPath = path.join(repoRoot, "docs/engineering/data-foundation-registry.md");

const migration = readFileSync(migrationPath, "utf8");
const policy = readFileSync(policyPath, "utf8");

test("TD2-201 declares a sealed dataset registry over ingestion batches", () => {
  assert.match(migration, /CREATE TYPE dataset_status AS ENUM \('BUILDING', 'READY', 'ARCHIVED'\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS datasets/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS dataset_ingestion_batches/);
  assert.match(migration, /ingestion_batch_id uuid NOT NULL REFERENCES ingestion_batches\(ingestion_batch_id\) ON DELETE RESTRICT/);
  assert.match(migration, /source_batch_count integer NOT NULL DEFAULT 0 CHECK \(source_batch_count >= 0\)/);
});

test("TD2-201 requires READY datasets to carry cutoff, composition and hashes", () => {
  assert.match(migration, /CONSTRAINT datasets_ready_is_sealed CHECK/);
  assert.match(migration, /status <> 'READY'/);
  assert.match(migration, /cutoff_utc IS NOT NULL/);
  assert.match(migration, /cutoff_paris IS NOT NULL/);
  assert.match(migration, /source_batch_count > 0/);
  assert.match(migration, /content_hash IS NOT NULL/);
  assert.match(migration, /provenance_hash IS NOT NULL/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS datasets_provenance_hash_unique_idx/);
});

test("TD2-201 keeps dataset tables in the market-data boundary", () => {
  assert.match(policy, /"\^datasets\$"/);
  assert.match(policy, /"\^dataset_"/);
});

test("TD2-201 documents dataset cutoff and provenance invariants", () => {
  const datasetContract = readFileSync(datasetContractPath, "utf8");
  const engineeringDoc = readFileSync(engineeringDocPath, "utf8");

  assert.match(datasetContract, /cutoff_utc/);
  assert.match(datasetContract, /source_batch_count/);
  assert.match(datasetContract, /Dataset `READY`/);
  assert.match(engineeringDoc, /TD2-201/);
  assert.match(engineeringDoc, /`datasets`/);
  assert.match(engineeringDoc, /`dataset_ingestion_batches`/);
});
