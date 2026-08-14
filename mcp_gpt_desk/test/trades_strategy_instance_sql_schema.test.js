import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

const tradeBaseMigration = new URL("../../infra/postgres/init/003_trade_automation_schema.sql", import.meta.url);
const tradeLinkMigration = new URL("../../infra/postgres/init/024_trade_strategy_instance_link.sql", import.meta.url);

describe("trades.strategy_instance_id migration", () => {
  test("adds a nullable Strategy Instance FK without changing legacy strategy_id", async () => {
    const baseSql = await readFile(tradeBaseMigration, "utf8");
    const sql = await readFile(tradeLinkMigration, "utf8");

    assert.match(baseSql, /\bstrategy_id\s+text\b/i);
    assert.match(baseSql, /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+trades_scope_idx\s+ON\s+trades\s*\(\s*trading_date\s*,\s*session\s*,\s*strategy_id\s*\)/i);

    assert.match(sql, /ALTER\s+TABLE\s+trades\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+strategy_instance_id\s+uuid\s*;/i);
    assert.doesNotMatch(sql, /strategy_instance_id\s+uuid\s+NOT\s+NULL/i);
    assert.match(sql, /FOREIGN\s+KEY\s*\(\s*strategy_instance_id\s*\)\s+REFERENCES\s+strategy_instances\s*\(\s*strategy_instance_id\s*\)\s+ON\s+DELETE\s+SET\s+NULL/i);
    assert.match(sql, /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+trades_strategy_instance_idx\s+ON\s+trades\s*\(\s*strategy_instance_id\s*\)\s+WHERE\s+strategy_instance_id\s+IS\s+NOT\s+NULL/i);
  });

  test("does not backfill or remap strategy_instance_id from legacy strategy_id", async () => {
    const sql = await readFile(tradeLinkMigration, "utf8");
    const executableSql = sql.replace(/--.*$/gm, "");

    assert.doesNotMatch(executableSql, /\bUPDATE\s+trades\b/i);
    assert.doesNotMatch(executableSql, /\bINSERT\s+INTO\s+trades\b/i);
    assert.doesNotMatch(executableSql, /strategy_instance_id\s*=\s*strategy_id/i);
    assert.match(sql, /Do not backfill from legacy trades\.strategy_id/i);
  });
});
