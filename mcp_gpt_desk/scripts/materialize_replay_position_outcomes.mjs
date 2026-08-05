#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import pg from "pg";
import { replayPositionToSimulatedTrade } from "../src/desk-backtest-algorithms.js";

const { Client } = pg;
const POSITION_COLLECTION = "desk_replay_positions";
const RUN_COLLECTION = "desk_replay_runs";
const MASTER_CONTRACT_ID = "DeskMasterAnalysisContract_v4_0_0";
const MASTER_CONTRACT_VERSION = "4.0.0";
const REPLAY_SCHEMA_VERSION = "2.0.0";
const args = parseArgs(process.argv.slice(2));

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["materialize_replay_position_outcomes"]);

  const runRows = await client.query(
    `SELECT document_id, data
       FROM desk_documents
      WHERE collection = $1
        AND COALESCE(data->>'trading_date', data->>'date', data->>'date_from') >= $2
        AND COALESCE(data->>'trading_date', data->>'date', data->>'date_from') <= $3
      ORDER BY document_id
      FOR UPDATE`,
    [RUN_COLLECTION, args.from, args.to],
  );
  const runs = runRows.rows
    .map((row) => ({ document_id: row.document_id, ...row.data }))
    .filter(isCanonicalV4ReplayRun);
  const runIds = runs.map((run) => run.backtest_id || run.replay_run_id || run.run_id || run.document_id);
  if (!runIds.length) throw new Error("NO_CANONICAL_V4_REPLAY_RUNS_IN_RANGE");

  const positionRows = await client.query(
    `SELECT document_id, data
       FROM desk_documents
      WHERE collection = $1
        AND COALESCE(data->>'backtest_id', data->>'replay_run_id') = ANY($2::text[])
      ORDER BY document_id
      FOR UPDATE`,
    [POSITION_COLLECTION, runIds],
  );
  const capturedAt = new Date().toISOString();
  const backupPath = resolve(args.backup || `${args.output}.backup.json`);
  const reportPath = resolve(args.output);
  const backup = {
    schema_version: "replay_position_outcome_backup_v1",
    captured_at_utc: capturedAt,
    date_range: { from: args.from, to: args.to },
    run_ids: runIds,
    position_count: positionRows.rowCount,
    documents: positionRows.rows.map((row) => ({
      collection: POSITION_COLLECTION,
      document_id: row.document_id,
      data: row.data,
    })),
  };
  await mkdir(dirname(backupPath), { recursive: true });
  await writeFile(backupPath, `${JSON.stringify(backup, null, 2)}\n`, "utf8");

  const results = positionRows.rows.map((row) => materializationFor(row, capturedAt));
  const candidates = results.filter((item) => item.action === "materialize");
  const alreadyMaterialized = results.filter((item) => item.action === "already_materialized");
  const excluded = results.filter((item) => item.action === "excluded");
  const unresolved = results.filter((item) => item.action === "unresolved");

  if (args.expectedResolvable !== null && candidates.length + alreadyMaterialized.length !== args.expectedResolvable) {
    throw new Error(`RESOLVABLE_COUNT_MISMATCH:expected=${args.expectedResolvable}:actual=${candidates.length + alreadyMaterialized.length}`);
  }

  if (args.mode === "apply") {
    for (const item of candidates) {
      await client.query(
        `UPDATE desk_documents
            SET data = data || $3::jsonb,
                updated_at = now()
          WHERE collection = $1
            AND document_id = $2`,
        [POSITION_COLLECTION, item.document_id, JSON.stringify(item.patch)],
      );
    }
  }

  const report = buildReport({
    mode: args.mode,
    capturedAt,
    runs,
    runIds,
    positionRows: positionRows.rows,
    results,
    candidates,
    alreadyMaterialized,
    excluded,
    unresolved,
    backupPath,
  });
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (args.mode === "apply") await client.query("COMMIT");
  else await client.query("ROLLBACK");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end();
}

function materializationFor(row, capturedAt) {
  const position = row.data || {};
  if (position.excluded_from_results === true || position.invalid_position_record === true) {
    return result(row, "excluded", null, "explicitly_excluded");
  }
  const simulated = replayPositionToSimulatedTrade(position);
  if (!simulated || !Number.isFinite(Number(simulated.r_result))) {
    return result(row, "unresolved", null, unresolvedReason(position, simulated));
  }
  const rResult = Number(simulated.r_result);
  const current = explicitResult(position);
  if (current !== null) {
    if (round4(current) !== round4(rResult)) {
      throw new Error(`EXISTING_RESULT_CONFLICT:${row.document_id}:stored=${current}:canonical=${rResult}`);
    }
    return result(row, "already_materialized", rResult, null);
  }
  const evidence = {
    engine: "replay_v2_positions",
    formula: simulated.direction === "short"
      ? "(entry_price-exit_price)/abs(entry_price-initial_stop_loss)"
      : "(exit_price-entry_price)/abs(entry_price-initial_stop_loss)",
    direction: simulated.direction,
    entry_price: simulated.entry_price,
    exit_price: simulated.exit_price,
    initial_stop_loss: simulated.initial_stop_loss,
    lifecycle_status: simulated.status,
    rounded_decimals: 4,
  };
  const patch = {
    result_R: rResult,
    result_r: rResult,
    realized_R: rResult,
    performance_source: "replay_v2_position_geometry",
    outcome_engine: "replay_v2_positions",
    outcome_schema_version: "replay_position_geometry_v1",
    outcome_evidence: evidence,
    outcome_evidence_hash: sha256(evidence),
    outcome_materialized_at_utc: capturedAt,
  };
  return { ...result(row, "materialize", rResult, null), patch };
}

function buildReport(input) {
  const perDay = new Map();
  for (const item of input.results) {
    const date = item.trading_date || "unknown";
    const day = perDay.get(date) || {
      positions: 0,
      materialized: 0,
      already_materialized: 0,
      excluded: 0,
      unresolved: 0,
      canonical_total_R: 0,
    };
    day.positions += 1;
    if (item.action === "materialize") day.materialized += 1;
    else day[item.action] += 1;
    if (item.result_R !== null) day.canonical_total_R = round4(day.canonical_total_R + item.result_R);
    perDay.set(date, day);
  }
  const resolved = input.results.filter((item) => item.result_R !== null);
  return {
    ok: true,
    mode: input.mode,
    generated_at_utc: input.capturedAt,
    source_of_truth: {
      engine: "replay_v2_positions",
      implementation: "src/desk-backtest-algorithms.js#replayPositionToSimulatedTrade",
      replay_mutated: false,
    },
    scope: {
      from: args.from,
      to: args.to,
      canonical_v4_runs: input.runs.length,
      run_ids: input.runIds,
    },
    counts: {
      positions: input.positionRows.length,
      resolvable: resolved.length,
      materialized: input.candidates.length,
      already_materialized: input.alreadyMaterialized.length,
      excluded: input.excluded.length,
      unresolved: input.unresolved.length,
    },
    canonical_total_R: round4(resolved.reduce((sum, item) => sum + Number(item.result_R), 0)),
    per_day: Object.fromEntries([...perDay.entries()].sort(([left], [right]) => left.localeCompare(right))),
    unresolved: input.unresolved.map(compactResult),
    excluded: input.excluded.map(compactResult),
    backup_path: input.backupPath,
  };
}

function result(row, action, rResult, reason) {
  return {
    document_id: row.document_id,
    backtest_id: row.data?.backtest_id || row.data?.replay_run_id || null,
    trading_date: row.data?.trading_date || null,
    position_id: row.data?.position_id || row.document_id,
    action,
    result_R: rResult,
    reason,
  };
}

function compactResult(item) {
  return {
    document_id: item.document_id,
    backtest_id: item.backtest_id,
    trading_date: item.trading_date,
    position_id: item.position_id,
    reason: item.reason,
  };
}

function unresolvedReason(position, simulated) {
  if (!position.position_id) return "position_id_missing";
  if (simulated?.status !== "CLOSED") return "position_not_closed";
  if (!isFiniteValue(simulated?.entry_price)) return "entry_price_missing";
  if (!isFiniteValue(simulated?.exit_price)) return "exit_price_missing";
  if (!isFiniteValue(simulated?.initial_stop_loss)) return "initial_stop_loss_missing";
  return "canonical_engine_returned_null";
}

function isFiniteValue(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function explicitResult(position) {
  for (const value of [position.result_R, position.result_r, position.realized_R]) {
    if (value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function isCanonicalV4ReplayRun(run) {
  const master = run.pinned_contracts?.master_contract || run.contract_context?.master_contract || {};
  const cadence = String(run.cadence || run.monitor_cadence || "").toLowerCase();
  return run.replay_schema_version === REPLAY_SCHEMA_VERSION
    && ["5m", "15m"].includes(cadence)
    && master.contract_id === MASTER_CONTRACT_ID
    && master.schema_version === MASTER_CONTRACT_VERSION;
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function round4(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10_000) / 10_000;
}

function parseArgs(values) {
  const parsed = {
    mode: "dry-run",
    from: "2026-06-01",
    to: "2026-06-10",
    output: "./replay-position-outcomes-report.json",
    backup: null,
    expectedResolvable: null,
  };
  for (const value of values) {
    if (value === "--apply" || value === "--mode=apply") parsed.mode = "apply";
    else if (value === "--dry-run" || value === "--mode=dry-run") parsed.mode = "dry-run";
    else if (value.startsWith("--from=")) parsed.from = value.slice("--from=".length);
    else if (value.startsWith("--to=")) parsed.to = value.slice("--to=".length);
    else if (value.startsWith("--output=")) parsed.output = value.slice("--output=".length);
    else if (value.startsWith("--backup=")) parsed.backup = value.slice("--backup=".length);
    else if (value.startsWith("--expected-resolvable=")) parsed.expectedResolvable = Number(value.slice("--expected-resolvable=".length));
    else throw new Error(`UNKNOWN_ARGUMENT:${value}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.from) || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.to) || parsed.from > parsed.to) {
    throw new Error("INVALID_DATE_RANGE");
  }
  if (!parsed.output) throw new Error("OUTPUT_PATH_REQUIRED");
  if (parsed.expectedResolvable !== null && (!Number.isInteger(parsed.expectedResolvable) || parsed.expectedResolvable < 0)) {
    throw new Error("INVALID_EXPECTED_RESOLVABLE");
  }
  return parsed;
}
