#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { createDeskStoreFromEnv } from "../src/store.js";

const CONFIG_COLLECTION = "desk_replay_autopilot_configs";
const args = parseArgs(process.argv.slice(2));
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "../..");
await loadEnvFile(resolve(args.env || join(projectRoot, ".env")));

const store = createDeskStoreFromEnv();
try {
  await store.persistence.initialized;
  const tick = store.clock.now();
  const [configs, runs, preparations] = await Promise.all([
    store.persistence.listDocuments(CONFIG_COLLECTION, 500),
    store.persistence.listDocuments(DESK_COLLECTIONS.deskReplayRuns, 500),
    store.persistence.listDocuments(DESK_COLLECTIONS.deskReplayPreparationJobs, 500),
  ]);
  const runIds = new Set(runs.map((run) => run.backtest_id || run.replay_run_id || run.run_id).filter(Boolean));
  const candidates = selectCandidates(configs, runIds, args);
  if (args.expectedCount !== null && candidates.length !== args.expectedCount) {
    throw new Error(`REPLAY_M5_MIGRATION_COUNT_MISMATCH:expected=${args.expectedCount}:actual=${candidates.length}`);
  }

  const backupPath = resolve(args.backup || `./replay-m5-migration-${tick.epochMs}.backup.json`);
  const outputPath = resolve(args.output || `./replay-m5-migration-${tick.epochMs}.report.json`);
  await mkdir(dirname(backupPath), { recursive: true });
  await writeFile(backupPath, `${JSON.stringify({
    schema_version: "replay_m5_queue_migration_backup_v1",
    captured_at_utc: tick.utc,
    candidate_count: candidates.length,
    configs: candidates,
    preparations: preparations.filter((job) => candidates.some((config) => config.config_id === job.config_id)),
  }, null, 2)}\n`, "utf8");

  const results = [];
  if (args.apply) {
    for (const config of candidates) {
      try {
        results.push(await migrateConfig(store, config, preparations));
      } catch (error) {
        const failure = {
          ok: false,
          outcome: "FAILED",
          old_config_id: config.config_id,
          trading_date: config.trading_date,
          error_code: error?.code || "REPLAY_M5_MIGRATION_FAILED",
          error_message: error?.message || String(error),
        };
        if (args.pauseMissingM1 && isMissingM1Failure(error)) {
          await pauseConfigMissingM1(store, config);
          results.push({
            ...failure,
            ok: true,
            outcome: "PAUSED_M1_DATA_MISSING",
            old_config_paused: true,
          });
        } else {
          results.push(failure);
        }
      }
    }
  }

  const report = {
    ok: results.every((item) => item.ok !== false),
    status: args.apply ? "APPLIED" : "DRY_RUN",
    generated_at_utc: store.clock.now().utc,
    source_cadence: "15m",
    target_gpt_cadence: "5m",
    deterministic_engine_cadence: "1m",
    selection_rule: "enabled READY configs without any replay run",
    candidate_count: candidates.length,
    migrated_count: results.filter((item) => item.outcome === "MIGRATED").length,
    paused_missing_m1_count: results.filter((item) => item.outcome === "PAUSED_M1_DATA_MISSING").length,
    failed_count: results.filter((item) => item.ok === false).length,
    candidates: candidates.map(compactConfig),
    results,
    backup_path: backupPath,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ...report, output_path: outputPath }, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
} finally {
  await store.persistence.close?.();
}

async function migrateConfig(storeInstance, oldConfig, preparations) {
  const idempotencyKey = `replay-m5-m1-migration:${oldConfig.config_id}`;
  const created = await storeInstance.createReplayPreparation({
    trading_date: oldConfig.trading_date,
    cadence: "5m",
    start_time: oldConfig.start_time,
    end_time: oldConfig.end_time,
    worker_group: oldConfig.worker_group || "replay-v4",
    priority: oldConfig.priority || 100,
    instruments: oldConfig.instruments,
    idempotency_key: idempotencyKey,
  });
  let job = created.jobs?.[0];
  if (!job) throw new Error(`REPLAY_M5_PREPARATION_NOT_CREATED:${oldConfig.config_id}`);

  if (["QUEUED", "DATA_CHECK", "PACK_BUILDING"].includes(job.status)) {
    const processed = await storeInstance.replayPreparation.process({
      preparation_id: job.preparation_id,
      worker_id: "replay-m5-queue-migration",
    });
    job = processed.job;
  }
  if (job?.status === "FAILED") {
    throw Object.assign(new Error(job.error?.message || `M5 preparation failed for ${oldConfig.config_id}`), {
      code: job.error?.code || "REPLAY_M5_PREPARATION_FAILED",
    });
  }
  if (job?.status === "AWAITING_CONFIRMATION") {
    const published = await storeInstance.executeReplayPreparationAction({
      preparation_id: job.preparation_id,
      action: "publish",
      actor: { kind: "migration", uid: "replay-m5-queue-migration" },
    });
    job = published.job;
  }
  if (job?.status !== "QUEUED_FOR_GPT") {
    throw new Error(`REPLAY_M5_PREPARATION_NOT_PUBLISHED:${oldConfig.config_id}:${job?.status || "unknown"}`);
  }

  const pack = await storeInstance.getDeskPack({
    pack_id: job.pack_id,
    pack_build_id: job.pack_build_id,
    mode: "replay",
  });
  const missingDatasets = ["MNQ_M1", "MES_M1"].filter((dataset) => !pack.datasets?.[dataset]);
  if (missingDatasets.length > 0) {
    throw new Error(`REPLAY_M5_PACK_M1_MISSING:${oldConfig.config_id}:${missingDatasets.join(",")}`);
  }

  const now = storeInstance.clock.now();
  const inheritedAggregation = {
    run_number: Number(oldConfig.run_number || job.run_number || 1),
    aggregate_role: oldConfig.aggregate_role || job.aggregate_role || "primary",
    aggregate_eligible: oldConfig.aggregate_eligible !== false,
  };
  await storeInstance.persistence.setDocument(CONFIG_COLLECTION, job.config_id, {
    ...inheritedAggregation,
    migrated_from_config_id: oldConfig.config_id,
    cadence_migrated_at_utc: now.utc,
    updated_at_utc: now.utc,
    updated_at_paris: now.paris,
  }, { merge: true });
  await storeInstance.persistence.setDocument(DESK_COLLECTIONS.deskReplayPreparationJobs, job.preparation_id, {
    ...inheritedAggregation,
    migrated_from_config_id: oldConfig.config_id,
    cadence_migrated_at_utc: now.utc,
    updated_at_utc: now.utc,
    updated_at_paris: now.paris,
  }, { merge: true });
  await storeInstance.persistence.setDocument(CONFIG_COLLECTION, oldConfig.config_id, {
    enabled: false,
    status: "ARCHIVED",
    superseded_by_config_id: job.config_id,
    archive_reason: "Unstarted queue migrated from GPT M15 to GPT M5 with deterministic M1 datasets.",
    archived_at_utc: now.utc,
    updated_at_utc: now.utc,
    updated_at_paris: now.paris,
  }, { merge: true });

  const oldPreparation = preparations.find((preparation) => preparation.config_id === oldConfig.config_id);
  if (oldPreparation && oldPreparation.preparation_id !== job.preparation_id) {
    await storeInstance.persistence.setDocument(DESK_COLLECTIONS.deskReplayPreparationJobs, oldPreparation.preparation_id, {
      status: "SUPERSEDED",
      superseded_by_preparation_id: job.preparation_id,
      superseded_by_config_id: job.config_id,
      updated_at_utc: now.utc,
      updated_at_paris: now.paris,
    }, { merge: true });
  }

  return {
    ok: true,
    outcome: "MIGRATED",
    trading_date: oldConfig.trading_date,
    old_config_id: oldConfig.config_id,
    new_config_id: job.config_id,
    old_backtest_id: oldConfig.backtest_id,
    new_backtest_id: job.backtest_id,
    preparation_id: job.preparation_id,
    pack_id: job.pack_id,
    pack_build_id: job.pack_build_id,
    datasets_verified: ["MNQ_M1", "MES_M1"],
  };
}

async function pauseConfigMissingM1(storeInstance, config) {
  const tick = storeInstance.clock.now();
  await storeInstance.persistence.setDocument(CONFIG_COLLECTION, config.config_id, {
    enabled: false,
    status: "PAUSED",
    pause_reason: "M1_HISTORY_MISSING",
    pause_details: "GPT M5 is ready, but deterministic M1 replay execution requires genuine MNQ/MES M1 history.",
    paused_at_utc: tick.utc,
    updated_at_utc: tick.utc,
    updated_at_paris: tick.paris,
  }, { merge: true });
}

function isMissingM1Failure(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return (
    code === "LOCAL_PACK_CORE_DATASET_MISSING"
    && (message.includes("MNQ_M1") || message.includes("MES_M1"))
  ) || code === "REPLAY_PREPARATION_M1_REQUIRED";
}

function selectCandidates(configs, runIds, selection) {
  return configs
    .filter((config) => config.enabled !== false)
    .filter((config) => config.status === "READY")
    .filter((config) => config.cadence === "15m")
    .filter((config) => config.backtest_id && !runIds.has(config.backtest_id))
    .filter((config) => !selection.from || config.trading_date >= selection.from)
    .filter((config) => !selection.to || config.trading_date <= selection.to)
    .sort((left, right) =>
      String(left.trading_date || "").localeCompare(String(right.trading_date || ""))
      || String(left.config_id || "").localeCompare(String(right.config_id || "")));
}

function compactConfig(config) {
  return {
    config_id: config.config_id,
    backtest_id: config.backtest_id,
    trading_date: config.trading_date,
    cadence: config.cadence,
    aggregate_role: config.aggregate_role,
    aggregate_eligible: config.aggregate_eligible !== false,
  };
}

function parseArgs(values) {
  const parsed = {
    apply: false,
    env: null,
    from: null,
    to: null,
    expectedCount: null,
    pauseMissingM1: false,
    backup: null,
    output: null,
  };
  for (const value of values) {
    if (value === "--apply") parsed.apply = true;
    else if (value === "--pause-missing-m1") parsed.pauseMissingM1 = true;
    else if (value.startsWith("--env=")) parsed.env = value.slice("--env=".length);
    else if (value.startsWith("--from=")) parsed.from = value.slice("--from=".length);
    else if (value.startsWith("--to=")) parsed.to = value.slice("--to=".length);
    else if (value.startsWith("--expected-count=")) parsed.expectedCount = Number(value.slice("--expected-count=".length));
    else if (value.startsWith("--backup=")) parsed.backup = value.slice("--backup=".length);
    else if (value.startsWith("--output=")) parsed.output = value.slice("--output=".length);
    else throw new Error(`UNKNOWN_ARGUMENT:${value}`);
  }
  for (const [field, value] of [["from", parsed.from], ["to", parsed.to]]) {
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`INVALID_${field.toUpperCase()}_DATE`);
  }
  if (parsed.expectedCount !== null && (!Number.isInteger(parsed.expectedCount) || parsed.expectedCount < 0)) {
    throw new Error("INVALID_EXPECTED_COUNT");
  }
  if (parsed.apply && parsed.expectedCount === null) {
    throw new Error("EXPECTED_COUNT_REQUIRED_FOR_APPLY");
  }
  return parsed;
}

async function loadEnvFile(path) {
  const text = await readFile(path, "utf8").catch(() => "");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = unquoteEnvValue(match[2].trim());
  }
}

function unquoteEnvValue(value) {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
