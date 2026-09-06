import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { candlesToRowsBySymbol } from "../src/grains-causal-detection-audit.js";
import { detectCalendarVersionedGrainsSignals } from "../src/grains-calendar-detection.js";
import {
  createGrainsReplayDatabase,
  seedGrainsReplayCalendar,
  seedGrainsReplayInputs,
} from "../src/adapters/grains-causal-postgres-replay.js";
import { runGrainsCausalPostgresReplay } from "../src/us-grains-causal-postgres-replay.js";
import { loadGrainsCalendarVersionAt } from "../src/persistence/postgres-grains-calendar-ledger.js";
import { captureGrainsCanonicalReplaySourceManifest } from "./lib/grains-source-manifest.mjs";
import { loadGrainsReplayRiskPolicy } from "./lib/grains-replay-risk-policy.mjs";

export async function runCausalPostgresReplayCli(argv = process.argv.slice(2)) {
  const codeHashes = await captureGrainsCanonicalReplaySourceManifest();
  const args = parseArgs(argv);
  const inputPath = required(args.input, "--input");
  const outputPath = required(args.output, "--output");
  if (resolve(inputPath) === resolve(outputPath)) throw new Error("INPUT_AND_OUTPUT_MUST_DIFFER");
  if (args.policyFile && resolve(args.policyFile) === resolve(outputPath)) throw new Error("POLICY_AND_OUTPUT_MUST_DIFFER");
  const riskPolicy = await loadGrainsReplayRiskPolicy(args.policyFile);
  const startDate = date(args.start, "--start");
  const endDate = date(args.end, "--end");
  const asOfUtc = timestamp(args.asOf, "--as-of");
  if (startDate > endDate || asOfUtc < `${endDate}T23:59:59.999Z`) throw new Error("REPLAY_WINDOW_INVALID");
  const inputText = await readFile(inputPath, "utf8");
  const source = JSON.parse(inputText);
  const frozen = source.ledgerFrozen || source.ledger_frozen || source;
  if (!Array.isArray(frozen.candles)) throw new Error("FROZEN_CANDLES_REQUIRED");
  const candles = frozen.candles;
  const calendarVersions = frozenCalendarVersions(frozen);
  const db = await createGrainsReplayDatabase({ host: args.pgHost, port: args.pgPort, user: args.pgUser, password: args.pgPassword, adminDatabase: args.pgAdminDatabase });
  try {
    const artifact = await executeFrozenReplay({ db, args, inputPath, inputText, frozen, candles,
      calendarVersions, codeHashes, riskPolicy, startDate, endDate, asOfUtc });
    if (artifact.report.provider_commands !== 0) throw new Error("PROVIDER_COMMANDS_CREATED");
    if (JSON.stringify(await captureGrainsCanonicalReplaySourceManifest()) !== JSON.stringify(codeHashes)) {
      throw new Error("REPLAY_CODE_CHANGED_DURING_RUN");
    }
    await mkdir(dirname(resolve(outputPath)), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    return artifact;
  } finally {
    await db.close();
  }
}

async function executeFrozenReplay({ db, args, inputPath, inputText, frozen, candles,
  calendarVersions, codeHashes, riskPolicy, startDate, endDate, asOfUtc }) {
    const rowsBySymbol = candlesToRowsBySymbol(candles);
    const calendarSeed = await seedGrainsReplayCalendar(db.pool, {
      calendarVersions,
      asOfUtc,
    });
    const calendarRuntime = await loadGrainsCalendarVersionAt(db.pool, {
      startUtc: calendarStartUtc(startDate),
      asOfUtc,
    });
    const detection = await detectCalendarVersionedGrainsSignals({
      detectionInput: { rowsBySymbol, startDate, endDate, asOfUtc,
        instruments: (args.instruments || "ZW,ZC").split(",").map((item) => item.trim().toUpperCase()) },
      calendarKnownTimes: calendarVersions.map((version) => version.knownAtUtc),
      readCalendarAt: (cutoff) => loadGrainsCalendarVersionAt(db.pool, {
        startUtc: calendarStartUtc(startDate), asOfUtc: cutoff,
      }),
    });
    const signals = detection.raw_signals;
    const seeded = await seedGrainsReplayInputs(db.pool, { candles, signals, asOfUtc,
      provenance: { input_sha256: sha256(inputText), code_manifest_sha256: sha256(JSON.stringify(codeHashes)) } });
    const report = await runGrainsCausalPostgresReplay({
      database: db.database,
      pool: db.pool,
      persistence: db.persistence,
      candles,
      signals: seeded.runtime_signals,
      asOfUtc,
      calendarRuntime,
      pipelinePolicy: riskPolicy.pipelinePolicy,
      accountId: riskPolicy.accountId,
    });
    return buildReplayArtifact({ inputPath, inputText, frozen, candles, calendarVersions,
      codeHashes, calendarSeed, calendarRuntime, detection, seeded, report, riskPolicy });
}

export function buildReplayArtifact({ inputPath, inputText, frozen, candles, calendarVersions,
  codeHashes, calendarSeed, calendarRuntime, detection, seeded, report, riskPolicy }) {
  return {
      schema_version: "us_grains_causal_postgres_replay_cli_v1",
      input: { path: resolve(inputPath), sha256: sha256(inputText), candle_count: candles.length },
      source_provenance: { legacy_receipt_times: "UNVERIFIED", agri_calendar_coverage: calendarVersions.length ? "LEDGER_VERSIONED" : "MISSING_WAIT_EXPECTED",
        runtime_policy: riskPolicy?.provenance || "LOCAL_PIPELINE_DEFAULTS_NOT_VPS_POLICY_CERTIFIED",
        shadow_risk_max_abs_size_override: process.env.DESK_SHADOW_RISK_MAX_ABS_SIZE || null },
      constraints: { physical_execution: false, telegram: false, provider_commands: report.provider_commands, profit_claim: false },
      code_hashes: codeHashes,
      replay_bootstrap: { market_feed_mapping: seeded.market_feed_mapping,
        detected_signals_sha256: sha256(JSON.stringify(detection.raw_signals || [])),
        calendar: {
          seed: calendarSeed,
          runtime: calendarRuntime,
          knowledge_intervals: detection.calendar_intervals,
          ignored_unversioned_event_count: array(frozen.agriEvents || frozen.agri_events).length,
          ignored_unversioned_coverage_count: array(frozen.agriCalendarCoverage || frozen.agri_calendar_coverage).length,
        },
        identities: seeded.runtime_signals.map((row) => ({ signal_id: row.signal_id, source_signal_id: row.source_signal_id, seed_identity: row.seed_identity })) },
      report,
    };
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) result[argv[i]?.replace(/^--/, "")] = argv[i + 1];
  return { input: result.input, output: result.output, policyFile: result["policy-file"], start: result.start, end: result.end, asOf: result["as-of"], instruments: result.instruments, pgHost: result["pg-host"], pgPort: result["pg-port"], pgUser: result["pg-user"], pgPassword: result["pg-password"], pgAdminDatabase: result["pg-admin-database"] };
}

function required(value, name) { if (!value || String(value).startsWith("--")) throw new Error(`REQUIRED_ARGUMENT:${name}`); return String(value); }
function date(value, name) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) throw new Error(`VALID_DATE_REQUIRED:${name}`); return value; }
function timestamp(value, name) { const parsed = Date.parse(value || ""); if (!Number.isFinite(parsed)) throw new Error(`VALID_TIMESTAMP_REQUIRED:${name}`); return new Date(parsed).toISOString(); }
function sha256(value) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function array(value) { return Array.isArray(value) ? value : []; }
function frozenCalendarVersions(frozen) {
  const plural = frozen.agriCalendarVersions || frozen.agri_calendar_versions ||
    frozen.calendarVersions || frozen.calendar_versions;
  if (Array.isArray(plural)) return plural;
  const singular = frozen.agriCalendarVersion || frozen.agri_calendar_version ||
    frozen.calendarVersion || frozen.calendar_version;
  return singular && typeof singular === "object" ? [singular] : [];
}
function calendarStartUtc(startDate) {
  return new Date(Date.parse(`${startDate}T00:00:00.000Z`) - 8 * 86_400_000).toISOString();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const artifact = await runCausalPostgresReplayCli();
  process.stdout.write(`${JSON.stringify({ output: "written", signal_count: artifact.report.signal_count, provider_commands: artifact.report.provider_commands })}\n`);
}
