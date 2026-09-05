import pg from "pg";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalSha256 } from "@tv-automation/desk-domain";
import { PostgresDeskPersistence } from "../persistence/postgres-desk-persistence.js";

const { Client, Pool } = pg;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const REPLAY_SCHEMA = "grains_causal_postgres_seed_v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANDLE_BATCH_SIZE = 500;
const INSERT_FROZEN_CANDLES_SQL = `WITH input_rows AS (
  SELECT * FROM jsonb_to_recordset($1::jsonb) AS row(
    source_order integer, feed_id text, timestamp_utc timestamptz, symbol_code text,
    timeframe text, trading_date text, open double precision, high double precision,
    low double precision, close double precision, volume double precision, is_closed boolean,
    imported_at timestamptz, raw jsonb
  )
), first_source_rows AS (
  SELECT DISTINCT ON (feed_id, timestamp_utc) *
  FROM input_rows
  ORDER BY feed_id, timestamp_utc, source_order
)
INSERT INTO market_candles(
  feed_id,timestamp_utc,symbol_code,timeframe,trading_date,open,high,low,close,volume,is_closed,imported_at,updated_at,raw
)
SELECT feed_id,timestamp_utc,symbol_code,timeframe,trading_date,open,high,low,close,volume,is_closed,
       COALESCE(imported_at, now()),COALESCE(imported_at, now()),raw
FROM first_source_rows
ON CONFLICT(feed_id,timestamp_utc) DO NOTHING`;

// This adapter creates a disposable, loopback-only database; it never reads DATABASE_URL.
export async function createGrainsReplayDatabase(options = {}) {
  const config = localReplayConfig(options);
  const admin = new Client(config);
  await admin.connect();
  const database = `desk_grains_replay_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE "${database}"`);
  const pool = new Pool({ ...config, database, max: 8 });
  try {
    await runSchema(pool);
    const persistence = new PostgresDeskPersistence({
      pool,
      schemaMode: "validate",
      objectRoot: options.objectRoot || resolve("./local_data/replay-objects", database),
    });
    await persistence.initialized;
    return { database, pool, persistence, close: () => closeReplay({ pool, admin, database }) };
  } catch (error) {
    try {
      await closeReplay({ pool, admin, database });
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], "REPLAY_DATABASE_SETUP_AND_CLEANUP_FAILED");
    }
    throw error;
  }
}

export async function seedGrainsReplayInputs(pool, input = {}) {
  const asOfUtc = requiredUtc(input.asOfUtc, "asOfUtc");
  const market = await seedMarket(pool, input.candles || []);
  const kernel = await seedKernel(pool, input.signals || [], {
    asOfUtc,
    seedConfig: input.seedConfig || {},
    provenance: input.provenance || {},
  });
  return { schema_version: REPLAY_SCHEMA, as_of_utc: asOfUtc, ...market, ...kernel };
}

function localReplayConfig(options) {
  const host = String(options.host || "127.0.0.1").trim().toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) throw replayError("REPLAY_DATABASE_HOST_FORBIDDEN", { host });
  if (options.adminDatabase && options.adminDatabase !== "postgres") {
    throw replayError("REPLAY_ADMIN_DATABASE_FORBIDDEN", { admin_database: options.adminDatabase });
  }
  return {
    host,
    port: Number(options.port || 5432),
    user: options.user || "desk",
    password: options.password || "desk_local_only",
    database: "postgres",
    connectionTimeoutMillis: 5000,
  };
}

async function runSchema(pool) {
  const root = resolve(fileURLToPath(new URL("../../../infra/postgres/init/", import.meta.url)));
  const files = (await readdir(root)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) await pool.query(await readFile(resolve(root, name), "utf8"));
}

async function closeReplay({ pool, admin, database }) {
  const failures = [];
  await pool.end().catch((error) => failures.push({ operation: "pool_end", error }));
  await admin.query(`DROP DATABASE IF EXISTS "${database}"`).catch((error) => failures.push({ operation: "drop_isolated_database", error }));
  await admin.end().catch((error) => failures.push({ operation: "admin_end", error }));
  if (failures.length) throw cleanupError(database, failures);
}

async function seedMarket(pool, candles) {
  const feeds = new Map();
  const canonical = new Map();
  const sources = [];
  for (const candle of candles) {
    const source = normalizeFrozenCandle(candle);
    assertNoFrozenCandleConflict(canonical, source);
    if (!feeds.has(source.feed_id)) feeds.set(source.feed_id, source);
    sources.push(source);
  }
  for (const source of feeds.values()) await seedFeed(pool, source);
  await insertFrozenCandleBatches(pool, sources);
  return {
    imported_candle_count: candles.length,
    market_feed_mapping: [...feeds.values()].map(({ feed_id, symbol_code, instrument, timeframe }) => ({
      source_feed_id: feed_id, seeded_feed_id: feed_id, symbol_code, instrument, timeframe,
    })),
  };
}

function assertNoFrozenCandleConflict(canonical, source) {
  const key = `${source.feed_id}\u0000${source.timestamp_utc}`;
  const prior = canonical.get(key);
  if (!prior) {
    canonical.set(key, source);
    return;
  }
  const fields = ["open", "high", "low", "close", "volume", "is_closed"];
  const conflicts = fields.filter((field) => !Object.is(prior[field], source[field]));
  if (conflicts.length) throw replayError("REPLAY_FROZEN_CANDLE_CONFLICT", {
    feed_id: source.feed_id, timestamp_utc: source.timestamp_utc, fields: conflicts,
  });
}

function normalizeFrozenCandle(row) {
  const parsed = parseSourceFeed(row?.feed_id);
  const timestamp = requiredUtc(row?.timestamp_utc, "candle.timestamp_utc");
  const instrument = requiredInstrument(row?.instrument || parsed.instrument);
  if (instrument !== parsed.instrument) throw replayError("REPLAY_FEED_INSTRUMENT_MISMATCH", { feed_id: row.feed_id, instrument });
  const prices = ["open", "high", "low", "close"].map((field) => requiredNumber(row?.[field], `candle.${field}`));
  if (prices[1] < Math.max(prices[0], prices[3]) || prices[2] > Math.min(prices[0], prices[3]) || prices[1] < prices[2]) {
    throw replayError("REPLAY_CANDLE_OHLC_INVALID", { feed_id: row.feed_id, timestamp_utc: timestamp });
  }
  const sourceImportedAt = optionalUtc(row?.imported_at || row?.imported_at_utc);
  return {
    feed_id: parsed.feed_id, symbol_code: parsed.symbol_code, timeframe: parsed.timeframe, instrument,
    timestamp_utc: timestamp, trading_date: String(row?.trading_date || timestamp.slice(0, 10)),
    imported_at: sourceImportedAt,
    open: prices[0], high: prices[1], low: prices[2], close: prices[3], volume: optionalNumber(row?.volume),
    is_closed: row?.is_closed !== false,
    raw: {
      ...(row?.raw || {}),
      frozen_replay_source: row,
      replay_receipt_provenance: {
        source_imported_at: sourceImportedAt,
        historical_receipt: sourceImportedAt ? "SOURCE_PROVIDED" : "UNKNOWN",
      },
    },
  };
}

function parseSourceFeed(value) {
  const feed_id = String(value || "").trim();
  const match = feed_id.match(/^(?:prod|preprod|local|replay|backtest|test)__tradingview__(.+)__(1|5)$/i);
  if (!match) throw replayError("REPLAY_FEED_MAPPING_REQUIRED", { feed_id: value || null });
  const symbol_code = match[1].split(":").at(-1).toUpperCase();
  const instrument = symbol_code.replace(/[0-9]+!$/, "");
  if (!instrument) throw replayError("REPLAY_FEED_MAPPING_REQUIRED", { feed_id });
  return { feed_id, symbol_code, instrument, timeframe: match[2] };
}

async function seedFeed(pool, source) {
  const symbolId = `frozen-tv-${hash(source.feed_id).slice(0, 24)}`;
  await pool.query(`INSERT INTO market_instruments(instrument_code,display_name,asset_class,metadata)
    VALUES($1,$2,'commodity',$3::jsonb) ON CONFLICT (instrument_code) DO NOTHING`, [
    source.instrument, `Frozen replay ${source.instrument}`, JSON.stringify({ frozen_replay: true }),
  ]);
  await pool.query(`INSERT INTO market_symbols(symbol_id,instrument_code,provider,symbol_code,metadata)
    VALUES($1,$2,'tradingview',$3,$4::jsonb) ON CONFLICT (provider,symbol_code) DO NOTHING`, [
    symbolId, source.instrument, source.symbol_code, JSON.stringify({ source_feed_id: source.feed_id }),
  ]);
  const symbol = await pool.query("SELECT symbol_id FROM market_symbols WHERE provider='tradingview' AND symbol_code=$1", [source.symbol_code]);
  await pool.query(`INSERT INTO market_feeds(feed_id,symbol_id,instrument_code,timeframe,environment,provider,metadata,raw)
    VALUES($1,$2,$3,$4,'replay','tradingview',$5::jsonb,$6::jsonb) ON CONFLICT (feed_id) DO NOTHING`, [
    source.feed_id, symbol.rows[0].symbol_id, source.instrument, source.timeframe,
    JSON.stringify({ frozen_replay: true, source_feed_id: source.feed_id }),
    JSON.stringify({ frozen_replay: true, source_feed_id: source.feed_id }),
  ]);
}

async function insertFrozenCandleBatches(pool, sources) {
  for (let start = 0; start < sources.length; start += CANDLE_BATCH_SIZE) {
    const batch = sources.slice(start, start + CANDLE_BATCH_SIZE)
      .map((source, index) => ({ source_order: start + index, ...source }));
    await pool.query(INSERT_FROZEN_CANDLES_SQL, [JSON.stringify(batch)]);
  }
}

async function seedKernel(pool, signals, input) {
  const runtime_signals = signals.map((signal) => normalizeSignal(signal, input.asOfUtc));
  for (const signal of runtime_signals) await seedSignalKernel(pool, signal, input);
  return { imported_signal_count: runtime_signals.length, runtime_signals };
}

function normalizeSignal(signal, asOfUtc) {
  const sourceId = requiredText(signal?.signal_id, "signal.signal_id");
  const sourceDefinition = requiredText(signal?.strategy_definition_id || signal?.strategy_id, "signal.strategy_definition_id");
  const sourceVersion = requiredText(signal?.strategy_version_id || "frozen-v1", "signal.strategy_version_id");
  const sourceInstance = requiredText(signal?.strategy_instance_id || `${sourceDefinition}:shadow`, "signal.strategy_instance_id");
  const identities = {
    signal_id: seededUuid(sourceId, "signal"),
    strategy_definition_id: seededUuid(sourceDefinition, "definition"),
    strategy_version_id: seededUuid(sourceVersion, `version:${sourceDefinition}`),
    strategy_instance_id: seededUuid(sourceInstance, `instance:${sourceDefinition}`),
  };
  return {
    ...signal,
    source_signal_id: sourceId,
    signal_id: identities.signal_id.value,
    strategy_definition_id: identities.strategy_definition_id.value,
    strategy_version_id: identities.strategy_version_id.value,
    strategy_instance_id: identities.strategy_instance_id.value,
    seed_identity: { source_definition: sourceDefinition, source_version: sourceVersion, source_instance: sourceInstance },
    seed_identity_mapping: Object.fromEntries(Object.entries(identities)
      .filter(([, identity]) => identity.mapped)
      .map(([field, identity]) => [field, { source_id: identity.source, seeded_id: identity.value, provenance: "stable_uuid_from_non_uuid_source" }])),
    generated_at_utc: requiredUtc(signal?.generated_at_utc, "signal.generated_at_utc"),
    expires_at_utc: requiredUtc(signal?.expires_at_utc, "signal.expires_at_utc"),
    instrument: requiredInstrument(signal?.instrument),
    as_of_utc: asOfUtc,
  };
}

async function seedSignalKernel(pool, signal, input) {
  if (Date.parse(signal.expires_at_utc) <= Date.parse(signal.generated_at_utc)) throw replayError("REPLAY_SIGNAL_WINDOW_INVALID", { signal_id: signal.source_signal_id });
  const seed = seedMaterial(signal, input);
  const dslHash = `sha256:${canonicalSha256(seed)}`;
  await pool.query(`INSERT INTO strategy_definitions(strategy_definition_id,external_key,name,owner,asset_class,default_instruments,metadata,created_at,updated_at)
    VALUES($1,$2,$3,'causal-replay','FUTURES',$4,$5::jsonb,$6,$6) ON CONFLICT (strategy_definition_id) DO NOTHING`, [
    signal.strategy_definition_id, `frozen-replay-${hash(signal.seed_identity.source_definition).slice(0, 24)}`,
    "US Grains frozen causal replay", [signal.instrument], JSON.stringify(seed), signal.generated_at_utc,
  ]);
  await pool.query(`INSERT INTO strategy_versions(strategy_version_id,strategy_definition_id,version_label,status,dsl_source_hash,dsl_source_ref,compiled_artifact_ref,compiled_artifact_hash,runtime_contract_bundle_version,published_at,metadata,created_at,updated_at)
    VALUES($1,$2,$3,'published',$4,$5,$6,NULL,'replay-v1',$7,$8::jsonb,$7,$7) ON CONFLICT (strategy_version_id) DO NOTHING`, [
    signal.strategy_version_id, signal.strategy_definition_id, `fixture-bootstrap-${hash(signal.seed_identity.source_version).slice(0, 16)}`,
    dslHash, `replay://frozen/${dslHash.slice(7)}`, `replay://causal/${dslHash.slice(7)}`,
    signal.generated_at_utc, JSON.stringify(seed),
  ]);
  await pool.query(`INSERT INTO strategy_instances(strategy_instance_id,strategy_version_id,runtime_state,execution_mode,instrument_scope,last_heartbeat_at,started_at,metadata,created_at,updated_at)
    VALUES($1,$2,'running','shadow',$3,$4,$4,$5::jsonb,$4,$4) ON CONFLICT (strategy_instance_id) DO NOTHING`, [
    signal.strategy_instance_id, signal.strategy_version_id, [signal.instrument], input.asOfUtc,
    JSON.stringify({ frozen_replay: true, source_instance_id: signal.seed_identity.source_instance, identity_mapping: signal.seed_identity_mapping }),
  ]);
}

function seedMaterial(signal, input) {
  return {
    schema_version: REPLAY_SCHEMA,
    seed_config: input.seedConfig,
    provenance: input.provenance,
    source_identity: signal.seed_identity,
    instrument: signal.instrument,
  };
}

function seededUuid(source, namespace) {
  return UUID_RE.test(source)
    ? { source, value: source, mapped: false }
    : { source, value: stableUuid(`${namespace}:${source}`), mapped: true };
}

function stableUuid(value) {
  const hex = hash(value);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function hash(value) { return createHash("sha256").update(String(value)).digest("hex"); }
function requiredText(value, field) {
  const text = String(value || "").trim();
  if (!text) throw replayError("REPLAY_SEED_FIELD_REQUIRED", { field });
  return text;
}
function requiredInstrument(value) {
  const instrument = requiredText(value, "instrument").toUpperCase();
  if (!/^[A-Z0-9]{1,16}$/.test(instrument)) throw replayError("REPLAY_INSTRUMENT_INVALID", { instrument });
  return instrument;
}
function requiredUtc(value, field) {
  const milliseconds = Date.parse(String(value || ""));
  if (!Number.isFinite(milliseconds)) throw replayError("REPLAY_SEED_TIMESTAMP_INVALID", { field, value: value || null });
  return new Date(milliseconds).toISOString();
}
function optionalUtc(value) { return value === undefined || value === null || value === "" ? null : requiredUtc(value, "candle.imported_at"); }
function requiredNumber(value, field) {
  if (value === null || value === undefined || value === "") throw replayError("REPLAY_CANDLE_VALUE_REQUIRED", { field });
  const number = Number(value);
  if (!Number.isFinite(number)) throw replayError("REPLAY_CANDLE_VALUE_INVALID", { field, value });
  return number;
}
function optionalNumber(value) { return value === null || value === undefined || value === "" ? null : requiredNumber(value, "candle.volume"); }
function replayError(code, details) { return Object.assign(new Error(code), { code, details }); }
function cleanupError(database, failures) {
  return Object.assign(new Error("REPLAY_DATABASE_CLEANUP_FAILED"), {
    code: "REPLAY_DATABASE_CLEANUP_FAILED",
    details: { database, operations: failures.map(({ operation }) => operation) },
    cause: failures[0].error,
  });
}
