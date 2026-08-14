import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const migrationPath = path.join(repoRoot, "infra/postgres/init/051_ai_context_gate_decisions.sql");
const migration = readFileSync(migrationPath, "utf8");
const policyPath = path.join(repoRoot, "docs/engineering/sql-migration-policy.json");
const migrationPolicy = readFileSync(policyPath, "utf8");

test("LOT-006 persists AI Context Gate decisions with closed recommendation and fallback enums", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_context_gate_decisions/);
  assert.match(migration, /recommendation text NOT NULL CHECK \(recommendation IN \('TAKE', 'TAKE_REDUCED', 'WAIT', 'REJECT'\)\)/);
  assert.match(migration, /risk_multiplier numeric NOT NULL CHECK \(risk_multiplier >= 0 AND risk_multiplier <= 1\)/);
  assert.match(migration, /AI_CONTEXT_MODEL_UNAVAILABLE/);
  assert.match(migration, /policy_version text NOT NULL/);
  assert.match(migration, /execution_hash text NOT NULL CHECK/);
});

test("LOT-006 SQL enforces no direct execution side effects from AI Context payloads", () => {
  assert.match(migration, /ai_context_gate_decisions_no_direct_execution/);
  assert.match(migration, /order_intents_created/);
  assert.match(migration, /human_confirmations_created/);
  assert.match(migration, /provider_commands_created/);
  assert.match(migration, /post_risk_mutations/);
  assert.match(migration, /broker_writes/);
});

test("LOT-006 records an auditable event stream for fallback, retry and enforcement blocks", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_context_gate_events/);
  assert.match(migration, /DECISION_RECORDED/);
  assert.match(migration, /FALLBACK_APPLIED/);
  assert.match(migration, /RETRY_PLANNED/);
  assert.match(migration, /ENFORCEMENT_BLOCKED/);
  assert.match(migration, /ai_context_gate_events_decision_time_idx/);
});

test("LOT-006 declares SQL ownership for AI Context migrations", () => {
  assert.match(migrationPolicy, /"owner": "ai-context"/);
  assert.match(migrationPolicy, /"\^ai_context_"/);
});
