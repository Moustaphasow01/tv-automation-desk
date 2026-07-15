import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDeskExecutionScope } from "@tv-automation/desk-domain";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { FixedClock } from "@tv-automation/desk-time";
import { buildDatasetManifestEntry, buildSourceManifest } from "../src/pack-integrity.js";
import { createTestDeskStore } from "./support/test-desk-store.js";

const candleCsv = [
  "asset,timeframe,timestamp_utc,timestamp_paris,open,high,low,close",
  "NQ,15,2026-07-08T21:45:00.000Z,2026-07-08T23:45:00.000+02:00,100,102,99,101",
  "NQ,15,2026-07-08T22:00:00.000Z,2026-07-09T00:00:00.000+02:00,101,103,100,102",
  "",
].join("\n");

test("V2 replay reads an exact immutable build and returns verified integrity", async () => {
  const fixture = await buildFixture("asia_open");
  const result = await fixture.store.getDataset({
    pack_id: fixture.packId,
    pack_build_id: fixture.packBuildId,
    dataset: "NQ_M15",
    as_of_utc: "2026-07-08T22:05:00Z",
    mode: "replay",
  });

  assert.equal(result.pack_build_id, fixture.packBuildId);
  assert.equal(result.integrity.valid, true);
  assert.equal(result.rows.at(-1).timestamp_utc, "2026-07-08T22:00:00.000Z");
  assert.equal(result.source_manifest_hash.length, 64);
});

test("V2 replay fails closed when pack_build_id is omitted", async () => {
  const fixture = await buildFixture("asia_open");
  await assert.rejects(
    fixture.store.getDataset({ pack_id: fixture.packId, dataset: "NQ_M15", mode: "replay" }),
    (error) => error.code === "SCOPE_REQUIRED",
  );
});

test("tampered bytes are never returned and compromise the build", async () => {
  const fixture = await buildFixture("asia_open");
  await writeFile(fixture.datasetPath, candleCsv.replace("101,103,100,102", "101,999,100,102"));

  await assert.rejects(
    fixture.store.getDataset({
      pack_id: fixture.packId,
      pack_build_id: fixture.packBuildId,
      dataset: "NQ_M15",
      as_of_utc: "2026-07-08T22:05:00Z",
      mode: "replay",
    }),
    (error) => error.code === "DATASET_INTEGRITY_MISMATCH",
  );
  const build = await fixture.persistence.getDocument(DESK_COLLECTIONS.deskPackBuilds, fixture.packBuildId);
  assert.equal(build.execution_allowed, false);
  assert.ok(build.invalid_reason_codes.includes("DATASET_INTEGRITY_MISMATCH"));
});

test("Asia and NY builds on the same date remain byte-independent", async () => {
  const root = await mkdtemp(join(tmpdir(), "desk-store-v2-parallel-"));
  const asia = await buildFixture("asia_open", root);
  const ny = await buildFixture(
    "ny_open",
    root,
    candleCsv
      .replace("100,102,99,101", "5000,5010,4990,5005")
      .replace("101,103,100,102", "5005,5020,5000,5015"),
  );

  const asiaResult = await asia.store.getDataset({
    pack_id: asia.packId,
    pack_build_id: asia.packBuildId,
    dataset: "NQ_M15",
    as_of_utc: "2026-07-08T22:05:00Z",
    mode: "replay",
  });
  const nyResult = await ny.store.getDataset({
    pack_id: ny.packId,
    pack_build_id: ny.packBuildId,
    dataset: "NQ_M15",
    as_of_utc: "2026-07-09T13:30:00Z",
    mode: "replay",
  });

  assert.notEqual(asiaResult.integrity.actual.sha256, nyResult.integrity.actual.sha256);
  assert.equal(asiaResult.resolved_scope.strategy_id, "asia_open");
  assert.equal(nyResult.resolved_scope.strategy_id, "ny_open_1530");
});

async function buildFixture(session, existingRoot = null, csv = candleCsv) {
  const root = existingRoot || await mkdtemp(join(tmpdir(), "desk-store-v2-"));
  const strategyId = session === "ny_open" ? "ny_open_1530" : "asia_open";
  const packId = `2026-07-09_${session}`;
  const packBuildId = `packbuild__${packId}__fixture`;
  const cutoffParis = session === "ny_open" ? "2026-07-09T15:30:00+02:00" : "2026-07-09T00:05:00+02:00";
  const cutoffUtc = session === "ny_open" ? "2026-07-09T13:30:00Z" : "2026-07-08T22:05:00Z";
  const datasetPath = join(root, "datasets", packBuildId, "NQ_M15.csv");
  await mkdir(join(root, "desk_packs"), { recursive: true });
  await mkdir(join(root, "desk_pack_builds"), { recursive: true });
  await mkdir(join(root, "datasets", packBuildId), { recursive: true });
  await writeFile(datasetPath, csv);
  const scope = createDeskExecutionScope({
    strategy_id: strategyId,
    session,
    mode: "replay",
    trading_date: "2026-07-09",
    timezone: "Europe/Paris",
    cutoff_paris: cutoffParis,
    cutoff_utc: cutoffUtc,
    backtest_id: `bt__${strategyId}__2026-07-09__fixture`,
    pack_id: packId,
    pack_build_id: packBuildId,
  });
  const ref = {
    ...buildDatasetManifestEntry({
      packId,
      packBuildId,
      strategyId,
      session,
      dataset: "NQ_M15",
      cutoffUtc,
      objectPath: `gs://fixture/desk-data/packs/${packId}/builds/${packBuildId}/raw/NQ_M15.csv`,
      generation: "fixture-1",
      source: "fixture",
      buffer: csv,
      format: "csv",
    }),
    local_path: datasetPath,
  };
  const manifest = buildSourceManifest({
    packId,
    packBuildId,
    scope,
    datasets: { NQ_M15: ref },
    createdAtUtc: "2026-07-11T08:00:00Z",
  });
  await writeFile(join(root, "desk_packs", `${packId}.json`), JSON.stringify({
    pack_id: packId,
    date: "2026-07-09",
    session,
    strategy_id: strategyId,
    status: "ready",
    active_build_id: packBuildId,
    source_manifest_hash: manifest.source_manifest_hash,
  }));
  await writeFile(join(root, "desk_pack_builds", `${packBuildId}.json`), JSON.stringify({
    pack_id: packId,
    pack_build_id: packBuildId,
    strategy_id: strategyId,
    session,
    status: "ready",
    execution_allowed: true,
    cutoff_paris: cutoffParis,
    cutoff_utc: new Date(cutoffUtc).toISOString(),
    resolved_scope: scope,
    scope_hash: scope.scope_hash,
    source_manifest_hash: manifest.source_manifest_hash,
    manifest,
    datasets: { NQ_M15: ref },
  }));
  return {
    root,
    packId,
    packBuildId,
    datasetPath,
    ...createTestDeskStore({ root, projectRoot: root, clock: new FixedClock(Date.parse("2026-07-11T08:00:00Z")) }),
  };
}
