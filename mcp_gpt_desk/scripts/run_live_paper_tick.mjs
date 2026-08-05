#!/usr/bin/env node
import { createDeskStoreFromEnv } from "../src/store.js";
import { floorParisCheckpoint, liveRunId } from "../src/live-scope.js";

const args = parseArgs(process.argv.slice(2));
const nowMs = resolveNow(args["now-utc"] || args.now);
const timestampParis = args["timestamp-paris"] || floorParisCheckpoint(nowMs, 5);
const session = args.session || inferSession(timestampParis);
const tradingDate = args["trading-date"] || timestampParis.slice(0, 10);
const strategyId = session === "ny_open" ? "ny_open_1530" : "asia_open";
const store = createDeskStoreFromEnv();

try {
  const result = await store.reconcileLivePaperExecution({
    strategy_id: strategyId,
    trading_date: tradingDate,
    session,
    run_id: liveRunId(tradingDate, session),
    mode: "live",
    timestamp_paris: timestampParis,
    as_of_utc: new Date(timestampParis).toISOString(),
  });
  console.log(JSON.stringify({
    ok: true,
    status: result.status,
    mode: "live",
    execution_mode: store.liveExecutionMode || "shadow",
    broker_execution: false,
    trading_date: tradingDate,
    session,
    timestamp_paris: timestampParis,
    result,
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
  if (!Number.isFinite(parsed)) throw new Error(`LIVE_PAPER_TICK_NOW_INVALID:${value}`);
  return parsed;
}

function inferSession(timestampParis) {
  return timestampParis.slice(11, 16) >= "15:30" ? "ny_open" : "asia_open";
}
