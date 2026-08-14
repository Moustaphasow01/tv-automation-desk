import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const migrationPath = path.join(repoRoot, "infra/postgres/init/036_prompt_instruction_registry.sql");
const policyPath = path.join(repoRoot, "docs/engineering/sql-migration-policy.json");

const migration = readFileSync(migrationPath, "utf8");
const policy = readFileSync(policyPath, "utf8");

test("TD2-PRM-002 creates Prompt and Instruction version registries", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS prompt_definitions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS prompt_versions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS instruction_definitions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS instruction_versions/);
  assert.match(migration, /UNIQUE \(prompt_definition_id, semantic_version\)/);
  assert.match(migration, /content_sha256 text NOT NULL/);
});

test("TD2-PRM-002 models deterministic compositions and render snapshots", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS prompt_compositions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS prompt_composition_items/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS prompt_render_snapshots/);
  assert.match(migration, /rendered_sha256 text NOT NULL/);
  assert.match(migration, /variables_sha256 text NOT NULL/);
  assert.match(migration, /UNIQUE \(prompt_composition_id, ordinal\)/);
});

test("TD2-PRM-002 models bindings deployments evaluations and audit", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS agent_prompt_bindings/);
  assert.match(migration, /last_known_good_composition_id uuid REFERENCES prompt_compositions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS prompt_deployments/);
  assert.match(migration, /rollback_of_deployment_id uuid REFERENCES prompt_deployments/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS prompt_evaluations/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS prompt_audit_events/);
});

test("TD2-PRM-002 protects published registry entries from silent mutation", () => {
  assert.match(migration, /prevent_published_prompt_registry_mutation/);
  assert.match(migration, /PUBLISHED_PROMPT_VERSION_IMMUTABLE/);
  assert.match(migration, /PUBLISHED_INSTRUCTION_VERSION_IMMUTABLE/);
  assert.match(migration, /PUBLISHED_PROMPT_COMPOSITION_IMMUTABLE/);
});

test("TD2-PRM-002 assigns SQL ownership to agents tables", () => {
  assert.match(policy, /"owner": "agents"/);
  assert.match(policy, /"\^prompt_"/);
  assert.match(policy, /"\^agent_prompt_"/);
});
