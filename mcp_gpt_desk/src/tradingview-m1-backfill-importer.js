import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

export const TRADINGVIEW_M1_BACKFILL_SCHEMA_VERSION = "tradingview-m1-backfill-manifest-v2";
export const TRADINGVIEW_M1_CAPTURE_POLICY_VERSION = "settled_closed_bar_v2";
export const TRADINGVIEW_M1_BACKFILL_SYMBOLS = Object.freeze(["MNQ1!", "MES1!"]);
export const TRADINGVIEW_M1_BACKFILL_ROW_COUNT = 1_320;
export const TRADINGVIEW_M1_BACKFILL_TICK_SIZE = 0.25;
export const TRADINGVIEW_M1_CAPTURE_PROOF_ROW_COUNT = 2_640;
export const TRADINGVIEW_M1_MINIMUM_SETTLEMENT_LAG_SECONDS = 60;

const TOP_LEVEL_KEYS = ["schema_version", "source", "environment", "timezone", "window", "files", "capture_proof"];
const WINDOW_KEYS = ["start_paris", "end_paris", "semantics"];
const FILE_KEYS = ["path", "symbol", "timeframe", "sha256", "row_count"];
const CAPTURE_PROOF_KEYS = ["path", "sha256", "row_count", "policy_version", "minimum_settlement_lag_seconds", "premature_capture_count"];
const CAPTURE_PROOF_ROW_KEYS = ["symbol", "timestamp_utc", "bar_close_utc", "captured_at_cursor_utc", "settlement_lag_seconds"];
const CSV_COLUMNS = ["timestamp_utc", "open", "high", "low", "close", "volume", "is_closed"];
const PRICE_FIELDS = ["open", "high", "low", "close"];
const SHA256_RE = /^[a-f0-9]{64}$/;
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.000)?(?:Z|[+-]\d{2}:\d{2})$/;
const PRICE_EPSILON = 1e-9;

export class TradingViewM1BackfillError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "TradingViewM1BackfillError";
    this.code = code;
    this.details = details;
  }
}

export function parseTradingViewM1BackfillArgs(argv = [], env = process.env) {
  const values = new Map();
  const flags = new Set();
  for (const raw of argv) {
    const argument = String(raw);
    const match = argument.match(/^--([a-z-]+)=(.+)$/);
    if (match) values.set(match[1], match[2]);
    else if (/^--[a-z-]+$/.test(argument)) flags.add(argument.slice(2));
    else throw backfillError("BACKFILL_ARGUMENT_INVALID", `Unsupported argument: ${argument}.`);
  }
  const manifestPath = values.get("manifest") || env.DESK_TRADINGVIEW_M1_BACKFILL_MANIFEST || null;
  if (!manifestPath) throw backfillError("BACKFILL_MANIFEST_REQUIRED", "--manifest=<path> is required.");
  const unknownValues = [...values.keys()].filter((key) => key !== "manifest");
  const unknownFlags = [...flags].filter((key) => key !== "dry-run");
  if (unknownValues.length || unknownFlags.length) {
    throw backfillError("BACKFILL_ARGUMENT_INVALID", "Unsupported backfill CLI option.", {
      options: [...unknownValues, ...unknownFlags].sort(),
    });
  }
  return { manifestPath: resolve(manifestPath), dryRun: flags.has("dry-run") };
}

export async function loadTradingViewM1Backfill(manifestPath, { read = readFile } = {}) {
  const absoluteManifestPath = resolve(manifestPath);
  const manifestBytes = await read(absoluteManifestPath);
  const manifestSha256 = sha256(manifestBytes);
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw backfillError("BACKFILL_MANIFEST_JSON_INVALID", "Manifest is not valid JSON.");
  }
  validateManifest(manifest);

  const files = [];
  for (const descriptor of manifest.files) {
    const csvPath = resolve(dirname(absoluteManifestPath), descriptor.path);
    if (dirname(csvPath) !== dirname(absoluteManifestPath)) {
      throw backfillError("BACKFILL_FILE_PATH_UNSAFE", "CSV files must be direct siblings of the manifest.", {
        file: basename(descriptor.path),
      });
    }
    const bytes = await read(csvPath);
    const actualSha256 = sha256(bytes);
    if (actualSha256 !== descriptor.sha256) {
      throw backfillError("BACKFILL_CSV_SHA256_MISMATCH", "CSV SHA256 does not match the sealed manifest.", {
        file: basename(descriptor.path),
        expected_sha256: descriptor.sha256,
        actual_sha256: actualSha256,
      });
    }
    const rows = parseAndValidateCsv(bytes.toString("utf8"), descriptor, manifest.window);
    files.push({
      ...descriptor,
      path: csvPath,
      basename: basename(csvPath),
      instrument: descriptor.symbol === "MNQ1!" ? "MNQ" : "MES",
      feed_id: feedId(manifest.environment, descriptor.symbol, "1"),
      m5_feed_id: feedId(manifest.environment, descriptor.symbol, "5"),
      rows,
    });
  }

  const proofPath = resolve(dirname(absoluteManifestPath), manifest.capture_proof.path);
  if (dirname(proofPath) !== dirname(absoluteManifestPath)) {
    throw backfillError("BACKFILL_CAPTURE_PROOF_PATH_UNSAFE", "Capture proof must be a direct sibling of the manifest.");
  }
  const proofBytes = await read(proofPath);
  const actualProofSha256 = sha256(proofBytes);
  if (actualProofSha256 !== manifest.capture_proof.sha256) {
    throw backfillError("BACKFILL_CAPTURE_PROOF_SHA256_MISMATCH", "Capture proof SHA256 does not match the sealed manifest.", {
      file: basename(proofPath),
      expected_sha256: manifest.capture_proof.sha256,
      actual_sha256: actualProofSha256,
    });
  }
  const captureProofRows = parseAndValidateCaptureProof(
    proofBytes.toString("utf8"),
    manifest.capture_proof,
    files,
  );
  const captureProof = {
    ...manifest.capture_proof,
    path: proofPath,
    basename: basename(proofPath),
    rows: captureProofRows,
  };

  return {
    manifest,
    manifest_path: absoluteManifestPath,
    manifest_basename: basename(absoluteManifestPath),
    manifest_sha256: manifestSha256,
    import_id: `tv_m1_backfill__${manifestSha256.slice(0, 40)}`,
    files,
    capture_proof: captureProof,
    total_rows: files.reduce((sum, file) => sum + file.rows.length, 0),
  };
}

export function validateManifest(manifest) {
  assertPlainObject(manifest, "BACKFILL_MANIFEST_SCHEMA_INVALID", "Manifest must be an object.");
  assertExactKeys(manifest, TOP_LEVEL_KEYS, "manifest");
  if (manifest.schema_version !== TRADINGVIEW_M1_BACKFILL_SCHEMA_VERSION) {
    throw backfillError("BACKFILL_MANIFEST_SCHEMA_INVALID", "Unsupported manifest schema_version.");
  }
  if (manifest.source !== "tradingview" || manifest.environment !== "prod" || manifest.timezone !== "Europe/Paris") {
    throw backfillError("BACKFILL_MANIFEST_SCOPE_INVALID", "Manifest source/environment/timezone is outside the allowlist.", {
      expected: { source: "tradingview", environment: "prod", timezone: "Europe/Paris" },
    });
  }
  assertPlainObject(manifest.window, "BACKFILL_MANIFEST_SCHEMA_INVALID", "window must be an object.");
  assertExactKeys(manifest.window, WINDOW_KEYS, "window");
  validateExactWindow(manifest.window);
  if (!Array.isArray(manifest.files) || manifest.files.length !== TRADINGVIEW_M1_BACKFILL_SYMBOLS.length) {
    throw backfillError("BACKFILL_MANIFEST_SCOPE_INVALID", "Manifest must contain exactly one MNQ1! and one MES1! CSV.");
  }
  const seenSymbols = new Set();
  const seenPaths = new Set();
  for (const file of manifest.files) {
    assertPlainObject(file, "BACKFILL_MANIFEST_SCHEMA_INVALID", "Each files entry must be an object.");
    assertExactKeys(file, FILE_KEYS, "files[]");
    if (!TRADINGVIEW_M1_BACKFILL_SYMBOLS.includes(file.symbol) || seenSymbols.has(file.symbol)) {
      throw backfillError("BACKFILL_MANIFEST_SCOPE_INVALID", "CSV symbol is not allowlisted or is duplicated.", { symbol: file.symbol });
    }
    if (file.timeframe !== "1") {
      throw backfillError("BACKFILL_MANIFEST_SCOPE_INVALID", "Only timeframe 1 is accepted.", { timeframe: file.timeframe });
    }
    if (typeof file.path !== "string" || file.path !== basename(file.path) || !file.path.toLowerCase().endsWith(".csv") || seenPaths.has(file.path)) {
      throw backfillError("BACKFILL_FILE_PATH_UNSAFE", "CSV path must be a unique sibling basename ending in .csv.", { file: basename(String(file.path || "")) });
    }
    if (!SHA256_RE.test(String(file.sha256 || ""))) {
      throw backfillError("BACKFILL_MANIFEST_SCHEMA_INVALID", "CSV sha256 must be 64 lowercase hexadecimal characters.", { file: file.path });
    }
    if (file.row_count !== TRADINGVIEW_M1_BACKFILL_ROW_COUNT) {
      throw backfillError("BACKFILL_ROW_COUNT_INVALID", `Each CSV must declare exactly ${TRADINGVIEW_M1_BACKFILL_ROW_COUNT} rows.`, { file: file.path, row_count: file.row_count });
    }
    seenSymbols.add(file.symbol);
    seenPaths.add(file.path);
  }
  if (TRADINGVIEW_M1_BACKFILL_SYMBOLS.some((symbol) => !seenSymbols.has(symbol))) {
    throw backfillError("BACKFILL_MANIFEST_SCOPE_INVALID", "Manifest symbol set is incomplete.");
  }
  assertPlainObject(manifest.capture_proof, "BACKFILL_CAPTURE_PROOF_DESCRIPTOR_INVALID", "capture_proof must be an object.");
  assertExactKeys(manifest.capture_proof, CAPTURE_PROOF_KEYS, "capture_proof");
  const proof = manifest.capture_proof;
  if (typeof proof.path !== "string" || proof.path !== basename(proof.path)
    || !proof.path.toLowerCase().endsWith(".jsonl") || seenPaths.has(proof.path)) {
    throw backfillError("BACKFILL_CAPTURE_PROOF_PATH_UNSAFE", "Capture proof must be a unique sibling JSONL basename.");
  }
  if (!SHA256_RE.test(String(proof.sha256 || ""))) {
    throw backfillError("BACKFILL_CAPTURE_PROOF_DESCRIPTOR_INVALID", "Capture proof sha256 must be 64 lowercase hexadecimal characters.");
  }
  if (proof.row_count !== TRADINGVIEW_M1_CAPTURE_PROOF_ROW_COUNT) {
    throw backfillError("BACKFILL_CAPTURE_PROOF_COUNT_INVALID", `Capture proof must declare exactly ${TRADINGVIEW_M1_CAPTURE_PROOF_ROW_COUNT} rows.`);
  }
  if (proof.policy_version !== TRADINGVIEW_M1_CAPTURE_POLICY_VERSION) {
    throw backfillError("BACKFILL_CAPTURE_POLICY_UNSUPPORTED", "Capture proof policy is not the required settled closed-bar policy.");
  }
  if (!Number.isInteger(proof.minimum_settlement_lag_seconds)
    || proof.minimum_settlement_lag_seconds < TRADINGVIEW_M1_MINIMUM_SETTLEMENT_LAG_SECONDS) {
    throw backfillError("BACKFILL_CAPTURE_PROOF_LAG_INVALID", "Capture proof minimum settlement lag is below 60 seconds.");
  }
  if (proof.premature_capture_count !== 0) {
    throw backfillError("BACKFILL_PREMATURE_CAPTURE_DECLARED", "Manifest declares prematurely captured bars.");
  }
  return manifest;
}

export function parseAndValidateCsv(csvText, descriptor, window) {
  const records = parseCsv(csvText.replace(/^\uFEFF/, ""));
  if (records.length < 2) throw backfillError("BACKFILL_CSV_EMPTY", "CSV has no data rows.", { file: basename(descriptor.path) });
  const header = records[0];
  if (header.length !== CSV_COLUMNS.length || header.some((column, index) => column !== CSV_COLUMNS[index])) {
    throw backfillError("BACKFILL_CSV_HEADER_INVALID", "CSV header must exactly match the canonical M1 schema.", {
      file: basename(descriptor.path),
      expected_columns: CSV_COLUMNS,
      actual_columns: header,
    });
  }
  const data = records.slice(1).filter((row) => !(row.length === 1 && row[0] === ""));
  if (data.length !== descriptor.row_count || data.length !== TRADINGVIEW_M1_BACKFILL_ROW_COUNT) {
    throw backfillError("BACKFILL_ROW_COUNT_INVALID", "CSV row count differs from the manifest or exact window.", {
      file: basename(descriptor.path),
      expected: TRADINGVIEW_M1_BACKFILL_ROW_COUNT,
      actual: data.length,
    });
  }
  const startMs = Date.parse(window.start_paris);
  const endMs = Date.parse(window.end_paris);
  const seen = new Set();
  return data.map((columns, index) => {
    if (columns.length !== CSV_COLUMNS.length) {
      throw backfillError("BACKFILL_CSV_ROW_INVALID", "CSV row has an unexpected column count.", { file: basename(descriptor.path), row: index + 2 });
    }
    const timestampMs = Date.parse(columns[0]);
    if (!ISO_TIMESTAMP_RE.test(columns[0]) || !Number.isFinite(timestampMs)) {
      throw backfillError("BACKFILL_TIMESTAMP_INVALID", "CSV timestamp is not a valid minute timestamp.", { file: basename(descriptor.path), row: index + 2 });
    }
    const expectedMs = startMs + index * 60_000;
    if (timestampMs !== expectedMs || timestampMs < startMs || timestampMs >= endMs || timestampMs % 60_000 !== 0) {
      throw backfillError("BACKFILL_M1_GRID_INVALID", "CSV timestamps must form the exact contiguous one-minute grid.", {
        file: basename(descriptor.path), row: index + 2, expected_timestamp_utc: new Date(expectedMs).toISOString(), actual_timestamp_utc: new Date(timestampMs).toISOString(),
      });
    }
    const timestampUtc = new Date(timestampMs).toISOString();
    if (seen.has(timestampUtc)) {
      throw backfillError("BACKFILL_DUPLICATE_TIMESTAMP", "CSV contains a duplicate timestamp.", { file: basename(descriptor.path), timestamp_utc: timestampUtc });
    }
    seen.add(timestampUtc);
    const prices = Object.fromEntries(PRICE_FIELDS.map((field, priceIndex) => [field, strictNumber(columns[priceIndex + 1], field, descriptor.path, index + 2)]));
    const volume = columns[5] === "" ? null : strictNumber(columns[5], "volume", descriptor.path, index + 2);
    const isClosed = parseClosed(columns[6]);
    if (!isClosed) throw backfillError("BACKFILL_UNCLOSED_CANDLE", "Only closed candles may be imported.", { file: basename(descriptor.path), row: index + 2 });
    if (prices.high < Math.max(prices.open, prices.close, prices.low) || prices.low > Math.min(prices.open, prices.close, prices.high)) {
      throw backfillError("BACKFILL_OHLC_INVALID", "OHLC invariants are invalid.", { file: basename(descriptor.path), row: index + 2 });
    }
    if (PRICE_FIELDS.some((field) => !isOnTickGrid(prices[field], TRADINGVIEW_M1_BACKFILL_TICK_SIZE))) {
      throw backfillError("BACKFILL_PRICE_GRID_INVALID", "OHLC price is outside the exact 0.25 tick grid.", { file: basename(descriptor.path), row: index + 2 });
    }
    if (volume !== null && volume < 0) throw backfillError("BACKFILL_VOLUME_INVALID", "Volume cannot be negative.", { file: basename(descriptor.path), row: index + 2 });
    return { timestamp_utc: timestampUtc, ...prices, volume, is_closed: true };
  });
}

export function parseAndValidateCaptureProof(proofText, descriptor, files) {
  if (typeof proofText !== "string" || !proofText.endsWith("\n")) {
    throw backfillError("BACKFILL_CAPTURE_PROOF_FORMAT_INVALID", "Capture proof must be newline-terminated JSONL.");
  }
  const lines = proofText.slice(0, -1).split("\n");
  if (lines.length !== descriptor.row_count || lines.length !== TRADINGVIEW_M1_CAPTURE_PROOF_ROW_COUNT) {
    throw backfillError("BACKFILL_CAPTURE_PROOF_COUNT_INVALID", "Capture proof row count differs from the sealed descriptor.", {
      expected: TRADINGVIEW_M1_CAPTURE_PROOF_ROW_COUNT,
      actual: lines.length,
    });
  }
  const expected = new Set(files.flatMap((file) => file.rows.map((row) => `${file.symbol}\u0000${row.timestamp_utc}`)));
  const seen = new Set();
  const normalized = [];
  let prematureCaptureCount = 0;
  for (let index = 0; index < lines.length; index += 1) {
    let row;
    try {
      row = JSON.parse(lines[index]);
    } catch {
      throw backfillError("BACKFILL_CAPTURE_PROOF_JSON_INVALID", "Capture proof contains invalid JSON.", { row: index + 1 });
    }
    assertPlainObject(row, "BACKFILL_CAPTURE_PROOF_SCHEMA_INVALID", "Each capture proof row must be an object.");
    const actualKeys = Object.keys(row).sort();
    const expectedKeys = [...CAPTURE_PROOF_ROW_KEYS].sort();
    if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, keyIndex) => key !== expectedKeys[keyIndex])) {
      throw backfillError("BACKFILL_CAPTURE_PROOF_SCHEMA_INVALID", "Capture proof row keys do not match the exact schema.", { row: index + 1 });
    }
    if (!TRADINGVIEW_M1_BACKFILL_SYMBOLS.includes(row.symbol)) {
      throw backfillError("BACKFILL_CAPTURE_PROOF_SCOPE_INVALID", "Capture proof symbol is not allowlisted.", { row: index + 1 });
    }
    const timestampMs = Date.parse(String(row.timestamp_utc || ""));
    const barCloseMs = Date.parse(String(row.bar_close_utc || ""));
    const capturedAtMs = Date.parse(String(row.captured_at_cursor_utc || ""));
    if (![timestampMs, barCloseMs, capturedAtMs].every(Number.isFinite) || timestampMs % 60_000 !== 0) {
      throw backfillError("BACKFILL_CAPTURE_PROOF_TIMESTAMP_INVALID", "Capture proof timestamps are invalid.", { row: index + 1 });
    }
    if (barCloseMs !== timestampMs + 60_000) {
      throw backfillError("BACKFILL_CAPTURE_PROOF_BAR_CLOSE_INVALID", "Capture proof bar_close must equal bar open plus 60 seconds.", { row: index + 1 });
    }
    const actualLagSeconds = (capturedAtMs - barCloseMs) / 1_000;
    if (!Number.isInteger(row.settlement_lag_seconds) || row.settlement_lag_seconds !== actualLagSeconds) {
      throw backfillError("BACKFILL_CAPTURE_PROOF_LAG_INVALID", "Capture proof lag does not match its timestamps.", { row: index + 1 });
    }
    if (actualLagSeconds < TRADINGVIEW_M1_MINIMUM_SETTLEMENT_LAG_SECONDS) {
      prematureCaptureCount += 1;
      throw backfillError("BACKFILL_PREMATURE_CAPTURE", "Capture proof contains a bar observed before the settlement grace elapsed.", { row: index + 1, settlement_lag_seconds: actualLagSeconds });
    }
    const timestampUtc = new Date(timestampMs).toISOString();
    const key = `${row.symbol}\u0000${timestampUtc}`;
    if (seen.has(key)) {
      throw backfillError("BACKFILL_CAPTURE_PROOF_DUPLICATE", "Capture proof contains a duplicate symbol/timestamp.", { row: index + 1 });
    }
    if (!expected.has(key)) {
      throw backfillError("BACKFILL_CAPTURE_PROOF_ORPHAN", "Capture proof does not map to an imported CSV row.", { row: index + 1 });
    }
    seen.add(key);
    normalized.push({
      symbol: row.symbol,
      timestamp_utc: timestampUtc,
      bar_close_utc: new Date(barCloseMs).toISOString(),
      captured_at_cursor_utc: new Date(capturedAtMs).toISOString(),
      settlement_lag_seconds: actualLagSeconds,
    });
  }
  if (seen.size !== expected.size || [...expected].some((key) => !seen.has(key))) {
    throw backfillError("BACKFILL_CAPTURE_PROOF_COVERAGE_INVALID", "Capture proof is not an exact 1:1 match for the CSV rows.", {
      expected: expected.size,
      actual: seen.size,
    });
  }
  const minimumLag = Math.min(...normalized.map((row) => row.settlement_lag_seconds));
  if (minimumLag !== descriptor.minimum_settlement_lag_seconds || prematureCaptureCount !== descriptor.premature_capture_count) {
    throw backfillError("BACKFILL_CAPTURE_PROOF_SUMMARY_MISMATCH", "Capture proof summary differs from the sealed descriptor.", {
      minimum_settlement_lag_seconds: minimumLag,
      premature_capture_count: prematureCaptureCount,
    });
  }
  return normalized;
}

export async function importTradingViewM1Backfill(pool, {
  manifestPath,
  dryRun = false,
  read = readFile,
  now = () => new Date(),
} = {}) {
  if (!pool?.connect) throw backfillError("BACKFILL_POSTGRES_POOL_REQUIRED", "A PostgreSQL pool is required.");
  const plan = await loadTradingViewM1Backfill(manifestPath, { read });
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    transactionOpen = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [
      `tradingview_m1_backfill:${plan.manifest.window.start_paris}:${plan.manifest.window.end_paris}`,
    ]);
    const prior = await client.query(
      `SELECT status, mode, options, report FROM desk_import_runs WHERE import_id = $1::text FOR UPDATE`,
      [plan.import_id],
    );
    if (!dryRun && prior.rows?.[0]?.status === "completed") {
      const storedHash = prior.rows[0].options?.manifest_sha256;
      if (storedHash !== plan.manifest_sha256) throw backfillError("BACKFILL_IMPORT_ID_COLLISION", "Existing import receipt has a different manifest hash.");
      await client.query("COMMIT");
      transactionOpen = false;
      return { ...safeReceipt(prior.rows[0].report), status: "ALREADY_IMPORTED", committed: true, idempotent: true };
    }

    const startedAt = now().toISOString();
    await client.query(
      `INSERT INTO desk_import_runs (
         import_id, source_project, source_kind, mode, status, started_at,
         requested_collections, excluded_collections, options, report
       ) VALUES ($1::text, $2::text, 'csv', $3::desk_import_mode, 'running', $4::timestamptz,
                 $5::jsonb, '[]'::jsonb, $6::jsonb, '{}'::jsonb)
       ON CONFLICT (import_id) DO UPDATE
       SET mode = EXCLUDED.mode, status = 'running', started_at = EXCLUDED.started_at,
           completed_at = NULL, options = EXCLUDED.options, report = '{}'::jsonb, error = NULL
       WHERE desk_import_runs.status <> 'completed'`,
      [
        plan.import_id,
        "tradingview_m1_backfill",
        dryRun ? "dry_run" : "import",
        startedAt,
        JSON.stringify(["market_candles", "market_feeds"]),
        JSON.stringify({
          manifest_sha256: plan.manifest_sha256,
          manifest_schema_version: plan.manifest.schema_version,
          capture_proof_sha256: plan.capture_proof.sha256,
          capture_policy_version: plan.capture_proof.policy_version,
          minimum_settlement_lag_seconds: plan.capture_proof.minimum_settlement_lag_seconds,
          window: plan.manifest.window,
          symbols: TRADINGVIEW_M1_BACKFILL_SYMBOLS,
        }),
      ],
    );

    await client.query(`CREATE TEMP TABLE tv_m1_backfill_stage (
      feed_id text NOT NULL,
      m5_feed_id text NOT NULL,
      instrument_code text NOT NULL,
      symbol_code text NOT NULL,
      timeframe text NOT NULL,
      timestamp_utc timestamptz NOT NULL,
      open double precision NOT NULL,
      high double precision NOT NULL,
      low double precision NOT NULL,
      close double precision NOT NULL,
      volume double precision,
      is_closed boolean NOT NULL,
      source_file_sha256 text NOT NULL,
      PRIMARY KEY(feed_id, timestamp_utc)
    ) ON COMMIT DROP`);
    await stageRows(client, plan);

    const feedIds = plan.files.map((file) => file.feed_id);
    const feedResult = await client.query(
      `SELECT mf.feed_id, mf.instrument_code, mf.timeframe, mf.environment, mf.provider, ms.symbol_code
       FROM market_feeds mf
       JOIN market_symbols ms ON ms.symbol_id = mf.symbol_id
       WHERE mf.feed_id = ANY($1::text[])
       ORDER BY mf.feed_id
       FOR UPDATE OF mf`,
      [feedIds],
    );
    assertCanonicalFeeds(feedResult.rows || [], plan);

    const conflicts = await client.query(`
      SELECT s.feed_id, s.symbol_code, s.timestamp_utc,
             jsonb_build_object('open', s.open, 'high', s.high, 'low', s.low, 'close', s.close, 'volume', s.volume, 'is_closed', s.is_closed) AS incoming,
             jsonb_build_object('open', c.open, 'high', c.high, 'low', c.low, 'close', c.close, 'volume', c.volume, 'is_closed', c.is_closed) AS existing
      FROM tv_m1_backfill_stage s
      JOIN market_candles c ON c.feed_id = s.feed_id AND c.timestamp_utc = s.timestamp_utc
      WHERE c.symbol_code IS DISTINCT FROM s.symbol_code
         OR c.timeframe IS DISTINCT FROM s.timeframe
         OR c.open IS DISTINCT FROM s.open OR c.high IS DISTINCT FROM s.high
         OR c.low IS DISTINCT FROM s.low OR c.close IS DISTINCT FROM s.close
         OR c.volume IS DISTINCT FROM s.volume OR c.is_closed IS DISTINCT FROM s.is_closed
      ORDER BY s.feed_id, s.timestamp_utc
      LIMIT 101
    `);
    if ((conflicts.rows || []).length) {
      const samples = conflicts.rows.slice(0, 100).map(safeConflict);
      throw backfillError("BACKFILL_EXISTING_VALUE_CONFLICT", "Existing market_candles values differ; import refused without overwrite.", {
        conflict_count_at_least: conflicts.rows.length,
        conflicts: samples,
      }, samples.map((item) => ({ reason: "MARKET_CANDLE_VALUE_CONFLICT", item })));
    }

    const crossRows = await client.query(crossTimeframeSql(), [TRADINGVIEW_M1_BACKFILL_TICK_SIZE]);
    const crossTimeframe = validateCrossTimeframe(crossRows.rows || []);

    const insertResult = await client.query(`
      INSERT INTO market_candles (
        feed_id, timestamp_utc, symbol_code, timeframe, trading_date, timestamp_paris,
        open, high, low, close, volume, is_closed, indicators, studies, raw,
        source_collection, source_document_id
      )
      SELECT s.feed_id, s.timestamp_utc, s.symbol_code, s.timeframe,
             (s.timestamp_utc AT TIME ZONE 'Europe/Paris')::date::text,
             to_char(s.timestamp_utc AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD"T"HH24:MI:SS'),
             s.open, s.high, s.low, s.close, s.volume, true, '{}'::jsonb, '{}'::jsonb,
             jsonb_build_object('source', 'tradingview_csv_backfill', 'import_id', $1::text,
                                'manifest_sha256', $2::text,
                                'capture_proof_sha256', $3::text,
                                'capture_policy_version', $4::text,
                                'source_file_sha256', s.source_file_sha256),
             'tradingview_m1_backfill',
             to_char(s.timestamp_utc AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS"Z"')
      FROM tv_m1_backfill_stage s
      WHERE NOT EXISTS (
        SELECT 1 FROM market_candles c WHERE c.feed_id = s.feed_id AND c.timestamp_utc = s.timestamp_utc
      )
      ON CONFLICT (feed_id, timestamp_utc) DO NOTHING
    `, [
      plan.import_id,
      plan.manifest_sha256,
      plan.capture_proof.sha256,
      plan.capture_proof.policy_version,
    ]);
    const inserted = Number(insertResult.rowCount || 0);
    const identical = plan.total_rows - inserted;

    const feedUpdate = await client.query(`
      WITH latest AS (
        SELECT feed_id, max(timestamp_utc) AS latest_timestamp_utc, count(*)::integer AS staged_count
        FROM tv_m1_backfill_stage GROUP BY feed_id
      )
      UPDATE market_feeds mf
      SET latest_timestamp_utc = GREATEST(mf.latest_timestamp_utc, latest.latest_timestamp_utc),
          latest_candle_path = CASE WHEN mf.latest_timestamp_utc IS NULL OR latest.latest_timestamp_utc > mf.latest_timestamp_utc
            THEN 'market_feeds/' || mf.feed_id || '/candles/' || to_char(latest.latest_timestamp_utc AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS"Z"')
            ELSE mf.latest_candle_path END,
          status = 'ready',
          metadata = mf.metadata || jsonb_build_object(
            'last_m1_backfill_import_id', $1::text,
            'last_m1_backfill_manifest_sha256', $2::text,
            'last_m1_backfill_completed_at_utc', $3::timestamptz,
            'last_m1_backfill_staged_count', latest.staged_count
          ),
          updated_at = now()
      FROM latest WHERE mf.feed_id = latest.feed_id
      RETURNING mf.feed_id
    `, [plan.import_id, plan.manifest_sha256, now().toISOString()]);
    if ((feedUpdate.rows || []).length !== plan.files.length) {
      throw backfillError("BACKFILL_FEED_METADATA_UPDATE_FAILED", "Not all canonical M1 feeds were updated.");
    }

    const receipt = safeReceipt({
      ok: true,
      status: dryRun ? "DRY_RUN_VALIDATED" : "IMPORTED",
      committed: !dryRun,
      idempotent: inserted === 0,
      import_id: plan.import_id,
      manifest: {
        file: plan.manifest_basename,
        sha256: plan.manifest_sha256,
        schema_version: plan.manifest.schema_version,
      },
      capture_proof: {
        file: plan.capture_proof.basename,
        sha256: plan.capture_proof.sha256,
        row_count: plan.capture_proof.rows.length,
        policy_version: plan.capture_proof.policy_version,
        minimum_settlement_lag_seconds: plan.capture_proof.minimum_settlement_lag_seconds,
        premature_capture_count: plan.capture_proof.premature_capture_count,
      },
      scope: {
        source: "tradingview",
        environment: plan.manifest.environment,
        timezone: plan.manifest.timezone,
        timeframe: "1",
        symbols: TRADINGVIEW_M1_BACKFILL_SYMBOLS,
        window: plan.manifest.window,
      },
      files: plan.files.map((file) => ({ file: file.basename, symbol: file.symbol, sha256: file.sha256, row_count: file.rows.length })),
      rows: { staged: plan.total_rows, inserted, identical_noop: identical, conflicts: 0, overwritten: 0 },
      validation_summary: {
        inserted,
        noop: identical,
        conflicts: 0,
        m5_compared: crossTimeframe.compared_buckets,
        m5_mismatch: crossTimeframe.mismatched_buckets,
      },
      cross_timeframe: crossTimeframe,
    });
    await client.query(
      `UPDATE desk_import_runs SET status = 'completed', completed_at = $2::timestamptz, report = $3::jsonb, error = NULL WHERE import_id = $1::text`,
      [plan.import_id, now().toISOString(), JSON.stringify(receipt)],
    );
    await client.query(dryRun ? "ROLLBACK" : "COMMIT");
    transactionOpen = false;
    return receipt;
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    if (!dryRun && Array.isArray(error?.quarantine) && error.quarantine.length) {
      await persistQuarantine(pool, plan, error, now);
    }
    throw error;
  } finally {
    client.release();
  }
}

function validateExactWindow(window) {
  if (window.semantics !== "[start,end)") throw backfillError("BACKFILL_MANIFEST_SCOPE_INVALID", "Window semantics must be [start,end).");
  const start = String(window.start_paris || "");
  const end = String(window.end_paris || "");
  const startMatch = start.match(/^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.000)?([+-]\d{2}:\d{2})$/);
  const endMatch = end.match(/^(\d{4}-\d{2}-\d{2})T22:00:00(?:\.000)?([+-]\d{2}:\d{2})$/);
  if (!startMatch || !endMatch || startMatch[1] !== endMatch[1] || startMatch[2] !== endMatch[2]
    || Date.parse(end) - Date.parse(start) !== TRADINGVIEW_M1_BACKFILL_ROW_COUNT * 60_000) {
    throw backfillError("BACKFILL_WINDOW_INVALID", "Window must be exactly one Paris trading date from 00:00 inclusive to 22:00 exclusive.");
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { value += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(value); value = ""; }
    else if (character === "\n") { row.push(value.replace(/\r$/, "")); rows.push(row); row = []; value = ""; }
    else value += character;
  }
  if (quoted) throw backfillError("BACKFILL_CSV_SYNTAX_INVALID", "CSV contains an unterminated quoted field.");
  if (value !== "" || row.length) { row.push(value.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

function strictNumber(value, field, path, row) {
  if (String(value).trim() === "") throw backfillError("BACKFILL_NUMBER_INVALID", `${field} is empty.`, { file: basename(path), row, field });
  const number = Number(value);
  if (!Number.isFinite(number)) throw backfillError("BACKFILL_NUMBER_INVALID", `${field} is not finite.`, { file: basename(path), row, field });
  return number;
}

function parseClosed(value) {
  return ["true", "1", "closed", "confirmed"].includes(String(value).trim().toLowerCase());
}

function isOnTickGrid(value, tick) {
  return Math.abs(value / tick - Math.round(value / tick)) <= PRICE_EPSILON;
}

async function stageRows(client, plan) {
  const rows = plan.files.flatMap((file) => file.rows.map((row) => ({ ...row, file })));
  const batchSize = 400;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values = [];
    const tuples = batch.map((row, index) => {
      const base = index * 13;
      values.push(
        row.file.feed_id, row.file.m5_feed_id, row.file.instrument, row.file.symbol, "1", row.timestamp_utc,
        row.open, row.high, row.low, row.close, row.volume, true, row.file.sha256,
      );
      return `($${base + 1}::text,$${base + 2}::text,$${base + 3}::text,$${base + 4}::text,$${base + 5}::text,$${base + 6}::timestamptz,$${base + 7}::double precision,$${base + 8}::double precision,$${base + 9}::double precision,$${base + 10}::double precision,$${base + 11}::double precision,$${base + 12}::boolean,$${base + 13}::text)`;
    });
    await client.query(`INSERT INTO tv_m1_backfill_stage (
      feed_id,m5_feed_id,instrument_code,symbol_code,timeframe,timestamp_utc,
      open,high,low,close,volume,is_closed,source_file_sha256
    ) VALUES ${tuples.join(",")}`, values);
  }
}

function assertCanonicalFeeds(rows, plan) {
  const byId = new Map(rows.map((row) => [row.feed_id, row]));
  for (const file of plan.files) {
    const row = byId.get(file.feed_id);
    if (!row || row.symbol_code !== file.symbol || row.instrument_code !== file.instrument
      || row.timeframe !== "1" || row.environment !== "prod" || row.provider !== "tradingview") {
      throw backfillError("BACKFILL_CANONICAL_FEED_MISSING", "Canonical TradingView M1 feed is missing or has the wrong scope.", { feed_id: file.feed_id });
    }
  }
}

function crossTimeframeSql() {
  return `WITH buckets AS (
    SELECT feed_id, m5_feed_id, symbol_code,
           date_bin(INTERVAL '5 minutes', timestamp_utc, TIMESTAMPTZ '1970-01-01 00:00:00+00') AS bucket_utc,
           count(*)::integer AS m1_count,
           (array_agg(open ORDER BY timestamp_utc))[1] AS m1_open,
           max(high) AS m1_high, min(low) AS m1_low,
           (array_agg(close ORDER BY timestamp_utc DESC))[1] AS m1_close,
           min(timestamp_utc) AS first_m1, max(timestamp_utc) AS last_m1
    FROM tv_m1_backfill_stage
    GROUP BY feed_id, m5_feed_id, symbol_code, bucket_utc
  )
  SELECT b.symbol_code, b.bucket_utc, b.m1_count, b.m1_open, b.m1_high, b.m1_low, b.m1_close,
         c.open AS m5_open, c.high AS m5_high, c.low AS m5_low, c.close AS m5_close,
         c.timestamp_utc AS m5_timestamp_utc,
         CASE WHEN c.timestamp_utc IS NULL THEN true ELSE false END AS m5_missing,
         GREATEST(abs(b.m1_open-c.open), abs(b.m1_high-c.high), abs(b.m1_low-c.low), abs(b.m1_close-c.close)) AS max_delta,
         $1::double precision AS tolerance
  FROM buckets b
  LEFT JOIN market_candles c ON c.feed_id = b.m5_feed_id AND c.timestamp_utc = b.bucket_utc AND c.is_closed = true
  WHERE b.m1_count = 5 AND b.last_m1 - b.first_m1 = INTERVAL '4 minutes'
  ORDER BY b.symbol_code, b.bucket_utc`;
}

function validateCrossTimeframe(rows) {
  const expectedBuckets = TRADINGVIEW_M1_BACKFILL_SYMBOLS.length * (TRADINGVIEW_M1_BACKFILL_ROW_COUNT / 5);
  if (rows.length !== expectedBuckets) {
    throw backfillError("BACKFILL_M1_M5_BUCKET_COVERAGE_INVALID", "M1 staging did not produce the exact complete five-minute bucket set.", { expected_buckets: expectedBuckets, actual_buckets: rows.length });
  }
  const missing = rows.filter((row) => row.m5_missing === true || row.m5_missing === "t" || row.m5_timestamp_utc == null);
  const mismatched = rows.filter((row) => row.m5_timestamp_utc != null && Number(row.max_delta) > PRICE_EPSILON);
  const divergent = mismatched.filter((row) => Number(row.max_delta) > TRADINGVIEW_M1_BACKFILL_TICK_SIZE + PRICE_EPSILON);
  if (divergent.length) {
    const samples = divergent.slice(0, 100).map((row) => ({
      symbol: row.symbol_code,
      bucket_utc: new Date(row.bucket_utc).toISOString(),
      m1: { open: Number(row.m1_open), high: Number(row.m1_high), low: Number(row.m1_low), close: Number(row.m1_close) },
      m5: { open: Number(row.m5_open), high: Number(row.m5_high), low: Number(row.m5_low), close: Number(row.m5_close) },
      max_delta: Number(row.max_delta),
      tolerance: TRADINGVIEW_M1_BACKFILL_TICK_SIZE,
    }));
    throw backfillError("BACKFILL_M1_M5_DIVERGENCE", "Aggregated M1 OHLC diverges from existing M5 beyond one exact tick.", {
      divergence_count: divergent.length,
      divergences: samples,
    }, samples.map((item) => ({ reason: "M1_M5_OHLC_DIVERGENCE", item })));
  }
  return {
    tolerance_points: TRADINGVIEW_M1_BACKFILL_TICK_SIZE,
    expected_complete_buckets: expectedBuckets,
    complete_buckets: rows.length,
    compared_buckets: rows.length - missing.length,
    missing_m5_buckets: missing.length,
    missing_m5_report: missing.slice(0, 100).map((row) => ({ symbol: row.symbol_code, bucket_utc: new Date(row.bucket_utc).toISOString() })),
    exact_match_buckets: rows.length - missing.length - mismatched.length,
    mismatched_buckets: mismatched.length,
    within_tolerance_mismatch_buckets: mismatched.length,
    mismatch_report: mismatched.slice(0, 100).map((row) => ({
      symbol: row.symbol_code,
      bucket_utc: new Date(row.bucket_utc).toISOString(),
      max_delta: Number(row.max_delta),
    })),
    divergent_buckets: 0,
  };
}

async function persistQuarantine(pool, plan, error, now) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const receipt = safeErrorReceipt(plan, error);
    await client.query(
      `INSERT INTO desk_import_runs (import_id, source_project, source_kind, mode, status, started_at, completed_at, requested_collections, excluded_collections, options, report, error)
       VALUES ($1::text, 'tradingview_m1_backfill', 'csv', 'import', 'failed', $2::timestamptz, $2::timestamptz,
               $3::jsonb, '[]'::jsonb, $4::jsonb, $5::jsonb, $6::text)
       ON CONFLICT (import_id) DO UPDATE SET status = 'failed', completed_at = EXCLUDED.completed_at,
         report = EXCLUDED.report, error = EXCLUDED.error
       WHERE desk_import_runs.status <> 'completed'`,
      [plan.import_id, now().toISOString(), JSON.stringify(["market_candles", "market_feeds"]), JSON.stringify({ manifest_sha256: plan.manifest_sha256 }), JSON.stringify(receipt), error.code],
    );
    for (const entry of error.quarantine.slice(0, 100)) {
      const sourceId = entry.item.timestamp_utc
        ? `${entry.item.feed_id}:${entry.item.timestamp_utc}`
        : `${entry.item.symbol}:${entry.item.bucket_utc}`;
      await client.query(
        `INSERT INTO desk_document_quarantine (
           source_collection, source_document_id, target_table, severity, reason, data, import_id
         ) VALUES ('tradingview_m1_backfill', $1::text, 'market_candles', 'error', $2::text, $3::jsonb, $4::text)
         ON CONFLICT (source_collection, source_document_id, reason) DO NOTHING`,
        [sourceId, entry.reason, JSON.stringify(entry.item), plan.import_id],
      );
    }
    await client.query("COMMIT");
  } catch (quarantineError) {
    await client.query("ROLLBACK").catch(() => {});
    error.quarantine_persistence_error = quarantineError?.code || "QUARANTINE_PERSISTENCE_FAILED";
  } finally {
    client.release();
  }
}

function safeConflict(row) {
  return {
    feed_id: row.feed_id,
    symbol: row.symbol_code,
    timestamp_utc: new Date(row.timestamp_utc).toISOString(),
    incoming: row.incoming,
    existing: row.existing,
  };
}

export function safeErrorReceipt(plan, error) {
  return {
    ok: false,
    status: "REJECTED",
    committed: false,
    import_id: plan?.import_id || null,
    manifest: plan ? { file: plan.manifest_basename, sha256: plan.manifest_sha256, schema_version: plan.manifest.schema_version } : null,
    error: {
      code: error?.code || "BACKFILL_FAILED",
      message: String(error?.message || "Backfill failed").slice(0, 500),
      details: sanitizeJson(error?.details || {}),
    },
  };
}

function safeReceipt(receipt) {
  return sanitizeJson(receipt || {});
}

function sanitizeJson(value, depth = 0) {
  if (depth > 8) return "[truncated]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 1_000);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeJson(item, depth + 1));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [key, sanitizeJson(item, depth + 1)]));
  return String(value).slice(0, 1_000);
}

function assertPlainObject(value, code, message) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw backfillError(code, message);
}

function assertExactKeys(value, allowlist, location) {
  const actual = Object.keys(value).sort();
  const expected = [...allowlist].sort();
  const unknown = actual.filter((key) => !expected.includes(key));
  const missing = expected.filter((key) => !actual.includes(key));
  if (unknown.length || missing.length) {
    throw backfillError("BACKFILL_MANIFEST_SCHEMA_INVALID", `Manifest ${location} keys do not match the allowlist.`, { location, unknown_keys: unknown, missing_keys: missing });
  }
}

function feedId(environment, symbol, timeframe) {
  return `${environment}__tradingview__${symbol}__${timeframe}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function backfillError(code, message, details = {}, quarantine = []) {
  const error = new TradingViewM1BackfillError(code, message, details);
  error.quarantine = quarantine;
  return error;
}

export function createBackfillManifestTemplate({ tradingDate, utcOffset = "+02:00", files, captureProof }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(tradingDate || ""))) throw backfillError("BACKFILL_WINDOW_INVALID", "tradingDate must use YYYY-MM-DD.");
  return {
    schema_version: TRADINGVIEW_M1_BACKFILL_SCHEMA_VERSION,
    source: "tradingview",
    environment: "prod",
    timezone: "Europe/Paris",
    window: {
      start_paris: `${tradingDate}T00:00:00${utcOffset}`,
      end_paris: `${tradingDate}T22:00:00${utcOffset}`,
      semantics: "[start,end)",
    },
    files,
    capture_proof: captureProof,
  };
}
