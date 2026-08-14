import { canonicalSha256 } from "./execution-scope.js";
import {
  buildResearchAgentMissionPolicyV1,
  resolveResearchAgentRoleV1,
} from "./research-agent-role-catalog-v1.js";
import {
  buildResearchScientificMissionV1,
  validateResearchHypothesisProtocolV1,
} from "./research-scientific-process-v1.js";
import {
  buildResearchCandidateGenomeV1,
  evaluateResearchCandidateNoveltyV1,
} from "./research-candidate-genome-v1.js";
import { matchResearchFailureMemoryV1 } from "./research-failure-memory-v1.js";
import { transitionResearchCandidateLifecycleV1 } from "./research-candidate-lifecycle-v1.js";

export const RESEARCH_STRATEGY_GENERATION_WORKFLOW_VERSION_V1 = "1.0.0";
export const RESEARCH_STRATEGY_GENERATION_POLICY_SCHEMA_VERSION_V1 = "research_strategy_generation_policy_v1";
export const RESEARCH_STRATEGY_GENERATION_PLAN_SCHEMA_VERSION_V1 = "research_strategy_generation_plan_v1";
export const RESEARCH_STRATEGY_GENERATION_WORK_ITEM_SCHEMA_VERSION_V1 = "research_strategy_generation_work_item_v1";

export const RESEARCH_STRATEGY_GENERATION_PHASES_V1 = Object.freeze([
  "INTAKE",
  "HYPOTHESIS_PROTOCOL",
  "ROLE_ASSIGNMENT",
  "CANDIDATE_DRAFT",
  "GENOME_NOVELTY",
  "FAILURE_MEMORY",
  "LIFECYCLE_START",
]);

export const RESEARCH_STRATEGY_GENERATION_DECISIONS_V1 = Object.freeze([
  "READY_FOR_BASELINE",
  "NEEDS_REVISION",
  "BLOCKED_DUPLICATE",
  "BLOCKED_FAILURE_MEMORY",
  "INVALID_IDEA",
]);

export function buildResearchStrategyGenerationPolicyV1(input = {}) {
  const policy = {
    schema_version: RESEARCH_STRATEGY_GENERATION_POLICY_SCHEMA_VERSION_V1,
    workflow_version: RESEARCH_STRATEGY_GENERATION_WORKFLOW_VERSION_V1,
    phases: [...RESEARCH_STRATEGY_GENERATION_PHASES_V1],
    required_roles: uniqueText(input.required_roles || ["research_planner", "strategy_builder", "research_reviewer"]),
    gates: {
      falsifiable_hypothesis_required: true,
      agent_roles_required: true,
      genome_required: true,
      novelty_gate_required: true,
      failure_memory_gate_required: true,
      lifecycle_transition_required: true,
    },
  };
  return { ...policy, policy_hash: stableHash(policy) };
}

export function planResearchStrategyGenerationWorkflowV1(input = {}) {
  const policy = buildResearchStrategyGenerationPolicyV1(input.policy || input);
  const protocol = validateResearchHypothesisProtocolV1(input.protocol || input.hypothesis || input.idea || {});
  const mission = buildResearchScientificMissionV1({ protocol: protocol.normalized, policy: input.scientific_policy, objective: input.objective });
  const candidate = buildCandidateDraft(input, protocol);
  const genome = buildResearchCandidateGenomeV1(candidate);
  const novelty = evaluateResearchCandidateNoveltyV1({
    candidate: genome,
    existing_genomes: input.existing_genomes,
    duplicate_threshold: input.duplicate_threshold,
    too_close_threshold: input.too_close_threshold,
  });
  const failureMemory = matchResearchFailureMemoryV1({ candidate: genome, failure_records: input.failure_records });
  const roles = policy.required_roles.map((role_id) => resolveResearchAgentRoleV1({ role_id }));
  const decision = generationDecision({ protocol, novelty, failureMemory });
  const lifecycle = decision === "READY_FOR_BASELINE" ? startLifecycle(candidate, input, protocol) : null;
  const plan = {
    schema_version: RESEARCH_STRATEGY_GENERATION_PLAN_SCHEMA_VERSION_V1,
    workflow_version: RESEARCH_STRATEGY_GENERATION_WORKFLOW_VERSION_V1,
    decision: lifecycle && !lifecycle.ok ? "NEEDS_REVISION" : decision,
    reasons: generationReasons({ protocol, novelty, failureMemory, lifecycle }),
    policy,
    scientific_mission: mission.mission,
    role_assignments: roles,
    candidate,
    genome,
    novelty,
    failure_memory: failureMemory,
    lifecycle_start: lifecycle,
  };
  return { ...plan, work_items: buildResearchStrategyGenerationWorkItemsV1(plan), plan_hash: stableHash(plan) };
}

export function buildResearchStrategyGenerationWorkItemsV1(input = {}) {
  const plan = input.schema_version === RESEARCH_STRATEGY_GENERATION_PLAN_SCHEMA_VERSION_V1 ? input : planResearchStrategyGenerationWorkflowV1(input);
  return plan.policy.required_roles.map((role_id, index) => {
    const missionPolicy = buildResearchAgentMissionPolicyV1({ role_id });
    const item = {
      schema_version: RESEARCH_STRATEGY_GENERATION_WORK_ITEM_SCHEMA_VERSION_V1,
      workflow_version: RESEARCH_STRATEGY_GENERATION_WORKFLOW_VERSION_V1,
      work_item_id: `research_generation:${plan.candidate.research_candidate_id}:${role_id}`,
      sequence: index + 1,
      role_id,
      mission_policy: missionPolicy.mission_policy,
      input_refs: {
        research_candidate_id: plan.candidate.research_candidate_id,
        genome_hash: plan.genome.genome_hash,
        protocol_hash: stableHash(plan.scientific_mission.hypothesis_protocol),
      },
      expected_output: expectedOutputForRole(role_id),
    };
    return { ...item, work_item_hash: stableHash(item) };
  });
}

export function researchStrategyGenerationWorkflowHashV1(input = {}) {
  return stableHash(input);
}

function buildCandidateDraft(input, protocol) {
  const source = object(input.candidate || input.idea || input);
  const candidate = {
    schema_version: "research_candidate_v1",
    research_candidate_id: valueText(source.research_candidate_id || source.id) || `candidate:${shortHash([source, protocol.normalized])}`,
    research_experiment_id: valueText(source.research_experiment_id || protocol.normalized.research_experiment_id),
    research_hypothesis_id: valueText(source.research_hypothesis_id || protocol.normalized.research_hypothesis_id),
    candidate_key: valueText(source.candidate_key) || slug(source.title || source.name || protocol.normalized.statement),
    source_type: "AI_GENERATED",
    status: "IDEA",
    primary_change_summary: valueText(source.primary_change_summary || source.summary || protocol.normalized.expected_outcome),
    metadata: {
      workflow_version: RESEARCH_STRATEGY_GENERATION_WORKFLOW_VERSION_V1,
      source_idea_hash: stableHash(source),
    },
    instruments: source.instruments,
    timeframes: source.timeframes,
    session_scope: source.session_scope,
    entry_logic: source.entry_logic,
    confirmation_signals: source.confirmation_signals,
    exit_logic: source.exit_logic,
    risk_model: source.risk_model,
  };
  return candidate;
}

function generationDecision({ protocol, novelty, failureMemory }) {
  if (!protocol.ok) return "INVALID_IDEA";
  if (novelty.decision === "DUPLICATE") return "BLOCKED_DUPLICATE";
  if (failureMemory.decision === "BLOCK_RETEST") return "BLOCKED_FAILURE_MEMORY";
  if (novelty.decision === "TOO_CLOSE" || failureMemory.decision === "REQUIRE_REVISION") return "NEEDS_REVISION";
  return "READY_FOR_BASELINE";
}

function generationReasons({ protocol, novelty, failureMemory, lifecycle }) {
  const reasons = [];
  if (!protocol.ok) reasons.push(...protocol.reasons);
  if (novelty.decision !== "NOVEL") reasons.push(`NOVELTY_${novelty.decision}`);
  if (failureMemory.decision !== "NO_MATCH") reasons.push(`FAILURE_MEMORY_${failureMemory.decision}`);
  if (lifecycle && !lifecycle.ok) reasons.push(...lifecycle.reasons);
  return reasons.length ? reasons : ["READY_FOR_BASELINE"];
}

function startLifecycle(candidate, input, protocol) {
  return transitionResearchCandidateLifecycleV1(candidate, {
    command: "START_BASELINE",
    actor_ref: valueText(input.actor_ref || input.operator_ref) || "research_strategy_generation_workflow_v1",
    idempotency_key: valueText(input.idempotency_key) || `strategy-generation:${shortHash([candidate.research_candidate_id, protocol.normalized])}`,
    evidence_refs: ["FALSIFIABLE_HYPOTHESIS", "DATASET_SCOPE"],
    transitioned_at_utc: valueText(input.created_at_utc),
  });
}

function expectedOutputForRole(roleId) {
  const outputs = {
    research_planner: ["hypothesis_protocol_review", "dataset_scope_review", "budget_review"],
    strategy_builder: ["candidate_dsl_draft", "deterministic_plan_outline", "risk_model_outline"],
    research_reviewer: ["novelty_review", "failure_memory_review", "promotion_blockers"],
  };
  return outputs[roleId] || ["research_note"];
}

function uniqueText(value) {
  return [...new Set(list(value).map(valueText).filter(Boolean))].sort();
}

function list(value) {
  if (Array.isArray(value)) return value;
  return value === null || value === undefined || value === "" ? [] : [value];
}

function slug(value) {
  return (valueText(value) || "research-candidate").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/(^\\.|\\.$)/g, "").slice(0, 80);
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stableHash(value) {
  return `sha256:${canonicalSha256(value)}`;
}

function valueText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function shortHash(value) {
  return canonicalSha256(value).slice(0, 16);
}
