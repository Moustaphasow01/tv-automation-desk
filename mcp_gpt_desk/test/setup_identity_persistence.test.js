import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryDeskPersistence } from "./support/in-memory-desk-persistence.js";

test("setup persistence keeps record and logical identities immutable", async () => {
  const persistence = new InMemoryDeskPersistence();
  await persistence.setDocument("desk_replay_setups", "record_long", {
    setup_record_id: "record_long",
    setup_id: "logical_long",
    backtest_id: "replay_day",
    direction: "long",
  });

  await assert.rejects(
    persistence.setDocument("desk_replay_setups", "record_long", {
      setup_id: "logical_short",
      direction: "short",
    }, { merge: true }),
    (error) => error.code === "SETUP_ID_IMMUTABLE",
  );
  await assert.rejects(
    persistence.setDocument("desk_replay_setups", "record_short", {
      setup_record_id: "record_short",
      setup_id: "logical_long",
      backtest_id: "replay_day",
      direction: "short",
    }),
    (error) => error.code === "SETUP_LOGICAL_ID_CONFLICT",
  );
  await assert.rejects(
    persistence.setDocument("desk_replay_setups", "record_short", {
      setup_record_id: "another_record",
      setup_id: "logical_short",
    }),
    (error) => error.code === "SETUP_RECORD_ID_IMMUTABLE",
  );

  assert.equal(
    (await persistence.getDocument("desk_replay_setups", "record_long")).direction,
    "long",
  );
});
