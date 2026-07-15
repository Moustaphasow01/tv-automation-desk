import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalSha256 } from "@tv-automation/desk-domain";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { FixedClock } from "@tv-automation/desk-time";
import { buildDatasetManifestEntry } from "../src/pack-integrity.js";
import { createTestDeskStore } from "./support/test-desk-store.js";
import { callDeskTool, createDeskToolRegistry } from "../src/tools.js";

async function makeAutopilotStore() {
  const root = await mkdtemp(join(tmpdir(), "gpt-desk-replay-autopilot-"));
  const clock = new FixedClock(Date.parse("2026-07-14T00:00:00.000Z"));
  const { store, persistence } = createTestDeskStore({ root, projectRoot: root, clock });
  await seedReplaySourcePack(root);
  return { root, persistence, registry: createDeskToolRegistry(store) };
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
      "asset,timeframe,timestamp_utc,timestamp_paris,open,high,low,close,volume",
      `${asset},${timeframe},2026-07-13T22:00:00+00:00,2026-07-14T00:00:00+02:00,100,105,95,102,100`,
      `${asset},${timeframe},2026-07-13T23:00:00+00:00,2026-07-14T01:00:00+02:00,102,108,101,106,100`,
      `${asset},${timeframe},2026-07-14T00:00:00+00:00,2026-07-14T02:00:00+02:00,106,110,104,109,100`,
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
  assert.equal(first.structuredContent.gpt_claim.tool, "claim_next_desk_work");
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
