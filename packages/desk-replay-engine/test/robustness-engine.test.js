import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ROBUSTNESS_ENGINE_VERSION_V1,
  ROBUSTNESS_REPORT_SCHEMA_VERSION_V1,
  bootstrapRSeriesV1,
  buildRobustnessReportArtifactV1,
  buildRobustnessReportV1,
  evaluateRobustnessGateV1,
  monteCarloRSeriesV1,
} from "../index.js";

describe("robustness engine V1", () => {
  it("builds a deterministic robustness report that allows promotion when all gates pass", () => {
    const input = passingInput();
    const first = buildRobustnessReportV1(input);
    const second = buildRobustnessReportV1(input);

    assert.deepEqual(first, second);
    assert.equal(first.schema_version, ROBUSTNESS_REPORT_SCHEMA_VERSION_V1);
    assert.equal(first.robustness_engine_version, ROBUSTNESS_ENGINE_VERSION_V1);
    assert.equal(first.gate.status, "PASS");
    assert.equal(first.gate.promotion_allowed, true);
    assert.equal(first.tests.walk_forward.pass_rate, 1);
    assert.equal(first.tests.cost_slippage_stress.pass_rate, 1);
    assert.equal(first.tests.bootstrap.sample_count, 8);
    assert.match(first.content_hash, /^sha256:[a-f0-9]{64}$/);
  });

  it("blocks promotion when cost stress and distributions violate policy", () => {
    const report = buildRobustnessReportV1({
      ...passingInput(),
      stress_results: [result({ run_id: "stress_bad", total_r: -3, max_drawdown_r: -6, profit_factor: 0.5, r: [-1, -1, -1] })],
      bootstrap_samples: [
        { sample_id: "bad_1", total_r: -2, max_drawdown_r: -2, trade_count: 4 },
        { sample_id: "bad_2", total_r: -1, max_drawdown_r: -1, trade_count: 4 },
      ],
    });

    assert.equal(report.tests.cost_slippage_stress.status, "FAIL");
    assert.equal(report.tests.bootstrap.status, "FAIL");
    assert.equal(report.gate.status, "FAIL");
    assert.equal(report.gate.promotion_allowed, false);
    assert.ok(report.gate.reasons.includes("COST_SLIPPAGE_STRESS_FAILED"));
  });

  it("produces attachable robustness artifacts for strategy candidates", () => {
    const report = buildRobustnessReportV1(passingInput());
    const artifact = buildRobustnessReportArtifactV1(report, { created_at_utc: "2026-08-09T10:00:00.000Z" });

    assert.equal(artifact.artifact_kind, "ROBUSTNESS_REPORT");
    assert.equal(artifact.strategy_version_id, "strategy_candidate_v1");
    assert.equal(artifact.content_hash, report.content_hash);
    assert.match(artifact.storage_ref, /^artifact:\/\/strategy-versions\/strategy_candidate_v1\/robustness\/sha256:/);
  });

  it("generates reproducible bootstrap and monte-carlo samples from R series", () => {
    const bootstrap = bootstrapRSeriesV1([2, -1, 0.5, 1], { sample_count: 4, seed: "same-seed" });
    const monteCarlo = monteCarloRSeriesV1([2, -1, 0.5, 1], { sample_count: 4, seed: "same-seed" });

    assert.deepEqual(bootstrap, bootstrapRSeriesV1([2, -1, 0.5, 1], { sample_count: 4, seed: "same-seed" }));
    assert.deepEqual(monteCarlo, monteCarloRSeriesV1([2, -1, 0.5, 1], { sample_count: 4, seed: "same-seed" }));
    assert.equal(bootstrap.length, 4);
    assert.equal(monteCarlo.length, 4);
  });

  it("marks missing robustness evidence as review and prevents promotion", () => {
    const gate = evaluateRobustnessGateV1({
      baseline: { run_id: "baseline", total_r: 2, trade_count: 1, max_drawdown_r: -1 },
      tests: {
        baseline_acceptance: { status: "PASS", reasons: [] },
        walk_forward: { status: "REVIEW", reasons: ["WALK_FORWARD_SAMPLES_REQUIRED"] },
      },
    });

    assert.equal(gate.status, "REVIEW");
    assert.equal(gate.promotion_allowed, false);
  });
});

function passingInput() {
  return {
    strategy_version_id: "strategy_candidate_v1",
    checked_at_utc: "2026-08-09T10:00:00.000Z",
    baseline_result: result({ run_id: "baseline", total_r: 4, r: [2, -0.5, 1.5, 1] }),
    walk_forward_results: [
      result({ run_id: "wf_1", total_r: 2.5, r: [1, -0.5, 2] }),
      result({ run_id: "wf_2", total_r: 1.5, r: [0.5, 1] }),
    ],
    stress_results: [result({ run_id: "stress_1", total_r: 3, r: [1.5, -0.5, 2] })],
    parameter_perturbation_results: [
      result({ run_id: "param_1", total_r: 3.5, r: [2, -0.5, 2] }),
      result({ run_id: "param_2", total_r: 2.5, r: [1, 1.5] }),
    ],
    policy: { bootstrap_sample_count: 8, monte_carlo_sample_count: 8, min_monte_carlo_p05_total_r: -1 },
    compute_observability: { duration_ms: 1200, estimated_cost_usd: 0.04, compute_worker_runs: 4 },
  };
}

function result(overrides = {}) {
  const r = overrides.r || [2, -1, 1];
  return {
    schema_version: "canonical_simulation_result_v1",
    simulation_engine: "desk-replay-engine",
    simulation_engine_version: "1.0.0",
    run_id: overrides.run_id || "run_fixture",
    strategy_version_id: "strategy_candidate_v1",
    dataset_id: "dataset_june_2026",
    dataset_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    parameters_hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    status: "COMPLETED",
    metrics: {
      trade_count: r.length,
      total_r: overrides.total_r ?? r.reduce((total, value) => total + value, 0),
      profit_factor: overrides.profit_factor ?? 3,
      max_drawdown_r: overrides.max_drawdown_r ?? -1,
      expectancy_r: 1,
      win_rate: 0.75,
    },
    positions: r.map((value, index) => ({ position_id: `p${index}`, status: "CLOSED", r_result: value })),
    metrics_hash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    content_hash: `sha256:${String(overrides.run_id || "run_fixture").padEnd(64, "d").slice(0, 64)}`,
    ...overrides,
  };
}
