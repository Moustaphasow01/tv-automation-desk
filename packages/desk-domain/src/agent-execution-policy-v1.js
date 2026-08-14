import { canonicalSha256 } from "./execution-scope.js";

export const AGENT_EXECUTION_POLICY_VERSION_V1 = "1.0.0";
export const AGENT_EXECUTION_POLICY_SCHEMA_VERSION_V1 = "agent_execution_policy_v1";
export const AGENT_EXECUTION_POLICY_SNAPSHOT_SCHEMA_VERSION_V1 = "agent_execution_policy_snapshot_v1";
export const AGENT_ROUTING_PROFILES_V1 = Object.freeze(["ANALYSIS_MASTER", "ANALYSIS_MONITOR", "CONTEXT_DECISION", "RESEARCH", "SIMULATION", "GENERIC_AGENT_TASK"]);
export const AGENT_EXECUTION_REASONING_EFFORTS_V1 = Object.freeze(["low", "medium", "high", "xhigh", "max", "ultra"]);
export const AGENT_EXECUTION_PROMPT_SOURCES_V1 = Object.freeze(["TASK_RENDER_SNAPSHOT", "MISSION_COMPOSITION", "UNBOUND"]);

const REASONING_SET = new Set(AGENT_EXECUTION_REASONING_EFFORTS_V1);

export function resolveAgentExecutionPolicyV1(input = {}) {
  const entity = object(input);
  const task = object(entity.task);
  const mission = object(entity.mission);
  const agent = object(entity.agent);
  const merged = mergePolicyLayers(
    object(entity.defaults),
    object(agent.model_policy),
    object(mission.model_policy),
    object(task.model_policy),
    object(task.payload?.execution_policy ?? task.payload?.executionPolicy),
    object(task.metadata?.execution_policy ?? task.metadata?.executionPolicy),
  );
  const policy = buildPolicy({ task, mission, agent, merged });
  const issues = validatePolicy(policy, merged);
  return {
    ok: issues.length === 0,
    reasons: issues,
    policy,
    snapshot: buildAgentExecutionPolicySnapshotV1({ policy }),
  };
}

export function buildAgentExecutionPolicySnapshotV1(input = {}) {
  const policy = object(input.policy);
  const snapshot = {
    schema_version: AGENT_EXECUTION_POLICY_SNAPSHOT_SCHEMA_VERSION_V1,
    policy_schema_version: policy.schema_version || AGENT_EXECUTION_POLICY_SCHEMA_VERSION_V1,
    policy_version: policy.policy_version || AGENT_EXECUTION_POLICY_VERSION_V1,
    task_id: text(policy.task_id),
    mission_id: text(policy.mission_id),
    agent_id: text(policy.agent_id),
    model: text(policy.model),
    reasoning_effort: text(policy.reasoning_effort),
    timeout_ms: integer(policy.timeout_ms, 780000),
    token_budget: integer(policy.token_budget, 0),
    prompt_source: text(policy.prompt_source),
    prompt_composition_id: text(policy.prompt_composition_id),
    prompt_render_snapshot_id: text(policy.prompt_render_snapshot_id),
    routing_profile: text(policy.routing_profile),
    created_at_utc: text(input.created_at_utc ?? policy.resolved_at_utc),
  };
  return {
    ...snapshot,
    policy_hash: agentExecutionPolicyHashV1(snapshot),
  };
}

export function agentExecutionPolicyHashV1(input = {}) {
  return `sha256:${canonicalSha256(input)}`;
}

function buildPolicy({ task, mission, agent, merged }) {
  const prompt = promptBinding(task, mission, merged);
  const ids = policyIds(task, mission, agent);
  const runtime = runtimeLimits(merged);
  return {
    schema_version: AGENT_EXECUTION_POLICY_SCHEMA_VERSION_V1,
    policy_version: AGENT_EXECUTION_POLICY_VERSION_V1,
    ...ids,
    lane: pickText(null, task.lane, mission.lane),
    task_type: pickText(null, task.task_type, task.type),
    routing_profile: routingProfile(task, mission, merged),
    model: pickText("codex", merged.model, merged.model_id, merged.modelId),
    ...runtime,
    prompt_source: prompt.source,
    prompt_composition_id: prompt.compositionId,
    prompt_render_snapshot_id: prompt.renderSnapshotId,
    source_layers: merged.__source_layers,
    metadata: object(merged.metadata),
  };
}

function policyIds(task, mission, agent) {
  return {
    task_id: pickText(null, task.task_id, task.agent_task_id),
    mission_id: pickText(null, task.mission_id, task.agent_mission_id, mission.mission_id, mission.agent_mission_id),
    agent_id: pickText(null, mission.agent_id, agent.agent_id),
  };
}

function runtimeLimits(merged) {
  return {
    reasoning_effort: reasoningEffort(firstDefined(merged.reasoning_effort, merged.reasoningEffort)),
    timeout_ms: boundedInteger(firstDefined(merged.timeout_ms, merged.timeoutMs), 780000, 5000, 1800000),
    token_budget: boundedInteger(firstDefined(merged.token_budget, merged.tokenBudget), 0, 0, 10000000),
    max_output_tokens: boundedInteger(firstDefined(merged.max_output_tokens, merged.maxOutputTokens), 0, 0, 10000000),
  };
}

function promptBinding(task, mission, merged) {
  const renderSnapshotId = pickText(null, task.prompt_render_snapshot_id, merged.prompt_render_snapshot_id, merged.promptRenderSnapshotId);
  const compositionId = pickText(null, mission.prompt_composition_id, merged.prompt_composition_id, merged.promptCompositionId);
  if (renderSnapshotId) return { source: "TASK_RENDER_SNAPSHOT", renderSnapshotId, compositionId };
  if (compositionId) return { source: "MISSION_COMPOSITION", renderSnapshotId: null, compositionId };
  return { source: "UNBOUND", renderSnapshotId: null, compositionId: null };
}

function routingProfile(task, mission, merged) {
  const explicit = String(firstDefined(merged.routing_profile, merged.routingProfile, task.routing_profile, task.routingProfile, mission.routing_profile, mission.routingProfile) || "").toUpperCase();
  if (AGENT_ROUTING_PROFILES_V1.includes(explicit)) return explicit;
  const type = [
    task.task_type,
    task.type,
    task.payload?.mission_key,
    task.payload?.prompt_definition_key,
    mission.mission_type,
    mission.type,
    mission.mission_key,
    mission.prompt_definition_key,
    merged.inference_profile,
    merged.inferenceProfile,
  ].filter(Boolean).join(" ").toUpperCase();
  if (type.includes("CONTEXT_DECISION") || type.includes("AI_CONTEXT")) return "CONTEXT_DECISION";
  if (type.includes("MASTER")) return "ANALYSIS_MASTER";
  if (type.includes("MONITOR")) return "ANALYSIS_MONITOR";
  if (type.includes("RESEARCH")) return "RESEARCH";
  if (type.includes("SIMULATION")) return "SIMULATION";
  return "GENERIC_AGENT_TASK";
}

function mergePolicyLayers(...layers) {
  const merged = { __source_layers: [] };
  layers.forEach((layer, index) => {
    if (!Object.keys(layer).length) return;
    Object.assign(merged, layer);
    merged.__source_layers.push(sourceName(index));
  });
  return merged;
}

function sourceName(index) {
  return ["defaults", "agent", "mission", "task", "task_payload", "task_metadata"][index] || `layer_${index}`;
}

function validatePolicy(policy, merged) {
  const issues = [];
  if (!policy.model) issues.push("AGENT_EXECUTION_MODEL_REQUIRED");
  if (!REASONING_SET.has(policy.reasoning_effort)) issues.push("AGENT_EXECUTION_REASONING_INVALID");
  if (policy.prompt_source === "UNBOUND" && merged.prompt_required === true) issues.push("AGENT_EXECUTION_PROMPT_BINDING_REQUIRED");
  if (String(policy.model).toLowerCase().includes("latest") && merged.allow_unpinned_model !== true) {
    issues.push("AGENT_EXECUTION_MODEL_MUST_BE_PINNED");
  }
  return issues;
}

function reasoningEffort(value) {
  const normalized = String(value || "xhigh").trim().toLowerCase();
  return REASONING_SET.has(normalized) ? normalized : "xhigh";
}

function boundedInteger(value, fallback, minimum, maximum) {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function integer(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function pickText(fallback, ...values) {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return fallback;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined) return value;
  }
  return undefined;
}
