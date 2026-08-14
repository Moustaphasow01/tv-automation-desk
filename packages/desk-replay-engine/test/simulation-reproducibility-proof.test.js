import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSimulationReproducibilityProofV1,
  runCanonicalSimulationV1,
} from "../index.js";

const strategyVersionId = "22222222-2222-4222-8222-222222222222";
const datasetId = "33333333-3333-4333-8333-333333333333";
const hashA = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const hashB = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const hashC = "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const hashD = "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

describe("simulation reproducibility proof V1", () => {
  it("proves bit-for-bit reproducibility for two sealed runs with the same canonical hashes", () => {
    const proof = buildSimulationReproducibilityProofV1({
      baseline: run({ simulation_run_id: "baseline-run" }),
      candidate: run({ simulation_run_id: "candidate-run" }),
      checked_at_utc: "2026-08-09T10:00:00.000Z",
    });

    assert.equal(proof.schema_version, "simulation_reproducibility_proof_v1");
    assert.equal(proof.ok, true);
    assert.deepEqual(proof.reasons, []);
    assert.equal(proof.metrics_hash_match, true);
    assert.equal(proof.result_hash_match, true);
    assert.equal(proof.dataset_hash_match, true);
    assert.equal(proof.engine_version_match, true);
    assert.match(proof.reproducibility_key_hash, /^sha256:[a-f0-9]{64}$/);
  });

  it("rejects non-reproducible candidates with explicit mismatch reasons", () => {
    const proof = buildSimulationReproducibilityProofV1({
      baseline: run({ simulation_run_id: "baseline-run" }),
      candidate: run({
        simulation_run_id: "candidate-run",
        metrics_hash: hashA,
        result_hash: hashB,
        dataset_hash: hashC,
        reproducibility_seed: "other-seed",
      }),
    });

    assert.equal(proof.ok, false);
    assert.ok(proof.reasons.includes("REPRODUCIBILITY_KEY_MISMATCH"));
    assert.ok(proof.reasons.includes("DATASET_HASH_MISMATCH"));
    assert.ok(proof.reasons.includes("METRICS_HASH_MISMATCH"));
    assert.ok(proof.reasons.includes("RESULT_HASH_MISMATCH"));
  });

  it("keeps metrics stable when future rows after cutoff would have hit target", () => {
    const beforeFutureTarget = simulateRows({
      rows: rowsBeforeTarget(),
      cutoff: "2026-06-11T10:03:00+02:00",
    });
    const withFutureTarget = simulateRows({
      rows: [...rowsBeforeTarget(), row("2026-06-11T10:04:00+02:00", { high: 116, low: 101, close: 115 })],
      cutoff: "2026-06-11T10:03:00+02:00",
    });

    assert.equal(beforeFutureTarget.status, "COMPLETED");
    assert.equal(withFutureTarget.status, "COMPLETED");
    assert.equal(beforeFutureTarget.metrics_hash, withFutureTarget.metrics_hash);
    assert.equal(beforeFutureTarget.metrics.total_r, withFutureTarget.metrics.total_r);
    assert.equal(beforeFutureTarget.metrics.open_position_count, 1);
    assert.equal(withFutureTarget.metrics.open_position_count, 1);
    assert.equal(withFutureTarget.data_quality.ignored_post_cutoff_rows, 1);
    assert.equal(withFutureTarget.events.some((event) => event.type === "POSITION_CLOSED"), false);
  });
});

function run(overrides = {}) {
  return {
    simulation_run_id: "baseline-run",
    strategy_version_id: strategyVersionId,
    dataset_id: datasetId,
    parameters_hash: hashB,
    reproducibility_seed: "seed-fixture",
    simulation_engine_version: "1.0.0",
    dataset_hash: hashA,
    metrics_hash: hashC,
    result_hash: hashD,
    ...overrides,
  };
}

function simulateRows({ rows, cutoff }) {
  return runCanonicalSimulationV1({
    run_id: "anti_lookahead_fixture",
    strategy_version_id: strategyVersionId,
    deterministic_execution_plan: deterministicPlan(),
    dataset: {
      dataset_id: "dataset_2026_06_11_mnq_m1",
      status: "READY",
      sealed: true,
      dataset_hash: hashA,
      cutoff_paris: cutoff,
      rows,
    },
    parameters: { pricing_model: "closed_m1_no_intrabar_fill_v1" },
    reproducibility_seed: "seed-td2-303",
    cutoff_paris: cutoff,
    run_started_at_utc: "2026-08-09T10:00:00.000Z",
  });
}

function deterministicPlan() {
  return {
    schema_version: "deterministic_execution_plan_v1_4",
    valid: true,
    ranked_setups: [{
      setup_id: "strategy_setup_mnq_long_100",
      compile_status: "COMPILED",
      status: "ARMED_CONDITIONAL",
      rank: 1,
      direction: "long",
      instrument: "MNQ",
      timeframe: "M1",
      entry_mode: "RETEST_ZONE_AFTER_CONFIRMATION",
      order_type: "LIMIT",
      valid_from_paris: "2026-06-11T10:00:00+02:00",
      expires_at_paris: "2026-06-11T10:30:00+02:00",
      entry_zone: { lower: 100, upper: 101 },
      stop_loss: 95,
      take_profit_1: 115,
      risk_pct: 0.25,
      rr_minimum: 2,
      trigger_policy: { backend_can_trigger: true },
      conditions: [{
        condition_id: "break_retest_sequence",
        predicate_type: "BREAK_RETEST_SEQUENCE",
        required_for_trigger: true,
        operator: "CLOSE_ABOVE",
        break_condition_id: "breakout_above_100",
        break_threshold: 100,
        retest_level: 100,
        tolerance_points: 1,
        max_bars: 12,
        require_rejection_confirmation: false,
      }],
    }],
  };
}

function rowsBeforeTarget() {
  return [
    row("2026-06-11T10:01:00+02:00", { high: 102, low: 99, close: 101 }),
    row("2026-06-11T10:02:00+02:00", { high: 102, low: 99.5, close: 100.5 }),
    row("2026-06-11T10:03:00+02:00", { high: 102, low: 100.5, close: 101 }),
  ];
}

function row(timestamp, { open = 100, high, low, close }) {
  return {
    timestamp_paris: timestamp,
    instrument: "MNQ",
    timeframe: "M1",
    open,
    high,
    low,
    close,
    closed: true,
  };
}
