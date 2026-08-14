#!/usr/bin/env node
import process from "node:process";
import { SystemClock } from "@tv-automation/desk-time";
import { createDeskStoreFromEnv } from "../src/store.js";
import { runResearchBacktestReviewTask } from "../src/research/research-backtest-review-runner.js";
import { runResearchRobustnessReviewTask } from "../src/research/research-robustness-review-runner.js";
import { runResearchStrategyIterationTask } from "../src/research/research-strategy-iteration-runner.js";

const input = await readJsonStdin();
const store = createDeskStoreFromEnv();
if (!store.clock) store.clock = new SystemClock();

try {
  await store.persistence.initialized;
  const result = await runResearchAgentTask({ store, input });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify(failure(error))}\n`);
} finally {
  await store.persistence.close?.();
}

async function readJsonStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) throw Object.assign(new Error("Runner input is required."), {
    code: "RESEARCH_AGENT_RUNNER_INPUT_REQUIRED",
    retryable: false,
  });
  return JSON.parse(raw);
}

function runResearchAgentTask({ store, input }) {
  const taskType = String(input?.task?.task_type || "").trim().toUpperCase();
  const nowUtc = store.clock.now().utc;
  if (taskType === "RESEARCH_BACKTEST_REVIEW") {
    return runResearchBacktestReviewTask({ store, runnerInput: input, nowUtc });
  }
  if (taskType === "RESEARCH_STRATEGY_ITERATION") {
    return runResearchStrategyIterationTask({ store, runnerInput: input, nowUtc });
  }
  if (taskType === "RESEARCH_ROBUSTNESS_REVIEW") {
    return runResearchRobustnessReviewTask({ store, runnerInput: input, nowUtc });
  }
  throw Object.assign(new Error(`Unsupported research task type: ${taskType || "missing"}.`), {
    code: "RESEARCH_AGENT_TASK_TYPE_UNSUPPORTED",
    retryable: false,
  });
}

function failure(error) {
  return {
    ok: false,
    status: "FAILED",
    error_code: error?.code || "RESEARCH_AGENT_RUNNER_FAILED",
    error_message: String(error?.message || error || "unknown error").slice(0, 2_000),
    retryable: error?.retryable === true,
  };
}
