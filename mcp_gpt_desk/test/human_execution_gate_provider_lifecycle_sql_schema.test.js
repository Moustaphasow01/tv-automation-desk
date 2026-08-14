import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const migrationPath = path.join(repoRoot, "infra/postgres/init/050_human_execution_gate_provider_lifecycle.sql");
const migration = readFileSync(migrationPath, "utf8");
const executionRepositoryPath = path.join(repoRoot, "mcp_gpt_desk/src/portfolio-order-intent-execution-repository.js");
const executionRepository = readFileSync(executionRepositoryPath, "utf8");

test("LOT-005 adds non-terminal provider command statuses for unknown/reconciliation", () => {
  assert.match(migration, /ALTER TYPE execution_provider_command_status ADD VALUE IF NOT EXISTS 'unknown'/);
  assert.match(migration, /ALTER TYPE execution_provider_command_status ADD VALUE IF NOT EXISTS 'reconciliation_required'/);
});

test("LOT-005 persists canonical Human Execution Gate state and audit events", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS human_execution_gates/);
  assert.match(migration, /portfolio_order_intent_id text NOT NULL UNIQUE/);
  assert.match(migration, /AWAITING_MANUAL_CONFIRMATION/);
  assert.match(migration, /CONFIRMED/);
  assert.match(migration, /human_execution_gate_confirmed_terms_check/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS human_execution_gate_events/);
  assert.match(migration, /human_execution_gate_events_idempotency_idx/);
});

test("LOT-005 persists provider lifecycle state separate from ACK/fill events", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS portfolio_order_intent_execution_states/);
  assert.match(migration, /ACKNOWLEDGED/);
  assert.match(migration, /PARTIALLY_FILLED/);
  assert.match(migration, /RECONCILIATION_REQUIRED/);
  assert.match(migration, /filled_quantity numeric NOT NULL DEFAULT 0/);
  assert.match(migration, /broker_provider_commands_portfolio_status_idx/);
});

test("LOT-005 PostgreSQL lineage query uses the real created_at_utc schema column", () => {
  assert.match(executionRepository, /ORDER BY l\.created_at_utc ASC/);
  assert.doesNotMatch(executionRepository, /ORDER BY l\.created_at ASC/);
});
