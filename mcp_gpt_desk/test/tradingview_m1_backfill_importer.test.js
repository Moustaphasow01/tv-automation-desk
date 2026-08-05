import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  importTradingViewM1Backfill,
  loadTradingViewM1Backfill,
  parseTradingViewM1BackfillArgs,
  TRADINGVIEW_M1_BACKFILL_ROW_COUNT,
} from "../src/tradingview-m1-backfill-importer.js";

const WINDOW = {
  start_paris: "2026-06-11T00:00:00+02:00",
  end_paris: "2026-06-11T22:00:00+02:00",
  semantics: "[start,end)",
};

function captureProofJsonl({ lagSeconds = 60 } = {}) {
  const rows = [];
  const startMs = Date.parse(WINDOW.start_paris);
  for (const symbol of ["MNQ1!", "MES1!"]) {
    for (let index = 0; index < TRADINGVIEW_M1_BACKFILL_ROW_COUNT; index += 1) {
      const timestampMs = startMs + index * 60_000;
      const barCloseMs = timestampMs + 60_000;
      rows.push(JSON.stringify({
        symbol,
        timestamp_utc: new Date(timestampMs).toISOString(),
        bar_close_utc: new Date(barCloseMs).toISOString(),
        captured_at_cursor_utc: new Date(barCloseMs + lagSeconds * 1_000).toISOString(),
        settlement_lag_seconds: lagSeconds,
      }));
    }
  }
  return Buffer.from(`${rows.join("\n")}\n`);
}

function fixtureFiles({
  corruptHash = false,
  corruptProofHash = false,
  extraManifestKey = false,
  schemaVersion = "tradingview-m1-backfill-manifest-v2",
  proofLagSeconds = 60,
  duplicateProofKey = false,
} = {}) {
  const root = join(tmpdir(), "tv-m1-backfill-test");
  const csvBySymbol = new Map([
    ["MNQ1!", candleCsv("MNQ1!", 20_000)],
    ["MES1!", candleCsv("MES1!", 5_000)],
  ]);
  const canonicalProofBytes = captureProofJsonl({ lagSeconds: proofLagSeconds });
  const proofBytes = duplicateProofKey
    ? Buffer.from(canonicalProofBytes.toString("utf8").replace(
      '"symbol":"MNQ1!"',
      '"symbol":"MES1!"',
    ))
    : canonicalProofBytes;
  const files = [...csvBySymbol].map(([symbol, bytes]) => ({
    path: symbol === "MNQ1!" ? "mnq.csv" : "mes.csv",
    symbol,
    timeframe: "1",
    sha256: corruptHash && symbol === "MNQ1!" ? "0".repeat(64) : sha256(bytes),
    row_count: TRADINGVIEW_M1_BACKFILL_ROW_COUNT,
  }));
  const manifest = {
    schema_version: schemaVersion,
    source: "tradingview",
    environment: "prod",
    timezone: "Europe/Paris",
    window: WINDOW,
    files,
    capture_proof: {
      path: "capture-proof.jsonl",
      sha256: corruptProofHash ? "0".repeat(64) : sha256(proofBytes),
      row_count: 2_640,
      policy_version: "settled_closed_bar_v2",
      minimum_settlement_lag_seconds: proofLagSeconds,
      premature_capture_count: 0,
    },
    ...(extraManifestKey ? { arbitrary: true } : {}),
  };
  const entries = new Map([
    [join(root, "manifest.json"), Buffer.from(JSON.stringify(manifest))],
    [join(root, "mnq.csv"), csvBySymbol.get("MNQ1!")],
    [join(root, "mes.csv"), csvBySymbol.get("MES1!")],
    [join(root, "capture-proof.jsonl"), proofBytes],
  ]);
  return {
    manifestPath: join(root, "manifest.json"),
    manifest,
    proofBytes,
    read: async (path) => {
      const value = entries.get(path);
      if (!value) throw new Error(`missing fixture ${path}`);
      return value;
    },
  };
}

function candleCsv(symbol, initialPrice) {
  const lines = ["timestamp_utc,open,high,low,close,volume,is_closed"];
  const startMs = Date.parse(WINDOW.start_paris);
  const symbolOffset = symbol === "MNQ1!" ? 0 : 100;
  for (let index = 0; index < TRADINGVIEW_M1_BACKFILL_ROW_COUNT; index += 1) {
    const price = initialPrice + symbolOffset + Math.floor(index / 5) * 0.25;
    lines.push(`${new Date(startMs + index * 60_000).toISOString()},${price},${price + 0.25},${price - 0.25},${price},${100 + index},true`);
  }
  return Buffer.from(`${lines.join("\n")}\n`);
}

function crossRows({ divergence = false, withinTolerance = false, missingEvery = 0 } = {}) {
  const rows = [];
  const startMs = Date.parse(WINDOW.start_paris);
  for (const [symbol, initialPrice] of [["MNQ1!", 20_000], ["MES1!", 5_100]]) {
    for (let bucket = 0; bucket < TRADINGVIEW_M1_BACKFILL_ROW_COUNT / 5; bucket += 1) {
      const price = initialPrice + bucket * 0.25;
      const missing = missingEvery > 0 && bucket % missingEvery === 0;
      rows.push({
        symbol_code: symbol,
        bucket_utc: new Date(startMs + bucket * 5 * 60_000),
        m1_count: 5,
        m1_open: price,
        m1_high: price + 0.25,
        m1_low: price - 0.25,
        m1_close: price,
        m5_open: missing ? null : price,
        m5_high: missing ? null : price + 0.25,
        m5_low: missing ? null : price - 0.25,
        m5_close: missing ? null : price,
        m5_timestamp_utc: missing ? null : new Date(startMs + bucket * 5 * 60_000),
        m5_missing: missing,
        max_delta: divergence && symbol === "MNQ1!" && bucket === 0
          ? 0.5
          : (withinTolerance && symbol === "MNQ1!" && bucket === 1 ? 0.25 : (missing ? null : 0)),
        tolerance: 0.25,
      });
    }
  }
  return rows;
}

function fakePool({ conflicts = [], cross = crossRows(), inserted = 2_640, prior = null } = {}) {
  const calls = [];
  let connections = 0;
  const main = client("main");
  const quarantine = client("quarantine");
  function client(role) {
    return {
      async query(sql, params = []) {
        const text = String(sql);
        calls.push({ role, sql: text, params });
        if (role === "quarantine") return { rows: [], rowCount: 1 };
        if (text.includes("SELECT status, mode, options, report FROM desk_import_runs")) return { rows: prior ? [prior] : [] };
        if (text.includes("FROM market_feeds mf") && text.includes("FOR UPDATE OF mf")) {
          return { rows: [
            { feed_id: "prod__tradingview__MES1!__1", instrument_code: "MES", timeframe: "1", environment: "prod", provider: "tradingview", symbol_code: "MES1!" },
            { feed_id: "prod__tradingview__MNQ1!__1", instrument_code: "MNQ", timeframe: "1", environment: "prod", provider: "tradingview", symbol_code: "MNQ1!" },
          ] };
        }
        if (text.includes("jsonb_build_object('open', s.open")) return { rows: conflicts };
        if (text.includes("WITH buckets AS")) return { rows: cross };
        if (text.includes("INSERT INTO market_candles")) return { rows: [], rowCount: inserted };
        if (text.includes("UPDATE market_feeds mf")) return { rows: [{ feed_id: "mnq" }, { feed_id: "mes" }], rowCount: 2 };
        return { rows: [], rowCount: 1 };
      },
      release() { calls.push({ role, sql: "RELEASE", params: [] }); },
    };
  }
  return {
    pool: { async connect() { connections += 1; return connections === 1 ? main : quarantine; } },
    calls,
  };
}

test("manifest and CSV loader enforces allowlist, SHA256, exact 1320-row M1 grid and closed OHLC", async () => {
  const fixture = fixtureFiles();
  const plan = await loadTradingViewM1Backfill(fixture.manifestPath, { read: fixture.read });
  assert.equal(plan.files.length, 2);
  assert.equal(plan.total_rows, 2_640);
  assert.equal(plan.files.every((file) => file.rows.length === 1_320), true);
  assert.equal(plan.files[0].rows[0].timestamp_utc, "2026-06-10T22:00:00.000Z");
  assert.match(plan.manifest_sha256, /^[a-f0-9]{64}$/);
  assert.equal(plan.capture_proof.rows.length, 2_640);
  assert.equal(plan.capture_proof.policy_version, "settled_closed_bar_v2");
  assert.equal(plan.capture_proof.minimum_settlement_lag_seconds, 60);

  const unknown = fixtureFiles({ extraManifestKey: true });
  await assert.rejects(
    loadTradingViewM1Backfill(unknown.manifestPath, { read: unknown.read }),
    (error) => error.code === "BACKFILL_MANIFEST_SCHEMA_INVALID" && error.details.unknown_keys.includes("arbitrary"),
  );
  const corrupted = fixtureFiles({ corruptHash: true });
  await assert.rejects(
    loadTradingViewM1Backfill(corrupted.manifestPath, { read: corrupted.read }),
    (error) => error.code === "BACKFILL_CSV_SHA256_MISMATCH",
  );
  const corruptedProof = fixtureFiles({ corruptProofHash: true });
  await assert.rejects(
    loadTradingViewM1Backfill(corruptedProof.manifestPath, { read: corruptedProof.read }),
    (error) => error.code === "BACKFILL_CAPTURE_PROOF_SHA256_MISMATCH",
  );
  const legacyV1 = fixtureFiles({ schemaVersion: "tradingview-m1-backfill-manifest-v1" });
  await assert.rejects(
    loadTradingViewM1Backfill(legacyV1.manifestPath, { read: legacyV1.read }),
    (error) => error.code === "BACKFILL_MANIFEST_SCHEMA_INVALID",
  );
  const premature = fixtureFiles({ proofLagSeconds: 59 });
  await assert.rejects(
    loadTradingViewM1Backfill(premature.manifestPath, { read: premature.read }),
    (error) => error.code === "BACKFILL_CAPTURE_PROOF_LAG_INVALID",
  );
  const duplicateProof = fixtureFiles({ duplicateProofKey: true });
  await assert.rejects(
    loadTradingViewM1Backfill(duplicateProof.manifestPath, { read: duplicateProof.read }),
    (error) => error.code === "BACKFILL_CAPTURE_PROOF_DUPLICATE",
  );
});

test("dry-run executes staging, conflict and M1/M5 validation, merge and feed metadata update then rolls back", async () => {
  const fixture = fixtureFiles();
  const db = fakePool({ cross: crossRows({ missingEvery: 50, withinTolerance: true }) });
  const receipt = await importTradingViewM1Backfill(db.pool, {
    manifestPath: fixture.manifestPath,
    read: fixture.read,
    dryRun: true,
    now: () => new Date("2026-07-30T12:00:00.000Z"),
  });

  assert.equal(receipt.status, "DRY_RUN_VALIDATED");
  assert.equal(receipt.committed, false);
  assert.equal(receipt.validation_summary.inserted, 2_640);
  assert.equal(receipt.validation_summary.noop, 0);
  assert.equal(receipt.validation_summary.conflicts, 0);
  assert.equal(receipt.validation_summary.m5_compared, 516);
  assert.equal(receipt.validation_summary.m5_mismatch, 1);
  assert.equal(receipt.cross_timeframe.within_tolerance_mismatch_buckets, 1);
  assert.equal(receipt.cross_timeframe.missing_m5_buckets, 12);
  assert.match(receipt.manifest.sha256, /^[a-f0-9]{64}$/);
  assert.equal(receipt.capture_proof.policy_version, "settled_closed_bar_v2");
  assert.equal(receipt.capture_proof.row_count, 2_640);
  assert.equal(receipt.capture_proof.minimum_settlement_lag_seconds, 60);
  assert.equal(JSON.stringify(receipt).includes(fixture.manifestPath), false);

  const mainCommands = db.calls.filter((call) => call.role === "main").map((call) => call.sql);
  assert.equal(mainCommands[0], "BEGIN ISOLATION LEVEL SERIALIZABLE");
  assert.equal(mainCommands.at(-2), "ROLLBACK");
  assert.equal(mainCommands.at(-1), "RELEASE");
  const insertIndex = mainCommands.findIndex((sql) => sql.includes("INSERT INTO market_candles"));
  const updateIndex = mainCommands.findIndex((sql) => sql.includes("UPDATE market_feeds mf"));
  assert.ok(insertIndex > 0 && updateIndex > insertIndex);
  assert.match(mainCommands[insertIndex], /capture_proof_sha256/);
  assert.match(mainCommands[insertIndex], /capture_policy_version/);
  assert.match(mainCommands[updateIndex], /GREATEST\(mf\.latest_timestamp_utc, latest\.latest_timestamp_utc\)/);
  assert.match(mainCommands[updateIndex], /latest\.latest_timestamp_utc > mf\.latest_timestamp_utc/);
  const crossCall = db.calls.find((call) => call.sql.includes("WITH buckets AS"));
  assert.equal(crossCall.params[0], 0.25);
  assert.match(crossCall.sql, /count\(\*\)::integer AS m1_count/);
  assert.match(crossCall.sql, /INTERVAL '4 minutes'/);
});

test("identical existing candles are no-op and never overwritten", async () => {
  const fixture = fixtureFiles();
  const db = fakePool({ inserted: 0 });
  const receipt = await importTradingViewM1Backfill(db.pool, {
    manifestPath: fixture.manifestPath,
    read: fixture.read,
    dryRun: true,
  });
  assert.equal(receipt.rows.inserted, 0);
  assert.equal(receipt.rows.identical_noop, 2_640);
  assert.equal(receipt.rows.overwritten, 0);
  const merge = db.calls.find((call) => call.sql.includes("INSERT INTO market_candles"));
  assert.match(merge.sql, /WHERE NOT EXISTS/);
  assert.match(merge.sql, /ON CONFLICT \(feed_id, timestamp_utc\) DO NOTHING/);
  assert.doesNotMatch(merge.sql, /DO UPDATE/);
});

test("different existing candle rolls back main transaction and persists idempotent quarantine without merge", async () => {
  const fixture = fixtureFiles();
  const conflict = {
    feed_id: "prod__tradingview__MNQ1!__1",
    symbol_code: "MNQ1!",
    timestamp_utc: new Date("2026-06-10T22:00:00.000Z"),
    incoming: { open: 20_000, high: 20_000.25, low: 19_999.75, close: 20_000, volume: 100, is_closed: true },
    existing: { open: 20_001, high: 20_001.25, low: 20_000.75, close: 20_001, volume: 100, is_closed: true },
  };
  const db = fakePool({ conflicts: [conflict] });
  await assert.rejects(
    importTradingViewM1Backfill(db.pool, { manifestPath: fixture.manifestPath, read: fixture.read }),
    (error) => error.code === "BACKFILL_EXISTING_VALUE_CONFLICT",
  );
  const main = db.calls.filter((call) => call.role === "main").map((call) => call.sql);
  assert.ok(main.includes("ROLLBACK"));
  assert.equal(main.some((sql) => sql.includes("INSERT INTO market_candles")), false);
  const quarantine = db.calls.filter((call) => call.role === "quarantine").map((call) => call.sql);
  assert.ok(quarantine.some((sql) => sql.includes("INSERT INTO desk_document_quarantine")));
  assert.ok(quarantine.some((sql) => sql.includes("ON CONFLICT (source_collection, source_document_id, reason) DO NOTHING")));
  assert.ok(quarantine.includes("COMMIT"));
});

test("M1/M5 divergence beyond the 0.25 tick tolerance rolls back before candle merge", async () => {
  const fixture = fixtureFiles();
  const db = fakePool({ cross: crossRows({ divergence: true }) });
  await assert.rejects(
    importTradingViewM1Backfill(db.pool, { manifestPath: fixture.manifestPath, read: fixture.read, dryRun: true }),
    (error) => error.code === "BACKFILL_M1_M5_DIVERGENCE"
      && error.details.divergences[0].max_delta === 0.5,
  );
  const main = db.calls.filter((call) => call.role === "main").map((call) => call.sql);
  assert.ok(main.includes("ROLLBACK"));
  assert.equal(main.some((sql) => sql.includes("INSERT INTO market_candles")), false);
  assert.equal(db.calls.some((call) => call.role === "quarantine"), false);
});

test("completed manifest hash is an idempotent no-op and CLI only accepts manifest plus dry-run", async () => {
  const fixture = fixtureFiles();
  const plan = await loadTradingViewM1Backfill(fixture.manifestPath, { read: fixture.read });
  const stored = {
    ok: true,
    import_id: plan.import_id,
    manifest: { file: "manifest.json", sha256: plan.manifest_sha256 },
    rows: { inserted: 2_640, identical_noop: 0, conflicts: 0, overwritten: 0 },
  };
  const db = fakePool({ prior: {
    status: "completed",
    mode: "import",
    options: { manifest_sha256: plan.manifest_sha256 },
    report: stored,
  } });
  const receipt = await importTradingViewM1Backfill(db.pool, { manifestPath: fixture.manifestPath, read: fixture.read });
  assert.equal(receipt.status, "ALREADY_IMPORTED");
  assert.equal(receipt.idempotent, true);
  assert.equal(db.calls.some((call) => call.sql.includes("CREATE TEMP TABLE")), false);
  assert.equal(db.calls.some((call) => call.sql === "COMMIT"), true);

  const parsed = parseTradingViewM1BackfillArgs(["--manifest=./sealed.json", "--dry-run"], {});
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.manifestPath.replaceAll("\\", "/").endsWith("/sealed.json"), true);
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("Python settlement helpers exclude forming bars and never advance across a missing minute", () => {
  const scriptPath = fileURLToPath(new URL("../../scripts/db/export_tradingview_replay_m1_backfill.py", import.meta.url));
  const python = [
    "import importlib.util, sys",
    "path = sys.argv[1]",
    "spec = importlib.util.spec_from_file_location('tv_exporter', path)",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "assert module.settled_capture_end_epoch(119, 180) == 0",
    "assert module.settled_capture_end_epoch(120, 180) == 60",
    "assert module.settled_capture_end_epoch(239, 180) == 120",
    "assert module.settled_capture_end_epoch(240, 180) == 180",
    "bar = {'time': 0, 'open': 1, 'high': 1, 'low': 1, 'close': 1, 'volume': 1}",
    "stored = {}",
    "module.merge_settled_bars(stored, [bar], captured_at_cursor_epoch=120, start_epoch=0, settled_end_epoch=60)",
    "assert stored[0]['_settlement_lag_seconds'] == 60",
    "try:",
    "    module.merge_settled_bars({}, [bar], captured_at_cursor_epoch=119, start_epoch=0, settled_end_epoch=60)",
    "except RuntimeError:",
    "    pass",
    "else:",
    "    raise AssertionError('premature bar capture was accepted')",
    "assert module.contiguous_capture_cursor({0: bar, 120: {**bar, 'time': 120}}, capture_from=0, settled_end_epoch=180) == 60",
  ].join("\n");
  const result = spawnSync("python3", ["-c", python, scriptPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("Python Bar Replay conversion rejects v1 acquisition then accepts only proof-bound v2", async () => {
  const root = await mkdtemp(join(tmpdir(), "tv-m1-python-compat-"));
  try {
    const combinedPath = join(root, "legacy-combined.csv");
    const acquisitionPath = join(root, "legacy-manifest.json");
    const proofPath = join(root, "legacy-capture-proof.jsonl");
    const outputDir = join(root, "import-ready");
    const combined = legacyCombinedCsv();
    await writeFile(combinedPath, combined);
    await writeFile(acquisitionPath, JSON.stringify({
      schema_version: "tradingview-bar-replay-m1-backfill-v1",
      csv_sha256: sha256(combined),
      row_count: 2_640,
    }));
    const scriptPath = fileURLToPath(new URL("../../scripts/db/export_tradingview_replay_m1_backfill.py", import.meta.url));
    const args = [
      scriptPath,
      "--trading-date", "2026-06-11",
      "--output-dir", outputDir,
      "--convert-combined-csv", combinedPath,
      "--acquisition-manifest", acquisitionPath,
    ];
    const rejected = spawnSync("python3", args, { encoding: "utf8" });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /legacy_acquisition_settlement_policy_unproven/);

    const proof = captureProofJsonl();
    await writeFile(proofPath, proof);
    await writeFile(acquisitionPath, JSON.stringify({
      schema_version: "tradingview-bar-replay-m1-backfill-v2",
      capture_policy_version: "settled_closed_bar_v2",
      csv_sha256: sha256(combined),
      row_count: 2_640,
      capture_proof: {
        path: "legacy-capture-proof.jsonl",
        sha256: sha256(proof),
        row_count: 2_640,
        policy_version: "settled_closed_bar_v2",
        minimum_settlement_lag_seconds: 60,
        premature_capture_count: 0,
      },
      validation: {
        all_bars_closed_proven: true,
        premature_capture_count: 0,
        proofed_bar_count: 2_640,
        minimum_settlement_lag_seconds: 60,
      },
    }));
    const result = spawnSync("python3", args, { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);

    const plan = await loadTradingViewM1Backfill(join(outputDir, "tradingview_m1_backfill_manifest.json"));
    assert.equal(plan.total_rows, 2_640);
    assert.equal(plan.manifest.schema_version, "tradingview-m1-backfill-manifest-v2");
    assert.equal(plan.capture_proof.rows.length, 2_640);
    assert.equal(plan.capture_proof.minimum_settlement_lag_seconds, 60);
    assert.deepEqual(plan.files.map((file) => [file.symbol, file.rows.length]), [
      ["MNQ1!", 1_320],
      ["MES1!", 1_320],
    ]);
    const acquisition = JSON.parse(await readFile(join(outputDir, "tradingview_replay_m1_acquisition_report.json"), "utf8"));
    assert.equal(acquisition.validation.exact_1320_rows_per_feed, true);
    assert.equal(acquisition.validation.all_bars_closed_proven, true);
    assert.equal(acquisition.validation.proofed_bar_count, 2_640);
    assert.equal(acquisition.validation.premature_capture_count, 0);
    assert.equal(acquisition.capture_proof.sha256, sha256(await readFile(join(outputDir, acquisition.capture_proof.path))));
    assert.equal(acquisition.legacy_acquisition.csv_sha256, sha256(combined));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function legacyCombinedCsv() {
  const header = "feed_id,symbol_code,provider_symbol,timeframe,timestamp_utc,timestamp_paris,trading_date,open,high,low,close,volume,is_closed";
  const rows = [];
  for (const [symbol, initialPrice] of [["MNQ1!", 20_000], ["MES1!", 5_000]]) {
    const canonical = candleCsv(symbol, initialPrice).toString("utf8").trim().split("\n").slice(1);
    for (const line of canonical) {
      const [timestamp, open, high, low, close, volume, closed] = line.split(",");
      const paris = new Date(Date.parse(timestamp) + 2 * 60 * 60_000).toISOString().replace("Z", "+02:00");
      rows.push([
        `prod__tradingview__${symbol}__1`, symbol, `CME_MINI:${symbol}`, "1", timestamp, paris, "2026-06-11",
        open, high, low, close, volume, closed,
      ].join(","));
    }
  }
  return Buffer.from(`${header}\n${rows.join("\n")}\n`);
}
