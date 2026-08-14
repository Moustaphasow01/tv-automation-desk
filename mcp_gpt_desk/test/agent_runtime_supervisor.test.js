import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyAgentConversationUseV1,
  claimAgentTaskV1,
  completeAgentTaskV1,
  failAgentTaskV1,
  planAgentConversationAssignmentV1,
  resolveAgentExecutionPolicyV1,
} from "@tv-automation/desk-domain";
import { FixedClock } from "@tv-automation/desk-time";
import { AiContextGateService } from "../src/ai-context-gate-service.js";
import { InMemoryAiContextGateRepository } from "../src/ai-context-gate-repository.js";
import {
  AgentRuntimeSupervisorService,
  shouldWakeAgentRuntimeSupervisor,
} from "../src/agent-runtime-supervisor.js";

const clock = new FixedClock(Date.parse("2026-08-09T10:00:00.000Z"));

describe("AgentRuntimeSupervisorService", () => {
  it("does not claim or invoke a runner in shadow mode", async () => {
    const repository = new MemoryAgentRepository(taskFixture());
    const runner = new SpyRunner();
    const supervisor = new AgentRuntimeSupervisorService({
      repository,
      runner,
      workerId: "agent-runtime-live-01",
      lane: "live",
      mode: "shadow",
      clock,
    });

    const result = await supervisor.runOnce();

    assert.equal(result.status, "SHADOW_NO_CLAIM");
    assert.equal(result.token_consumed, false);
    assert.equal(repository.claims, 0);
    assert.equal(runner.calls, 0);
  });

  it("does not claim work in active mode until a runner is configured", async () => {
    const repository = new MemoryAgentRepository(taskFixture());
    const supervisor = new AgentRuntimeSupervisorService({
      repository,
      workerId: "agent-runtime-live-01",
      lane: "live",
      mode: "active",
      clock,
    });

    const result = await supervisor.runOnce();

    assert.equal(result.ok, false);
    assert.equal(result.status, "RUNNER_NOT_CONFIGURED");
    assert.equal(result.token_consumed, false);
    assert.equal(repository.claims, 0);
  });

  it("claims exactly one eligible task before invoking the configured runner and records runtime metrics", async () => {
    const repository = new MemoryAgentRepository(taskFixture());
    const runner = new SpyRunner({
      output: {
        ok: true,
        output_ref: "artifact/agent/live-monitor.json",
        usage: {
          input_tokens: 1200,
          output_tokens: 300,
          total_tokens: 1500,
          cost_micros_usd: 4200,
        },
      },
    });
    const supervisor = new AgentRuntimeSupervisorService({
      repository,
      runner,
      workerId: "agent-runtime-live-01",
      lane: "live",
      mode: "active",
      clock,
    });

    const result = await supervisor.runOnce();

    assert.equal(result.ok, true);
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.token_consumed, true);
    assert.equal(repository.claims, 1);
    assert.equal(repository.completions, 1);
    assert.equal(repository.failures, 0);
    assert.equal(runner.calls, 1);
    assert.equal(repository.task.status, "DONE");
    assert.equal(repository.task.output_ref, "artifact/agent/live-monitor.json");
    assert.equal(repository.metrics.length, 1);
    assert.equal(result.metrics.metric.outcome, "COMPLETED");
    assert.equal(result.metrics.metric.queue_latency_ms, 60_000);
    assert.equal(result.metrics.metric.total_tokens, 1500);
    assert.equal(result.metrics.metric.cost_micros_usd, 4200);
  });

  it("passes a bounded conversation assignment to the runner and records the returned thread", async () => {
    const repository = new MemoryAgentRepository(taskFixture({ conversation_id: null }), {
      conversation: conversationFixture({ turn_count: 2 }),
    });
    const runner = new SpyRunner({
      output: {
        ok: true,
        output_ref: "artifact/agent/live-monitor.json",
        telemetry: { thread_id: "codex-thread-live-2" },
      },
    });
    const supervisor = new AgentRuntimeSupervisorService({
      repository,
      runner,
      workerId: "agent-runtime-live-01",
      lane: "live",
      mode: "active",
      conversationMaxTurns: 12,
      clock,
    });

    const result = await supervisor.runOnce();

    assert.equal(result.status, "COMPLETED");
    assert.equal(runner.lastInput.conversation.mode, "RESUMED");
    assert.equal(runner.lastInput.conversation.conversation.turn_count, 3);
    assert.equal(repository.conversation.external_conversation_ref, "codex-thread-live-2");
    assert.equal(result.conversation.external_conversation_ref, "codex-thread-live-2");
    assert.equal(repository.conversation.metadata.last_task_output_ref, "artifact/agent/live-monitor.json");
    assert.equal(repository.conversationOutcomes, 1);
  });

  it("resolves execution policy before invoking the runner", async () => {
    const repository = new MemoryAgentRepository(taskFixture({
      payload: { execution_policy: { reasoning_effort: "ultra", timeout_ms: 900_000 } },
    }), {
      missionModelPolicy: { model: "codex-mission", token_budget: 42_000 },
    });
    const runner = new SpyRunner({ output_ref: "artifact/agent/live-master.json" });
    const supervisor = new AgentRuntimeSupervisorService({
      repository,
      runner,
      workerId: "agent-runtime-live-01",
      lane: "live",
      mode: "active",
      executionDefaults: { model: "codex-default", reasoning_effort: "medium" },
      clock,
    });

    const result = await supervisor.runOnce();

    assert.equal(result.status, "COMPLETED");
    assert.equal(repository.executionPolicies, 1);
    assert.equal(runner.lastInput.execution_policy.model, "codex-mission");
    assert.equal(runner.lastInput.execution_policy.reasoning_effort, "ultra");
    assert.equal(runner.lastInput.execution_policy.timeout_ms, 900_000);
    assert.equal(runner.lastInput.execution_policy.token_budget, 42_000);
    assert.match(runner.lastInput.execution_policy_snapshot.policy_hash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(result.metrics.metric.model, "codex-mission");
    assert.equal(result.metrics.metric.reasoning_effort, "ultra");
    assert.match(result.metrics.metric.execution_policy_snapshot_id, /^[0-9a-f-]{36}$/);
  });

  it("persists AI Context Gate output before completing context decision tasks", async () => {
    const aiContextRepository = new InMemoryAiContextGateRepository();
    const repository = new MemoryAgentRepository(taskFixture({
      task_key: "task.live.context.2026-08-09.1015",
      task_type: "LIVE_CONTEXT_DECISION_MONITOR",
      payload: { signal_id: "signal-context-supervisor-1" },
    }));
    const runner = new SpyRunner({
      output: {
        ok: true,
        output_ref: {
          advisory: {
            signal_id: "signal-context-supervisor-1",
            recommendation: "REJECT",
            confidence: 0.81,
            risk_multiplier: 0,
            reason_codes: ["MACRO_RISK"],
            rationale: "Macro risk is too high for this deterministic signal.",
            model_ref: "codex/context-decision/xhigh",
            evidence_refs: [{ ref: "dataset:macro:2026-08-09T10:00Z" }],
            issued_at_utc: "2026-08-09T10:00:10.000Z",
          },
          policy: { mode: "SHADOW", policy_version: "context-supervisor-test-v1" },
          as_of_utc: "2026-08-09T10:00:10.000Z",
        },
      },
    });
    const supervisor = new AgentRuntimeSupervisorService({
      repository,
      runner,
      workerId: "agent-runtime-live-01",
      lane: "live",
      mode: "active",
      aiContextGateService: new AiContextGateService({ repository: aiContextRepository }),
      clock,
    });

    const result = await supervisor.runOnce();

    assert.equal(result.status, "COMPLETED");
    assert.equal(result.ai_context_gate.status, "SHADOW_RECORDED");
    assert.equal(aiContextRepository.decisions.size, 1);
    assert.equal([...aiContextRepository.decisions.values()][0].recommendation, "REJECT");
    assert.equal(repository.completions, 1);
    assert.equal(repository.failures, 0);
  });

  it("fails a claimed task through the repository when the runner rejects", async () => {
    const repository = new MemoryAgentRepository(taskFixture({ max_attempts: 2 }));
    const runner = new SpyRunner({ error: Object.assign(new Error("temporary outage"), { code: "MODEL_TIMEOUT", retryable: true }) });
    const supervisor = new AgentRuntimeSupervisorService({
      repository,
      runner,
      workerId: "agent-runtime-live-01",
      lane: "live",
      mode: "active",
      clock,
    });

    const result = await supervisor.runOnce();

    assert.equal(result.ok, false);
    assert.equal(result.status, "FAILED_RETRYABLE");
    assert.equal(repository.failures, 1);
    assert.equal(repository.task.status, "READY");
    assert.equal(repository.task.last_error.error_code, "MODEL_TIMEOUT");
    assert.equal(repository.metrics.length, 1);
    assert.equal(result.metrics.metric.outcome, "FAILED_RETRYABLE");
    assert.equal(result.metrics.metric.error_code, "MODEL_TIMEOUT");
  });

  it("exposes dead letter details when retries are exhausted", async () => {
    const repository = new MemoryAgentRepository(taskFixture({ max_attempts: 1 }));
    const runner = new SpyRunner({ error: Object.assign(new Error("bad contract"), { code: "CONTRACT_REJECTED", retryable: true }) });
    const supervisor = new AgentRuntimeSupervisorService({
      repository,
      runner,
      workerId: "agent-runtime-live-01",
      lane: "live",
      mode: "active",
      retryPolicy: { base_delay_seconds: 60, jitter_seconds: 0 },
      clock,
    });

    const result = await supervisor.runOnce();

    assert.equal(result.status, "FAILED_TERMINAL");
    assert.equal(repository.task.status, "ERROR");
    assert.equal(result.dead_letter.error_code, "CONTRACT_REJECTED");
    assert.equal(result.dead_letter.attempt_count, 1);
    assert.equal(repository.metrics.length, 1);
    assert.equal(result.metrics.metric.outcome, "DEAD_LETTERED");
    assert.equal(result.metrics.metric.dead_letter_id, "66666666-6666-4666-8666-666666666666");
  });

  it("defers before claim when the scheduler gate selects another lane", async () => {
    const repository = new MemoryAgentRepository(taskFixture({ lane: "replay" }));
    const runner = new SpyRunner();
    const supervisor = new AgentRuntimeSupervisorService({
      repository,
      runner,
      workerId: "agent-runtime-replay-01",
      lane: "replay",
      mode: "active",
      claimGate: new StaticClaimGate({ allowed: false, blocking_lanes: ["live"] }),
      clock,
    });

    const result = await supervisor.runOnce();

    assert.equal(result.status, "DEFERRED_BY_SCHEDULER");
    assert.equal(result.token_consumed, false);
    assert.equal(result.scheduler_gate.blocking_lanes[0], "live");
    assert.equal(repository.claims, 0);
    assert.equal(runner.calls, 0);
  });

  it("rejects an active supervisor when its worker pool does not match its lane", async () => {
    const repository = new MemoryAgentRepository(taskFixture());
    const runner = new SpyRunner();
    const supervisor = new AgentRuntimeSupervisorService({
      repository,
      runner,
      workerId: "agent-runtime-replay-01",
      workerPool: "replay",
      lane: "live",
      mode: "active",
      clock,
    });

    const result = await supervisor.runOnce();

    assert.equal(result.ok, false);
    assert.equal(result.status, "POOL_CONFIGURATION_REJECTED");
    assert.equal(result.pool_resolution.reason, "POOL_LANE_MISMATCH");
    assert.equal(result.token_consumed, false);
    assert.equal(repository.claims, 0);
    assert.equal(runner.calls, 0);
  });

  it("passes pool task type patterns to the repository claim", async () => {
    const repository = new MemoryAgentRepository(taskFixture());
    const runner = new SpyRunner({ output_ref: "artifact/agent/live-monitor.json" });
    const supervisor = new AgentRuntimeSupervisorService({
      repository,
      runner,
      workerId: "agent-runtime-live-01",
      workerPool: "live",
      lane: "live",
      mode: "active",
      clock,
    });

    const result = await supervisor.runOnce();

    assert.equal(result.status, "COMPLETED");
    assert.equal(result.worker_pool, "live");
    assert.deepEqual(repository.lastClaimArgs.taskTypePatterns, ["LIVE_*"]);
    assert.equal(runner.lastInput.worker_pool.pool_id, "live");
  });

  it("filters Postgres notifications by schema lane and ready status", () => {
    assert.equal(shouldWakeAgentRuntimeSupervisor(JSON.stringify({
      schema: "desk_agent_runtime_ready_v1",
      lane: "live",
      status: "READY",
    }), "live"), true);
    assert.equal(shouldWakeAgentRuntimeSupervisor({ payload: JSON.stringify({
      schema: "desk_agent_runtime_ready_v1",
      lane: "replay",
      status: "READY",
    }) }, "live"), false);
    assert.equal(shouldWakeAgentRuntimeSupervisor({ lane: "live", status: "DONE" }, "live"), false);
  });
});

class MemoryAgentRepository {
  constructor(task, { conversation = conversationFixture(), missionModelPolicy = {}, agentModelPolicy = {} } = {}) {
    this.task = task;
    this.conversation = conversation;
    this.missionModelPolicy = missionModelPolicy;
    this.agentModelPolicy = agentModelPolicy;
    this.claims = 0;
    this.completions = 0;
    this.failures = 0;
    this.conversationOutcomes = 0;
    this.executionPolicies = 0;
    this.metrics = [];
  }

  async claimNextTask(args) {
    const { workerId, leaseSeconds, nowUtc } = args;
    this.lastClaimArgs = args;
    this.claims += 1;
    if (!this.task || !["PENDING", "READY"].includes(this.task.status)) return null;
    const result = claimAgentTaskV1(this.task, {
      worker_id: workerId,
      lease_token: "lease-token-001",
      lease_seconds: leaseSeconds,
      now_utc: nowUtc,
    });
    if (!result.ok) throw new Error(result.reasons.join(","));
    this.task = result.task;
    return result;
  }

  async completeTask({ workerId, leaseToken, outputRef, nowUtc }) {
    this.completions += 1;
    const result = completeAgentTaskV1(this.task, {
      worker_id: workerId,
      lease_token: leaseToken,
      output_ref: outputRef,
      now_utc: nowUtc,
    });
    if (!result.ok) throw new Error(result.reasons.join(","));
    this.task = result.task;
    return result;
  }

  async failTask({ workerId, leaseToken, errorCode, errorMessage, retryable, retryPolicy, nowUtc }) {
    this.failures += 1;
    const result = failAgentTaskV1(this.task, {
      worker_id: workerId,
      lease_token: leaseToken,
      error_code: errorCode,
      error_message: errorMessage,
      retryable,
      retry_policy: retryPolicy,
      now_utc: nowUtc,
    });
    if (!result.ok) throw new Error(result.reasons.join(","));
    this.task = result.task;
    if (this.task.status === "ERROR") {
      return {
        ...result,
        dead_letter: {
          dead_letter_id: "66666666-6666-4666-8666-666666666666",
          task_id: this.task.task_id,
          error_code: this.task.last_error.error_code,
          attempt_count: this.task.attempt_count,
        },
      };
    }
    return result;
  }

  async resolveConversationForTask({ provider, maxTurns, nowUtc }) {
    const plan = planAgentConversationAssignmentV1({
      task: this.task,
      mission: missionFixture(),
      conversations: this.conversation ? [this.conversation] : [],
      policy: { provider, affinity_key: "live:2026-08-09", max_turns: maxTurns },
      now_utc: nowUtc,
    });
    this.conversation = plan.should_create_conversation
      ? { conversation_id: "55555555-5555-4555-8555-555555555555", ...plan.conversation_seed }
      : plan.conversation;
    this.task = { ...this.task, conversation_id: this.conversation.conversation_id };
    return { ...plan, conversation: this.conversation };
  }

  async recordConversationOutcome({ externalConversationRef, metadata, nowUtc }) {
    this.conversationOutcomes += 1;
    this.conversation = applyAgentConversationUseV1(this.conversation, {
      turn_count: this.conversation.turn_count,
      external_conversation_ref: externalConversationRef,
      metadata,
      now_utc: nowUtc,
    });
    return { conversation: this.conversation };
  }

  async resolveExecutionPolicyForTask({ defaults }) {
    this.executionPolicies += 1;
    const result = resolveAgentExecutionPolicyV1({
      defaults,
      agent: agentFixture({ model_policy: this.agentModelPolicy }),
      mission: missionFixture({ model_policy: this.missionModelPolicy }),
      task: this.task,
    });
    if (!result.ok) throw new Error(result.reasons.join(","));
    return {
      ...result,
      snapshot: {
        ...result.snapshot,
        policy_snapshot_id: "77777777-7777-4777-8777-777777777777",
      },
    };
  }

  async recordTaskRunMetrics(input) {
    this.metrics.push(input);
    return { metric: input };
  }
}

class SpyRunner {
  constructor({ output_ref = "artifact/result.json", output = null, error = null } = {}) {
    this.output_ref = output_ref;
    this.output = output;
    this.error = error;
    this.calls = 0;
    this.lastInput = null;
  }

  async run(input) {
    this.calls += 1;
    this.lastInput = input;
    if (this.error) throw this.error;
    if (this.output) return this.output;
    return { ok: true, output_ref: this.output_ref };
  }
}

class StaticClaimGate {
  constructor(gate) {
    this.gate = gate;
  }

  async evaluateLaneClaimGate(input) {
    return {
      ok: true,
      status: this.gate.allowed ? "ALLOWED" : "DEFERRED",
      lane: input.lane,
      allowed: this.gate.allowed,
      blocking_lanes: this.gate.blocking_lanes || [],
      plan_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
  }
}

function missionFixture(overrides = {}) {
  return {
    mission_id: "22222222-2222-4222-8222-222222222222",
    lane: "live",
    model_policy: {},
    ...overrides,
  };
}

function agentFixture(overrides = {}) {
  return {
    agent_id: "11111111-1111-4111-8111-111111111111",
    model_policy: {},
    ...overrides,
  };
}

function conversationFixture(overrides = {}) {
  return {
    conversation_id: "33333333-3333-4333-8333-333333333333",
    mission_id: "22222222-2222-4222-8222-222222222222",
    provider: "codex",
    external_conversation_ref: "codex-thread-live-1",
    status: "OPEN",
    affinity_key: "live:2026-08-09",
    turn_count: 3,
    last_used_at_utc: "2026-08-09T09:45:00.000Z",
    metadata: {},
    created_at_utc: "2026-08-09T09:00:00.000Z",
    ...overrides,
  };
}

function taskFixture(overrides = {}) {
  return {
    task_id: "44444444-4444-4444-8444-444444444444",
    mission_id: "22222222-2222-4222-8222-222222222222",
    conversation_id: "33333333-3333-4333-8333-333333333333",
    task_key: "task.live.2026-08-09.1015.monitor",
    task_type: "LIVE_M15_MONITOR",
    lane: "live",
    input_ref: "pack/live/2026-08-09/1015.json",
    status: "READY",
    payload: { checkpoint: "2026-08-09T10:15:00+02:00" },
    attempt_count: 0,
    max_attempts: 1,
    revision: 0,
    correlation_id: "corr-live-20260809-1015",
    metadata: {},
    created_at_utc: "2026-08-09T09:59:00.000Z",
    ...overrides,
  };
}
