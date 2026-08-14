import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const migration = readFileSync(path.join(repoRoot, "infra/postgres/init/055_domain_assistant_runtime.sql"), "utf8");
const policy = readFileSync(path.join(repoRoot, "docs/engineering/sql-migration-policy.json"), "utf8");

test("TD2-419 creates durable assistant runtime tables", () => {
  for (const table of [
    "assistant_profiles",
    "assistant_conversations",
    "assistant_messages",
    "assistant_context_snapshots",
    "assistant_tasks",
    "assistant_task_leases",
    "assistant_answers",
    "assistant_task_dead_letters",
    "assistant_events",
    "assistant_outbox",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
});

test("TD2-419 assistant profiles are constrained read-only by SQL", () => {
  assert.match(migration, /assistant_profiles_read_only_default/);
  assert.match(migration, /can_confirm_human_gate/);
  assert.match(migration, /can_create_provider_command/);
  assert.match(migration, /can_activate_live/);
  assert.match(migration, /can_activate_auto_execution/);
});

test("TD2-419 assistant tasks model wake policy, leases, idempotence and DLQ", () => {
  assert.match(migration, /task_type text NOT NULL CHECK \(task_type IN \('QUESTION', 'PERIODIC_SNAPSHOT', 'EVENT_SUMMARY'\)\)/);
  assert.match(migration, /wake_type text NOT NULL CHECK \(wake_type IN \('ON_DEMAND', 'PERIODIC', 'EVENT_TRIGGERED'\)\)/);
  assert.match(migration, /idempotency_key text NOT NULL UNIQUE/);
  assert.match(migration, /assistant_task_leases/);
  assert.match(migration, /assistant_task_dead_letters/);
  assert.match(migration, /assistant_outbox/);
});

test("TD2-419 context snapshots are bounded instead of raw log dumps", () => {
  assert.match(migration, /max_messages integer NOT NULL DEFAULT 8 CHECK \(max_messages >= 0 AND max_messages <= 20\)/);
  assert.match(migration, /max_events integer NOT NULL DEFAULT 20 CHECK \(max_events >= 0 AND max_events <= 100\)/);
  assert.match(migration, /snapshot_hash text NOT NULL CHECK/);
});

test("TD2-419 assigns assistant tables to agents owner boundary", () => {
  assert.match(policy, /"owner": "agents"/);
  assert.match(policy, /"\^assistant_"/);
});
