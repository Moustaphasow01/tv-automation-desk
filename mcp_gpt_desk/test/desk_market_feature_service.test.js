import assert from "node:assert/strict";
import test from "node:test";

import { DeskMarketFeatureService } from "../src/desk-market-feature-service.js";
import { InMemoryDeskPersistence } from "./support/in-memory-desk-persistence.js";

test("technical event reads filter the requested scope before applying the collection limit", async () => {
  const persistence = new InMemoryDeskPersistence();
  for (let index = 0; index < 600; index += 1) {
    persistence.seed("desk_technical_events", `2026-07-01_MNQ_retest_${String(index).padStart(4, "0")}`, {
      event_id: `legacy-${index}`,
      date: "2026-07-01",
      session: "asia_open",
      instrument: "MNQ",
      event_type: "retest",
      timestamp_paris: `2026-07-01T${String(Math.floor(index / 60) % 24).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00+02:00`,
    });
  }
  persistence.seed("desk_technical_events", "2026-07-29_MNQ_breakout_current", {
    event_id: "current-breakout",
    date: "2026-07-29",
    session: "asia_open",
    instrument: "MNQ",
    event_type: "breakout",
    timestamp_paris: "2026-07-29T08:10:00+02:00",
  });
  persistence.seed("desk_technical_events", "2026-07-29_MES_breakout_other_instrument", {
    event_id: "other-instrument",
    date: "2026-07-29",
    session: "asia_open",
    instrument: "MES",
    event_type: "breakout",
    timestamp_paris: "2026-07-29T08:10:00+02:00",
  });

  const service = new DeskMarketFeatureService({
    persistence,
    clock: { now: () => ({ utc: "2026-07-29T06:15:00.000Z", paris: "2026-07-29T08:15:00+02:00" }) },
    host: {},
  });
  const result = await service.getTechnicalEvents({
    date: "2026-07-29",
    session: "asia_open",
    instrument: "MNQ",
  });

  assert.equal(result.count, 1);
  assert.equal(result.events[0].event_id, "current-breakout");
  assert.equal(result.warning, null);
});
