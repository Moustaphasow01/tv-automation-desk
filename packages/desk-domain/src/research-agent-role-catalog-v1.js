import { canonicalSha256 } from "./execution-scope.js";

export const RESEARCH_AGENT_ROLE_CATALOG_VERSION_V1 = "1.0.0";
export const RESEARCH_AGENT_ROLE_CATALOG_SCHEMA_VERSION_V1 = "research_agent_role_catalog_v1";
export const RESEARCH_AGENT_ROLE_RESOLUTION_SCHEMA_VERSION_V1 = "research_agent_role_resolution_v1";
export const RESEARCH_AGENT_ROLE_CAPABILITY_DECISION_SCHEMA_VERSION_V1 = "research_agent_role_capability_decision_v1";

export const RESEARCH_INFERENCE_PROFILES_V1 = Object.freeze([
  "STANDARD_RESEARCH",
  "DEEP_STRATEGY_REVIEW",
  "SAFETY_REVIEW",
  "CONTEXT_DECISION",
]);

export const RESEARCH_AGENT_ROLE_IDS_V1 = Object.freeze([
  "research_planner",
  "pattern_miner",
  "strategy_builder",
  "experiment_agent",
  "backtest_validator",
  "robustness_auditor",
  "regime_analyst",
  "research_reviewer",
  "live_performance_monitor",
]);

export const RESEARCH_PROHIBITED_CAPABILITIES_V1 = Object.freeze([
  "BROKER_ORDER_SUBMIT",
  "BROKER_ORDER_CANCEL",
  "BROKER_POSITION_MANAGE",
  "ORDER_INTENT_CREATE",
  "EXECUTION_PROVIDER_WRITE",
]);

const PROFILE_POLICIES = Object.freeze({
  STANDARD_RESEARCH: Object.freeze({ model: "codex", reasoning_effort: "xhigh", timeout_ms: 600000, token_budget: 80000, prompt_required: true }),
  DEEP_STRATEGY_REVIEW: Object.freeze({ model: "codex", reasoning_effort: "ultra", timeout_ms: 1200000, token_budget: 180000, prompt_required: true }),
  SAFETY_REVIEW: Object.freeze({ model: "codex", reasoning_effort: "max", timeout_ms: 900000, token_budget: 100000, prompt_required: true }),
  CONTEXT_DECISION: Object.freeze({ model: "codex", reasoning_effort: "xhigh", timeout_ms: 600000, token_budget: 80000, prompt_required: true }),
});

const ROLE_CATALOG = Object.freeze({
  research_planner: role("research_planner", 10, "Research Planner", "Priorise les questions de recherche, la couverture et les budgets.", "STANDARD_RESEARCH", "research", ["READ_RESEARCH_REGISTRY", "WRITE_RESEARCH_REGISTRY", "READ_KNOWLEDGE_GRAPH", "PLAN_RESEARCH_MISSION"]),
  pattern_miner: role("pattern_miner", 20, "Pattern Miner", "Explore les relations statistiques et propose des hypothèses falsifiables.", "STANDARD_RESEARCH", "research", ["READ_DATASETS", "READ_FEATURE_CATALOG", "COMPUTE_PYTHON", "WRITE_RESEARCH_HYPOTHESIS"]),
  strategy_builder: role("strategy_builder", 30, "Strategy Builder", "Transforme une hypothèse supportée en spécification de stratégie candidate.", "DEEP_STRATEGY_REVIEW", "research", ["READ_RESEARCH_REGISTRY", "READ_STRATEGY_REGISTRY", "DRAFT_STRATEGY_VERSION", "WRITE_RESEARCH_CANDIDATE"]),
  experiment_agent: role("experiment_agent", 40, "Experiment Agent", "Prépare les batches, itérations contrôlées et liens vers SimulationRun.", "STANDARD_RESEARCH", "research", ["READ_RESEARCH_REGISTRY", "REQUEST_SIMULATION_RUN", "LINK_SIMULATION_RUN", "WRITE_RESEARCH_EVALUATION"]),
  backtest_validator: role("backtest_validator", 50, "Backtest Validator", "Vérifie cohérence, seuils, datasets et absence de fuite temporelle.", "SAFETY_REVIEW", "validation", ["READ_SIMULATION_RUNS", "READ_DATASET_SPLITS", "WRITE_RESEARCH_EVALUATION", "VERIFY_NO_LOOKAHEAD"]),
  robustness_auditor: role("robustness_auditor", 60, "Robustness Auditor", "Tente de réfuter la candidate par stress, slippage, Monte-Carlo et régimes.", "DEEP_STRATEGY_REVIEW", "validation", ["READ_SIMULATION_RUNS", "READ_ROBUSTNESS_REPORTS", "COMPUTE_PYTHON", "WRITE_RESEARCH_EVALUATION"]),
  regime_analyst: role("regime_analyst", 70, "Regime Analyst", "Segmente volatilité, tendance, macro et contextes cross-asset.", "STANDARD_RESEARCH", "research", ["READ_DATASETS", "READ_FEATURE_CATALOG", "COMPUTE_PYTHON", "WRITE_RESEARCH_HYPOTHESIS"]),
  research_reviewer: role("research_reviewer", 80, "Research Reviewer", "Produit la revue contradictoire et recommande promotion, révision ou rejet.", "SAFETY_REVIEW", "validation", ["READ_RESEARCH_REGISTRY", "READ_EVALUATION_REPORTS", "WRITE_RESEARCH_REVIEW", "REQUEST_OPERATOR_APPROVAL"]),
  live_performance_monitor: role("live_performance_monitor", 90, "Live Performance Monitor", "Compare performance live et historique pour détecter la dérive.", "CONTEXT_DECISION", "research", ["READ_LIVE_PERFORMANCE", "READ_SIMULATION_RUNS", "WRITE_RESEARCH_EVALUATION", "REQUEST_REVIEW"]),
});

export function listResearchAgentRolesV1(input = {}) {
  const roles = Object.values(ROLE_CATALOG).filter((item) => matchesPool(item, input.worker_pool_id || input.pool_id));
  const catalog = {
    schema_version: RESEARCH_AGENT_ROLE_CATALOG_SCHEMA_VERSION_V1,
    catalog_version: RESEARCH_AGENT_ROLE_CATALOG_VERSION_V1,
    roles: roles.sort((left, right) => left.rank - right.rank),
    prohibited_capabilities: [...RESEARCH_PROHIBITED_CAPABILITIES_V1],
  };
  return { ...catalog, catalog_hash: researchAgentRoleCatalogHashV1(catalog) };
}

export function resolveResearchAgentRoleV1(input = {}) {
  const roleId = roleIdFrom(input.role_id || input.roleId || input.agent_role_id || input.agentRoleId);
  const roleEntry = ROLE_CATALOG[roleId] || null;
  return {
    schema_version: RESEARCH_AGENT_ROLE_RESOLUTION_SCHEMA_VERSION_V1,
    catalog_version: RESEARCH_AGENT_ROLE_CATALOG_VERSION_V1,
    ok: Boolean(roleEntry),
    role_id: roleId,
    role: roleEntry ? clone(roleEntry) : null,
    reason: roleEntry ? "RESEARCH_AGENT_ROLE_RESOLVED" : "RESEARCH_AGENT_ROLE_NOT_FOUND",
    catalog_hash: researchAgentRoleCatalogHashV1(),
  };
}

export function authorizeResearchAgentCapabilityV1(input = {}) {
  const resolution = resolveResearchAgentRoleV1(input);
  const capability = capabilityId(input.capability || input.capability_id);
  const denied = prohibited(capability);
  const allowed = resolution.ok && !denied && resolution.role.capabilities.includes(capability);
  return {
    schema_version: RESEARCH_AGENT_ROLE_CAPABILITY_DECISION_SCHEMA_VERSION_V1,
    ok: allowed,
    role_id: resolution.role_id,
    capability,
    allowed,
    reason: capabilityDecisionReason({ resolution, capability, denied, allowed }),
  };
}

export function buildResearchAgentMissionPolicyV1(input = {}) {
  const resolution = resolveResearchAgentRoleV1(input);
  if (!resolution.ok) return { ok: false, reason: resolution.reason, mission_policy: null };
  const roleEntry = resolution.role;
  return {
    ok: true,
    reason: "RESEARCH_AGENT_MISSION_POLICY_BUILT",
    mission_policy: {
      role_id: roleEntry.role_id,
      lane: roleEntry.lane,
      worker_pool_id: roleEntry.worker_pool_id,
      task_type: roleEntry.default_task_type,
      capabilities: roleEntry.capabilities,
      model_policy: roleEntry.model_policy,
      objective: input.objective || roleEntry.responsibility,
    },
  };
}

export function researchAgentRoleCatalogHashV1(input = {}) {
  const catalog = input.roles ? { ...input, catalog_hash: undefined } : { roles: Object.values(ROLE_CATALOG) };
  return `sha256:${canonicalSha256(catalog)}`;
}

function role(roleId, rank, label, responsibility, inferenceProfile, workerPoolId, capabilities) {
  return Object.freeze({
    role_id: roleId,
    rank,
    label,
    responsibility,
    inference_profile: inferenceProfile,
    lane: workerPoolId,
    worker_pool_id: workerPoolId,
    default_task_type: `RESEARCH_${roleId.toUpperCase()}`,
    capabilities: Object.freeze(capabilities),
    model_policy: PROFILE_POLICIES[inferenceProfile],
  });
}

function capabilityDecisionReason({ resolution, capability, denied, allowed }) {
  if (!resolution.ok) return resolution.reason;
  if (!capability) return "RESEARCH_CAPABILITY_REQUIRED";
  if (denied) return "RESEARCH_CAPABILITY_PROHIBITED";
  return allowed ? "RESEARCH_CAPABILITY_ALLOWED" : "RESEARCH_CAPABILITY_NOT_ASSIGNED";
}

function roleIdFrom(value) {
  return String(value || "").trim().toLowerCase().replaceAll("-", "_");
}

function capabilityId(value) {
  return String(value || "").trim().toUpperCase();
}

function prohibited(capability) {
  return RESEARCH_PROHIBITED_CAPABILITIES_V1.includes(capability);
}

function matchesPool(roleEntry, poolId) {
  const normalized = roleIdFrom(poolId);
  return !normalized || roleEntry.worker_pool_id === normalized;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
