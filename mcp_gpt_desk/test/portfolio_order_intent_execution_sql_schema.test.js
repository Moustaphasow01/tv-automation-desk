import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const migrationPath = path.join(repoRoot, "infra/postgres/init/049_execution_provider_portfolio_lineage.sql");
const migration = readFileSync(migrationPath, "utf8");

test("LOT-004 links provider commands to canonical Portfolio OrderIntent lineage", () => {
  assert.match(migration, /ALTER TABLE broker_provider_commands/);
  assert.match(migration, /portfolio_order_intent_id text REFERENCES portfolio_order_intent_lineage/);
  assert.match(migration, /broker_provider_commands_portfolio_intent_idx/);
});

test("LOT-004 links order-related broker events to canonical Portfolio OrderIntent lineage", () => {
  assert.match(migration, /ALTER TABLE broker_provider_events/);
  assert.match(migration, /portfolio_order_intent_id text REFERENCES portfolio_order_intent_lineage/);
  assert.match(migration, /broker_provider_events_portfolio_intent_time_idx/);
});

test("LOT-004 prevents order commands without a legacy or portfolio source while allowing sync commands", () => {
  assert.match(migration, /broker_provider_commands_order_intent_source_check/);
  assert.match(migration, /command_type IN \('sync_positions', 'sync_orders'\)/);
  assert.match(migration, /OR portfolio_order_intent_id IS NOT NULL/);
});

test("LOT-004 requires lineage for order lifecycle events without blocking provider heartbeats", () => {
  assert.match(migration, /broker_provider_events_order_intent_source_check/);
  assert.match(migration, /event_type NOT IN/);
  assert.match(migration, /'order_partially_filled'/);
  assert.match(migration, /OR portfolio_order_intent_id IS NOT NULL/);
});
