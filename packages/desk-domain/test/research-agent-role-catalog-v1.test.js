import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RESEARCH_AGENT_ROLE_IDS_V1,
  RESEARCH_PROHIBITED_CAPABILITIES_V1,
  authorizeResearchAgentCapabilityV1,
  buildResearchAgentMissionPolicyV1,
  listResearchAgentRolesV1,
  resolveResearchAgentRoleV1,
} from "../index.js";

test("TD2-505 exposes the exact nine Research Lab roles", () => {
  const catalog = listResearchAgentRolesV1();

  assert.equal(catalog.roles.length, 9);
  assert.deepEqual(catalog.roles.map((role) => role.role_id), [...RESEARCH_AGENT_ROLE_IDS_V1]);
  assert.match(catalog.catalog_hash, /^sha256:[a-f0-9]{64}$/);
});

test("TD2-505 pins inference profiles and worker pools for critical roles", () => {
  const strategyBuilder = resolveResearchAgentRoleV1({ role_id: "strategy-builder" }).role;
  const validator = resolveResearchAgentRoleV1({ role_id: "backtest_validator" }).role;
  const monitor = resolveResearchAgentRoleV1({ role_id: "live_performance_monitor" }).role;

  assert.equal(strategyBuilder.inference_profile, "DEEP_STRATEGY_REVIEW");
  assert.equal(strategyBuilder.model_policy.reasoning_effort, "ultra");
  assert.equal(validator.worker_pool_id, "validation");
  assert.equal(validator.inference_profile, "SAFETY_REVIEW");
  assert.equal(monitor.inference_profile, "CONTEXT_DECISION");
});

test("TD2-505 denies every broker/execution capability to every research role", () => {
  for (const roleId of RESEARCH_AGENT_ROLE_IDS_V1) {
    for (const capability of RESEARCH_PROHIBITED_CAPABILITIES_V1) {
      const decision = authorizeResearchAgentCapabilityV1({ role_id: roleId, capability });
      assert.equal(decision.allowed, false, `${roleId} must not allow ${capability}`);
      assert.equal(decision.reason, "RESEARCH_CAPABILITY_PROHIBITED");
    }
  }
});

test("TD2-505 allows only capabilities explicitly assigned to a role", () => {
  const allowed = authorizeResearchAgentCapabilityV1({
    role_id: "experiment_agent",
    capability: "REQUEST_SIMULATION_RUN",
  });
  const denied = authorizeResearchAgentCapabilityV1({
    role_id: "experiment_agent",
    capability: "DRAFT_STRATEGY_VERSION",
  });

  assert.equal(allowed.allowed, true);
  assert.equal(allowed.reason, "RESEARCH_CAPABILITY_ALLOWED");
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, "RESEARCH_CAPABILITY_NOT_ASSIGNED");
});

test("TD2-505 builds a mission policy consumable by Agent Runtime", () => {
  const result = buildResearchAgentMissionPolicyV1({
    role_id: "research_reviewer",
    objective: "Review the candidate before promotion matrix.",
  });

  assert.equal(result.ok, true);
  assert.equal(result.mission_policy.worker_pool_id, "validation");
  assert.equal(result.mission_policy.lane, "validation");
  assert.equal(result.mission_policy.model_policy.reasoning_effort, "max");
  assert.ok(result.mission_policy.capabilities.includes("REQUEST_OPERATOR_APPROVAL"));
});

test("TD2-505 filters roles by worker pool", () => {
  const validationRoles = listResearchAgentRolesV1({ worker_pool_id: "validation" });

  assert.deepEqual(validationRoles.roles.map((role) => role.role_id), [
    "backtest_validator",
    "robustness_auditor",
    "research_reviewer",
  ]);
});
