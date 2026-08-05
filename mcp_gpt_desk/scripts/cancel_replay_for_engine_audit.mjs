#!/usr/bin/env node
import process from "node:process";

import { createDeskStoreFromEnv } from "../src/store.js";

const args = parseArgs(process.argv.slice(2));
const backtestId = String(args["run-id"] || args.backtest_id || "").trim();
const execute = args.execute === true;
const reason = String(
  args.reason
    || "Replay interrompu avant certification : audit moteur conditions/lifecycle/intrabougie requis.",
).trim();

if (!backtestId) {
  console.error("Usage: node cancel_replay_for_engine_audit.mjs --run-id <backtest_id> [--execute] [--reason <texte>]");
  process.exit(2);
}

const store = createDeskStoreFromEnv();
try {
  await store.persistence.initialized;
  const before = await store.persistence.getDocument("desk_replay_runs", backtestId);
  const configs = (await store.persistence.listDocuments("desk_replay_autopilot_configs", 1_000))
    .filter((config) => config.backtest_id === backtestId);
  const workItems = await scopedWorkItems(store, backtestId);

  if (!execute) {
    console.log(JSON.stringify({
      ok: true,
      mode: "dry_run",
      backtest_id: backtestId,
      run: projectRun(before),
      matching_configs: configs.map(projectConfig),
      work_items: workItems.map(projectWorkItem),
    }, null, 2));
    process.exit(0);
  }

  const tick = new Date().toISOString();
  for (const config of configs) {
    await store.persistence.setDocument("desk_replay_autopilot_configs", config.config_id, {
      enabled: false,
      status: "PAUSED",
      pause_reason: "ENGINE_AUDIT_HOLD",
      updated_at_utc: tick,
    }, { merge: true });
  }

  let run = before;
  if (run.automation_enabled !== false || !["paused", "cancelled"].includes(String(run.automation_status || "").toLowerCase())) {
    await store.setReplayAutomation({
      backtest_id: backtestId,
      enabled: false,
      reason,
      expected_revision: Number(run.revision || 0),
    });
    run = await store.persistence.getDocument("desk_replay_runs", backtestId);
  }

  if (String(run.status || "").toUpperCase() !== "CANCELLED") {
    await store.cancelBacktestRun({ backtest_id: backtestId, reason });
    run = await store.persistence.getDocument("desk_replay_runs", backtestId);
  }

  const finalRevision = Number(run.revision || 0) + 1;
  await store.persistence.setDocument("desk_replay_runs", backtestId, {
    status: "CANCELLED",
    automation_enabled: false,
    automation_status: "cancelled",
    cancel_reason: reason,
    aggregate_eligible: false,
    result_eligible: false,
    result_certification_status: "REJECTED_ENGINE_AUDIT",
    result_eligibility_reason: "engine_audit_hold",
    audit_hold: true,
    engine_audit_code: "REPLAY_ENGINE_CONDITION_LIFECYCLE_INTRABAR_INVALID",
    revision: finalRevision,
    updated_at: tick,
    updated_at_utc: tick,
  }, { merge: true });

  const after = await store.persistence.getDocument("desk_replay_runs", backtestId);
  const afterItems = await scopedWorkItems(store, backtestId);
  const activeItems = afterItems.filter((item) => ["READY", "CLAIMED"].includes(String(item.status || "").toUpperCase()));
  if (activeItems.length) {
    throw new Error(`ACTIVE_WORK_REMAINS_AFTER_CANCEL:${activeItems.map((item) => item.work_item_id).join(",")}`);
  }

  console.log(JSON.stringify({
    ok: true,
    mode: "execute",
    backtest_id: backtestId,
    run: projectRun(after),
    matching_configs: configs.length,
    work_item_statuses: countBy(afterItems, (item) => item.status || "UNKNOWN"),
    active_work_items: activeItems.length,
    preserved_artifacts: true,
  }, null, 2));
} finally {
  await store.persistence.close?.();
}

async function scopedWorkItems(storeInstance, id) {
  return storeInstance.persistence.queryCollectionDocuments({
    collection: "desk_agent_work_items",
    filters: [{ field: "backtest_id", operator: "==", value: id }],
    orderBy: [{ field: "updated_at_utc", direction: "desc" }],
    limit: 1_000,
  }).catch(() => []);
}

function projectRun(run = {}) {
  return {
    status: run.status || null,
    revision: Number(run.revision || 0),
    automation_enabled: run.automation_enabled !== false,
    automation_status: run.automation_status || null,
    current_replay_time: run.current_replay_time || null,
    current_work_item_id: run.current_work_item_id || null,
    result_eligible: run.result_eligible === true,
    aggregate_eligible: run.aggregate_eligible === true,
    result_certification_status: run.result_certification_status || null,
    audit_hold: run.audit_hold === true,
  };
}

function projectConfig(config = {}) {
  return {
    config_id: config.config_id || null,
    enabled: config.enabled !== false,
    status: config.status || null,
  };
}

function projectWorkItem(item = {}) {
  return {
    work_item_id: item.work_item_id || null,
    status: item.status || null,
    workflow: item.workflow || null,
    lease_expires_at_utc: item.lease_expires_at_utc || null,
  };
}

function countBy(items, selector) {
  const counts = {};
  for (const item of items) {
    const key = String(selector(item));
    counts[key] = Number(counts[key] || 0) + 1;
  }
  return counts;
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      result[key] = true;
    } else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}
