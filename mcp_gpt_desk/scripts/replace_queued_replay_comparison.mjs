#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

const args = parseArgs(process.argv.slice(2));
await loadEnvFile(args.env);
const storeModule = isAbsolute(args.storeModule) ? args.storeModule : resolve(args.storeModule);
const { createDeskStoreFromEnv } = await import(pathToFileURL(storeModule).href);
const store = createDeskStoreFromEnv();

const COLLECTIONS = {
  runs: "desk_replay_runs",
  configs: "desk_replay_autopilot_configs",
  preparations: "desk_replay_preparation_jobs",
  workItems: "desk_agent_work_items",
};

try {
  await store.persistence.initialized;
  const tick = store.clock.now();
  const [sourceRun, targetRuns, configs, preparations, workItems] = await Promise.all([
    store.persistence.getDocument(COLLECTIONS.runs, args.sourceRun).catch(() => null),
    store.persistence.listDocuments(COLLECTIONS.runs, 1_000),
    store.persistence.listDocuments(COLLECTIONS.configs, 1_000),
    store.persistence.listDocuments(COLLECTIONS.preparations, 1_000),
    store.persistence.listDocuments(COLLECTIONS.workItems, 2_000),
  ]);
  if (!sourceRun) throw new Error(`SOURCE_REPLAY_NOT_FOUND:${args.sourceRun}`);
  if (["COMPLETED", "DAY_END"].includes(String(sourceRun.status || "").toUpperCase())) {
    throw new Error(`SOURCE_REPLAY_IS_COMPLETED:${args.sourceRun}`);
  }

  const targetBaselines = targetRuns
    .filter((run) => run.trading_date === args.targetDate)
    .filter((run) => ["COMPLETED", "DAY_END"].includes(String(run.status || "").toUpperCase()))
    .sort((left, right) => Number(right.aggregate_eligible === true) - Number(left.aggregate_eligible === true)
      || String(right.completed_at_utc || "").localeCompare(String(left.completed_at_utc || "")));
  if (!targetBaselines.length) throw new Error(`TARGET_BASELINE_NOT_FOUND:${args.targetDate}`);

  const sourceWork = workItems.filter((item) => item.backtest_id === args.sourceRun);
  const activeClaims = sourceWork.filter((item) =>
    item.status === "CLAIMED" && Date.parse(item.lease_expires_at_utc || "") > tick.epochMs);
  if (activeClaims.length) {
    throw new Error(`SOURCE_REPLAY_HAS_ACTIVE_LEASE:${activeClaims.map((item) => item.work_item_id).join(",")}`);
  }

  const sourceConfigs = configs.filter((config) => config.backtest_id === args.sourceRun);
  const sourcePreparations = preparations.filter((job) => job.backtest_id === args.sourceRun);
  const existingTargetPreparation = preparations.find((job) =>
    job.trading_date === args.targetDate && job.idempotency_key === args.idempotencyKey);
  const targetRunNumber = Number(existingTargetPreparation?.run_number) || (Math.max(
    1,
    ...targetRuns.filter((run) => run.trading_date === args.targetDate).map((run) => Number(run.run_number) || 0),
    ...preparations.filter((job) => job.trading_date === args.targetDate).map((job) => Number(job.run_number) || 0),
  ) + 1);

  const preflight = {
    ok: true,
    status: args.apply ? "APPLYING" : "DRY_RUN",
    source: {
      run_id: args.sourceRun,
      status: sourceRun.status,
      revision: Number(sourceRun.revision || 0),
      ready_work_items: sourceWork.filter((item) => item.status === "READY").length,
      configs: sourceConfigs.map((config) => config.config_id),
      preparations: sourcePreparations.map((job) => job.preparation_id),
    },
    target: {
      trading_date: args.targetDate,
      baseline_run_id: targetBaselines[0].backtest_id || targetBaselines[0].replay_run_id,
      baseline_total_r: targetBaselines[0].summary?.total_R ?? targetBaselines[0].total_R ?? null,
      run_number: targetRunNumber,
      aggregate_role: "comparison",
      aggregate_eligible: false,
      cadence: args.cadence,
      priority: args.priority,
    },
  };
  if (!args.apply) {
    output(preflight);
    process.exitCode = 0;
  } else {
    const reason = `Remplacé par un replay comparatif ${args.targetDate} à la demande de l'opérateur.`;
    let cancellation = null;
    if (!["CANCELLED"].includes(String(sourceRun.status || "").toUpperCase())) {
      const workflow = await store.getOperationsWorkflow({ workflow_id: `replay:${args.sourceRun}` });
      cancellation = await store.executeOperationsWorkflowAction({
        workflow_id: `replay:${args.sourceRun}`,
        input: {
          action: "cancel",
          expectedRevision: Number(workflow.workflow.revision || 0),
          idempotencyKey: `replace-${args.sourceRun}`.slice(0, 200),
          confirmationPhrase: "CONFIRM_CANCEL",
          reason,
        },
        actor: { kind: "operator-maintenance", uid: "codex-vps-operator" },
      });
    }

    const cancelledAt = store.clock.now();
    for (const config of sourceConfigs) {
      await store.persistence.setDocument(COLLECTIONS.configs, config.config_id, {
        ...config,
        enabled: false,
        status: "ARCHIVED",
        automation_status: "cancelled",
        archived_reason: reason,
        updated_at_utc: cancelledAt.utc,
        updated_at_paris: cancelledAt.paris,
      });
    }
    for (const item of sourceWork.filter((work) => ["READY", "FAILED", "CLAIMED"].includes(work.status))) {
      await store.persistence.setDocument(COLLECTIONS.workItems, item.work_item_id, {
        ...item,
        status: "CANCELLED",
        claimed_by: null,
        worker_id: null,
        lease_token: null,
        lease_expires_at_utc: null,
        completion_summary: reason,
        revision: Number(item.revision || 0) + 1,
        updated_at_utc: cancelledAt.utc,
        updated_at_paris: cancelledAt.paris,
      });
    }
    for (const preparation of sourcePreparations) {
      await store.persistence.setDocument(COLLECTIONS.preparations, preparation.preparation_id, {
        ...preparation,
        status: "CANCELLED",
        error: null,
        stages: [
          ...(preparation.stages || []),
          { status: "CANCELLED", at_utc: cancelledAt.utc, at_paris: cancelledAt.paris, message: reason },
        ],
        updated_at_utc: cancelledAt.utc,
        updated_at_paris: cancelledAt.paris,
      });
    }

    const created = await store.createReplayPreparation({
      trading_date: args.targetDate,
      cadence: args.cadence,
      worker_group: "replay-v4",
      priority: args.priority,
      instruments: ["MNQ", "MES", "NQ", "ES"],
      idempotency_key: args.idempotencyKey,
    });
    let job = created.jobs?.[0];
    if (!job) throw new Error("TARGET_PREPARATION_NOT_CREATED");
    const storedJob = await store.persistence.getDocument(COLLECTIONS.preparations, job.preparation_id);
    await store.persistence.setDocument(COLLECTIONS.preparations, job.preparation_id, {
      ...storedJob,
      run_number: targetRunNumber,
      aggregate_role: "comparison",
      aggregate_eligible: false,
      priority: args.priority,
      updated_at_utc: store.clock.now().utc,
      updated_at_paris: store.clock.now().paris,
    });

    job = (await store.getReplayPreparation({ preparation_id: job.preparation_id })).job;
    if (["QUEUED", "DATA_CHECK", "PACK_BUILDING"].includes(job.status)) {
      job = (await store.replayPreparation.process({
        preparation_id: job.preparation_id,
        worker_id: "operator-replay-comparison-swap",
      })).job;
    }
    if (job.status === "FAILED" && job.error?.code === "LOCAL_PACK_CORE_DATASET_MISSING") {
      const baseline = targetBaselines.find((run) => run.pack_id && run.pack_build_id);
      if (!baseline) throw new Error("TARGET_CERTIFIED_PACK_REFERENCE_MISSING");
      const certifiedPack = await store.getDeskPack({
        pack_id: baseline.pack_id,
        pack_build_id: baseline.pack_build_id,
        mode: "replay",
      });
      if (certifiedPack.status !== "ready"
        || certifiedPack.execution_allowed === false
        || certifiedPack.trading_date !== args.targetDate
        || certifiedPack.pack_build_id !== baseline.pack_build_id) {
        throw new Error("TARGET_CERTIFIED_PACK_NOT_REUSABLE");
      }
      const recoveredAt = store.clock.now();
      const failedJob = await store.persistence.getDocument(COLLECTIONS.preparations, job.preparation_id);
      await store.persistence.setDocument(COLLECTIONS.preparations, job.preparation_id, {
        ...failedJob,
        status: "AWAITING_CONFIRMATION",
        progress_percent: 85,
        pack_id: certifiedPack.pack_id,
        pack_build_id: certifiedPack.pack_build_id,
        pack_reused: true,
        pack_quality: certifiedPack.quality || null,
        source_manifest_hash: certifiedPack.source_manifest_hash || baseline.source_manifest_hash || null,
        source_coverage: certifiedPack.source_coverage || null,
        error: null,
        lease_owner: null,
        lease_expires_at_utc: null,
        stages: [
          ...(failedJob.stages || []),
          {
            status: "PACK_REUSED",
            at_utc: recoveredAt.utc,
            at_paris: recoveredAt.paris,
            message: `Pack immuable du baseline V4 certifié ${baseline.backtest_id || baseline.replay_run_id} réutilisé pour le comparatif.`,
          },
          {
            status: "AWAITING_CONFIRMATION",
            at_utc: recoveredAt.utc,
            at_paris: recoveredAt.paris,
            message: "Comparatif prêt avec le même pack immuable que le baseline certifié.",
          },
        ],
        updated_at_utc: recoveredAt.utc,
        updated_at_paris: recoveredAt.paris,
      });
      job = (await store.getReplayPreparation({ preparation_id: job.preparation_id })).job;
    }
    if (job.status === "FAILED") {
      throw new Error(`${job.error?.code || "TARGET_PREPARATION_FAILED"}:${job.error?.message || "unknown"}`);
    }
    if (job.status === "AWAITING_CONFIRMATION") {
      job = (await store.executeReplayPreparationAction({
        preparation_id: job.preparation_id,
        action: "publish",
        actor: { kind: "operator-maintenance", uid: "codex-vps-operator" },
      })).job;
    }
    if (job.status !== "QUEUED_FOR_GPT") {
      throw new Error(`TARGET_PREPARATION_NOT_PUBLISHED:${job.status}`);
    }

    const targetConfig = await store.persistence.getDocument(COLLECTIONS.configs, job.config_id);
    await store.persistence.setDocument(COLLECTIONS.configs, job.config_id, {
      ...targetConfig,
      run_number: targetRunNumber,
      aggregate_role: "comparison",
      aggregate_eligible: false,
      priority: args.priority,
      updated_at_utc: store.clock.now().utc,
      updated_at_paris: store.clock.now().paris,
    });
    const finalJob = await store.getReplayPreparation({ preparation_id: job.preparation_id });
    output({
      ...preflight,
      status: "APPLIED",
      source: {
        ...preflight.source,
        cancelled: true,
        command_id: cancellation?.commandId || null,
      },
      target: {
        ...preflight.target,
        preparation_id: finalJob.job.preparation_id,
        preparation_status: finalJob.job.status,
        config_id: finalJob.job.config_id,
        backtest_id: finalJob.job.backtest_id,
        pack_id: finalJob.job.pack_id,
        pack_build_id: finalJob.job.pack_build_id,
      },
    });
  }
} finally {
  await store.persistence.close?.();
}

function parseArgs(values) {
  const parsed = {
    apply: false,
    env: "C:\\ProgramData\\DeskFutures\\config\\desk.env",
    storeModule: "C:\\DeskFutures\\current\\app\\mcp_gpt_desk\\src\\store.js",
    sourceRun: "",
    targetDate: "",
    cadence: "15m",
    priority: 20,
    idempotencyKey: "",
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--apply") parsed.apply = true;
    else if (value === "--env") parsed.env = values[++index];
    else if (value === "--store-module") parsed.storeModule = values[++index];
    else if (value === "--source-run") parsed.sourceRun = values[++index];
    else if (value === "--target-date") parsed.targetDate = values[++index];
    else if (value === "--cadence") parsed.cadence = values[++index];
    else if (value === "--priority") parsed.priority = Number(values[++index]);
    else if (value === "--idempotency-key") parsed.idempotencyKey = values[++index];
    else throw new Error(`UNKNOWN_ARGUMENT:${value}`);
  }
  if (!parsed.sourceRun) throw new Error("SOURCE_RUN_REQUIRED");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.targetDate)) throw new Error("TARGET_DATE_INVALID");
  if (!["5m", "15m", "30m", "60m"].includes(parsed.cadence)) throw new Error("CADENCE_INVALID");
  if (!Number.isInteger(parsed.priority) || parsed.priority < 1 || parsed.priority > 999) throw new Error("PRIORITY_INVALID");
  if (!parsed.idempotencyKey) parsed.idempotencyKey = `comparison:${parsed.targetDate}:${parsed.cadence}:continuity-fix-v2`;
  return parsed;
}

async function loadEnvFile(path) {
  const text = await readFile(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator);
    if (!(key in process.env)) process.env[key] = trimmed.slice(separator + 1);
  }
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
