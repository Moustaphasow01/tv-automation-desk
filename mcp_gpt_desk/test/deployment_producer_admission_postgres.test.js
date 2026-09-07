import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runWithDeploymentProducerAdmission } from "../src/persistence/postgres-deployment-producer-admission.js";
import { createTheoreticalTestDatabase } from "./support/theoretical-postgres-fixtures.js";

const OPEN = {
  schema_version: "desk_deployment_producer_hold_v1",
  state: "OPEN",
  held: false,
  deployment_id: null,
  revision: 1,
};

test("producer shared admission excludes deployment transitions and held state skips work", {
  skip: process.env.RUN_POSTGRES_TESTS !== "1",
}, async (t) => {
  const database = await createTheoreticalTestDatabase();
  t.after(() => database.close());
  await setControl(database.pool, OPEN);
  const admissionClient = clientFor(database.pool);
  let releaseWork;
  let workStarted;
  const started = new Promise((resolve) => { workStarted = resolve; });
  const release = new Promise((resolve) => { releaseWork = resolve; });
  const admitted = runWithDeploymentProducerAdmission(admissionClient, async () => {
    workStarted();
    await release;
    return "finished";
  });
  await started;
  await assertExclusiveLockTimesOut(database.pool);
  releaseWork();
  assert.deepEqual(await admitted, { executed: true, value: "finished" });

  await setControl(database.pool, { ...OPEN, state: "DRAIN", held: true, deployment_id: "deploy-test" });
  const skipped = await runWithDeploymentProducerAdmission(clientFor(database.pool), async () => {
    assert.fail("held producer work must not run");
  });
  assert.equal(skipped.executed, false);
  assert.equal(skipped.control_state, "DRAIN");
});

test("losing the admission connection fail-stops a process with a blocked write", {
  skip: process.env.RUN_POSTGRES_TESTS !== "1",
}, async (t) => {
  const database = await createTheoreticalTestDatabase();
  let blocker;
  let child;
  let observer;
  t.after(async () => {
    child?.kill();
    if (blocker) {
      try { await blocker.query("ROLLBACK"); } finally { blocker.release(); }
    }
    await observer?.end();
    await database.close();
  });
  await setControl(database.pool, OPEN);
  await database.pool.query(
    `INSERT INTO desk_documents(collection, document_id, data)
     VALUES ('producer_admission_test', 'blocked_write', '{"changed":false}'::jsonb)`,
  );
  blocker = await database.pool.connect();
  await blocker.query("SET application_name = 'producer-blocker-test'");
  await blocker.query("BEGIN");
  await blocker.query(
    `SELECT 1 FROM desk_documents
     WHERE collection = 'producer_admission_test' AND document_id = 'blocked_write' FOR UPDATE`,
  );
  observer = clientFor(database.pool);
  await observer.connect();
  await observer.query("SET application_name = 'producer-transition-test'");
  const observerPid = (await observer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  child = startLossChild(database.pool);
  const exitPromise = childExit(child);
  const childPids = await waitForBlockedChild(observer);
  assert.notEqual(childPids.admission_pid, observerPid);
  assert.notEqual(childPids.work_pid, observerPid);
  await observer.query("SELECT pg_terminate_backend($1)", [childPids.admission_pid]);
  assert.equal(await exitPromise, 70);
  assert.equal(await terminateExactProducerConnections(observer), 1);
  await blocker.query("COMMIT");
  const result = await observer.query(
    `SELECT data FROM desk_documents
     WHERE collection = 'producer_admission_test' AND document_id = 'blocked_write'`,
  );
  assert.deepEqual(result.rows[0].data, { changed: false });
});

async function setControl(pool, control) {
  await pool.query(
    `INSERT INTO desk_documents(collection, document_id, data)
     VALUES ('desk_deployment_controls', 'producer_hold', $1::jsonb)
     ON CONFLICT(collection, document_id) DO UPDATE SET data = EXCLUDED.data`,
    [control],
  );
}

function clientFor(pool) {
  return new pg.Client({
    host: pool.options.host,
    port: pool.options.port,
    user: pool.options.user,
    password: pool.options.password,
    database: pool.options.database,
  });
}

function connectionStringFor(pool) {
  const user = encodeURIComponent(pool.options.user);
  const password = encodeURIComponent(pool.options.password);
  return `postgresql://${user}:${password}@${pool.options.host}:${pool.options.port}/${pool.options.database}`;
}

function startLossChild(pool) {
  return spawn(process.execPath, [fileURLToPath(new URL("./support/producer-admission-loss-child.mjs", import.meta.url))], {
    env: { ...process.env, DATABASE_URL: connectionStringFor(pool) },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function childExit(child) {
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 70) resolve(code);
      else reject(new Error(`loss child exited ${code}: ${stderr.trim()}`));
    });
  });
}

async function waitForBlockedChild(client) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await client.query(
      `SELECT max(pid) FILTER (WHERE application_name = 'producer-admission-loss-test') AS admission_pid,
              max(pid) FILTER (WHERE application_name = 'desk-grains-calendar-refresh') AS work_pid,
              bool_or(application_name = 'desk-grains-calendar-refresh' AND wait_event_type = 'Lock') AS work_blocked
       FROM pg_stat_activity WHERE datname = current_database()`,
    );
    if (result.rows[0].admission_pid && result.rows[0].work_pid && result.rows[0].work_blocked) return result.rows[0];
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("producer loss child did not reach its blocked write");
}

async function terminateExactProducerConnections(client) {
  const result = await client.query(
    `SELECT pid, pg_terminate_backend(pid, 10000) AS terminated
     FROM pg_stat_activity
     WHERE datname = current_database() AND pid <> pg_backend_pid()
       AND application_name IN (
         'desk-us-grains-strategy-suite-work',
         'desk-strategy-signal-decision-pipeline-work',
         'desk-grains-calendar-refresh'
       )`,
  );
  assert.equal(result.rows.every((row) => row.terminated === true), true);
  const remaining = await client.query(
    `SELECT count(*)::integer AS count FROM pg_stat_activity
     WHERE datname = current_database() AND pid <> pg_backend_pid()
       AND application_name IN (
         'desk-us-grains-strategy-suite-work',
         'desk-strategy-signal-decision-pipeline-work',
         'desk-grains-calendar-refresh'
       )`,
  );
  assert.equal(remaining.rows[0].count, 0);
  return result.rows.length;
}

async function assertExclusiveLockTimesOut(pool) {
  const transition = await pool.connect();
  try {
    await transition.query("BEGIN");
    await transition.query("SET LOCAL lock_timeout = '150ms'");
    await assert.rejects(
      transition.query("SELECT pg_advisory_xact_lock(741912, 90)"),
      { code: "55P03" },
    );
    await transition.query("ROLLBACK");
  } finally { transition.release(); }
}
