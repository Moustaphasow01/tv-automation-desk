import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PostgresStrategySignalBusRepository } from "../src/strategy-signal-bus-repository.js";
import { createTheoreticalTestDatabase } from "./support/theoretical-postgres-fixtures.js";

test("TD2-429 atomically suppresses a grains signal when pause commits first", {
  skip: process.env.RUN_POSTGRES_TESTS !== "1",
}, async (t) => {
  const database = await createTheoreticalTestDatabase();
  t.after(() => database.close());
  const instanceId = await seedRunningStrategyInstance(database.pool);
  const repository = new PostgresStrategySignalBusRepository({ pool: database.pool, initialized: Promise.resolve() });

  await t.test("a pause-first transaction blocks publication, then prevents outbox and domain event writes", async () => {
    const pauser = await database.pool.connect();
    let committed = false;
    try {
      await pauser.query("BEGIN");
      await pauser.query(`UPDATE strategy_instances
        SET runtime_state = 'paused'::strategy_instance_runtime_state,
            last_heartbeat_at = '2026-08-10T15:00:00.000Z'::timestamptz
        WHERE strategy_instance_id = $1`, [instanceId]);
      const publication = repository.publish(signalOutbox(instanceId, "pause-first"));
      await waitForPublicationLock(database.pool);
      await pauser.query("COMMIT");
      committed = true;
      await assert.rejects(
        () => publication,
        (error) => error.code === "STRATEGY_SIGNAL_INSTANCE_NOT_RUNNING",
      );
    } finally {
      if (!committed) await pauser.query("ROLLBACK");
      pauser.release();
    }
    assert.equal(await count(database.pool, "strategy_signal_outbox"), 0);
    assert.equal(await count(database.pool, "domain_event_outbox"), 0);
  });

  await t.test("a signal published while running remains idempotently readable after a later pause", async () => {
    await database.pool.query(`UPDATE strategy_instances
      SET runtime_state = 'running'::strategy_instance_runtime_state,
          last_heartbeat_at = '2026-08-10T15:00:00.000Z'::timestamptz
      WHERE strategy_instance_id = $1`, [instanceId]);
    const outbox = signalOutbox(instanceId, "running-first");
    const published = await repository.publish(outbox);
    await database.pool.query(`UPDATE strategy_instances
      SET runtime_state = 'paused'::strategy_instance_runtime_state
      WHERE strategy_instance_id = $1`, [instanceId]);
    const retried = await repository.publish(outbox);

    assert.equal(retried.signal_outbox_id, published.signal_outbox_id);
    assert.equal(await count(database.pool, "strategy_signal_outbox"), 1);
    assert.equal(await count(database.pool, "domain_event_outbox"), 1);
    assert.equal(await count(database.pool, "broker_provider_commands"), 0);
  });
});

async function seedRunningStrategyInstance(pool) {
  const definitionId = randomUUID();
  const versionId = randomUUID();
  const instanceId = randomUUID();
  const hash = `sha256:${"a".repeat(64)}`;
  await pool.query(`INSERT INTO strategy_definitions
    (strategy_definition_id, external_key, name, owner)
    VALUES ($1, 'td2_429_grains', 'TD2 grains', 'desk')`, [definitionId]);
  await pool.query(`INSERT INTO strategy_versions
    (strategy_version_id, strategy_definition_id, version_label, dsl_source_hash, compiled_artifact_ref, runtime_contract_bundle_version)
    VALUES ($1, $2, 'v1', $3, 'artifact://td2-429', 'deterministic_execution_plan_v1_4')`, [versionId, definitionId, hash]);
  await pool.query(`INSERT INTO strategy_instances
    (strategy_instance_id, strategy_version_id, runtime_state, execution_mode, instrument_scope, last_heartbeat_at)
    VALUES ($1, $2, 'running', 'shadow', ARRAY['ZW'], '2026-08-10T15:00:00.000Z')`, [instanceId, versionId]);
  return instanceId;
}

function signalOutbox(strategyInstanceId, key) {
  return {
    require_running_instance: true,
    signal_outbox_id: randomUUID(),
    signal_id: randomUUID(),
    strategy_instance_id: strategyInstanceId,
    signal_type: "signal.emitted",
    instrument: "ZW",
    direction: "LONG",
    confidence: 0.7,
    execution_mode_origin: "SHADOW",
    generated_at_utc: "2026-08-10T14:45:00.000Z",
    expires_at_utc: "2026-08-10T16:00:00.000Z",
    correlation_id: `corr-${key}`,
    payload: {},
    payload_hash: `sha256:${"b".repeat(64)}`,
    dedupe_key: `td2-429:${key}`,
    status: "PENDING",
  };
}

async function count(pool, table) {
  return Number((await pool.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count);
}

async function waitForPublicationLock(pool) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await pool.query(`SELECT EXISTS (
      SELECT 1
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND query LIKE '%FOR SHARE%'
    ) AS waiting`);
    if (result.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("guarded_publication_did_not_wait_for_pause_lock");
}
