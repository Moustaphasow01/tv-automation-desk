import test from "node:test";
import assert from "node:assert/strict";
import {
  createDeploymentProducerClient,
  runWithDeploymentProducerAdmission,
} from "../src/persistence/postgres-deployment-producer-admission.js";

const openControl = Object.freeze({
  schema_version: "desk_deployment_producer_hold_v1",
  state: "OPEN",
  held: false,
  deployment_id: null,
  revision: 1,
});

test("deployment producer admission holds the shared lock for the whole operation", async () => {
  const client = fakeClient({ control: openControl });
  const outcome = await runWithDeploymentProducerAdmission(client, async () => {
    client.calls.push("work");
    return { status: "DONE" };
  });
  assert.deepEqual(outcome, { executed: true, value: { status: "DONE" } });
  assert.deepEqual(client.calls, ["connect", "lock", "control", "work", "unlock", "end"]);
});

for (const state of ["DRAIN", "FROZEN", "FAILED"]) {
  test(`deployment producer admission skips ${state} without calling work`, async () => {
    const client = fakeClient({ control: { ...openControl, state, held: true, deployment_id: "deploy-owner" } });
    const outcome = await runWithDeploymentProducerAdmission(client, async () => assert.fail("work must not run"));
    assert.equal(outcome.executed, false);
    assert.equal(outcome.control_state, state);
    assert.deepEqual(client.calls, ["connect", "lock", "control", "unlock", "end"]);
  });
}

test("deployment producer admission skips while the exclusive transition lock is held", async () => {
  const client = fakeClient({ lockAcquired: false });
  const outcome = await runWithDeploymentProducerAdmission(client, async () => assert.fail("work must not run"));
  assert.equal(outcome.control_state, "TRANSITION");
  assert.deepEqual(client.calls, ["connect", "lock", "end"]);
});

test("deployment producer admission fails closed when the singleton is missing", async () => {
  const client = fakeClient({ missing: true });
  await assert.rejects(() => runWithDeploymentProducerAdmission(client, async () => undefined),
    { code: "DEPLOYMENT_PRODUCER_HOLD_MISSING" });
  assert.deepEqual(client.calls, ["connect", "lock", "control", "unlock", "end"]);
});

test("deployment producer admission requires an explicit database", () => {
  assert.throws(() => createDeploymentProducerClient({ connectionString: "" }),
    { code: "DEPLOYMENT_PRODUCER_DATABASE_REQUIRED" });
});

test("deployment producer admission rejects malformed singleton documents", async () => {
  for (const control of [null, {}, { ...openControl, revision: 0 }, { ...openControl, held: true }]) {
    const client = fakeClient({ control });
    await assert.rejects(() => runWithDeploymentProducerAdmission(client, async () => undefined),
      { code: "DEPLOYMENT_PRODUCER_HOLD_INVALID" });
  }
});

test("deployment producer admission propagates database errors and closes its session", async () => {
  const client = fakeClient({ controlError: new Error("database unavailable") });
  await assert.rejects(() => runWithDeploymentProducerAdmission(client, async () => undefined), /database unavailable/);
  assert.deepEqual(client.calls, ["connect", "lock", "control", "unlock", "end"]);
});

test("deployment producer admission requests exit 70 when its lock session is lost", async () => {
  const client = fakeClient({ control: openControl });
  const terminations = [];
  await assert.rejects(() => runWithDeploymentProducerAdmission(client, async () => {
    client.calls.push("work");
    client.emit("error", new Error("connection terminated"));
    await new Promise(() => {});
  }, {
    terminate(exitCode, error) { terminations.push({ exitCode, code: error.code }); },
  }), { code: "DEPLOYMENT_PRODUCER_ADMISSION_LOST" });
  assert.deepEqual(terminations, [{ exitCode: 70, code: "DEPLOYMENT_PRODUCER_ADMISSION_LOST" }]);
});

test("deployment producer admission fails when its advisory unlock is not confirmed", async () => {
  const client = fakeClient({ control: openControl, unlockReleased: false });
  await assert.rejects(() => runWithDeploymentProducerAdmission(client, async () => "done"),
    { code: "DEPLOYMENT_PRODUCER_UNLOCK_FAILED" });
  assert.equal(client.calls.at(-1), "end");
});

function fakeClient({ control = openControl, missing = false, lockAcquired = true,
  unlockReleased = true, controlError = null } = {}) {
  const listeners = new Map();
  return {
    calls: [],
    async connect() { this.calls.push("connect"); },
    async query(sql) {
      if (sql.includes("pg_try_advisory_lock_shared")) {
        this.calls.push("lock");
        return { rows: [{ acquired: lockAcquired }] };
      }
      if (sql.includes("pg_advisory_unlock_shared")) {
        this.calls.push("unlock");
        return { rows: [{ released: unlockReleased }] };
      }
      this.calls.push("control");
      if (controlError) throw controlError;
      return { rows: missing ? [] : [{ data: control }] };
    },
    async end() { this.calls.push("end"); },
    on(event, listener) { listeners.set(event, listener); },
    removeListener(event, listener) {
      if (listeners.get(event) === listener) listeners.delete(event);
    },
    emit(event, value) { listeners.get(event)?.(value); },
  };
}
