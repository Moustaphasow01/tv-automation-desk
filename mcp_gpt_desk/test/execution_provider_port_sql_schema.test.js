import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const migrationPath = path.join(repoRoot, "infra/postgres/init/045_execution_provider_port.sql");
const policyPath = path.join(repoRoot, "docs/engineering/sql-migration-policy.json");
const migration = readFileSync(migrationPath, "utf8");
const policy = readFileSync(policyPath, "utf8");

test("TD2-900 creates provider-neutral command and event enums", () => {
  assert.match(migration, /CREATE TYPE execution_provider_command_type AS ENUM/);
  assert.match(migration, /'submit_order'/);
  assert.match(migration, /'sync_positions'/);
  assert.match(migration, /CREATE TYPE broker_provider_event_type AS ENUM/);
  assert.match(migration, /'order_accepted'/);
  assert.match(migration, /'order_partially_filled'/);
  assert.match(migration, /'provider_error'/);
});

test("TD2-900 stores commands without binding the domain to one broker adapter", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS broker_provider_commands/);
  assert.match(migration, /order_intent_id text REFERENCES trade_order_intents/);
  assert.match(migration, /broker_provider_code text NOT NULL REFERENCES broker_providers/);
  assert.match(migration, /command_type execution_provider_command_type NOT NULL/);
  assert.match(migration, /idempotency_key text NOT NULL UNIQUE/);
  assert.match(migration, /command_hash text NOT NULL CHECK/);
  assert.match(migration, /broker_provider_commands_poll_idx/);
});

test("TD2-900 stores normalized broker provider events with dedupe", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS broker_provider_events/);
  assert.match(migration, /external_event_key text NOT NULL UNIQUE/);
  assert.match(migration, /event_type broker_provider_event_type NOT NULL/);
  assert.match(migration, /payload_hash text NOT NULL CHECK/);
  assert.match(migration, /broker_provider_events_intent_time_idx/);
  assert.match(migration, /broker_provider_events_provider_ref_time_idx/);
});

test("TD2-900 keeps provider port tables inside the execution boundary", () => {
  assert.match(policy, /"owner": "execution"/);
  assert.match(policy, /"\^broker_"/);
  assert.match(policy, /"\^trade_"/);
});
