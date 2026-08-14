import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const migrationPath = path.join(repoRoot, "infra/postgres/init/028_market_calendar_session_rollover.sql");
const engineeringDocPath = path.join(repoRoot, "docs/engineering/market-calendar-session-rollover.md");

const migration = readFileSync(migrationPath, "utf8");

test("TD2-203 declares canonical market calendar, day, session and rollover tables", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS market_calendars/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS market_calendar_days/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS market_session_templates/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS market_session_occurrences/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS market_futures_rollovers/);
});

test("TD2-203 stores both local and UTC session boundaries with ordered windows", () => {
  assert.match(migration, /start_at_utc timestamptz NOT NULL/);
  assert.match(migration, /end_at_utc timestamptz NOT NULL/);
  assert.match(migration, /start_local text NOT NULL/);
  assert.match(migration, /end_local text NOT NULL/);
  assert.match(migration, /CONSTRAINT market_session_occurrences_window_order CHECK \(end_at_utc > start_at_utc\)/);
  assert.match(migration, /UNIQUE \(market_calendar_day_id, session_key\)/);
});

test("TD2-203 models futures rollover without overloading market symbols", () => {
  assert.match(migration, /root_symbol text NOT NULL/);
  assert.match(migration, /from_contract_symbol text NOT NULL/);
  assert.match(migration, /to_contract_symbol text NOT NULL/);
  assert.match(migration, /method market_rollover_method NOT NULL/);
  assert.match(migration, /CONSTRAINT market_futures_rollovers_contracts_differ CHECK \(from_contract_symbol <> to_contract_symbol\)/);
});

test("TD2-203 documents the current non-invasive boundary", () => {
  const engineeringDoc = readFileSync(engineeringDocPath, "utf8");

  assert.match(engineeringDoc, /TD2-203/);
  assert.match(engineeringDoc, /ne remplace pas encore/);
  assert.match(engineeringDoc, /market_session_occurrences/);
  assert.match(engineeringDoc, /market_futures_rollovers/);
});
