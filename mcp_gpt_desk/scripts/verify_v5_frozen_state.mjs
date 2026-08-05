#!/usr/bin/env node
import process from "node:process";

import {
  entitySchemas as bundledEntitySchemas,
  registry as bundledContractRegistry,
} from "@tv-automation/desk-contracts";
import { canonicalSchemaHash } from "../src/desk-contract-service.js";
import { createDeskStoreFromEnv } from "../src/store.js";

const freezeOnly = process.argv.includes("--freeze-only");
const requireBrokerLock = !freezeOnly || process.argv.includes("--require-broker-lock");
const EXPECTED_CONTRACTS = Object.freeze({
  master_contract: ["DeskMasterAnalysisContract_v5_4_0", "5.4.0"],
  monitor_contract: ["DeskHourlyThesisMonitorContract_v2_4_0", "2.4.0"],
  execution_plan_contract: ["DeskExecutionPlanContract_v1_4_0", "1.4.0"],
  monitor_command_contract: ["DeskMonitorCommandContract_v1_4_0", "1.4.0"],
  condition_catalog_contract: ["DeskConditionCatalogContract_v1_2_0", "1.2.0"],
  execution_policy_contract: ["DeskDeterministicExecutionPolicy_v4_3_0", "4.3.0"],
});
const TERMINAL_RUN_STATUSES = new Set(["COMPLETED", "DAY_END", "FAILED", "CANCELLED", "CANCELED"]);
const TERMINAL_CONFIG_STATUSES = new Set(["ARCHIVED", "COMPLETED", "CANCELLED", "CANCELED"]);
const ACTIVE_WORK_STATUSES = new Set(["READY", "CLAIMED"]);
const ACTIVE_PREPARATION_STATUSES = new Set(["QUEUED", "DATA_CHECK", "PACK_BUILDING"]);

const store = createDeskStoreFromEnv();

try {
  await store.persistence.initialized;
  const [persistedRegistry, resolvedContracts, controls, workItems, runs, configs, preparations, cursors] = await Promise.all([
    freezeOnly ? Promise.resolve(null) : store.persistence.getDocument("desk_contract_registry", "active_contracts"),
    freezeOnly ? Promise.resolve(null) : store.getActiveContracts(),
    store.persistence.listDocuments("desk_claim_lane_controls", 10),
    store.persistence.listDocuments("desk_agent_work_items", 5_000),
    store.persistence.listDocuments("desk_replay_runs", 5_000),
    store.persistence.listDocuments("desk_replay_autopilot_configs", 5_000),
    store.persistence.listDocuments("desk_replay_preparation_jobs", 5_000),
    store.persistence.listDocuments("desk_live_run_cursor", 5_000),
  ]);

  const failures = [];
  const warnings = [];
  const controlsByLane = new Map(controls.map((control) => [control.lane || control.document_id, control]));
  const lanes = ["live", "replay"].map((lane) => {
    const control = controlsByLane.get(lane) || null;
    const paused = control?.enabled === false && String(control?.status || "PAUSED").toUpperCase() === "PAUSED";
    if (!paused) failures.push(`CLAIM_LANE_NOT_PAUSED:${lane}`);
    if (!freezeOnly && control?.reason !== "ENGINE_V5_VALIDATION_HOLD") {
      failures.push(`CLAIM_LANE_HOLD_REASON_MISMATCH:${lane}`);
    }
    return {
      lane,
      enabled: control?.enabled !== false,
      status: control?.status || null,
      revision: Number(control?.revision || 0),
      reason: control?.reason || null,
    };
  });

  const activeWork = workItems
    .filter((item) => ACTIVE_WORK_STATUSES.has(String(item.status || "").toUpperCase()))
    .map((item) => ({
      work_item_id: item.work_item_id || null,
      scope: item.automation_scope || null,
      workflow: item.workflow || null,
      status: item.status || null,
      backtest_id: item.backtest_id || null,
    }));
  if (activeWork.length) failures.push(`ACTIVE_DESK_WORK:${activeWork.length}`);

  const leasedCursors = cursors
    .filter((cursor) => String(cursor.cursor_status || "").toUpperCase() === "LEASED"
      || String(cursor.attempt?.status || "").toUpperCase() === "LEASED")
    .map((cursor) => ({
      cursor_id: cursor.cursor_id || null,
      cursor_status: cursor.cursor_status || null,
      checkpoint: cursor.attempt?.checkpoint || cursor.target_checkpoint || null,
    }));
  if (leasedCursors.length) failures.push(`ACTIVE_LIVE_LEASES:${leasedCursors.length}`);

  const activePreparations = preparations
    .filter((job) => ACTIVE_PREPARATION_STATUSES.has(String(job.status || "").toUpperCase()))
    .map((job) => ({ preparation_id: job.preparation_id || null, status: job.status || null }));
  if (activePreparations.length) failures.push(`ACTIVE_REPLAY_PREPARATIONS:${activePreparations.length}`);

  const enabledRuns = runs
    .filter((run) => !TERMINAL_RUN_STATUSES.has(String(run.status || "").toUpperCase()))
    .filter((run) => run.automation_enabled !== false)
    .map((run) => ({ backtest_id: run.backtest_id || null, status: run.status || null }));
  if (enabledRuns.length) failures.push(`ENABLED_NONTERMINAL_REPLAYS:${enabledRuns.length}`);

  const enabledConfigs = configs
    .filter((config) => !TERMINAL_CONFIG_STATUSES.has(String(config.status || "").toUpperCase()))
    .filter((config) => config.enabled !== false)
    .map((config) => ({ config_id: config.config_id || null, status: config.status || null }));
  if (enabledConfigs.length) failures.push(`ENABLED_REPLAY_CONFIGS:${enabledConfigs.length}`);

  let brokerActiveWork = null;
  let globalBrokerLock = null;
  let databaseActiveCounts = null;
  if (store.persistence.pool?.query) {
    const [activeResult, lockResult, frozenCountsResult] = await Promise.all([
      store.persistence.pool.query(`
        SELECT (
          (SELECT count(*) FROM broker_execution_outbox
           WHERE status IN ('rendered','delivered')
              OR (status = 'leased' AND (lease_expires_at IS NULL OR lease_expires_at > now())))
          +
          (SELECT count(*) FROM broker_management_outbox
           WHERE status IN ('rendered','delivered')
              OR (status = 'leased' AND (lease_expires_at IS NULL OR lease_expires_at > now())))
        )::integer AS active_count
      `),
      store.persistence.pool.query(`
        SELECT locked, reason
        FROM broker_execution_locks
        WHERE scope_type = 'global' AND scope_value = '*'
        LIMIT 1
      `),
      store.persistence.pool.query(`
        SELECT
          (SELECT count(*) FROM desk_documents
           WHERE collection = 'desk_agent_work_items'
             AND upper(COALESCE(data->>'status','')) IN ('READY','CLAIMED'))::integer AS active_work,
          (SELECT count(*) FROM desk_documents
           WHERE collection = 'desk_replay_runs'
             AND upper(COALESCE(data->>'status','')) NOT IN ('COMPLETED','DAY_END','FAILED','CANCELLED','CANCELED')
             AND COALESCE(data->>'automation_enabled','true') <> 'false')::integer AS enabled_runs,
          (SELECT count(*) FROM desk_documents
           WHERE collection = 'desk_replay_autopilot_configs'
             AND upper(COALESCE(data->>'status','')) NOT IN ('ARCHIVED','COMPLETED','CANCELLED','CANCELED')
             AND COALESCE(data->>'enabled','true') <> 'false')::integer AS enabled_configs,
          (SELECT count(*) FROM desk_documents
           WHERE collection = 'desk_replay_preparation_jobs'
             AND upper(COALESCE(data->>'status','')) IN ('QUEUED','DATA_CHECK','PACK_BUILDING'))::integer AS active_preparations,
          (SELECT count(*) FROM desk_documents
           WHERE collection = 'desk_live_run_cursor'
             AND (
               upper(COALESCE(data->>'cursor_status','')) = 'LEASED'
               OR upper(COALESCE(data#>>'{attempt,status}','')) = 'LEASED'
             ))::integer AS leased_live_cursors
      `),
    ]);
    brokerActiveWork = activeResult.rows?.[0]?.active_count ?? null;
    globalBrokerLock = lockResult.rows?.[0] || null;
    const frozenCounts = frozenCountsResult.rows?.[0] || {};
    databaseActiveCounts = Object.fromEntries(
      Object.entries(frozenCounts).map(([key, value]) => [key, Number(value || 0)]),
    );
    for (const [key, value] of Object.entries(databaseActiveCounts)) {
      if (value > 0) failures.push(`DATABASE_FROZEN_INVARIANT_FAILED:${key}:${value}`);
    }
    if (Number(brokerActiveWork || 0) > 0) failures.push(`ACTIVE_BROKER_WORK:${brokerActiveWork}`);
    if (globalBrokerLock?.locked !== true) {
      const issue = "GLOBAL_BROKER_LOCK_NOT_ASSERTED";
      if (requireBrokerLock) failures.push(issue);
      else warnings.push(issue);
    }
  } else {
    failures.push("POSTGRES_POOL_REQUIRED_FOR_FROZEN_VERIFICATION");
  }
  const activeContracts = {};
  if (!freezeOnly) {
    if (!persistedRegistry) failures.push("PERSISTED_CONTRACT_REGISTRY_MISSING");
    const persistedContractEntries = await Promise.all(
      Object.entries(EXPECTED_CONTRACTS).map(async ([key, [contractId, version]]) => {
        const registryRef = persistedRegistry?.[key] || null;
        const persistedContract = registryRef?.contract_id
          ? await store.persistence.getDocument("desk_contracts", registryRef.contract_id).catch(() => null)
          : null;
        return [key, { contractId, version, registryRef, persistedContract }];
      }),
    );

    for (const [key, { contractId, version, registryRef, persistedContract }] of persistedContractEntries) {
      const resolved = resolvedContracts?.[key] || null;
      const packaged = bundledContractRegistry.active_contracts?.[key] || null;
      const packagedSchema = packaged?.schema_path
        ? bundledEntitySchemas[String(packaged.schema_path).split("/").at(-1)]
        : null;
      const packagedSchemaHash = packagedSchema ? canonicalSchemaHash(packagedSchema) : null;
      activeContracts[key] = {
        contract_id: persistedContract?.contract_id || null,
        schema_version: persistedContract?.schema_version || null,
        hash: persistedContract?.hash || null,
        status: persistedContract?.status || null,
        is_active: persistedContract?.is_active === true,
        registry_contract_id: registryRef?.contract_id || null,
        packaged_hash: packaged?.hash || null,
        schema_hash: persistedContract?.schema_hash || null,
        packaged_schema_hash: packagedSchemaHash,
      };
      if (packaged?.contract_id !== contractId || packaged?.schema_version !== version
        || !packaged?.hash || !packagedSchemaHash) {
        failures.push(`PACKAGED_ACTIVE_CONTRACT_MISMATCH:${key}`);
      }
      if (registryRef?.contract_id !== contractId || registryRef?.schema_version !== version
        || registryRef?.status !== "active" || registryRef?.is_active !== true || !registryRef?.hash
        || registryRef?.hash !== packaged?.hash || registryRef?.schema_hash !== packagedSchemaHash) {
        failures.push(`PERSISTED_CONTRACT_REGISTRY_MISMATCH:${key}`);
      }
      if (persistedContract?.contract_id !== contractId || persistedContract?.schema_version !== version
        || persistedContract?.status !== "active" || persistedContract?.is_active !== true
        || !persistedContract?.hash || persistedContract?.hash !== registryRef?.hash
        || persistedContract?.hash !== packaged?.hash
        || persistedContract?.schema_hash !== packagedSchemaHash
        || canonicalSchemaHash(persistedContract?.schema_json || {}) !== packagedSchemaHash) {
        failures.push(`PERSISTED_ACTIVE_CONTRACT_MISMATCH:${key}`);
      }
      if (resolved?.contract_id !== contractId || resolved?.schema_version !== version
        || resolved?.status !== "active" || resolved?.is_active !== true
        || !resolved?.hash || resolved?.hash !== persistedContract?.hash) {
        failures.push(`RESOLVED_ACTIVE_CONTRACT_MISMATCH:${key}`);
      }
    }
  }

  const result = {
    ok: failures.length === 0,
    schema: "desk_v5_frozen_state_v1",
    checked_at_utc: new Date().toISOString(),
    mode: freezeOnly ? "freeze_only" : "v5_release",
    lanes,
    active_contracts: activeContracts,
    active_work: activeWork,
    leased_live_cursors: leasedCursors,
    active_replay_preparations: activePreparations,
    enabled_nonterminal_replays: enabledRuns,
    enabled_replay_configs: enabledConfigs,
    broker_active_work: brokerActiveWork,
    database_active_counts: databaseActiveCounts,
    global_broker_lock: globalBrokerLock
      ? { locked: globalBrokerLock.locked === true, reason: globalBrokerLock.reason || null }
      : null,
    warnings,
    failures,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
} finally {
  await store.persistence.close?.();
}
