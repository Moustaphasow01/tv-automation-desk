import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InMemorySimulationRunRegistryRepository,
  SimulationRunRegistryService,
  normalizeFilters,
} from "../src/simulation-run-registry-service.js";

const NOW = "2026-08-09T08:00:00.000Z";
const runId = "11111111-1111-4111-8111-111111111111";
const strategyVersionId = "22222222-2222-4222-8222-222222222222";
const datasetId = "33333333-3333-4333-8333-333333333333";

test("Simulation Run Registry records a canonical result with artifacts and audit", async () => {
  const repository = new InMemorySimulationRunRegistryRepository();
  const service = serviceFor(repository);

  const result = await service.recordSimulationResult({
    simulation_run_id: runId,
    result: canonicalResult(),
  }, {
    idempotency_key: "record-run-1",
    actor: "codex",
    reason: "TD2-302",
  });

  assert.equal(result.status, "CREATED");
  assert.equal(result.run.simulation_run_id, runId);
  assert.equal(result.run.status, "COMPLETED");
  assert.equal(result.artifacts.length, 6);
  assert.equal(result.artifacts[0].artifact_kind, "INPUT_MANIFEST");
  assert.equal(result.artifacts.some((artifact) => artifact.artifact_kind === "ORDER_SIMULATION_POLICY"), true);
  assert.equal(result.audit.event_type, "SIMULATION_RUN_REGISTERED");
  assert.match(result.audit.next_hash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(repository.transactionCalls, [`simulation-run:${runId}`]);
});

test("Simulation Run Registry is idempotent for the same sealed result", async () => {
  const repository = new InMemorySimulationRunRegistryRepository();
  const service = serviceFor(repository);
  const command = { idempotency_key: "record-run-repeat", actor: "codex" };

  await service.recordSimulationResult({ simulation_run_id: runId, result: canonicalResult() }, command);
  const replayed = await service.recordSimulationResult({ simulation_run_id: runId, result: canonicalResult() }, command);

  assert.equal(replayed.status, "IDEMPOTENT");
  assert.equal(replayed.artifacts.length, 6);
  assert.equal(replayed.artifacts.some((artifact) => artifact.artifact_kind === "ORDER_SIMULATION_POLICY"), true);
  assert.equal(repository.auditEvents.length, 2);
  assert.equal(repository.auditEvents[1].event_type, "SIMULATION_RUN_REGISTERED_IDEMPOTENT");
});

test("Simulation Run Registry rejects divergent rewrites for a sealed run", async () => {
  const repository = new InMemorySimulationRunRegistryRepository();
  const service = serviceFor(repository);

  await service.recordSimulationResult({ simulation_run_id: runId, result: canonicalResult() }, { actor: "codex" });

  await assert.rejects(
    () => service.recordSimulationResult({
      simulation_run_id: runId,
      result: canonicalResult({
        content_hash: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      }),
    }, { actor: "codex" }),
    (error) => error.code === "SIMULATION_RUN_CONFLICT" && error.statusCode === 409,
  );
});

test("Simulation Run Registry exposes normalized filters for run and artifact queries", async () => {
  const repository = new InMemorySimulationRunRegistryRepository();
  const service = serviceFor(repository);

  await service.recordSimulationResult({ simulation_run_id: runId, result: canonicalResult() }, { actor: "codex" });
  const runs = await service.listRuns({ status: "completed", strategy_version_id: strategyVersionId });
  const metrics = await service.listArtifacts({ simulation_run_id: runId, artifactKind: "metrics" });

  assert.equal(runs.length, 1);
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].artifact_kind, "METRICS");
  assert.equal(normalizeFilters({ limit: 10_000 }).limit, 500);
});

test("Simulation Run Registry sorts operator lists by creation time or performance", async () => {
  const repository = new InMemorySimulationRunRegistryRepository();
  const service = serviceFor(repository);
  const olderRunId = "66666666-6666-4666-8666-666666666666";
  const newerRunId = "77777777-7777-4777-8777-777777777777";

  await service.recordSimulationResult({
    simulation_run_id: olderRunId,
    created_at_utc: "2026-08-09T08:00:00.000Z",
    metadata: { metrics: { total_r: 10 } },
    result: canonicalResult({
      run_id: "older",
      metrics: { schema_version: "canonical_simulation_metrics_v1", metric_version: "1.0.0", trade_count: 1, total_r: 10 },
      metrics_hash: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      content_hash: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
    }),
  }, { actor: "codex" });
  await service.recordSimulationResult({
    simulation_run_id: newerRunId,
    created_at_utc: "2026-08-09T09:00:00.000Z",
    metadata: { metrics: { total_r: 2 } },
    result: canonicalResult({
      run_id: "newer",
      metrics: { schema_version: "canonical_simulation_metrics_v1", metric_version: "1.0.0", trade_count: 1, total_r: 2 },
      metrics_hash: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
      content_hash: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
    }),
  }, { actor: "codex" });

  const recent = await service.listRuns({ sort: "created_desc", limit: 2 });
  const best = await service.listRuns({ sort: "performance_desc", limit: 2 });

  assert.equal(recent[0].simulation_run_id, newerRunId);
  assert.equal(best[0].simulation_run_id, olderRunId);
});

test("Simulation Run Registry compares reproducibility for two recorded runs", async () => {
  const repository = new InMemorySimulationRunRegistryRepository();
  const service = serviceFor(repository);
  const candidateRunId = "44444444-4444-4444-8444-444444444444";

  await service.recordSimulationResult({ simulation_run_id: runId, result: canonicalResult() }, { actor: "codex" });
  await service.recordSimulationResult({ simulation_run_id: candidateRunId, result: canonicalResult() }, { actor: "codex" });

  const proof = await service.compareRunReproducibility({
    baseline_run_id: runId,
    candidate_run_id: candidateRunId,
  });

  assert.equal(proof.ok, true);
  assert.equal(proof.checked_at_utc, NOW);
  assert.equal(proof.baseline_run_id, runId);
  assert.equal(proof.candidate_run_id, candidateRunId);
  assert.equal(proof.result_hash_match, true);
});

test("Simulation Run Registry reports reproducibility mismatches without mutating runs", async () => {
  const repository = new InMemorySimulationRunRegistryRepository();
  const service = serviceFor(repository);
  const candidateRunId = "55555555-5555-4555-8555-555555555555";

  await service.recordSimulationResult({ simulation_run_id: runId, result: canonicalResult() }, { actor: "codex" });
  await service.recordSimulationResult({
    simulation_run_id: candidateRunId,
    result: canonicalResult({
      metrics_hash: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      content_hash: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    }),
  }, { actor: "codex" });

  const proof = await service.compareRunReproducibility({
    baselineRunId: runId,
    candidateRunId,
  });

  assert.equal(proof.ok, false);
  assert.ok(proof.reasons.includes("METRICS_HASH_MISMATCH"));
  assert.ok(proof.reasons.includes("RESULT_HASH_MISMATCH"));
  assert.equal(repository.runs.size, 2);
});

function serviceFor(repository) {
  return new SimulationRunRegistryService({
    repository,
    clock: { now: () => ({ utc: NOW }) },
  });
}

function canonicalResult(overrides = {}) {
  return {
    schema_version: "canonical_simulation_result_v1",
    simulation_engine: "desk-replay-engine",
    simulation_engine_version: "1.0.0",
    run_id: "sim_fixture_2026_06_11",
    strategy_version_id: strategyVersionId,
    dataset_id: datasetId,
    dataset_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    parameters_hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    reproducibility_seed: "seed-fixture",
    cutoff: "2026-06-11T21:45:00+02:00",
    run_started_at_utc: NOW,
    status: "COMPLETED",
    metrics: {
      schema_version: "canonical_simulation_metrics_v1",
      metric_version: "1.0.0",
      trade_count: 1,
      total_r: 2,
    },
    metrics_hash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    events: [{ type: "POSITION_CLOSED" }],
    positions: [{ position_id: "p1", status: "CLOSED", r_result: 2 }],
    content_hash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    ...overrides,
  };
}
