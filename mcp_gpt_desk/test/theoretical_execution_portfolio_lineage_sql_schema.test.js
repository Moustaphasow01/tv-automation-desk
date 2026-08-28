import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const migration = readFileSync(
  path.join(repoRoot, "infra/postgres/init/058_theoretical_execution_portfolio_lineage.sql"),
  "utf8",
);
const migrationRunner = readFileSync(
  path.join(repoRoot, "deploy/windows/database/Invoke-DeskSchema.ps1"),
  "utf8",
);
const contractVerifier = readFileSync(
  path.join(repoRoot, "deploy/windows/database/Test-DeskTheoreticalExecutionPortfolioLineage.ps1"),
  "utf8",
);

const lineageTables = [
  "trades",
  "trade_theoretical_execution_events",
  "trade_manual_execution_events",
];

test("migration 058 declares canonical Portfolio OrderIntent lineage for all theoretical execution ledgers", () => {
  for (const table of lineageTables) {
    assert.match(migration, new RegExp(`ALTER TABLE ${table}`));
  }
  assert.equal(
    migration.match(/ADD COLUMN IF NOT EXISTS portfolio_order_intent_id text/g)?.length,
    3,
  );
  assert.equal(
    migration.match(/REFERENCES portfolio_order_intent_lineage\(portfolio_order_intent_id\) ON DELETE SET NULL/g)?.length,
    3,
  );
  assert.match(migration, /trades_portfolio_order_intent_idx/);
  assert.match(migration, /theoretical_execution_events_portfolio_intent_idx/);
  assert.match(migration, /manual_execution_events_portfolio_intent_idx/);
});

test("the deployment migration runner verifies migration 058 against the real PostgreSQL catalog", () => {
  assert.match(migrationRunner, /Test-DeskTheoreticalExecutionPortfolioLineage\.ps1/);
  assert.match(contractVerifier, /desk_schema_migrations/);
  assert.match(contractVerifier, /content_sha256 = '__EXPECTED_CHECKSUM__'/);
  assert.match(contractVerifier, /FROM pg_attribute/);
  assert.match(contractVerifier, /FROM pg_constraint/);
  assert.match(contractVerifier, /confdeltype = 'n'/);
  assert.match(contractVerifier, /JOIN pg_index/);
  assert.match(contractVerifier, /index_catalog\.indisvalid/);
  assert.match(contractVerifier, /pg_get_expr\(index_catalog\.indpred/);
  assert.match(contractVerifier, /columns_verified', 3/);
  assert.match(contractVerifier, /foreign_keys_verified', 3/);
  assert.match(contractVerifier, /indexes_verified', 3/);
});
