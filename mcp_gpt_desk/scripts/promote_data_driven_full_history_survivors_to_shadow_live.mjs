#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { canonicalSha256 } from "@tv-automation/desk-domain";
import { createDeskStoreFromEnv } from "../src/store.js";

const DEFAULT_REPORT = "reports/research/mega-1000-mnq-m5-20260817b-robust-pass-cohort-full-history-validation.json";

const input = parseArgs(process.argv.slice(2));
const reportPath = input.report || input.reportPath || DEFAULT_REPORT;
const cohortId = input.cohortId || input.cohort_id || "full-history-min8-shadow-live-20260817b";
const nowUtc = new Date().toISOString();
const store = createDeskStoreFromEnv();

try {
  await store.persistence.initialized;
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const survivors = survivorResults(report);
  const existingIds = await existingInstanceIds(store.persistence.pool, survivors, cohortId);
  const created = [];
  const skipped = [];
  for (const result of survivors) {
    const instanceId = instanceIdFor(result, cohortId);
    if (existingIds.has(instanceId)) {
      skipped.push({ strategy_instance_id: instanceId, strategy_version_id: result.strategy_version_id, reason: "EXISTS" });
      continue;
    }
    const command = instanceCommand({ result, report, cohortId, instanceId, nowUtc });
    const registered = await store.strategyKernel.registerInstance(command, {
      actor: "data-driven-cohort-promoter",
      reason: "Promote full-history robust survivors to SHADOW live signal runtime.",
      idempotency_key: `promote-shadow-live:${cohortId}:${result.strategy_version_id}`,
    });
    created.push({
      strategy_instance_id: registered.instance.strategy_instance_id,
      strategy_version_id: registered.instance.strategy_version_id,
      family_id: result.family_id,
      variant_index: result.variant_index,
      runtime_state: registered.instance.runtime_state,
      execution_mode: registered.instance.execution_mode,
    });
  }
  process.stdout.write(`${JSON.stringify({
    status: "READY",
    report_path: reportPath,
    cohort_id: cohortId,
    survivor_count: survivors.length,
    created_count: created.length,
    skipped_count: skipped.length,
    created,
    skipped,
    safety: {
      execution_mode: "SHADOW",
      broker_execution_enabled: false,
      provider_commands_created: 0,
    },
  }, null, 2)}\n`);
} finally {
  await store.persistence.close?.();
}

function survivorResults(report) {
  return (Array.isArray(report.results) ? report.results : [])
    .filter((item) => item.status === "COMPLETED")
    .filter((item) => item.promotion_readiness?.min_8_trade_gate === true)
    .sort((left, right) => Number(right.full_history?.total_r || 0) - Number(left.full_history?.total_r || 0));
}

async function existingInstanceIds(pool, survivors, cohortId) {
  if (!survivors.length) return new Set();
  const ids = survivors.map((result) => instanceIdFor(result, cohortId));
  const result = await pool.query("SELECT strategy_instance_id::text FROM strategy_instances WHERE strategy_instance_id = ANY($1::uuid[])", [ids]);
  return new Set(result.rows.map((row) => row.strategy_instance_id));
}

function instanceCommand({ result, report, cohortId, instanceId, nowUtc }) {
  return {
    strategy_instance_id: instanceId,
    strategy_version_id: result.strategy_version_id,
    runtime_state: "RUNNING",
    execution_mode: "SHADOW",
    account_scope: null,
    instrument_scope: [report.dataset?.instrument || "MNQ"],
    session_scope: ["live"],
    risk_budget_ref: null,
    triple_lock_validated: false,
    last_heartbeat_at: nowUtc,
    started_at: nowUtc,
    created_at: nowUtc,
    updated_at: nowUtc,
    metadata: {
      cohort_id: cohortId,
      source_report: "robust-pass-cohort-full-history-validation",
      source_report_path: report.input?.cohortPath || null,
      promotion_policy: "FULL_HISTORY_MIN_8_TRADE_GATE_SHADOW_ONLY",
      family_id: result.family_id,
      variant_index: result.variant_index,
      candidate_key: result.candidate_key,
      full_history: result.full_history,
      scheduler: {
        enabled: true,
        cadence_seconds: 300,
        max_lag_seconds: 600,
        next_due_at_utc: nowUtc,
      },
      safety: {
        automatic_broker_execution: false,
        live_broker_execution: false,
        execution_mode: "SHADOW",
      },
    },
  };
}

function instanceIdFor(result, cohortId) {
  return uuidFromHash(canonicalSha256({
    kind: "strategy_instance",
    cohort_id: cohortId,
    strategy_version_id: result.strategy_version_id,
    execution_mode: "SHADOW",
  }));
}

function uuidFromHash(hash) {
  const clean = String(hash || "").replace(/^sha256:/, "").padEnd(32, "0");
  const variant = ((Number.parseInt(clean[16] || "8", 16) & 0x3) | 0x8).toString(16);
  return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-4${clean.slice(13, 16)}-${variant}${clean.slice(17, 20)}-${clean.slice(20, 32)}`;
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, value) => value.toUpperCase());
    const next = args[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
