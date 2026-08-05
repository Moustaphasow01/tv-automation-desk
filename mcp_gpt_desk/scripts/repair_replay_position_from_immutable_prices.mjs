#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import pg from "pg";
import { evaluatePositionOnRows } from "../src/position-continuity-engine.js";

const { Client } = pg;
const COLLECTIONS = Object.freeze({
  positions: "desk_replay_positions",
  runs: "desk_replay_runs",
  monitors: "desk_replay_monitors",
  simulations: "desk_replay_trade_simulations",
  timeline: "desk_replay_timeline",
});
const args = parseArgs(process.argv.slice(2));

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
if (!process.env.DESK_OBJECT_ROOT) throw new Error("DESK_OBJECT_ROOT_REQUIRED");

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`repair_replay_position:${args.positionId}`]);

  const positionRow = await oneDocumentForUpdate(COLLECTIONS.positions, args.positionId);
  const position = positionRow.data || {};
  const backtestId = position.backtest_id || position.replay_run_id;
  if (!backtestId) throw new Error("POSITION_BACKTEST_ID_MISSING");
  if (args.backtestId && args.backtestId !== backtestId) {
    throw new Error(`POSITION_BACKTEST_MISMATCH:expected=${args.backtestId}:actual=${backtestId}`);
  }
  if (position.exit_price !== null && position.exit_price !== undefined && position.exit_price !== "") {
    throw new Error(`POSITION_ALREADY_PRICED:${position.exit_price}`);
  }

  const runRow = await oneDocument(COLLECTIONS.runs, backtestId);
  const monitorRow = position.step_id
    ? await optionalDocument(COLLECTIONS.monitors, position.step_id)
    : null;
  const simulationRows = await client.query(
    `SELECT document_id, data
       FROM desk_documents
      WHERE collection = $1
        AND COALESCE(data->>'backtest_id', data->>'replay_run_id') = $2
        AND (
          data->'position_update'->>'position_id' = $3
          OR data->'position'->>'position_id' = $3
        )
      ORDER BY COALESCE(data->>'to_timestamp', data->>'as_of_utc'), document_id
      FOR UPDATE`,
    [COLLECTIONS.simulations, backtestId, args.positionId],
  );
  if (!simulationRows.rowCount) throw new Error("POSITION_SIMULATION_NOT_FOUND");

  const sourceSimulation = selectSourceSimulation(simulationRows.rows, position);
  const datasetRef = selectDatasetRef(sourceSimulation.data, position.instrument);
  const objectPath = resolveLocalObjectPath(datasetRef.object_path, process.env.DESK_OBJECT_ROOT);
  const raw = await readFile(objectPath);
  const actualSha256 = createHash("sha256").update(raw).digest("hex");
  if (datasetRef.sha256 && datasetRef.sha256 !== actualSha256) {
    throw new Error(`IMMUTABLE_DATASET_HASH_MISMATCH:expected=${datasetRef.sha256}:actual=${actualSha256}`);
  }

  const rows = parseCsv(raw.toString("utf8"))
    .filter((row) => String(row.asset || row.instrument || "").toUpperCase() === String(position.instrument || "").toUpperCase())
    .filter((row) => timestampInPositionWindow(row, position));
  if (!rows.length) throw new Error("NO_IMMUTABLE_ROWS_IN_POSITION_WINDOW");

  const openPosition = reopenForDeterministicEvaluation(position);
  const repairedAt = new Date().toISOString();
  const evaluation = evaluatePositionOnRows(openPosition, rows, {
    tick: { utc: repairedAt, paris: repairedAt },
  });
  if (!evaluation.changed || !["STOP_LOSS_HIT", "TAKE_PROFIT_1_HIT"].includes(evaluation.reason)) {
    throw new Error(`NO_DETERMINISTIC_TERMINAL_EVENT:${evaluation.reason}`);
  }

  const repaired = buildRepairedPosition({
    previous: position,
    evaluated: evaluation.position,
    eventRow: evaluation.row,
    reason: evaluation.reason,
    datasetRef,
    repairedAt,
  });
  assertExpectedOutcome(repaired, args);

  const correctedSimulations = simulationRows.rows.map((row) => ({
    ...row,
    data: patchSimulationPosition(row.data, repaired, sourceSimulation.document_id === row.document_id, evaluation.reason),
  }));
  const audit = buildRepairTimelineEvent({
    run: runRow.data,
    position: repaired,
    sourceSimulation: sourceSimulation.data,
    datasetRef,
    repairedAt,
  });
  const backup = {
    schema_version: "replay_position_immutable_repair_backup_v1",
    captured_at_utc: repairedAt,
    mode: args.mode,
    backtest_id: backtestId,
    position_id: args.positionId,
    documents: [
      { collection: COLLECTIONS.positions, document_id: positionRow.document_id, data: positionRow.data },
      ...simulationRows.rows.map((row) => ({ collection: COLLECTIONS.simulations, document_id: row.document_id, data: row.data })),
    ],
  };
  await mkdir(dirname(args.backup), { recursive: true });
  await writeFile(args.backup, `${JSON.stringify(backup, null, 2)}\n`, "utf8");

  if (args.mode === "apply") {
    await replaceDocument(COLLECTIONS.positions, positionRow.document_id, repaired);
    for (const simulation of correctedSimulations) {
      await replaceDocument(COLLECTIONS.simulations, simulation.document_id, simulation.data);
    }
    await client.query(
      `INSERT INTO desk_documents (collection, document_id, data)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (collection, document_id) DO NOTHING`,
      [COLLECTIONS.timeline, audit.event_id, JSON.stringify(audit)],
    );
    await client.query("COMMIT");
  } else {
    await client.query("ROLLBACK");
  }

  const report = {
    ok: true,
    mode: args.mode,
    backtest_id: backtestId,
    position_id: args.positionId,
    previous: compactPosition(position),
    repaired: compactPosition(repaired),
    immutable_evidence: {
      dataset: datasetRef.dataset,
      object_path: datasetRef.object_path,
      sha256: actualSha256,
      source_simulation_id: sourceSimulation.document_id,
      rows_evaluated: rows.length,
      first_timestamp_utc: rows[0]?.timestamp_utc || null,
      last_timestamp_utc: rows.at(-1)?.timestamp_utc || null,
      terminal_row: evaluation.row || null,
    },
    monitor_evidence: monitorRow?.data ? {
      monitor_id: monitorRow.data.monitor_id || monitorRow.document_id,
      decision: monitorRow.data.monitor_decision || null,
      position_check: monitorRow.data.position_check || null,
    } : null,
    corrected_simulation_documents: correctedSimulations.length,
    timeline_event_id: audit.event_id,
    backup_path: args.backup,
  };
  await mkdir(dirname(args.output), { recursive: true });
  await writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end();
}

async function oneDocumentForUpdate(collection, documentId) {
  const result = await client.query(
    `SELECT document_id, data FROM desk_documents
      WHERE collection = $1 AND document_id = $2
      FOR UPDATE`,
    [collection, documentId],
  );
  if (result.rowCount !== 1) throw new Error(`DOCUMENT_NOT_FOUND:${collection}/${documentId}`);
  return result.rows[0];
}

async function oneDocument(collection, documentId) {
  const result = await client.query(
    "SELECT document_id, data FROM desk_documents WHERE collection = $1 AND document_id = $2",
    [collection, documentId],
  );
  if (result.rowCount !== 1) throw new Error(`DOCUMENT_NOT_FOUND:${collection}/${documentId}`);
  return result.rows[0];
}

async function optionalDocument(collection, documentId) {
  const result = await client.query(
    "SELECT document_id, data FROM desk_documents WHERE collection = $1 AND document_id = $2",
    [collection, documentId],
  );
  return result.rows[0] || null;
}

async function replaceDocument(collection, documentId, data) {
  await client.query(
    `UPDATE desk_documents
        SET data = $3::jsonb,
            updated_at = now()
      WHERE collection = $1 AND document_id = $2`,
    [collection, documentId, JSON.stringify(data)],
  );
}

function selectSourceSimulation(rows, position) {
  const setupId = position.setup_record_id || position.setup_id;
  return rows.find((row) => (row.data?.setup_updates || []).some((setup) => {
    const id = setup.setup_record_id || setup.setup_id;
    return id === setupId && String(setup.status || "").toUpperCase() === "TRIGGERED";
  })) || rows[0];
}

function selectDatasetRef(simulation, instrument) {
  const expectedDataset = `${String(instrument || "").toUpperCase()}_M5`;
  const ref = (simulation.raw_refs || []).find((item) => item.dataset === expectedDataset)
    || (simulation.raw_refs || []).find((item) => String(item.dataset || "").startsWith(`${String(instrument || "").toUpperCase()}_`));
  if (!ref?.object_path) throw new Error(`IMMUTABLE_DATASET_REFERENCE_MISSING:${expectedDataset}`);
  return ref;
}

function resolveLocalObjectPath(objectPath, objectRoot) {
  const prefix = "local://";
  if (!String(objectPath || "").startsWith(prefix)) throw new Error(`UNSUPPORTED_OBJECT_PATH:${objectPath}`);
  const relativePath = String(objectPath).slice(prefix.length).replaceAll("/", process.platform === "win32" ? "\\" : "/");
  return resolve(objectRoot, relativePath);
}

function timestampInPositionWindow(row, position) {
  const timestamp = Date.parse(row.timestamp_utc || row.timestamp_paris || "");
  const opened = Date.parse(position.opened_at_utc || position.opened_at_paris || "");
  const closed = Date.parse(position.closed_at_utc || position.closed_at_paris || "");
  return Number.isFinite(timestamp)
    && Number.isFinite(opened)
    && Number.isFinite(closed)
    && timestamp >= opened
    && timestamp <= closed;
}

function reopenForDeterministicEvaluation(position) {
  const reopened = { ...position, status: "OPEN" };
  for (const key of [
    "closed_at",
    "closed_at_utc",
    "closed_at_paris",
    "exit_price",
    "exit_reason",
    "result_R",
    "result_r",
    "realized_R",
    "outcome",
    "outcome_error",
    "outcome_engine",
    "outcome_engine_version",
    "outcome_evidence",
    "outcome_evidence_hash",
    "outcome_materialized_at_utc",
    "outcome_schema_version",
    "performance_source",
  ]) delete reopened[key];
  return reopened;
}

function buildRepairedPosition({ previous, evaluated, eventRow, reason, datasetRef, repairedAt }) {
  const evidence = {
    engine: "position_continuity_engine",
    rule: reason,
    dataset: datasetRef.dataset,
    object_path: datasetRef.object_path,
    sha256: datasetRef.sha256 || null,
    timestamp_utc: eventRow?.timestamp_utc || null,
    timestamp_paris: eventRow?.timestamp_paris || null,
    high: finiteOrNull(eventRow?.high),
    low: finiteOrNull(eventRow?.low),
    exit_price: finiteOrNull(evaluated.exit_price),
    entry_price: finiteOrNull(evaluated.entry_price),
    initial_stop_loss: finiteOrNull(evaluated.initial_stop_loss),
    anti_lookahead_compliant: true,
  };
  return {
    ...previous,
    ...evaluated,
    performance_source: "deterministic_immutable_replay_prices",
    exit_price_source: "immutable_replay_price_event",
    exit_price_dataset: datasetRef.dataset,
    exit_price_timestamp_utc: eventRow?.timestamp_utc || null,
    outcome_evidence: evidence,
    outcome_evidence_hash: sha256(evidence),
    outcome_materialized_at_utc: repairedAt,
    outcome_repair: {
      schema_version: "replay_position_immutable_repair_v1",
      repaired_at_utc: repairedAt,
      previous_exit_price: previous.exit_price ?? null,
      previous_result_R: previous.result_R ?? previous.result_r ?? previous.realized_R ?? null,
      reason: "closed_position_missing_exit_price",
    },
    updated_at: repairedAt,
    updated_at_utc: repairedAt,
    updated_at_paris: repairedAt,
  };
}

function patchSimulationPosition(simulation, repaired, isSource, reason) {
  const patched = { ...simulation };
  if (patched.position_update?.position_id === repaired.position_id) patched.position_update = repaired;
  if (patched.position?.position_id === repaired.position_id) patched.position = repaired;
  if (isSource) {
    patched.result = {
      status: reason,
      note: `Conditional replay setup triggered and position resolved during the same immutable interval: ${reason}.`,
    };
  }
  return patched;
}

function buildRepairTimelineEvent({ run, position, sourceSimulation, datasetRef, repairedAt }) {
  const sequence = Number(sourceSimulation.sequence || String(sourceSimulation.step_id || "").match(/step__(\d+)/)?.[1] || 0);
  const compactAt = repairedAt.replaceAll(/[^0-9A-Za-z]/g, "_");
  return {
    event_id: `${position.backtest_id}__event__${String(sequence).padStart(4, "0")}_POSITION_OUTCOME_REPAIRED_${compactAt}`,
    event_type: "POSITION_OUTCOME_REPAIRED",
    mode: "replay",
    backtest_id: position.backtest_id,
    replay_run_id: position.replay_run_id || position.backtest_id,
    run_id: position.replay_run_id || position.backtest_id,
    strategy_id: position.strategy_id || run.strategy_id || null,
    trading_date: position.trading_date || run.trading_date || null,
    session: run.session || null,
    step_id: position.step_id || sourceSimulation.step_id || null,
    sequence,
    status: run.status || "COMPLETED",
    phase: "Performance",
    action: "REPAIR_POSITION_OUTCOME",
    note: `Position repaired from ${datasetRef.dataset}: ${position.exit_reason} at ${position.exit_price}, ${position.result_R}R.`,
    ref: { collection: COLLECTIONS.positions, document_id: position.position_id },
    anti_lookahead_compliant: true,
    created_at: repairedAt,
    created_at_utc: repairedAt,
    created_at_paris: repairedAt,
  };
}

function assertExpectedOutcome(position, input) {
  if (input.expectedExitPrice !== null && round4(position.exit_price) !== round4(input.expectedExitPrice)) {
    throw new Error(`EXIT_PRICE_MISMATCH:expected=${input.expectedExitPrice}:actual=${position.exit_price}`);
  }
  if (input.expectedResultR !== null && round4(position.result_R) !== round4(input.expectedResultR)) {
    throw new Error(`RESULT_R_MISMATCH:expected=${input.expectedResultR}:actual=${position.result_R}`);
  }
}

function compactPosition(position) {
  return {
    status: position.status || null,
    instrument: position.instrument || null,
    direction: position.direction || null,
    entry_price: position.entry_price ?? null,
    initial_stop_loss: position.initial_stop_loss ?? null,
    exit_price: position.exit_price ?? null,
    exit_reason: position.exit_reason || null,
    opened_at_utc: position.opened_at_utc || null,
    closed_at_utc: position.closed_at_utc || null,
    result_R: position.result_R ?? position.result_r ?? position.realized_R ?? null,
    performance_source: position.performance_source || null,
  };
}

function parseCsv(value) {
  const [headerLine, ...lines] = String(value || "").trim().split(/\r?\n/);
  const headers = headerLine.split(",");
  return lines.filter(Boolean).map((line) => Object.fromEntries(
    line.split(",").map((item, index) => [headers[index], item]),
  ));
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function round4(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

function parseArgs(argv) {
  const values = Object.fromEntries(argv.map((item) => {
    const [key, ...rest] = item.replace(/^--/, "").split("=");
    return [key, rest.join("=")];
  }));
  const mode = values.mode || "dry-run";
  if (!["dry-run", "apply"].includes(mode)) throw new Error(`INVALID_MODE:${mode}`);
  if (!values["position-id"]) throw new Error("POSITION_ID_REQUIRED");
  const stamp = new Date().toISOString().replaceAll(/[^0-9A-Za-z]/g, "_");
  return {
    mode,
    positionId: values["position-id"],
    backtestId: values["backtest-id"] || null,
    expectedExitPrice: optionalNumber(values["expect-exit-price"]),
    expectedResultR: optionalNumber(values["expect-result-r"]),
    output: resolve(values.output || `./local_data/reports/replay-position-repair-${stamp}.json`),
    backup: resolve(values.backup || `./local_data/backups/replay-position-repair-${stamp}.backup.json`),
  };
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`INVALID_NUMBER:${value}`);
  return parsed;
}
