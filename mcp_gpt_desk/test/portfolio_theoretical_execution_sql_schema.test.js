import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../infra/postgres/init/058_portfolio_order_intent_theoretical_execution.sql", import.meta.url),
  "utf8",
);

test("portfolio theoretical execution migration links VNext OrderIntent lineage", () => {
  assert.match(migration, /ALTER TABLE trade_theoretical_execution_events[\s\S]+ADD COLUMN IF NOT EXISTS portfolio_order_intent_id text/i);
  assert.match(migration, /REFERENCES portfolio_order_intent_lineage\(portfolio_order_intent_id\)/i);
  assert.match(migration, /ALTER TABLE trades[\s\S]+ADD COLUMN IF NOT EXISTS portfolio_order_intent_id text/i);
  assert.match(migration, /ALTER TABLE trades[\s\S]+ALTER COLUMN trade_decision_id DROP NOT NULL/i);
  assert.match(migration, /trade_theoretical_events_portfolio_intent_idx/i);
  assert.match(migration, /trades_portfolio_intent_idx/i);
});

test("manual execution events remain observational for VNext OrderIntent", () => {
  assert.match(migration, /ALTER TABLE trade_manual_execution_events[\s\S]+ADD COLUMN IF NOT EXISTS portfolio_order_intent_id text/i);
  assert.match(migration, /observational only and never authoritative for theoretical fills/i);
});
