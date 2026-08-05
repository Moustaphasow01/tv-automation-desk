import assert from "node:assert/strict";
import test from "node:test";

import {
  PostgresDeskPersistence,
  postgresPoolOptions,
} from "../src/persistence/postgres-desk-persistence.js";

test("public runtime schema validation never executes DDL", async () => {
  const statements = [];
  const pool = {
    async query(statement) {
      statements.push(String(statement));
      return {
        rows: [{
          desk_documents: "desk_documents",
          desk_pack_objects: "desk_pack_objects",
          news_sources: "news_sources",
          news_articles: "news_articles",
          news_ingestion_runs: "news_ingestion_runs",
          trade_outcomes: "trade_outcomes",
          desk_maintenance_runs: "desk_maintenance_runs",
          desk_deployment_runs: "desk_deployment_runs",
        }],
      };
    },
  };
  const persistence = new PostgresDeskPersistence({ pool, schemaMode: "validate" });

  await persistence.initialized;

  assert.equal(statements.length, 1);
  assert.match(statements[0], /to_regclass/);
  assert.doesNotMatch(statements[0], /\bCREATE\b/i);
});

test("public runtime schema validation fails closed when migrations are missing", async () => {
  const pool = {
    async query() {
      return {
        rows: [{
          desk_documents: "desk_documents",
          desk_pack_objects: null,
          news_sources: "news_sources",
          news_articles: "news_articles",
          news_ingestion_runs: "news_ingestion_runs",
          trade_outcomes: "trade_outcomes",
          desk_maintenance_runs: "desk_maintenance_runs",
          desk_deployment_runs: "desk_deployment_runs",
        }],
      };
    },
  };
  const persistence = new PostgresDeskPersistence({ pool, schemaMode: "validate" });

  await assert.rejects(
    persistence.initialized,
    (error) => error?.code === "POSTGRES_SCHEMA_NOT_READY",
  );
});

test("market candle query applies an optional exact feed_id filter", async () => {
  let marketQuery = null;
  const pool = {
    async query(statement, values) {
      if (String(statement).includes("to_regclass")) {
        return { rows: [{
          desk_documents: "desk_documents", desk_pack_objects: "desk_pack_objects",
          news_sources: "news_sources", news_articles: "news_articles",
          news_ingestion_runs: "news_ingestion_runs", trade_outcomes: "trade_outcomes",
          desk_maintenance_runs: "desk_maintenance_runs", desk_deployment_runs: "desk_deployment_runs",
        }] };
      }
      marketQuery = { statement: String(statement), values };
      return { rows: [] };
    },
  };
  const persistence = new PostgresDeskPersistence({ pool, schemaMode: "validate" });
  await persistence.queryMarketCandles({
    symbolCodes: ["MNQ1!", "MNQ"],
    feedIds: ["prod__tradingview__MNQ1!__1"],
    timeframe: "1",
    fromUtc: "2026-07-20T09:00:00.000Z",
    toUtc: "2026-07-20T10:00:00.000Z",
  });

  assert.equal(marketQuery.statement.includes("feed_id = ANY($6::text[])"), true);
  assert.deepEqual(marketQuery.values[5], ["prod__tradingview__MNQ1!__1"]);
  assert.equal(marketQuery.values[6], 50_000);
});

test("postgres pool options enforce finite operational deadlines", () => {
  const options = postgresPoolOptions({
    connectionString: "postgresql://desk:test@localhost/desk",
  }, {
    DESK_DATABASE_POOL_SIZE: "12",
    DESK_DATABASE_CONNECTION_TIMEOUT_MS: "2500",
    DESK_DATABASE_QUERY_TIMEOUT_MS: "18000",
    DESK_DATABASE_STATEMENT_TIMEOUT_MS: "17000",
    DESK_DATABASE_LOCK_TIMEOUT_MS: "2500",
    DESK_DATABASE_IDLE_TRANSACTION_TIMEOUT_MS: "22000",
    DESK_DATABASE_APPLICATION_NAME: "desk-test",
  });

  assert.equal(options.max, 12);
  assert.equal(options.connectionTimeoutMillis, 2500);
  assert.equal(options.query_timeout, 18000);
  assert.equal(options.statement_timeout, 17000);
  assert.equal(options.lock_timeout, 2500);
  assert.equal(options.idle_in_transaction_session_timeout, 22000);
  assert.equal(options.application_name, "desk-test");
});
