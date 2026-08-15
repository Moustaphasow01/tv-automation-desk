import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const migrationPath = path.join(repoRoot, "infra/postgres/init/056_backend_domain_completeness_front_freeze.sql");
const migration = readFileSync(migrationPath, "utf8");

test("LOT front-freeze adds additive StrategySignal trade plan columns", () => {
  assert.match(migration, /ALTER TABLE strategy_signal_outbox/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS proposed_trade_plan jsonb/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS trade_plan_economics jsonb/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS source_data_cutoff_utc timestamptz/);
  assert.match(migration, /strategy_signal_outbox_trade_plan_gin_idx/);
});

test("LOT front-freeze adds additive GlobalRisk economics columns", () => {
  assert.match(migration, /ALTER TABLE portfolio_risk_decisions/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS account_capital_reference jsonb/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS trade_risk jsonb/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS nearest_limit jsonb/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS risk_economics jsonb/);
});

test("LOT front-freeze adds additive TargetPosition and OrderIntent dossier columns", () => {
  assert.match(migration, /ALTER TABLE portfolio_target_positions/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS approved_trade_plan jsonb/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS risk_allocation jsonb/);
  assert.match(migration, /ALTER TABLE portfolio_order_intent_lineage/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS execution_terms jsonb/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS risk_snapshot jsonb/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS immutability jsonb/);
  assert.match(migration, /immutable_terms_hash text CHECK/);
});
