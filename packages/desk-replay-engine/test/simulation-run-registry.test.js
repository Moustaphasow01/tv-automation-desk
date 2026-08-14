import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSimulationRunRegistrationV1,
  simulationRunArtifactsHashV1,
  simulationRunRegistryHashV1,
} from "../index.js";

const strategyVersionId = "22222222-2222-4222-8222-222222222222";
const datasetId = "33333333-3333-4333-8333-333333333333";

describe("simulation run registry V1", () => {
  it("builds a stable SimulationRun registry entry and artifacts from a canonical result", () => {
    const first = buildSimulationRunRegistrationV1({ result: canonicalResult() });
    const second = buildSimulationRunRegistrationV1({ result: canonicalResult() });

    assert.equal(first.ok, true);
    assert.deepEqual(first.run, second.run);
    assert.deepEqual(first.artifacts, second.artifacts);
    assert.equal(first.run.schema_version, "simulation_run_registry_entry_v1");
    assert.equal(first.run.status, "COMPLETED");
    assert.equal(first.run.strategy_version_id, strategyVersionId);
    assert.equal(first.run.dataset_id, datasetId);
    assert.match(first.run.simulation_run_id, /^[a-f0-9-]{36}$/);
    assert.equal(first.run.metrics_ref.endsWith("/metrics"), true);
    assert.deepEqual(first.artifacts.map((artifact) => artifact.artifact_kind), [
      "INPUT_MANIFEST",
      "ORDER_SIMULATION_POLICY",
      "RESULT",
      "METRICS",
      "EVENTS",
      "POSITIONS",
    ]);
    assert.match(simulationRunRegistryHashV1(first.run), /^sha256:[a-f0-9]{64}$/);
    assert.match(simulationRunArtifactsHashV1(first.artifacts), /^sha256:[a-f0-9]{64}$/);
  });

  it("keeps review-required outcomes terminal and auditable", () => {
    const registration = buildSimulationRunRegistrationV1({
      result: canonicalResult({ status: "REVIEW_REQUIRED" }),
      metadata: { reason: "ambiguous intrabar" },
    });

    assert.equal(registration.ok, true);
    assert.equal(registration.run.status, "REVIEW_REQUIRED");
    assert.ok(registration.run.completed_at_utc);
    assert.equal(registration.run.metadata.reason, "ambiguous intrabar");
  });

  it("attaches robustness reports when a canonical result supplies one", () => {
    const report = {
      schema_version: "strategy_robustness_report_v1",
      gate: { status: "PASS", promotion_allowed: true },
      content_hash: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    };
    const registration = buildSimulationRunRegistrationV1({ result: canonicalResult({ robustness_report: report }) });
    const artifact = registration.artifacts.find((candidate) => candidate.artifact_kind === "ROBUSTNESS_REPORT");

    assert.equal(registration.ok, true);
    assert.equal(artifact.content_hash, report.content_hash);
    assert.deepEqual(artifact.payload, report);
  });

  it("rejects incomplete canonical result envelopes before persistence", () => {
    const registration = buildSimulationRunRegistrationV1({
      result: { schema_version: "canonical_simulation_result_v1" },
    });

    assert.equal(registration.ok, false);
    assert.ok(registration.reasons.includes("SIMULATION_RESULT_HASH_REQUIRED"));
    assert.equal(registration.run, null);
    assert.deepEqual(registration.artifacts, []);
  });
});

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
    run_started_at_utc: "2026-08-09T08:00:00.000Z",
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
