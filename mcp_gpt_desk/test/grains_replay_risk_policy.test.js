import test from "node:test";
import assert from "node:assert/strict";
import { loadGrainsReplayRiskPolicy, parseGrainsReplayRiskPolicy } from "../scripts/lib/grains-replay-risk-policy.mjs";

const fixture = () => ({ schema_version: "grains_risk_replay_policy_v1", policy_id: "fixture", account_id: "fixture-shadow",
  risk_budget: { sizing_mode: "MONETARY_RISK_BUDGET", max_monetary_risk: 100, max_monetary_risk_currency: "USD", monetary_risk_scope: "PER_ALLOCATION" } });

test("replay pins budget and account without admitting execution overrides", () => {
  const policy = parseGrainsReplayRiskPolicy(JSON.stringify(fixture()));
  assert.equal(policy.pipelinePolicy.risk_budget.max_monetary_risk, 100);
  assert.equal(policy.accountId, "fixture-shadow");
  assert.match(policy.provenance.sha256, /^sha256:[a-f0-9]{64}$/);
  for (const field of ["execution_policy", "provider_id", "execution_mode", "submission_enabled"]) {
    assert.throws(() => parseGrainsReplayRiskPolicy(JSON.stringify({ ...fixture(), [field]: true })), /FIELD_NOT_ALLOWED/);
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
