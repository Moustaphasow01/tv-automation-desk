import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { candlesToRowsBySymbol } from "../src/grains-causal-detection-audit.js";
import { detectUsGrainsStrategySignals } from "../src/us-grains-strategy-suite.js";
import { createGrainsReplayDatabase, seedGrainsReplayInputs } from "../src/adapters/grains-causal-postgres-replay.js";
import { runGrainsCausalPostgresReplay } from "../src/us-grains-causal-postgres-replay.js";
import { captureGrainsCanonicalReplaySourceManifest } from "./lib/grains-source-manifest.mjs";

export async function runCausalPostgresReplayCli(argv = process.argv.slice(2)) {
  const codeHashes = await captureGrainsCanonicalReplaySourceManifest();
  const args = parseArgs(argv);
  const inputPath = required(args.input, "--input");
  const outputPath = required(args.output, "--output");
  if (resolve(inputPath) === resolve(outputPath)) throw new Error("INPUT_AND_OUTPUT_MUST_DIFFER");
  const startDate = date(args.start, "--start");
  const endDate = date(args.end, "--end");
  const asOfUtc = timestamp(args.asOf, "--as-of");
  if (startDate > endDate || asOfUtc < `${endDate}T23:59:59.999Z`) throw new Error("REPLAY_WINDOW_INVALID");
  const inputText = await readFile(inputPath, "utf8");
  const source = JSON.parse(inputText);
  const frozen = source.ledgerFrozen || source.ledger_frozen || source;
  if (!Array.isArray(frozen.candles)) throw new Error("FROZEN_CANDLES_REQUIRED");
  const candles = frozen.candles;
  const rowsBySymbol = candlesToRowsBySymbol(candles);
  const signals = detectUsGrainsStrategySignals({
    rowsBySymbol,
    agriEvents: frozen.agriEvents || frozen.agri_events || [],
    agriCalendarCoverage: frozen.agriCalendarCoverage || frozen.agri_calendar_coverage || [],
    instruments: (args.instruments || "ZW,ZC").split(",").map((item) => item.trim().toUpperCase()),
    startDate,
    endDate,
    asOfUtc,
  }).raw_signals;
  const db = await createGrainsReplayDatabase({ host: args.pgHost, port: args.pgPort, user: args.pgUser, password: args.pgPassword, adminDatabase: args.pgAdminDatabase });
  try {
    const seeded = await seedGrainsReplayInputs(db.pool, { candles, signals, asOfUtc,
      provenance: { input_sha256: sha256(inputText), code_manifest_sha256: sha256(JSON.stringify(codeHashes)) } });
    const report = await runGrainsCausalPostgresReplay({ database: db.database, pool: db.pool, persistence: db.persistence, candles, signals: seeded.runtime_signals, asOfUtc });
    if (report.provider_commands !== 0) throw new Error("PROVIDER_COMMANDS_CREATED");
    if (JSON.stringify(await captureGrainsCanonicalReplaySourceManifest()) !== JSON.stringify(codeHashes)) {
      throw new Error("REPLAY_CODE_CHANGED_DURING_RUN");
    }
    const artifact = {
      schema_version: "us_grains_causal_postgres_replay_cli_v1",
      input: { path: resolve(inputPath), sha256: sha256(inputText), candle_count: candles.length },
      source_provenance: { legacy_receipt_times: "UNVERIFIED", agri_calendar_coverage: (frozen.agriCalendarCoverage || frozen.agri_calendar_coverage)?.length ? "PROVIDED_NOT_AUTOMATICALLY_TRUSTED" : "MISSING_WAIT_EXPECTED",
        runtime_policy: "LOCAL_PIPELINE_DEFAULTS_NOT_VPS_POLICY_CERTIFIED",
        shadow_risk_max_abs_size_override: process.env.DESK_SHADOW_RISK_MAX_ABS_SIZE || null },
      constraints: { physical_execution: false, telegram: false, provider_commands: report.provider_commands, profit_claim: false },
      code_hashes: codeHashes,
      replay_bootstrap: { market_feed_mapping: seeded.market_feed_mapping,
        identities: seeded.runtime_signals.map((row) => ({ signal_id: row.signal_id, source_signal_id: row.source_signal_id, seed_identity: row.seed_identity })) },
      report,
    };
    await mkdir(dirname(resolve(outputPath)), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    return artifact;
  } finally {
    await db.close();
  }
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) result[argv[i]?.replace(/^--/, "")] = argv[i + 1];
  return { input: result.input, output: result.output, start: result.start, end: result.end, asOf: result["as-of"], instruments: result.instruments, pgHost: result["pg-host"], pgPort: result["pg-port"], pgUser: result["pg-user"], pgPassword: result["pg-password"], pgAdminDatabase: result["pg-admin-database"] };
}

function required(value, name) { if (!value || String(value).startsWith("--")) throw new Error(`REQUIRED_ARGUMENT:${name}`); return String(value); }
function date(value, name) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) throw new Error(`VALID_DATE_REQUIRED:${name}`); return value; }
function timestamp(value, name) { const parsed = Date.parse(value || ""); if (!Number.isFinite(parsed)) throw new Error(`VALID_TIMESTAMP_REQUIRED:${name}`); return new Date(parsed).toISOString(); }
function sha256(value) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const artifact = await runCausalPostgresReplayCli();
  process.stdout.write(`${JSON.stringify({ output: "written", signal_count: artifact.report.signal_count, provider_commands: artifact.report.provider_commands })}\n`);
}
