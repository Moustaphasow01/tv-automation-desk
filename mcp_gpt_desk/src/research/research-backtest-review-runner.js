import { canonicalSha256 } from "@tv-automation/desk-domain";
import { createResearchExperimentRegistryService } from "../research-experiment-registry-service.js";
import {
  enqueueResearchAgentTask,
  stableResearchTaskIds,
} from "./research-agent-task-queue.js";
import {
  RESEARCH_STRATEGY_ITERATION_GENERATOR_VERSION,
  RESEARCH_STRATEGY_ITERATION_TASK_TYPE,
} from "./research-strategy-iteration-common.js";

export const RESEARCH_BACKTEST_REVIEW_RUNNER_SCHEMA_VERSION = "research_backtest_review_runner_v1";
export const RESEARCH_BACKTEST_REVIEW_OUTPUT_SCHEMA_VERSION = "research_agent_backtest_review_output_v1";
export const RESEARCH_BACKTEST_REVIEW_TASK_TYPE = "RESEARCH_BACKTEST_REVIEW";
export const RESEARCH_ROBUSTNESS_REVIEW_TASK_TYPE = "RESEARCH_ROBUSTNESS_REVIEW";
const CURRENT_GENERATOR_ROBUSTNESS_PRIORITY = 32;

export async function runResearchBacktestReviewTask({ store, runnerInput = {}, nowUtc } = {}) {
  const task = requireSupportedTask(runnerInput.task);
  const resolvedNowUtc = resolveNowUtc({ store, task, nowUtc });
  const payload = task.payload || {};
  const superseded = supersededGeneratorReview(payload);
  if (superseded) {
    return buildSupersededReviewRunnerOutput({ task, payload, runnerInput, superseded, nowUtc: resolvedNowUtc });
  }
  const registry = resolveResearchRegistry(store);
  const candidate = await registry.getCandidate(requireText(payload.research_candidate_id, "research_candidate_id"));
  const review = buildResearchBacktestReview({
    task,
    payload,
    candidate,
    actor: runnerActor(runnerInput),
    nowUtc: resolvedNowUtc,
  });
  const saved = await recordEvaluationReportOrReuseExisting({ registry, review });
  const nextTask = await enqueueNextResearchTaskIfRequired({ store, review, saved, runnerInput, nowUtc: resolvedNowUtc });
  return buildResearchBacktestReviewRunnerOutput({ review, saved, runnerInput, nextTask });
}

function buildSupersededReviewRunnerOutput({ task, payload, runnerInput = {}, superseded, nowUtc }) {
  const taskId = canonicalTaskId(task);
  return {
    ok: true,
    status: "SUPERSEDED_GENERATOR_REVIEW",
    schema_version: RESEARCH_BACKTEST_REVIEW_OUTPUT_SCHEMA_VERSION,
    output_ref: `research-backtest-review-superseded://${taskId}`,
    research_evaluation_report_id: null,
    research_candidate_id: payload.research_candidate_id || null,
    simulation_run_id: payload.simulation_run_id || null,
    verdict: "SUPERSEDED",
    score: 0,
    reasons: ["GENERATOR_VERSION_SUPERSEDED"],
    next_recommended_task_type: null,
    enqueued_next_task: null,
    conversation: conversationFromRunnerInput(runnerInput),
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      cost_micros_usd: 0,
    },
    telemetry: {
      runner: "research-backtest-review-deterministic",
      schema_version: RESEARCH_BACKTEST_REVIEW_RUNNER_SCHEMA_VERSION,
      token_consuming: false,
      superseded,
      checked_at_utc: nowUtc,
    },
  };
}

async function recordEvaluationReportOrReuseExisting({ registry, review }) {
  try {
    return await registry.recordEvaluationReport(review.report, review.command);
  } catch (error) {
    if (error?.code !== "RESEARCH_AGGREGATE_CONFLICT") throw error;
    const existing = await findExistingBacktestReviewReport({ registry, report: review.report });
    if (!existing) throw error;
    return {
      status: "IDEMPOTENT_EXISTING_BUSINESS_KEY",
      report: existing,
      entity: existing,
      reused_existing: true,
    };
  }
}

async function findExistingBacktestReviewReport({ registry, report }) {
  if (!registry?.listEvaluationReports) return null;
  const reports = await registry.listEvaluationReports({
    researchCandidateId: report.research_candidate_id,
    research_candidate_id: report.research_candidate_id,
    reportKind: report.report_kind,
    report_kind: report.report_kind,
    limit: 500,
  });
  return (reports || []).find((candidate) =>
    candidate?.research_candidate_id === report.research_candidate_id
    && candidate?.report_kind === report.report_kind
    && candidate?.simulation_run_id === report.simulation_run_id) || null;
}

export function buildResearchBacktestReview({ task = {}, payload = {}, candidate = {}, actor = "agent-runtime-research", nowUtc } = {}) {
  const metrics = payload.metrics || {};
  const assessment = assessBacktestMetrics(metrics);
  const taskId = canonicalTaskId(task);
  const reportId = stableBacktestReviewReportId({ payload });
  const resolvedNowUtc = resolveNowUtc({ task, nowUtc });
  const report = {
    research_evaluation_report_id: reportId,
    research_experiment_id: requireText(candidate.research_experiment_id, "research_experiment_id"),
    research_candidate_id: requireText(payload.research_candidate_id, "research_candidate_id"),
    simulation_run_id: requireText(payload.simulation_run_id, "simulation_run_id"),
    report_kind: "CONTRADICTORY_REVIEW",
    verdict: assessment.verdict,
    score: assessment.score,
    metric_snapshot: metrics,
    criteria_snapshot: {
      schema_version: RESEARCH_BACKTEST_REVIEW_RUNNER_SCHEMA_VERSION,
      min_trade_count: 2,
      min_total_r: 0,
      max_drawdown_floor_r: -8,
      required_decision: payload.required_decision || "REVIEW_OR_ITERATE",
      decision: assessment.decision,
      reasons: assessment.reasons,
      next_recommended_task_type: assessment.next_task_type,
    },
    artifact_refs: artifactRefs(task, payload),
    reviewer_ref: actor,
    metadata: {
      schema_version: RESEARCH_BACKTEST_REVIEW_RUNNER_SCHEMA_VERSION,
      task_id: taskId,
      task_key: task.task_key,
      lane: task.lane,
      strategy_version_id: payload.strategy_version_id || candidate.strategy_version_id || null,
      dataset_id: payload.dataset_id || null,
      dataset_key: payload.dataset_key || null,
    },
    created_at_utc: stableReportTime(task, resolvedNowUtc),
  };
  return {
    report,
    command: {
      idempotency_key: `idem_research_backtest_review_${reportId}`,
      correlation_id: task.correlation_id || `corr_research_backtest_review_${reportId}`,
      actor,
      reason: `Agent runtime review: ${assessment.decision}`,
      run_link_id: reportId,
    },
    assessment,
  };
}

export function assessBacktestMetrics(metrics = {}) {
  const tradeCount = integer(metrics.trade_count);
  const totalR = number(metrics.total_r);
  const maxDrawdownR = number(metrics.max_drawdown_r);
  const reasons = [];
  if (tradeCount < 2) reasons.push("INSUFFICIENT_TRADE_SAMPLE");
  if (totalR <= 0) reasons.push("NON_POSITIVE_TOTAL_R");
  if (maxDrawdownR < -8) reasons.push("DRAWDOWN_BELOW_RESEARCH_FLOOR");
  if (reasons.length) {
    return {
      verdict: tradeCount < 2 ? "NEEDS_REVIEW" : "FAIL",
      score: scoreForRejectedBacktest({ tradeCount, totalR, maxDrawdownR }),
      decision: "ITERATE_REQUIRED",
      reasons,
      next_task_type: "RESEARCH_STRATEGY_ITERATION",
    };
  }
  return {
    verdict: "PASS",
    score: scoreForPassingBacktest({ totalR, maxDrawdownR }),
    decision: "READY_FOR_ROBUSTNESS_REVIEW",
    reasons: ["BASELINE_BACKTEST_ACCEPTABLE"],
    next_task_type: "RESEARCH_ROBUSTNESS_REVIEW",
  };
}

export function buildResearchBacktestReviewRunnerOutput({ review, saved, runnerInput = {}, nextTask = null } = {}) {
  const report = saved?.report || review.report;
  return {
    ok: true,
    status: review.assessment.decision,
    schema_version: RESEARCH_BACKTEST_REVIEW_OUTPUT_SCHEMA_VERSION,
    output_ref: `research-evaluation-report://${report.research_evaluation_report_id}`,
    research_evaluation_report_id: report.research_evaluation_report_id,
    research_candidate_id: report.research_candidate_id,
    simulation_run_id: report.simulation_run_id,
    verdict: report.verdict,
    score: Number(report.score),
    reasons: review.assessment.reasons,
    next_recommended_task_type: review.assessment.next_task_type,
    enqueued_next_task: nextTask,
    conversation: conversationFromRunnerInput(runnerInput),
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      cost_micros_usd: 0,
    },
    telemetry: {
      runner: "research-backtest-review-deterministic",
      schema_version: RESEARCH_BACKTEST_REVIEW_RUNNER_SCHEMA_VERSION,
      token_consuming: false,
    },
  };
}

export async function enqueueNextResearchTaskIfRequired({ store, review, saved, runnerInput = {}, nowUtc } = {}) {
  const resolvedNowUtc = resolveNowUtc({ store, task: runnerInput.task, nowUtc });
  if (review?.assessment?.decision === "READY_FOR_ROBUSTNESS_REVIEW") {
    return enqueueRobustnessReviewTaskIfRequired({ store, review, saved, runnerInput, nowUtc: resolvedNowUtc });
  }
  return enqueueIterationTaskIfRequired({ store, review, saved, runnerInput, nowUtc: resolvedNowUtc });
}

export async function enqueueIterationTaskIfRequired({ store, review, saved, runnerInput = {}, nowUtc } = {}) {
  if (review?.assessment?.decision !== "ITERATE_REQUIRED") return null;
  if (!store?.persistence?.pool) return null;
  const resolvedNowUtc = resolveNowUtc({ store, task: runnerInput.task, nowUtc });
  const payload = runnerInput.task?.payload || {};
  const limit = iterationLimit(payload);
  if (limit.next_iteration_index > limit.max_iterations) {
    return {
      status: "SKIPPED_MAX_ITERATIONS",
      next_iteration_index: limit.next_iteration_index,
      max_iterations: limit.max_iterations,
    };
  }
  return enqueueResearchAgentTask(store.persistence.pool, iterationTaskInput({
    report: saved?.report || review.report,
    payload,
    runnerInput,
    nowUtc: resolvedNowUtc,
    limit,
  }));
}

export async function enqueueRobustnessReviewTaskIfRequired({ store, review, saved, runnerInput = {}, nowUtc } = {}) {
  if (review?.assessment?.decision !== "READY_FOR_ROBUSTNESS_REVIEW") return null;
  if (!store?.persistence?.pool) return null;
  const resolvedNowUtc = resolveNowUtc({ store, task: runnerInput.task, nowUtc });
  const report = saved?.report || review.report;
  const payload = runnerInput.task?.payload || {};
  return enqueueResearchAgentTask(store.persistence.pool, robustnessReviewTaskInput({
    report,
    payload,
    runnerInput,
    nowUtc: resolvedNowUtc,
  }));
}

function requireSupportedTask(task = {}) {
  if (!task || typeof task !== "object") throw coded("RESEARCH_AGENT_TASK_REQUIRED", "Agent task is required.", false);
  if (task.lane !== "research") throw coded("RESEARCH_AGENT_LANE_UNSUPPORTED", `Unsupported lane: ${task.lane}.`, false);
  if (task.task_type !== RESEARCH_BACKTEST_REVIEW_TASK_TYPE) {
    throw coded("RESEARCH_AGENT_TASK_TYPE_UNSUPPORTED", `Unsupported research task type: ${task.task_type}.`, false);
  }
  return { ...task, task_id: canonicalTaskId(task) };
}

function resolveResearchRegistry(store) {
  if (store?.researchRegistry) return store.researchRegistry;
  if (!store?.persistence) throw coded("RESEARCH_REGISTRY_STORE_REQUIRED", "Research registry store is required.", true);
  return createResearchExperimentRegistryService({ persistence: store.persistence, clock: store.clock });
}

function artifactRefs(task, payload) {
  return [
    payload.simulation_run_id ? `simulation-run://${payload.simulation_run_id}` : null,
    payload.dataset_id ? `dataset://${payload.dataset_id}` : null,
    payload.strategy_version_id ? `strategy-version://${payload.strategy_version_id}` : null,
    task.input_ref || null,
  ].filter(Boolean);
}

function stableReportTime(task, nowUtc) {
  return task.created_at_utc || task.not_before_utc || nowUtc;
}

function resolveNowUtc({ store, task = {}, nowUtc } = {}) {
  return requireText(nowUtc
    || store?.clock?.now?.()?.utc
    || task.created_at_utc
    || task.not_before_utc
    || task.updated_at_utc, "nowUtc");
}

function canonicalTaskId(task = {}) {
  return requireText(task.task_id || task.agent_task_id, "task_id");
}

function stableBacktestReviewReportId({ payload = {} } = {}) {
  return stableUuid({
    kind: "research_backtest_review",
    research_candidate_id: requireText(payload.research_candidate_id, "research_candidate_id"),
    simulation_run_id: requireText(payload.simulation_run_id, "simulation_run_id"),
    report_kind: "CONTRADICTORY_REVIEW",
  });
}

function runnerActor(runnerInput) {
  return runnerInput?.lease?.worker_id || runnerInput?.task?.assigned_worker_id || "agent-runtime-research-review";
}

function conversationFromRunnerInput(runnerInput = {}) {
  const conversation = runnerInput.conversation?.conversation;
  if (!conversation) return null;
  return {
    conversation_id: conversation.conversation_id,
    external_conversation_ref: conversation.external_conversation_ref || null,
    thread_id: conversation.external_conversation_ref || null,
  };
}

function scoreForRejectedBacktest({ tradeCount, totalR, maxDrawdownR }) {
  const activity = Math.min(0.25, Math.max(0, tradeCount) * 0.08);
  const pnl = Math.max(0, Math.min(0.2, (totalR + 4) / 40));
  const drawdown = Math.max(0, Math.min(0.15, (8 + maxDrawdownR) / 80));
  return round4(0.2 + activity + pnl + drawdown);
}

function scoreForPassingBacktest({ totalR, maxDrawdownR }) {
  const pnl = Math.min(0.2, Math.max(0, totalR) / 50);
  const drawdown = Math.max(0, Math.min(0.15, (8 + maxDrawdownR) / 80));
  return round4(Math.min(0.95, 0.7 + pnl + drawdown));
}

function iterationTaskInput({ report, payload, runnerInput, nowUtc, limit }) {
  const taskKey = `research-iterate-${report.research_candidate_id}-${report.simulation_run_id}-iter-${limit.next_iteration_index}`;
  const ids = stableResearchTaskIds({ key: taskKey, kind: RESEARCH_STRATEGY_ITERATION_TASK_TYPE });
  return {
    mission: {
      agent_mission_id: ids.missionId,
      mission_key: `research-iteration-${report.research_candidate_id}-iter-${limit.next_iteration_index}`,
      mission_type: "RESEARCH_STRATEGY_ITERATION",
      lane: "research",
      objective: "Générer et backtester des variantes déterministes après une review non concluante.",
      context_ref: `research://${report.research_experiment_id}`,
      correlation_id: runnerInput.task?.correlation_id || `corr_research_iteration_${report.research_candidate_id}`,
      priority: 35,
      model_policy: { model: "codex", reasoning_effort: "xhigh", routing_profile: "research-iteration" },
      metadata: {
        source: RESEARCH_BACKTEST_REVIEW_RUNNER_SCHEMA_VERSION,
        report_id: report.research_evaluation_report_id,
      },
      created_at_utc: nowUtc,
    },
    task: {
      agent_task_id: ids.taskId,
      task_key: taskKey,
      task_type: RESEARCH_STRATEGY_ITERATION_TASK_TYPE,
      lane: "research",
      input_ref: `research-evaluation-report://${report.research_evaluation_report_id}`,
      priority: 35,
      payload: iterationPayload({ report, payload, limit }),
      idempotency_key: `idem_research_iteration_${ids.taskId}`,
      max_attempts: 2,
      not_before_utc: nowUtc,
      correlation_id: runnerInput.task?.correlation_id || `corr_research_iteration_${report.research_candidate_id}`,
      metadata: {
        source: RESEARCH_BACKTEST_REVIEW_RUNNER_SCHEMA_VERSION,
        parent_task_id: runnerInput.task?.task_id || runnerInput.task?.agent_task_id || null,
      },
      created_at_utc: nowUtc,
    },
  };
}

function iterationPayload({ report, payload, limit }) {
  return {
    dataset_id: report.metadata?.dataset_id || payload.dataset_id || null,
    dataset_key: report.metadata?.dataset_key || payload.dataset_key || null,
    strategy_version_id: report.metadata?.strategy_version_id || payload.strategy_version_id || null,
    simulation_run_id: report.simulation_run_id,
    research_candidate_id: report.research_candidate_id,
    parent_iteration_index: limit.current_iteration_index,
    iteration_index: limit.next_iteration_index,
    max_iterations: limit.max_iterations,
    max_variants: boundedInteger(payload.max_variants ?? payload.maxVariants, 4, 1, 5),
    required_decision: "GENERATE_VARIANTS_AND_BACKTEST",
    metrics: report.metric_snapshot || payload.metrics || {},
    review_reasons: report.criteria_snapshot?.reasons || [],
  };
}

function robustnessReviewTaskInput({ report, payload, runnerInput, nowUtc }) {
  const taskKey = `research-robustness-${report.research_candidate_id}-${report.simulation_run_id}`;
  const ids = stableResearchTaskIds({ key: taskKey, kind: RESEARCH_ROBUSTNESS_REVIEW_TASK_TYPE });
  return {
    mission: {
      agent_mission_id: ids.missionId,
      mission_key: `research-robustness-${report.research_candidate_id}`,
      mission_type: "RESEARCH_ROBUSTNESS_VALIDATION",
      lane: "research",
      objective: "Valider la robustesse, le proxy OOS et les stress déterministes avant toute promotion opérateur.",
      context_ref: `research://${report.research_experiment_id}`,
      correlation_id: runnerInput.task?.correlation_id || `corr_research_robustness_${report.research_candidate_id}`,
      priority: CURRENT_GENERATOR_ROBUSTNESS_PRIORITY,
      model_policy: { model: "codex", reasoning_effort: "xhigh", routing_profile: "research-robustness" },
      metadata: {
        source: RESEARCH_BACKTEST_REVIEW_RUNNER_SCHEMA_VERSION,
        report_id: report.research_evaluation_report_id,
      },
      created_at_utc: nowUtc,
    },
    task: {
      agent_task_id: ids.taskId,
      task_key: taskKey,
      task_type: RESEARCH_ROBUSTNESS_REVIEW_TASK_TYPE,
      lane: "research",
      input_ref: `research-evaluation-report://${report.research_evaluation_report_id}`,
      priority: CURRENT_GENERATOR_ROBUSTNESS_PRIORITY,
      payload: robustnessPayload({ report, payload }),
      idempotency_key: `idem_research_robustness_${ids.taskId}`,
      max_attempts: 2,
      not_before_utc: nowUtc,
      correlation_id: runnerInput.task?.correlation_id || `corr_research_robustness_${report.research_candidate_id}`,
      metadata: {
        source: RESEARCH_BACKTEST_REVIEW_RUNNER_SCHEMA_VERSION,
        parent_task_id: runnerInput.task?.task_id || runnerInput.task?.agent_task_id || null,
      },
      created_at_utc: nowUtc,
    },
  };
}

function robustnessPayload({ report, payload }) {
  return {
    dataset_id: report.metadata?.dataset_id || payload.dataset_id || null,
    dataset_key: report.metadata?.dataset_key || payload.dataset_key || null,
    generator_version: payload.generator_version || null,
    generator_slug: payload.generator_slug || null,
    strategy_version_id: report.metadata?.strategy_version_id || payload.strategy_version_id || null,
    simulation_run_id: report.simulation_run_id,
    research_candidate_id: report.research_candidate_id,
    contradictory_review_report_id: report.research_evaluation_report_id,
    required_decision: "RUN_ROBUSTNESS_AND_OOS_GATES",
    iteration_index: boundedInteger(payload.iteration_index ?? payload.parent_iteration_index, 0, 0, 20),
    metrics: report.metric_snapshot || payload.metrics || {},
  };
}

function iterationLimit(payload = {}) {
  const current = boundedInteger(payload.iteration_index ?? payload.parent_iteration_index, 0, 0, 20);
  return {
    current_iteration_index: current,
    next_iteration_index: current + 1,
    max_iterations: boundedInteger(payload.max_iterations ?? payload.maxIterations, 3, 1, 20),
  };
}

function supersededGeneratorReview(payload = {}) {
  const iterationIndex = integer(payload.iteration_index ?? payload.parent_iteration_index);
  if (iterationIndex <= 0) return null;
  const generatorVersion = typeof payload.generator_version === "string" ? payload.generator_version.trim() : "";
  if (generatorVersion === RESEARCH_STRATEGY_ITERATION_GENERATOR_VERSION) return null;
  return {
    iteration_index: iterationIndex,
    payload_generator_version: generatorVersion || null,
    current_generator_version: RESEARCH_STRATEGY_ITERATION_GENERATOR_VERSION,
  };
}

function stableUuid(value) {
  const hash = canonicalSha256(value).replace(/^sha256:/, "").padEnd(32, "0");
  const variant = ((Number.parseInt(hash[16] || "8", 16) & 0x3) | 0x8).toString(16);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function requireText(value, field) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw coded("RESEARCH_BACKTEST_REVIEW_FIELD_REQUIRED", `${field} is required.`, false);
  return normalized;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integer(value) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function boundedInteger(value, fallback, min = 0, max = 1_000) {
  const parsed = Math.trunc(Number(value));
  const selected = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(selected, max));
}

function round4(value) {
  return Math.round(Number(value) * 10_000) / 10_000;
}

function coded(code, message, retryable) {
  return Object.assign(new Error(message || code), { code, retryable });
}
