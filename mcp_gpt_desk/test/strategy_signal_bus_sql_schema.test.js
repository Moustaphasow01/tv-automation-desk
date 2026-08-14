import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const migrationPath = path.join(repoRoot, "infra/postgres/init/044_strategy_signal_bus.sql");
const policyPath = path.join(repoRoot, "docs/engineering/sql-migration-policy.json");
const contractPath = path.join(repoRoot, "docs/trading-desk-target-blueprint/contracts/14-signal.md");

const migration = readFileSync(migrationPath, "utf8");
const policy = readFileSync(policyPath, "utf8");

test("TD2-601 creates a durable Strategy Signal outbox", () => {
  assert.match(migration, /CREATE TYPE strategy_signal_outbox_status AS ENUM/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS strategy_signal_outbox/);
  assert.match(migration, /signal_id uuid NOT NULL/);
  assert.match(migration, /strategy_instance_id uuid NOT NULL REFERENCES strategy_instances/);
  assert.match(migration, /direction text NOT NULL CHECK \(direction IN \('LONG', 'SHORT', 'FLAT'\)\)/);
  assert.match(migration, /execution_mode_origin strategy_instance_execution_mode NOT NULL/);
});

test("TD2-601 enforces dedupe and validity windows before downstream consumption", () => {
  assert.match(migration, /dedupe_key text NOT NULL UNIQUE/);
  assert.match(migration, /payload_hash text NOT NULL/);
  assert.match(migration, /CHECK \(expires_at_utc > generated_at_utc\)/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS strategy_signal_outbox_poll_idx/);
  assert.match(migration, /WHERE status = 'pending'/);
});

test("TD2-601 emits LISTEN NOTIFY while preserving polling as fallback", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION notify_strategy_signal_outbox_ready/);
  assert.match(migration, /pg_notify\('desk_strategy_signal_ready'/);
  assert.match(migration, /'signal_outbox_id', NEW\.signal_outbox_id/);
  assert.match(migration, /notify_attempt_count = notify_attempt_count \+ 1/);
  assert.match(migration, /CREATE TRIGGER strategy_signal_outbox_notify_ready_trg/);
});

test("TD2-601 keeps signal bus tables in the strategy boundary and documents the contract", () => {
  const contract = readFileSync(contractPath, "utf8");

  assert.match(policy, /"owner": "strategy"/);
  assert.match(policy, /"\^strategy_"/);
  assert.match(contract, /Standardized Signal Bus/);
  assert.match(contract, /strategy_signal_outbox/);
  assert.match(contract, /desk_strategy_signal_ready/);
});
