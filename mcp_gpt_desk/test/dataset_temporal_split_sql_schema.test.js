import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const migrationPath = path.join(repoRoot, "infra/postgres/init/035_dataset_temporal_splits.sql");
const contractPath = path.join(repoRoot, "docs/trading-desk-target-blueprint/contracts/05-run.md");

const migration = readFileSync(migrationPath, "utf8");

test("TD2-308 creates immutable dataset temporal splits", () => {
  assert.match(migration, /CREATE TYPE dataset_split_role AS ENUM \('TRAIN', 'VALIDATION', 'OUT_OF_SAMPLE'\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS dataset_temporal_splits/);
  assert.match(migration, /dataset_id uuid NOT NULL REFERENCES datasets\(dataset_id\) ON DELETE RESTRICT/);
  assert.match(migration, /split_policy_hash text NOT NULL/);
  assert.match(migration, /split_hash text NOT NULL UNIQUE/);
  assert.match(migration, /CONSTRAINT dataset_temporal_splits_time_order CHECK/);
});

test("TD2-308 records SimulationRun split usage and leakage proof", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS simulation_run_split_usage/);
  assert.match(migration, /simulation_run_id uuid PRIMARY KEY REFERENCES simulation_runs\(simulation_run_id\) ON DELETE CASCADE/);
  assert.match(migration, /dataset_temporal_split_id uuid NOT NULL REFERENCES dataset_temporal_splits\(dataset_temporal_split_id\) ON DELETE RESTRICT/);
  assert.match(migration, /leakage_status dataset_split_leakage_status NOT NULL/);
  assert.match(migration, /leakage_report jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
});

test("TD2-308 documents split contract in Run contract", () => {
  const contract = readFileSync(contractPath, "utf8");

  assert.match(contract, /dataset_temporal_splits/);
  assert.match(contract, /OUT_OF_SAMPLE/);
  assert.match(contract, /dataset_temporal_split_manifest_v1/);
});
