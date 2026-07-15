import assert from "node:assert/strict";
import test from "node:test";
import {
  DeskIntegrityError,
  analyzeDatasetBytes,
  buildDatasetManifestEntry,
  buildSourceManifest,
  crc32cBase64,
  filterNewsAtCutoff,
  immutableDatasetObjectName,
  sanitizeMacroActualsAtCutoff,
  validateDatasetObject,
} from "../src/pack-integrity.js";

const csv = [
  "asset,timeframe,timestamp_utc,timestamp_paris,open,high,low,close",
  "NQ,15,2026-07-08T21:45:00.000Z,2026-07-08T23:45:00.000+02:00,100,102,99,101",
  "NQ,15,2026-07-08T22:00:00.000Z,2026-07-09T00:00:00.000+02:00,101,103,100,102",
  "",
].join("\n");

test("builds different immutable paths for Asia and NY on the same date", () => {
  const asia = immutableDatasetObjectName({
    packId: "2026-07-09_asia_open",
    packBuildId: "packbuild__asia__1",
    dataset: "NQ_M15",
  });
  const ny = immutableDatasetObjectName({
    packId: "2026-07-09_ny_open",
    packBuildId: "packbuild__ny__1",
    dataset: "NQ_M15",
  });
  assert.notEqual(asia, ny);
  assert.match(asia, /packs\/2026-07-09_asia_open\/builds\/packbuild__asia__1\/raw\/NQ_M15\.csv$/);
});

test("computes SHA-256, CRC32C, size, rows and cutoff bounds", () => {
  assert.equal(crc32cBase64("123456789"), "4waSgw==");
  const result = analyzeDatasetBytes({
    buffer: csv,
    dataset: "NQ_M15",
    format: "csv",
    cutoffUtc: "2026-07-08T22:05:00Z",
  });
  assert.equal(result.row_count, 2);
  assert.equal(result.max_timestamp_utc, "2026-07-08T22:00:00.000Z");
  assert.equal(result.sha256.length, 64);
});

test("rejects lookahead and UTC-labelled Paris timestamps", () => {
  const future = csv.replace("2026-07-08T22:00:00.000Z", "2026-07-09T13:30:00.000Z")
    .replace("2026-07-09T00:00:00.000+02:00", "2026-07-09T15:30:00.000+02:00");
  assert.throws(
    () => analyzeDatasetBytes({ buffer: future, dataset: "NQ_M15", format: "csv", cutoffUtc: "2026-07-08T22:05:00Z" }),
    (error) => error instanceof DeskIntegrityError && error.code === "LOOKAHEAD_DETECTED",
  );
  const badTimezone = csv.replace("2026-07-09T00:00:00.000+02:00", "2026-07-08T22:00:00.000+00:00");
  assert.throws(
    () => analyzeDatasetBytes({ buffer: badTimezone, dataset: "NQ_M15", format: "csv", cutoffUtc: "2026-07-08T22:05:00Z" }),
    (error) => error.code === "TIMEZONE_INVALID",
  );
});

test("validates bytes against the pinned generation and manifest", () => {
  const ref = buildDatasetManifestEntry({
    packId: "2026-07-09_asia_open",
    packBuildId: "packbuild__asia__fixture",
    strategyId: "asia_open",
    session: "asia_open",
    dataset: "NQ_M15",
    cutoffUtc: "2026-07-08T22:05:00Z",
    objectPath: "gs://fixture/desk-data/packs/2026-07-09_asia_open/builds/packbuild__asia__fixture/raw/NQ_M15.csv",
    generation: "101",
    source: "fixture",
    buffer: csv,
    format: "csv",
  });
  const valid = validateDatasetObject({
    ref,
    buffer: csv,
    metadata: { generation: "101" },
    dataset: "NQ_M15",
    cutoffUtc: ref.cutoff_utc,
    asOfUtc: ref.cutoff_utc,
  });
  assert.equal(valid.valid, true);
  assert.throws(
    () => validateDatasetObject({ ...valid, ref, buffer: `${csv} `, metadata: { generation: "101" }, dataset: "NQ_M15" }),
    (error) => error.code === "DATASET_INTEGRITY_MISMATCH",
  );
  assert.throws(
    () => validateDatasetObject({ ref, buffer: csv, metadata: { generation: "102" }, dataset: "NQ_M15" }),
    (error) => error.code === "DATASET_GENERATION_MISMATCH",
  );
});

test("source manifest hash is canonical", () => {
  const first = buildSourceManifest({ packId: "p", packBuildId: "b", scope: { a: 1 }, datasets: { z: {}, a: {} }, createdAtUtc: "2026-07-11T00:00:00Z" });
  const second = buildSourceManifest({ packId: "p", packBuildId: "b", scope: { a: 1 }, datasets: { a: {}, z: {} }, createdAtUtc: "2026-07-11T00:00:00Z" });
  assert.equal(first.source_manifest_hash, second.source_manifest_hash);
});

test("macro actuals and news fail closed at cutoff", () => {
  const macro = sanitizeMacroActualsAtCutoff([
    { event: "known", actual: "1", actual_published_at_utc: "2026-07-09T13:00:00Z" },
    { event: "future", actual: "2", actual_published_at_utc: "2026-07-09T14:00:00Z" },
    { event: "unknown", actual: "3" },
  ], "2026-07-09T13:30:00Z");
  assert.equal(macro[0].actual, "1");
  assert.equal(macro[1].actual, null);
  assert.equal(macro[2].actual, null);
  assert.deepEqual(filterNewsAtCutoff([
    { title: "known", published_at_utc: "2026-07-09T13:00:00Z" },
    { title: "future", published_at_utc: "2026-07-09T14:00:00Z" },
    { title: "unknown" },
  ], "2026-07-09T13:30:00Z").map((item) => item.title), ["known"]);
});
