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

try {
  await store.persistence.initialized;
  const [run, configs] = await Promise.all([
    store.persistence.getDocument("desk_replay_runs", args.runId).catch(() => null),
    store.persistence.listDocuments("desk_replay_autopilot_configs", 1_000),
  ]);
  if (!run) throw new Error(`REPLAY_NOT_FOUND:${args.runId}`);
  if (!["COMPLETED", "DAY_END", "CANCELLED"].includes(String(run.status || "").toUpperCase())) {
    throw new Error(`REPLAY_NOT_TERMINAL:${args.runId}:${run.status}`);
  }
  const selected = configs.filter((config) => config.backtest_id === args.runId);
  if (!selected.length) throw new Error(`REPLAY_CONFIG_NOT_FOUND:${args.runId}`);
  if (!args.apply) {
    output({
      ok: true,
      status: "DRY_RUN",
      run_id: args.runId,
      run_status: run.status,
      configs: selected.map((config) => ({
        config_id: config.config_id,
        enabled: config.enabled !== false,
        status: config.status,
        priority: config.priority,
      })),
    });
  } else {
    const tick = store.clock.now();
    for (const config of selected) {
      await store.persistence.setDocument("desk_replay_autopilot_configs", config.config_id, {
        ...config,
        enabled: false,
        status: "ARCHIVED",
        automation_status: String(run.status || "").toLowerCase(),
        archived_reason: args.reason,
        updated_at_utc: tick.utc,
        updated_at_paris: tick.paris,
      });
    }
    await store.persistence.setDocument("desk_replay_runs", args.runId, {
      ...run,
      automation_enabled: false,
      automation_status: String(run.status || "").toLowerCase(),
      updated_at_utc: tick.utc,
      updated_at_paris: tick.paris,
    });
    const auditId = `terminal_config_archive__${args.runId}__${tick.epochMs}`;
    await store.persistence.setDocument("desk_replay_audit_logs", auditId, {
      audit_id: auditId,
      event_type: "TERMINAL_REPLAY_CONFIG_ARCHIVED",
      backtest_id: args.runId,
      replay_run_id: args.runId,
      run_status: run.status,
      config_ids: selected.map((config) => config.config_id),
      reason: args.reason,
      actor: "codex-vps-operator",
      created_at_utc: tick.utc,
      created_at_paris: tick.paris,
    });
    output({
      ok: true,
      status: "APPLIED",
      run_id: args.runId,
      run_status: run.status,
      archived_configs: selected.map((config) => config.config_id),
      audit_id: auditId,
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
    runId: "",
    reason: "Configuration archivée après état terminal afin de libérer le prochain replay.",
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--apply") parsed.apply = true;
    else if (value === "--env") parsed.env = values[++index];
    else if (value === "--store-module") parsed.storeModule = values[++index];
    else if (value === "--run-id") parsed.runId = values[++index];
    else if (value === "--reason") parsed.reason = values[++index];
    else throw new Error(`UNKNOWN_ARGUMENT:${value}`);
  }
  if (!parsed.runId) throw new Error("RUN_ID_REQUIRED");
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
