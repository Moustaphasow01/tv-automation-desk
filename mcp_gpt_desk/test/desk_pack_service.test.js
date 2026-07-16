import assert from "node:assert/strict";
import test from "node:test";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { FixedClock } from "@tv-automation/desk-time";
import { DeskPackService } from "../src/desk-pack-service.js";
import { InMemoryDeskPersistence } from "./support/in-memory-desk-persistence.js";

const clock = new FixedClock(Date.parse("2026-07-16T08:00:00.000Z"));

function createService() {
  const persistence = new InMemoryDeskPersistence();
  return { persistence, service: new DeskPackService({ persistence, clock }) };
}

test("DeskPackService selects, lists and summarizes legacy decision packs", async () => {
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
  assert.equal(latest.legacy_unverified, undefined);

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
