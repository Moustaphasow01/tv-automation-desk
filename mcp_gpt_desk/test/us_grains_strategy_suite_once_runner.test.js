import assert from "node:assert/strict";
import test from "node:test";
import {
  filterSignalsForRunningGrainInstances,
  isReadOnlyGrainRun,
  normalizeGrainRunArgs,
  runUsGrainsStrategySuiteOnce,
  selectRunningGrainCatalogInstances,
} from "../src/us-grains-strategy-suite-once-runner.js";

const AS_OF = "2026-08-10T15:00:00.000Z";

test("TD2-429 keeps paused and stopped grains instances out of runtime writes and publication", async () => {
  const fixture = runnerFixture();
  const result = await runUsGrainsStrategySuiteOnce({ store: fixture.store, args: { instruments: "ZW" }, nowUtc: AS_OF, detectSignals: replayWithSignals });

  assert.equal(result.runtime_heartbeat.updated_instance_count, 1);
  assert.deepEqual(fixture.heartbeatIds, ["11111111-1111-4111-8111-111111111111"]);
  assert.deepEqual(fixture.evaluationIds, ["11111111-1111-4111-8111-111111111111"]);
  assert.deepEqual(fixture.publishedIds, ["11111111-1111-4111-8111-111111111111"]);
  assert.equal(fixture.queries.some((statement) => /SET runtime_state/i.test(statement)), false);
});

test("TD2-429 dry-run and no-publish are read-only after schema validation", async () => {
  for (const flag of ["dry-run", "no-publish"]) {
    const fixture = runnerFixture({ failOnWrite: true });
    const result = await runUsGrainsStrategySuiteOnce({ store: fixture.store, args: { instruments: "ZW", [flag]: "true" }, nowUtc: AS_OF, detectSignals: replayWithSignals });

    assert.equal(result.dry_run, true);
    assert.equal(result.runtime_heartbeat.status, "READ_ONLY");
    assert.equal(result.runtime_evaluations.status, "READ_ONLY");
    assert.equal(result.publish.published_count, 0);
    assert.equal(fixture.evaluationIds.length, 0);
    assert.equal(fixture.publishedIds.length, 0);
    assert.equal(fixture.queries.some((statement) => /\b(UPDATE|INSERT|DELETE|CREATE)\b/i.test(statement)), false);
  }
});

test("TD2-429 sends raw candidates to the bus, never simulator-selected winners", async () => {
  const fixture = runnerFixture();
  const result = await runUsGrainsStrategySuiteOnce({
    store: fixture.store, args: { instruments: "ZW" }, nowUtc: AS_OF,
    detectSignals: () => ({ ...replayWithSignals(), accepted_signals: [], context_accepted_count: 0 }),
  });
  assert.equal(result.publish.published_count, 1);
  assert.equal(result.execution_simulated, false);
  assert.equal(result.context_accepted_count, null);
  assert.equal(result.qualification_stage, "RAW_SIGNAL_BUS_PENDING");
});

test("TD2-429 validates catalog coverage per requested instrument", async () => {
  const fixture = runnerFixture();
  await assert.rejects(() => runUsGrainsStrategySuiteOnce({
    store: fixture.store, args: { instruments: "ZW,ZC", "dry-run": true }, nowUtc: AS_OF,
    detectSignals: replayWithSignals,
  }), /catalog missing/);
});

test("TD2-429 policy runs only RUNNING instances, not scheduler STARTING", () => {
  const instances = [instance("running", "RUNNING"), instance("starting", "STARTING"), instance("paused", "PAUSED")];
  const signals = [signal("running"), signal("starting"), signal("paused")];

  assert.equal(isReadOnlyGrainRun({ "dry-run": true }), true);
  assert.equal(isReadOnlyGrainRun({ "dry-run": "true" }), true);
  assert.equal(isReadOnlyGrainRun({}), false);
  assert.deepEqual(normalizeGrainRunArgs({ "no-publish": "false" }), { "dry-run": false, "no-publish": false, "include-expired": false });
  assert.throws(() => normalizeGrainRunArgs({ "dry-run": "yes" }), /US_GRAINS_RUN_FLAG_INVALID:dry-run/);
  assert.deepEqual(selectRunningGrainCatalogInstances(instances).map((item) => item.strategy_instance_id), ["running"]);
  assert.deepEqual(filterSignalsForRunningGrainInstances(signals, instances.filter((item) => item.runtime_state === "RUNNING")).map((item) => item.strategy_instance_id), ["running"]);
});

function runnerFixture({ failOnWrite = false } = {}) {
  const queries = [];
  const heartbeatIds = [];
  const evaluationIds = [];
  const publishedIds = [];
  const catalog = [
    instance("11111111-1111-4111-8111-111111111111", "RUNNING"),
    instance("22222222-2222-4222-8222-222222222222", "PAUSED"),
    instance("33333333-3333-4333-8333-333333333333", "STOPPED"),
  ];
  const pool = {
    async query(statement, values = []) {
      const text = String(statement);
      queries.push(text);
      if (failOnWrite && /\b(UPDATE|INSERT|DELETE|CREATE)\b/i.test(text)) throw new Error("unexpected_write");
      if (/FROM strategy_instances si/.test(text)) return { rows: catalog };
      if (/UPDATE strategy_instances/.test(text)) {
        heartbeatIds.push(...values[0]);
        return { rows: [{ strategy_instance_id: catalog[0].strategy_instance_id }] };
      }
      return { rows: [] };
    },
  };
  return {
    queries, heartbeatIds, evaluationIds, publishedIds,
    store: {
      persistence: { pool, initialized: Promise.resolve() },
      strategyEvaluations: {
        async record(input) {
          evaluationIds.push(input.strategy_instance_id);
          return { status: input.status, completed_at_utc: input.completed_at_utc, signal_id: input.signal_id };
        },
      },
      async publishRunningStrategyV2Signal({ input }) {
        publishedIds.push(input.strategy_instance_id);
        return { status: "PUBLISHED", signal: input, outbox: { signal_outbox_id: `outbox-${input.signal_id}` } };
      },
    },
  };
}

function replayWithSignals() {
  const signals = [
    signal("11111111-1111-4111-8111-111111111111"),
    signal("22222222-2222-4222-8222-222222222222"),
    signal("33333333-3333-4333-8333-333333333333"),
  ];
  return {
    raw_signal_count: signals.length,
    context_accepted_count: signals.length,
    selected_signal_count: signals.length,
    raw_signals: signals,
    accepted_signals: signals,
  };
}

function instance(strategyInstanceId, runtimeState) {
  return {
    strategy_instance_id: strategyInstanceId,
    strategy_version_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    runtime_state: runtimeState,
    instrument_scope: ["ZW"],
    name: "US grains test",
  };
}

function signal(strategyInstanceId) {
  return {
    signal_id: `signal-${strategyInstanceId}`,
    strategy_instance_id: strategyInstanceId,
    instrument: "ZW",
    direction: "LONG",
    generated_at_utc: "2026-08-10T14:45:00.000Z",
    source_data_cutoff_utc: "2026-08-10T14:45:00.000Z",
    expires_at_utc: "2026-08-10T16:00:00.000Z",
  };
}
