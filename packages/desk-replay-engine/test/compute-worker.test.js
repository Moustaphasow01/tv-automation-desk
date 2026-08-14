import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const workerPath = fileURLToPath(new URL("../src/compute_worker.py", import.meta.url));
const pythonAvailable = spawnSync("python3", ["--version"], { encoding: "utf8" }).status === 0;

describe("contractual Python compute worker", () => {
  it("delegates canonical simulation to Node and returns run artifacts", { skip: pythonAvailable ? false : "python3 unavailable" }, () => {
    const result = runWorker(simulationJob());

    assert.equal(result.status, "COMPLETED");
    assert.equal(result.schema_version, "simulation_compute_result_v1");
    assert.equal(result.task_type, "CANONICAL_SIMULATION");
    assert.match(result.job_hash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(result.result.metrics.total_r, 2.3333);
    assert.equal(result.result.metrics.metric_version, "2.0.0");
    assert.match(result.simulation_run_id, /^[a-f0-9-]{36}$/);
    assert.equal(result.artifacts.some((artifact) => artifact.artifact_kind === "METRICS"), true);
    assert.equal(result.artifacts.some((artifact) => artifact.artifact_kind === "ORDER_SIMULATION_POLICY"), true);
    assert.equal(result.observability.artifact_count, result.artifacts.length);
  });

  it("resumes idempotent output files without recomputing divergent jobs", { skip: pythonAvailable ? false : "python3 unavailable" }, async () => {
    const root = await mkdtemp(join(tmpdir(), "desk-compute-worker-"));
    try {
      const inputPath = join(root, "job.json");
      const outputPath = join(root, "result.json");
      await writeFile(inputPath, `${JSON.stringify(simulationJob())}\n`, "utf8");

      const first = spawnSync("python3", [workerPath, "--input", inputPath, "--output", outputPath], { encoding: "utf8" });
      const second = spawnSync("python3", [workerPath, "--input", inputPath, "--output", outputPath], { encoding: "utf8" });
      const firstJson = JSON.parse(first.stdout);
      const secondJson = JSON.parse(second.stdout);
      const persisted = JSON.parse(await readFile(outputPath, "utf8"));

      assert.equal(first.status, 0);
      assert.equal(second.status, 0);
      assert.equal(firstJson.resumed, false);
      assert.equal(secondJson.resumed, true);
      assert.equal(firstJson.result_hash, secondJson.result_hash);
      assert.equal(persisted.job_hash, firstJson.job_hash);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid job envelopes before invoking Node", { skip: pythonAvailable ? false : "python3 unavailable" }, () => {
    const process = spawnSync("python3", [workerPath], { input: JSON.stringify({ schema_version: "bad" }), encoding: "utf8" });
    const result = JSON.parse(process.stdout);

    assert.notEqual(process.status, 0);
    assert.equal(result.status, "FAILED");
    assert.equal(result.error.code, "JOB_REQUIRED_FIELDS_MISSING");
  });
});

function runWorker(job) {
  const process = spawnSync("python3", [workerPath], { input: JSON.stringify(job), encoding: "utf8" });
  assert.equal(process.status, 0, process.stderr || process.stdout);
  return JSON.parse(process.stdout);
}

function simulationJob() {
  return {
    schema_version: "simulation_compute_job_v1",
    job_id: "compute_job_2026_06_11_mnq_001",
    idempotency_key: "idem_compute_job_2026_06_11_mnq_001",
    task_type: "CANONICAL_SIMULATION",
    payload: simulationPayload(),
    metadata: { test: "td2-309" },
  };
}

function simulationPayload() {
  const rows = [
    row("2026-06-11T10:01:00+02:00", { open: 100, high: 102, low: 99, close: 101 }),
    row("2026-06-11T10:02:00+02:00", { open: 100, high: 102, low: 99.5, close: 100.5 }),
    row("2026-06-11T10:03:00+02:00", { open: 101, high: 116, low: 101, close: 115 }),
  ];
  return {
    run_id: "compute_worker_sim_fixture",
    strategy_version_id: "3b2f1a90-6e3d-4b8e-9d1a-2f6c8e0a9b11",
    deterministic_execution_plan: {
      valid: true,
      ranked_setups: [{
        compile_status: "COMPILED",
        setup_id: "setup_mnq_long",
        direction: "long",
        instrument: "MNQ",
        rank: 1,
        entry_zone: { lower: 100, upper: 101 },
        stop_loss: 95,
        take_profit_1: 115,
        conditions: [],
        gates: [],
      }],
    },
    dataset: {
      dataset_id: "33333333-3333-4333-8333-333333333333",
      status: "READY",
      sealed: true,
      dataset_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      cutoff_paris: "2026-06-11T10:10:00+02:00",
      rows,
    },
    cutoff_paris: "2026-06-11T10:10:00+02:00",
  };
}

function row(timestamp, { open, high, low, close }) {
  return { timestamp_paris: timestamp, instrument: "MNQ", timeframe: "M1", open, high, low, close, closed: true };
}
