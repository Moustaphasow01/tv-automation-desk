import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const migrationPath = path.join(repoRoot, "infra/postgres/init/048_portfolio_risk_runtime_lineage.sql");
const accountScopeMigrationPath = path.join(repoRoot, "infra/postgres/init/053_portfolio_candidate_allocation_account_scope.sql");
const policyPath = path.join(repoRoot, "docs/engineering/sql-migration-policy.json");
const migration = readFileSync(migrationPath, "utf8");
const accountScopeMigration = readFileSync(accountScopeMigrationPath, "utf8");
const policy = readFileSync(policyPath, "utf8");

test("LOT-003 creates canonical Portfolio Risk runtime tables", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS portfolio_arbitration_runs/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS portfolio_candidate_allocations/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS portfolio_risk_decisions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS portfolio_target_positions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS portfolio_order_intent_lineage/);
});

test("LOT-003 persists lineage from allocation to risk decision to target to order intent", () => {
  assert.match(migration, /candidate_allocation_id text NOT NULL REFERENCES portfolio_candidate_allocations/);
  assert.match(migration, /target_position_id text NOT NULL REFERENCES portfolio_target_positions/);
  assert.match(migration, /risk_decision_id text NOT NULL REFERENCES portfolio_risk_decisions/);
  assert.match(migration, /trade_order_intent_id text REFERENCES trade_order_intents/);
  assert.match(migration, /idempotency_key text NOT NULL UNIQUE/);
  assert.match(migration, /order_intent_hash text NOT NULL CHECK/);
});

test("LOT-003 keeps known invariants relational and audit payloads hashed", () => {
  assert.match(migration, /net_direction text NOT NULL CHECK \(net_direction IN \('LONG', 'SHORT', 'FLAT'\)\)/);
  assert.match(migration, /decision text NOT NULL CHECK \(decision IN \('APPROVED', 'REDUCED', 'REJECTED'\)\)/);
  assert.match(migration, /risk_approved_net_size numeric NOT NULL DEFAULT 0/);
  assert.match(migration, /payload_hash text NOT NULL CHECK \(payload_hash ~ '\^sha256:\[a-f0-9\]\{64\}\$'\)/);
  assert.match(migration, /payload jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
});

test("LOT-003 assigns portfolio tables to the portfolio-risk owner boundary", () => {
  assert.match(policy, /"owner": "portfolio-risk"/);
  assert.match(policy, /"\^portfolio_"/);
});

test("LOT-010 persists account scope at the candidate allocation layer", () => {
  assert.match(accountScopeMigration, /ADD COLUMN IF NOT EXISTS account_id text/);
  assert.match(accountScopeMigration, /ALTER COLUMN account_id SET NOT NULL/);
  assert.match(accountScopeMigration, /portfolio_candidate_allocations_account_instrument_time_idx/);
});
