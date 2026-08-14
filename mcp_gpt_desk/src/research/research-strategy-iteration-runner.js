import { createResearchExperimentRegistryService } from "../research-experiment-registry-service.js";
import {
  RESEARCH_STRATEGY_ITERATION_OUTPUT_SCHEMA_VERSION,
  RESEARCH_STRATEGY_ITERATION_RUNNER_SCHEMA_VERSION,
  RESEARCH_STRATEGY_ITERATION_TASK_TYPE,
  canonicalTaskId,
  coded,
  conversationFromRunnerInput,
  requiredText,
  semverBuildHash,
  text,
} from "./research-strategy-iteration-common.js";
import { loadResearchStrategyIterationContext } from "./research-strategy-iteration-context.js";
import { materializeResearchStrategyIterationVariant } from "./research-strategy-iteration-materializer.js";
import { buildResearchStrategyIterationPlan } from "./research-strategy-iteration-plan.js";

export {
  RESEARCH_STRATEGY_ITERATION_OUTPUT_SCHEMA_VERSION,
  RESEARCH_STRATEGY_ITERATION_RUNNER_SCHEMA_VERSION,
  RESEARCH_STRATEGY_ITERATION_TASK_TYPE,
  buildResearchStrategyIterationPlan,
};

export async function runResearchStrategyIterationTask({ store, runnerInput = {}, nowUtc } = {}) {
  assertStore(store);
  const task = requireSupportedTask(runnerInput.task);
  const resolvedNowUtc = resolveNowUtc({ store, task, nowUtc });
  const payload = task.payload || {};
  const registry = researchRegistry(store);
  const sourceCandidate = await registry.getCandidate(requiredText(payload.research_candidate_id, "research_candidate_id"));
  const context = await loadResearchStrategyIterationContext(store, payload);
  const plan = buildResearchStrategyIterationPlan({ task, payload, sourceCandidate, context, nowUtc: resolvedNowUtc });
  const created = [];
  for (const variant of plan.variants) {
    created.push(await materializeResearchStrategyIterationVariant({
      store,
      context,
      variant,
      sourceCandidate,
      task,
      nowUtc: resolvedNowUtc,
    }));
  }
  return buildIterationRunnerOutput({ plan, created, runnerInput });
}

function buildIterationRunnerOutput({ plan, created, runnerInput = {} }) {
  return {
    ok: true,
    status: created.length ? "ITERATION_CREATED" : "NO_VARIANT_CREATED",
    schema_version: RESEARCH_STRATEGY_ITERATION_OUTPUT_SCHEMA_VERSION,
    output_ref: researchIterationOutputRef(plan),
    source_research_candidate_id: plan.source_research_candidate_id,
    source_simulation_run_id: plan.source_simulation_run_id,
    dataset_id: plan.dataset_id,
    dataset_key: plan.dataset_key,
    iteration_index: plan.iteration_index,
    created_variant_count: created.length,
    variants: created,
    conversation: conversationFromRunnerInput(runnerInput),
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_micros_usd: 0 },
    telemetry: {
      runner: "research-strategy-iteration-deterministic",
      schema_version: RESEARCH_STRATEGY_ITERATION_RUNNER_SCHEMA_VERSION,
      token_consuming: false,
    },
  };
}

export function researchIterationOutputRef(plan = {}) {
  return `research-iteration://${requiredText(plan.dataset_key, "dataset_key")}/${requiredText(String(plan.iteration_index ?? ""), "iteration_index")}/${semverBuildHash({
    dataset_key: plan.dataset_key,
    iteration_index: plan.iteration_index,
    source_research_candidate_id: plan.source_research_candidate_id || null,
    source_simulation_run_id: plan.source_simulation_run_id || null,
    variants: Array.isArray(plan.variants) ? plan.variants.map((variant) => variant.variant_id || variant.research_candidate_id || variant.variant_label || "").filter(Boolean) : [],
  }, 12)}`;
}

function researchRegistry(store) {
  if (!store.researchRegistry) {
    store.researchRegistry = createResearchExperimentRegistryService({ persistence: store.persistence, clock: store.clock });
  }
  return store.researchRegistry;
}

function requireSupportedTask(task = {}) {
  if (!task || typeof task !== "object") throw coded("RESEARCH_AGENT_TASK_REQUIRED", "Agent task is required.", false);
  if (task.lane !== "research") throw coded("RESEARCH_AGENT_LANE_UNSUPPORTED", `Unsupported lane: ${task.lane}.`, false);
  if (task.task_type !== RESEARCH_STRATEGY_ITERATION_TASK_TYPE) {
    throw coded("RESEARCH_AGENT_TASK_TYPE_UNSUPPORTED", `Unsupported research task type: ${task.task_type}.`, false);
  }
  return { ...task, task_id: canonicalTaskId(task) };
}

function assertStore(store) {
  if (!store?.persistence?.pool) throw coded("RESEARCH_ITERATION_POSTGRES_REQUIRED", "PostgreSQL-backed store is required.", true);
  if (!store.strategyKernel) throw coded("RESEARCH_ITERATION_STRATEGY_KERNEL_REQUIRED", "Strategy Kernel service is required.", true);
  if (!store.simulationRuns) throw coded("RESEARCH_ITERATION_SIMULATION_REGISTRY_REQUIRED", "Simulation Run service is required.", true);
}

function resolveNowUtc({ store, task = {}, nowUtc } = {}) {
  return requiredText(nowUtc
    || store?.clock?.now?.()?.utc
    || task.created_at_utc
    || task.not_before_utc
    || task.updated_at_utc, "nowUtc");
}
