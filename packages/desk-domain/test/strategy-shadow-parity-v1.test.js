import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildStrategyShadowParityReportV1 } from "../index.js";

describe("strategy shadow parity V1", () => {
  it("proves LONG signal parity between Simulation and SHADOW", () => {
    const report = buildStrategyShadowParityReportV1({
      scenario_id: "long-breakout-retest-fixture",
      strategy_version_id: versionId,
      dataset_id: datasetId,
      generated_at_utc: "2026-08-09T08:01:00.000Z",
      simulation_signal: signalFixture({ direction: "LONG" }),
      shadow_signal: signalFixture({ direction: "LONG" }),
    });

    assert.equal(report.status, "PARITY_OK");
    assert.equal(report.ok, true);
    assert.equal(report.comparison.semantic_hash_match, true);
    assert.equal(report.comparison.payload_hash_match, true);
    assert.equal(report.comparison.mismatch_count, 0);
    assert.match(report.report_hash, /^sha256:[a-f0-9]{64}$/);
  });

  it("accepts FLAT parity even when technical signal ids differ", () => {
    const report = buildStrategyShadowParityReportV1({
      scenario_id: "flat-no-entry-fixture",
      strategy_version_id: versionId,
      dataset_id: datasetId,
      simulation_signal: signalFixture({ signal_id: signalId("01"), direction: "FLAT" }),
      shadow_signal: signalFixture({ signal_id: signalId("02"), direction: "FLAT" }),
    });

    assert.equal(report.status, "PARITY_OK");
    assert.equal(report.comparison.semantic_hash_match, true);
    assert.equal(report.comparison.payload_hash_match, false);
    assert.equal(report.comparison.field_diffs.length, 0);
  });

  it("reports deterministic mismatches when SHADOW diverges from Simulation", () => {
    const report = buildStrategyShadowParityReportV1({
      scenario_id: "direction-divergence-fixture",
      strategy_version_id: versionId,
      dataset_id: datasetId,
      simulation_signal: signalFixture({ direction: "LONG" }),
      shadow_signal: signalFixture({ direction: "SHORT" }),
    });

    assert.equal(report.status, "PARITY_MISMATCH");
    assert.equal(report.ok, false);
    assert.equal(report.comparison.semantic_hash_match, false);
    assert.deepEqual(report.comparison.field_diffs.map((item) => item.field), ["direction"]);
  });

  it("proves expiration no-op parity without requiring a live signal", () => {
    const report = buildStrategyShadowParityReportV1({
      scenario_id: "expired-setup-noop-fixture",
      strategy_version_id: versionId,
      dataset_id: datasetId,
      simulation_output: noopFixture("EXPIRED_SETUP_WINDOW"),
      shadow_output: noopFixture("EXPIRED_SETUP_WINDOW"),
    });

    assert.equal(report.status, "PARITY_OK");
    assert.equal(report.simulation.kind, "NO_OP");
    assert.equal(report.shadow.kind, "NO_OP");
    assert.equal(report.comparison.semantic_hash_match, true);
  });

  it("rejects incomplete parity evidence before reporting success", () => {
    const report = buildStrategyShadowParityReportV1({
      scenario_id: "invalid-shadow-fixture",
      simulation_signal: signalFixture(),
      shadow_signal: signalFixture({ expires_at_utc: "2026-08-09T08:00:00.000Z" }),
    });

    assert.equal(report.status, "PARITY_INVALID");
    assert.equal(report.ok, false);
    assert.ok(report.issues.some((item) => item.code === "STRATEGY_SIGNAL_EXPIRY_NOT_AFTER_GENERATION"));
  });
});

const strategyInstanceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const versionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const datasetId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function signalFixture(overrides = {}) {
  return {
    signal_id: signalId("00"),
    strategy_instance_id: strategyInstanceId,
    strategy_version_id: versionId,
    instrument: "MNQ",
    direction: "LONG",
    confidence: 0.72,
    execution_mode_origin: "SHADOW",
    generated_at_utc: "2026-08-09T08:00:00.000Z",
    expires_at_utc: "2026-08-09T08:15:00.000Z",
    correlation_id: "corr-20260809-shadow-parity-mnq",
    payload: {
      dataset_id: datasetId,
      feature_snapshot_hash: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
    ...overrides,
  };
}

function noopFixture(reason) {
  return {
    kind: "NO_OP",
    reason,
    strategy_version_id: versionId,
  };
}

function signalId(suffix) {
  return `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa${suffix}`;
}
