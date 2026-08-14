import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const registryMigration = readFileSync(join(repoRoot, "infra/postgres/init/022_strategy_kernel_registry.sql"), "utf8");
const auditMigration = readFileSync(join(repoRoot, "infra/postgres/init/023_strategy_kernel_audit.sql"), "utf8");

describe("Strategy Kernel SQL foundation", () => {
  test("declares Definition, Version and Instance as separate relational aggregates", () => {
    assert.match(registryMigration, /CREATE TABLE IF NOT EXISTS strategy_definitions/);
    assert.match(registryMigration, /CREATE TABLE IF NOT EXISTS strategy_versions/);
    assert.match(registryMigration, /CREATE TABLE IF NOT EXISTS strategy_instances/);
    assert.match(registryMigration, /strategy_definition_id uuid NOT NULL REFERENCES strategy_definitions/);
    assert.match(registryMigration, /strategy_version_id uuid NOT NULL REFERENCES strategy_versions/);
  });

  test("keeps version status, runtime state and execution mode as independent enums", () => {
    assert.match(registryMigration, /CREATE TYPE strategy_version_status AS ENUM/);
    assert.match(registryMigration, /'draft'/);
    assert.match(registryMigration, /'published'/);
    assert.match(registryMigration, /CREATE TYPE strategy_instance_runtime_state AS ENUM/);
    assert.match(registryMigration, /'running'/);
    assert.match(registryMigration, /'errored'/);
    assert.match(registryMigration, /CREATE TYPE strategy_instance_execution_mode AS ENUM/);
    assert.match(registryMigration, /'shadow'/);
    assert.match(registryMigration, /'paper'/);
    assert.match(registryMigration, /'live'/);
  });

  test("protects published Strategy Versions and does not touch the singular runtime pin", () => {
    assert.match(registryMigration, /prevent_published_strategy_version_mutation/);
    assert.match(registryMigration, /PUBLISHED_STRATEGY_VERSION_IMMUTABLE/);
    assert.match(registryMigration, /runtime_contract_bundle_version text NOT NULL/);
    assert.doesNotMatch(registryMigration, /ACTIVE_STRATEGY_RUNTIME_VERSIONS/);
  });

  test("enforces live-instance safety without merging runtime state and execution mode", () => {
    assert.match(registryMigration, /runtime_state strategy_instance_runtime_state NOT NULL DEFAULT 'created'/);
    assert.match(registryMigration, /execution_mode strategy_instance_execution_mode NOT NULL DEFAULT 'shadow'/);
    assert.match(registryMigration, /strategy_instances_single_unlocked_live_account_idx/);
    assert.match(registryMigration, /execution_mode = 'live'/);
    assert.match(registryMigration, /triple_lock_validated = false/);
  });

  test("adds append-only audit events for Strategy Kernel transitions", () => {
    assert.match(auditMigration, /CREATE TABLE IF NOT EXISTS strategy_kernel_audit_events/);
    assert.match(auditMigration, /aggregate_type IN \('strategy_definition', 'strategy_version', 'strategy_instance'\)/);
    assert.match(auditMigration, /strategy_kernel_audit_events_idempotency_idx/);
    assert.match(auditMigration, /previous_hash/);
    assert.match(auditMigration, /next_hash/);
  });
});
