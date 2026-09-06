import test from "node:test";
import assert from "node:assert/strict";
import { isTradeOutcomeMonetaryProofValid } from "@tv-automation/desk-domain";
import { runCausalPostgresReplayCli } from "../scripts/replay_us_grains_causal_postgres.mjs";
import { createGrainsReplayDatabase, seedGrainsReplayInputs } from "../src/adapters/grains-causal-postgres-replay.js";
import { replayCutoffs, runGrainsCausalPostgresReplay } from "../src/us-grains-causal-postgres-replay.js";
import { grainSignal } from "./support/causal-grain-signal-fixture.js";
import { grainStrategyIdentity } from "../src/us-grains-strategy-catalog.js";

test("causal PostgreSQL replay refuses to overwrite frozen input", async () => {
  await assert.rejects(
    runCausalPostgresReplayCli([
      "--input", "frozen.json", "--output", "frozen.json",
      "--start", "2026-08-31", "--end", "2026-09-04",
      "--as-of", "2026-09-04T23:59:59.999Z",
    ]),
    /INPUT_AND_OUTPUT_MUST_DIFFER/,
  );
});

test("isolated PostgreSQL replay has no provider commands", { skip: process.env.RUN_POSTGRES_TESTS !== "1" }, async () => {
  const candles = [
    { feed_id: "prod__tradingview__ZC1!__1", timestamp_utc: "2026-09-04T14:00:00Z", open: 100, high: 101, low: 99, close: 100, volume: 1 },
    { feed_id: "prod__tradingview__ZC1!__1", timestamp_utc: "2026-09-04T14:01:00Z", open: 100, high: 101, low: 99, close: 100, volume: 1 },
  ];
  const db = await createGrainsReplayDatabase();
  try {
    await seedGrainsReplayInputs(db.pool, { candles, signals: [], asOfUtc: "2026-09-04T14:02:00Z" });
    const result = await runGrainsCausalPostgresReplay({ database: db.database, pool: db.pool, persistence: db.persistence, candles, signals: [], asOfUtc: "2026-09-04T14:02:00Z" });
      assert.equal(result.replay_mode, "MODE_CAUSAL_PRECOMPUTED");
      assert.equal(result.physical_execution, false);
      assert.equal(result.provider_commands, 0);
      assert.equal(result.calendar.unproven, true);
      assert.deepEqual(result.calendar.coverage, []);
  } finally {
    await db.close();
  }
});

test("replay uses minute closes, includes signals even with missing bars and never passes the cutoff", () => {
  const signals = [{ generated_at_utc: "2026-09-04T15:00Z", expires_at_utc: "2026-09-04T15:05Z" }];
  const candles = ["14:59", "15:00", "15:08"].map((time) => ({ feed_id: "x__1", timestamp_utc: `2026-09-04T${time}:00Z` }));
  const result = replayCutoffs({ signals, candles, asOfUtc: "2026-09-04T15:06Z" });
  assert.deepEqual(result, ["15:00", "15:01", "15:05", "15:06"].map((time) => `2026-09-04T${time}:00.000Z`));
  assert.throws(() => replayCutoffs({ signals, candles, asOfUtc: "2026-09-04T14:59Z" }), /SIGNAL_AFTER_REPLAY_CUTOFF/);
});

test("real PostgreSQL replay: raw pair, canonical context/risk/gate and theoretical fill without human confirmation", {
  skip: process.env.RUN_POSTGRES_TESTS !== "1",
}, async (t) => {
  const db = await createGrainsReplayDatabase();
  t.after(() => db.close());
  const identity = grainStrategyIdentity("VWAP_PULLBACK", "ZW");
  const signals = [grainSignal({ ...identity, direction: "LONG" }), grainSignal({ ...identity, direction: "SHORT" })];
  const candles = [
    { timestamp_utc: "2026-09-04T14:59Z", open: 501, high: 503, low: 499, close: 502 },
    { timestamp_utc: "2026-09-04T15:00Z", open: 501, high: 501, low: 499.75, close: 500.5 },
    { timestamp_utc: "2026-09-04T15:01Z", open: 500.5, high: 503.5, low: 500.25, close: 503 },
  ].map((row) => ({ ...row, feed_id: "prod__tradingview__ZW1!__1", volume: 100 }));
  const asOfUtc = "2026-09-04T15:03:00.000Z";
  const seeded = await seedGrainsReplayInputs(db.pool, { candles, signals, asOfUtc });
  const result = await runGrainsCausalPostgresReplay({ ...db, candles, signals: seeded.runtime_signals, asOfUtc });
  assert.equal(result.ledger.signals.length, 2);
  assert.equal(result.batches[0].published_signal_ids.length, 2);
  assert.equal(result.ledger.context.filter((row) => row.decision === "REJECT").length, 1);
  assert.equal(result.ledger.risk.length, 1);
  assert.equal(result.ledger.intents.length, 1);
  assert.equal(result.ledger.human_gates[0].status, "AWAITING_MANUAL_CONFIRMATION");
  const fill = result.ledger.theoretical_events.find((row) => row.event_type === "entry_filled");
  assert.ok(fill, "canonical live theory must fill after creation, without human confirmation");
  assert.ok(Date.parse(fill.source_candle_timestamp_utc) >= Date.parse(signals[0].generated_at_utc));
  assert.equal(result.ledger.theoretical_events.some((row) => row.event_type === "target_hit"), true);
  assert.equal(result.ledger.outcomes.filter(row => row.status === "final").length, 1);
  assert.equal(Number(result.ledger.outcomes[0].initial_risk_amount), 100);
  assert.equal(Number(result.ledger.outcomes[0].net_realized_pnl), 150);
  assert.equal(Number(result.ledger.outcomes[0].result_r), 1.5);
  assert.equal(result.ledger.outcomes[0].evidence.point_value, 50);
  assert.equal(isTradeOutcomeMonetaryProofValid(result.ledger.outcomes[0]), true);
  assert.equal(result.provider_commands, 0);
});
