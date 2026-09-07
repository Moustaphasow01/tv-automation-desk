import assert from "node:assert/strict";
import test from "node:test";
import { acquireAgentRuntimeClaimDeploymentAdmission } from "../src/persistence/postgres-agent-runtime-deployment-admission.js";

const OPEN = Object.freeze({
  schema_version: "desk_deployment_producer_hold_v1",
  state: "OPEN",
  held: false,
  deployment_id: null,
  revision: 1,
});

test("agent runtime claim admission takes the deployment transaction lock and admits OPEN", async () => {
  const client = fakeClient(OPEN);
  assert.deepEqual(await acquireAgentRuntimeClaimDeploymentAdmission(client), {
    allowed: true,
    control_state: "OPEN",
    deployment_id: null,
  });
  assert.deepEqual(client.calls[0], {
    sql: "SELECT pg_advisory_xact_lock_shared($1, $2)",
    params: [741912, 90],
  });
  assert.match(client.calls[1].sql, /FOR SHARE/);
});

for (const state of ["DRAIN", "FROZEN", "FAILED"]) {
  test(`agent runtime claim admission denies ${state}`, async () => {
    const result = await acquireAgentRuntimeClaimDeploymentAdmission(fakeClient({
      ...OPEN,
      state,
      held: true,
      deployment_id: "deploy-owner",
    }));
    assert.equal(result.allowed, false);
    assert.equal(result.control_state, state);
  });
}

test("agent runtime claim admission fails closed for missing or invalid hold", async () => {
  await assert.rejects(
    acquireAgentRuntimeClaimDeploymentAdmission(fakeClient(undefined)),
    { code: "DEPLOYMENT_PRODUCER_HOLD_MISSING" },
  );
  await assert.rejects(
    acquireAgentRuntimeClaimDeploymentAdmission(fakeClient({ ...OPEN, state: "HELD", held: true })),
    { code: "DEPLOYMENT_PRODUCER_HOLD_INVALID" },
  );
});

function fakeClient(control) {
  return {
    calls: [],
    async query(sql, params = []) {
      this.calls.push({ sql, params });
      if (sql.includes("pg_advisory_xact_lock_shared")) return { rows: [{}] };
      return { rows: control === undefined ? [] : [{ data: control }] };
    },
  };
}
