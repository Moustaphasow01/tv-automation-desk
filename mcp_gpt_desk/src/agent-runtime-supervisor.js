import { spawn } from "node:child_process";
import {
  resolveAgentExecutionPolicyV1,
  resolveAgentWorkerPoolV1,
} from "@tv-automation/desk-domain";
import { SystemClock } from "@tv-automation/desk-time";
import { AiContextGateService } from "./ai-context-gate-service.js";

export const AGENT_SUPERVISOR_MODES = Object.freeze(["disabled", "shadow", "active"]);
export const AGENT_RUNTIME_NOTIFY_CHANNEL = "desk_agent_runtime_ready";
export const AGENT_RUNTIME_NOTIFY_SCHEMA = "desk_agent_runtime_ready_v1";

export class AgentRuntimeSupervisorService {
  constructor({
    repository,
    runner = null,
    workerId,
    workerPool = null,
    poolPolicy = {},
    lane = "live",
    mode = "shadow",
    leaseSeconds = 900,
    conversationProvider = "codex",
    conversationMaxTurns = 12,
    executionDefaults = {},
    retryPolicy = {},
    claimGate = null,
    aiContextGateService = null,
    clock = new SystemClock(),
  } = {}) {
    if (!repository) throw new Error("AGENT_RUNTIME_REPOSITORY_REQUIRED");
    if (!workerId) throw new Error("AGENT_RUNTIME_WORKER_ID_REQUIRED");
    this.repository = repository;
    this.runner = runner;
    this.workerId = String(workerId);
    this.workerPool = workerPool ? String(workerPool) : null;
    this.poolPolicy = object(poolPolicy);
    this.lane = String(lane || "live");
    this.mode = normalizeMode(mode);
    this.leaseSeconds = boundedInteger(leaseSeconds, 900, 30, 7200);
    this.conversationProvider = String(conversationProvider || "codex");
    this.conversationMaxTurns = boundedInteger(conversationMaxTurns, 12, 1, 1000);
    this.executionDefaults = object(executionDefaults);
    this.retryPolicy = object(retryPolicy);
    this.claimGate = claimGate;
    this.aiContextGateService = aiContextGateService instanceof AiContextGateService || aiContextGateService?.evaluateAndPersist
      ? aiContextGateService
      : null;
    this.clock = clock;
  }

  async runOnce() {
    const nowUtc = this.clock.now().utc;
    const idle = this.#idleGate(nowUtc);
    if (idle) return idle;
    const poolGate = this.#poolGate(nowUtc);
    if (poolGate) return poolGate;
    const gate = await this.#claimGate(nowUtc);
    if (gate) return gate;
    const poolResolution = this.#poolResolution();

    const claim = await this.repository.claimNextTask({
      lane: this.lane,
      workerId: this.workerId,
      leaseSeconds: this.leaseSeconds,
      nowUtc,
      workerPool: poolResolution.pool_id,
      taskTypePatterns: poolResolution.allowed_task_type_patterns,
    });
    if (!claim?.task) return idleResult("NO_WORK", nowUtc, this);
    return this.#runClaimedTask(claim, nowUtc, poolResolution);
  }

  #poolGate(nowUtc) {
    const resolution = this.#poolResolution();
    if (resolution.ok) return null;
    return {
      ok: false,
      status: "POOL_CONFIGURATION_REJECTED",
      token_consumed: false,
      lane: this.lane,
      worker_id: this.workerId,
      worker_pool: this.workerPool,
      checked_at_utc: nowUtc,
      pool_resolution: resolution,
    };
  }

  #poolResolution() {
    return resolveAgentWorkerPoolV1({
      policy: this.poolPolicy,
      pool_id: this.workerPool,
      worker_id: this.workerId,
      lane: this.lane,
    });
  }

  async #claimGate(nowUtc) {
    if (!this.claimGate?.evaluateLaneClaimGate) return null;
    const gate = await this.claimGate.evaluateLaneClaimGate({
      lane: this.lane,
      worker_id: this.workerId,
      now_utc: nowUtc,
    });
    if (gate?.allowed !== false) return null;
    return {
      ok: true,
      status: "DEFERRED_BY_SCHEDULER",
      token_consumed: false,
      lane: this.lane,
      worker_id: this.workerId,
      checked_at_utc: nowUtc,
      scheduler_gate: gate,
    };
  }

  #idleGate(nowUtc) {
    if (this.mode === "disabled") return idleResult("DISABLED", nowUtc, this);
    if (this.mode === "shadow") return idleResult("SHADOW_NO_CLAIM", nowUtc, this);
    if (this.runner?.run) return null;
    return {
      ok: false,
      status: "RUNNER_NOT_CONFIGURED",
      token_consumed: false,
      lane: this.lane,
      worker_id: this.workerId,
      checked_at_utc: nowUtc,
    };
  }

  async #resolveConversation(claim, nowUtc) {
    if (!this.repository.resolveConversationForTask) return null;
    return this.repository.resolveConversationForTask({
      taskId: claim.task.task_id,
      provider: this.conversationProvider,
      maxTurns: this.conversationMaxTurns,
      workerId: this.workerId,
      nowUtc,
    });
  }

  async #runClaimedTask(claim, nowUtc, poolResolution = null) {
    let conversation = null;
    let executionPolicy = null;
    const startedUtc = this.clock.now().utc;
    try {
      conversation = await this.#resolveConversation(claim, nowUtc);
      executionPolicy = await this.#resolveExecutionPolicy(claim, nowUtc);
      const output = await this.runner.run({
        task: claim.task,
        lease: claim.lease,
        event: claim.event,
        conversation,
        execution_policy: executionPolicy?.policy || null,
        execution_policy_snapshot: executionPolicy?.snapshot || null,
        worker_pool: poolResolution?.pool || null,
        pool_resolution: poolResolution,
        nowUtc,
      });
      if (output?.ok === false) throw runnerError(output);
      return this.#completeClaim(claim, output, conversation, executionPolicy, startedUtc, poolResolution);
    } catch (error) {
      return this.#failClaim(claim, error, conversation, executionPolicy, startedUtc, poolResolution);
    }
  }

  async #resolveExecutionPolicy(claim, nowUtc) {
    if (this.repository.resolveExecutionPolicyForTask) {
      return this.repository.resolveExecutionPolicyForTask({
        taskId: claim.task.task_id,
        defaults: this.executionDefaults,
        workerId: this.workerId,
        nowUtc,
      });
    }
    const resolved = resolveAgentExecutionPolicyV1({ task: claim.task, defaults: this.executionDefaults });
    if (!resolved.ok) throw Object.assign(new Error(resolved.reasons.join(",")), {
      code: "AGENT_EXECUTION_POLICY_REJECTED",
      retryable: false,
    });
    return resolved;
  }

  async #completeClaim(claim, output, conversation, executionPolicy, startedUtc, poolResolution = null) {
    const conversationOutcome = await this.#recordConversationOutcome(conversation, output);
    const aiContextGate = await this.#recordAiContextGateDecision(claim, output, executionPolicy);
    const completion = await this.repository.completeTask({
      taskId: claim.task.task_id,
      workerId: this.workerId,
      leaseToken: claim.lease.lease_token,
      outputRef: output?.output_ref || output?.outputRef || null,
      nowUtc: this.clock.now().utc,
    });
    const metrics = await this.#recordRunMetrics({
      claim,
      task: completion.task,
      conversation,
      executionPolicy,
      output,
      outcome: "COMPLETED",
      startedUtc,
      finishedUtc: completion.task.completed_at_utc || this.clock.now().utc,
    });
    return {
      ok: true,
      status: "COMPLETED",
      token_consumed: true,
      lane: this.lane,
      worker_id: this.workerId,
      worker_pool: poolResolution?.pool_id || null,
      task: completion.task,
      event: completion.event,
      conversation: conversationOutcome?.conversation || conversation?.conversation || null,
      execution_policy: executionPolicy?.policy || null,
      execution_policy_snapshot: executionPolicy?.snapshot || null,
      ai_context_gate: aiContextGate,
      metrics,
      output: output || {},
    };
  }

  async #recordAiContextGateDecision(claim, output, executionPolicy) {
    if (!this.aiContextGateService || !isAiContextTask(claim.task)) return null;
    const outputRef = object(output?.output_ref || output?.outputRef);
    const raw = object(outputRef.result || outputRef.payload || outputRef);
    if (!Object.keys(raw).length) return null;
    const common = {
      idempotency_key: `ai-context-gate:${claim.task.task_id}:${claim.task.revision || 0}`,
      agent_task_id: claim.task.task_id,
      signal_id: firstDefined(raw.signal_id, raw.advisory?.subject?.signal_id, claim.task.payload?.signal_id),
      candidate_allocation_id: firstDefined(raw.candidate_allocation_id, raw.advisory?.subject?.candidate_allocation_id, claim.task.payload?.candidate_allocation_id),
      position_id: firstDefined(raw.position_id, raw.advisory?.subject?.position_id, claim.task.payload?.position_id),
    };
    if (raw.schema_version === "ai_context_gate_execution_v1") {
      const persistence = await this.aiContextGateService.recordEvaluatedResult({ ...common, result: raw });
      return { status: raw.status, persistence };
    }
    const result = await this.aiContextGateService.evaluateAndPersist({
      ...raw,
      ...common,
      advisory: object(raw.advisory || raw),
      policy: object(raw.policy || executionPolicy?.policy?.ai_context_gate_policy || {}),
      as_of_utc: firstDefined(raw.as_of_utc, raw.completed_at_utc, this.clock.now().utc),
    });
    return { status: result.status, persistence: result.persistence };
  }

  async #recordConversationOutcome(conversation, output) {
    if (!conversation?.conversation?.conversation_id || !this.repository.recordConversationOutcome) return null;
    return this.repository.recordConversationOutcome({
      conversationId: conversation.conversation.conversation_id,
      externalConversationRef: conversationRefFromOutput(output),
      metadata: { last_task_output_ref: output?.output_ref || output?.outputRef || null },
      nowUtc: this.clock.now().utc,
    });
  }

  async #failClaim(claim, error, conversation, executionPolicy, startedUtc, poolResolution = null) {
    const failure = await this.repository.failTask({
      taskId: claim.task.task_id,
      workerId: this.workerId,
      leaseToken: claim.lease.lease_token,
      errorCode: error.code || "AGENT_RUNNER_FAILED",
      errorMessage: String(error.message || error),
      retryable: error.retryable === true,
      retryPolicy: this.retryPolicy,
      nowUtc: this.clock.now().utc,
    });
    const outcome = failure.dead_letter ? "DEAD_LETTERED" : (failure.task?.status === "READY" ? "FAILED_RETRYABLE" : "FAILED_TERMINAL");
    const metrics = await this.#recordRunMetrics({
      claim,
      task: failure.task,
      conversation,
      executionPolicy,
      output: null,
      error,
      outcome,
      deadLetter: failure.dead_letter,
      startedUtc,
      finishedUtc: failure.task?.failed_at_utc || this.clock.now().utc,
    });
    return {
      ok: false,
      status: failure.task?.status === "READY" ? "FAILED_RETRYABLE" : "FAILED_TERMINAL",
      token_consumed: true,
      lane: this.lane,
      worker_id: this.workerId,
      worker_pool: poolResolution?.pool_id || null,
      task: failure.task,
      event: failure.event,
      dead_letter: failure.dead_letter || null,
      metrics,
      error: safeError(error),
    };
  }

  async #recordRunMetrics({
    claim,
    task,
    conversation,
    executionPolicy,
    output,
    error = null,
    outcome,
    deadLetter = null,
    startedUtc,
    finishedUtc,
  }) {
    if (!this.repository.recordTaskRunMetrics) return null;
    const usage = usageFromOutput(output);
    const metricInput = {
      task_id: task?.task_id || claim.task.task_id,
      mission_id: task?.mission_id || claim.task.mission_id,
      conversation_id: conversation?.conversation?.conversation_id || task?.conversation_id || claim.task.conversation_id,
      execution_policy_snapshot_id: executionPolicy?.snapshot?.policy_snapshot_id || executionPolicy?.snapshot?.agent_execution_policy_snapshot_id,
      dead_letter_id: deadLetter?.dead_letter_id || null,
      worker_id: this.workerId,
      lane: this.lane,
      task_type: task?.task_type || claim.task.task_type,
      model: executionPolicy?.policy?.model || null,
      reasoning_effort: executionPolicy?.policy?.reasoning_effort || null,
      outcome,
      queue_latency_ms: metricDurationMs(claim.task.created_at_utc, claim.task.claimed_at_utc || startedUtc),
      run_duration_ms: metricDurationMs(startedUtc, finishedUtc),
      total_latency_ms: metricDurationMs(claim.task.created_at_utc, finishedUtc),
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      total_tokens: usage.total_tokens,
      cost_micros_usd: usage.cost_micros_usd,
      output_ref: output?.output_ref || output?.outputRef || task?.output_ref || null,
      error_code: error?.code || null,
      started_at_utc: startedUtc,
      finished_at_utc: finishedUtc,
      metadata: { runner_status: output?.status || null },
    };
    try {
      return await this.repository.recordTaskRunMetrics(metricInput);
    } catch (metricsError) {
      return { ok: false, error: safeError(Object.assign(metricsError, { retryable: false })) };
    }
  }
}

export function shouldWakeAgentRuntimeSupervisor(messageOrPayload, lane = "live") {
  const payload = parsePayload(messageOrPayload);
  if (payload.schema && payload.schema !== AGENT_RUNTIME_NOTIFY_SCHEMA) return false;
  if (payload.channel && payload.channel !== AGENT_RUNTIME_NOTIFY_CHANNEL) return false;
  if (payload.lane && String(payload.lane) !== String(lane)) return false;
  return ["PENDING", "READY"].includes(String(payload.status || "").toUpperCase());
}

export function createProcessAgentTaskRunner({
  command,
  args = [],
  cwd = process.cwd(),
  env = process.env,
  timeoutMs = 780_000,
} = {}) {
  if (!command) return null;
  return {
    async run(input) {
      return runProcess({ command, args, cwd, env, timeoutMs, input });
    },
  };
}

export function supervisorShouldContinueImmediately(result = {}) {
  return ["COMPLETED", "FAILED_RETRYABLE"].includes(result.status);
}

function runProcess({ command, args, cwd, env, timeoutMs, input }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(Object.assign(new Error("Agent task runner timed out."), {
        code: "AGENT_RUNNER_TIMEOUT",
        retryable: true,
      }));
    }, runnerTimeoutMs(input, timeoutMs));
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.stdin.on("error", () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("Agent task runner closed its input before payload delivery."), {
        code: "AGENT_RUNNER_STDIN_FAILED", retryable: true,
      }));
      child.kill("SIGTERM");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(Object.assign(error, { code: error.code || "AGENT_RUNNER_SPAWN_FAILED", retryable: true }));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(Object.assign(new Error(stderr || `Agent task runner exited with code ${code}.`), {
          code: "AGENT_RUNNER_EXIT_FAILED",
          retryable: true,
        }));
        return;
      }
      try {
        resolve(stdout.trim() ? JSON.parse(stdout) : { ok: true });
      } catch (error) {
        reject(Object.assign(error, { code: "AGENT_RUNNER_OUTPUT_INVALID", retryable: false }));
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

function idleResult(status, nowUtc, supervisor) {
  return {
    ok: true,
    status,
    token_consumed: false,
    lane: supervisor.lane,
    worker_id: supervisor.workerId,
    checked_at_utc: nowUtc,
  };
}

function runnerError(output = {}) {
  return Object.assign(new Error(output.error_message || output.error || "Agent runner returned ok=false."), {
    code: output.error_code || "AGENT_RUNNER_REJECTED",
    retryable: output.retryable === true,
  });
}

function parsePayload(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return {}; }
  }
  if (value.payload) return parsePayload(value.payload);
  return typeof value === "object" ? value : {};
}

function normalizeMode(value) {
  const normalized = String(value || "shadow").toLowerCase();
  if (!AGENT_SUPERVISOR_MODES.includes(normalized)) return "shadow";
  return normalized;
}

function boundedInteger(value, fallback, minimum, maximum) {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function runnerTimeoutMs(input, fallback) {
  return boundedInteger(input?.execution_policy?.timeout_ms, fallback, 5_000, 1_800_000);
}

function isAiContextTask(task = {}) {
  const text = [
    task.task_type,
    task.task_key,
    task.mission_key,
    task.mission_type,
  ].filter(Boolean).join(" ").toUpperCase();
  return text.includes("CONTEXT_DECISION") || text.includes("AI_CONTEXT");
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function safeError(error) {
  return {
    code: error?.code || "AGENT_RUNTIME_SUPERVISOR_FAILED",
    message: String(error?.message || error || "unknown error").slice(0, 1000),
    retryable: error?.retryable === true,
  };
}

function conversationRefFromOutput(output = {}) {
  return output?.conversation?.external_conversation_ref
    || output?.conversation?.thread_id
    || output?.telemetry?.thread_id
    || output?.thread_id
    || null;
}

function usageFromOutput(output = {}) {
  const usage = object(output?.usage || output?.telemetry?.usage || output?.telemetry || {});
  const inputTokens = integer(firstDefined(usage.input_tokens, usage.prompt_tokens, usage.inputTokens, usage.promptTokens));
  const outputTokens = integer(firstDefined(usage.output_tokens, usage.completion_tokens, usage.outputTokens, usage.completionTokens));
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: integer(firstDefined(usage.total_tokens, usage.totalTokens, sumTokens(inputTokens, outputTokens))),
    cost_micros_usd: integer(firstDefined(usage.cost_micros_usd, usage.costMicrosUsd)),
  };
}

function durationMs(start, end) {
  const startMs = Date.parse(start || "");
  const endMs = Date.parse(end || "");
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  return endMs - startMs;
}

function metricDurationMs(start, end) {
  const duration = durationMs(start, end);
  if (duration === null) return null;
  return Math.min(duration, 2_147_483_647);
}

function sumTokens(inputTokens, outputTokens) {
  if (!Number.isInteger(inputTokens) || !Number.isInteger(outputTokens)) return null;
  return inputTokens + outputTokens;
}

function integer(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined) return value;
  }
  return undefined;
}
