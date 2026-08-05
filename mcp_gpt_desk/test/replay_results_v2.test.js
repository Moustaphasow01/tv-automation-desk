import assert from "node:assert/strict";
import test from "node:test";
import { DESK_COLLECTIONS } from "@tv-automation/desk-contracts/collections";
import { FixedClock } from "@tv-automation/desk-time";
import { createTestDeskStore } from "./support/test-desk-store.js";

test("get_backtest_results summarizes replay v2 positions when no legacy backtest exists", async () => {
  const clock = new FixedClock(Date.parse("2026-07-14T20:00:00.000Z"));
  const { store, persistence } = createTestDeskStore({ clock });
  const backtestId = "replay_results_v2_run";

  await persistence.setDocument(DESK_COLLECTIONS.deskReplayRuns, backtestId, {
    backtest_id: backtestId,
    replay_run_id: backtestId,
    status: "COMPLETED",
    mode: "replay",
    replay_mode: "orchestrated_gpt_in_the_loop",
    trading_date: "2026-07-14",
    session: "asia_open",
    updated_at_utc: "2026-07-14T20:00:00.000Z",
  });
  await persistence.setDocument(DESK_COLLECTIONS.deskReplayPositions, "position_1", {
    position_id: "position_1",
    backtest_id: backtestId,
    replay_run_id: backtestId,
    strategy_id: "asia_open",
    trading_date: "2026-07-14",
    status: "CLOSED",
    instrument: "NQ",
    direction: "long",
    entry_price: 100,
    initial_stop_loss: 90,
    stop_loss: 100,
    take_profit_1: 120,
    exit_price: 120,
    exit_reason: "TAKE_PROFIT_1_HIT",
    opened_at_paris: "2026-07-14T15:00:00+02:00",
    closed_at_paris: "2026-07-14T16:00:00+02:00",
    updated_at_utc: "2026-07-14T16:00:00.000Z",
  });

  const result = await store.getBacktestResults({ backtest_id: backtestId });
  assert.equal(result.backtest.status, "COMPLETED");
  assert.equal(result.result.engine, "replay_v2_positions");
  assert.equal(result.result.trades, 1);
  assert.equal(result.result.closed_trades, 1);
  assert.equal(result.result.total_r, 2);
  assert.equal(result.simulated_trades[0].r_result, 2);
});
