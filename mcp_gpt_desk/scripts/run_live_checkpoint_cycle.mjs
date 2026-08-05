#!/usr/bin/env node
import { createDeskStoreFromEnv } from "../src/store.js";
import { floorParisCheckpoint } from "../src/live-scope.js";

const args = parseArgs(process.argv.slice(2));
const nowMs = resolveNow(args["now-utc"] || args.now);
const checkpointParis = args["checkpoint-paris"]
  || args["timestamp-paris"]
  || floorParisCheckpoint(nowMs, 15);
const session = args.session || inferSession(checkpointParis);
const tradingDate = args["trading-date"] || checkpointParis.slice(0, 10);
const store = createDeskStoreFromEnv();

try {
  const pack = await store.buildAndPublishLiveRollingPack({
    date: tradingDate,
    session,
    checkpoint_paris: checkpointParis,
  });
  console.log(JSON.stringify({
    ok: true,
    status: "READY",
    mode: "live",
    execution_mode: store.liveExecutionMode || "shadow",
    paper_execution_enabled: store.livePaperExecutionEnabled !== false,
    broker_execution: false,
    trading_date: tradingDate,
    session,
    checkpoint_paris: checkpointParis,
    pack,
    next_action: "claim_next_live_work",
    mutation_scope: "pack_build_only",
    cursor_lease_acquired: false,
    gpt_analysis_executed: false,
  }, null, 2));
} catch (error) {
  const code = error?.code || String(error?.message || error).split(":")[0];
  const knownReadinessFailure = [
    "LOCAL_PACK_CORE_DATASET_MISSING",
    "LOCAL_PACK_CORE_DATASET_STALE",
    "LIVE_ROLLING_PACK_COVERAGE_INSUFFICIENT",
  ].includes(code);
  if (!knownReadinessFailure) throw error;
  console.log(JSON.stringify({
    ok: true,
    status: "DATA_NOT_READY",
    mode: "live",
    execution_mode: store.liveExecutionMode || "shadow",
    broker_execution: false,
    trading_date: tradingDate,
    session,
    checkpoint_paris: checkpointParis,
    reason: "live_source_not_fresh",
    error: {
      code,
      message: error.message || String(error),
      details: error.details || {},
    },
    next_action: "wait_for_fresh_closed_candles",
    cursor_lease_acquired: false,
    gpt_analysis_executed: false,
  }, null, 2));
} finally {
  await store.persistence.close?.();
}

function parseArgs(values) {
  const output = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    output[key] = next && !next.startsWith("--") ? values[++index] : true;
  }
  return output;
}

function resolveNow(value) {
  if (value === undefined) return Date.now();
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new Error(`LIVE_READINESS_NOW_INVALID:${value}`);
  return parsed;
}

function inferSession(checkpointParis) {
  const time = checkpointParis.slice(11, 16);
  return time >= "15:30" ? "ny_open" : "asia_open";
}
