import assert from "node:assert/strict";
import test from "node:test";
import { PostgresStrategySignalBusRepository } from "../src/strategy-signal-bus-repository.js";
import { createGrainsReplayDatabase, seedGrainsReplayInputs } from "../src/adapters/grains-causal-postgres-replay.js";

const AS_OF = "2026-09-04T14:03:00.000Z";

test("frozen grains replay seeds a real isolated PostgreSQL runtime and publishes shadow-only", {
  skip: process.env.RUN_POSTGRES_TESTS !== "1",
}, async (t) => {
  const database = await createGrainsReplayDatabase();
  t.after(() => database.close());
  await assert.rejects(
    () => seedGrainsReplayInputs(database.pool, conflictingInput()),
    (error) => error.code === "REPLAY_FROZEN_CANDLE_CONFLICT" && error.details.fields.includes("close"),
  );
  const input = frozenInput();
  const seeded = await seedGrainsReplayInputs(database.pool, input);

  assert.equal(typeof database.persistence.getDocument, "function");
  assert.equal(await count(database.pool, "market_candles"), 3);
  assert.equal(seeded.imported_candle_count, 4);
  const candles = await storedCandles(database.pool);
  assert.deepEqual(candles.map(({ imported_at, ...candle }) => candle), [
    stored("prod__tradingview__ZC1!__1", "2026-09-04T14:00:00.000Z", 450, 451, 449, 450.5, 17, true, input.candles[0]),
    stored("prod__tradingview__ZC1!__1", "2026-09-04T14:01:00.000Z", 451, 452, 450, 451.5, null, false, input.candles[2]),
    stored("prod__tradingview__ZC1!__5", "2026-09-04T14:00:00.000Z", 450, 451, 449, 450.5, 17, true, input.candles[3]),
  ]);
  assert.deepEqual(candles[0].receipt_provenance, { source_imported_at: null, historical_receipt: "UNKNOWN" });
  assert.deepEqual(candles[1].receipt_provenance, { source_imported_at: null, historical_receipt: "UNKNOWN" });
  assert.ok(Date.parse(candles[0].imported_at) > Date.parse(candles[0].timestamp_utc));
  assert.ok(Date.parse(candles[1].imported_at) > Date.parse(candles[1].timestamp_utc));
  assert.equal(candles[2].imported_at, "2026-09-04T14:00:12.000Z");
  assert.deepEqual(candles[2].receipt_provenance, {
    source_imported_at: "2026-09-04T14:00:12.000Z", historical_receipt: "SOURCE_PROVIDED",
  });
  assert.deepEqual(seeded.market_feed_mapping, [
    { source_feed_id: "prod__tradingview__ZC1!__1", seeded_feed_id: "prod__tradingview__ZC1!__1", symbol_code: "ZC1!", instrument: "ZC", timeframe: "1" },
    { source_feed_id: "prod__tradingview__ZC1!__5", seeded_feed_id: "prod__tradingview__ZC1!__5", symbol_code: "ZC1!", instrument: "ZC", timeframe: "5" },
  ]);
  const version = await database.pool.query("SELECT dsl_source_hash, compiled_artifact_hash, metadata FROM strategy_versions");
  assert.match(version.rows[0].dsl_source_hash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(version.rows[0].compiled_artifact_hash, null);
  assert.deepEqual(version.rows[0].metadata.provenance, { frozen_ledger_hash: "sha256:ledger-fixture" });

  const signal = seeded.runtime_signals[0];
  assert.deepEqual(signal.seed_identity_mapping, {
    signal_id: { source_id: "frozen-zc-signal-001", seeded_id: signal.signal_id, provenance: "stable_uuid_from_non_uuid_source" },
    strategy_definition_id: { source_id: "us-grains-causal-v2", seeded_id: signal.strategy_definition_id, provenance: "stable_uuid_from_non_uuid_source" },
    strategy_version_id: { source_id: "frozen-2026-09-04", seeded_id: signal.strategy_version_id, provenance: "stable_uuid_from_non_uuid_source" },
    strategy_instance_id: { source_id: "shadow-zc-main", seeded_id: signal.strategy_instance_id, provenance: "stable_uuid_from_non_uuid_source" },
  });
  const repository = new PostgresStrategySignalBusRepository(database.persistence);
  const published = await repository.publish(publishable(signal));
  assert.equal(published.signal_id, signal.signal_id);
  assert.equal(published.execution_mode_origin, "SHADOW");
  assert.equal(await count(database.pool, "strategy_signal_outbox"), 1);
  assert.equal(await count(database.pool, "broker_provider_commands"), 0);
});

test("replay seed rejects an unmapped market feed rather than inventing a replacement", async () => {
  await assert.rejects(
    () => seedGrainsReplayInputs({ query: async () => {} }, {
      asOfUtc: AS_OF,
      candles: [{ feed_id: "unproven-feed", timestamp_utc: AS_OF, open: 1, high: 1, low: 1, close: 1 }],
    }),
    (error) => error.code === "REPLAY_FEED_MAPPING_REQUIRED",
  );
});

test("replay database creation rejects non-loopback hosts before connecting", async () => {
  await assert.rejects(
    () => createGrainsReplayDatabase({ host: "postgres.internal.example" }),
    (error) => error.code === "REPLAY_DATABASE_HOST_FORBIDDEN",
  );
});

test("replay seed preserves canonical strategy UUIDs for live-parity fixtures", async () => {
  const canonical = {
    signal_id: "00000000-0000-4000-8000-000000000001",
    strategy_definition_id: "00000000-0000-4000-8000-000000000002",
    strategy_version_id: "00000000-0000-4000-8000-000000000003",
    strategy_instance_id: "00000000-0000-4000-8000-000000000004",
  };
  const seeded = await seedGrainsReplayInputs({ query: async () => ({ rows: [] }) }, {
    asOfUtc: AS_OF,
    signals: [{ ...canonical, instrument: "ZC", generated_at_utc: "2026-09-04T14:00:00Z", expires_at_utc: "2026-09-04T14:05:00Z" }],
  });
  assert.deepEqual(
    Object.fromEntries(Object.keys(canonical).map((field) => [field, seeded.runtime_signals[0][field]])),
    canonical,
  );
  assert.deepEqual(seeded.runtime_signals[0].seed_identity_mapping, {});
});

function frozenInput() {
  return {
    asOfUtc: AS_OF,
    seedConfig: { replay_kind: "frozen-grains-causal", window: "2026-09-04" },
    provenance: { frozen_ledger_hash: "sha256:ledger-fixture" },
    candles: [
      candle("prod__tradingview__ZC1!__1", "2026-09-04T14:00:00.000Z"),
      candle("prod__tradingview__ZC1!__1", "2026-09-04T14:00:00.000Z"),
      candle("prod__tradingview__ZC1!__1", "2026-09-04T14:01:00.000Z", { open: 451, high: 452, low: 450, close: 451.5, volume: null, is_closed: false }),
      candle("prod__tradingview__ZC1!__5", "2026-09-04T14:00:00.000Z", { imported_at: "2026-09-04T14:00:12.000Z" }),
    ],
    signals: [{
      signal_id: "frozen-zc-signal-001",
      strategy_definition_id: "us-grains-causal-v2",
      strategy_version_id: "frozen-2026-09-04",
      strategy_instance_id: "shadow-zc-main",
      instrument: "ZC",
      direction: "LONG",
      confidence: 0.71,
      generated_at_utc: "2026-09-04T14:01:00.000Z",
      expires_at_utc: "2026-09-04T14:06:00.000Z",
      payload: { frozen: true },
    }],
  };
}

function conflictingInput() {
  return {
    asOfUtc: AS_OF,
    candles: [
      candle("prod__tradingview__ZC1!__1", "2026-09-04T14:00:00.000Z"),
      candle("prod__tradingview__ZC1!__1", "2026-09-04T14:00:00.000Z", { open: 999, high: 1001, low: 998, close: 1000, volume: 99, is_closed: false }),
    ],
  };
}

function candle(feed_id, timestamp_utc, overrides = {}) {
  return { feed_id, timestamp_utc, open: 450, high: 451, low: 449, close: 450.5, volume: 17, is_closed: true, ...overrides };
}

function publishable(signal) {
  return {
    require_running_instance: true,
    signal_outbox_id: signal.signal_id,
    signal_id: signal.signal_id,
    strategy_instance_id: signal.strategy_instance_id,
    strategy_version_id: signal.strategy_version_id,
    strategy_definition_id: signal.strategy_definition_id,
    instrument: signal.instrument,
    direction: signal.direction,
    confidence: signal.confidence,
    execution_mode_origin: "SHADOW",
    generated_at_utc: signal.generated_at_utc,
    expires_at_utc: signal.expires_at_utc,
    correlation_id: signal.source_signal_id,
    payload: signal.payload,
    payload_hash: "sha256:fixture",
    dedupe_key: `frozen-replay:${signal.signal_id}`,
    status: "PENDING",
    source_class: "SHADOW",
  };
}

async function count(pool, table) {
  return Number((await pool.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count);
}

async function storedCandles(pool) {
  const result = await pool.query(`SELECT feed_id,
    to_char(timestamp_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS timestamp_utc,
    symbol_code,timeframe,trading_date,open,high,low,close,volume,is_closed,
    to_char(imported_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS imported_at,
    raw->'frozen_replay_source' AS source,
    raw->'replay_receipt_provenance' AS receipt_provenance
    FROM market_candles ORDER BY feed_id,timestamp_utc`);
  return result.rows;
}

function stored(feed_id, timestamp_utc, open, high, low, close, volume, is_closed, source) {
  return { feed_id, timestamp_utc, symbol_code: "ZC1!", timeframe: feed_id.endsWith("__1") ? "1" : "5",
    trading_date: "2026-09-04", open, high, low, close, volume, is_closed, source,
    receipt_provenance: source.imported_at
      ? { source_imported_at: source.imported_at, historical_receipt: "SOURCE_PROVIDED" }
      : { source_imported_at: null, historical_receipt: "UNKNOWN" } };
}
