#!/usr/bin/env node
import { createDeskStoreFromEnv } from "../src/store.js";

const store = createDeskStoreFromEnv();
try {
  await store.persistence.initialized;
  const result = await store.strategyEvaluationScheduler.runCycle({
    now_utc: argument("--as-of") || new Date().toISOString(),
    cadence_seconds: Number(argument("--cadence-seconds") || 300),
    max_lag_seconds: Number(argument("--max-lag-seconds") || 600),
    source_class: argument("--source-class") || "CERTIFICATION_REPLAY",
    certification_run_id: argument("--certification-run-id") || `strategy-scheduler-cert:${new Date().toISOString()}`,
    actor: "strategy-evaluation-scheduler-once",
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await store.persistence.close?.();
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || null : null;
}
