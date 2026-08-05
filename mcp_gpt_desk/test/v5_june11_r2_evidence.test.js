import assert from "node:assert/strict";
import test from "node:test";

import {
  assertV5June11R2PackEvidence,
  V5_JUNE11_R2_IMPORT_EVIDENCE,
  verifyV5June11R2Import,
} from "../src/v5-june11-r2-evidence.js";

function validReceipt(expected = V5_JUNE11_R2_IMPORT_EVIDENCE) {
  return {
    import_id: expected.import_id,
    source_project: expected.source_project,
    source_kind: expected.source_kind,
    mode: expected.mode,
    status: "completed",
    options: {
      manifest_sha256: expected.manifest_sha256,
      manifest_schema_version: expected.manifest_schema_version,
      capture_proof_sha256: expected.capture_proof_sha256,
      capture_policy_version: expected.capture_policy_version,
      minimum_settlement_lag_seconds: expected.minimum_settlement_lag_seconds,
      window: {
        start_paris: expected.window.start_paris,
        end_paris: expected.window.end_paris,
        semantics: expected.window.semantics,
      },
      symbols: expected.files.map((file) => file.symbol),
    },
    report: {
      import_id: expected.import_id,
      manifest: {
        sha256: expected.manifest_sha256,
        schema_version: expected.manifest_schema_version,
      },
      capture_proof: {
        sha256: expected.capture_proof_sha256,
        row_count: expected.capture_proof_row_count,
        policy_version: expected.capture_policy_version,
        minimum_settlement_lag_seconds: expected.minimum_settlement_lag_seconds,
        premature_capture_count: expected.premature_capture_count,
      },
      scope: {
        source: expected.source,
        environment: expected.environment,
        timezone: expected.timezone,
        timeframe: expected.timeframe,
        symbols: expected.files.map((file) => file.symbol),
        window: {
          start_paris: expected.window.start_paris,
          end_paris: expected.window.end_paris,
          semantics: expected.window.semantics,
        },
      },
      files: expected.files.map((file) => ({
        file: file.file,
        symbol: file.symbol,
        sha256: file.sha256,
        row_count: file.row_count,
      })),
      rows: {
        staged: expected.total_m1_rows,
        inserted: expected.total_m1_rows,
        identical_noop: 0,
        conflicts: 0,
        overwritten: 0,
      },
      validation_summary: {
        conflicts: 0,
        m5_compared: expected.expected_complete_m5_buckets,
        m5_mismatch: 0,
      },
      cross_timeframe: {
        expected_complete_buckets: expected.expected_complete_m5_buckets,
        complete_buckets: expected.expected_complete_m5_buckets,
        compared_buckets: expected.expected_complete_m5_buckets,
        missing_m5_buckets: 0,
        exact_match_buckets: expected.expected_complete_m5_buckets,
        mismatched_buckets: 0,
        divergent_buckets: 0,
      },
    },
  };
}

function validCoverage(expected = V5_JUNE11_R2_IMPORT_EVIDENCE) {
  return expected.files.map((file) => ({
    feed_id: file.feed_id,
    symbol_code: file.symbol,
    row_count: file.row_count,
    unique_timestamp_count: file.row_count,
    min_timestamp_utc: new Date(expected.window.start_utc),
    max_timestamp_utc: new Date(Date.parse(expected.window.end_utc) - 60_000),
    unclosed_count: 0,
    source_collection_mismatch_count: 0,
    source_kind_mismatch_count: 0,
    import_id_mismatch_count: 0,
    manifest_mismatch_count: 0,
    proof_mismatch_count: 0,
    policy_mismatch_count: 0,
    source_file_sha256s: [file.sha256],
  }));
}

function fakePool({ receipt = validReceipt(), coverage = validCoverage() } = {}) {
  let call = 0;
  return {
    async query() {
      call += 1;
      return { rows: call === 1 ? (receipt ? [receipt] : []) : coverage };
    },
  };
}

function validPack(expected = V5_JUNE11_R2_IMPORT_EVIDENCE) {
  return {
    source_evidence: structuredClone(expected),
    resolved_scope: { source_evidence: structuredClone(expected) },
    actual_coverage: {
      datasets: Object.fromEntries(expected.files.map((file) => [file.dataset, { complete: true }])),
    },
    datasets: Object.fromEntries(expected.files.map((file) => [file.dataset, {
      source_import_id: expected.import_id,
      source_import_manifest_sha256: expected.manifest_sha256,
      source_capture_proof_sha256: expected.capture_proof_sha256,
      source_capture_policy_version: expected.capture_policy_version,
      source_file_sha256: file.sha256,
    }])),
  };
}

test("June 11 r2 evidence accepts only the exact completed receipt and canonical M1 lineage", async () => {
  const evidence = await verifyV5June11R2Import(fakePool());
  assert.deepEqual(evidence, V5_JUNE11_R2_IMPORT_EVIDENCE);
  assert.notEqual(evidence, V5_JUNE11_R2_IMPORT_EVIDENCE);
});

test("June 11 r2 evidence fails closed when the import receipt is absent", async () => {
  await assert.rejects(
    verifyV5June11R2Import(fakePool({ receipt: null })),
    (error) => error.code === "V5_JUNE11_R2_IMPORT_REQUIRED",
  );
});

test("June 11 r2 evidence rejects receipt proof or manifest drift", async () => {
  const receipt = validReceipt();
  receipt.options.capture_proof_sha256 = "0".repeat(64);
  await assert.rejects(
    verifyV5June11R2Import(fakePool({ receipt })),
    (error) => error.code === "V5_JUNE11_R2_IMPORT_RECEIPT_MISMATCH",
  );
});

test("June 11 r2 evidence rejects incomplete or foreign canonical M1 rows", async () => {
  const coverage = validCoverage();
  coverage[0].row_count -= 1;
  coverage[0].manifest_mismatch_count = 1;
  await assert.rejects(
    verifyV5June11R2Import(fakePool({ coverage })),
    (error) => error.code === "V5_JUNE11_R2_M1_COVERAGE_MISMATCH",
  );
});

test("June 11 r2 pack evidence is sealed at pack, scope, dataset and coverage levels", () => {
  const pack = validPack();
  assert.equal(assertV5June11R2PackEvidence(pack), true);

  const drifted = validPack();
  drifted.datasets.MNQ_M1.source_file_sha256 = "f".repeat(64);
  assert.throws(
    () => assertV5June11R2PackEvidence(drifted),
    (error) => error.code === "V5_JUNE11_R2_PACK_EVIDENCE_MISMATCH",
  );
});
