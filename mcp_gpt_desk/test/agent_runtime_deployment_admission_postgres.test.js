import assert from "node:assert/strict";
import test from "node:test";
import { PostgresAgentRuntimeRepository } from "../src/agent-runtime-postgres-repository.js";
import { acquireAgentRuntimeClaimDeploymentAdmission } from "../src/persistence/postgres-agent-runtime-deployment-admission.js";
import { createTheoreticalTestDatabase } from "./support/theoretical-postgres-fixtures.js";

const OPEN = Object.freeze({
  schema_version: "desk_deployment_producer_hold_v1",
  state: "OPEN",
  held: false,
  deployment_id: null,
  revision: 1,
});
const NOW = "2030-09-07T17:00:00.000Z";

test("agent runtime claims serialize with deployment hold while completion remains available", {
  skip: process.env.RUN_POSTGRES_TESTS !== "1",
}, async (t) => {
  const database = await createTheoreticalTestDatabase();
  t.after(() => database.close());
  const repository = new PostgresAgentRuntimeRepository({ pool: database.pool });
  await setControl(database.pool, OPEN);
  await assertClaimAdmissionBlocksPause(database.pool);
  await setLegacyLanePaused(database.pool);
  await seedTask(database.pool, { id: uuid(1), key: "claim-before-drain" });

  const claimed = await repository.claimNextTask({ lane: "live", workerId: "agent-runtime-live-01", nowUtc: NOW });
  assert.equal(claimed.task.task_id, uuid(1));
  assert.equal(claimed.task.status, "CLAIMED");

  await setControl(database.pool, held("DRAIN"));
  const completed = await repository.completeTask({
    taskId: uuid(1),
    workerId: "agent-runtime-live-01",
    leaseToken: claimed.lease.lease_token,
    outputRef: "market-context-snapshot://test",
    nowUtc: "2030-09-07T17:01:00.000Z",
  });
  assert.equal(completed.task.status, "DONE");
  await seedTask(database.pool, { id: uuid(2), key: "ready-under-drain" });
  await seedTask(database.pool, {
    id: uuid(3),
    key: "expired-running-under-drain",
    status: "RUNNING",
    assignedWorkerId: "old-worker",
    leaseToken: "expired-token",
    claimedAt: "2029-09-07T16:00:00.000Z",
    leaseExpiresAt: "2029-09-07T16:15:00.000Z",
  });
  assert.equal(await repository.claimNextTask({ lane: "live", workerId: "agent-runtime-live-01", nowUtc: NOW }), null);
  assert.deepEqual(await taskStatuses(database.pool, [uuid(2), uuid(3)]), [
    [uuid(2), "READY"],
    [uuid(3), "RUNNING"],
  ]);
});

test("an exclusive deployment transition wins before a waiting agent claim reads the hold", {
  skip: process.env.RUN_POSTGRES_TESTS !== "1",
}, async (t) => {
  const database = await createTheoreticalTestDatabase();
  let transition = null;
  t.after(async () => {
    transition?.release();
    await database.close();
  });
  const repository = new PostgresAgentRuntimeRepository({ pool: database.pool });
  await setControl(database.pool, OPEN);
  await seedTask(database.pool, { id: uuid(4), key: "claim-racing-drain" });
  transition = await database.pool.connect();
  await transition.query("BEGIN");
  await transition.query("SELECT pg_advisory_xact_lock(741912, 90)");

  let settled = false;
  const claim = repository.claimNextTask({ lane: "live", workerId: "agent-runtime-live-01", nowUtc: NOW })
    .finally(() => { settled = true; });
  await delay(100);
  assert.equal(settled, false);
  await setControl(transition, held("DRAIN"));
  await transition.query("COMMIT");
  transition.release();
  transition = null;

  assert.equal(await claim, null);
  assert.deepEqual(await taskStatuses(database.pool, [uuid(4)]), [[uuid(4), "READY"]]);
});

async function setControl(client, control) {
  await client.query(`INSERT INTO desk_documents(collection, document_id, data)
    VALUES ('desk_deployment_controls', 'producer_hold', $1::jsonb)
    ON CONFLICT(collection, document_id) DO UPDATE SET data=EXCLUDED.data`, [control]);
}

async function setLegacyLanePaused(pool) {
  await pool.query(`INSERT INTO desk_documents(collection, document_id, data)
    VALUES ('desk_claim_lane_controls', 'live', '{"lane":"live","enabled":false,"status":"PAUSED","revision":1}'::jsonb)
    ON CONFLICT(collection, document_id) DO UPDATE SET data=EXCLUDED.data`);
}

async function seedTask(pool, input) {
  const missionId = uuid(Number(input.id.slice(-2)) + 100);
  await pool.query(`INSERT INTO agent_missions (
      agent_mission_id, mission_key, mission_type, lane, objective, correlation_id, status
    ) VALUES ($1,$2,'MARKET_CONTEXT','live','test','correlation-test','CREATED')`, [missionId, `mission-${input.key}`]);
  await pool.query(`INSERT INTO agent_tasks (
      agent_task_id, agent_mission_id, task_key, task_type, lane, status, payload,
      assigned_worker_id, lease_token, claimed_at_utc, lease_expires_at_utc, correlation_id
    ) VALUES ($1,$2,$3,'LIVE_US_GRAINS_MARKET_CONTEXT_REFRESH','live',$4,'{"test":true}'::jsonb,
      $5,$6,$7::timestamptz,$8::timestamptz,'correlation-test')`, [
    input.id,
    missionId,
    input.key,
    input.status || "READY",
    input.assignedWorkerId || null,
    input.leaseToken || null,
    input.claimedAt || null,
    input.leaseExpiresAt || null,
  ]);
}

async function taskStatuses(pool, ids) {
  const result = await pool.query(`SELECT agent_task_id, status FROM agent_tasks
    WHERE agent_task_id = ANY($1::uuid[]) ORDER BY agent_task_id`, [ids]);
  return result.rows.map((row) => [row.agent_task_id, row.status]);
}

function held(state) {
  return { ...OPEN, state, held: true, deployment_id: "deploy-test", revision: 2 };
}

function uuid(value) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function assertClaimAdmissionBlocksPause(pool) {
  const claim = await pool.connect();
  const pause = await pool.connect();
  try {
    await claim.query("BEGIN");
    assert.equal((await acquireAgentRuntimeClaimDeploymentAdmission(claim)).allowed, true);
    await pause.query("BEGIN");
    await pause.query("SET LOCAL lock_timeout = '150ms'");
    await assert.rejects(pause.query("SELECT pg_advisory_xact_lock(741912, 90)"), { code: "55P03" });
    await pause.query("ROLLBACK");
    await claim.query("COMMIT");
    await pause.query("BEGIN");
    await pause.query("SELECT pg_advisory_xact_lock(741912, 90)");
    await pause.query("ROLLBACK");
  } finally {
    await claim.query("ROLLBACK").catch(() => undefined);
    await pause.query("ROLLBACK").catch(() => undefined);
    claim.release();
    pause.release();
  }
}
