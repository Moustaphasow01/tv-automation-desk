import test from "node:test";
import assert from "node:assert/strict";
import { loadGrainsReplayRiskPolicy, parseGrainsReplayRiskPolicy } from "../scripts/lib/grains-replay-risk-policy.mjs";

const fixture = () => ({ schema_version: "grains_risk_replay_policy_v1", policy_id: "fixture", account_id: "fixture-shadow",
  risk_budget: { sizing_mode: "MONETARY_RISK_BUDGET", max_monetary_risk: 100, max_monetary_risk_currency: "USD", monetary_risk_scope: "PER_ALLOCATION" } });

test("replay pins budget and account without admitting execution overrides", () => {
  const policy = parseGrainsReplayRiskPolicy(JSON.stringify(fixture()));
  assert.equal(policy.pipelinePolicy.risk_budget.max_monetary_risk, 100);
  assert.equal(policy.accountId, "fixture-shadow");
  assert.equal(policy.pipelinePolicy.allocation_policy.conflict_resolution, "NET_BY_DIRECTION");
  assert.match(policy.provenance.sha256, /^sha256:[a-f0-9]{64}$/);
  for (const field of ["execution_policy", "provider_id", "execution_mode", "submission_enabled"]) {
    assert.throws(() => parseGrainsReplayRiskPolicy(JSON.stringify({ ...fixture(), [field]: true })), /FIELD_NOT_ALLOWED/);
  }
});

test("allocation policy is explicit, frozen and cannot admit execution overrides", async () => {
  const allocation_policy = { conflict_resolution: "BEST_COMPLETE_PLAN_V1" };
  const result = parseGrainsReplayRiskPolicy(JSON.stringify({ ...fixture(), allocation_policy }));
  assert.deepEqual(result.pipelinePolicy.allocation_policy, allocation_policy);
  assert.deepEqual(result.provenance.allocation_policy, allocation_policy);
  const local = await loadGrainsReplayRiskPolicy(null, { DESK_SHADOW_PORTFOLIO_SELECTION_POLICY: "BEST_COMPLETE_PLAN_V1" });
  assert.deepEqual(local.pipelinePolicy.allocation_policy, allocation_policy);
  for (const value of [null, [], {}, true, { conflict_resolution: "UNKNOWN" }, { ...allocation_policy, submission_enabled: true }]) {
    assert.throws(() => parseGrainsReplayRiskPolicy(JSON.stringify({ ...fixture(), allocation_policy: value })), /ALLOCATION_POLICY_INVALID/);
  }
});
test("replay default configuration is explicitly pinned without an implicit monetary cutover", async () => {
  const result = await loadGrainsReplayRiskPolicy(null, {});
  assert.equal(result.accountId, "causal-replay-shadow");
  assert.equal(result.pipelinePolicy.risk_budget.sizing_mode, undefined);
  assert.equal(result.pipelinePolicy.risk_budget.max_monetary_risk, undefined);
  assert.equal(result.pipelinePolicy.risk_budget.max_portfolio_abs_size, 20);
});
test("invalid policy cannot silently become default risk", () => {
  assert.throws(() => parseGrainsReplayRiskPolicy("{}"), /SCHEMA_INVALID/);
  assert.throws(() => parseGrainsReplayRiskPolicy(JSON.stringify({ ...fixture(), risk_budget: undefined })), /BUDGET_REQUIRED/);
  assert.throws(() => parseGrainsReplayRiskPolicy(JSON.stringify({ ...fixture(), account_id: "" })), /IDENTITY_REQUIRED/);
});
