import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalSha256 } from "@tv-automation/desk-domain";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { FixedClock } from "@tv-automation/desk-time";
import { buildDatasetManifestEntry } from "../src/pack-integrity.js";
import { enrichReplayBundleSaveTargetForClaim } from "../src/desk-replay-service.js";
import { createTestDeskStore } from "./support/test-desk-store.js";
import { callDeskTool, createDeskToolRegistry } from "../src/tools.js";
import { makeNativeMasterV5 } from "./support/native-strategy-fixtures.js";

async function makeAutopilotStore() {
  const root = await mkdtemp(join(tmpdir(), "gpt-desk-replay-autopilot-"));
  const clock = new FixedClock(Date.parse("2026-07-14T00:00:00.000Z"));
  const { store, persistence } = createTestDeskStore({ root, projectRoot: root, clock });
  await seedReplaySourcePack(root);
  return { root, persistence, registry: createDeskToolRegistry(store) };
}

test("claimed Replay bundle projects the recovered work CAS over its stale persisted save target", () => {
  const bundle = {
    step_id: "step-recovered",
    save_target: {
      tool: "save_replay_monitor",
      suggested_payload: {
        backtest_id: "run-recovered",
        step_id: "step-recovered",
        expected_revision: 93,
        idempotency_key: "save-monitor:run-recovered:step-recovered",
      },
    },
  };
  const work = {
    work_item_id: "work-recovered",
    status: "CLAIMED",
    step_id: "step-recovered",
    expected_revision: 94,
    idempotency_key: "save-monitor:run-recovered:step-recovered",
    save_target: {
      backtest_id: "run-recovered",
      step_id: "step-recovered",
      expected_revision: 94,
      idempotency_key: "save-monitor:run-recovered:step-recovered",
    },
    claimed_by: "codex-replay-01",
    lease_token: "lease-recovered",
  };

  const projected = enrichReplayBundleSaveTargetForClaim(bundle, work);
  assert.equal(projected.save_target.suggested_payload.expected_revision, 94);
  assert.equal(projected.save_target.suggested_payload.idempotency_key, work.idempotency_key);
  assert.equal(projected.save_target.suggested_payload.work_item_id, work.work_item_id);
  assert.equal(projected.save_target.suggested_payload.worker_id, work.claimed_by);
  assert.equal(projected.save_target.suggested_payload.lease_token, work.lease_token);
});

function nativeReplayMasterFromSaveTarget(target) {
  return makeNativeMasterV5({
    mode: "REPLAY",
    tradingDate: target.trading_date,
    session: target.session,
    runId: target.replay_run_id || target.backtest_id,
    cutoffParis: target.cutoff_paris,
    analysisId: target.analysis_id,
    bundleId: target.bundle_id,
    packId: target.pack_id,
    packBuildId: target.pack_build_id,
    planId: target.plan_id,
    thesisId: target.thesis_id,
    setupId: target.setup_id_candidates?.[0] || null,
  });
}

async function seedReplaySourcePack(root) {
  const packId = "2026-07-14_asia_open_replay_source_test";
  const packBuildId = "packbuild__2026-07-14_asia_open_replay_source_test";
  const strategyId = "asia_open";
  const session = "asia_open";
  const cutoffUtc = "2026-07-14T00:00:00+00:00";
  const rawDir = join(root, "packs", packId, "builds", packBuildId, "raw");
  await mkdir(rawDir, { recursive: true });
  await mkdir(join(root, "desk_packs"), { recursive: true });
  await mkdir(join(root, "desk_pack_builds"), { recursive: true });

  const datasets = {};
  for (const [dataset, asset, timeframe] of [
    ["MNQ_M5", "MNQ", "5"],
    ["MES_M5", "MES", "5"],
    ["NQ_M15", "NQ", "15"],
    ["ES_M15", "ES", "15"],
  ]) {
    const text = [
      "asset,timeframe,timestamp_utc,timestamp_paris,timestamp_semantics,open,high,low,close,volume",
      `${asset},${timeframe},2026-07-13T22:00:00+00:00,2026-07-14T00:00:00+02:00,BAR_CLOSE,100,105,95,102,100`,
      `${asset},${timeframe},2026-07-13T23:00:00+00:00,2026-07-14T01:00:00+02:00,BAR_CLOSE,102,108,101,106,100`,
      `${asset},${timeframe},2026-07-14T00:00:00+00:00,2026-07-14T02:00:00+02:00,BAR_CLOSE,106,110,104,109,100`,
      "",
    ].join("\n");
    const objectPath = `local://packs/${packId}/builds/${packBuildId}/raw/${dataset}.csv`;
    await writeFile(join(rawDir, `${dataset}.csv`), text, "utf8");
    datasets[dataset] = buildDatasetManifestEntry({
      packId,
      packBuildId,
      strategyId,
      session,
      dataset,
      cutoffUtc,
      objectPath,
      buffer: Buffer.from(text, "utf8"),
      format: "csv",
      source: "test_fixture",
    });
  }

  const sourceCoverage = {
    mode: "full_replay_range",
    start_utc: "2026-07-13T22:00:00+00:00",
    end_utc: cutoffUtc,
    end_paris: "2026-07-14T02:00:00+02:00",
  };
  const manifestPayload = {
    manifest_schema_version: "1.0.0",
    pack_id: packId,
    pack_build_id: packBuildId,
    strategy_id: strategyId,
    session,
    trading_date: "2026-07-14",
    source_coverage: sourceCoverage,
    datasets,
  };
  const sourceManifestHash = canonicalSha256(manifestPayload);
  const build = {
    pack_id: packId,
    pack_build_id: packBuildId,
    status: "ready",
    execution_allowed: true,
    pack_purpose: "replay_source",
    strategy_id: strategyId,
    session,
    trading_date: "2026-07-14",
    date: "2026-07-14",
    timezone: "Europe/Paris",
    cutoff_utc: cutoffUtc,
    cutoff_paris: "2026-07-14T02:00:00+02:00",
    source_coverage: sourceCoverage,
    source_manifest_hash: sourceManifestHash,
    manifest: { ...manifestPayload, source_manifest_hash: sourceManifestHash },
    datasets,
  };
  const logical = {
    pack_id: packId,
    active_build_id: packBuildId,
    pack_build_id: packBuildId,
    status: "ready",
    strategy_id: strategyId,
    session,
    trading_date: "2026-07-14",
    date: "2026-07-14",
    source_manifest_hash: sourceManifestHash,
  };
  await writeFile(join(root, "desk_pack_builds", `${packBuildId}.json`), JSON.stringify(build, null, 2), "utf8");
  await writeFile(join(root, "desk_packs", `${packId}.json`), JSON.stringify(logical, null, 2), "utf8");
}

function replayAutopilotConfig(overrides = {}) {
  return {
    trading_date: "2026-07-14",
    session: "asia_open",
    strategy_id: "asia_open",
    pack_id: "2026-07-14_asia_open_replay_source_test",
    pack_build_id: "packbuild__2026-07-14_asia_open_replay_source_test",
    start_time: "2026-07-14T00:00:00+02:00",
    end_time: "2026-07-14T02:00:00+02:00",
    cadence: "60m",
    instruments: ["MNQ", "MES", "NQ", "ES"],
    ...overrides,
  };
}

test("GPT replay autopilot creates or resumes a configured replay and exposes one claimable work item", async () => {
  const { persistence, registry } = await makeAutopilotStore();

  const config = await callDeskTool(registry, "upsert_replay_autopilot_config", {
    config_id: "replay_autopilot_test_2026_07_14",
    backtest_id: "replay_autopilot_test_run",
    trading_date: "2026-07-14",
    session: "asia_open",
    strategy_id: "asia_open",
    pack_id: "2026-07-14_asia_open_replay_source_test",
    pack_build_id: "packbuild__2026-07-14_asia_open_replay_source_test",
    start_time: "2026-07-14T00:00:00+02:00",
    end_time: "2026-07-14T02:00:00+02:00",
    cadence: "60m",
    instruments: ["MNQ", "MES", "NQ", "ES"],
  });
  assert.equal(config.isError, false);
  assert.equal(config.structuredContent.config.cadence, "60m");

  const first = await callDeskTool(registry, "start_or_resume_replay_autopilot", {
    config_id: "replay_autopilot_test_2026_07_14",
    worker_id: "gpt-replay-autopilot-test",
    max_transitions: 6,
  });
  assert.equal(first.isError, false);
  assert.equal(first.structuredContent.status, "WAITING_GPT");
  assert.equal(first.structuredContent.created_replay, true);
  assert.equal(first.structuredContent.gpt_claim.tool, "claim_next_replay_work");
  assert.equal(first.structuredContent.gpt_claim.args.backtest_id, "replay_autopilot_test_run");
  assert.equal(first.structuredContent.work_item.workflow, "REPLAY_MASTER");

  assert.equal(persistence.count(DESK_COLLECTIONS.deskAgentWorkItems), 1);

  const second = await callDeskTool(registry, "start_or_resume_replay_autopilot", {
    config_id: "replay_autopilot_test_2026_07_14",
    worker_id: "gpt-replay-autopilot-test",
    max_transitions: 6,
  });
  assert.equal(second.isError, false);
  assert.equal(second.structuredContent.status, "WAITING_GPT");
  assert.equal(second.structuredContent.created_replay, false);
  assert.equal(persistence.count(DESK_COLLECTIONS.deskAgentWorkItems), 1);
});

test("GPT replay autopilot pool distributes next ready configs across parallel backtests", async () => {
  const { registry } = await makeAutopilotStore();

  for (const suffix of ["a", "b"]) {
    await callDeskTool(registry, "upsert_replay_autopilot_config", replayAutopilotConfig({
      config_id: `replay_autopilot_pool_${suffix}`,
      backtest_id: `replay_autopilot_pool_run_${suffix}`,
      worker_group: "pool-test",
      priority: 10,
    }));
  }

  const first = await callDeskTool(registry, "start_or_resume_replay_autopilot", {
    mode: "next_ready_config",
    worker_group: "pool-test",
    worker_id: "gpt-replay-pool-a",
  });
  assert.equal(first.isError, false);
  assert.equal(first.structuredContent.status, "WAITING_GPT");
  assert.equal(first.structuredContent.config.config_id, "replay_autopilot_pool_a");
  assert.equal(first.structuredContent.gpt_claim.args.backtest_id, "replay_autopilot_pool_run_a");

  const second = await callDeskTool(registry, "start_or_resume_replay_autopilot", {
    mode: "next_ready_config",
    worker_group: "pool-test",
    worker_id: "gpt-replay-pool-b",
  });
  assert.equal(second.isError, false);
  assert.equal(second.structuredContent.status, "WAITING_GPT");
  assert.equal(second.structuredContent.config.config_id, "replay_autopilot_pool_b");
  assert.equal(second.structuredContent.gpt_claim.args.backtest_id, "replay_autopilot_pool_run_b");
});

test("GPT replay autopilot pool skips a config whose work is actively claimed", async () => {
  const { registry } = await makeAutopilotStore();

  for (const suffix of ["a", "b"]) {
    await callDeskTool(registry, "upsert_replay_autopilot_config", replayAutopilotConfig({
      config_id: `replay_autopilot_busy_${suffix}`,
      backtest_id: `replay_autopilot_busy_run_${suffix}`,
      worker_group: "busy-pool-test",
      priority: 10,
    }));
  }

  const startedA = await callDeskTool(registry, "start_or_resume_replay_autopilot", {
    config_id: "replay_autopilot_busy_a",
    worker_id: "gpt-replay-busy-a",
  });
  assert.equal(startedA.isError, false);

  const claimedA = await callDeskTool(registry, "claim_next_replay_work", {
    ...startedA.structuredContent.gpt_claim.args,
    worker_id: "gpt-replay-busy-a",
  });
  assert.equal(claimedA.isError, false);
  assert.equal(claimedA.structuredContent.status, "WORK_CLAIMED");

  const next = await callDeskTool(registry, "start_or_resume_replay_autopilot", {
    mode: "next_ready_config",
    worker_group: "busy-pool-test",
    worker_id: "gpt-replay-busy-b",
  });
  assert.equal(next.isError, false);
  assert.equal(next.structuredContent.status, "WAITING_GPT");
  assert.equal(next.structuredContent.config.config_id, "replay_autopilot_busy_b");
  assert.equal(next.structuredContent.gpt_claim.args.backtest_id, "replay_autopilot_busy_run_b");
});

test("GPT replay autopilot latest_ready_config skips busy work so existing GPT prompts can use a pool", async () => {
  const { registry } = await makeAutopilotStore();

  for (const suffix of ["a", "b"]) {
    await callDeskTool(registry, "upsert_replay_autopilot_config", replayAutopilotConfig({
      config_id: `replay_autopilot_latest_${suffix}`,
      backtest_id: `replay_autopilot_latest_run_${suffix}`,
      worker_group: "latest-pool-test",
      priority: 10,
    }));
  }

  const startedA = await callDeskTool(registry, "start_or_resume_replay_autopilot", {
    mode: "latest_ready_config",
    worker_group: "latest-pool-test",
    worker_id: "gpt-replay-latest-a",
  });
  assert.equal(startedA.isError, false);
  assert.equal(startedA.structuredContent.status, "WAITING_GPT");
  assert.equal(startedA.structuredContent.config.config_id, "replay_autopilot_latest_a");

  const claimedA = await callDeskTool(registry, "claim_next_replay_work", {
    ...startedA.structuredContent.gpt_claim.args,
    worker_id: "gpt-replay-latest-a",
  });
  assert.equal(claimedA.isError, false);
  assert.equal(claimedA.structuredContent.status, "WORK_CLAIMED");

  const next = await callDeskTool(registry, "start_or_resume_replay_autopilot", {
    mode: "latest_ready_config",
    worker_group: "latest-pool-test",
    worker_id: "gpt-replay-latest-b",
  });
  assert.equal(next.isError, false);
  assert.equal(next.structuredContent.status, "WAITING_GPT");
  assert.equal(next.structuredContent.config.config_id, "replay_autopilot_latest_b");
  assert.equal(next.structuredContent.gpt_claim.args.backtest_id, "replay_autopilot_latest_run_b");
});

test("GPT replay autopilot active window activates only selected dates and pauses the rest", async () => {
  const { persistence, registry } = await makeAutopilotStore();

  for (const day of ["01", "02", "03", "04"]) {
    await callDeskTool(registry, "upsert_replay_autopilot_config", replayAutopilotConfig({
      config_id: `replay_autopilot_window_2026_06_${day}`,
      backtest_id: `replay_2026_06_${day}_asia_open_60m_autopilot`,
      trading_date: `2026-06-${day}`,
      start_time: `2026-06-${day}T00:00:00+02:00`,
      end_time: `2026-06-${day}T22:00:00+02:00`,
      worker_group: "window-test",
      priority: 100,
    }));
  }

  const window = await callDeskTool(registry, "set_replay_autopilot_window", {
    worker_group: "window-test",
    session: "asia_open",
    date_from: "2026-06-01",
    date_to: "2026-06-03",
    pause_outside_window: true,
    reason: "unit-test-window",
  });
  assert.equal(window.isError, false);
  assert.equal(window.structuredContent.status, "WINDOW_APPLIED");
  assert.equal(window.structuredContent.active_count, 3);
  assert.equal(window.structuredContent.paused_count, 1);

  const configs = Object.fromEntries(await Promise.all(["01", "02", "03", "04"].map(async (day) => {
    const config = await persistence.getDocument("desk_replay_autopilot_configs", `replay_autopilot_window_2026_06_${day}`);
    return [day, config];
  })));
  assert.equal(configs["01"].status, "READY");
  assert.equal(configs["01"].enabled, true);
  assert.equal(configs["01"].priority, 10);
  assert.equal(configs["02"].priority, 20);
  assert.equal(configs["03"].priority, 30);
  assert.equal(configs["04"].status, "PAUSED");
  assert.equal(configs["04"].enabled, false);
  assert.equal(configs["04"].window_active, false);
});

test("GPT replay autopilot can resume a config whose claimed work lease expired", async () => {
  const { persistence, registry } = await makeAutopilotStore();

  await callDeskTool(registry, "upsert_replay_autopilot_config", replayAutopilotConfig({
    config_id: "replay_autopilot_expired_claim_test",
    backtest_id: "replay_autopilot_expired_claim_run",
  }));

  const started = await callDeskTool(registry, "start_or_resume_replay_autopilot", {
    config_id: "replay_autopilot_expired_claim_test",
    worker_id: "gpt-replay-expired-a",
  });
  assert.equal(started.isError, false);

  const claimed = await callDeskTool(registry, "claim_next_replay_work", {
    ...started.structuredContent.gpt_claim.args,
    worker_id: "gpt-replay-expired-a",
  });
  assert.equal(claimed.isError, false);
  assert.equal(claimed.structuredContent.status, "WORK_CLAIMED");

  const workId = started.structuredContent.work_item.work_item_id;
  const expired = {
    ...await persistence.getDocument(DESK_COLLECTIONS.deskAgentWorkItems, workId),
    lease_expires_at_utc: "2026-07-13T23:59:00.000Z",
    lease_expires_at_paris: "2026-07-14T01:59:00.000+02:00",
  };
  await persistence.setDocument(DESK_COLLECTIONS.deskAgentWorkItems, workId, expired);

  const resumed = await callDeskTool(registry, "start_or_resume_replay_autopilot", {
    config_id: "replay_autopilot_expired_claim_test",
    worker_id: "gpt-replay-expired-b",
  });
  assert.equal(resumed.isError, false);
  assert.equal(resumed.structuredContent.status, "WAITING_GPT");
  assert.equal(resumed.structuredContent.gpt_claim.args.backtest_id, "replay_autopilot_expired_claim_run");

  const reclaimed = await callDeskTool(registry, "claim_next_replay_work", {
    ...resumed.structuredContent.gpt_claim.args,
    worker_id: "gpt-replay-expired-b",
  });
  assert.equal(reclaimed.isError, false);
  assert.equal(reclaimed.structuredContent.status, "WORK_CLAIMED");
  assert.equal(reclaimed.structuredContent.claim_handle.worker_id, "gpt-replay-expired-b");
});

test("claimed replay Master injects lease handle into claim and bundle save targets", async () => {
  const { registry } = await makeAutopilotStore();

  await callDeskTool(registry, "upsert_replay_autopilot_config", {
    config_id: "replay_autopilot_claim_save_target_test",
    backtest_id: "replay_autopilot_claim_save_target_run",
    trading_date: "2026-07-14",
    session: "asia_open",
    strategy_id: "asia_open",
    pack_id: "2026-07-14_asia_open_replay_source_test",
    pack_build_id: "packbuild__2026-07-14_asia_open_replay_source_test",
    start_time: "2026-07-14T00:00:00+02:00",
    end_time: "2026-07-14T02:00:00+02:00",
    cadence: "60m",
    instruments: ["MNQ", "MES", "NQ", "ES"],
  });
  const started = await callDeskTool(registry, "start_or_resume_replay_autopilot", {
    config_id: "replay_autopilot_claim_save_target_test",
    worker_id: "gpt-replay-autopilot-test",
  });
  assert.equal(started.isError, false);
  assert.equal(started.structuredContent.status, "WAITING_GPT");

  const claimed = await callDeskTool(registry, "claim_next_replay_work", {
    ...started.structuredContent.gpt_claim.args,
    worker_id: "gpt-replay-worker-lease-test",
  });
  assert.equal(claimed.isError, false);
  assert.equal(claimed.structuredContent.status, "WORK_CLAIMED");
  assert.equal(claimed.structuredContent.workflow, "REPLAY_MASTER");

  const handle = claimed.structuredContent.claim_handle;
  assert.equal(claimed.structuredContent.save_target.work_item_id, handle.work_item_id);
  assert.equal(claimed.structuredContent.save_target.worker_id, "gpt-replay-worker-lease-test");
  assert.equal(claimed.structuredContent.save_target.lease_token, handle.lease_token);

  const bundle = await callDeskTool(registry, "get_replay_master_bundle", {
    backtest_id: handle.backtest_id,
    step_id: handle.step_id,
    view: "compact",
  });
  assert.equal(bundle.isError, false);
  assert.equal(bundle.structuredContent.save_target.suggested_payload.work_item_id, handle.work_item_id);
  assert.equal(bundle.structuredContent.save_target.suggested_payload.worker_id, "gpt-replay-worker-lease-test");
  assert.equal(bundle.structuredContent.save_target.suggested_payload.lease_token, handle.lease_token);

  const suggestedPayload = bundle.structuredContent.save_target.suggested_payload;
  const saved = await callDeskTool(registry, "save_replay_master_analysis", {
    ...suggestedPayload,
    analysis_output: nativeReplayMasterFromSaveTarget(suggestedPayload),
  });
  assert.equal(saved.isError, false, saved.structuredContent.error);

  const state = await callDeskTool(registry, "get_replay_state", { backtest_id: handle.backtest_id });
  assert.equal(state.isError, false);
  assert.equal(state.structuredContent.selected_backtest.current_replay_time, "2026-07-14T01:00:00.000+02:00");
  assert.equal(state.structuredContent.status, "WAITING_GPT_MONITOR");
});

test("GPT replay autopilot re-arms a known retryable document serialization failure", async () => {
  const { persistence, registry } = await makeAutopilotStore();

  await callDeskTool(registry, "upsert_replay_autopilot_config", {
    config_id: "replay_autopilot_recovery_test",
    backtest_id: "replay_autopilot_recovery_run",
    trading_date: "2026-07-14",
    session: "asia_open",
    strategy_id: "asia_open",
    pack_id: "2026-07-14_asia_open_replay_source_test",
    pack_build_id: "packbuild__2026-07-14_asia_open_replay_source_test",
    start_time: "2026-07-14T00:00:00+02:00",
    end_time: "2026-07-14T02:00:00+02:00",
    cadence: "60m",
    instruments: ["MNQ", "MES", "NQ", "ES"],
  });
  const first = await callDeskTool(registry, "start_or_resume_replay_autopilot", {
    config_id: "replay_autopilot_recovery_test",
    worker_id: "gpt-replay-autopilot-test",
  });
  assert.equal(first.isError, false);

  const workId = first.structuredContent.work_item.work_item_id;
  const failed = {
    ...await persistence.getDocument(DESK_COLLECTIONS.deskAgentWorkItems, workId),
    status: "FAILED",
    attempt_count: 3,
    failure_count: 3,
    claimed_by: null,
    worker_id: null,
    lease_token: null,
    last_error: {
      code: "SAVE_DOCUMENT_UNDEFINED",
      message: "Cannot persist undefined trigger_policy.min_score",
      retryable: true,
    },
  };
  await persistence.setDocument(DESK_COLLECTIONS.deskAgentWorkItems, workId, failed);

  const recovered = await callDeskTool(registry, "start_or_resume_replay_autopilot", {
    config_id: "replay_autopilot_recovery_test",
    worker_id: "gpt-replay-autopilot-test",
  });
  assert.equal(recovered.isError, false);
  assert.equal(recovered.structuredContent.status, "WAITING_GPT");
  assert.equal(recovered.structuredContent.recovered.status, "RECOVERED");
  assert.equal(recovered.structuredContent.work_item.status, "READY");
  assert.equal(recovered.structuredContent.work_item.attempt_count, 0);
});

test("GPT replay autopilot re-arms a false failure caused only by missing GC context", async () => {
  const { persistence, registry } = await makeAutopilotStore();

  await callDeskTool(registry, "upsert_replay_autopilot_config", replayAutopilotConfig({
    config_id: "replay_autopilot_context_gap_recovery_test",
    backtest_id: "replay_autopilot_context_gap_recovery_run",
  }));
  const first = await callDeskTool(registry, "start_or_resume_replay_autopilot", {
    config_id: "replay_autopilot_context_gap_recovery_test",
    worker_id: "gpt-replay-autopilot-test",
  });
  assert.equal(first.isError, false);

  const workId = first.structuredContent.work_item.work_item_id;
  const failed = {
    ...await persistence.getDocument(DESK_COLLECTIONS.deskAgentWorkItems, workId),
    status: "FAILED",
    attempt_count: 3,
    failure_count: 3,
    claimed_by: null,
    worker_id: null,
    lease_token: null,
    last_error: {
      code: "REPLAY_STORAGE_TEMPORARILY_UNAVAILABLE",
      message: "GC is availability=missing_unexpected at cutoff; row_count=0 and only H4 context exists.",
      retryable: true,
    },
  };
  await persistence.setDocument(DESK_COLLECTIONS.deskAgentWorkItems, workId, failed);

  const recovered = await callDeskTool(registry, "start_or_resume_replay_autopilot", {
    config_id: "replay_autopilot_context_gap_recovery_test",
    worker_id: "gpt-replay-autopilot-test",
  });
  assert.equal(recovered.isError, false);
  assert.equal(recovered.structuredContent.status, "WAITING_GPT");
  assert.equal(recovered.structuredContent.recovered.status, "RECOVERED");
  assert.equal(recovered.structuredContent.work_item.status, "READY");
  assert.equal(recovered.structuredContent.work_item.attempt_count, 0);
  assert.equal(recovered.structuredContent.work_item.failure_count, 0);
});

test("GPT replay autopilot re-arms a claimed save blocked failure even when GPT marks it non retryable", async () => {
  const { persistence, registry } = await makeAutopilotStore();

  await callDeskTool(registry, "upsert_replay_autopilot_config", {
    config_id: "replay_autopilot_claimed_save_blocked_recovery_test",
    backtest_id: "replay_autopilot_claimed_save_blocked_recovery_run",
    trading_date: "2026-07-14",
    session: "asia_open",
    strategy_id: "asia_open",
    pack_id: "2026-07-14_asia_open_replay_source_test",
    pack_build_id: "packbuild__2026-07-14_asia_open_replay_source_test",
    start_time: "2026-07-14T00:00:00+02:00",
    end_time: "2026-07-14T02:00:00+02:00",
    cadence: "60m",
    instruments: ["MNQ", "MES", "NQ", "ES"],
  });
  const first = await callDeskTool(registry, "start_or_resume_replay_autopilot", {
    config_id: "replay_autopilot_claimed_save_blocked_recovery_test",
    worker_id: "gpt-replay-autopilot-test",
  });
  assert.equal(first.isError, false);

  const workId = first.structuredContent.work_item.work_item_id;
  const failed = {
    ...await persistence.getDocument(DESK_COLLECTIONS.deskAgentWorkItems, workId),
    status: "FAILED",
    attempt_count: 1,
    failure_count: 1,
    claimed_by: null,
    worker_id: null,
    lease_token: null,
    retryable: false,
    last_error: {
      code: "WORK_ALREADY_CLAIMED_SAVE_BLOCKED",
      message: "Pause automation before using the manual Master save path.",
      retryable: false,
    },
  };
  await persistence.setDocument(DESK_COLLECTIONS.deskAgentWorkItems, workId, failed);

  const recovered = await callDeskTool(registry, "start_or_resume_replay_autopilot", {
    config_id: "replay_autopilot_claimed_save_blocked_recovery_test",
    worker_id: "gpt-replay-autopilot-test",
  });
  assert.equal(recovered.isError, false);
  assert.equal(recovered.structuredContent.status, "WAITING_GPT");
  assert.equal(recovered.structuredContent.recovered.status, "RECOVERED");
  assert.equal(recovered.structuredContent.work_item.status, "READY");
  assert.equal(recovered.structuredContent.work_item.attempt_count, 0);
  assert.equal(recovered.structuredContent.work_item.failure_count, 0);
});

test("GPT replay autopilot re-arms a Codex temporary ACL failure after operator repair", async () => {
  const { persistence, registry } = await makeAutopilotStore();

  await callDeskTool(registry, "upsert_replay_autopilot_config", replayAutopilotConfig({
    config_id: "replay_autopilot_codex_acl_recovery_test",
    backtest_id: "replay_autopilot_codex_acl_recovery_run",
  }));
  const first = await callDeskTool(registry, "start_or_resume_replay_autopilot", {
    config_id: "replay_autopilot_codex_acl_recovery_test",
    worker_id: "gpt-replay-autopilot-test",
  });
  assert.equal(first.isError, false);

  const workId = first.structuredContent.work_item.work_item_id;
  const failed = {
    ...await persistence.getDocument(DESK_COLLECTIONS.deskAgentWorkItems, workId),
    status: "FAILED",
    attempt_count: 1,
    failure_count: 1,
    claimed_by: null,
    worker_id: null,
    lease_token: null,
    retryable: false,
    last_error: {
      code: "CODEX_TEMP_ACL_FAILED",
      message: "The private Codex temporary root could not be secured.",
      retryable: false,
    },
  };
  await persistence.setDocument(DESK_COLLECTIONS.deskAgentWorkItems, workId, failed);

  const recovered = await callDeskTool(registry, "start_or_resume_replay_autopilot", {
    config_id: "replay_autopilot_codex_acl_recovery_test",
    worker_id: "gpt-replay-autopilot-test",
  });
  assert.equal(recovered.isError, false);
  assert.equal(recovered.structuredContent.status, "WAITING_GPT");
  assert.equal(recovered.structuredContent.recovered.status, "RECOVERED");
  assert.equal(recovered.structuredContent.work_item.status, "READY");
  assert.equal(recovered.structuredContent.work_item.attempt_count, 0);
  assert.equal(recovered.structuredContent.work_item.failure_count, 0);
  assert.equal(recovered.structuredContent.work_item.last_error, null);
});

test("GPT replay autopilot re-arms a legacy oversized-context failure for the bounded agentic reader", async () => {
  const { persistence, registry } = await makeAutopilotStore();

  await callDeskTool(registry, "upsert_replay_autopilot_config", replayAutopilotConfig({
    config_id: "replay_autopilot_agentic_context_recovery_test",
    backtest_id: "replay_autopilot_agentic_context_recovery_run",
  }));
  const first = await callDeskTool(registry, "start_or_resume_replay_autopilot", {
    config_id: "replay_autopilot_agentic_context_recovery_test",
    worker_id: "gpt-replay-autopilot-test",
  });
  assert.equal(first.isError, false);

  const workId = first.structuredContent.work_item.work_item_id;
  const failed = {
    ...await persistence.getDocument(DESK_COLLECTIONS.deskAgentWorkItems, workId),
    status: "FAILED",
    attempt_count: 1,
    failure_count: 1,
    claimed_by: null,
    worker_id: null,
    lease_token: null,
    retryable: false,
    last_error: {
      code: "AI_REPLAY_CONTEXT_INCOMPLETE",
      message: "Replay follow-up read remained incomplete before the bounded agentic context cutover.",
      retryable: false,
    },
  };
  await persistence.setDocument(DESK_COLLECTIONS.deskAgentWorkItems, workId, failed);

  const recovered = await callDeskTool(registry, "start_or_resume_replay_autopilot", {
    config_id: "replay_autopilot_agentic_context_recovery_test",
    worker_id: "gpt-replay-autopilot-test",
  });
  assert.equal(recovered.isError, false);
  assert.equal(recovered.structuredContent.status, "WAITING_GPT");
  assert.equal(recovered.structuredContent.recovered.status, "RECOVERED");
  assert.equal(recovered.structuredContent.work_item.status, "READY");
  assert.equal(recovered.structuredContent.work_item.attempt_count, 0);
  assert.equal(recovered.structuredContent.work_item.failure_count, 0);
  assert.equal(recovered.structuredContent.work_item.last_error, null);
});

test("GPT replay autopilot re-arms a blocked GPT contract handshake failure", async () => {
  const { persistence, registry } = await makeAutopilotStore();

  await callDeskTool(registry, "upsert_replay_autopilot_config", replayAutopilotConfig({
    config_id: "replay_autopilot_contract_handshake_recovery_test",
    backtest_id: "replay_autopilot_contract_handshake_recovery_run",
  }));
  const first = await callDeskTool(registry, "start_or_resume_replay_autopilot", {
    config_id: "replay_autopilot_contract_handshake_recovery_test",
    worker_id: "gpt-replay-autopilot-test",
  });
  assert.equal(first.isError, false);

  const workId = first.structuredContent.work_item.work_item_id;
  const failed = {
    ...await persistence.getDocument(DESK_COLLECTIONS.deskAgentWorkItems, workId),
    status: "FAILED",
    attempt_count: 1,
    failure_count: 1,
    claimed_by: null,
    worker_id: null,
    lease_token: null,
    retryable: false,
    last_error: {
      code: "CONTRACT_HANDSHAKE_UNAVAILABLE",
      message: "The required contract handshake did not execute, so this work item cannot continue.",
      retryable: false,
    },
  };
  await persistence.setDocument(DESK_COLLECTIONS.deskAgentWorkItems, workId, failed);

  const recovered = await callDeskTool(registry, "start_or_resume_replay_autopilot", {
    config_id: "replay_autopilot_contract_handshake_recovery_test",
    worker_id: "gpt-replay-autopilot-test",
  });
  assert.equal(recovered.isError, false);
  assert.equal(recovered.structuredContent.status, "WAITING_GPT");
  assert.equal(recovered.structuredContent.recovered.status, "RECOVERED");
  assert.equal(recovered.structuredContent.work_item.status, "READY");
  assert.equal(recovered.structuredContent.work_item.last_error, null);
});

test("GPT replay autopilot re-arms a monitor health-score document serialization failure", async () => {
  const { persistence, registry } = await makeAutopilotStore();

  await callDeskTool(registry, "upsert_replay_autopilot_config", replayAutopilotConfig({
    config_id: "replay_autopilot_monitor_health_recovery_test",
    backtest_id: "replay_autopilot_monitor_health_recovery_run",
  }));
  const first = await callDeskTool(registry, "start_or_resume_replay_autopilot", {
    config_id: "replay_autopilot_monitor_health_recovery_test",
    worker_id: "gpt-replay-autopilot-test",
  });
  assert.equal(first.isError, false);

  const workId = first.structuredContent.work_item.work_item_id;
  const failed = {
    ...await persistence.getDocument(DESK_COLLECTIONS.deskAgentWorkItems, workId),
    status: "FAILED",
    attempt_count: 1,
    failure_count: 1,
    claimed_by: null,
    worker_id: null,
    lease_token: null,
    retryable: false,
    last_error: {
      code: "SAVE_REPLAY_MONITOR_DOCUMENT_UNDEFINED_HEALTH_SCORE",
      message: "save_replay_monitor failed because health_score was undefined in the materialized document.",
      retryable: false,
    },
  };
  await persistence.setDocument(DESK_COLLECTIONS.deskAgentWorkItems, workId, failed);

  const recovered = await callDeskTool(registry, "start_or_resume_replay_autopilot", {
    config_id: "replay_autopilot_monitor_health_recovery_test",
    worker_id: "gpt-replay-autopilot-test",
  });
  assert.equal(recovered.isError, false);
  assert.equal(recovered.structuredContent.status, "WAITING_GPT");
  assert.equal(recovered.structuredContent.recovered.status, "RECOVERED");
  assert.equal(recovered.structuredContent.work_item.status, "READY");
  assert.equal(recovered.structuredContent.work_item.last_error, null);
});
