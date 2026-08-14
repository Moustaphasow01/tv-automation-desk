import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const migrationPath = path.join(repoRoot, "infra/postgres/init/027_feature_registry.sql");
const policyPath = path.join(repoRoot, "docs/engineering/sql-migration-policy.json");
const contractPath = path.join(repoRoot, "docs/trading-desk-target-blueprint/contracts/07-feature-definition.md");
const engineeringDocPath = path.join(repoRoot, "docs/engineering/data-foundation-registry.md");

const migration = readFileSync(migrationPath, "utf8");
const policy = readFileSync(policyPath, "utf8");

test("TD2-202 declares feature definition, version, computation and value tables", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS feature_definitions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS feature_versions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS feature_computation_runs/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS feature_value_points/);
  assert.match(migration, /dataset_id uuid NOT NULL REFERENCES datasets\(dataset_id\) ON DELETE RESTRICT/);
  assert.match(migration, /feature_version_id uuid NOT NULL REFERENCES feature_versions\(feature_version_id\) ON DELETE RESTRICT/);
});

test("TD2-202 enforces published feature version safety and reproducible computations", () => {
  assert.match(migration, /CONSTRAINT feature_versions_published_is_safe CHECK/);
  assert.match(migration, /formula_hash IS NOT NULL/);
  assert.match(migration, /deterministic = true/);
  assert.match(migration, /point_in_time_safe = true/);
  assert.match(migration, /UNIQUE \(feature_version_id, dataset_id, parameters_hash\)/);
  assert.match(migration, /CONSTRAINT feature_computation_completed_sealed CHECK/);
  assert.match(migration, /AND output_hash IS NOT NULL/);
  assert.match(migration, /AND provenance_hash IS NOT NULL/);
});

test("TD2-202 keeps feature tables in the features boundary", () => {
  assert.match(policy, /"owner": "features"/);
  assert.match(policy, /"\^feature_"/);
});

test("TD2-202 documents versioning, point-in-time safety and immutable values", () => {
  const contract = readFileSync(contractPath, "utf8");
  const engineeringDoc = readFileSync(engineeringDocPath, "utf8");

  assert.match(contract, /Feature Version/);
  assert.match(contract, /point_in_time_safe/);
  assert.match(contract, /feature_computation_runs/);
  assert.match(contract, /feature_value_points/);
  assert.match(engineeringDoc, /TD2-202/);
  assert.match(engineeringDoc, /Feature Registry/);
});
