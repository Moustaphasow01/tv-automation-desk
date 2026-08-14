#!/usr/bin/env node
import process from "node:process";
import { resolve } from "node:path";
import { SystemClock } from "@tv-automation/desk-time";
import { PostgresAgentRuntimeRepository } from "../src/agent-runtime-postgres-repository.js";
import { createAgentRuntimeSchedulerService } from "../src/agent-runtime-scheduler-service.js";
import {
  AgentRuntimeSupervisorService,
  createProcessAgentTaskRunner,
  shouldWakeAgentRuntimeSupervisor,
  supervisorShouldContinueImmediately,
} from "../src/agent-runtime-supervisor.js";
import {
  buildAgentRuntimeSupervisorHeartbeatDetails,
  buildAgentRuntimeSupervisorHostConfig,
} from "../src/agent-runtime-supervisor-host.js";
import { createDeskStoreFromEnv } from "../src/store.js";

const clock = new SystemClock();
const hostConfig = buildAgentRuntimeSupervisorHostConfig({
  env: process.env,
  argv: process.argv,
  pid: process.pid,
  cwd: process.cwd(),
});
const {
  once,
  lane,
  mode,
  worker_pool: workerPool,
  pool_policy: poolPolicy,
  worker_id: workerId,
  poll_ms: pollMs,
  lease_seconds: leaseSeconds,
  conversation_provider: conversationProvider,
  conversation_max_turns: conversationMaxTurns,
  execution_defaults: executionDefaults,
  retry_policy: retryPolicy,
  scheduler_mode: schedulerMode,
  release_version: releaseVersion,
  service_id: serviceId,
} = hostConfig;
const runner = createProcessAgentTaskRunner({
  command: hostConfig.runner_command,
  args: hostConfig.runner_args,
  cwd: resolve(hostConfig.project_root),
  timeoutMs: hostConfig.runner_timeout_ms,
});
const store = createDeskStoreFromEnv();
const repository = new PostgresAgentRuntimeRepository({ pool: store.persistence.pool, clock });
const schedulerService = schedulerMode === "disabled"
  ? null
  : createAgentRuntimeSchedulerService({ persistence: store.persistence, clock });
const supervisor = new AgentRuntimeSupervisorService({
  repository,
  runner,
  lane,
  mode,
  workerId,
  workerPool,
  poolPolicy,
  leaseSeconds,
  conversationProvider,
  conversationMaxTurns,
  executionDefaults,
  retryPolicy,
  claimGate: createClaimGate({ schedulerService, schedulerMode }),
  clock,
});

let stopped = false;
let lockClient = null;
const wakeWaiters = new Set();

process.on("SIGINT", () => { stopped = true; wakeAll(); });
process.on("SIGTERM", () => { stopped = true; wakeAll(); });

try {
  await store.persistence.initialized;
  lockClient = await store.persistence.pool.connect();
  const lockName = `desk:agent-runtime-supervisor:${workerId}`;
  const lock = await lockClient.query("SELECT pg_try_advisory_lock(hashtext($1)) AS acquired", [lockName]);
  if (!lock.rows[0]?.acquired) throw new Error(`AGENT_RUNTIME_SUPERVISOR_ALREADY_RUNNING:${workerId}`);
  lockClient.on("notification", onNotification);
  await lockClient.query("LISTEN desk_agent_runtime_ready");
  await heartbeat("starting", buildAgentRuntimeSupervisorHeartbeatDetails(hostConfig, {
    runner_configured: Boolean(runner),
  }));

  do {
    try {
      const result = await supervisor.runOnce();
      await heartbeat(result.ok === false ? "degraded" : "healthy", { lane, mode, last_result: result });
      console.log(JSON.stringify({ at: clock.now().utc, ...result }));
      if (once) break;
      if (supervisorShouldContinueImmediately(result)) await delay(250);
      else await waitForWake(pollMs);
    } catch (error) {
      await heartbeat("degraded", { lane, mode, error: safeError(error) }).catch(() => undefined);
      if (once) throw error;
      await waitForWake(Math.max(pollMs, 5_000));
    }
  } while (!stopped);
} finally {
  await heartbeat("stopping", { lane, worker_pool: workerPool, mode }).catch(() => undefined);
  if (lockClient) {
    lockClient.off("notification", onNotification);
    await lockClient.query("UNLISTEN desk_agent_runtime_ready").catch(() => undefined);
    await lockClient.query(
      "SELECT pg_advisory_unlock(hashtext($1))",
      [`desk:agent-runtime-supervisor:${workerId}`],
    ).catch(() => undefined);
    lockClient.release();
  }
  await store.persistence.close?.();
}

function onNotification(message) {
  if (!shouldWakeAgentRuntimeSupervisor(message, lane)) return;
  wakeAll();
}

async function heartbeat(status, details) {
  await repository.recordHeartbeat({ serviceId, instanceId: workerId, releaseVersion, status, details });
}

function waitForWake(milliseconds) {
  return new Promise((resolveWake) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      wakeWaiters.delete(finish);
      resolveWake();
    };
    const timer = setTimeout(finish, milliseconds);
    wakeWaiters.add(finish);
  });
}

function wakeAll() {
  for (const wake of [...wakeWaiters]) wake();
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function createClaimGate({ schedulerService, schedulerMode }) {
  if (!schedulerService || schedulerMode === "disabled") return null;
  return {
    async evaluateLaneClaimGate(input) {
      const gate = await schedulerService.evaluateLaneClaimGate(input);
      if (schedulerMode === "shadow") return { ...gate, shadow_allowed: gate.allowed, allowed: true };
      return gate;
    },
  };
}

function safeError(error) {
  return {
    code: error?.code || "AGENT_RUNTIME_SUPERVISOR_FAILED",
    message: String(error?.message || error || "unknown error").slice(0, 1000),
    retryable: error?.retryable === true,
  };
}
