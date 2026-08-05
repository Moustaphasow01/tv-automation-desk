import assert from "node:assert/strict";
import test from "node:test";

import { FixedClock } from "@tv-automation/desk-time";
import {
  V5_REPLAY_CANONICAL_DATASET_IDS,
  V5_REPLAY_CANONICAL_M5_MODE,
  V5_REPLAY_CANONICAL_RESAMPLER_VERSION,
  V5_REPLAY_DATA_PROFILE_ID,
  V5_REPLAY_DATA_PROFILE_VERSION,
} from "../src/v5-replay-data-profile.js";
import { createTestDeskStore } from "./support/test-desk-store.js";

function readyPack(pack = {}) {
  const coverage = Object.fromEntries(V5_REPLAY_CANONICAL_DATASET_IDS.map((dataset) => [dataset, {
    dataset,
    complete: true,
    blocking: false,
    status: "complete",
  }]));
  return {
    ...pack,
    data_profile_id: V5_REPLAY_DATA_PROFILE_ID,
    data_profile_version: V5_REPLAY_DATA_PROFILE_VERSION,
    canonical_m5_mode: V5_REPLAY_CANONICAL_M5_MODE,
    canonical_resampler_version: V5_REPLAY_CANONICAL_RESAMPLER_VERSION,
    canonical_coverage_complete: true,
    requested_coverage: { profile_id: V5_REPLAY_DATA_PROFILE_ID },
    actual_coverage: {
      profile_id: V5_REPLAY_DATA_PROFILE_ID,
      profile_version: V5_REPLAY_DATA_PROFILE_VERSION,
      canonical_coverage_complete: true,
      required_missing: [],
      required_incomplete: [],
      datasets: coverage,
    },
    datasets: {
      MNQ_M1: { row_count: 1, ...(pack.datasets?.MNQ_M1 || {}) },
      MES_M1: { row_count: 1, ...(pack.datasets?.MES_M1 || {}) },
      MNQ_M5: {
        row_count: 1,
        source: "canonical_derived_m1",
        source_dataset: "MNQ_M1",
        derivation_version: V5_REPLAY_CANONICAL_RESAMPLER_VERSION,
      },
      MES_M5: {
        row_count: 1,
        source: "canonical_derived_m1",
        source_dataset: "MES_M1",
        derivation_version: V5_REPLAY_CANONICAL_RESAMPLER_VERSION,
      },
    },
  };
}

test("Replay preparation rebuilds and publishes only a pack sealed to requested source evidence", async () => {
  const clock = new FixedClock(Date.parse("2026-07-26T12:00:00.000Z"));
  const { store } = createTestDeskStore({ clock });
  const sourceEvidence = {
    schema_version: "test_source_evidence_v1",
    evidence_sha256: "evidence-sha",
    import_id: "import-r2",
    manifest_sha256: "manifest-r2",
    capture_proof_sha256: "proof-r2",
    capture_policy_version: "settled_closed_bar_v2",
    files: [
      { dataset: "MNQ_M1", sha256: "mnq-r2" },
      { dataset: "MES_M1", sha256: "mes-r2" },
    ],
  };
  const packBase = {
    pack_id: "2026-07-24_full_day_replay_source",
    pack_purpose: "replay_source",
    mode: "replay",
    status: "ready",
    execution_allowed: true,
    trading_date: "2026-07-24",
    session: "asia_open",
    source_manifest_hash: "sealed-manifest",
    source_coverage: {
      start_utc: "2026-07-20T00:00:00.000Z",
      end_utc: "2026-07-24T20:00:00.000Z",
    },
  };
  const stalePack = readyPack({
    ...packBase,
    pack_build_id: "stale-build",
  });
  const sealedPack = readyPack({
    ...packBase,
    pack_build_id: "sealed-build",
    source_evidence: structuredClone(sourceEvidence),
    resolved_scope: { source_evidence: structuredClone(sourceEvidence) },
    datasets: {
      MNQ_M1: {
        source_import_id: sourceEvidence.import_id,
        source_import_manifest_sha256: sourceEvidence.manifest_sha256,
        source_capture_proof_sha256: sourceEvidence.capture_proof_sha256,
        source_capture_policy_version: sourceEvidence.capture_policy_version,
        source_file_sha256: "mnq-r2",
      },
      MES_M1: {
        source_import_id: sourceEvidence.import_id,
        source_import_manifest_sha256: sourceEvidence.manifest_sha256,
        source_capture_proof_sha256: sourceEvidence.capture_proof_sha256,
        source_capture_policy_version: sourceEvidence.capture_policy_version,
        source_file_sha256: "mes-r2",
      },
    },
  });
  let buildInput = null;
  let configInput = null;
  store.getDeskPack = async ({ pack_build_id }) => (pack_build_id ? sealedPack : stalePack);
  store.buildAndPublishReplaySourcePack = async (input) => {
    buildInput = input;
    return sealedPack;
  };
  store.upsertReplayAutopilotConfig = async (input) => {
    configInput = input;
    return { ok: true, status: "CONFIG_SAVED", config: input };
  };

  const created = await store.createReplayPreparation({
    trading_date: "2026-07-24",
    cadence: "5m",
    idempotency_key: "sealed-r2-preparation",
    source_evidence: sourceEvidence,
  });
  assert.deepEqual(created.jobs[0].source_evidence, sourceEvidence);

  const processed = await store.processNextReplayPreparation();
  assert.equal(processed.status, "AWAITING_CONFIRMATION", JSON.stringify(processed.job.error));
  assert.equal(processed.job.pack_reused, false);
  assert.equal(processed.job.pack_build_id, "sealed-build");
  assert.deepEqual(buildInput.source_evidence, sourceEvidence);
  assert.deepEqual(processed.job.source_evidence, sourceEvidence);

  const published = await store.replayPreparation.action({
    preparation_id: processed.job.preparation_id,
    action: "publish",
    actor: { kind: "operator" },
  });
  assert.equal(published.status, "QUEUED_FOR_GPT");
  assert.deepEqual(configInput.source_evidence, sourceEvidence);
});

test("Source evidence contributes to replay preparation idempotency", async () => {
  const clock = new FixedClock(Date.parse("2026-07-26T12:00:00.000Z"));
  const { store } = createTestDeskStore({ clock });
  const common = {
    trading_date: "2026-07-24",
    cadence: "5m",
    idempotency_key: "same-operator-request",
  };
  const withoutEvidence = await store.createReplayPreparation(common);
  const withEvidence = await store.createReplayPreparation({
    ...common,
    source_evidence: {
      evidence_sha256: "sealed",
      files: [],
    },
  });
  assert.notEqual(
    withoutEvidence.jobs[0].preparation_id,
    withEvidence.jobs[0].preparation_id,
  );
});
