import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { FixedClock } from "@tv-automation/desk-time";
import {
  DeskPackService,
  filterDatasetRowsAtCutoff,
} from "../src/desk-pack-service.js";
import { InMemoryDeskPersistence } from "./support/in-memory-desk-persistence.js";

const clock = new FixedClock(Date.parse("2026-07-16T08:00:00.000Z"));

function createService() {
  const persistence = new InMemoryDeskPersistence();
  return { persistence, service: new DeskPackService({ persistence, clock }) };
}

test("DeskPackService selects, lists and summarizes source decision packs", async () => {
  const { persistence, service } = createService();
  persistence
    .seed(DESK_COLLECTIONS.deskPacks, "2026-07-15_asia_open", {
      pack_id: "2026-07-15_asia_open",
      date: "2026-07-15",
      session: "asia_open",
      status: "ready",
      updated_at: "2026-07-15T06:00:00.000Z",
      datasets: {},
      summary: { key_levels: { MNQ: { session_high: 23100, session_low: 22900 } } },
    })
    .seed(DESK_COLLECTIONS.deskPacks, "2026-07-16_asia_open", {
      pack_id: "2026-07-16_asia_open",
      date: "2026-07-16",
      session: "asia_open",
      status: "ready",
      updated_at: "2026-07-16T06:00:00.000Z",
      datasets: {},
      summary: { key_levels: { MNQ: { session_high: 23200, session_low: 23000 } } },
    });

  const latest = await service.getLatestAsiaOpenPack();
  assert.equal(latest.pack_id, "2026-07-16_asia_open");
  assert.equal(latest.unverified_source_pack, undefined);

  const listed = await service.listDeskPacks({
    date_from: "2026-07-15",
    date_to: "2026-07-16",
    session: "asia_open",
    status: "ready",
  });
  assert.equal(listed.count, 2);
  assert.deepEqual(listed.packs.map((pack) => pack.pack_id), [
    "2026-07-16_asia_open",
    "2026-07-15_asia_open",
  ]);

  const levels = await service.getMarketLevels({ pack_id: "2026-07-16_asia_open", instrument: "MNQ" });
  assert.equal(levels.session_high, 23200);

  const macro = await service.getMacroCalendar({ pack_id: "2026-07-16_asia_open" });
  assert.equal(macro.warning, "macro_calendar_dataset_not_available");
  assert.deepEqual(macro.events, []);

  const news = await service.getNewsDigest({ pack_id: "2026-07-16_asia_open" });
  assert.equal(news.status, "not_configured");
  assert.equal(news.empty_ok, true);
});

test("DeskPackService rejects datasets outside the active contract enum", async () => {
  const { service } = createService();

  await assert.rejects(
    service.getDataset({ pack_id: "unused", dataset: "MNQ_M15" }),
    /dataset_not_allowed:MNQ_M15/,
  );
});

test("DeskPackService returns deterministic oldest-first or latest-first bounded rows", async () => {
  const root = await mkdtemp(join(tmpdir(), "desk-pack-row-order-"));
  await writeFile(join(root, "MNQ_M5.csv"), [
    "asset,timeframe,timestamp_utc,close",
    "MNQ,M5,2026-07-16T09:55:00.000Z,101",
    "MNQ,M5,2026-07-16T09:45:00.000Z,99",
    "MNQ,M5,2026-07-16T09:50:00.000Z,100",
    "",
  ].join("\n"));
  const persistence = new InMemoryDeskPersistence({ objectRoot: root });
  const service = new DeskPackService({ persistence, clock });
  persistence.seed(DESK_COLLECTIONS.deskPacks, "pack-row-order", {
    pack_id: "pack-row-order",
    date: "2026-07-16",
    session: "asia_open",
    status: "ready",
    datasets: {
      MNQ_M5: {
        storage_path: "local://MNQ_M5.csv",
        format: "csv",
        row_count: 3,
        columns: ["asset", "timeframe", "timestamp_utc", "close"],
      },
    },
  });

  const oldest = await service.getDataset({
    pack_id: "pack-row-order",
    dataset: "MNQ_M5",
    max_rows: 2,
  });
  assert.equal(oldest.row_order, "oldest_first");
  assert.deepEqual(oldest.rows.map((row) => row.close), [99, 100]);

  const latest = await service.getDataset({
    pack_id: "pack-row-order",
    dataset: "MNQ_M5",
    max_rows: 2,
    row_order: "latest_first",
  });
  assert.equal(latest.row_order, "latest_first");
  assert.deepEqual(latest.rows.map((row) => row.close), [101, 100]);

  await assert.rejects(
    service.getDataset({
      pack_id: "pack-row-order",
      dataset: "MNQ_M5",
      row_order: "newest",
    }),
    /dataset_row_order_invalid:newest/,
  );
});

test("DeskPackService invalidates an immutable build with a corrupted manifest", async () => {
  const { persistence, service } = createService();
  persistence
    .seed(DESK_COLLECTIONS.deskPacks, "pack-corrupted", {
      pack_id: "pack-corrupted",
      date: "2026-07-16",
      session: "asia_open",
      status: "ready",
      active_build_id: "build-corrupted",
    })
    .seed(DESK_COLLECTIONS.deskPackBuilds, "build-corrupted", {
      pack_id: "pack-corrupted",
      pack_build_id: "build-corrupted",
      status: "ready",
      execution_allowed: true,
      datasets: {},
      source_manifest_hash: "invalid-hash",
      manifest: { source_manifest_hash: "invalid-hash", datasets: {} },
    });

  await assert.rejects(
    service.getDeskPack({ pack_id: "pack-corrupted" }),
    (error) => error.code === "DATASET_INTEGRITY_MISMATCH",
  );

  const invalidated = await persistence.getDocument(DESK_COLLECTIONS.deskPackBuilds, "build-corrupted");
  assert.equal(invalidated.status, "degraded");
  assert.equal(invalidated.execution_allowed, false);
  assert.deepEqual(invalidated.invalid_reason_codes, ["DATASET_INTEGRITY_MISMATCH"]);
});


test("dataset cutoff exposes bars only once they are closed for every supported timeframe", () => {
  const cutoff = "2026-07-16T10:00:00.000Z";
  const cases = [
    { timeframe: "M1", dataset: "MNQ_M1", visible: "2026-07-16T09:59:00.000Z", hidden: "2026-07-16T10:00:00.000Z" },
    { timeframe: "M5", dataset: "MNQ_M5", visible: "2026-07-16T09:55:00.000Z", hidden: "2026-07-16T10:00:00.000Z" },
    { timeframe: "M15", dataset: "MNQ_M15", visible: "2026-07-16T09:45:00.000Z", hidden: "2026-07-16T10:00:00.000Z" },
    { timeframe: "H1", dataset: "MNQ_H1", visible: "2026-07-16T09:00:00.000Z", hidden: "2026-07-16T10:00:00.000Z" },
    { timeframe: "H4", dataset: "MNQ_H4", visible: "2026-07-16T06:00:00.000Z", hidden: "2026-07-16T10:00:00.000Z" },
  ];

  for (const entry of cases) {
    const rows = [
      { id: `${entry.timeframe}-visible`, timeframe: entry.timeframe, timestamp_utc: entry.visible },
      { id: `${entry.timeframe}-hidden`, timeframe: entry.timeframe, timestamp_utc: entry.hidden },
    ];
    assert.deepEqual(
      filterDatasetRowsAtCutoff(rows, entry.dataset, cutoff).map((row) => row.id),
      [`${entry.timeframe}-visible`],
      entry.timeframe,
    );
  }
});

test("dataset cutoff infers timeframe from dataset when the row omits it", () => {
  const rows = [
    { id: "closed", timestamp_utc: "2026-07-16T09:55:00.000Z" },
    { id: "open", timestamp_utc: "2026-07-16T09:56:00.000Z" },
  ];
  assert.deepEqual(
    filterDatasetRowsAtCutoff(rows, "MNQ_M5", "2026-07-16T10:00:00.000Z").map((row) => row.id),
    ["closed"],
  );
});

test("explicit bar close timestamps keep their close semantics", () => {
  const cutoff = "2026-07-16T10:00:00.000Z";
  const cutoffMs = Date.parse(cutoff);
  const rows = [
    { id: "explicit-iso", timeframe: "M5", timestamp_utc: cutoff, bar_close_utc: cutoff },
    { id: "explicit-epoch-ms", timeframe: "M15", timestamp_utc: cutoff, time_close: cutoffMs },
    { id: "semantic-close", timeframe: "H1", timestamp_utc: cutoff, timestamp_semantics: "BAR_CLOSE" },
    {
      id: "explicit-future",
      timeframe: "M1",
      timestamp_utc: "2026-07-16T09:59:00.000Z",
      bar_close_utc: "2026-07-16T10:00:00.001Z",
    },
  ];
  assert.deepEqual(
    filterDatasetRowsAtCutoff(rows, "MNQ_M5", cutoff).map((row) => row.id),
    ["explicit-iso", "explicit-epoch-ms", "semantic-close"],
  );
});
