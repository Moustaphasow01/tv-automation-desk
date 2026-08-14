import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DATASET_TEMPORAL_SPLIT_SCHEMA_VERSION_V1,
  assignRowsToTemporalSplitsV1,
  buildTemporalDatasetSplitManifestV1,
  splitManifestHashV1,
  validateTemporalSplitNoLeakageV1,
} from "../index.js";

describe("dataset temporal split V1", () => {
  it("builds immutable train validation and out-of-sample split manifests", () => {
    const first = buildTemporalDatasetSplitManifestV1(splitInput());
    const second = buildTemporalDatasetSplitManifestV1(splitInput());

    assert.deepEqual(first, second);
    assert.equal(first.schema_version, DATASET_TEMPORAL_SPLIT_SCHEMA_VERSION_V1);
    assert.equal(first.validation.status, "PASS");
    assert.equal(first.coverage.rows_by_role.TRAIN, 2);
    assert.equal(first.coverage.rows_by_role.VALIDATION, 1);
    assert.equal(first.coverage.rows_by_role.OUT_OF_SAMPLE, 1);
    assert.match(first.split_hash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(splitManifestHashV1(first), first.split_hash);
  });

  it("assigns rows by role with start-inclusive end-exclusive boundaries", () => {
    const manifest = buildTemporalDatasetSplitManifestV1(splitInput());
    const assignment = assignRowsToTemporalSplitsV1(rows(), manifest);

    assert.equal(assignment.counts.TRAIN, 2);
    assert.equal(assignment.counts.VALIDATION, 1);
    assert.equal(assignment.counts.OUT_OF_SAMPLE, 1);
    assert.equal(assignment.dropped_row_count, 1);
    assert.equal(assignment.rows_by_role.VALIDATION[0].timestamp_utc, "2026-06-03T00:00:00.000Z");
  });

  it("detects explicit row role leakage and run cutoff leakage", () => {
    const manifest = buildTemporalDatasetSplitManifestV1(splitInput());
    const report = validateTemporalSplitNoLeakageV1({
      manifest,
      rows: [{ timestamp_utc: "2026-06-05T00:00:00.000Z", split_role: "TRAIN" }],
      run_usages: [{
        run_id: "run_train_bad",
        split_role: "TRAIN",
        cutoff_utc: "2026-06-04T00:00:00.000Z",
        source_data_end_utc: "2026-06-04T00:00:00.000Z",
      }],
    });

    assert.equal(report.ok, false);
    assert.equal(report.status, "FAIL");
    assert.ok(report.reasons.includes("ROW_ROLE_TIMESTAMP_LEAKAGE"));
    assert.ok(report.reasons.includes("RUN_CUTOFF_AFTER_SPLIT_END"));
  });

  it("blocks OOS evaluation when candidate selection used OOS data", () => {
    const manifest = buildTemporalDatasetSplitManifestV1(splitInput());
    const report = validateTemporalSplitNoLeakageV1({
      manifest,
      run_usages: [{
        run_id: "run_oos_bad",
        split_role: "OUT_OF_SAMPLE",
        cutoff_utc: "2026-06-06T00:00:00.000Z",
        source_data_end_utc: "2026-06-06T00:00:00.000Z",
        training_cutoff_utc: "2026-06-03T00:00:01.000Z",
        candidate_selection_cutoff_utc: "2026-06-06T00:00:00.000Z",
      }],
    });

    assert.equal(report.status, "FAIL");
    assert.ok(report.reasons.includes("TRAINING_CUTOFF_USES_VALIDATION_OR_OOS"));
    assert.ok(report.reasons.includes("OOS_USES_POST_VALIDATION_SELECTION"));
  });
});

function splitInput() {
  return {
    dataset_temporal_split_id: "split_june_fixture",
    split_key: "june_2026_train_validation_oos",
    dataset_id: "dataset_june_2026",
    dataset_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    created_at_utc: "2026-08-09T10:00:00.000Z",
    splits: [
      { role: "TRAIN", start_utc: "2026-06-01T00:00:00.000Z", end_utc: "2026-06-03T00:00:00.000Z" },
      { role: "VALIDATION", start_utc: "2026-06-03T00:00:00.000Z", end_utc: "2026-06-05T00:00:00.000Z" },
      { role: "OUT_OF_SAMPLE", start_utc: "2026-06-05T00:00:00.000Z", end_utc: "2026-06-07T00:00:00.000Z" },
    ],
    rows: rows(),
  };
}

function rows() {
  return [
    { timestamp_utc: "2026-06-01T00:00:00.000Z", close: 100 },
    { timestamp_utc: "2026-06-02T23:59:00.000Z", close: 101 },
    { timestamp_utc: "2026-06-03T00:00:00.000Z", close: 102 },
    { timestamp_utc: "2026-06-05T00:00:00.000Z", close: 103 },
    { timestamp_utc: "2026-06-07T00:00:00.000Z", close: 104 },
  ];
}
