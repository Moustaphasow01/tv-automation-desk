import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../../infra/postgres/init/047_manual_and_theoretical_execution.sql", import.meta.url);

test("manual and theoretical execution schema keeps operator acknowledgements separate from theoretical fills", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /CREATE TYPE theoretical_execution_event_type AS ENUM/);
  assert.match(sql, /'entry_filled'/);
  assert.match(sql, /'entry_expired'/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS trade_theoretical_execution_events/);
  assert.match(sql, /source_candle_feed_id text/);
  assert.match(sql, /source_candle_timestamp_utc timestamptz/);
  assert.match(sql, /COMMENT ON TABLE trade_theoretical_execution_events IS\s+'Deterministic backend-only paper execution events\. A Telegram\/front alert never implies fill; order type and closed OHLC candles drive fills\.'/);

  assert.match(sql, /CREATE TYPE manual_execution_event_type AS ENUM/);
  assert.match(sql, /'placed'/);
  assert.match(sql, /'filled'/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS trade_manual_execution_events/);
  assert.match(sql, /management_intent_id text REFERENCES trade_management_intents/);
  assert.match(sql, /COMMENT ON TABLE trade_manual_execution_events IS\s+'Operator execution acknowledgements from front or Telegram\. This ledger is observational and does not mutate theoretical fills\.'/);
});
