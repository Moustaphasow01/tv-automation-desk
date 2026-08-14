import assert from "node:assert/strict";
import test from "node:test";
import {
  DESK_OAUTH_SCOPES,
  expandOperatorScopes,
  hasOperatorScopes,
  operatorAccessPolicyForFrontRoute,
} from "../src/operator-access-policy-v1.js";
import { OAUTH_SCOPES, hasScopes } from "../src/oauth.js";

test("operator access policy publishes granular OAuth scopes while keeping legacy scopes", () => {
  assert.deepEqual(OAUTH_SCOPES, DESK_OAUTH_SCOPES);
  assert.ok(OAUTH_SCOPES.includes("desk.read"));
  assert.ok(OAUTH_SCOPES.includes("desk.write"));
  assert.ok(OAUTH_SCOPES.includes("desk.automation.write"));
  assert.ok(OAUTH_SCOPES.includes("desk.execution.write"));
});

test("operator scope implication preserves current desk.read desk.write compatibility", () => {
  assert.ok(expandOperatorScopes(["desk.write"]).includes("desk.execution.write"));
  assert.equal(hasScopes({ scopes: ["desk.write"] }, ["desk.execution.write"]), true);
  assert.equal(hasScopes({ scopes: ["desk.read"] }, ["desk.automation.read"]), true);
  assert.equal(hasScopes({ scopes: ["desk.automation.read"] }, ["desk.execution.read"]), false);
  assert.equal(hasOperatorScopes(["desk.execution.write"], ["desk.execution.read"]), true);
});

test("operator access policy classifies risky automation and execution routes", () => {
  const replayCreate = operatorAccessPolicyForFrontRoute({ pathname: "/api/v1/replays", method: "POST" });
  const executionAction = operatorAccessPolicyForFrontRoute({ pathname: "/api/v1/execution/actions", method: "POST" });
  const executionRead = operatorAccessPolicyForFrontRoute({ pathname: "/api/v1/execution/overview", method: "GET" });

  assert.deepEqual(replayCreate.requiredScopes, ["desk.automation.write"]);
  assert.equal(replayCreate.risk, "elevated");
  assert.deepEqual(executionAction.requiredScopes, ["desk.execution.write"]);
  assert.equal(executionAction.risk, "high");
  assert.deepEqual(executionRead.requiredScopes, ["desk.execution.read"]);
});
