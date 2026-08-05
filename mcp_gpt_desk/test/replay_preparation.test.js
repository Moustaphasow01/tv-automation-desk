import assert from "node:assert/strict";
import test from "node:test";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { FixedClock } from "@tv-automation/desk-time";
import { handleFrontOperations } from "../src/front-operations-api.js";
import { resumeV5FrozenPreparationAfterRepair } from "../src/v5-frozen-replay-preparation.js";
import {
  V5_REPLAY_CANONICAL_DATASET_IDS,
  V5_REPLAY_CANONICAL_M5_MODE,
  V5_REPLAY_CANONICAL_RESAMPLER_VERSION,
  V5_REPLAY_DATA_PROFILE_ID,
  V5_REPLAY_DATA_PROFILE_VERSION,
} from "../src/v5-replay-data-profile.js";
import { createTestDeskStore } from "./support/test-desk-store.js";

function v5ReadyPack(pack = {}) {
  const datasetCoverage = Object.fromEntries(V5_REPLAY_CANONICAL_DATASET_IDS.map((dataset) => [dataset, {
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
    requested_coverage: pack.requested_coverage || { profile_id: V5_REPLAY_DATA_PROFILE_ID },
    actual_coverage: {
      profile_id: V5_REPLAY_DATA_PROFILE_ID,
      profile_version: V5_REPLAY_DATA_PROFILE_VERSION,
      canonical_coverage_complete: true,
      required_missing: [],
      required_incomplete: [],
      datasets: datasetCoverage,
    },
    datasets: {
      MNQ_M1: { row_count: 1, ...(pack.datasets?.MNQ_M1 || {}) },
      MES_M1: { row_count: 1, ...(pack.datasets?.MES_M1 || {}) },
      MNQ_M5: {
        row_count: 1,
        source: "canonical_derived_m1",
        source_dataset: "MNQ_M1",
        derivation_version: V5_REPLAY_CANONICAL_RESAMPLER_VERSION,
        source_feed_ids: ["prod__tradingview__MNQ1!__1"],
        ...(pack.datasets?.MNQ_M5 || {}),
      },
      MES_M5: {
        row_count: 1,
        source: "canonical_derived_m1",
        source_dataset: "MES_M1",
        derivation_version: V5_REPLAY_CANONICAL_RESAMPLER_VERSION,
        source_feed_ids: ["prod__tradingview__MES1!__1"],
        ...(pack.datasets?.MES_M5 || {}),
      },
      ...Object.fromEntries(Object.entries(pack.datasets || {}).filter(([dataset]) => (
        !["MNQ_M1", "MES_M1", "MNQ_M5", "MES_M5"].includes(dataset)
      ))),
    },
  };
}

test("Replay preparation builds, validates and publishes a config without manual IDs", async () => {
  const clock = new FixedClock(Date.parse("2026-07-26T12:00:00.000Z"));
  const { store } = createTestDeskStore({ clock });
  const packs = new Map();
  let configInput = null;
  store.getDeskPack = async ({ pack_id }) => {
    const pack = packs.get(pack_id);
    if (!pack) throw new Error("pack_not_found");
    return pack;
  };
  store.buildAndPublishReplaySourcePack = async ({ date, session, cutoff_paris, pack_id }) => {
    const pack = v5ReadyPack({
      pack_id,
      pack_build_id: `packbuild__${date}__${session}`,
      pack_purpose: "replay_source",
      mode: "replay",
      status: "ready",
      execution_allowed: true,
      trading_date: date,
      session,
      cutoff_utc: new Date(cutoff_paris).toISOString(),
      source_manifest_hash: "manifest-hash",
      source_coverage: {
        start_utc: new Date(Date.parse(cutoff_paris) - 5 * 24 * 60 * 60 * 1000).toISOString(),
        end_utc: new Date(cutoff_paris).toISOString(),
      },
      datasets: {
        MNQ_M1: { row_count: 1 },
        MES_M1: { row_count: 1 },
      },
      quality: { status: "ready" },
    });
    packs.set(pack_id, pack);
    return pack;
  };
  store.upsertReplayAutopilotConfig = async (args) => {
    configInput = args;
    return {
      ok: true,
      status: "CONFIG_SAVED",
      config: {
        ...args,
        config_id: `replay_autopilot__${args.trading_date.replaceAll("-", "_")}__${args.session}`,
        backtest_id: `replay_${args.trading_date}_${args.session}_${args.cadence}_autopilot`,
      },
    };
  };

  const created = await handleFrontOperations(store, {
    pathname: "/api/v1/replay-preparations",
    method: "POST",
    body: {
      trading_date: "2026-07-24",
      worker_group: "replay-v4",
      idempotency_key: "front-replay-2026-07-24-asia",
    },
  });
  assert.equal(created.status, "PREPARATION_QUEUED");
  assert.equal(created.jobs[0].pack_id, null);
  assert.equal(created.jobs[0].start_time, "2026-07-24T00:15:00+02:00");
  assert.equal(created.jobs[0].end_time, "2026-07-24T22:00:00+02:00");
  assert.equal(created.jobs[0].run_scope, "full_day");
  assert.equal(created.jobs[0].run_number, 1);
  assert.equal(created.jobs[0].cadence, "15m");

  const processed = await store.processNextReplayPreparation();
  assert.equal(processed.status, "AWAITING_CONFIRMATION");
  assert.equal(processed.job.pack_reused, false);
  assert.equal(processed.job.pack_id, "2026-07-24_full_day_replay_source");
  assert.equal(processed.job.progress_percent, 85);
  assert.equal(processed.job.data_profile_id, V5_REPLAY_DATA_PROFILE_ID);
  assert.equal(processed.job.canonical_coverage_complete, true);
  assert.deepEqual(processed.job.actual_coverage.required_incomplete, []);

  const published = await handleFrontOperations(store, {
    pathname: `/api/v1/replay-preparations/${processed.job.preparation_id}/actions`,
    method: "POST",
    body: { action: "publish" },
    actor: { kind: "operator", email: "desk@example.test" },
  });
  assert.equal(published.status, "QUEUED_FOR_GPT");
  assert.equal(published.job.progress_percent, 100);
  assert.match(published.job.config_id, /^replay_autopilot__/);
  assert.equal(configInput.worker_group, "replay-v4");
  assert.equal(configInput.pack_build_id, "packbuild__2026-07-24__asia_open");
  assert.equal(configInput.start_time, "2026-07-24T00:15:00+02:00");
  assert.equal(configInput.end_time, "2026-07-24T22:00:00+02:00");
  assert.equal(configInput.run_scope, "full_day");
  assert.match(configInput.backtest_id, /^replay_2026-07-24_full_day_15m_/);
});

test("Replay preparation is idempotent and reuses a valid immutable pack", async () => {
  const clock = new FixedClock(Date.parse("2026-07-26T12:00:00.000Z"));
  const { store } = createTestDeskStore({ clock });
  const reusable = v5ReadyPack({
    pack_id: "2026-07-24_full_day_replay_source",
    pack_build_id: "existing-build",
    pack_purpose: "replay_source",
    mode: "replay",
    status: "ready",
    execution_allowed: true,
    trading_date: "2026-07-24",
    session: "asia_open",
    source_manifest_hash: "existing-manifest",
    source_coverage: {
      start_utc: "2026-07-20T00:00:00.000Z",
      end_utc: "2026-07-24T20:00:00.000Z",
    },
  });
  store.getDeskPack = async () => reusable;
  store.buildAndPublishReplaySourcePack = async () => assert.fail("valid pack must be reused");

  const input = {
    trading_date: "2026-07-24",
    cadence: "30m",
    idempotency_key: "front-replay-2026-07-24-ny",
  };
  const first = await store.createReplayPreparation(input);
  const duplicate = await store.createReplayPreparation(input);
  assert.equal(first.jobs[0].preparation_id, duplicate.jobs[0].preparation_id);

  const processed = await store.processNextReplayPreparation();
  assert.equal(processed.status, "AWAITING_CONFIRMATION");
  assert.equal(processed.job.pack_reused, true);
  assert.equal(processed.job.pack_build_id, "existing-build");
});

test("Replay M5 rebuilds a legacy pack without M1 execution datasets", async () => {
  const clock = new FixedClock(Date.parse("2026-07-26T12:00:00.000Z"));
  const { store } = createTestDeskStore({ clock });
  const legacyPack = {
    pack_id: "2026-07-24_full_day_replay_source",
    pack_build_id: "legacy-m15-build",
    pack_purpose: "replay_source",
    mode: "replay",
    status: "ready",
    execution_allowed: true,
    trading_date: "2026-07-24",
    session: "asia_open",
    source_manifest_hash: "legacy-manifest",
    source_coverage: {
      start_utc: "2026-07-20T00:00:00.000Z",
      end_utc: "2026-07-24T20:00:00.000Z",
    },
    datasets: {
      MNQ_M5: { row_count: 1 },
      MES_M5: { row_count: 1 },
    },
  };
  const m1Pack = v5ReadyPack({
    ...legacyPack,
    pack_build_id: "new-m1-build",
    source_manifest_hash: "new-m1-manifest",
    datasets: {
      ...legacyPack.datasets,
      MNQ_M1: { row_count: 1 },
      MES_M1: { row_count: 1 },
    },
  });
  let buildCount = 0;
  store.getDeskPack = async ({ pack_build_id }) => (pack_build_id ? m1Pack : legacyPack);
  store.buildAndPublishReplaySourcePack = async () => {
    buildCount += 1;
    return m1Pack;
  };

  await store.createReplayPreparation({
    trading_date: "2026-07-24",
    cadence: "5m",
    idempotency_key: "m5-requires-m1",
  });
  const processed = await store.processNextReplayPreparation();

  assert.equal(processed.status, "AWAITING_CONFIRMATION");
  assert.equal(processed.job.pack_reused, false);
  assert.equal(processed.job.pack_build_id, "new-m1-build");
  assert.equal(buildCount, 1);
});

test("Replay preparation rejects nominal packs whose V5 canonical coverage is incomplete", async () => {
  const clock = new FixedClock(Date.parse("2026-07-26T12:00:00.000Z"));
  const { store } = createTestDeskStore({ clock });
  const incompletePack = {
    ...v5ReadyPack({
      pack_id: "2026-07-24_full_day_replay_source",
      pack_build_id: "incomplete-build",
      pack_purpose: "replay_source",
      mode: "replay",
      status: "ready",
      execution_allowed: true,
      trading_date: "2026-07-24",
      session: "asia_open",
      source_manifest_hash: "incomplete-manifest",
      source_coverage: {
        start_utc: "2026-07-20T00:00:00.000Z",
        end_utc: "2026-07-24T20:00:00.000Z",
      },
    }),
    canonical_coverage_complete: false,
    actual_coverage: {
      profile_id: V5_REPLAY_DATA_PROFILE_ID,
      profile_version: V5_REPLAY_DATA_PROFILE_VERSION,
      canonical_coverage_complete: false,
      required_missing: [],
      required_incomplete: ["MNQ_M1"],
      datasets: {
        MNQ_M1: { complete: false, blocking: true, status: "partial" },
      },
    },
  };
  store.getDeskPack = async () => incompletePack;
  store.buildAndPublishReplaySourcePack = async () => incompletePack;

  await store.createReplayPreparation({
    trading_date: "2026-07-24",
    cadence: "5m",
    idempotency_key: "v5-incomplete-pack",
  });
  const processed = await store.processNextReplayPreparation();

  assert.equal(processed.status, "FAILED");
  assert.equal(processed.job.error.code, "REPLAY_PREPARATION_PACK_COVERAGE_INCOMPLETE");
  assert.equal(processed.job.error.details.canonical_coverage_complete, false);
});

test("Replay preparation creates distinct same-day executions and only the first is aggregate primary", async () => {
  const clock = new FixedClock(Date.parse("2026-07-26T12:00:00.000Z"));
  const { store } = createTestDeskStore({ clock });
  const first = await store.createReplayPreparation({
    trading_date: "2026-07-24",
    cadence: "15m",
    idempotency_key: "same-day-execution-one",
  });
  const second = await store.createReplayPreparation({
    trading_date: "2026-07-24",
    cadence: "15m",
    idempotency_key: "same-day-execution-two",
  });
  assert.notEqual(first.jobs[0].execution_id, second.jobs[0].execution_id);
  assert.notEqual(first.jobs[0].backtest_id, second.jobs[0].backtest_id);
  assert.equal(first.jobs[0].run_number, 1);
  assert.equal(first.jobs[0].aggregate_role, "primary");
  assert.equal(second.jobs[0].run_number, 2);
  assert.equal(second.jobs[0].aggregate_role, "comparison");
  assert.equal(second.jobs[0].aggregate_eligible, false);
});

test("Replay preparation recovers an expired build lease after a worker crash", async () => {
  const clock = new FixedClock(Date.parse("2026-07-26T12:00:00.000Z"));
  const { store, persistence } = createTestDeskStore({ clock });
  const created = await store.createReplayPreparation({
    trading_date: "2026-07-24",
    cadence: "15m",
    idempotency_key: "expired-worker-lease",
  });
  const preparationId = created.jobs[0].preparation_id;
  const interrupted = await persistence.getDocument(DESK_COLLECTIONS.deskReplayPreparationJobs, preparationId);
  await persistence.setDocument(DESK_COLLECTIONS.deskReplayPreparationJobs, preparationId, {
    ...interrupted,
    status: "PACK_BUILDING",
    lease_owner: "dead-worker",
    lease_expires_at_utc: "2026-07-26T11:00:00.000Z",
  });
  store.getDeskPack = async () => v5ReadyPack({
    pack_id: "2026-07-24_full_day_replay_source",
    pack_build_id: "recovered-build",
    pack_purpose: "replay_source",
    mode: "replay",
    status: "ready",
    execution_allowed: true,
    trading_date: "2026-07-24",
    session: "asia_open",
    source_manifest_hash: "recovered-manifest",
    source_coverage: {
      start_utc: "2026-07-20T00:00:00.000Z",
      end_utc: "2026-07-24T20:00:00.000Z",
    },
  });

  const result = await store.processNextReplayPreparation({ worker_id: "replacement-worker" });

  assert.equal(result.status, "AWAITING_CONFIRMATION");
  assert.equal(result.job.attempts, 1);
  assert.equal(result.job.lease_owner, null);
  assert.ok(result.job.stages.some((entry) => entry.status === "RECOVERED"));
});


test("V5 frozen preparation resumes the same failed job after local datasets are repaired without starting a run", async () => {
  const clock = new FixedClock(Date.parse("2026-07-26T12:00:00.000Z"));
  const { store, persistence } = createTestDeskStore({ clock });
  let repaired = false;
  let configWrites = 0;
  const repairedPack = v5ReadyPack({
    pack_id: "2026-07-24_full_day_replay_source",
    pack_build_id: "repaired-pack-build",
    pack_purpose: "replay_source",
    mode: "replay",
    status: "ready",
    execution_allowed: true,
    trading_date: "2026-07-24",
    session: "asia_open",
    cutoff_utc: "2026-07-24T20:00:00.000Z",
    source_manifest_hash: "repaired-manifest",
    source_coverage: {
      start_utc: "2026-07-20T00:00:00.000Z",
      end_utc: "2026-07-24T20:00:00.000Z",
    },
    datasets: {
      MNQ_M1: { row_count: 1 },
      MES_M1: { row_count: 1 },
    },
  });
  store.getDeskPack = async () => {
    if (repaired) return repairedPack;
    throw new Error("pack_not_found");
  };
  store.buildAndPublishReplaySourcePack = async () => {
    if (!repaired) {
      throw Object.assign(new Error("Required SQL dataset is empty: MNQ_M1."), {
        code: "LOCAL_PACK_CORE_DATASET_MISSING",
        details: { dataset: "MNQ_M1" },
      });
    }
    return repairedPack;
  };
  store.upsertReplayAutopilotConfig = async () => {
    configWrites += 1;
    assert.fail("frozen preparation retry must not publish or enable a replay config");
  };

  const input = {
    trading_date: "2026-07-24",
    cadence: "5m",
    idempotency_key: "v5-frozen-repair-resume",
  };
  const created = await store.createReplayPreparation(input);
  const preparationId = created.jobs[0].preparation_id;
  const firstAttempt = await store.replayPreparation.process({
    preparation_id: preparationId,
    worker_id: "v5-frozen-release",
  });
  assert.equal(firstAttempt.status, "FAILED");
  assert.equal(firstAttempt.job.error.code, "LOCAL_PACK_CORE_DATASET_MISSING");

  const duplicate = await store.createReplayPreparation(input);
  assert.equal(duplicate.jobs[0].preparation_id, preparationId);
  assert.equal(duplicate.jobs[0].status, "FAILED");

  repaired = true;
  const queued = await resumeV5FrozenPreparationAfterRepair(store, duplicate.jobs[0]);
  assert.equal(queued.status, "QUEUED");
  assert.equal(queued.preparation_id, preparationId);
  assert.equal(queued.retry_revision, 1);
  assert.equal(queued.retry_history[0].error.code, "LOCAL_PACK_CORE_DATASET_MISSING");

  const completed = await store.replayPreparation.process({
    preparation_id: preparationId,
    worker_id: "v5-frozen-release",
  });
  assert.equal(completed.status, "AWAITING_CONFIRMATION");
  assert.equal(completed.job.preparation_id, preparationId);
  assert.equal(completed.job.pack_build_id, "repaired-pack-build");
  assert.equal(configWrites, 0);
  assert.equal(
    await persistence.getDocument("desk_replay_runs", completed.job.backtest_id).catch(() => null),
    null,
  );
});

test("V5 frozen preparation refuses to resume an unrelated deterministic failure", async () => {
  const clock = new FixedClock(Date.parse("2026-07-26T12:00:00.000Z"));
  const { store, persistence } = createTestDeskStore({ clock });
  const created = await store.createReplayPreparation({
    trading_date: "2026-07-24",
    cadence: "5m",
    idempotency_key: "v5-frozen-non-repairable",
  });
  const preparationId = created.jobs[0].preparation_id;
  const stored = await persistence.getDocument(DESK_COLLECTIONS.deskReplayPreparationJobs, preparationId);
  await persistence.setDocument(DESK_COLLECTIONS.deskReplayPreparationJobs, preparationId, {
    ...stored,
    status: "FAILED",
    error: { code: "REPLAY_PREPARATION_PACK_SCOPE_INVALID", message: "wrong day" },
  });
  const failed = await store.getReplayPreparation({ preparation_id: preparationId }).then((result) => result.job);

  await assert.rejects(
    resumeV5FrozenPreparationAfterRepair(store, failed),
    /V5_REPLAY_PREPARATION_FAILED:REPLAY_PREPARATION_PACK_SCOPE_INVALID/,
  );
  assert.equal(
    (await store.getReplayPreparation({ preparation_id: preparationId })).job.status,
    "FAILED",
  );
});
