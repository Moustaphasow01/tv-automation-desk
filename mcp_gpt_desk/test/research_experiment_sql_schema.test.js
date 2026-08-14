import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const migrationPath = path.join(repoRoot, "infra/postgres/init/043_research_experiment_registry.sql");
const promotionGateMigrationPath = path.join(repoRoot, "infra/postgres/init/052_research_promotion_gate_reports.sql");
const policyPath = path.join(repoRoot, "docs/engineering/sql-migration-policy.json");
const contractPath = path.join(repoRoot, "docs/trading-desk-target-blueprint/contracts/06-experiment.md");
const docPath = path.join(repoRoot, "docs/engineering/research-experiment-registry-v1.md");

const migration = readFileSync(migrationPath, "utf8");
const promotionGateMigration = readFileSync(promotionGateMigrationPath, "utf8");
const policy = readFileSync(policyPath, "utf8");

test("TD2-500 creates Research Lab enum vocabulary", () => {
  assert.match(migration, /CREATE TYPE research_experiment_status AS ENUM/);
  assert.match(migration, /CREATE TYPE research_hypothesis_status AS ENUM/);
  assert.match(migration, /CREATE TYPE research_candidate_status AS ENUM/);
  assert.match(migration, /CREATE TYPE research_evaluation_verdict AS ENUM/);
  assert.match(migration, /'PROMOTION_READY'/);
  assert.match(migration, /'QUALITATIVE_REPLAY'/);
});

test("TD2-500 creates Experiment, Hypothesis, Candidate and Evaluation Report tables", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS research_experiments/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS research_hypotheses/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS research_candidates/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS research_evaluation_reports/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS research_experiment_run_links/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS research_audit_events/);
});

test("TD2-500 links Research Lab to SimulationRun and Strategy registries without replacing them", () => {
  assert.match(migration, /winner_simulation_run_id uuid REFERENCES simulation_runs\(simulation_run_id\) ON DELETE RESTRICT/);
  assert.match(migration, /simulation_run_id uuid NOT NULL REFERENCES simulation_runs\(simulation_run_id\) ON DELETE RESTRICT/);
  assert.match(migration, /strategy_definition_id uuid REFERENCES strategy_definitions\(strategy_definition_id\) ON DELETE SET NULL/);
  assert.match(migration, /strategy_version_id uuid REFERENCES strategy_versions\(strategy_version_id\) ON DELETE SET NULL/);
  assert.match(migration, /research_candidates_promotion_has_strategy_version/);
});

test("TD2-500 protects scores, immutable evaluation reports and terminal candidates", () => {
  assert.match(migration, /research_evaluation_reports_score_range CHECK \(score BETWEEN 0 AND 1\)/);
  assert.match(migration, /research_evaluation_reports_metrics_not_empty/);
  assert.match(migration, /prevent_research_evaluation_report_mutation/);
  assert.match(migration, /RESEARCH_EVALUATION_REPORT_IMMUTABLE/);
  assert.match(migration, /prevent_terminal_research_candidate_mutation/);
  assert.match(migration, /TERMINAL_RESEARCH_CANDIDATE_IMMUTABLE/);
});

test("TD2-500 registers research table ownership and documentation", () => {
  const contract = readFileSync(contractPath, "utf8");
  const doc = readFileSync(docPath, "utf8");

  assert.match(policy, /"owner": "research"/);
  assert.match(policy, /"\^research_"/);
  assert.match(contract, /ResearchHypothesis/);
  assert.match(contract, /ResearchEvaluationReport/);
  assert.match(doc, /TD2-500/);
  assert.match(doc, /Experiment Registry/);
});

test("TD2-504 extends Research Evaluation reports with portfolio fit and promotion matrix evidence", () => {
  assert.match(promotionGateMigration, /ADD VALUE IF NOT EXISTS 'PORTFOLIO_FIT'/);
  assert.match(promotionGateMigration, /ADD VALUE IF NOT EXISTS 'PROMOTION_MATRIX'/);
});
