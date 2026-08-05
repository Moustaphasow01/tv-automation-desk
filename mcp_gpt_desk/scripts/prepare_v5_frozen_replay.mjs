#!/usr/bin/env node
import process from "node:process";

import {
  entitySchemas as bundledEntitySchemas,
  registry as bundledContractRegistry,
} from "@tv-automation/desk-contracts";
import { canonicalSchemaHash } from "../src/desk-contract-service.js";
import { createDeskStoreFromEnv } from "../src/store.js";
import { resumeV5FrozenPreparationAfterRepair } from "../src/v5-frozen-replay-preparation.js";
import {
  assertV5June11R2PackEvidence,
  verifyV5June11R2Import,
} from "../src/v5-june11-r2-evidence.js";

const TRADING_DATE = "2026-06-11";
const CADENCE = "15m";
const WORKER_GROUP = "replay-v5-4-m15-validation";
const HOLD_REASON = "ENGINE_V5_VALIDATION_HOLD";
const IDEMPOTENCY_KEY = "v5-4-m15-frozen-readiness:2026-06-11:full-day:15m";
const TERMINAL_RUN_STATUSES = new Set(["COMPLETED", "DAY_END", "FAILED", "CANCELLED", "CANCELED"]);
const ACTIVE_PREPARATION_STATUSES = new Set(["QUEUED", "DATA_CHECK", "PACK_BUILDING"]);
const deadlineMs = Date.now() + boundedInteger(process.env.DESK_V5_PREPARATION_TIMEOUT_MS, 30 * 60_000, 60_000, 2 * 60 * 60_000);
const store = createDeskStoreFromEnv();

try {
  await store.persistence.initialized;
  await assertFrozenPreconditions(store);
  await assertV5Contracts(store);
  const sourceEvidence = await verifyV5June11R2Import(store.persistence.pool);

  const creation = await store.createReplayPreparation({
    trading_date: TRADING_DATE,
    cadence: CADENCE,
    worker_group: WORKER_GROUP,
    priority: 100,
    instruments: ["MNQ", "MES", "NQ", "ES"],
    trading_instruments: ["MNQ", "MES"],
    context_instruments: ["NQ", "ES"],
    idempotency_key: IDEMPOTENCY_KEY,
    source_evidence: sourceEvidence,
  });
  const preparationId = creation.jobs?.[0]?.preparation_id;
  if (!preparationId) throw new Error("V5_REPLAY_PREPARATION_ID_MISSING");

  const preparations = await store.persistence.listDocuments("desk_replay_preparation_jobs", 5_000);
  const unrelatedActive = preparations.filter((job) => (
    job.preparation_id !== preparationId
    && ACTIVE_PREPARATION_STATUSES.has(String(job.status || "").toUpperCase())
  ));
  if (unrelatedActive.length) {
    throw new Error(`UNRELATED_REPLAY_PREPARATION_ACTIVE:${unrelatedActive.length}`);
  }

  let job = await store.getReplayPreparation({ preparation_id: preparationId }).then((result) => result.job);
  job = await resumeV5FrozenPreparationAfterRepair(store, job);
  while (!['AWAITING_CONFIRMATION', 'QUEUED_FOR_GPT'].includes(job.status)) {
    if (["FAILED", "CANCELLED"].includes(job.status)) {
      throw new Error(`V5_REPLAY_PREPARATION_${job.status}:${job.error?.code || "unknown"}`);
    }
    if (Date.now() >= deadlineMs) throw new Error(`V5_REPLAY_PREPARATION_TIMEOUT:${job.status}`);

    const leaseActive = job.lease_owner && Date.parse(job.lease_expires_at_utc || "") > Date.now();
    if (!leaseActive || job.lease_owner === "v5-frozen-release") {
      const result = await store.replayPreparation.process({
        preparation_id: preparationId,
        worker_id: "v5-frozen-release",
      });
      if (result.ok === false) {
        throw new Error(`V5_REPLAY_PREPARATION_FAILED:${result.job?.error?.code || result.status}`);
      }
    } else {
      await delay(2_000);
    }
    job = await store.getReplayPreparation({ preparation_id: preparationId }).then((result) => result.job);
  }

  if (!job.pack_id || !job.pack_build_id) throw new Error("V5_REPLAY_PACK_NOT_READY");
  const verifiedPack = await store.getDeskPack({
    pack_id: job.pack_id,
    pack_build_id: job.pack_build_id,
    mode: "replay",
  });
  assertV5June11R2PackEvidence(verifiedPack, sourceEvidence);
  const existingRun = await store.persistence.getDocument("desk_replay_runs", job.backtest_id).catch(() => null);
  if (existingRun) {
    throw new Error(`V5_REPLAY_RUN_ALREADY_EXISTS:${job.backtest_id}:${existingRun.status || "unknown"}`);
  }

  const saved = await store.upsertReplayAutopilotConfig({
    config_id: job.config_id,
    enabled: false,
    status: "PAUSED",
    backtest_id: job.backtest_id,
    strategy_id: "asia_open",
    strategy_version: "autopilot_v5",
    autopilot_version: "5.4.0",
    replay_execution_policy_version: "4.3.0",
    execution_plan_version: "1.4.0",
    monitor_command_version: "1.4.0",
    condition_catalog_version: "1.2.0",
    deterministic_compiler_version: "1.4.0",
    condition_engine_version: "1.2.0",
    strategy_profile: "OPPORTUNITY_SEEKING_CONTROLLED",
    trading_date: TRADING_DATE,
    session: "asia_open",
    run_scope: "full_day",
    phases: job.phases || [],
    execution_id: job.execution_id,
    run_family_id: job.run_family_id,
    run_number: job.run_number,
    aggregate_role: job.aggregate_role,
    aggregate_eligible: job.aggregate_eligible,
    pack_id: job.pack_id,
    pack_build_id: job.pack_build_id,
    cutoff_paris: job.start_time,
    start_time: job.start_time,
    end_time: job.end_time,
    cadence: CADENCE,
    timezone: "Europe/Paris",
    instruments: ["MNQ", "MES", "NQ", "ES"],
    trading_instruments: ["MNQ", "MES"],
    context_instruments: ["NQ", "ES"],
    source_evidence: sourceEvidence,
    risk_model: "0.25pct_net_equity",
    worker_group: WORKER_GROUP,
    priority: 100,
    max_transitions: 6,
    notes: `V5.4 M15 frozen release readiness; queue group ${WORKER_GROUP} is an isolated validation lane; hold=${HOLD_REASON}`,
  });

  const persisted = await store.persistence.getDocument("desk_replay_autopilot_configs", job.config_id);
  assertPausedV5Config(persisted, job, sourceEvidence);
  const runAfter = await store.persistence.getDocument("desk_replay_runs", job.backtest_id).catch(() => null);
  if (runAfter) throw new Error(`V5_REPLAY_STARTED_UNEXPECTEDLY:${job.backtest_id}`);

  const receiptId = `v5_4_m15_frozen_prepare_receipt__2026_06_11__${sourceEvidence.manifest_sha256.slice(0, 16)}`;
  const preparedAtUtc = new Date().toISOString();
  const receipt = {
    audit_id: receiptId,
    schema_version: "desk_v5_frozen_prepare_receipt_v1",
    event_type: "V5_FROZEN_REPLAY_PREPARED",
    status: "COMPLETED",
    trading_date: TRADING_DATE,
    source_import_evidence: sourceEvidence,
    preparation: {
      preparation_id: preparationId,
      status: job.status,
      request_hash: job.request_hash || null,
    },
    pack: {
      pack_id: job.pack_id,
      pack_build_id: job.pack_build_id,
      source_manifest_hash: verifiedPack.source_manifest_hash || null,
      source_evidence_sha256: sourceEvidence.evidence_sha256,
    },
    config: {
      config_id: persisted.config_id,
      status: persisted.status,
      enabled: persisted.enabled,
      backtest_id: persisted.backtest_id,
      source_evidence_sha256: persisted.source_evidence.evidence_sha256,
    },
    run_created: false,
    analytics_started: false,
    hold_reason: HOLD_REASON,
    created_at_utc: preparedAtUtc,
  };
  await store.persistence.setDocument("desk_audit_logs", receiptId, receipt);
  const persistedReceipt = await store.persistence.getDocument("desk_audit_logs", receiptId);
  if (persistedReceipt?.source_import_evidence?.evidence_sha256 !== sourceEvidence.evidence_sha256
    || persistedReceipt?.pack?.pack_build_id !== job.pack_build_id
    || persistedReceipt?.config?.config_id !== persisted.config_id
    || persistedReceipt?.run_created !== false
    || persistedReceipt?.analytics_started !== false) {
    throw new Error("V5_FROZEN_PREPARATION_RECEIPT_MISMATCH");
  }
  const runAfterReceipt = await store.persistence.getDocument("desk_replay_runs", job.backtest_id).catch(() => null);
  if (runAfterReceipt) throw new Error(`V5_REPLAY_STARTED_UNEXPECTEDLY_AFTER_RECEIPT:${job.backtest_id}`);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    status: "V5_REPLAY_CONFIG_PREPARED_FROZEN",
    trading_date: TRADING_DATE,
    preparation_id: preparationId,
    preparation_status: job.status,
    config_id: saved.config.config_id,
    config_status: saved.config.status,
    enabled: saved.config.enabled,
    backtest_id: job.backtest_id,
    run_created: false,
    analytics_started: false,
    pack_id: job.pack_id,
    pack_build_id: job.pack_build_id,
    strategy_version: persisted.strategy_version,
    autopilot_version: persisted.autopilot_version,
    execution_policy_version: persisted.replay_execution_policy_version,
    hold_reason: HOLD_REASON,
    receipt_id: receiptId,
    source_import_id: sourceEvidence.import_id,
    source_manifest_sha256: sourceEvidence.manifest_sha256,
    source_capture_proof_sha256: sourceEvidence.capture_proof_sha256,
    source_evidence_sha256: sourceEvidence.evidence_sha256,
  }, null, 2)}\n`);
} finally {
  await store.persistence.close?.();
}

async function assertFrozenPreconditions(storeInstance) {
  const [controls, workItems, runs, configs, cursors] = await Promise.all([
    storeInstance.persistence.listDocuments("desk_claim_lane_controls", 10),
    storeInstance.persistence.listDocuments("desk_agent_work_items", 5_000),
    storeInstance.persistence.listDocuments("desk_replay_runs", 5_000),
    storeInstance.persistence.listDocuments("desk_replay_autopilot_configs", 5_000),
    storeInstance.persistence.listDocuments("desk_live_run_cursor", 5_000),
  ]);
  const byLane = new Map(controls.map((item) => [item.lane || item.document_id, item]));
  for (const lane of ["live", "replay"]) {
    const control = byLane.get(lane);
    if (control?.enabled !== false || String(control?.status || "PAUSED").toUpperCase() !== "PAUSED") {
      throw new Error(`CLAIM_LANE_NOT_FROZEN:${lane}`);
    }
    if (control?.reason !== HOLD_REASON) {
      throw new Error(`CLAIM_LANE_HOLD_REASON_MISMATCH:${lane}`);
    }
  }
  if (workItems.some((item) => ["READY", "CLAIMED"].includes(String(item.status || "").toUpperCase()))) {
    throw new Error("ACTIVE_DESK_WORK_PRESENT");
  }
  if (runs.some((run) => !TERMINAL_RUN_STATUSES.has(String(run.status || "").toUpperCase())
    && run.automation_enabled !== false)) {
    throw new Error("NONTERMINAL_REPLAY_AUTOMATION_NOT_DISABLED");
  }
  if (configs.some((config) => !["ARCHIVED", "COMPLETED", "CANCELLED", "CANCELED"].includes(String(config.status || "").toUpperCase())
    && config.enabled !== false)) {
    throw new Error("REPLAY_CONFIG_NOT_DISABLED");
  }
  if (cursors.some((cursor) => String(cursor.cursor_status || "").toUpperCase() === "LEASED"
    || String(cursor.attempt?.status || "").toUpperCase() === "LEASED")) {
    throw new Error("ACTIVE_LIVE_LEASE_PRESENT");
  }
  const [lock, activeBroker] = await Promise.all([
    storeInstance.persistence.pool.query(`
      SELECT locked FROM broker_execution_locks
      WHERE scope_type = 'global' AND scope_value = '*'
      LIMIT 1
    `),
    storeInstance.persistence.pool.query(`
      SELECT (
        (SELECT count(*) FROM broker_execution_outbox WHERE status IN ('rendered','delivered') OR (status = 'leased' AND (lease_expires_at IS NULL OR lease_expires_at > now())))
        +
        (SELECT count(*) FROM broker_management_outbox WHERE status IN ('rendered','delivered') OR (status = 'leased' AND (lease_expires_at IS NULL OR lease_expires_at > now())))
      )::integer AS active_count
    `),
  ]);
  if (lock.rows?.[0]?.locked !== true) throw new Error("GLOBAL_BROKER_LOCK_NOT_ASSERTED");
  if (Number(activeBroker.rows?.[0]?.active_count || 0) > 0) throw new Error("ACTIVE_BROKER_WORK_PRESENT");
}

async function assertV5Contracts(storeInstance) {
  const registry = await storeInstance.persistence
    .getDocument("desk_contract_registry", "active_contracts")
    .catch(() => null);
  if (!registry) throw new Error("PERSISTED_CONTRACT_REGISTRY_MISSING");
  const expected = {
    master_contract: ["DeskMasterAnalysisContract_v5_4_0", "5.4.0"],
    monitor_contract: ["DeskHourlyThesisMonitorContract_v2_4_0", "2.4.0"],
    execution_plan_contract: ["DeskExecutionPlanContract_v1_4_0", "1.4.0"],
    monitor_command_contract: ["DeskMonitorCommandContract_v1_4_0", "1.4.0"],
    condition_catalog_contract: ["DeskConditionCatalogContract_v1_2_0", "1.2.0"],
    execution_policy_contract: ["DeskDeterministicExecutionPolicy_v4_3_0", "4.3.0"],
  };
  for (const [key, [contractId, version]] of Object.entries(expected)) {
    const packaged = bundledContractRegistry.active_contracts?.[key] || null;
    const packagedSchema = packaged?.schema_path
      ? bundledEntitySchemas[String(packaged.schema_path).split("/").at(-1)]
      : null;
    const packagedSchemaHash = packagedSchema ? canonicalSchemaHash(packagedSchema) : null;
    const reference = registry[key];
    const contract = reference?.contract_id
      ? await storeInstance.persistence.getDocument("desk_contracts", reference.contract_id).catch(() => null)
      : null;
    if (packaged?.contract_id !== contractId || packaged?.schema_version !== version
      || !packaged?.hash || !packagedSchemaHash
      || reference?.contract_id !== contractId || reference?.schema_version !== version
      || reference?.schema_hash !== packagedSchemaHash
      || contract?.contract_id !== contractId || contract?.schema_version !== version
      || contract?.status !== "active" || contract?.is_active !== true
      || !contract?.hash || contract?.hash !== reference?.hash || contract?.hash !== packaged?.hash
      || contract?.schema_hash !== packagedSchemaHash
      || canonicalSchemaHash(contract?.schema_json || {}) !== packagedSchemaHash) {
      throw new Error(`PERSISTED_ACTIVE_CONTRACT_MISMATCH:${key}:${contract?.schema_version || "missing"}`);
    }
  }
}

function assertPausedV5Config(config, job, sourceEvidence) {
  const expected = {
    enabled: false,
    status: "PAUSED",
    strategy_version: "autopilot_v5",
    autopilot_version: "5.4.0",
    replay_execution_policy_version: "4.3.0",
    execution_plan_version: "1.4.0",
    monitor_command_version: "1.4.0",
    condition_catalog_version: "1.2.0",
    deterministic_compiler_version: "1.4.0",
    condition_engine_version: "1.2.0",
    strategy_profile: "OPPORTUNITY_SEEKING_CONTROLLED",
  };
  for (const [key, value] of Object.entries(expected)) {
    if (config?.[key] !== value) throw new Error(`V5_REPLAY_CONFIG_MISMATCH:${key}`);
  }
  if (config.pack_build_id !== job.pack_build_id || config.backtest_id !== job.backtest_id) {
    throw new Error("V5_REPLAY_CONFIG_SCOPE_MISMATCH");
  }
  if (config.source_evidence?.evidence_sha256 !== sourceEvidence.evidence_sha256) {
    throw new Error("V5_REPLAY_CONFIG_SOURCE_EVIDENCE_MISMATCH");
  }
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
