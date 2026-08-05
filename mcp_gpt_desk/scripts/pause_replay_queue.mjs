#!/usr/bin/env node
import process from "node:process";

import { createDeskStoreFromEnv } from "../src/store.js";
import { pauseReplayWorkItem } from "../src/replay-agent-work.js";

const reason = process.argv.slice(2).join(" ").trim()
  || "ENGINE_V3_VALIDATION_HOLD";
const terminal = new Set(["COMPLETED", "DAY_END", "CANCELLED", "CANCELED", "FAILED"]);
const store = createDeskStoreFromEnv();

try {
  await store.persistence.initialized;
  const [runs, configs] = await Promise.all([
    store.persistence.listDocuments("desk_replay_runs", 5_000),
    store.persistence.listDocuments("desk_replay_autopilot_configs", 5_000),
  ]);
  const selectedRuns = runs.filter((run) => !terminal.has(String(run.status || "").toUpperCase()));
  const pausedRuns = [];

  for (const run of selectedRuns) {
    const result = await store.setReplayAutomation({
      backtest_id: run.backtest_id,
      enabled: false,
      reason,
      expected_revision: Number(run.revision || 0),
    });
    pausedRuns.push({
      backtest_id: run.backtest_id,
      trading_date: run.trading_date || run.date || null,
      status: run.status || null,
      automation_enabled: result.automation_enabled,
    });
  }

  const tick = store.clock.now();
  const pausedConfigs = [];
  for (const config of configs) {
    if (config.enabled === false && String(config.status || "").toUpperCase() === "PAUSED") continue;
    if (["ARCHIVED", "COMPLETED", "CANCELLED", "CANCELED"].includes(String(config.status || "").toUpperCase())) continue;
    await store.persistence.setDocument("desk_replay_autopilot_configs", config.config_id, {
      enabled: false,
      status: "PAUSED",
      pause_reason: reason,
      updated_at_utc: tick.utc,
      updated_at_paris: tick.paris,
    }, { merge: true });
    pausedConfigs.push(config.config_id);
  }

  const replayWork = await store.persistence.queryCollectionDocuments({
    collection: "desk_agent_work_items",
    filters: [{ field: "automation_scope", operator: "==", value: "replay" }],
    limit: 5_000,
  }).catch(() => []);
  const activeBeforePause = replayWork
    .filter((item) => ["READY", "CLAIMED"].includes(String(item.status || "").toUpperCase()));
  for (const item of activeBeforePause) {
    const paused = pauseReplayWorkItem(item, tick, reason);
    await store.persistence.setDocument("desk_agent_work_items", paused.work_item_id, paused);
  }
  const activeWork = (await store.persistence.queryCollectionDocuments({
    collection: "desk_agent_work_items",
    filters: [{ field: "automation_scope", operator: "==", value: "replay" }],
    limit: 5_000,
  }).catch(() => []))
    .filter((item) => ["READY", "CLAIMED"].includes(String(item.status || "").toUpperCase()));

  process.stdout.write(`${JSON.stringify({
    ok: activeWork.length === 0,
    reason,
    paused_runs: pausedRuns,
    paused_config_ids: pausedConfigs,
    paused_work_items: activeBeforePause.length,
    active_work_remaining: activeWork.map((item) => ({
      work_item_id: item.work_item_id,
      backtest_id: item.backtest_id,
      status: item.status,
    })),
    preserved_artifacts: true,
  }, null, 2)}\n`);
  if (activeWork.length) process.exitCode = 1;
} finally {
  await store.persistence.close?.();
}
