import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const migrationPath = path.join(repoRoot, "infra/postgres/init/032_simulation_run_registry.sql");
const orderSimulationMigrationPath = path.join(repoRoot, "infra/postgres/init/033_order_simulation_policy_artifact_kind.sql");
const robustnessMigrationPath = path.join(repoRoot, "infra/postgres/init/034_robustness_report_artifact_kind.sql");
const policyPath = path.join(repoRoot, "docs/engineering/sql-migration-policy.json");
const contractPath = path.join(repoRoot, "docs/trading-desk-target-blueprint/contracts/05-run.md");
const engineeringDocPath = path.join(repoRoot, "docs/engineering/simulation-run-registry.md");

const migration = readFileSync(migrationPath, "utf8");
const orderSimulationMigration = readFileSync(orderSimulationMigrationPath, "utf8");
const robustnessMigration = readFileSync(robustnessMigrationPath, "utf8");
const policy = readFileSync(policyPath, "utf8");

test("TD2-302 creates SimulationRun registry, artifacts and audit tables", () => {
  assert.match(migration, /CREATE TYPE simulation_run_status AS ENUM/);
  assert.match(migration, /'QUEUED'/);
  assert.match(migration, /'REVIEW_REQUIRED'/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS simulation_runs/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS simulation_run_artifacts/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS simulation_run_audit_events/);
});

test("TD2-302 links SimulationRun to Strategy Version and Dataset registries", () => {
  assert.match(migration, /strategy_version_id uuid NOT NULL REFERENCES strategy_versions\(strategy_version_id\) ON DELETE RESTRICT/);
  assert.match(migration, /dataset_id uuid NOT NULL REFERENCES datasets\(dataset_id\) ON DELETE RESTRICT/);
  assert.match(migration, /parameters_hash text NOT NULL/);
  assert.match(migration, /reproducibility_seed text NOT NULL/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS simulation_runs_reproducibility_idx/);
});

test("TD2-302 seals completed runs with result and metric hashes", () => {
  assert.match(migration, /CONSTRAINT simulation_runs_completed_has_hashes CHECK/);
  assert.match(migration, /AND result_hash IS NOT NULL/);
  assert.match(migration, /AND metrics_hash IS NOT NULL/);
  assert.match(migration, /AND result_ref IS NOT NULL/);
  assert.match(migration, /AND metrics_ref IS NOT NULL/);
  assert.match(migration, /prevent_terminal_simulation_run_mutation/);
  assert.match(migration, /TERMINAL_SIMULATION_RUN_IMMUTABLE/);
});

test("TD2-302 keeps artifacts immutable and hash-addressed", () => {
  assert.match(migration, /CREATE TYPE simulation_run_artifact_kind AS ENUM/);
  assert.match(migration, /'INPUT_MANIFEST'/);
  assert.match(migration, /'ORDER_SIMULATION_POLICY'/);
  assert.match(migration, /'POSITIONS'/);
  assert.match(migration, /'ROBUSTNESS_REPORT'/);
  assert.match(migration, /content_hash text NOT NULL/);
  assert.match(migration, /UNIQUE \(simulation_run_id, artifact_kind, content_hash\)/);
  assert.match(migration, /prevent_simulation_artifact_mutation/);
  assert.match(migration, /SIMULATION_RUN_ARTIFACT_IMMUTABLE/);
});

test("TD2-305 extends SimulationRun artifacts with order simulation policy", () => {
  assert.match(orderSimulationMigration, /ALTER TYPE simulation_run_artifact_kind ADD VALUE IF NOT EXISTS 'ORDER_SIMULATION_POLICY'/);
});

test("TD2-307 extends SimulationRun artifacts with robustness reports", () => {
  assert.match(robustnessMigration, /ALTER TYPE simulation_run_artifact_kind ADD VALUE IF NOT EXISTS 'ROBUSTNESS_REPORT'/);
});

test("TD2-302 documents Run Registry ownership and contract extension", () => {
  const contract = readFileSync(contractPath, "utf8");
  const engineeringDoc = readFileSync(engineeringDocPath, "utf8");

  assert.match(policy, /"owner": "simulation"/);
  assert.match(policy, /"\^simulation_"/);
  assert.match(contract, /REVIEW_REQUIRED/);
  assert.match(contract, /simulation_run_artifacts/);
  assert.match(engineeringDoc, /TD2-302/);
  assert.match(engineeringDoc, /Run Registry minimal/);
});
