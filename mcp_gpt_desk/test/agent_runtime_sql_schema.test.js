import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const migrationPath = path.join(repoRoot, "infra/postgres/init/037_agent_runtime_registry.sql");
const notificationMigrationPath = path.join(repoRoot, "infra/postgres/init/038_agent_runtime_notifications.sql");
const conversationAffinityMigrationPath = path.join(repoRoot, "infra/postgres/init/039_agent_conversation_affinity.sql");
const executionPolicyMigrationPath = path.join(repoRoot, "infra/postgres/init/040_agent_execution_policy_snapshots.sql");
const taskRecoveryMigrationPath = path.join(repoRoot, "infra/postgres/init/041_agent_task_recovery.sql");
const taskRunMetricsMigrationPath = path.join(repoRoot, "infra/postgres/init/042_agent_task_run_metrics.sql");
const policyPath = path.join(repoRoot, "docs/engineering/sql-migration-policy.json");

const migration = readFileSync(migrationPath, "utf8");
const notificationMigration = readFileSync(notificationMigrationPath, "utf8");
const conversationAffinityMigration = readFileSync(conversationAffinityMigrationPath, "utf8");
const executionPolicyMigration = readFileSync(executionPolicyMigrationPath, "utf8");
const taskRecoveryMigration = readFileSync(taskRecoveryMigrationPath, "utf8");
const taskRunMetricsMigration = readFileSync(taskRunMetricsMigrationPath, "utf8");
const policy = readFileSync(policyPath, "utf8");

test("TD2-400 creates durable Agent Mission Conversation Task Lease and Event tables", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS agents/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS agent_missions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS agent_conversations/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS agent_tasks/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS agent_task_leases/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS agent_events/);
});

test("TD2-400 models runtime state enums explicitly", () => {
  assert.match(migration, /CREATE TYPE agent_status AS ENUM \('IDLE', 'BUSY', 'OFFLINE', 'DISABLED'\)/);
  assert.match(migration, /CREATE TYPE agent_mission_status AS ENUM/);
  assert.match(migration, /'CREATED'/);
  assert.match(migration, /'IN_PROGRESS'/);
  assert.match(migration, /CREATE TYPE agent_task_status AS ENUM/);
  assert.match(migration, /'READY'/);
  assert.match(migration, /'CLAIMED'/);
  assert.match(migration, /'DONE'/);
  assert.match(migration, /CREATE TYPE agent_lease_status AS ENUM \('ACTIVE', 'EXPIRED', 'RELEASED', 'BROKEN'\)/);
});

test("TD2-400 links prompt composition and render snapshots without mutating prompt registry", () => {
  assert.match(migration, /prompt_composition_id uuid REFERENCES prompt_compositions/);
  assert.match(migration, /prompt_render_snapshot_id uuid REFERENCES prompt_render_snapshots/);
  assert.match(migration, /ON DELETE RESTRICT/);
  assert.match(migration, /ON DELETE SET NULL/);
});

test("TD2-400 supports idempotent claims and lease recovery", () => {
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS agent_tasks_idempotency_idx/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS agent_tasks_claim_idx/);
  assert.match(migration, /WHERE status IN \('PENDING', 'READY'\)/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS agent_tasks_lease_expiry_idx/);
  assert.match(migration, /UNIQUE \(agent_task_id, lease_token\)/);
  assert.match(migration, /agent_task_leases_active_expiry_idx/);
});

test("TD2-400 makes agent events auditable and append-only", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS agent_events/);
  assert.match(migration, /event_hash text NOT NULL/);
  assert.match(migration, /agent_events_hash_format/);
  assert.match(migration, /prevent_agent_event_mutation/);
  assert.match(migration, /AGENT_EVENT_APPEND_ONLY/);
  assert.match(migration, /agent_events_mission_timeline_idx/);
  assert.match(migration, /agent_events_task_timeline_idx/);
});

test("TD2-400 assigns SQL ownership to the agents module", () => {
  assert.match(policy, /"owner": "agents"/);
  assert.match(policy, /"\^agents\$"/);
  assert.match(policy, /"\^agent_missions\$"/);
  assert.match(policy, /"\^agent_tasks\$"/);
  assert.match(policy, /"\^agent_events\$"/);
});

test("TD2-401 notifies the generic supervisor when an agent task becomes ready", () => {
  assert.match(notificationMigration, /CREATE OR REPLACE FUNCTION notify_agent_runtime_work_ready/);
  assert.match(notificationMigration, /pg_notify\('desk_agent_runtime_ready'/);
  assert.match(notificationMigration, /'schema', 'desk_agent_runtime_ready_v1'/);
  assert.match(notificationMigration, /'lane', NEW\.lane/);
  assert.match(notificationMigration, /'task_id', NEW\.agent_task_id/);
  assert.match(notificationMigration, /AFTER INSERT OR UPDATE OF status, not_before_utc, lane ON agent_tasks/);
});

test("TD2-402 constrains one open conversation per mission provider affinity", () => {
  assert.match(conversationAffinityMigration, /agent_conversations_one_open_affinity_idx/);
  assert.match(conversationAffinityMigration, /agent_mission_id, provider, affinity_key/);
  assert.match(conversationAffinityMigration, /WHERE status = 'OPEN' AND affinity_key IS NOT NULL/);
  assert.match(conversationAffinityMigration, /agent_conversations_open_affinity_lookup_idx/);
});

test("TD2-403 snapshots execution policy and model routing decisions", () => {
  assert.match(executionPolicyMigration, /ALTER TYPE agent_event_type ADD VALUE IF NOT EXISTS 'EXECUTION_POLICY_RESOLVED'/);
  assert.match(executionPolicyMigration, /CREATE TABLE IF NOT EXISTS agent_execution_policy_snapshots/);
  assert.match(executionPolicyMigration, /agent_task_id uuid NOT NULL REFERENCES agent_tasks/);
  assert.match(executionPolicyMigration, /policy jsonb NOT NULL/);
  assert.match(executionPolicyMigration, /policy_hash text NOT NULL/);
  assert.match(executionPolicyMigration, /UNIQUE \(agent_task_id, policy_hash\)/);
  assert.match(executionPolicyMigration, /agent_execution_policy_snapshots_task_idx/);
  assert.match(policy, /"\^agent_execution_policy_snapshots\$"/);
});

test("TD2-404 persists agent dead letters and recovery events", () => {
  assert.match(taskRecoveryMigration, /CREATE TYPE agent_dead_letter_status AS ENUM \('OPEN', 'REQUEUED', 'CANCELLED', 'RESOLVED'\)/);
  assert.match(taskRecoveryMigration, /ALTER TYPE agent_event_type ADD VALUE IF NOT EXISTS 'TASK_DEAD_LETTERED'/);
  assert.match(taskRecoveryMigration, /ALTER TYPE agent_event_type ADD VALUE IF NOT EXISTS 'TASK_REQUEUED'/);
  assert.match(taskRecoveryMigration, /ALTER TYPE agent_event_type ADD VALUE IF NOT EXISTS 'TASK_CANCELLED'/);
  assert.match(taskRecoveryMigration, /CREATE TABLE IF NOT EXISTS agent_task_dead_letters/);
  assert.match(taskRecoveryMigration, /task_snapshot jsonb NOT NULL/);
  assert.match(taskRecoveryMigration, /UNIQUE \(agent_task_id, error_code, attempt_count\)/);
  assert.match(taskRecoveryMigration, /agent_task_dead_letters_open_idx/);
  assert.match(policy, /"\^agent_task_dead_letters\$"/);
});

test("TD2-405 persists agent runtime metrics by task", () => {
  assert.match(taskRunMetricsMigration, /CREATE TABLE IF NOT EXISTS agent_task_run_metrics/);
  assert.match(taskRunMetricsMigration, /agent_execution_policy_snapshot_id uuid REFERENCES agent_execution_policy_snapshots/);
  assert.match(taskRunMetricsMigration, /agent_task_dead_letter_id uuid REFERENCES agent_task_dead_letters/);
  assert.match(taskRunMetricsMigration, /queue_latency_ms integer/);
  assert.match(taskRunMetricsMigration, /cost_micros_usd bigint/);
  assert.match(taskRunMetricsMigration, /UNIQUE \(agent_task_id\)/);
  assert.match(taskRunMetricsMigration, /agent_task_run_metrics_lane_outcome_idx/);
  assert.match(policy, /"\^agent_task_run_metrics\$"/);
});
